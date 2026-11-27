import { num } from "#catalog/schema/common.ts";
import type { GrooveDim } from "#catalog/schema/groove.ts";
import type { ConnectorItem, FastenerItem } from "#catalog/schema/items.ts";
import { compareIds } from "../ids.ts";
import { type BarItemInfo, fullRef } from "../items.ts";
import type { Connection, Face, HoleFaces } from "../project/schema.ts";
import { clearanceHole, threadDiameter } from "../threads.ts";
import { TOL } from "../tolerances.ts";
import { add, addScaled, angleDeg, dot, neg, norm, scale, sub, type V3 } from "../vec.ts";
import type { Ctx } from "./context.ts";
import { ACCESS_MM, type Cover, type Covers } from "./cover.ts";
import type { DerivedBar, EndHoleOp, HoleOp } from "./derive.ts";
import {
  barFaceBearing,
  fitsGroove,
  type GenOut,
  holeCentre,
  lipBearing,
  SEAT_MIN,
  stockOptions,
} from "./fastenings.ts";
import { boxCentre, faceLocal, facePlane, grooveOffsets, onBar, resolveStation } from "./place.ts";
import type {
  ButtHead,
  Copy,
  HardwareUse,
  HeadSeat,
  PlacedBar,
  StackLayer,
  StockPiece,
} from "./types.ts";

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
 *   read in the butting bar's section x and y from its box centre (acceptance gap A8); a hole in
 *   the butting bar's side at a position is drilled over it, from the face nearest it (X7) that
 *   no other member covers (X9), or from the face the requirement or the mount's hole names;
 * - a connector in a mount's fastener set (a recipe placing bought connectors) sits at each hole
 *   of that mount: its own `requires` are made there, and its own head seated there (X7, X8);
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
  /**
   * A butt's stack (after the alternative frame's acceptance, X2): its bars, and at each butting
   * end where stage 3 laid it out, its layers from the face out.
   */
  stack?: { bars: DerivedBar[]; at: ReadonlyMap<string, readonly StackLayer[]> };
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

/**
 * A connector in the joint, as its machining and its own head are placed (after the round-3
 * acceptance, X7): the butt's own connector, whose positions are read as written in the butting
 * bar's section (v1 does not place a connector), or a connector in a mount's fastener set, at one
 * of that mount's holes, every position of it moved by the hole's x and y (one with none at the
 * hole).
 */
interface Placed {
  id: string;
  item: ConnectorItem;
  /** The hole it sits at, in the butting bar's section from its box centre; none: the own connector. */
  at?: readonly [number, number];
  /** The face that hole names for a hole in the butting bar's side (X9). */
  face?: Face;
  /** How its requirements are named in messages: `connector`, or `connector mounts[0] <id>`. */
  label: string;
}

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
  stacks: ReadonlyMap<string, ReadonlyMap<string, readonly StackLayer[]>> = new Map(),
  covers?: Covers,
): void {
  const joints = new Map<string, Joint>();
  for (const id of [...ctx.conns.keys()].sort(compareIds)) {
    const ent = ctx.conns.get(id);
    if (!ent) continue;
    const roles = rolesOf(ctx, id, ent.spec, ent.copy, bars);
    if (!roles) continue;
    // A butt's stack (X2), at each butting end where stage 3 laid it out.
    const st = stacks.get(id);
    if (st && ent.spec.type === "butt" && ent.spec.stack) {
      roles.stack = {
        bars: ent.spec.stack.flatMap((s) => {
          const b = bars.get(s);
          return b ? [b] : [];
        }),
        at: st,
      };
    }
    joints.set(id, { spec: ent.spec, ...(ent.copy ? { copy: ent.copy } : {}), roles });
  }
  const held = heldBy(ctx, joints);
  const unchecked: Unchecked = new Map();
  for (const [id, j] of joints) {
    if (j.roles.body) out.hardware.push(j.roles.body);
    if (!j.roles.connector) {
      // Faces named for side holes no connector makes (F12).
      const named = "hole_faces" in j.spec ? j.spec.hole_faces : undefined;
      if (!j.copy && named && Object.keys(named).length > 0) {
        ctx.d.error(
          "connection",
          id,
          `hole_faces: ${id} has no connector, so no hole in a butting bar's side to name a face for`,
          { field: "hole_faces" },
        );
      }
      continue;
    }
    new ConnectorGen(ctx, id, j.spec, j.roles, !j.copy, out, unchecked, covers, held.get(id)).run();
  }
  // A screw whose head gives no size the check reads, or a bar whose groove's own geometry is not
  // read: one info, naming its connections (F2b, F9).
  for (const [item, u] of [...unchecked].sort(([a], [b]) => compareIds(a, b))) {
    ctx.d.info(
      "fit",
      u.conns[0] as string,
      u.groove
        ? `${u.groove}'s grooves do not give ${u.what} from its own drawing${u.why ? ` (${u.why})` : ""}, so a head under its lips is not seated or checked: ${u.conns.join(", ")}`
        : `${item} gives ${u.what}, so its head's seat in a butt is not checked: ${u.conns.join(", ")}`,
      u.conns.length > 1 ? { refs: u.conns.slice(1) } : {},
    );
  }
}

/**
 * Per screw a butt connector seats but cannot check: what it does not give, and where (F2b); per
 * bar item whose groove's own dimensions a head under its lips needs and its drawing does not give
 * (`groove`, keyed `groove|<item>`; F9), which, and the section's word on why.
 */
type Unchecked = Map<string, { what: string; conns: string[]; groove?: string; why?: string }>;

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
  private readonly unchecked: Unchecked;
  /** What lies on the butting bars' faces, for the faces side holes go in from (X9). */
  private readonly covers: Covers | undefined;
  private sleeves = 0;
  /**
   * The holes made in the through bar's side, by butting end and position (`madeKey`), each with
   * the line it is drilled on: a point of the face and the axis into the bar (F7: a far-face head
   * is seated round a hole F2 made, on its axis).
   */
  private readonly made = new Map<string, { Q: V3; u: V3 }>();
  /**
   * The positions of the holes made in each butting bar's side, by butting end (`b2.a`), a hole
   * with no position at [0, 0]: what a face named on the connection may name (F12).
   */
  private readonly sideAt = new Map<string, (readonly [number, number])[]>();
  /** The bar that makes the joint one made after assembly, or null; undefined until asked (F11). */
  private lateBy: string | null | undefined;

  constructor(
    ctx: Ctx,
    id: string,
    spec: Connection,
    roles: Roles,
    report: boolean,
    out: GenOut,
    unchecked: Unchecked,
    covers: Covers | undefined,
    held?: Held,
  ) {
    this.ctx = ctx;
    this.id = id;
    this.spec = spec;
    this.roles = roles;
    this.report = report;
    this.out = out;
    this.unchecked = unchecked;
    this.covers = covers;
    this.held = held;
  }

  private error(code: string, message: string, extra: { field?: string; refs?: string[] } = {}) {
    if (this.report) this.ctx.d.error(code, this.id, message, extra);
  }

  private warn(code: string, message: string, extra: { field?: string; refs?: string[] } = {}) {
    if (this.report) this.ctx.d.warn(code, this.id, message, extra);
  }

  /**
   * The bar that makes this joint one made after assembly (F11), if any: a bar it joins (its
   * through bar, a butting bar, a bar of its stack) placed after the frame's joints are made, so
   * the joint is made when that bar arrives. Every member stands then, those placed after assembly
   * too: v1 does not order them among themselves, so it does not guess that one comes later still.
   */
  private madeLate(): string | undefined {
    if (this.lateBy === undefined) {
      const bars = [...joinedBars(this.roles), ...(this.roles.stack?.bars ?? [])];
      this.lateBy = bars.find((b) => this.covers?.later(b.placed.id))?.placed.id ?? null;
    }
    return this.lateBy ?? undefined;
  }

  /** The faces the connection names for its side holes (F12), if any. */
  private holeFaces(): HoleFaces | undefined {
    return "hole_faces" in this.spec ? this.spec.hole_faces : undefined;
  }

  /**
   * The face the connection names for the hole in a butting bar's side at `ref` (`b2.a`) and
   * position `p` (none: the section's centre), over the connector's own (F12): the end's one face,
   * or the entry at that position.
   */
  private holeFace(ref: string, p: Pos): Named | undefined {
    const v = this.holeFaces()?.[ref];
    if (v === undefined) return undefined;
    const by = "the connection's hole_faces";
    if (typeof v === "string") return { face: v, by };
    const e = v.find((x) => samePlace(x.at_mm, p));
    return e ? { face: e.face, by } : undefined;
  }

  /**
   * What the connection's `hole_faces` names and no hole takes (F12), each a `connection` error and
   * not used: an end that is not one of the connection's, an end where the connector drills no hole
   * in the butting bar's side, a position where no such hole stands. A face named for a hole that
   * is there was judged with the hole.
   */
  private checkHoleFaces(connector: string): void {
    const named = this.holeFaces();
    if (!named || !("ends" in this.spec)) return;
    const ends: readonly string[] = this.spec.ends;
    const derived = new Set(this.roles.butting.map((b) => `${b.bar.placed.id}.${b.end}`));
    for (const ref of Object.keys(named).sort(compareIds)) {
      const v = named[ref] as NonNullable<HoleFaces[string]>;
      const bar = endOf(ref).bar;
      const field = "hole_faces";
      if (!ends.includes(ref)) {
        this.error(
          "connection",
          `hole_faces: ${ref} is not one of ${this.id}'s ends, so the face named for it is not used`,
          { field, refs: [bar] },
        );
        continue;
      }
      if (!derived.has(ref)) continue; // the bar did not derive, and says why
      const at = this.sideAt.get(ref) ?? [];
      if (at.length === 0) {
        this.error(
          "connection",
          `hole_faces: ${connector} drills no hole in ${bar}'s side at ${ref}, so the face named for it is not used`,
          { field, refs: [bar] },
        );
        continue;
      }
      if (typeof v === "string") continue;
      const places = at.filter((p, i) => at.findIndex((q) => samePlace(q, p)) === i);
      for (const e of v) {
        if (at.some((q) => samePlace(e.at_mm, q))) continue;
        this.error(
          "connection",
          `hole_faces: no hole in ${bar}'s side at ${ref} stands at ${posText(e.at_mm)}, so the face named for it is not used; its holes there stand at ${places.map(posText).join(", ")}`,
          { field, refs: [bar] },
        );
      }
    }
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
    this.fit(found.id, item, home, fits, sets);
    if (this.spec.type === "face") return;
    this.mounts(sets, home);
    const own: Placed = { id: found.id, item, label: "connector" };
    this.requires(own);
    const nested = this.nested(item, home, sets);
    for (const c of nested) this.requires(c);
    this.checkHoleFaces(found.id);
    if (item.splice) this.splice(item, home);
    // A headed connector counted by qty (X8): a butt's connector is counted, not placed, so every
    // one of them would stand at the end's centre, one head in one place; its machining is made
    // once per end, as any connector's is. Placing them is a recipe's work.
    const perEnd = this.spec.type === "butt" ? this.roles.units / this.spec.ends.length : 1;
    const crowded = ownHead(item) && perEnd > 1;
    if (crowded) {
      this.error(
        "connection",
        `${found.id} x ${perEnd} at each butting end: a connector counted by qty is not placed, so all ${perEnd} would stand at the end's centre, one head in one place and its machining made once; to put one in each core, hold them in a recipe's fastener set at its mount's holes (§3.4). Its head is not seated`,
        { field: "qty" },
      );
    }
    this.seats(item, home, sets, [...(crowded ? [] : [own]), ...nested]);
  }

  /**
   * The connectors a mount's fastener set holds (a recipe placing bought connectors; after the
   * round-3 acceptance, X7): each sits at every hole of its mount, so its own machining is made and
   * its own head seated there, its positions moved by the hole's x and y. The mount's plane must be
   * the joint's, square to the connector's z (as `at_holes` needs), for its holes to be places in
   * the butting bar's section; a mount with no holes puts it at the origin. Its own fastener sets
   * are not brought (a v1 limit), so a connector in a set that has some is a `connection` error
   * rather than parts left off the order. Each is billed with the set, as before.
   */
  private nested(item: ConnectorItem, home: string, sets: readonly ChosenSet[]): Placed[] {
    const out: Placed[] = [];
    for (const s of sets) {
      const m = item.mounts?.[s.mount];
      const label = `connector mounts[${s.mount}]`;
      for (const e of s.entries) {
        if ("inside" in e) continue;
        const c = connectorItem(this.ctx, fullRef(e.item, home));
        if (!c) continue;
        if ((c.item.mounts ?? []).some((x) => Object.keys(x.fasteners ?? {}).length > 0)) {
          this.error(
            "connection",
            `${label}: ${c.id} in its fastener set has fastener sets of its own, which v1 does not bring for a connector in a set: write its parts into the outer connector's set`,
            { field: "connector" },
          );
          continue;
        }
        if ((c.item.requires ?? []).length === 0 && !ownHead(c.item)) continue;
        const [nx = 0, ny = 0, nz = 0] = m?.plane.normal ?? [0, 0, -1];
        if (nx !== 0 || ny !== 0 || nz === 0) {
          this.error(
            "connection",
            `${label}: ${c.id} in its fastener set sits at each of its holes, but the mount's plane is not square to the connector's z, so its holes are no place in the joint's plane: ${c.id}'s machining and head are not placed`,
            { field: "connector" },
          );
          continue;
        }
        const holes = m?.holes && m.holes.length > 0 ? m.holes : [{ at_mm: [0, 0, 0] }];
        for (const h of holes) {
          out.push({
            id: c.id,
            item: c.item,
            at: [h.at_mm[0], h.at_mm[1]] as const,
            ...("face" in h && h.face ? { face: h.face } : {}),
            label: `${label} ${c.id}`,
          });
        }
      }
    }
    return out;
  }

  /**
   * The heads a butt's connector seats (F2b, X8): a screw of the chosen sets into each tap the
   * connector makes in the butting end (`screwSeats`), and the own head of the connector and of
   * each connector in its sets, at its place (`ownSeats`). A butt through a bar's end is not
   * checked in v1: an end face's material is its section, which no seat reads yet.
   */
  private seats(
    item: ConnectorItem,
    home: string,
    sets: readonly ChosenSet[],
    placed: readonly Placed[],
  ): void {
    const through = this.roles.through;
    if (this.spec.type !== "butt" || !through || through.end) return;
    const heads = [
      ...this.screwSeats(item, home, sets, through.bar),
      ...this.ownSeats(placed, through.bar),
    ];
    if (heads.length > 0) this.out.heads.set(this.id, heads);
  }

  /**
   * Where each screw into the butting end seats its head (after the alternative frame's
   * acceptance, F2b), for a butt through a bar's side. The screw is the chosen sets' first screw
   * or bolt; one goes into each tap the connector makes in each butting end (`buttingTaps`).
   *
   * - **On the far face**, where the connector drills a `through-hole` in the through bar at the
   *   tap's place (call 40's pairing): the screw comes through the bar from its far side, and its
   *   head (or the sets' first washer under it) bears on that face round the hole, as a face
   *   fastener's does (§4.5): below half a `fit` warning, on nothing a `fit` error.
   * - **Under the lips** of the near face's groove, where the connector drills no hole there and a
   *   groove of the face the end bears on lies under the joint: the head sits in the groove's
   *   chamber, on the lips' underside, or on a T-nut from the sets (a `t-nut`, drilled out to
   *   pass the screw) that bears on them. The shank must pass the opening, the head fit the
   *   chamber's width, and the lip, the T-nut seat's body (`k_mm`) and the head's height
   *   (`k_mm`) the groove's depth: each a `fit` error. With no T-nut, the head's seat on the lips
   *   is the face's material at the joint, as the opening leaves it.
   * - **Nowhere**, with neither: a `fit` error, since the screw has no way through the bar.
   *
   * A screw that gives no size the check needs is not checked: an info. A far-face head is seated
   * only where F2 made the hole, round it on its axis (after the round-3 acceptance, F7): where F2
   * refuses the hole (a screw off square to a side, a position off the face), the connection
   * already has F2's error and no screw passes the bar there.
   */
  private screwSeats(
    item: ConnectorItem,
    home: string,
    sets: readonly ChosenSet[],
    T: DerivedBar,
  ): ButtHead[] {
    const taps = buttingTaps(item);
    if (taps.length === 0) return [];
    const parts = setParts(this.ctx, sets, home);
    const screw = parts.find((p) => p.item.subtype === "screw" || p.item.subtype === "bolt");
    if (!screw) return [];
    const washer = parts.find((p) => p.item.subtype === "washer");
    const tnut = parts.find((p) => p.item.subtype === "t-nut");
    const holes = throughHoles(item);
    const heads: ButtHead[] = [];
    for (const b of this.roles.butting) {
      const near = this.nearFace(T, b);
      if (!near) continue; // jointHole has said the end meets the bar at an angle
      const end = `${b.bar.placed.id}.${b.end}`;
      for (const p of taps) {
        const at = p[0] === 0 && p[1] === 0 ? undefined : p;
        const where = `into ${end}'s tap${at ? ` at ${posText(at)}` : ""}`;
        const hole = holes.find((r) => requirementPositions(item, r).some((q) => samePlace(p, q)));
        let seat: HeadSeat | undefined;
        if (hole) {
          const line = this.made.get(madeKey(end, p));
          if (!line) continue; // F2 made no hole here, and said why
          seat = this.farSeat(T, near, line, screw, washer, hole, where);
        } else {
          seat = this.slotSeat(
            T,
            near,
            this.jointPoint(b.bar, b.end, at),
            screwHead(screw, where),
            {
              tnut,
            },
          );
        }
        if (seat) heads.push({ end, ...(at ? { at } : {}), ...seat });
      }
    }
    return heads;
  }

  /**
   * A connector's own head (after the round-3 acceptance, X8): a connector whose `dims` give a head
   * diameter (a quick connector's pin, in the butting bar's core with its head in the through
   * bar's groove) seats it as a screw's head is seated, at its place: the butt's own connector at
   * its origin, a connector in a set at its hole. Where the connector requires a `through-hole` in
   * the through bar at that place, the pin comes through the bar and its head bears on the far face
   * round the hole F2 made; else it sits under the lips of the near face's groove, where its shank
   * (`d_mm`) must pass the opening, the lip and its height (`k_mm`) the groove's depth, and the head,
   * domed where it gives `rf_mm`, the chamber at every depth it reaches.
   */
  private ownSeats(placed: readonly Placed[], T: DerivedBar): ButtHead[] {
    const heads: ButtHead[] = [];
    for (const b of this.roles.butting) {
      const near = this.nearFace(T, b);
      if (!near) continue;
      const end = `${b.bar.placed.id}.${b.end}`;
      for (const c of placed) {
        if (!ownHead(c.item)) continue;
        const p: readonly [number, number] = c.at ?? [0, 0];
        const at = zero(p[0]) && zero(p[1]) ? undefined : p;
        const where = `at ${end}${at ? ` ${posText(at)}` : ""}`;
        const head = pinHead(c, where);
        const hole = throughHoles(c.item).find((r) =>
          placedPositions(c.item, r, c.at).some((q) => samePlace(p, q)),
        );
        let seat: HeadSeat | undefined;
        if (hole) {
          const line = this.made.get(madeKey(end, p));
          if (!line) continue;
          seat = this.headOnFarFace(T, near, line, head, hole, where);
        } else {
          seat = this.slotSeat(T, near, this.jointPoint(b.bar, b.end, at), head, {});
        }
        if (seat) heads.push({ end, ...(at ? { at } : {}), ...seat });
      }
    }
    return heads;
  }

  /** The face of the through bar a butting end bears on, square to its normal; none at an angle. */
  private nearFace(T: DerivedBar, b: { bar: DerivedBar; end: "a" | "b" }): Face | undefined {
    const e = b.bar.ends[b.end];
    return (["+x", "-x", "+y", "-y"] as const).find(
      (f) => angleDeg(facePlane(T.placed, f).n, neg(e.normal)) <= TOL.ang,
    );
  }

  /** A screw's head (or the washer under it) on the through bar's far face, round the hole F2 made. */
  private farSeat(
    T: DerivedBar,
    near: Face,
    line: { Q: V3; u: V3 },
    screw: SetPart,
    washer: SetPart | undefined,
    hole: NonNullable<ConnectorItem["requires"]>[number],
    where: string,
  ): HeadSeat | undefined {
    if (!washer) return this.headOnFarFace(T, near, line, screwHead(screw, where), hole, where);
    const out = dimOf(washer.item, "d2_mm");
    if (out === undefined) {
      this.notChecked(washer.id, "no outside diameter (d2_mm)");
      return undefined;
    }
    const d = hole.d_mm === undefined ? 0 : num(hole.d_mm);
    const din = Math.max(d, dimOf(washer.item, "d1_mm") ?? 0);
    return this.onFarFace(
      T,
      near,
      line,
      washer.id,
      out,
      din,
      `the washer ${washer.id} under the head of ${screw.id} ${where}`,
    );
  }

  /** A head on the through bar's far face, round the hole F2 made, its annulus from the hole out. */
  private headOnFarFace(
    T: DerivedBar,
    near: Face,
    line: { Q: V3; u: V3 },
    head: Head,
    hole: NonNullable<ConnectorItem["requires"]>[number],
    where: string,
  ): HeadSeat | undefined {
    if (head.bearing === undefined) {
      this.notChecked(head.id, BEARING);
      return undefined;
    }
    const d = hole.d_mm === undefined ? 0 : num(hole.d_mm);
    return this.onFarFace(
      T,
      near,
      line,
      head.id,
      head.bearing,
      d,
      `the head of ${head.id} ${where}`,
    );
  }

  /**
   * A seat on the through bar's far face, where the hole's axis (through `line.Q`, along `line.u`
   * into the bar) leaves it: F2 drills a side hole square to its face, so this is the hole's own
   * far end (F7).
   */
  private onFarFace(
    T: DerivedBar,
    near: Face,
    line: { Q: V3; u: V3 },
    item: string,
    out: number,
    din: number,
    what: string,
  ): HeadSeat {
    const far = OPPOSITE[near];
    const pl = facePlane(T.placed, far);
    const { Q, u } = line;
    const X = addScaled(Q, u, dot(sub(pl.p, Q), pl.n) / dot(u, pl.n));
    const seat: HeadSeat = {
      side: "head",
      item,
      d_in: din,
      d_out: out,
      on: `${T.placed.id} ${far}`,
      bearing: barFaceBearing(T, far, X, out, din),
    };
    this.reportSeat(seat, what, `${T.placed.id}'s face ${far}`, T.placed.id);
    return seat;
  }

  /**
   * A head in the near face's groove, under its lips, on them or on a T-nut seat. The head is a
   * cylinder of its bearing diameter, its top domed where its dims give `rf_mm` (X8): the lip, a
   * T-nut seat's body and the head's height must fit the groove's depth, and the head the
   * chamber's width at every depth it reaches (`headRoom`).
   */
  private slotSeat(
    T: DerivedBar,
    face: Face,
    Q: V3,
    head: Head,
    seatOn: { tnut?: SetPart | undefined },
  ): (HeadSeat & Pick<ButtHead, "room">) | undefined {
    const { tnut } = seatOn;
    const tid = T.placed.id;
    const g = grooveAt(T, face, Q);
    if (!g) {
      this.error(
        "fit",
        `${head.subject} has no way through ${tid}: the connector drills no hole in it there, and no groove of its face ${face} lies under the joint for the head`,
        { field: "connector", refs: [tid] },
      );
      return undefined;
    }
    const lips = `under the lips of ${tid}'s face ${face}`;
    const { groove, off } = g;
    // A groove whose own dimensions the section's drawing does not give (F9): no judgement under
    // its lips borrows its groove type's value for them.
    const unread = unreadUnderLips(groove, tnut !== undefined);
    if (unread.length > 0) {
      this.grooveNotRead(T.placed.item.id, unread, groove.why);
      return undefined;
    }
    if (head.shank !== undefined && groove.opening_mm !== undefined) {
      const reach = Math.abs(off) + head.shank.d / 2;
      if (reach > groove.opening_mm / 2 + TOL.len) {
        this.error(
          "fit",
          `${head.subject} sits ${mm(off)} off the centre of the groove of ${tid}'s face ${face}, so its ${head.shank.text} shank does not pass the ${mm(groove.opening_mm)} opening`,
          { field: "connector", refs: [tid] },
        );
        return undefined;
      }
    }
    const { bearing: out, k: kHead } = head;
    if (out === undefined || kHead === undefined) {
      this.notChecked(head.id, out === undefined ? BEARING : "no head height (k_mm)");
      return undefined;
    }
    if (tnut && !fitsGroove(tnut.id, tnut.item, T.placed.item, groove.type)) {
      this.error(
        "fit",
        `${tnut.id}, the T-nut seat under the head of ${head.id}, does not fit ${tid} (${T.placed.item.system ?? "no system"}${groove.type ? `, groove ${groove.type}` : ""})`,
        { field: "connector", refs: [tid] },
      );
    }
    const kNut = tnut ? dimOf(tnut.item, "k_mm") : 0;
    const { lip_mm: lip, depth_mm: depth } = groove;
    let room: ButtHead["room"];
    if (kNut === undefined) {
      this.notChecked((tnut as SetPart).id, "no body height (k_mm)");
    } else if (lip !== undefined && depth !== undefined) {
      const reach = lip + kNut + kHead;
      const seated = tnut ? ` on the T-nut seat ${tnut.id} (k ${mm(kNut)})` : "";
      if (reach > depth + TOL.len) {
        this.error(
          "fit",
          `${head.what} (k ${mm(kHead)})${seated} ${lips} (${mm(lip)}) reaches ${mm(reach)} into the groove, ${mm(reach - depth)} past its depth (${mm(depth)})`,
          { field: "connector", refs: [tid] },
        );
        return undefined;
      }
      const r = headRoom(groove, lip + kNut, kHead, out / 2, head.rf);
      if (r.side !== undefined && r.side < -TOL.len / 2) {
        const chamber = mm(r.chamber as number);
        this.error(
          "fit",
          head.rf === undefined
            ? `${head.what}, Ø${mm(out)}${seated}, is wider than the chamber ${lips} where it reaches, ${mm(r.at)} deep (${chamber})`
            : `${head.what}, Ø${mm(out)} domed to rf ${mm(head.rf)}${seated}, is wider than the chamber ${lips} ${mm(r.at)} deep: ${mm(r.head)} across there, the chamber ${chamber}`,
          { field: "connector", refs: [tid] },
        );
        return undefined;
      }
      room = { depth: r.depth, ...(r.side !== undefined ? { side: r.side } : {}) };
    }
    if (tnut) return undefined; // the T-nut is the head's seat, and a groove part bears on the lips
    // The head bears on the lips' underside, as the section's outline gives it (F8).
    const seat: HeadSeat & Pick<ButtHead, "room"> = {
      side: "head",
      item: head.id,
      d_in: head.dIn,
      d_out: out,
      on: `${tid} ${face} (under its lips)`,
      bearing:
        lip === undefined
          ? barFaceBearing(T, face, Q, out, head.dIn)
          : lipBearing(T, face, lip, Q, out, head.dIn),
      ...(room ? { room } : {}),
    };
    this.reportSeat(seat, head.what, `the lips of ${tid}'s face ${face}`, tid);
    return seat;
  }

  /** A seat on nothing is a `fit` error; on less than SEAT_MIN of its annulus, a `fit` warning. */
  private reportSeat(seat: HeadSeat, what: string, on: string, ref: string): void {
    if (!this.report || seat.bearing >= SEAT_MIN) return;
    if (seat.bearing <= 1e-9) {
      this.error(
        "fit",
        `${what}, Ø${mm(seat.d_out)}, bears on nothing of ${on}: its seat lies wholly over an opening or off the face`,
        { refs: [ref] },
      );
      return;
    }
    this.ctx.d.warn(
      "fit",
      this.id,
      `${what}, Ø${mm(seat.d_out)}, bears on ${(100 * seat.bearing).toFixed(1)} % of its seat on ${on}, less than ${(100 * SEAT_MIN).toFixed(0)} %`,
      { refs: [ref] },
    );
  }

  private notChecked(item: string, what: string): void {
    if (!this.report) return;
    const u = this.unchecked.get(item) ?? { what, conns: [] };
    if (!u.conns.includes(this.id)) u.conns.push(this.id);
    this.unchecked.set(item, u);
  }

  /** A bar whose groove's own dimensions, needed under its lips, its drawing does not give (F9). */
  private grooveNotRead(item: string, dims: readonly GrooveDim[], why: string | undefined): void {
    if (!this.report) return;
    const key = `groove|${item}`;
    const what = dims.length === 1 ? dims[0] : `${dims.slice(0, -1).join(", ")} and ${dims.at(-1)}`;
    const u = this.unchecked.get(key) ?? {
      what: what as string,
      conns: [],
      groove: item,
      ...(why ? { why } : {}),
    };
    if (!u.conns.includes(this.id)) u.conns.push(this.id);
    this.unchecked.set(key, u);
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
   * A `held_by` that fails has its own error, so the through bar is not judged again. A solid
   * through bar is also held by a screw through it into the butting end (`screwThrough`; after
   * the alternative frame's acceptance, X3).
   */
  private fit(
    itemId: string,
    item: ConnectorItem,
    home: string,
    fits: readonly string[],
    sets: readonly ChosenSet[],
  ): void {
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
      const screw = isThrough ? screwThrough(this.ctx, item, home, sets, b) : undefined;
      if (screw?.holds) continue; // held by a screw through a drilled hole in it
      const what = sys ? `a ${sys}` : `${b.placed.item.id}, of no system`;
      const how = isThrough
        ? `, and no fastener set of the connector sets a sleeve in it${screw ? `, nor does a screw through it hold it: ${screw.why}` : ""}`
        : "";
      this.error("fit", `${itemId} fits ${fits.join(", ")}; ${b.placed.id} is ${what}${how}`, {
        field: "connector",
        refs: [b.placed.id],
      });
    }
    // A stack's bars (X2) are clamped between the through bar and the butting end, by a screw
    // that passes them; their system does not hold them. Judged, as the through bar is, only when
    // some fastener set can apply.
    if (!anyFitted) return;
    const T = through?.placed.id ?? "the through body";
    for (const S of this.roles.stack?.bars ?? []) {
      const screw = screwThrough(this.ctx, item, home, sets, S, T);
      if (screw?.holds) continue;
      const why = screw
        ? screw.why
        : `it requires no through-hole in ${T}, so no screw from ${T}'s far side passes the stack`;
      this.error(
        "fit",
        `${itemId}: the stack's ${S.placed.id} is held only by a screw through it into the butting end, and none holds it: ${why}`,
        { field: "stack", refs: [S.placed.id] },
      );
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
   * A placed connector's requirements (§3.4): its own, at its positions as written, or a connector
   * in a set's, moved to its hole (X7). Each makes its ops once per butting end.
   */
  private requires(placed: Placed): void {
    const { roles, id } = this;
    const { item } = placed;
    for (const [ri, req] of (item.requires ?? []).entries()) {
      const field = `${placed.label} requires[${ri}]`;
      const targets = req.on === "each" ? (["butting", "through"] as const) : [req.on];
      const d = req.d_mm === undefined ? undefined : num(req.d_mm);
      const depth = req.depth_mm === undefined ? undefined : num(req.depth_mm);
      const fromEnd = req.from_end_mm === undefined ? 0 : num(req.from_end_mm);
      const access = req.access_mm === undefined ? ACCESS_MM : num(req.access_mm);
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
      const at = placedPositions(item, req, placed.at);
      const named = namedFaces(item, req, placed, at.length);
      const positioned = at[0] !== undefined;
      const hole = {
        ...(d !== undefined ? { d } : {}),
        ...(req.thread && req.op !== "end-tap" ? { thread: req.thread } : {}),
        ...(depth !== undefined ? { depth } : {}),
      };
      // A hole in the through bar at a place where the connector also taps the butting end is
      // the clearance for a screw into that tap: it follows the screw (after acceptance run 4).
      const screws = buttingTaps(item, placed.at);
      const intoTap = (p: Pos) => screws.some((q) => samePlace(q, p));
      for (const target of targets) {
        if (target === "butting") {
          for (const { bar, end } of roles.butting) {
            if (req.op === "end-tap") {
              this.endTaps(bar, end, at, req.thread as string, depth, field);
              continue;
            }
            // A hole in the butting bar's side: the face the connection names for it at this
            // end comes first (F12), then the catalog's.
            const ref = `${bar.placed.id}.${end}`;
            const here = this.sideAt.get(ref) ?? [];
            here.push(...at.map((p) => p ?? ([0, 0] as const)));
            this.sideAt.set(ref, here);
            const names = at.map((p, i) => this.holeFace(ref, p) ?? named[i]);
            if (!positioned) this.centreHole(bar, end, names[0], fromEnd, hole, access, field);
            else this.sideHoles(bar, end, at, names, fromEnd, hole, access, field);
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
        // A stack (X2) is drilled for what passes along the joint: a through-hole's screw, or a
        // screw into an end tap. v1 does not know where an access hole's tool or a counterbore's
        // head goes through a stack.
        const stacked = roles.stack !== undefined && roles.stack.at.size > 0;
        if (stacked && (req.op === "access-hole" || req.op === "counterbore")) {
          this.error(
            "connection",
            `${field}: a ${req.op} in the through bar under a stack: v1 drills a stack only for a through-hole or an end tap, which pass along the joint`,
            { field: "stack" },
          );
          continue;
        }
        const clear = d ?? (req.thread ? clearanceHole(req.thread) : undefined);
        const what = (p: Pos) =>
          `the ${req.op === "end-tap" ? `tap ${req.thread}` : d !== undefined ? `Ø${mm(d)} hole` : `tap ${req.thread}`} in ${through.bar.placed.id}${p ? ` at ${posText(p)}` : ""}`;
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
          const T = through.bar.placed;
          const inward = through.end === "a" ? T.frame.t : neg(T.frame.t);
          if (!positioned) {
            through.bar.ops.push({
              op: "end-tap",
              from: through.end,
              thread: req.thread as string,
              ...(depth !== undefined ? { depth } : {}),
              by: id,
            });
            // At the end face's centre, along the axis: the screw into it passes the stack.
            const e = through.bar.ends[through.end];
            const { C, t } = centreLine(through.bar);
            const Q = addScaled(C, t, dot(sub(e.point, C), e.normal) / dot(t, e.normal));
            for (const b of roles.butting)
              this.stackHoles(b, Q, inward, clear, what(undefined), field);
            continue;
          }
          for (const b of roles.butting) {
            for (const p of at) {
              const Q = this.jointPoint(b.bar, b.end, p);
              const off = this.endPlace(through.bar, through.end, b.bar, b.end, Q, p);
              if (!off) continue;
              through.bar.ops.push({
                op: "end-tap",
                from: through.end,
                ...(off.centre ? {} : { off: off.off }),
                thread: req.thread as string,
                ...(depth !== undefined ? { depth } : {}),
                by: id,
              });
              this.stackHoles(b, Q, inward, clear, what(p), field);
            }
          }
          continue;
        }
        if (roles.base) {
          if (positioned) {
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
              const r = this.endHole(through.bar, through.end, b.bar, b.end, hole, p, {
                screw: intoTap(p),
                field,
              });
              if (!r) continue;
              through.bar.ops.push(r.op);
              this.stackHoles(b, r.Q, r.u, clear, what(p), field);
              continue;
            }
            const r = this.jointHole(through.bar, b.bar, b.end, hole, p, off, intoTap(p));
            if (r && "tilted" in r) tilted.push({ at: p, angle: r.tilted, face: r.face });
            else if (r) {
              through.bar.ops.push(r);
              // Square to the face the end bears on, through the joint point: the stack's axis.
              const Q = this.jointPoint(b.bar, b.end, p);
              this.stackHoles(b, Q, b.bar.ends[b.end].normal, clear, what(p), field);
              // The hole is drilled square to its face: a head on the far face sits round its
              // far end (F7).
              const u = neg(facePlane(through.bar.placed, r.face).n);
              this.made.set(madeKey(`${b.bar.placed.id}.${b.end}`, p ?? [0, 0]), { Q, u });
            }
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
   * Holes in a butting bar's side at positions (after the round-3 acceptance, X7): a quick
   * connector's cross hole over the core its pin is in, `from_end_mm` in from the end. Each is
   * drilled square to a face of the bar's box and stands over the position: its offset across that
   * face is the position's coordinate along the face. A blind hole must reach the position, or the
   * part it holds cannot meet the core: one that does not is a `connection` error, and so is a
   * position off the end's section box; neither is made.
   *
   * The face (after the round-4 acceptance, X9): the one the connection (F12), the mount's hole or
   * the requirement names; else, of the faces from which the hole reaches the position, the
   * nearest whose mouth no other member covers (`Covers`), ties within tol.len going to the first
   * of +y, -y, +x, -x. A tool reaches the hole through its mouth when the joint is made (a quick
   * connector's bush is turned through it), so a hole in a covered face is a `connection` error
   * naming what covers it, whoever chose the face: a named face, or the nearest face that reaches
   * when none is clear.
   *
   * A member placed after assembly (F11) does not stand there when a joint made before it is
   * tightened: of the faces no member covers at all, the nearest wins; with none, the nearest that
   * only such members cover, a `connection` warning naming them (the joint cannot be re-tightened
   * once they are in place); and a named face that only they cover is that warning, not the error.
   */
  private sideHoles(
    bar: DerivedBar,
    end: "a" | "b",
    at: readonly Pos[],
    named: readonly (Named | undefined)[],
    fromEnd: number,
    hole: Pick<HoleOp, "d" | "thread" | "depth">,
    access: number,
    field: string,
  ): void {
    const s = end === "a" ? bar.lengths.sa + fromEnd : bar.lengths.sb - fromEnd;
    const box = bar.placed.box;
    const off: string[] = [];
    const what = hole.d !== undefined ? `Ø${mm(hole.d)} hole` : `tap ${hole.thread}`;
    const ref = `${bar.placed.id}.${end}`;
    const reaches = (f: { dist: number }) =>
      hole.depth === undefined || hole.depth >= f.dist - TOL.len;
    at.forEach((p, i) => {
      if (!p) return;
      if (!onEnd(bar, p)) {
        off.push(posText(p));
        return;
      }
      const sides = facesByDistance(box, p);
      const op = (face: Face): HoleOp => {
        const across = face === "+y" || face === "-y" ? p[0] : p[1];
        return {
          op: "hole",
          face,
          from: "a",
          at: s,
          ...(zero(across) ? {} : { across }),
          ...hole,
          by: this.id,
        };
      };
      const covered = this.mouthsOf((face) => op(face), bar, hole, access);
      const name = named[i];
      const id = bar.placed.id;
      const here = `the ${what} ${mm(fromEnd)} from ${ref} over its position ${posText(p)}`;
      const short = (f: { face: Face; dist: number }, how: string) =>
        this.error(
          "connection",
          `${field}: ${here} is drilled from ${id}'s face ${f.face}, ${how}, ${mm(f.dist)} from it, and is ${mm(hole.depth as number)} deep: it does not reach the position, so it is not made`,
          { field: "connector", refs: [id] },
        );
      if (name) {
        const f = sides.find((x) => x.face === name.face) as { face: Face; dist: number };
        if (!reaches(f)) {
          short(f, `as ${name.by} names it`);
          return;
        }
        const m = covered(f.face);
        const told = `${here} goes in from ${id}'s face ${f.face}, as ${name.by} names it`;
        if (m.block.length > 0) {
          // The other faces that reach the position, clear when the joint is made.
          const free = sides
            .filter((x) => x.face !== f.face && reaches(x))
            .map((x) => ({ face: x.face, ...covered(x.face) }))
            .filter((x) => x.block.length === 0);
          this.error(
            "connection",
            `${field}: ${told}, where ${coverText(m.block, access)}: its mouth cannot be reached; ${freeText(id, free)}${this.lateText(m.block)}`,
            { field: "connector", refs: [id, ...m.block.map((c) => c.id)] },
          );
        } else if (m.later.length > 0) {
          this.warn(
            "connection",
            `${field}: ${told}, where ${coverText(m.later, access)}: its mouth is clear when the joint is made, but ${laterText(m.later)}`,
            { field: "connector", refs: [id, ...m.later.map((c) => c.id)] },
          );
        }
        bar.ops.push(op(f.face));
        return;
      }
      const reaching = sides.filter(reaches);
      const nearest = reaching[0];
      if (!nearest) {
        short(sides[0] as { face: Face; dist: number }, "the nearest");
        return;
      }
      const choice = this.choose(
        reaching.map((f) => f.face),
        covered,
      );
      if (choice?.later.length) {
        this.warn(
          "connection",
          `${field}: ${here} is drilled from ${id}'s face ${choice.face}, the nearest whose mouth is clear when the joint is made, where ${coverText(choice.later, access)}: ${laterText(choice.later)}`,
          { field: "connector", refs: [id, ...choice.later.map((c) => c.id)] },
        );
      }
      if (!choice) {
        const all = reaching.map(
          (f) => `${f.face}, where ${coverText(covered(f.face).block, access)}`,
        );
        const block = reaching.flatMap((f) => covered(f.face).block);
        const by = [...new Set(block.map((c) => c.id))].sort(compareIds);
        this.error(
          "connection",
          `${field}: no face of ${id} from which ${here} reaches it is clear (${all.join("; ")}): it is drilled from ${nearest.face}, the nearest, and its mouth cannot be reached${this.lateText(block)}`,
          { field: "connector", refs: [id, ...by] },
        );
      }
      bar.ops.push(op((choice ?? nearest).face));
    });
    if (off.length > 0) {
      this.error(
        "connection",
        `${field}: ${off.length === 1 ? "a position falls" : `${off.length} positions fall`} off ${bar.placed.id}.${end}'s end (${mm(box.x1 - box.x0)} x ${mm(box.y1 - box.y0)}): ${off.join(", ")}`,
        { field: "connector", refs: [bar.placed.id] },
      );
    }
  }

  /**
   * A hole in a butting bar's side with no position (§3.4): on a face's centre line, `from_end_mm`
   * in from the end, heading for the section's centre. On the face the connection (F12) or the
   * requirement names (X9); else on +y, as draft 2.3 put it, while its mouth is clear. Where
   * another member covers +y's mouth, on the nearest face whose mouth is clear among those that
   * take it at least as far toward the centre (as near it as +y, or near enough for its depth to
   * reach it), ties going to the first of +y, -y, +x, -x. A hole in a covered face is a
   * `connection` error naming what covers it: a named face, or +y when no face is clear.
   *
   * A member placed after assembly (F11) is weighed as for a positioned hole (`sideHoles`): a face
   * no member covers first, in the same order; then one only such members cover, a warning.
   */
  private centreHole(
    bar: DerivedBar,
    end: "a" | "b",
    name: Named | undefined,
    fromEnd: number,
    hole: Pick<HoleOp, "d" | "thread" | "depth">,
    access: number,
    field: string,
  ): void {
    const s = end === "a" ? bar.lengths.sa + fromEnd : bar.lengths.sb - fromEnd;
    const op = (face: Face): HoleOp => ({
      op: "hole",
      face,
      from: "a",
      at: s,
      ...hole,
      by: this.id,
    });
    const covered = this.mouthsOf(op, bar, hole, access);
    const what = hole.d !== undefined ? `Ø${mm(hole.d)} hole` : `tap ${hole.thread}`;
    const id = bar.placed.id;
    const here = `the ${what} ${mm(fromEnd)} from ${id}.${end}`;
    const refs = (cover: readonly Cover[]) => [id, ...cover.map((c) => c.id)];
    if (name) {
      const m = covered(name.face);
      const told = `${here} goes in from ${id}'s face ${name.face} on its centre line, as ${name.by} names it`;
      if (m.block.length > 0) {
        this.error(
          "connection",
          `${field}: ${told}, where ${coverText(m.block, access)}: its mouth cannot be reached${this.lateText(m.block)}`,
          { field: "connector", refs: refs(m.block) },
        );
      } else if (m.later.length > 0) {
        this.warn(
          "connection",
          `${field}: ${told}, where ${coverText(m.later, access)}: its mouth is clear when the joint is made, but ${laterText(m.later)}`,
          { field: "connector", refs: refs(m.later) },
        );
      }
      bar.ops.push(op(name.face));
      return;
    }
    // +y first, as draft 2.3 put it; then the faces that take the hole as far toward the centre,
    // computed only when +y is not clear.
    const toward = (): Face[] => {
      const sides = facesByDistance(bar.placed.box, [0, 0]);
      const y = (sides.find((f) => f.face === "+y") as { dist: number }).dist;
      return sides
        .filter(
          (f) =>
            f.face !== "+y" &&
            (f.dist <= y + TOL.len || (hole.depth !== undefined && hole.depth >= f.dist - TOL.len)),
        )
        .map((f) => f.face);
    };
    const first = covered("+y");
    const order: Face[] =
      first.block.length === 0 && first.later.length === 0 ? ["+y"] : ["+y", ...toward()];
    const choice = this.choose(order, covered);
    if (choice) {
      if (choice.later.length > 0) {
        this.warn(
          "connection",
          `${field}: ${here} is drilled from ${id}'s face ${choice.face} on its centre line, the nearest whose mouth is clear when the joint is made, where ${coverText(choice.later, access)}: ${laterText(choice.later)}`,
          { field: "connector", refs: refs(choice.later) },
        );
      }
      bar.ops.push(op(choice.face));
      return;
    }
    const all = order.map((f) => `${f}, where ${coverText(covered(f).block, access)}`);
    const block = order.flatMap((f) => covered(f).block);
    const by = [...new Set(block.map((c) => c.id))].sort(compareIds);
    this.error(
      "connection",
      `${field}: no face of ${id} that ${here} could go in from on its centre line is clear (${all.join("; ")}): it is drilled from +y, where a hole with no position goes, and its mouth cannot be reached${this.lateText(block)}`,
      { field: "connector", refs: [id, ...by] },
    );
    bar.ops.push(op("+y"));
  }

  /**
   * The members in front of a side hole's mouth from each face, within `access` of the face (X9),
   * once per face: those that stand there when the joint is made (`block`), and those placed after
   * assembly over a joint made before them (`later`, F11). None when nothing is known of the other
   * members.
   */
  private mouthsOf(
    opOf: (face: Face) => HoleOp,
    bar: DerivedBar,
    hole: Pick<HoleOp, "d" | "thread" | "depth">,
    access: number,
  ): (face: Face) => Mouth {
    const seen = new Map<Face, Mouth>();
    return (face) => {
      let m = seen.get(face);
      if (m) return m;
      const d = hole.d ?? (hole.thread ? threadDiameter(hole.thread) : undefined);
      const op = opOf(face);
      const all =
        this.covers && d !== undefined
          ? this.covers.mouth(bar, op.face, holeCentre(bar, op), d, access)
          : [];
      m = this.madeLate()
        ? { block: all, later: [] }
        : { block: all.filter((c) => !c.later), later: all.filter((c) => c.later) };
      seen.set(face, m);
      return m;
    };
  }

  /**
   * Of `faces` in order, the first no member covers at all; else the first only members placed
   * after assembly cover (F11); else none.
   */
  private choose(
    faces: readonly Face[],
    covered: (face: Face) => Mouth,
  ): (Mouth & { face: Face }) | undefined {
    let soon: (Mouth & { face: Face }) | undefined;
    for (const face of faces) {
      const m = covered(face);
      if (m.block.length > 0) continue;
      if (m.later.length === 0) return { face, ...m };
      soon ??= { face, ...m };
    }
    return soon;
  }

  /**
   * Why members placed after assembly stand over a joint (F11): it is made after assembly too, so
   * they are there when it is. Empty when none of `block` is such a member.
   */
  private lateText(block: readonly Cover[]): string {
    const by = this.madeLate();
    return by && block.some((c) => c.later)
      ? `; the joint is made after assembly, since ${by} is placed after it`
      : "";
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
    return addScaled(addScaled(C, bar.frame.t, lambda), e.normal, this.lift(butting, end));
  }

  /** A butting end's stand-off from the through bar's face: the spacer, or its stack's depth (X2). */
  private lift(butting: DerivedBar, end: "a" | "b"): number {
    const layers = this.stackAt(butting, end);
    return this.roles.spacer + (layers[layers.length - 1]?.to ?? 0);
  }

  private stackAt(butting: DerivedBar, end: "a" | "b"): readonly StackLayer[] {
    return this.roles.stack?.at.get(`${butting.placed.id}.${end}`) ?? [];
  }

  /**
   * The holes in a butt's stack (after the alternative frame's acceptance, X2) for one hole the
   * connector makes in the through bar: each stack bar between the face and the butting end is
   * drilled through with `d` where the hole's axis (through `Q` on the through bar's face, along
   * `u` into it) crosses it, as the screw passes it. A hole in a bar's side is drilled square to its
   * face, so an axis off square to a stack bar's face by more than tol.ang has no hole there, and
   * one that meets the bar's face off it (across it, or past its cut ends) has no place: each a
   * `connection` error naming that bar.
   */
  private stackHoles(
    b: { bar: DerivedBar; end: "a" | "b" },
    Q: V3,
    u: V3,
    d: number | undefined,
    what: string,
    field: string,
  ): void {
    const layers = this.stackAt(b.bar, b.end);
    if (layers.length === 0) return;
    if (d === undefined) {
      this.error("connection", `${field}: ${what} gives no clearance to drill the stack with`, {
        field: "connector",
      });
      return;
    }
    for (const layer of layers) {
      const S = this.roles.stack?.bars.find((x) => x.placed.id === layer.bar);
      if (!S) continue;
      const P = S.placed;
      const face = layer.outer as Face;
      const pl = facePlane(P, face);
      const tilt = angleDeg(u, neg(pl.n));
      if (tilt > TOL.ang) {
        this.error(
          "connection",
          `${field}: ${what} runs ${deg(tilt)}° off square to the stack's ${P.id}, face ${face}; a hole in a bar's side is drilled square to its face, so it cannot be made there`,
          { field: "connector", refs: [P.id] },
        );
        continue;
      }
      const X = addScaled(Q, u, dot(sub(pl.p, Q), pl.n) / dot(u, pl.n));
      const s = dot(sub(X, P.A), P.frame.t);
      const fl = faceLocal(P.box, face);
      const v = face === "+x" || face === "-x" ? P.frame.y : P.frame.x;
      const across = dot(sub(X, onBar(P, s, fl.at[0], fl.at[1])), v);
      const half =
        face === "+x" || face === "-x" ? (P.box.y1 - P.box.y0) / 2 : (P.box.x1 - P.box.x0) / 2;
      if (
        Math.abs(across) > half - TOL.len ||
        s < S.lengths.sa + TOL.len ||
        s > S.lengths.sb - TOL.len
      ) {
        this.error(
          "connection",
          `${field}: ${what} meets the stack's ${P.id} off its face ${face}: no place for its hole`,
          { field: "connector", refs: [P.id] },
        );
        continue;
      }
      S.ops.push({
        op: "hole",
        face,
        from: "a",
        at: s,
        ...(Math.abs(across) > TOL.len / 100 ? { across } : {}),
        d,
        by: this.id,
      });
    }
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
  ): { op: EndHoleOp; Q: V3; u: V3 } | undefined {
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
    const op: EndHoleOp = {
      op: "end-hole",
      from: throughEnd,
      ...(place.centre ? {} : { off: place.off }),
      ...(along
        ? {}
        : { exit: [zero(exit[0]) ? 0 : exit[0], zero(exit[1]) ? 0 : exit[1]] as const, angle }),
      ...fields,
      by: this.id,
    };
    return { op, Q, u };
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

/**
 * A requirement's positions (acceptance gap A8): its `at_mm`, or the x and y of the holes of the
 * mount `at_holes` names, in the butting bar's section from its box centre. A requirement with
 * none makes one op at the centre or at the joint point, as before: `[undefined]`.
 */
function requirementPositions(
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
 * A placed connector's positions for a requirement (after the round-3 acceptance, X7): as written
 * for the butt's own connector; for one at a hole of a mount (`at`), each moved by the hole's x
 * and y, and one with none at the hole itself.
 */
function placedPositions(
  item: ConnectorItem,
  req: NonNullable<ConnectorItem["requires"]>[number],
  at: readonly [number, number] | undefined,
): Pos[] {
  const own = requirementPositions(item, req);
  if (!at) return own;
  return own.map((p) => [at[0] + (p?.[0] ?? 0), at[1] + (p?.[1] ?? 0)] as const);
}

/**
 * Where the connector taps the butting end: every end tap it asks of the butting bar (`on`
 * butting or each), at its positions, the centre where it gives none (moved to its hole when it
 * sits in a mount's set, `at`). A hole the connector makes in the through bar at one of these
 * places is the clearance for a screw into that tap (after acceptance run 4, call 40).
 */
function buttingTaps(
  item: ConnectorItem,
  at?: readonly [number, number],
): (readonly [number, number])[] {
  const out: (readonly [number, number])[] = [];
  for (const req of item.requires ?? []) {
    if (req.op !== "end-tap" || (req.on !== "butting" && req.on !== "each")) continue;
    for (const p of placedPositions(item, req, at)) out.push(p ?? [0, 0]);
  }
  return out;
}

/** The holes a connector requires through the through bar (`on` through or each). */
function throughHoles(item: ConnectorItem): NonNullable<ConnectorItem["requires"]> {
  return (item.requires ?? []).filter(
    (r) => r.op === "through-hole" && (r.on === "through" || r.on === "each"),
  );
}

/** A hole made in the through bar's side, by the butting end and its position (to 0.01 mm). */
function madeKey(end: string, p: readonly [number, number]): string {
  const q = (x: number) => (Math.round(x * 100) / 100 + 0).toFixed(2);
  return `${end}|${q(p[0])},${q(p[1])}`;
}

/**
 * The faces of a section's box by their distance from a position in it (from the box's centre),
 * nearest first: ties within tol.len keep the order +y, -y, +x, -x (X7, X9).
 */
function facesByDistance(
  box: PlacedBar["box"],
  p: readonly [number, number],
): { face: Face; dist: number }[] {
  const hx = (box.x1 - box.x0) / 2;
  const hy = (box.y1 - box.y0) / 2;
  const sides: { face: Face; dist: number }[] = [
    { face: "+y", dist: hy - p[1] },
    { face: "-y", dist: hy + p[1] },
    { face: "+x", dist: hx - p[0] },
    { face: "-x", dist: hx + p[0] },
  ];
  const out: { face: Face; dist: number }[] = [];
  const left = [...sides];
  while (left.length > 0) {
    let k = 0;
    for (let i = 1; i < left.length; i++) {
      if ((left[i] as { dist: number }).dist < (left[k] as { dist: number }).dist - TOL.len) k = i;
    }
    out.push(...left.splice(k, 1));
  }
  return out;
}

/** A face named for a hole in the butting bar's side, and who names it, for messages (X9). */
interface Named {
  face: Face;
  by: string;
}

/**
 * The face named for each position of a requirement's holes in the butting bar's side (X9): the
 * mount's hole the position is (a requirement `at_holes`, or the hole a connector in a mount's set
 * sits at), else the requirement's own `face`.
 */
function namedFaces(
  item: ConnectorItem,
  req: NonNullable<ConnectorItem["requires"]>[number],
  placed: Placed,
  count: number,
): (Named | undefined)[] {
  const own = req.face ? { face: req.face, by: "the requirement" } : undefined;
  const holes = req.at_holes !== undefined ? (item.mounts?.[req.at_holes]?.holes ?? []) : [];
  return Array.from({ length: count }, (_, i) => {
    if (placed.face) return { face: placed.face, by: "the mount's hole it sits at" };
    const h = holes[i];
    if (h?.face) return { face: h.face, by: `mounts[${req.at_holes}] holes[${i}]` };
    return own;
  });
}

/**
 * The members in front of a side hole's mouth from one face (X9): those that stand there when the
 * joint is made, and those placed after assembly that stand there only afterwards (F11).
 */
interface Mouth {
  block: Cover[];
  later: Cover[];
}

/**
 * Who covers a mouth, for messages: "b3 stands in front of 100.0 % of its mouth" (X9); a member
 * placed after assembly says so (F11).
 */
function coverText(cover: readonly Cover[], access: number): string {
  const one = (c: Cover) =>
    `${c.id}${c.later ? ", placed after assembly," : ""} stands in front of ${(100 * c.share).toFixed(1)} %`;
  return `${cover.map(one).join(", ")} of its mouth, within ${mm(access)} of the face`;
}

/** Ids for a sentence: "p1", "p1 and p2", "p1, p2 and p3". */
function idsText(ids: readonly string[]): string {
  return ids.length <= 1
    ? (ids[0] ?? "")
    : `${ids.slice(0, -1).join(", ")} and ${ids[ids.length - 1] as string}`;
}

/** What members placed after assembly over a joint made before them cost it (F11). */
function laterText(later: readonly Cover[]): string {
  const ids = later.map((c) => c.id);
  return `it cannot be re-tightened once ${idsText(ids)} ${ids.length === 1 ? "is" : "are"} in place`;
}

/**
 * The other faces from which a side hole reaches its position clear when the joint is made, for
 * the error on a covered named face (X9): those no member covers, then those only members placed
 * after assembly cover, until they are in place (F11).
 */
function freeText(bar: string, free: readonly (Mouth & { face: Face })[]): string {
  const faces = (fs: readonly { face: Face }[]) =>
    `${bar}'s ${fs.length === 1 ? "face" : "faces"} ${fs.map((f) => f.face).join(", ")} ${fs.length === 1 ? "reaches" : "reach"} the position clear`;
  const clear = free.filter((f) => f.later.length === 0);
  const soon = free.filter((f) => f.later.length > 0);
  const later = [...new Set(soon.flatMap((f) => f.later.map((c) => c.id)))].sort(compareIds);
  const parts = [
    ...(clear.length > 0 ? [faces(clear)] : []),
    ...(soon.length > 0
      ? [
          `${faces(soon)} when the joint is made, until ${idsText(later)} ${later.length === 1 ? "is" : "are"} in place`,
        ]
      : []),
  ];
  return parts.length > 0
    ? parts.join("; ")
    : `no face of ${bar} that reaches the position is clear`;
}

/**
 * A solid bar held by a screw through it (after the alternative frame's acceptance, X3): a fourth
 * way to hold a butt's through bar, beside its system, its bore and `held_by`. It holds when
 *
 * 1. the connector requires a `through-hole` in it (`on` through or each) with a `d_mm` and no
 *    `depth_mm`, so the hole runs through the bar and the head bears on its far side;
 * 2. at a position where it also taps the butting end (`buttingTaps`, call 40), so the hole is the
 *    clearance for a screw into that tap;
 * 3. a chosen fastener set holds a headed fastener (a `screw` or a `bolt`) whose thread's
 *    nominal diameter is less than that hole's, so its shank passes the hole and its head does not;
 * 4. and the bar is not hollow: a screw through an RHS's or a tube's two walls would crush them,
 *    which is what a sleeve in its bore is for (A1).
 *
 * A bar of a butt's stack (X2) is held the same way: the same screw passes it, clamping it between
 * the through bar and the butting end, so 1–3 are read of the through bar's hole (`through`) and 4
 * of the stack bar. `why` says which condition fails, for the `fit` error; undefined when the
 * connector requires no hole in the through bar at all, so the A1 error stands as it was.
 */
function screwThrough(
  ctx: Ctx,
  item: ConnectorItem,
  home: string,
  sets: readonly ChosenSet[],
  bar: DerivedBar,
  through: string = bar.placed.id,
): { holds: true } | { holds: false; why: string } | undefined {
  const id = through;
  const holes = (item.requires ?? []).filter(
    (r) => r.op === "through-hole" && (r.on === "through" || r.on === "each"),
  );
  if (holes.length === 0) return undefined;
  if (isHollow(bar)) {
    return {
      holds: false,
      why: `${bar.placed.id} is hollow, and a screw through both its walls needs a sleeve in its bore`,
    };
  }
  const taps = buttingTaps(item);
  const headed: { id: string; d: number }[] = [];
  for (const s of sets) {
    for (const e of s.entries) {
      if ("inside" in e) continue;
      const found = ctx.items.item(fullRef(e.item, home));
      if (!found.ok || found.item.kind !== "fastener") continue;
      if (found.item.subtype !== "screw" && found.item.subtype !== "bolt") continue;
      const d = found.item.thread ? threadDiameter(found.item.thread) : undefined;
      if (d !== undefined) headed.push({ id: found.id, d });
    }
  }
  const reasons: string[] = [];
  for (const r of holes) {
    if (r.depth_mm !== undefined || r.d_mm === undefined) {
      reasons.push(
        `its hole in ${id} is ${r.d_mm === undefined ? "tapped" : "blind"}, so no head bears on ${id}'s far side`,
      );
      continue;
    }
    const d = num(r.d_mm);
    const at = requirementPositions(item, r);
    if (!at.some((p) => taps.some((q) => samePlace(q, p)))) {
      reasons.push(
        `its hole in ${id} is at no place where it taps the butting end, so no screw into the butting end passes it`,
      );
      continue;
    }
    if (!headed.some((f) => f.d < d - TOL.len)) {
      reasons.push(
        headed.length === 0
          ? `its fastener sets hold no screw or bolt to pass its Ø${mm(d)} hole in ${id}`
          : `no screw or bolt of its fastener sets passes its Ø${mm(d)} hole in ${id} (${headed.map((f) => `${f.id}, Ø${mm(f.d)}`).join("; ")})`,
      );
      continue;
    }
    return { holds: true };
  }
  return { holds: false, why: [...new Set(reasons)].join("; ") };
}

const isHollow = (b: DerivedBar) => b.placed.item.shape === "rhs" || b.placed.item.shape === "tube";

/** A fastener of a chosen set, resolved. */
interface SetPart {
  id: string;
  item: FastenerItem;
}

/** The fasteners of the chosen sets, in set and entry order; sleeves and other kinds left out. */
function setParts(ctx: Ctx, sets: readonly ChosenSet[], home: string): SetPart[] {
  const out: SetPart[] = [];
  for (const s of sets) {
    for (const e of s.entries) {
      if ("inside" in e) continue;
      const found = ctx.items.item(fullRef(e.item, home));
      if (found.ok && found.item.kind === "fastener") out.push({ id: found.id, item: found.item });
    }
  }
  return out;
}

const dimOf = (it: { dims?: FastenerItem["dims"] }, k: string): number | undefined => {
  const v = it.dims?.[k];
  return v === undefined ? undefined : num(v);
};

/** A head's bearing diameter, as F2 reads it (§4.5): `dw_mm`, else `dk_mm`, else `s_mm`. */
const bearingOf = (it: FastenerItem) =>
  dimOf(it, "dw_mm") ?? dimOf(it, "dk_mm") ?? dimOf(it, "s_mm");
const BEARING = "no bearing diameter (dw_mm, dk_mm or s_mm)";

/**
 * Whether a connector has a head of its own (after the round-3 acceptance, X8): its `dims` give a
 * head diameter, `dk_mm` or `dw_mm`, as a quick connector's pin does.
 */
const ownHead = (c: ConnectorItem) =>
  dimOf(c, "dk_mm") !== undefined || dimOf(c, "dw_mm") !== undefined;

/**
 * A head F2b seats (F2b, X8): a screw's or bolt's of the chosen sets, or a connector's own. How
 * messages name it (`subject` for its shank and its way through, `what` for its head), the shank
 * that must pass a groove's opening, its bearing diameter, its height and the radius of a domed
 * top, and the inside of its annulus under the lips.
 */
interface Head {
  id: string;
  subject: string;
  what: string;
  shank?: { d: number; text: string };
  bearing?: number;
  k?: number;
  rf?: number;
  dIn: number;
}

/** A screw's head into a tap: its thread is its shank; under the lips its annulus starts at the thread's ISO 273 clearance. */
function screwHead(screw: SetPart, where: string): Head {
  const t = screw.item.thread;
  const d = t ? threadDiameter(t) : undefined;
  const k = dimOf(screw.item, "k_mm");
  const rf = dimOf(screw.item, "rf_mm");
  const bearing = bearingOf(screw.item);
  return {
    id: screw.id,
    subject: `the screw ${screw.id} ${where}`,
    what: `the head of ${screw.id} ${where}`,
    ...(d !== undefined && t ? { shank: { d, text: t } } : {}),
    ...(bearing !== undefined ? { bearing } : {}),
    ...(k !== undefined ? { k } : {}),
    ...(rf !== undefined ? { rf } : {}),
    dIn: d !== undefined ? (clearanceHole(t as string) ?? d) : 0,
  };
}

/** A connector's own head (X8): its shank is `d_mm`, its bearing diameter `dw_mm` or `dk_mm`. */
function pinHead(c: Placed, where: string): Head {
  const d = dimOf(c.item, "d_mm");
  const k = dimOf(c.item, "k_mm");
  const rf = dimOf(c.item, "rf_mm");
  const bearing = dimOf(c.item, "dw_mm") ?? dimOf(c.item, "dk_mm");
  return {
    id: c.id,
    subject: `${c.id} ${where}`,
    what: `the head of ${c.id} ${where}`,
    ...(d !== undefined ? { shank: { d, text: `Ø${mm(d)}` } } : {}),
    ...(bearing !== undefined ? { bearing } : {}),
    ...(k !== undefined ? { k } : {}),
    ...(rf !== undefined ? { rf } : {}),
    dIn: d ?? 0,
  };
}

/** The room a head leaves in a groove's chamber (`headRoom`). */
export interface HeadRoom {
  /** The groove's depth less where the head's top reaches; undefined when the depth is not known. */
  depth?: number;
  /** The least room between the head and the chamber's wall, per side; undefined with no undercut. */
  side?: number;
  /** The depth below the face where that least room is. */
  at: number;
  /** The head's width there. */
  head: number;
  /** The chamber's width there. */
  chamber?: number;
}

/**
 * The room a head leaves under a groove's lips (after the round-3 acceptance, X8). The head bears
 * on its flat underside `z0` below the face (the lip, plus a T-nut seat's body), is `2R` across up
 * to its rim and `k` high at its centre; with `rf` its top is a spherical cap of that radius (a
 * dome, as a pan or a quick connector's head; ISO 7045's letter), which rises
 * h = rf − √(rf² − R²) over the rim, so the rim stands k − h; with none, the head is a cylinder.
 * The chamber is `chamberWidth`: its undercut, narrowing straight from `taper_from_mm`.
 *
 * The least room is the least, over the head's height t, of w(z0 + t)/2 − s(t), the half-width of
 * the chamber less the head's. Along the rim s = R and w does not widen with depth, so the rim's
 * top edge is the least there. Over the cap s(t) = √(rf² − (t − c0)²), c0 = k − rf, which is
 * concave: where w is constant the room grows with t, and where w narrows at a slope (a per side
 * per depth) the room is convex in t, least where s′ = −a, at t − c0 = a·rf / √(1 + a²). So the
 * candidates are the rim's top edge, where the taper starts, that tangent point, and the apex; the
 * least of them is exact.
 */
export function headRoom(
  g: BarItemInfo["grooves"][number],
  z0: number,
  k: number,
  R: number,
  rf?: number,
): HeadRoom {
  const dome = rf !== undefined && rf >= R ? rf - Math.sqrt(rf * rf - R * R) : 0;
  const rim = Math.max(0, k - dome);
  const c0 = k - (rf ?? 0);
  const half = (t: number) =>
    t <= rim || rf === undefined || dome === 0
      ? R
      : Math.min(R, Math.sqrt(Math.max(0, rf * rf - (t - c0) ** 2)));
  const ts = [dome === 0 ? k : rim];
  if (dome > 0 && rf !== undefined) {
    ts.push(k);
    const t1 = g.taper_from_mm === undefined ? undefined : g.taper_from_mm - z0;
    if (t1 !== undefined && t1 > rim && t1 < k) ts.push(t1);
    if (
      g.taper_from_mm !== undefined &&
      g.bottom_mm !== undefined &&
      g.depth_mm !== undefined &&
      g.undercut_mm !== undefined &&
      g.depth_mm > g.taper_from_mm
    ) {
      const a = (g.undercut_mm - g.bottom_mm) / 2 / (g.depth_mm - g.taper_from_mm);
      const t = c0 + (a * rf) / Math.sqrt(1 + a * a);
      if (t > Math.max(rim, g.taper_from_mm - z0) && t < k) ts.push(t);
    }
  }
  const depth = g.depth_mm === undefined ? undefined : g.depth_mm - (z0 + k);
  let best: HeadRoom | undefined;
  for (const t of ts) {
    const w = chamberWidth(g, z0 + t);
    const room = w === undefined ? undefined : w / 2 - half(t);
    const here: HeadRoom = {
      ...(depth !== undefined ? { depth } : {}),
      ...(room !== undefined ? { side: room } : {}),
      at: z0 + t,
      head: 2 * half(t),
      ...(w !== undefined ? { chamber: w } : {}),
    };
    if (!best || (room !== undefined && (best.side === undefined || room < best.side))) best = here;
  }
  return best as HeadRoom;
}

const OPPOSITE: Record<Face, Face> = { "+x": "-x", "-x": "+x", "+y": "-y", "-y": "+y" };

/**
 * The dimensions a head under a groove's lips is judged on that the section's own drawing does
 * not give (F9): the opening its shank passes, the lip, depth and chamber its room is read
 * against, and, for a head that bears on the lips itself (not on a T-nut seat), the hook and the
 * face wall beside it that its bearing is read on (F8). In the groove type's order.
 */
function unreadUnderLips(g: BarItemInfo["grooves"][number], onTnut: boolean): GrooveDim[] {
  const unread = g.unread ?? [];
  if (unread.length === 0) return [];
  const need: GrooveDim[] = ["opening_mm", "lip_mm", "depth_mm", "undercut_mm"];
  if (g.taper_from_mm !== undefined) need.push("taper_from_mm", "bottom_mm");
  if (!onTnut) need.push("hook_mm", "wall_mm");
  return need.filter((d) => unread.includes(d));
}

/**
 * A groove's chamber width `z` below its face (§3.3): its undercut, narrowing straight from
 * `taper_from_mm` to `bottom_mm` at its depth where it tapers; undefined when not known.
 */
export function chamberWidth(g: BarItemInfo["grooves"][number], z: number): number | undefined {
  if (g.undercut_mm === undefined) return undefined;
  if (g.taper_from_mm === undefined || g.bottom_mm === undefined || g.depth_mm === undefined) {
    return g.undercut_mm;
  }
  if (z <= g.taper_from_mm) return g.undercut_mm;
  const f = Math.min(1, (z - g.taper_from_mm) / (g.depth_mm - g.taper_from_mm));
  return g.undercut_mm - (g.undercut_mm - g.bottom_mm) * f;
}

/**
 * The groove of a bar's bounding face whose opening a point of the face lies in, and the point's
 * offset across the face from its centre line; undefined when none does (a groove whose opening
 * is not known is taken as tol.len wide).
 */
function grooveAt(
  bar: DerivedBar,
  face: Face,
  X: V3,
): { groove: BarItemInfo["grooves"][number]; off: number } | undefined {
  return grooveOffsets(bar.placed, face, X).find(
    ({ groove, off }) => Math.abs(off) <= (groove.opening_mm ?? 2 * TOL.len) / 2,
  );
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
