import { compareIds } from "#core/ids.ts";
import { TOL } from "#core/tolerances.ts";
import type { V3 } from "../mesh/model.ts";
import type { CornerMarker } from "../viewer/scene.ts";
import type { Model } from "./model.ts";

/**
 * Corners (D-UX-10): a point where two or more bar ends meet, or where an end meets another bar's
 * line. Corners are not entities: they are derived here, in the browser, from the view model
 * (the bars' design points and `ends.*.by`, the butts' through members, the diagnostics), and the
 * selection may hold `corner:<key>`.
 *
 * - joined: every end there is claimed by a connection;
 * - open: some end there is not;
 * - failed: a connection there, or an end there, has an error (two providers, say).
 *
 * The rules are the check's (`unconnectedEnds`, src/core/check/check.ts), so a marker and the
 * `unconnected` warning agree: ends meet when their design points lie within the core's length
 * tolerance, and an unclaimed end still counts as joined when it is the through member of a butt
 * that an end here bears on (a through bar left with `through_end: "none"`, an end plate's bar
 * end). Where the check looks only at ends that meet, a corner also counts an end on another
 * bar's line (a T); a bar lying along that line (a rail on a profile) makes no corner with it.
 *
 * Pure. Owner: S3. The outline's Joints group (S2.5), the joint markers (S3.5) and the corner
 * inspector (S5.5) read it.
 */

export interface Corner extends CornerMarker {
  /** The bar ends that meet here (`b1.a`), in id order. */
  ends: string[];
  /** The bars that meet here, through bars included, in id order. */
  bars: string[];
  /** The connections that claim or name an end here, in id order. */
  connections: string[];
}

const PREFIX = "corner:";

/** The selection's ref for a corner. */
export function cornerRef(key: string): string {
  return `${PREFIX}${key}`;
}

/** The corner key a ref names, when it names a corner. */
export function cornerKey(ref: string): string | undefined {
  return ref.startsWith(PREFIX) ? ref.slice(PREFIX.length) : undefined;
}

/** A coordinate as a key writes it: to 0.01 mm, no trailing zeros, no negative zero. */
function coord(x: number): string {
  const r = Math.round(x * 100) / 100;
  return String(r === 0 ? 0 : r);
}

/** A corner's key: its point, `x,y,z` in millimetres. Stable while the bars there stay put. */
export function pointKey(p: V3): string {
  return `${coord(p[0])},${coord(p[1])},${coord(p[2])}`;
}

/** What an end's `by` says when no connection claims it (`alukit.derived/1`). */
const NOT_A_CONNECTION = new Set(["default", "free", "plane"]);

/** The derived butts, which the view model carries beyond `Model`'s typed fields. */
interface Butts {
  [id: string]: { ends: { end: string; on: string }[] };
}

/** A written connection, as far as corners read it. */
interface ConnSpec {
  ends?: unknown;
  through?: unknown;
}

interface End {
  ref: string;
  bar: string;
  p: V3;
  by: string;
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const dist = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Cells of this size (mm) index points and bars, so finding neighbours is not quadratic. */
const CELL = 250;
const cellOf = (x: number) => Math.floor(x / CELL);
const cellKey = (i: number, j: number, k: number) => `${i},${j},${k}`;

/** The bars whose box comes within the tolerance of a cell, by cell. */
function barGrid(m: Model): Map<string, string[]> {
  const grid = new Map<string, string[]>();
  for (const [id, b] of Object.entries(m.derived.bars)) {
    const lo = [0, 1, 2].map((i) => cellOf(Math.min(b.a[i] as number, b.b[i] as number) - TOL.len));
    const hi = [0, 1, 2].map((i) => cellOf(Math.max(b.a[i] as number, b.b[i] as number) + TOL.len));
    for (let i = lo[0] as number; i <= (hi[0] as number); i++)
      for (let j = lo[1] as number; j <= (hi[1] as number); j++)
        for (let k = lo[2] as number; k <= (hi[2] as number); k++) {
          const key = cellKey(i, j, k);
          const list = grid.get(key);
          if (list) list.push(id);
          else grid.set(key, [id]);
        }
  }
  return grid;
}

/**
 * Whether a point lies on a bar's design line strictly between its ends, and the bar crosses
 * the given directions (it is parallel to none of them... unless none is given).
 */
function onLine(m: Model, id: string, p: V3, across: readonly V3[]): boolean {
  const b = m.derived.bars[id];
  if (!b) return false;
  const d = sub(b.b, b.a);
  const len = Math.hypot(d[0], d[1], d[2]);
  if (len <= TOL.len) return false;
  const t: V3 = [d[0] / len, d[1] / len, d[2] / len];
  const s = dot(sub(p, b.a), t);
  if (s <= TOL.len || s >= len - TOL.len) return false;
  const foot: V3 = [b.a[0] + t[0] * s, b.a[1] + t[1] * s, b.a[2] + t[2] * s];
  if (dist(p, foot) > TOL.len) return false;
  // A bar lying along the end's own bar (a rail on a profile) is no joint: it must cross one.
  return across.some((u) => {
    const c: V3 = [u[1] * t[2] - u[2] * t[1], u[2] * t[0] - u[0] * t[2], u[0] * t[1] - u[1] * t[0]];
    return Math.hypot(c[0], c[1], c[2]) > 1e-6;
  });
}

/** A bar's unit direction, a to b. */
function dirOf(m: Model, id: string): V3 {
  const b = m.derived.bars[id];
  if (!b) return [0, 0, 0];
  const d = sub(b.b, b.a);
  const len = Math.hypot(d[0], d[1], d[2]) || 1;
  return [d[0] / len, d[1] / len, d[2] / len];
}

/** The member an end bears on, from a derived butt's `on`: a bar (`b5 -x`) or a bar end (`b31.b`). */
function member(on: string): string {
  return on.split(" ")[0] as string;
}

export function cornersOf(m: Model): Corner[] {
  const bars = m.derived?.bars ?? {};
  const ends: End[] = [];
  for (const [id, b] of Object.entries(bars)) {
    for (const e of ["a", "b"] as const) {
      ends.push({ ref: `${id}.${e}`, bar: id, p: e === "a" ? b.a : b.b, by: b.ends[e].by });
    }
  }

  // Ends that meet: grouped as the check groups them, each with the first end's neighbours.
  const byCell = new Map<string, number[]>();
  ends.forEach((e, i) => {
    const key = cellKey(cellOf(e.p[0]), cellOf(e.p[1]), cellOf(e.p[2]));
    const list = byCell.get(key);
    if (list) list.push(i);
    else byCell.set(key, [i]);
  });
  const near = (p: V3): number[] => {
    const out: number[] = [];
    const [ci, cj, ck] = [cellOf(p[0]), cellOf(p[1]), cellOf(p[2])];
    for (let i = ci - 1; i <= ci + 1; i++)
      for (let j = cj - 1; j <= cj + 1; j++)
        for (let k = ck - 1; k <= ck + 1; k++) {
          for (const x of byCell.get(cellKey(i, j, k)) ?? []) {
            if (dist(p, (ends[x] as End).p) <= TOL.len) out.push(x);
          }
        }
    return out.sort((a, b) => a - b);
  };
  const seen = new Set<number>();
  const groups: End[][] = [];
  ends.forEach((e, i) => {
    if (seen.has(i)) return;
    const group = near(e.p).filter((j) => !seen.has(j));
    for (const j of group) seen.add(j);
    groups.push(group.map((j) => ends[j] as End));
  });

  // What the butts say: the through member each butting end bears on, and the butts by end.
  const butts = ((m.derived as { butts?: Butts }).butts ?? {}) as Butts;
  const bearsOn = new Map<string, string>();
  const buttsAt = new Map<string, string[]>();
  for (const [id, b] of Object.entries(butts)) {
    for (const e of b.ends) {
      bearsOn.set(e.end, member(e.on));
      buttsAt.set(e.end, [...(buttsAt.get(e.end) ?? []), id]);
    }
  }
  // What the written connections name: their ends, and an end a butt bears on (`through: b31.b`).
  const written = (m.doc?.connections ?? {}) as Record<string, ConnSpec>;
  const namedBy = new Map<string, string[]>();
  for (const [id, c] of Object.entries(written)) {
    const named = [
      ...(Array.isArray(c.ends) ? c.ends.filter((x): x is string => typeof x === "string") : []),
      ...(typeof c.through === "string" && c.through.includes(".") ? [c.through] : []),
    ];
    for (const r of named) namedBy.set(r, [...(namedBy.get(r) ?? []), id]);
  }
  const errors = (m.check?.diagnostics ?? m.derived?.diagnostics ?? []).filter(
    (d) => d.severity === "error",
  );

  const grid = barGrid(m);
  const corners: Corner[] = [];
  for (const group of groups) {
    const p = (group[0] as End).p;
    const own = new Set(group.map((e) => e.bar));
    const cell = grid.get(cellKey(cellOf(p[0]), cellOf(p[1]), cellOf(p[2]))) ?? [];
    const across = [...own].map((id) => dirOf(m, id));
    const lines = cell.filter((id) => !own.has(id) && onLine(m, id, p, across));
    if (group.length < 2 && lines.length === 0) continue;

    const endRefs = group.map((e) => e.ref).sort(compareIds);
    const members = new Set(group.flatMap((e) => (bearsOn.has(e.ref) ? [bearsOn.get(e.ref)] : [])));
    const loose = group.filter(
      (e) => e.by === "default" && !members.has(e.bar) && !members.has(e.ref),
    );
    const conns = new Set<string>();
    for (const e of group) {
      if (!NOT_A_CONNECTION.has(e.by)) conns.add(e.by);
      for (const c of buttsAt.get(e.ref) ?? []) conns.add(c);
      for (const c of namedBy.get(e.ref) ?? []) conns.add(c);
    }
    const named = new Set([...endRefs, ...conns]);
    const failing = errors.filter(
      (d) =>
        (d.entity !== undefined && named.has(d.entity)) || (d.refs ?? []).some((r) => named.has(r)),
    );
    // An end with two providers names them only in its error: they are this corner's too.
    for (const d of failing) {
      if (d.entity !== undefined && endRefs.includes(d.entity)) {
        for (const r of d.refs ?? []) if (r in written || r.includes("@")) conns.add(r);
      }
    }
    const through = [...members]
      .filter((x): x is string => x !== undefined && !x.includes("."))
      .sort(compareIds)[0];
    corners.push({
      key: pointKey(p),
      at: p,
      state: failing.length > 0 ? "failed" : loose.length > 0 ? "open" : "joined",
      ...(through !== undefined ? { through } : {}),
      ends: endRefs,
      bars: [...new Set([...own, ...lines])].sort(compareIds),
      connections: [...conns].sort(compareIds),
    });
  }
  return corners.sort((a, b) => compareIds(a.ends[0] as string, b.ends[0] as string));
}
