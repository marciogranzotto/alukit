import { num } from "#catalog/schema/common.ts";
import type { ConnectorItem } from "#catalog/schema/items.ts";
import { compareIds } from "../ids.ts";
import { fullRef } from "../items.ts";
import type { Connection, Face } from "../project/schema.ts";
import { threadDiameter } from "../threads.ts";
import { TOL } from "../tolerances.ts";
import { add, addScaled, angleDeg, dot, neg, norm, scale, sub, type V3 } from "../vec.ts";
import type { Ctx } from "./context.ts";
import type { DerivedBar, EndHoleOp, HoleOp } from "./derive.ts";
import { type GenOut, stockOptions } from "./fastenings.ts";
import { boxCentre, faceLocal, facePlane, onBar, resolveStation } from "./place.ts";
import type { Copy, HardwareUse, PlacedBar, StockPiece } from "./types.ts";

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
 *   from it on its `+y` face, or holes in the through bar where the butting bar meets it: in the
 *   face it meets, or, for a butt through the through bar's end, into that end along its axis.
 *   A requirement with positions (`at_mm`, or `at_holes`: a mount's holes) makes one op at each,
 *   read in the butting bar's section x and y from its box centre (acceptance gap A8);
 * - a splice's parts, and its taps in both spliced ends: one per stud, at the cores its item
 *   gives (`at_mm`), else at the centre.
 *
 * Fit is judged by role: a butting bar by its system, the through bar by its system, by the
 * sleeve a chosen fastener set puts in its bore, or, for a butt `held_by` another, by that
 * butt's through-fastener (acceptance gap A9). A bar held no way is a `fit` error.
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
  /** A butt through a body: the body, counted with the connection (§4.5). */
  body?: HardwareUse;
}

/** A mount's fastener set, chosen by system (§3.4), used once per hole of the mount. */
interface ChosenSet {
  mount: number;
  holes: number;
  entries: NonNullable<NonNullable<ConnectorItem["mounts"]>[number]["fasteners"]>[string];
}

/** A connection with what it joins, before its connector's hardware is generated. */
interface Joint {
  spec: Connection;
  copy?: Copy;
  roles: Roles;
}

/**
 * A butt held by another butt's through-fastener (acceptance gap A9). `ok` is false when the
 * relation fails (its error is reported): the through bar is then not judged again.
 */
interface Held {
  by: string;
  ok: boolean;
}

type Pos = readonly [number, number] | undefined;

function endOf(ref: string): { bar: string; end: "a" | "b" } {
  const i = ref.lastIndexOf(".");
  return { bar: ref.slice(0, i), end: ref.slice(i + 1) as "a" | "b" };
}

const mm = (x: number) => (Math.abs(x) < 0.005 ? 0 : x).toFixed(2);
const posText = (p: readonly [number, number]) => `(${mm(p[0])}, ${mm(p[1])})`;

export function connectorHardware(
  ctx: Ctx,
  bars: ReadonlyMap<string, DerivedBar>,
  out: GenOut,
): void {
  const joints = new Map<string, Joint>();
  for (const id of [...ctx.conns.keys()].sort(compareIds)) {
    const ent = ctx.conns.get(id);
    if (!ent) continue;
    const roles = rolesOf(ctx, id, ent.spec, ent.copy, bars);
    if (roles) joints.set(id, { spec: ent.spec, ...(ent.copy ? { copy: ent.copy } : {}), roles });
  }
  const held = heldBy(ctx, joints);
  for (const [id, j] of joints) {
    if (j.roles.body) out.hardware.push(j.roles.body);
    if (!j.roles.connector) continue;
    new ConnectorGen(ctx, id, j.spec, j.roles, !j.copy, out, held.get(id)).run();
  }
}

function rolesOf(
  ctx: Ctx,
  id: string,
  spec: Connection,
  copy: Copy | undefined,
  bars: ReadonlyMap<string, DerivedBar>,
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
      let body: HardwareUse | undefined;
      if (typeof spec.through === "string") {
        const { bar, end } = spec.through.includes(".")
          ? endOf(spec.through)
          : { bar: spec.through, end: undefined };
        const b = bars.get(bar);
        if (b) through = { bar: b, ...(end ? { end } : {}) };
      } else {
        // A body as the through member is counted with the connection (§4.5). A joint recipe
        // has no box to bear on; stage 3 reports it, and it is not counted.
        const found = ctx.items.item(spec.through.body);
        const recipe = found.ok && found.item.kind === "connector" && found.item.recipe === true;
        if (found.ok && !recipe) body = { item: found.id, opt: {}, qty: 1, source: id };
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
        ...(body ? { body } : {}),
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

/** The connector item a reference names, with its catalog (the home of its own references). */
function connectorItem(
  ctx: Ctx,
  ref: string | undefined,
): { id: string; item: ConnectorItem; home: string } | undefined {
  if (!ref) return undefined;
  const found = ctx.items.item(ref);
  if (!found.ok || found.item.kind !== "connector") return undefined;
  return { id: found.id, item: found.item, home: found.id.slice(0, found.id.indexOf(":")) };
}

/** The joined bars, through bar first. */
function joinedBars(roles: Roles): DerivedBar[] {
  const out: DerivedBar[] = [];
  if (roles.through) out.push(roles.through.bar);
  for (const b of roles.butting) if (!out.includes(b.bar)) out.push(b.bar);
  return out;
}

/**
 * Each mount's fastener set: the one keyed by the system of a joined bar the connector fits, the
 * through bar's first (a butt does not place its connector in v1, so which bar a mount bears on
 * is not known). `missing` lists the mounts with sets but none for those systems.
 */
function chooseSets(
  item: ConnectorItem,
  home: string,
  roles: Roles,
): { sets: ChosenSet[]; systems: string[]; missing: number[] } {
  const fits = item.fits.map((s) => fullRef(s, home));
  const systems = [
    ...new Set(
      joinedBars(roles)
        .map((b) => b.placed.item.system)
        .filter((s): s is string => s !== undefined && fits.includes(s)),
    ),
  ];
  const sets: ChosenSet[] = [];
  const missing: number[] = [];
  for (const [mi, m] of (item.mounts ?? []).entries()) {
    if (!m.fasteners || systems.length === 0) continue;
    const keyed = Object.entries(m.fasteners).map(([k, v]) => [fullRef(k, home), v] as const);
    const set = systems.map((s) => keyed.find(([k]) => k === s)).find((x) => x !== undefined);
    if (!set) missing.push(mi);
    else sets.push({ mount: mi, holes: (m.holes?.length ?? 0) || 1, entries: set[1] });
  }
  return { sets, systems, missing };
}

/**
 * What a connector passes through its through bar (acceptance gap A9): a sleeve a chosen fastener
 * set puts in its bore, or a hole it requires through it (a `through-hole` with no depth). The
 * fastener that runs in them is a through-fastener, which can also hold an end on the far side.
 */
function passesThrough(
  item: ConnectorItem,
  sets: readonly ChosenSet[],
  bar: string,
): string | undefined {
  if (sets.some((s) => s.entries.some((e) => "inside" in e))) {
    return `sets a sleeve in ${bar}'s bore`;
  }
  const hole = (item.requires ?? []).some(
    (r) => r.op === "through-hole" && r.on !== "butting" && r.depth_mm === undefined,
  );
  return hole ? `requires a hole through ${bar}` : undefined;
}

/** A bar's centre line: through its placed box's centre, along its axis (§4.5). */
function centreLine(b: DerivedBar): { C: V3; t: V3 } {
  const p = b.placed;
  const [cx, cy] = boxCentre(p.box);
  return { C: add(p.A, add(scale(p.frame.x, cx), scale(p.frame.y, cy))), t: p.frame.t };
}

/**
 * Why two butting ends cannot share one through-fastener, or undefined when they can: their
 * centre lines coincide (parallel within `tol.ang`, within `tol.len` of each other) and they bear
 * on the through bar from opposite sides.
 */
function notCoaxial(
  held: { bar: DerivedBar; end: "a" | "b" },
  holder: { bar: DerivedBar; end: "a" | "b" },
  through: string,
): string | undefined {
  const h = centreLine(held.bar);
  const k = centreLine(holder.bar);
  const name = `${holder.bar.placed.id}.${holder.end}`;
  const angle = Math.min(angleDeg(h.t, k.t), angleDeg(h.t, neg(k.t)));
  if (angle > TOL.ang) return `its centre line is at ${angle.toFixed(2)}° to ${name}'s`;
  const d = sub(h.C, k.C);
  const off = norm(addScaled(d, k.t, -dot(d, k.t)));
  if (off > TOL.len) return `its centre line is ${mm(off)} off ${name}'s`;
  if (dot(held.bar.ends[held.end].normal, holder.bar.ends[holder.end].normal) > 0) {
    return `it bears on ${through} from the same side as ${name}`;
  }
  return undefined;
}

/**
 * The butts held by another butt's through-fastener (`held_by`; acceptance gap A9): one stud
 * through the through bar, in one sleeve, into a bush in each of two coaxial ends on opposite
 * sides. The holder is a butt through the same bar's side, held by nothing itself, whose
 * connector passes a through-fastener (`passesThrough`); each held end is coaxial with one of its
 * ends, on the far side, and each of those holds one end. The held butt's own connector passes
 * nothing through the bar: the through-fastener is the holder's. Anything else is a `connection`
 * error on the held butt, which then holds its through bar in no way of its own.
 */
function heldBy(ctx: Ctx, joints: ReadonlyMap<string, Joint>): Map<string, Held> {
  const out = new Map<string, Held>();
  /** A holder's end → the end it holds, with that end's butt. */
  const holding = new Map<string, { end: string; by: string }>();
  for (const [id, j] of joints) {
    if (j.spec.type !== "butt" || j.spec.held_by === undefined) continue;
    const by = j.spec.held_by;
    const report = !j.copy;
    const fail = (message: string, code = "connection"): void => {
      if (report) ctx.d.error(code, id, `held_by: ${message}`, { field: "held_by", refs: [by] });
      out.set(id, { by, ok: false });
    };
    const h = joints.get(by);
    if (!h) {
      fail(`no connection ${by}`, "ref");
      continue;
    }
    if (by === id) {
      fail("a butt cannot be held by its own through-fastener");
      continue;
    }
    if (h.spec.type !== "butt") {
      fail(`${by} is a ${h.spec.type}; only a butt's through-fastener holds ends through a bar`);
      continue;
    }
    if (h.spec.held_by !== undefined) {
      fail(
        `${by} is itself held by ${h.spec.held_by}; name the butt whose connector passes the through-fastener`,
      );
      continue;
    }
    const side = (s: Connection & { type: "butt" }) =>
      typeof s.through === "string" && !s.through.includes(".") ? s.through : undefined;
    const bar = side(j.spec);
    if (bar === undefined) {
      fail("a through-fastener passes a bar's side; this butt is through a bar's end or a body");
      continue;
    }
    if (side(h.spec) !== bar) {
      fail(`${by} does not butt through the side of ${bar}, so no fastener of it passes ${bar}`);
      continue;
    }
    if (!j.roles.through || !h.roles.through) {
      out.set(id, { by, ok: false }); // the bar did not derive: its own error stands
      continue;
    }
    const holder = connectorItem(ctx, h.roles.connector);
    if (!holder) {
      fail(`${by} has no connector to pass a through-fastener through ${bar}`);
      continue;
    }
    const passes = passesThrough(
      holder.item,
      chooseSets(holder.item, holder.home, h.roles).sets,
      bar,
    );
    if (!passes) {
      fail(
        `${by}'s connector ${holder.id} passes nothing through ${bar} (no sleeve in its bore, no hole through it), so it holds no end on the far side`,
      );
      continue;
    }
    const own = connectorItem(ctx, j.roles.connector);
    const ownPasses =
      own && passesThrough(own.item, chooseSets(own.item, own.home, j.roles).sets, bar);
    if (own && ownPasses) {
      fail(
        `held by ${by}'s through-fastener, its own connector passes none; ${own.id} ${ownPasses}`,
      );
      continue;
    }
    const problems: string[] = [];
    const matched = new Map<string, string>();
    for (const e of j.roles.butting) {
      const ref = `${e.bar.placed.id}.${e.end}`;
      const tries = h.roles.butting.map((k) => ({ k, why: notCoaxial(e, k, bar) }));
      const hit = tries.find((x) => x.why === undefined);
      if (!hit) {
        const first = tries[0];
        problems.push(
          first ? `${ref} is not coaxial with ${by}'s end: ${first.why}` : `${by} has no end`,
        );
        continue;
      }
      const end = `${hit.k.bar.placed.id}.${hit.k.end}`;
      const key = `${by}|${end}`;
      const taken = holding.get(key);
      const other = taken ? `${taken.end} (${taken.by})` : matched.get(key);
      if (other) {
        problems.push(`${end}'s through-fastener already holds ${other}; it holds one end`);
        continue;
      }
      matched.set(key, ref);
    }
    if (problems.length > 0) {
      fail(problems.join("; "));
      continue;
    }
    for (const [key, end] of matched) holding.set(key, { end, by: id });
    out.set(id, { by, ok: true });
  }
  return out;
}

class ConnectorGen {
  private readonly ctx: Ctx;
  private readonly id: string;
  private readonly spec: Connection;
  private readonly roles: Roles;
  private readonly report: boolean;
  private readonly out: GenOut;
  private readonly held: Held | undefined;
  private sleeves = 0;

  constructor(
    ctx: Ctx,
    id: string,
    spec: Connection,
    roles: Roles,
    report: boolean,
    out: GenOut,
    held?: Held,
  ) {
    this.ctx = ctx;
    this.id = id;
    this.spec = spec;
    this.roles = roles;
    this.report = report;
    this.out = out;
    this.held = held;
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
    // A joint recipe has no body: it is listed, not bought; what it brings is (§3.4).
    const recipe = found.item.kind === "connector" && found.item.recipe === true;
    (recipe ? this.out.recipes : this.out.hardware).push({
      item: found.id,
      opt: {},
      qty: roles.units,
      source: id,
    });
    if (found.item.kind !== "connector") return;
    const item = found.item;
    const home = found.id.slice(0, found.id.indexOf(":"));
    const fits = item.fits.map((s) => fullRef(s, home));
    const sets = this.spec.type === "face" ? [] : this.chosenSets(item, home);
    this.fit(found.id, fits, sets);
    if (this.spec.type === "face") return;
    this.mounts(sets, home);
    this.requires(item);
    if (item.splice) this.splice(item, home);
  }

  /** Each mount's fastener set (`chooseSets`); a mount with none for the joined systems is a `fit` error. */
  private chosenSets(item: ConnectorItem, home: string): ChosenSet[] {
    const { sets, systems, missing } = chooseSets(item, home, this.roles);
    for (const mi of missing) {
      this.error("fit", `mounts[${mi}] has no fastener set for ${systems.join(" or ")}`, {
        field: "connector",
      });
    }
    return sets;
  }

  /**
   * Fit by role (§3.4; acceptance gaps A1, A9). A butting bar is held at its end by its system,
   * which the connector must fit. The through bar is held by its system, by its bore (a chosen
   * fastener set puts a sleeve in it, `inside: "through"`, and the sleeve then needs it hollow),
   * or by another butt's through-fastener (`held_by`). A bar held no way is a `fit` error naming
   * it. The through bar is judged only when some joined bar has a system the connector fits: with
   * none, no fastener set can apply, every butting bar has failed, and that is the error to fix.
   * A `held_by` that fails has its own error, so the through bar is not judged again.
   */
  private fit(itemId: string, fits: readonly string[], sets: readonly ChosenSet[]): void {
    const through = this.roles.through?.bar;
    const sleeved = sets.some((s) => s.entries.some((e) => "inside" in e));
    const fitted = (b: DerivedBar) => {
      const sys = b.placed.item.system;
      return sys !== undefined && fits.includes(sys);
    };
    const joined = joinedBars(this.roles);
    const anyFitted = joined.some(fitted);
    for (const b of joined) {
      if (fitted(b)) continue;
      const sys = b.placed.item.system;
      const isThrough = b === through;
      if (isThrough && sleeved) continue; // held by its bore; the sleeve checks it is hollow
      if (isThrough && this.held) continue; // held by another butt's through-fastener
      if (isThrough && !anyFitted) continue;
      const what = sys ? `a ${sys}` : `${b.placed.item.id}, of no system`;
      const how = isThrough ? ", and no fastener set of the connector sets a sleeve in it" : "";
      this.error("fit", `${itemId} fits ${fits.join(", ")}; ${b.placed.id} is ${what}${how}`, {
        field: "connector",
        refs: [b.placed.id],
      });
    }
  }

  private mounts(sets: readonly ChosenSet[], home: string): void {
    const { roles, id } = this;
    for (const set of sets) {
      for (const e of set.entries) {
        if ("inside" in e) {
          const sleeve = this.mountSleeve(fullRef(e.item, home), e.len_mm);
          if (!sleeve) continue;
          for (let u = 0; u < roles.units * set.holes; u++) {
            this.sleeves++;
            this.out.pieces.push({ source: `${id}.s${this.sleeves}`, ...sleeve });
          }
          continue;
        }
        this.out.hardware.push({
          item: fullRef(e.item, home),
          opt: {},
          qty: e.qty * set.holes * roles.units,
          source: id,
        });
      }
    }
  }

  /**
   * A sleeve in the through bar's bore, along the joint's normal (§3.4, §4.5): it needs a through
   * bar, and a hollow one (RHS or tube) whatever its length, since it sits in the bore. `bore` is
   * the inside depth along the first butting end's normal.
   */
  private mountSleeve(
    itemRef: string,
    len: number | "bore",
  ): Omit<StockPiece, "source"> | undefined {
    const { ctx, roles } = this;
    const found = ctx.items.item(itemRef);
    if (!found.ok || !found.bar) {
      this.error(
        "item",
        found.ok ? `${itemRef} is not a bar: a sleeve is cut from one` : found.message,
        { field: "connector" },
      );
      return undefined;
    }
    const t = roles.through?.bar;
    const first = roles.butting[0];
    const n = first?.bar.ends[first.end].normal;
    const bore = t && n ? insideDepth(t, n) : undefined;
    if (bore === undefined) {
      this.error(
        "fit",
        t
          ? `a sleeve of ${itemRef} needs a hollow through bar (RHS or tube); ${t.placed.id} is ${t.placed.item.id}`
          : `a sleeve of ${itemRef} sits in the through bar's bore, but a ${this.spec.type} here has no through bar`,
        { field: "connector", ...(t ? { refs: [t.placed.id] } : {}) },
      );
      return undefined;
    }
    return {
      item: found.id,
      opt: stockOptions(ctx, found.bar),
      len: typeof len === "number" ? len : bore,
    };
  }

  /**
   * A requirement's positions (acceptance gap A8): its `at_mm`, or the x and y of the holes of the
   * mount `at_holes` names, in the butting bar's section from its box centre. A requirement with
   * none makes one op at the centre or at the joint point, as before: `[undefined]`.
   */
  private positions(
    item: ConnectorItem,
    req: NonNullable<ConnectorItem["requires"]>[number],
  ): Pos[] {
    if (req.at_mm) return req.at_mm.map((p) => [p[0], p[1]] as const);
    if (req.at_holes !== undefined) {
      const holes = item.mounts?.[req.at_holes]?.holes ?? [];
      if (holes.length > 0) return holes.map((h) => [h.at_mm[0], h.at_mm[1]] as const);
    }
    return [undefined];
  }

  /**
   * Where the connector taps the butting end: every end tap it asks of the butting bar (`on`
   * butting or each), at its positions, the centre where it gives none. A hole the connector
   * makes in the through bar at one of these places is the clearance for a screw into that tap.
   */
  private buttingTaps(item: ConnectorItem): (readonly [number, number])[] {
    const out: (readonly [number, number])[] = [];
    for (const req of item.requires ?? []) {
      if (req.op !== "end-tap" || (req.on !== "butting" && req.on !== "each")) continue;
      for (const p of this.positions(item, req)) out.push(p ?? [0, 0]);
    }
    return out;
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
      const at = this.positions(item, req);
      const placed = at[0] !== undefined;
      const hole = {
        ...(d !== undefined ? { d } : {}),
        ...(req.thread && req.op !== "end-tap" ? { thread: req.thread } : {}),
        ...(depth !== undefined ? { depth } : {}),
      };
      // A hole in the through bar at a place where the connector also taps the butting end is
      // the clearance for a screw into that tap: it follows the screw (after acceptance run 4).
      const screws = this.buttingTaps(item);
      const intoTap = (p: Pos) => screws.some((q) => samePlace(q, p));
      for (const target of targets) {
        if (target === "butting") {
          for (const { bar, end } of roles.butting) {
            if (req.op === "end-tap") {
              this.endTaps(bar, end, at, req.thread as string, depth, field);
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
          // Unplaced, it stays at the end's centre (acceptance-gaps decision 14); placed, it
          // stands where each position on the butting bar meets the end face.
          if (!placed) {
            through.bar.ops.push({
              op: "end-tap",
              from: through.end,
              thread: req.thread as string,
              ...(depth !== undefined ? { depth } : {}),
              by: id,
            });
            continue;
          }
          for (const b of roles.butting) {
            for (const p of at) {
              const off = this.endPlace(
                through.bar,
                through.end,
                b.bar,
                b.end,
                this.jointPoint(b.bar, b.end, p),
                p,
              );
              if (!off) continue;
              through.bar.ops.push({
                op: "end-tap",
                from: through.end,
                ...(off.centre ? {} : { off: off.off }),
                thread: req.thread as string,
                ...(depth !== undefined ? { depth } : {}),
                by: id,
              });
            }
          }
          continue;
        }
        if (roles.base) {
          if (placed) {
            this.error(
              "connection",
              `${field}: positions are read at a butting end; a pivot's base takes none in v1`,
              { field: "connector" },
            );
            continue;
          }
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
        for (const b of roles.butting) {
          const off: string[] = [];
          const tilted: { at: Pos; angle: number; face: Face }[] = [];
          for (const p of at) {
            if (through.end) {
              const op = this.endHole(through.bar, through.end, b.bar, b.end, hole, p, {
                screw: intoTap(p),
                field,
              });
              if (op) through.bar.ops.push(op);
              continue;
            }
            const r = this.jointHole(through.bar, b.bar, b.end, hole, p, off, intoTap(p));
            if (r && "tilted" in r) tilted.push({ at: p, angle: r.tilted, face: r.face });
            else if (r) through.bar.ops.push(r);
          }
          if (off.length > 0) {
            this.error(
              "connection",
              `${field}: ${off.length === 1 ? "a position" : `${off.length} positions`} at ${b.bar.placed.id}.${b.end} meet ${through.bar.placed.id} off its face: ${off.join(", ")}`,
              { field: "connector", refs: [through.bar.placed.id] },
            );
          }
          const first = tilted[0];
          if (first) {
            const one = tilted.length === 1;
            const places = tilted.flatMap((x) => (x.at ? [posText(x.at)] : []));
            const where = places.length > 0 ? ` at ${places.join(", ")}` : "";
            this.error(
              "connection",
              `${field}: the ${one ? "screw" : "screws"} into ${b.bar.placed.id}.${b.end}'s ${one ? "tap" : "taps"}${where} ${one ? "runs" : "run"} ${deg(first.angle)}° off square to ${through.bar.placed.id}'s face ${first.face}; a hole in a bar's side is drilled square to its face, so ${one ? "it cannot be made" : "none of them can be made"}`,
              { field: "connector", refs: [through.bar.placed.id] },
            );
          }
        }
      }
    }
  }

  /**
   * End taps in a bar's end, one at each position (at the centre where there is none). A position
   * off the end's section box is a `connection` error, one for the positions of one requirement
   * at one end.
   */
  private endTaps(
    bar: DerivedBar,
    end: "a" | "b",
    at: readonly Pos[],
    thread: string,
    depth: number | undefined,
    field: string,
  ): void {
    const off: string[] = [];
    for (const p of at) {
      if (p && !onEnd(bar, p)) {
        off.push(posText(p));
        continue;
      }
      const centre = !p || (zero(p[0]) && zero(p[1]));
      bar.ops.push({
        op: "end-tap",
        from: end,
        ...(centre ? {} : { off: [zero(p[0]) ? 0 : p[0], zero(p[1]) ? 0 : p[1]] as const }),
        thread,
        ...(depth !== undefined ? { depth } : {}),
        by: this.id,
      });
    }
    if (off.length > 0) {
      const box = bar.placed.box;
      this.error(
        "connection",
        `${field}: ${off.length === 1 ? "a position falls" : `${off.length} positions fall`} off ${bar.placed.id}.${end}'s end (${mm(box.x1 - box.x0)} x ${mm(box.y1 - box.y0)}): ${off.join(", ")}`,
        { field: "connector", refs: [bar.placed.id] },
      );
    }
  }

  /**
   * Where a butting bar meets the through bar: the line along its axis at position `p` of its
   * section (its centre line when none), crossing its end plane, moved by the spacer along the
   * end's normal onto the through bar's face (decision 29; acceptance gap A8).
   */
  private jointPoint(butting: DerivedBar, end: "a" | "b", p?: Pos): V3 {
    const e = butting.ends[end];
    const bar = butting.placed;
    const [cx, cy] = boxCentre(bar.box);
    const C = add(
      bar.A,
      add(scale(bar.frame.x, cx + (p?.[0] ?? 0)), scale(bar.frame.y, cy + (p?.[1] ?? 0))),
    );
    const lambda = dot(sub(e.point, C), e.normal) / dot(bar.frame.t, e.normal);
    return addScaled(addScaled(C, bar.frame.t, lambda), e.normal, this.roles.spacer);
  }

  /**
   * A point of the through bar's end face as an offset from the section's box centre (G17;
   * acceptance gaps A4, A8): where a butting bar's position meets it. It must fall on the end face.
   */
  private endPlace(
    through: DerivedBar,
    throughEnd: "a" | "b",
    butting: DerivedBar,
    end: "a" | "b",
    Q: V3,
    p?: Pos,
  ): { off: readonly [number, number]; centre: boolean } | undefined {
    const T = through.placed;
    const [x, y] = sectionOffset(T, Q);
    const hx = (T.box.x1 - T.box.x0) / 2;
    const hy = (T.box.y1 - T.box.y0) / 2;
    if (Math.abs(x) > hx - TOL.len || Math.abs(y) > hy - TOL.len) {
      const at = p ? ` at ${posText(p)}` : "";
      this.error(
        "connection",
        `${butting.placed.id}.${end}${at} meets ${T.id}.${throughEnd} off its end face: no place for the hole`,
        { refs: [T.id] },
      );
      return undefined;
    }
    return { off: [zero(x) ? 0 : x, zero(y) ? 0 : y], centre: zero(x) && zero(y) };
  }

  /**
   * A hole in the through bar's end face, for a butt that bears on that end (G17; acceptance gap
   * A4). It follows its fastener's axis (after acceptance run 4). A `screw` into a tap the
   * connector makes in the butting end at this position runs along the butting bar's axis
   * through the position, so the hole enters the end face where that line meets it and runs on
   * to the other end face (or its depth): its exit and its angle to the end face's normal go
   * with it. Any other hole runs along the through bar's axis, where the butting bar meets the
   * end face (A4). Either way it must stay in the bar's section box: a hole whose axis leaves by a
   * side before it reaches the other end face (or its depth) has no place, and one whose wall
   * breaks out of a side is made and reported; each a `connection` error on the connection.
   */
  private endHole(
    through: DerivedBar,
    throughEnd: "a" | "b",
    butting: DerivedBar,
    end: "a" | "b",
    fields: Pick<HoleOp, "d" | "thread" | "depth">,
    p: Pos,
    how: { screw: boolean; field: string },
  ): EndHoleOp | undefined {
    const T = through.placed;
    const face = through.ends[throughEnd];
    const other = throughEnd === "a" ? "b" : "a";
    const inward = throughEnd === "a" ? T.frame.t : neg(T.frame.t);
    let Q: V3;
    let u: V3;
    if (how.screw) {
      const B = butting.placed;
      const [cx, cy] = boxCentre(B.box);
      const O = add(
        B.A,
        add(scale(B.frame.x, cx + (p?.[0] ?? 0)), scale(B.frame.y, cy + (p?.[1] ?? 0))),
      );
      u = end === "a" ? neg(B.frame.t) : B.frame.t;
      // The butt is valid, so its centre line, parallel to u, crosses the end face going in.
      Q = addScaled(O, u, dot(sub(face.point, O), face.normal) / dot(u, face.normal));
    } else {
      Q = this.jointPoint(butting, end, p);
      u = inward;
    }
    const place = this.endPlace(through, throughEnd, butting, end, Q, p);
    if (!place) return undefined;
    const along = angleDeg(u, inward) <= TOL.ang;
    const angle = angleDeg(u, neg(face.normal));
    // How far the axis runs inside: to the other end face, or the hole's depth.
    const far = through.ends[other];
    const toFar =
      dot(u, far.normal) > 1e-12
        ? dot(sub(far.point, Q), far.normal) / dot(u, far.normal)
        : Infinity;
    const length = fields.depth === undefined ? toFar : Math.min(fields.depth, toFar);
    const r = holeRadius(fields);
    const path = holePath(T, Q, u, length, r ?? 0);
    const what = fields.thread
      ? `tap ${fields.thread}`
      : `Ø${fields.d === undefined ? "?" : mm(fields.d)} hole`;
    if (path.leaves) {
      const into = how.screw
        ? `the screw into ${butting.placed.id}.${end}'s tap${p ? ` at ${posText(p)}` : ""}`
        : `the ${what}`;
      this.error(
        "connection",
        `${how.field}: ${into} enters ${T.id}'s end ${throughEnd} ${deg(angle)}° off square and leaves ${T.id} by its face ${path.leaves.face} ${mm(path.leaves.at)} mm in from end ${throughEnd}${r === undefined ? "" : `, its ${what}'s wall from ${mm(path.leaves.wall)} mm in`}, before it reaches ${fields.depth === undefined ? `end ${other}` : "its depth"}: there is no place for its hole`,
        { field: "connector", refs: [T.id] },
      );
      return undefined;
    }
    if (r !== undefined && path.breaks) {
      const b = path.breaks;
      const entry = place.centre
        ? "at the centre"
        : `at x ${mm(place.off[0])}, y ${mm(place.off[1])} from the centre`;
      const tilt = along ? "" : `, ${deg(angle)}° off square,`;
      const where = b.whole
        ? `along its whole length, by ${mm(b.by)} mm`
        : `from ${mm(b.from)} mm in from end ${throughEnd}, by up to ${mm(b.by)} mm`;
      this.error(
        "connection",
        `${how.field}: the ${what} in ${T.id}'s end ${throughEnd} ${entry}${tilt} breaks out of its face ${b.face} ${where}`,
        { field: "connector", refs: [T.id] },
      );
    }
    const exit = path.exit;
    return {
      op: "end-hole",
      from: throughEnd,
      ...(place.centre ? {} : { off: place.off }),
      ...(along
        ? {}
        : { exit: [zero(exit[0]) ? 0 : exit[0], zero(exit[1]) ? 0 : exit[1]] as const, angle }),
      ...fields,
      by: this.id,
    };
  }

  /**
   * A hole in the through bar where a butting bar's centre line (or the line at a position of its
   * section) meets its face. A position whose line misses the face is collected in `off`. A hole
   * for a screw into the butting end (`screw`) follows the screw, and a side hole is drilled
   * square to its face: where the screw, on the face, meets it at an angle, the angle is returned
   * instead, and no hole is made (after acceptance run 4).
   */
  private jointHole(
    through: DerivedBar,
    butting: DerivedBar,
    end: "a" | "b",
    fields: Pick<HoleOp, "d" | "thread" | "depth">,
    p: Pos,
    off: string[],
    screw: boolean,
  ): HoleOp | { tilted: number; face: Face } | undefined {
    const e = butting.ends[end];
    const Q = this.jointPoint(butting, end, p);
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
    if (p) {
      // A position may carry the hole off the face, across it or past the bar's cut ends.
      const half =
        face === "+x" || face === "-x" ? (T.box.y1 - T.box.y0) / 2 : (T.box.x1 - T.box.x0) / 2;
      const { sa, sb } = through.lengths;
      if (Math.abs(across) > half - TOL.len || s < sa + TOL.len || s > sb - TOL.len) {
        off.push(posText(p));
        return undefined;
      }
    }
    if (screw) {
      const u = end === "a" ? neg(butting.placed.frame.t) : butting.placed.frame.t;
      const tilt = angleDeg(u, neg(facePlane(T, face).n));
      if (tilt > TOL.ang) return { tilted: tilt, face };
    }
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

  /**
   * A splice's parts, and its taps in both spliced ends (§3.4): one core per stud, at the
   * positions its item gives (`at_mm`, acceptance gap A8), else each at the centre, where more
   * than one coincide (a `machining` error, `duplicateOps`).
   */
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
    const at: Pos[] = sp.at_mm
      ? sp.at_mm.map((p) => [p[0], p[1]] as const)
      : Array.from({ length: spliceStuds(this.ctx, sp, home) }, () => undefined);
    for (const { bar, end } of this.roles.butting) {
      this.endTaps(bar, end, at, sp.tap, depth, "connector splice");
    }
  }
}

/** A splice's studs (its parts that are fasteners of subtype `stud`, by qty), at least one. */
function spliceStuds(ctx: Ctx, sp: NonNullable<ConnectorItem["splice"]>, home: string): number {
  let n = 0;
  for (const p of sp.parts) {
    const found = ctx.items.item(fullRef(p.item, home));
    if (found.ok && found.item.kind === "fastener" && found.item.subtype === "stud") n += p.qty;
  }
  return Math.max(n, 1);
}

const zero = (v: number) => Math.abs(v) <= TOL.len / 100;
const deg = (a: number) => (Math.round(a * 100) / 100).toFixed(2);

/** Two positions in a section are one place, within tol.len; none is the centre. */
function samePlace(q: readonly [number, number], p: Pos): boolean {
  return Math.hypot(q[0] - (p?.[0] ?? 0), q[1] - (p?.[1] ?? 0)) <= TOL.len;
}

/** A world point's offset in a placed bar's section, from its box centre. */
function sectionOffset(T: PlacedBar, X: V3): [number, number] {
  const [cx, cy] = boxCentre(T.box);
  const r = sub(X, T.A);
  return [dot(r, T.frame.x) - cx, dot(r, T.frame.y) - cy];
}

/** A hole's radius: half its diameter, or half its thread's nominal diameter. */
function holeRadius(f: Pick<HoleOp, "d" | "thread">): number | undefined {
  if (f.d !== undefined) return f.d / 2;
  const d = f.thread ? threadDiameter(f.thread) : undefined;
  return d === undefined ? undefined : d / 2;
}

/**
 * A hole's path through a bar from a point of an end face, along the unit axis `u`, for `length`
 * (Infinity: it never reaches the other end face): where it ends, in the section from its box
 * centre, and the side it fails on. Its axis `leaves` the section box by a side, at a distance
 * along the bar's axis from the entry; or, with the axis inside, its wall `breaks` out of a
 * side, by the greatest amount, from where it first does (`whole` when it does all along). In a
 * section across the bar the hole's wall stands r √(1 + (u·e / u·t)²) from its axis along each
 * of the section's axes e, the half-width of the ellipse the tilted cylinder cuts there, and the
 * axis's offset is linear along it, so its ends decide. Where the axis leaves, `wall` is where
 * the wall reached that side first.
 */
function holePath(
  T: PlacedBar,
  Q: V3,
  u: V3,
  length: number,
  r: number,
): {
  exit: [number, number];
  leaves?: { face: Face; at: number; wall: number };
  breaks?: { face: Face; by: number; from: number; whole: boolean };
} {
  const [x0, y0] = sectionOffset(T, Q);
  const ux = dot(u, T.frame.x);
  const uy = dot(u, T.frame.y);
  const ut = Math.abs(dot(u, T.frame.t));
  const hx = (T.box.x1 - T.box.x0) / 2;
  const hy = (T.box.y1 - T.box.y0) / 2;
  const rx = ut > 0 ? r * Math.sqrt(1 + (ux / ut) ** 2) : Infinity;
  const ry = ut > 0 ? r * Math.sqrt(1 + (uy / ut) ** 2) : Infinity;
  const sides: { face: Face; c0: number; dc: number; h: number; rr: number }[] = [
    { face: "+x", c0: x0, dc: ux, h: hx, rr: rx },
    { face: "-x", c0: -x0, dc: -ux, h: hx, rr: rx },
    { face: "+y", c0: y0, dc: uy, h: hy, rr: ry },
    { face: "-y", c0: -y0, dc: -uy, h: hy, rr: ry },
  ];
  // Where the axis first crosses a side: before the length, it leaves the box there.
  let leaves: { face: Face; w: number; wall: number } | undefined;
  for (const s of sides) {
    if (s.dc <= 0) continue;
    const w = (s.h - s.c0) / s.dc;
    // Its wall reaches the side first, as far before as the wall stands off the axis.
    const wall = Math.max(0, (s.h - s.rr - s.c0) / s.dc);
    if (w < length - TOL.len / 100 && (!leaves || w < leaves.w)) leaves = { face: s.face, w, wall };
  }
  const end = Number.isFinite(length) ? length : 0;
  const exit: [number, number] = [x0 + end * ux, y0 + end * uy];
  if (leaves) {
    return { exit, leaves: { face: leaves.face, at: leaves.w * ut, wall: leaves.wall * ut } };
  }
  let breaks: { face: Face; by: number; from: number; whole: boolean } | undefined;
  for (const s of sides) {
    const e0 = s.c0 + s.rr - s.h;
    const e1 = e0 + end * s.dc;
    const by = Math.max(e0, e1);
    if (by <= TOL.len || (breaks && by <= breaks.by)) continue;
    const whole = e0 > TOL.len && e1 > TOL.len;
    const from = e0 > TOL.len ? 0 : (-e0 / (e1 - e0)) * end * ut;
    breaks = { face: s.face, by, from, whole };
  }
  return { exit, ...(breaks ? { breaks } : {}) };
}

/** Whether a position lies inside a bar's end, its section box less `tol.len`. */
function onEnd(b: DerivedBar, p: readonly [number, number]): boolean {
  const box = b.placed.box;
  const hx = (box.x1 - box.x0) / 2;
  const hy = (box.y1 - box.y0) / 2;
  return Math.abs(p[0]) <= hx - TOL.len && Math.abs(p[1]) <= hy - TOL.len;
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
