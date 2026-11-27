import { drivenEnd, type End, endHold } from "#core/commands/hold.ts";
import { offsetBy } from "#core/commands/numbers.ts";
import type { V3 } from "../../mesh/model.ts";
import type { Model } from "../model.ts";
import { parseTyped, type Written } from "./typed.ts";

/**
 * A bar's ends as the end handles and the length label move them (docs/ux/drag-ends-decisions.md):
 * the axis an end moves along, what holds it (core `hold.ts`, the rule `moveEnd` applies), where
 * along the axis it may stop, and which end the label's typed length moves. Pure, from the drawn
 * model, so the unit tests read it. Owner: S5.
 *
 * Lengths along the axis are measured from the other end's design point `Q`, outward: an end's
 * design point is at its design length, and its face (where it is cut, on the design line) at
 * `face`. A drag moves the face; the design point follows it by the end's own offset.
 */

/** Two view-model points as close as this are the same point, mm: the view model rounds to 0.01. */
const NEAR = 0.02;

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const at = (q: V3, u: V3, s: number): V3 => [q[0] + u[0] * s, q[1] + u[1] * s, q[2] + u[2] * s];
const dist = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

export interface EndAxis {
  bar: string;
  end: End;
  /** The other end's design point. */
  Q: V3;
  /** Outward along the bar at this end, unit. */
  u: V3;
  /** The design length, this end's face along `u` from `Q`, and the cut length now. */
  len: number;
  face: number;
  cut: number;
  /** Where this end's face sits from its design point once it is free: its `extend_mm`. */
  extend: number;
}

export type EndState =
  | { kind: "free"; corner?: string }
  | { kind: "detach"; words: string[]; conn?: string; at?: string }
  | { kind: "fixed"; words: string }
  | { kind: "driven"; words: string; params: string[]; expr: string };

const isObject = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);

/** The axis end `e` of `bar` moves along, or undefined for a bar that does not derive or a copy. */
export function endAxis(m: Model, bar: string, e: End): EndAxis | undefined {
  const b = m.derived.bars[bar];
  if (!b || bar.includes("@")) return undefined;
  const P = e === "a" ? b.a : b.b;
  const Q = e === "a" ? b.b : b.a;
  const len = dist(P, Q);
  if (!(len > 0)) return undefined;
  const u = sub(P, Q).map((c) => c / len) as unknown as V3;
  const spec = (m.doc.bars as Record<string, unknown> | undefined)?.[bar];
  const ends = isObject(spec) && isObject(spec.ends) ? spec.ends : {};
  const ext = isObject(ends[e]) ? ends[e].extend_mm : undefined;
  return {
    bar,
    end: e,
    Q,
    u,
    len,
    face: dot(sub(b.ends[e].point, Q), u),
    cut: b.cut_mm,
    extend: typeof ext === "number" ? ext : 0,
  };
}

/** What holds an end, and whether a param drives the coordinates a move would change. */
export function endState(m: Model, bar: string, e: End): EndState {
  const b = m.derived.bars[bar];
  if (!b) return { kind: "fixed", words: `${bar} does not derive: see the problems` };
  const hold = endHold(m.doc, bar, e, b.ends[e].by);
  if (hold.kind === "fixed") return { kind: "fixed", words: hold.words };
  const axis = endAxis(m, bar, e);
  const driven = axis ? drivenEnd(m.doc, bar, e, axis.u) : undefined;
  if (driven) return { kind: "driven", ...driven };
  if (hold.kind === "detach") {
    return {
      kind: "detach",
      words: hold.words,
      ...(hold.conn ? { conn: hold.conn } : {}),
      ...(hold.at ? { at: hold.at } : {}),
    };
  }
  return hold.corner ? { kind: "free", corner: hold.corner } : { kind: "free" };
}

/** Whether an end can be dragged: free or detachable. */
export const draggable = (s: EndState) => s.kind === "free" || s.kind === "detach";

/**
 * Where a dragged end may stop along its axis:
 * - `line`: on another bar's design line, between its ends: `autoConnect` butts the end on it;
 * - `corner`: at another bar's end: `autoConnect` joins them by the corner rule, which Tab flips;
 * - `face`: touching a bar whose line the axis misses, the end's face on its near or far face:
 *   no joint (`autoConnect` joins where design lines meet, §4.5), and the words say so.
 *
 * `len` is the design length the stop writes; `span` the stretch of the axis inside the other
 * bar's box, where a drag falls onto a `line` or `corner` stop, as a body meets another.
 */
export interface Stop {
  kind: "line" | "corner" | "face";
  bar: string;
  /** What `moveEnd`'s `to` names: the bar, or its end. */
  to?: string;
  len: number;
  /** Where the end's face would sit, for the drawing; the dry run gives the cut. */
  face: number;
  span: [number, number];
  label: string;
}

/** The stretch of `Q + u·s` inside a bar's box prism (§4.5), or undefined when it misses. */
function prismSpan(
  axis: Pick<EndAxis, "Q" | "u">,
  b: Model["derived"]["bars"][string],
): [number, number] | undefined {
  const [[x0, y0], [x1, y1]] = b.box_mm;
  let lo = Number.NEGATIVE_INFINITY;
  let hi = Number.POSITIVE_INFINITY;
  for (const [dir, a0, a1] of [
    [b.frame.x, x0, x1],
    [b.frame.y, y0, y1],
  ] as const) {
    const c0 = dot(sub(axis.Q, b.a), dir);
    const dc = dot(axis.u, dir);
    if (Math.abs(dc) < 1e-12) {
      if (c0 < a0 - NEAR || c0 > a1 + NEAR) return undefined;
      continue;
    }
    const s0 = (a0 - c0) / dc;
    const s1 = (a1 - c0) / dc;
    lo = Math.max(lo, Math.min(s0, s1));
    hi = Math.min(hi, Math.max(s0, s1));
  }
  return lo <= hi ? [lo, hi] : undefined;
}

/** The stops along an end's axis, nearest the end's face first. */
export function endStops(m: Model, axis: EndAxis): Stop[] {
  const out: Stop[] = [];
  for (const [id, b] of Object.entries(m.derived.bars)) {
    if (id === axis.bar || !b.a || !b.b) continue;
    const LT = dist(b.a, b.b);
    if (!(LT > 0)) continue;
    const t = sub(b.b, b.a).map((c) => c / LT) as unknown as V3;
    const w0 = sub(axis.Q, b.a);
    const k = dot(axis.u, t);
    const den = 1 - k * k;
    // A bar along the axis meets it nowhere: a splice is Connect's to make.
    if (den < 1e-9) continue;
    const d = dot(axis.u, w0);
    const e2 = dot(t, w0);
    const s = (k * e2 - d) / den;
    const r = (e2 - k * d) / den;
    const gap = dist(at(axis.Q, axis.u, s), at(b.a, t, r));
    const span = prismSpan(axis, b);
    // The body spans its cut faces along its own axis: a span past them misses it.
    const faceA = dot(sub(b.ends.a.point, b.a), t);
    const faceB = dot(sub(b.ends.b.point, b.a), t);
    const onBody = (s0: number) => {
      const rr = dot(sub(at(axis.Q, axis.u, s0), b.a), t);
      return rr >= Math.min(faceA, faceB) - NEAR && rr <= Math.max(faceA, faceB) + NEAR;
    };
    // Pattern copies are left out of joints, as autoConnect leaves them (§4.5).
    if (gap <= NEAR && !id.includes("@") && s > NEAR) {
      const near = span ?? [s, s];
      const sp: [number, number] = [Math.min(near[0], s), Math.max(near[1], s)];
      const face = span ? (axis.face <= span[0] ? span[0] : span[1]) : s;
      if (r > NEAR && r < LT - NEAR) {
        out.push({ kind: "line", bar: id, to: id, len: s, face, span: sp, label: `on ${id}` });
        continue;
      }
      const e = Math.abs(r) <= NEAR ? "a" : Math.abs(r - LT) <= NEAR ? "b" : undefined;
      if (e) {
        out.push({
          kind: "corner",
          bar: id,
          to: `${id}.${e}`,
          len: s,
          face,
          span: sp,
          label: `at ${id}.${e}`,
        });
        continue;
      }
    }
    if (!span) continue;
    // The near face as the end comes to it, the far face as it backs out through the bar.
    for (const [f, side] of [
      [span[0], "near"],
      [span[1], "far"],
    ] as const) {
      if (!onBody(f) || f - axis.extend <= NEAR) continue;
      if (side === "near" && axis.face > span[0] + NEAR && axis.face < span[1] - NEAR) continue;
      out.push({
        kind: "face",
        bar: id,
        len: f - axis.extend,
        face: f,
        span: [f, f],
        label: `${side === "near" ? "touches" : "flush with the far side of"} ${id}`,
      });
    }
  }
  return out.sort((x, y) => Math.abs(x.face - axis.face) - Math.abs(y.face - axis.face));
}

/** Where a dragged face at `p` lands: a stop it falls on, else a whole millimetre of cut. */
export function landing(
  axis: EndAxis,
  stops: readonly Stop[],
  p: number,
  /** How far a stop pulls, along the axis, mm: a few pixels at the end's place on the screen. */
  pull: number,
): { stop?: Stop; len: number; face: number; cut: number } {
  let best: { stop: Stop; d: number } | undefined;
  for (const st of stops) {
    const d =
      st.kind === "face"
        ? Math.abs(p - st.face)
        : p < st.span[0]
          ? st.span[0] - p
          : p > st.span[1]
            ? p - st.span[1]
            : 0;
    if (d > pull) continue;
    const tie = Math.abs(p - st.face);
    if (!best || d < best.d || (d === best.d && tie < Math.abs(p - best.stop.face))) {
      best = { stop: st, d };
    }
  }
  if (best) {
    const st = best.stop;
    return { stop: st, len: st.len, face: st.face, cut: axis.cut + (st.face - axis.face) };
  }
  // Open space: the cut in whole millimetres, at least one.
  const cut = Math.max(1, Math.round(axis.cut + (p - axis.face)));
  const face = axis.face + (cut - axis.cut);
  return { len: face - axis.extend, face, cut };
}

/** Where an end lands, from the pointer or typed: what `endCommands` sends. */
export interface Landing {
  stop?: Stop | undefined;
  len: number;
  face: number;
  cut: number;
  typed?: boolean;
  /** A typed cut as the document writes it: an expression when it reads a param (D-UX-17). */
  written?: Written;
}

const q2 = (x: number) => Math.round(x * 100) / 100;

/**
 * What a cut typed into the drag's command bar or the length label comes to (D-UX-17): an
 * expression in the document's grammar, with units and params, a leading `=` allowed (E-UX-16's
 * `=W`); a sign first is from the cut now (`+50`, "50 longer"). One that reads a param is kept
 * as written, so `moveEnd` keeps the param driving the cut; any other is the number it comes to.
 */
export function typedCut(
  text: string,
  cut0: number,
  params: Readonly<Record<string, number>>,
): { cut: number; written: Written } | { why: string } {
  const src = text.trim().replace(/^=\s*/, "");
  const t = parseTyped(src, params);
  if (t.kind === "empty") return { why: "type the cut length" };
  if (t.kind === "error") return { why: t.why };
  if (t.kind !== "value") return { why: "type one length: the cut" };
  const rel = /^[+-]/.test(src);
  const cut = rel ? cut0 + t.value : t.value;
  if (!(cut > 0)) return { why: "a cut length is above 0" };
  // A leading `+` is the identity, so it goes; a leading `-` stays inside the term it signs.
  const written =
    typeof t.written === "number"
      ? q2(cut)
      : rel
        ? offsetBy(q2(cut0), 1, t.written.replace(/^\+\s*/, ""))
        : t.written;
  return { cut, written };
}

/**
 * Where a typed cut length lands: a cut that puts the end's face inside a bar it can join (on its
 * body, between its faces, as a body collides) joins it there, as a drag that reaches it would;
 * the cut is then that bar's face's, which the preview says before Enter. Anywhere else, the cut
 * typed.
 */
export function typedLanding(
  axis: EndAxis,
  stops: readonly Stop[],
  cut: number,
  written?: Written,
): Landing {
  const face = axis.face + (cut - axis.cut);
  const st = stops.find(
    (s) => s.kind !== "face" && face >= s.span[0] - NEAR && face <= s.span[1] + NEAR,
  );
  if (st) {
    return {
      stop: st,
      len: st.len,
      face: st.face,
      cut: axis.cut + (st.face - axis.face),
      typed: true,
    };
  }
  return {
    len: face - axis.extend,
    face,
    cut,
    typed: true,
    ...(written !== undefined ? { written } : {}),
  };
}

/**
 * Which end the length label's typed value moves (docs/ux/drag-ends-decisions.md): end b, as the
 * inspector's Length field moves it, when it is free; when end b is held, end a if that is free;
 * a coordinate a param drives says so ("driven by H: edit H"), as the inspector does; when both
 * ends are held, why, and that dragging an end frees it.
 */
export function labelEnd(
  m: Model,
  bar: string,
): { end: End } | { driven: Extract<EndState, { kind: "driven" }> } | { why: string } {
  const b = endState(m, bar, "b");
  if (b.kind === "free") return { end: "b" };
  if (b.kind === "driven") return { driven: b };
  const a = endState(m, bar, "a");
  if (a.kind === "free") return { end: "a" };
  if (a.kind === "driven") return { driven: a };
  const say = (e: End, s: EndState) =>
    s.kind === "detach" ? `${bar}.${e} ${s.words.join(" and ")}` : (s as { words: string }).words;
  return {
    why: `both ends are held: ${say("a", a)}; ${say("b", b)}. Drag an end to free it`,
  };
}
