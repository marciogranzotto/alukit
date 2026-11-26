import { num } from "#catalog/schema/common.ts";
import type { ConnectorItem } from "#catalog/schema/items.ts";
import { compareIds } from "../ids.ts";
import { fullRef } from "../items.ts";
import type { Connection, Face } from "../project/schema.ts";
import { TOL } from "../tolerances.ts";
import { add, addScaled, angleDeg, dot, neg, scale, sub, type V3 } from "../vec.ts";
import type { Ctx } from "./context.ts";
import type { DerivedBar, HoleOp } from "./derive.ts";
import { type GenOut, stockOptions } from "./fastenings.ts";
import { boxCentre, faceLocal, facePlane, onBar, resolveStation } from "./place.ts";
import type { Copy } from "./types.ts";

/**
 * Hardware and machining from connectors (design §3.4, §5.1). Each connection counts its
 * connector: a `butt` `qty` per butting end (its own connector, else `defaults.butt`'s), any
 * other type `qty` once; a butt through a body also counts the body. A connector then brings:
 *
 * - each mount's fastener set, once per hole of the mount, keyed by system: the through bar's
 *   system when the mount has a set for it, else the butting bar's (a butt does not place its
 *   connector in v1, so which bar a mount bears on is not known); a sleeve in a set is cut from
 *   bar stock to the through bar's bore along the joint's normal;
 * - its `requires`, once per butting end: an end tap in the butting end, holes `from_end_mm`
 *   from it on its `+y` face, or holes in the through bar where the butting bar meets it;
 * - a splice's parts, and its tap in both spliced ends.
 *
 * A connector that does not fit a joined bar's system is a `fit` error.
 */

interface Roles {
  /** The through bar (a butt through a bar's side or end, a pivot's base bar). */
  through?: { bar: DerivedBar; end?: "a" | "b" };
  /** A pivot's base station on the through bar. */
  base?: { s: number; face: Face; across: number };
  butting: { bar: DerivedBar; end: "a" | "b" }[];
  /** Units of the connector. */
  units: number;
  connector?: string;
  /** A butt's spacer, for where the butting bar meets the through bar's face. */
  spacer: number;
}

function endOf(ref: string): { bar: string; end: "a" | "b" } {
  const i = ref.lastIndexOf(".");
  return { bar: ref.slice(0, i), end: ref.slice(i + 1) as "a" | "b" };
}

export function connectorHardware(
  ctx: Ctx,
  bars: ReadonlyMap<string, DerivedBar>,
  out: GenOut,
): void {
  for (const id of [...ctx.conns.keys()].sort(compareIds)) {
    const ent = ctx.conns.get(id);
    if (!ent) continue;
    const roles = rolesOf(ctx, id, ent.spec, ent.copy, bars, out);
    if (!roles?.connector) continue;
    new ConnectorGen(ctx, id, ent.spec, roles, !ent.copy, out).run();
  }
}

function rolesOf(
  ctx: Ctx,
  id: string,
  spec: Connection,
  copy: Copy | undefined,
  bars: ReadonlyMap<string, DerivedBar>,
  out: GenOut,
): Roles | undefined {
  const butting = (refs: readonly string[]) =>
    refs.flatMap((r) => {
      const { bar, end } = endOf(r);
      const b = bars.get(bar);
      return b ? [{ bar: b, end }] : [];
    });
  switch (spec.type) {
    case "butt": {
      const def = ctx.doc.defaults.butt;
      const connector = spec.connector ?? def?.connector;
      const qty = spec.qty ?? (spec.connector === undefined ? def?.qty : undefined) ?? 1;
      let through: Roles["through"];
      if (typeof spec.through === "string") {
        const { bar, end } = spec.through.includes(".")
          ? endOf(spec.through)
          : { bar: spec.through, end: undefined };
        const b = bars.get(bar);
        if (b) through = { bar: b, ...(end ? { end } : {}) };
      } else {
        // A body as the through member is counted with the connection (§4.5).
        const found = ctx.items.item(spec.through.body);
        if (found.ok) out.hardware.push({ item: found.id, opt: {}, qty: 1, source: id });
      }
      let spacer = 0;
      if (spec.spacer_mm !== undefined) spacer = ctx.num(id, "spacer_mm", spec.spacer_mm) ?? 0;
      else if (connector) {
        const found = ctx.items.item(connector);
        const sp = found.ok && found.item.kind === "connector" ? found.item.spacer_mm : undefined;
        if (sp !== undefined) spacer = num(sp);
      }
      return {
        ...(through ? { through } : {}),
        butting: butting(spec.ends),
        units: qty * spec.ends.length,
        ...(connector ? { connector } : {}),
        spacer,
      };
    }
    case "splice":
    case "miter":
      return {
        butting: butting(spec.ends),
        units: spec.qty ?? 1,
        ...(spec.connector ? { connector: spec.connector } : {}),
        spacer: 0,
      };
    case "pivot": {
      const sp = resolveStation(ctx, spec.base, { id, field: "base", copy });
      const b = sp ? bars.get(sp.bar.id) : undefined;
      let base: Roles["base"];
      const face = (spec.base.face ?? spec.base.groove?.slice(0, 2)) as Face | undefined;
      if (sp && b && face && sp.u) {
        const fl = faceLocal(b.placed.box, face);
        const C = onBar(b.placed, sp.s, fl.at[0], fl.at[1]);
        base = { s: sp.s, face, across: dot(sub(sp.point, C), sp.u) };
      }
      return {
        ...(b ? { through: { bar: b } } : {}),
        ...(base ? { base } : {}),
        butting: butting(spec.ends),
        units: spec.qty ?? 1,
        connector: spec.connector,
        spacer: 0,
      };
    }
    case "face":
      return {
        butting: [],
        units: spec.qty ?? 1,
        ...(spec.connector ? { connector: spec.connector } : {}),
        spacer: 0,
      };
  }
}

class ConnectorGen {
  private readonly ctx: Ctx;
  private readonly id: string;
  private readonly spec: Connection;
  private readonly roles: Roles;
  private readonly report: boolean;
  private readonly out: GenOut;
  private sleeves = 0;

  constructor(ctx: Ctx, id: string, spec: Connection, roles: Roles, report: boolean, out: GenOut) {
    this.ctx = ctx;
    this.id = id;
    this.spec = spec;
    this.roles = roles;
    this.report = report;
    this.out = out;
  }

  private error(code: string, message: string, extra: { field?: string; refs?: string[] } = {}) {
    if (this.report) this.ctx.d.error(code, this.id, message, extra);
  }

  run(): void {
    const { ctx, roles, id } = this;
    const ref = roles.connector as string;
    const found = ctx.items.item(ref);
    if (!found.ok) {
      this.error("item", found.message, { field: "connector" });
      return;
    }
    this.out.hardware.push({ item: found.id, opt: {}, qty: roles.units, source: id });
    if (found.item.kind !== "connector") return;
    const item = found.item;
    const home = found.id.slice(0, found.id.indexOf(":"));
    this.fit(found.id, item, home);
    if (this.spec.type === "face") return;
    this.mounts(item, home);
    this.requires(item);
    if (item.splice) this.splice(item, home);
  }

  /** The joined bars, through bar first. */
  private joined(): DerivedBar[] {
    const out: DerivedBar[] = [];
    if (this.roles.through) out.push(this.roles.through.bar);
    for (const b of this.roles.butting) if (!out.includes(b.bar)) out.push(b.bar);
    return out;
  }

  private fit(itemId: string, item: ConnectorItem, home: string): void {
    const fits = item.fits.map((s) => fullRef(s, home));
    for (const b of this.joined()) {
      const sys = b.placed.item.system;
      if (sys !== undefined && fits.includes(sys)) continue;
      this.error(
        "fit",
        `${itemId} fits ${fits.join(", ")}; ${b.placed.id} is ${sys ? `a ${sys}` : `${b.placed.item.id}, of no system`}`,
        { field: "connector", refs: [b.placed.id] },
      );
    }
  }

  private mounts(item: ConnectorItem, home: string): void {
    const { roles, id } = this;
    const systems = this.joined()
      .map((b) => b.placed.item.system)
      .filter((s): s is string => s !== undefined);
    for (const [mi, m] of (item.mounts ?? []).entries()) {
      if (!m.fasteners) continue;
      const sets = Object.entries(m.fasteners).map(([k, v]) => [fullRef(k, home), v] as const);
      const set = systems.map((s) => sets.find(([k]) => k === s)).find((x) => x !== undefined);
      if (!set) {
        this.error(
          "fit",
          `mounts[${mi}] has no fastener set for ${systems.join(" or ") || "bars of no system"}`,
          { field: "connector" },
        );
        continue;
      }
      const holes = (m.holes?.length ?? 0) || 1;
      for (const e of set[1]) {
        if ("inside" in e) {
          for (let u = 0; u < roles.units * holes; u++)
            this.mountSleeve(fullRef(e.item, home), e.len_mm);
          continue;
        }
        this.out.hardware.push({
          item: fullRef(e.item, home),
          opt: {},
          qty: e.qty * holes * roles.units,
          source: id,
        });
      }
    }
  }

  /** A sleeve in the through bar's bore, along the joint's normal (§3.4, §4.5). */
  private mountSleeve(itemRef: string, len: number | "bore"): void {
    const { ctx, roles, id } = this;
    const found = ctx.items.item(itemRef);
    if (!found.ok || !found.bar) {
      this.error(
        "item",
        found.ok ? `${itemRef} is not a bar: a sleeve is cut from one` : found.message,
        {
          field: "connector",
        },
      );
      return;
    }
    let L: number | undefined = typeof len === "number" ? len : undefined;
    if (len === "bore") {
      const t = roles.through?.bar;
      const first = roles.butting[0];
      const n = first?.bar.ends[first.end].normal;
      L = t && n ? insideDepth(t, n) : undefined;
      if (L === undefined) {
        this.error(
          "fit",
          `a sleeve of ${itemRef} needs a hollow through bar (RHS or tube) for its bore`,
          { field: "connector" },
        );
        return;
      }
    }
    this.sleeves++;
    const piece = `${id}.s${this.sleeves}`;
    this.out.pieces.push({
      source: piece,
      item: found.id,
      opt: stockOptions(ctx, found.bar),
      len: L as number,
    });
  }

  private requires(item: ConnectorItem): void {
    const { roles, id } = this;
    for (const [ri, req] of (item.requires ?? []).entries()) {
      const field = `connector requires[${ri}]`;
      const targets = req.on === "each" ? (["butting", "through"] as const) : [req.on];
      const d = req.d_mm === undefined ? undefined : num(req.d_mm);
      const depth = req.depth_mm === undefined ? undefined : num(req.depth_mm);
      const fromEnd = req.from_end_mm === undefined ? 0 : num(req.from_end_mm);
      if (req.op === "end-tap" && !req.thread) {
        this.error("connection", `${field}: an end tap needs a thread`, { field: "connector" });
        continue;
      }
      if (req.op !== "end-tap" && d === undefined && !req.thread) {
        this.error("connection", `${field}: a ${req.op} needs d_mm or a thread`, {
          field: "connector",
        });
        continue;
      }
      const hole = {
        ...(d !== undefined ? { d } : {}),
        ...(req.thread && req.op !== "end-tap" ? { thread: req.thread } : {}),
        ...(depth !== undefined ? { depth } : {}),
      };
      for (const target of targets) {
        if (target === "butting") {
          for (const { bar, end } of roles.butting) {
            if (req.op === "end-tap") {
              bar.ops.push({
                op: "end-tap",
                from: end,
                thread: req.thread as string,
                ...(depth !== undefined ? { depth } : {}),
                by: id,
              });
            } else {
              const s = end === "a" ? bar.lengths.sa + fromEnd : bar.lengths.sb - fromEnd;
              bar.ops.push({ op: "hole", face: "+y", from: "a", at: s, ...hole, by: id });
            }
          }
          continue;
        }
        const through = roles.through;
        if (!through) {
          this.error(
            "connection",
            `${field}: on the through bar, but a ${this.spec.type} has none`,
            {
              field: "connector",
            },
          );
          continue;
        }
        if (req.op === "end-tap") {
          if (!through.end) {
            this.error(
              "connection",
              `${field}: an end tap on the through bar needs a butt through its end`,
              {
                field: "connector",
              },
            );
            continue;
          }
          through.bar.ops.push({
            op: "end-tap",
            from: through.end,
            thread: req.thread as string,
            ...(depth !== undefined ? { depth } : {}),
            by: id,
          });
          continue;
        }
        if (roles.base) {
          through.bar.ops.push({
            op: "hole",
            face: roles.base.face,
            from: "a",
            at: roles.base.s,
            ...(Math.abs(roles.base.across) > TOL.len / 100 ? { across: roles.base.across } : {}),
            ...hole,
            by: id,
          });
          continue;
        }
        if (through.end) {
          this.error(
            "connection",
            `${field}: a hole in the through bar needs a butt through its side`,
            {
              field: "connector",
            },
          );
          continue;
        }
        for (const b of roles.butting) {
          const op = this.jointHole(through.bar, b.bar, b.end, hole);
          if (op) through.bar.ops.push(op);
        }
      }
    }
  }

  /** A hole in the through bar where a butting bar's centre line meets its face. */
  private jointHole(
    through: DerivedBar,
    butting: DerivedBar,
    end: "a" | "b",
    fields: Pick<HoleOp, "d" | "thread" | "depth">,
  ): HoleOp | undefined {
    const e = butting.ends[end];
    const bar = butting.placed;
    const [cx, cy] = boxCentre(bar.box);
    const C = add(bar.A, add(scale(bar.frame.x, cx), scale(bar.frame.y, cy)));
    const lambda = dot(sub(e.point, C), e.normal) / dot(bar.frame.t, e.normal);
    const Q = addScaled(addScaled(C, bar.frame.t, lambda), e.normal, this.roles.spacer);
    const T = through.placed;
    const face = (["+x", "-x", "+y", "-y"] as const).find(
      (f) => angleDeg(facePlane(T, f).n, neg(e.normal)) <= TOL.ang,
    );
    if (!face) {
      this.error(
        "connection",
        `${butting.placed.id}.${end} meets ${T.id} at an angle: no face to drill`,
      );
      return undefined;
    }
    const s = dot(sub(Q, T.A), T.frame.t);
    const fl = faceLocal(T.box, face);
    const u = face === "+x" || face === "-x" ? T.frame.y : T.frame.x;
    const across = dot(sub(Q, onBar(T, s, fl.at[0], fl.at[1])), u);
    return {
      op: "hole",
      face,
      from: "a",
      at: s,
      ...(Math.abs(across) > TOL.len / 100 ? { across } : {}),
      ...fields,
      by: this.id,
    };
  }

  /** A splice's parts, and its tap in both spliced ends (§3.4). */
  private splice(item: ConnectorItem, home: string): void {
    const sp = item.splice as NonNullable<ConnectorItem["splice"]>;
    for (const p of sp.parts) {
      this.out.hardware.push({
        item: fullRef(p.item, home),
        opt: {},
        qty: p.qty * this.roles.units,
        source: this.id,
      });
    }
    if (!sp.tap) return;
    const depth = sp.tap_depth_mm === undefined ? undefined : num(sp.tap_depth_mm);
    for (const { bar, end } of this.roles.butting) {
      bar.ops.push({
        op: "end-tap",
        from: end,
        thread: sp.tap,
        ...(depth !== undefined ? { depth } : {}),
        by: this.id,
      });
    }
  }
}

/** A hollow bar's inside depth along a direction across it, through its centre. */
function insideDepth(b: DerivedBar, n: V3): number | undefined {
  const item = b.placed.item;
  const t = item.sectionParams.t_mm;
  if (t === undefined || (item.shape !== "rhs" && item.shape !== "tube")) return undefined;
  const { x, y } = b.placed.frame;
  const box = b.placed.box;
  const depth = Math.abs(dot(n, x)) * (box.x1 - box.x0) + Math.abs(dot(n, y)) * (box.y1 - box.y0);
  return depth - 2 * t;
}
