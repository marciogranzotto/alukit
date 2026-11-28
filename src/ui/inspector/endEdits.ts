import { compareIds } from "#core/ids.ts";
import { TOL } from "#core/tolerances.ts";
import type { V3 } from "../../mesh/model.ts";
import type { Hit } from "../../viewer/scene.ts";
import type { Model } from "../model.ts";
import { endAxis } from "../tools/ends.ts";
import type { Cmd } from "../tools/preview.ts";
import { faceWords, isObject, written } from "./words.ts";

/**
 * A bar end's fields as the inspector edits them (docs/ux/editing-audit.md E4.1): its cut
 * (declared angle or square, or not declared), its extension, its plane (what joins it; stopped at
 * a face; flush with another end), and freeing it from the connection that claims it. Each edit
 * is one step of existing commands, sent as `alukit do` would send them: a `setBar` merge patch on
 * `ends.<e>`, and for a detach a `setConnection` or `removeEntity`. Pure, so the unit tests read
 * it. Owner: E4.
 */

type O = Record<string, unknown>;
export type End = "a" | "b";
export type Face = "+x" | "-x" | "+y" | "-y";
export type Cut = "angle" | "square";

/** Two view-model points as close as this are the same point, mm: the view model rounds to 0.01. */
const NEAR = 0.02;

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const at = (q: V3, u: V3, s: number): V3 => [q[0] + u[0] * s, q[1] + u[1] * s, q[2] + u[2] * s];
const dist = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const q2 = (x: number) => Math.round(x * 100) / 100;

/** An end's own fields as written (`ends.<e>`): what the rows show. */
export interface EndFields {
  cut?: Cut;
  extend?: number | string;
  plane?: O;
}

export function endFields(m: Model, bar: string, e: End): EndFields {
  const w = written(m, bar);
  const ends = isObject(w) && isObject(w.ends) ? w.ends : {};
  const spec = isObject(ends[e]) ? ends[e] : {};
  return {
    ...(spec.cut === "angle" || spec.cut === "square" ? { cut: spec.cut } : {}),
    ...(typeof spec.extend_mm === "number" || typeof spec.extend_mm === "string"
      ? { extend: spec.extend_mm }
      : {}),
    ...(isObject(spec.plane) ? { plane: spec.plane } : {}),
  };
}

/** The kind of plane an end is written with: none (what joins it sets it), a face, an end, its own. */
export function planeKind(plane: O | undefined): "joint" | "face" | "end" | "own" {
  if (!plane) return "joint";
  if (isObject(plane.face)) return "face";
  if (typeof plane.of === "string") return "end";
  return "own";
}

/**
 * The `setBar` that changes an end's fields: each given field set, or removed when null. An end
 * left with no field is removed, and `ends` with it when both are gone, so the document says
 * nothing it does not need to.
 */
export function endPatch(
  m: Model,
  bar: string,
  e: End,
  set: { cut?: Cut | null; extend_mm?: number | string | null; plane?: O | null },
): Cmd {
  const w = written(m, bar);
  const ends = isObject(w) && isObject(w.ends) ? w.ends : {};
  const spec: O = isObject(ends[e]) ? { ...ends[e] } : {};
  for (const [k, v] of Object.entries(set)) {
    if (v === undefined) continue;
    if (v === null) delete spec[k];
    else spec[k] = v;
  }
  const other = e === "a" ? "b" : "a";
  const otherSpec = isObject(ends[other]) ? ends[other] : undefined;
  const empty = Object.keys(spec).length === 0;
  const patch =
    empty && !(otherSpec && Object.keys(otherSpec).length > 0)
      ? { ends: null }
      : { ends: { [e]: empty ? null : set } };
  return { cmd: "setBar", args: { id: bar, set: patch } };
}

/** Whether an end's axis meets a plane of normal `n` at an angle (§4.5: an angled end declares its cut). */
function angled(u: V3, n: V3): boolean {
  const c = Math.min(1, Math.abs(dot(u, n)) / Math.hypot(n[0], n[1], n[2]));
  return (Math.acos(c) * 180) / Math.PI > TOL.ang;
}

/** A side face of a bar the end's axis meets, where the end would stop on it. */
export interface FaceStop {
  bar: string;
  face: Face;
  /** Where the end's face would be along its axis, from the other end's design point, mm. */
  s: number;
  /** How far the end moves to get there, mm: positive is longer. */
  by: number;
  /** Whether the face meets the axis at an angle, so the end's cut must be declared. */
  angled: boolean;
  label: string;
}

const FACES: readonly [Face, "x" | "y", 0 | 1][] = [
  ["+x", "x", 1],
  ["-x", "x", 0],
  ["+y", "y", 1],
  ["-y", "y", 0],
];

/**
 * The side faces of other bars the end's axis meets, on their bodies, outward of the other end's
 * face, the nearest to the end's face first: where "stop at a face" may stop it. Pattern copies
 * are left out, as a plane names a bar of the document.
 */
export function faceStops(m: Model, bar: string, e: End): FaceStop[] {
  const axis = endAxis(m, bar, e);
  const other = m.derived.bars[bar]?.ends[e === "a" ? "b" : "a"].point;
  if (!axis || !other) return [];
  // A face at or behind the other end's face would leave nothing to cut.
  const behind = dot(sub(other, axis.Q), axis.u) + NEAR;
  const out: FaceStop[] = [];
  for (const [id, b] of Object.entries(m.derived.bars)) {
    if (id === bar || id.includes("@") || !b.a || !b.b) continue;
    const LT = dist(b.a, b.b);
    if (!(LT > 0)) continue;
    const t = sub(b.b, b.a).map((c) => c / LT) as unknown as V3;
    const faceA = dot(sub(b.ends.a.point, b.a), t);
    const faceB = dot(sub(b.ends.b.point, b.a), t);
    const [[x0, y0], [x1, y1]] = b.box_mm;
    for (const [face, ax, hi] of FACES) {
      const dir = ax === "x" ? b.frame.x : b.frame.y;
      const across = ax === "x" ? b.frame.y : b.frame.x;
      const [lo2, hi2] = ax === "x" ? [y0, y1] : [x0, x1];
      const bound = ax === "x" ? (hi ? x1 : x0) : hi ? y1 : y0;
      const dc = dot(axis.u, dir);
      if (Math.abs(dc) < 1e-9) continue;
      const s = (bound - dot(sub(axis.Q, b.a), dir)) / dc;
      if (s <= Math.max(NEAR, behind)) continue;
      const p = sub(at(axis.Q, axis.u, s), b.a);
      const c = dot(p, across);
      const r = dot(p, t);
      if (c < lo2 - NEAR || c > hi2 + NEAR) continue;
      if (r < Math.min(faceA, faceB) - NEAR || r > Math.max(faceA, faceB) + NEAR) continue;
      const by = q2(s - axis.face);
      out.push({
        bar: id,
        face,
        s,
        by,
        angled: angled(axis.u, dir),
        label: `${id}'s ${faceWords(m, id, face)} · ${by === 0 ? "where it is" : `${Math.abs(by)} mm ${by > 0 ? "longer" : "shorter"}`}`,
      });
    }
  }
  return out.sort(
    (x, y) =>
      Math.abs(x.s - axis.face) - Math.abs(y.s - axis.face) ||
      compareIds(x.bar, y.bar) ||
      x.face.localeCompare(y.face),
  );
}

/** Another bar's end an end may be made flush with. */
export interface EndStop {
  end: string;
  /** The distance between the two ends' faces, mm. */
  d: number;
  angled: boolean;
  label: string;
}

/** The other bars' ends nearest the end, at most `max`: where "flush with an end" may take it. */
export function endStopsNear(m: Model, bar: string, e: End, max = 8): EndStop[] {
  const axis = endAxis(m, bar, e);
  const me = m.derived.bars[bar]?.ends[e].point;
  if (!axis || !me) return [];
  const out: EndStop[] = [];
  for (const [id, b] of Object.entries(m.derived.bars)) {
    if (id === bar || id.includes("@")) continue;
    for (const x of ["a", "b"] as const) {
      const d = q2(dist(b.ends[x].point, me));
      out.push({
        end: `${id}.${x}`,
        d,
        angled: angled(axis.u, b.ends[x].normal),
        label: `${id}'s end ${x} · ${d} mm away`,
      });
    }
  }
  return out.sort((x, y) => x.d - y.d || compareIds(x.end, y.end)).slice(0, max);
}

/** The connections that list an end among their own (`ends`), by id: what a detach frees it from. */
function listing(m: Model, ref: string): string[] {
  const conns = isObject(m.doc.connections) ? m.doc.connections : {};
  return Object.entries(conns)
    .filter(([, c]) => isObject(c) && Array.isArray(c.ends) && c.ends.includes(ref))
    .map(([id]) => id)
    .sort(compareIds);
}

/**
 * The step that frees an end from the connections that claim it, leaving it where it is, its plane
 * then its default (square at its design point): a butt, pivot, miter or splice that lists it
 * drops it, and goes with its last end (a miter or splice joins two); a butt that claims it as its
 * through bar's end at a corner (`through_end`) claims only its other end, or none. Undefined when
 * no connection claims it, or only a pattern copy's (its template's to change).
 */
export function detachBatch(
  m: Model,
  bar: string,
  e: End,
): { commands: Cmd[]; from: string[] } | undefined {
  const ref = `${bar}.${e}`;
  if (bar.includes("@")) return undefined;
  const conns = isObject(m.doc.connections) ? m.doc.connections : {};
  const commands: Cmd[] = [];
  const from: string[] = [];
  for (const id of listing(m, ref)) {
    const c = conns[id] as O;
    const ends = (c.ends as string[]).filter((x) => x !== ref);
    const pair = c.type === "miter" || c.type === "splice";
    commands.push(
      ends.length === 0 || pair
        ? { cmd: "removeEntity", args: { id } }
        : { cmd: "setConnection", args: { id, set: { ends } } },
    );
    from.push(id);
  }
  // A butt that claims the end as its through bar's own, at a corner.
  for (const id of m.claims?.[ref] ?? []) {
    const c = conns[id];
    if (!isObject(c) || c.type !== "butt" || c.through !== bar || from.includes(id)) continue;
    const te = c.through_end;
    const mode = isObject(te) ? te.mode : typeof te === "string" ? te : "cover";
    const other = e === "a" ? "b" : "a";
    const keeps = (m.claims?.[`${bar}.${other}`] ?? []).includes(id);
    commands.push({
      cmd: "setConnection",
      args: { id, set: { through_end: keeps ? { end: other, mode } : "none" } },
    });
    from.push(id);
  }
  return commands.length > 0 ? { commands, from } : undefined;
}

/**
 * The step that gives an end a plane of its own (§4.5: one provider per end): it frees the end from
 * the connections that claim it, so the plane is its only provider, and declares its cut `angle`
 * when the plane meets it at an angle and it declares none (E-UX-11: an angled end the app makes
 * declares its cut in the same step).
 */
export function planeBatch(m: Model, bar: string, e: End, plane: O, angledPlane: boolean): Cmd[] {
  const free = detachBatch(m, bar, e)?.commands ?? [];
  const cut = endFields(m, bar, e).cut;
  return [
    ...free,
    endPatch(m, bar, e, { plane, ...(angledPlane && cut === undefined ? { cut: "angle" } : {}) }),
  ];
}

/** A plane picked in the view: what a "stop at a face" or "flush with an end" pick armed. */
export interface EndPick {
  bar: string;
  end: End;
  kind: "face" | "end";
}

/**
 * What a pick in the view gives an armed end: a side face of another bar (`face`), or the end of
 * another bar nearer the point picked, or the end face picked (`end`); or why the pick cannot be
 * taken, and the pick stays armed.
 */
export function pickedPlane(
  m: Model,
  pick: EndPick,
  hit: Pick<Hit, "id" | "face" | "station" | "p"> | undefined,
): { plane: O; angled: boolean; words: string } | { why: string } {
  const id = hit?.id;
  if (!hit || !id || !m.derived.bars[id]) return { why: "click a bar" };
  if (id === pick.bar) return { why: `that is ${pick.bar} itself: click another bar` };
  if (id.includes("@")) return { why: `${id} is a pattern copy: a plane names a bar of its own` };
  const axis = endAxis(m, pick.bar, pick.end);
  if (!axis) return { why: `${pick.bar} does not derive` };
  const b = m.derived.bars[id];
  if (!b) return { why: "click a bar" };
  if (pick.kind === "face") {
    // The face clicked, when the end's line meets it; else the face of that bar the line meets
    // first, from where the end is now: a click on a bar's top stops a rail at its near side.
    const stops = faceStops(m, pick.bar, pick.end).filter((s) => s.bar === id);
    const stop = stops.find((s) => s.face === hit.face) ?? stops[0];
    if (!stop) return { why: `${pick.bar}.${pick.end}'s line misses ${id}` };
    return {
      plane: { face: { bar: id, face: stop.face } },
      angled: stop.angled,
      words: `stops at ${id}'s face ${stop.face}`,
    };
  }
  const x: End =
    hit.face === "a" || hit.face === "b"
      ? hit.face
      : (hit.station?.at_mm ?? 0) <= b.len_mm / 2
        ? "a"
        : "b";
  return {
    plane: { of: `${id}.${x}` },
    angled: angled(axis.u, b.ends[x].normal),
    words: `flush with ${id}'s end ${x}`,
  };
}
