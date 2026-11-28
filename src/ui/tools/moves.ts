import { negate, plus } from "#core/commands/numbers.ts";
import type { Expr } from "#core/project/schema.ts";
import type { V3 } from "../../mesh/model.ts";
import type { DryRun } from "../client/dryrun.ts";
import type { Model } from "../model.ts";
import { modifierWord } from "../platform.ts";
import type { JointWords } from "./joint.ts";
import { parseTyped } from "./typed.ts";

/**
 * The Move tool's rules (docs/ux/drag-ends-decisions.md, "The Move tool"), pure, so the unit
 * tests read them: what a selection moves, the axis a lone part slides on, a typed offset, the
 * step a move is (`transformBatch`, src/ui/edit/batches.ts), and its dry run in words. The
 * tool itself is `wire/move.ts`. Owner: E3.
 */

export type Vec = [Expr, Expr, Expr];

/** The arrow keys' axis locks, as the draw tool has them (SketchUp's red, green and blue). */
export const MOVE_LOCKS: Readonly<Record<string, "x" | "y" | "z">> = {
  ArrowRight: "x",
  ArrowLeft: "y",
  ArrowUp: "z",
};
export const UNIT: Readonly<Record<"x" | "y" | "z", V3>> = {
  x: [1, 0, 0],
  y: [0, 1, 0],
  z: [0, 0, 1],
};

const q = (x: number) => {
  const r = Math.round(x * 100) / 100;
  return r === 0 ? 0 : r;
};

/**
 * What a selection moves: its bars, parts and nodes; a pattern copy moves with its template. A
 * bar a crossing box held only in part moves by its ends inside the box (`ends`, `b5.b`), so it
 * stretches (docs/ux/polish-editing-decisions.md): those ends go into `ids` after the rest, and
 * the bar is not among `bars`. `ends` is absent when no bar stretches.
 */
export interface MoveSet {
  ids: string[];
  bars: string[];
  parts: string[];
  nodes: string[];
  ends?: string[];
}

export function moveSet(
  m: Model,
  selected: Iterable<string>,
  crossed?: ReadonlyMap<string, readonly ("a" | "b")[]>,
): MoveSet | { why: string } {
  const out: MoveSet = { ids: [], bars: [], parts: [], nodes: [] };
  const ends: string[] = [];
  let held = 0;
  for (const id of [...selected].sort()) {
    if (id.includes("@")) {
      return { why: `${id} is a pattern copy: move ${id.split("@")[0]}, its template` };
    }
    const part = m.derived.bars[id] ? crossed?.get(id) : undefined;
    if (part && part.length < 2) {
      // Held in part: only its ends inside the box move (none: it stays, unless joints carry it).
      held++;
      for (const e of part) ends.push(`${id}.${e}`);
      continue;
    }
    if (m.derived.bars[id]) out.bars.push(id);
    else if (m.derived.parts?.[id]) out.parts.push(id);
    else if (m.derived.nodes[id]) out.nodes.push(id);
    else continue;
    out.ids.push(id);
  }
  if (ends.length > 0) {
    out.ends = ends;
    out.ids.push(...ends);
  }
  if (out.ids.length > 0) return out;
  return held > 0
    ? { why: "the crossing box holds no end of the bars it crosses: nothing in it moves" }
    : { why: "select the bars, parts or points to move" };
}

/**
 * The axis a selection slides on by itself: parts alone, all on stations of one bar, move along
 * it (`transform` refuses them off it, E-UX-4), so the drag reads the pointer along that bar.
 */
export function slideAxis(m: Model, set: MoveSet): { bar: string; u: V3 } | undefined {
  if (set.bars.length > 0 || set.nodes.length > 0 || set.parts.length === 0) return undefined;
  if (set.ends?.length) return undefined;
  const doc = m.doc as { parts?: Record<string, { on?: { bar?: string } }> };
  const on = new Set(set.parts.map((p) => doc.parts?.[p]?.on?.bar));
  if (on.size !== 1) return undefined;
  const bar = [...on][0];
  const b = bar ? m.derived.bars[bar] : undefined;
  if (!bar || !b) return undefined;
  const A = b.ends.a.point;
  const B = b.ends.b.point;
  const L = Math.hypot(B[0] - A[0], B[1] - A[1], B[2] - A[2]);
  return L > 0 ? { bar, u: [(B[0] - A[0]) / L, (B[1] - A[1]) / L, (B[2] - A[2]) / L] } : undefined;
}

/** An offset: what it comes to, mm, and as the document writes it (a param kept, D-UX-17). */
export interface Offset {
  d: V3;
  written: Vec;
}

/** The offset `d` as numbers, written to 0.01 mm. */
export function offsetOf(d: V3): Offset {
  return { d, written: [q(d[0]), q(d[1]), q(d[2])] };
}

/**
 * What is typed during a move (D-UX-17, SketchUp's Measurements box): a distance along the locked
 * axis or the way the pointer went (`200`, `=W / 2`), an offset (`0, 200, 0`), or where the base
 * point goes (`[0, 0, H]`). A value over a param is written as typed, so `transform` keeps it.
 */
export function typedOffset(
  text: string,
  params: Readonly<Record<string, number>>,
  base: V3,
  way: V3 | undefined,
): Offset | { why: string } | undefined {
  const t = parseTyped(text.trim().replace(/^=\s*/, ""), params);
  if (t.kind === "empty") return undefined;
  if (t.kind === "error") return { why: t.why };
  if (t.kind === "value") {
    if (!way)
      return { why: "lock an axis (→ ← ↑) or move the pointer the way to go, or type x, y, z" };
    const d: V3 = [way[0] * t.value, way[1] * t.value, way[2] * t.value];
    const k = way.findIndex((x) => Math.abs(Math.abs(x) - 1) < 1e-9);
    if (typeof t.written === "string" && k >= 0) {
      const w: Vec = [0, 0, 0];
      w[k] = (way[k] as number) > 0 ? t.written : negate(t.written);
      return { d, written: w };
    }
    return offsetOf(d);
  }
  if (t.kind === "list") {
    if (t.items.length !== 3) return { why: "type a distance, or the offset as x, y, z" };
    return {
      d: t.items.map((x) => x.value) as unknown as V3,
      written: t.items.map((x) => x.written) as Vec,
    };
  }
  // A point: where the base point goes.
  return {
    d: t.items.map((x, i) => x.value - (base[i] as number)) as unknown as V3,
    written: t.items.map((x, i) => plus(x.written, -(base[i] as number))) as Vec,
  };
}

/** What a move's dry run says will happen, by the pointer: what follows, frees, joins, is cut. */
export function moveWords(r: DryRun, detach: boolean): JointWords {
  if (!r.ok) {
    // The refusal's own words, without the batch's "command 1 (transform):" before them.
    const said = r.errors[0]?.message ?? r.why;
    const hint =
      !detach && /joined: "detach"/.test(said) ? ` · hold ${modifierWord("alt")} to detach it` : "";
    const why = said.replace(/; give joined: "detach" to free (it|what joins it)/, "");
    return { text: `${why}${hint}`, shape: "refused", joins: false };
  }
  const info = r.results[0]?.info as
    | { followed?: string[]; freed?: string[]; kept?: string[]; stretched?: string[] }
    | undefined;
  const stretched = [...new Set((info?.stretched ?? []).map((x) => x.split(".")[0] as string))];
  const joins = r.results
    .slice(1)
    .filter((x) => x.created.length > 0)
    .map((x) => {
      const plan = x.info as { through?: string } | undefined;
      return `joins ${plan?.through ?? x.created.join(", ")} (${x.created.join(", ")})`;
    });
  const cuts = Object.entries(r.effects.cuts).map(([b, [a, c]]) => `${b} ${a} → ${c}`);
  const parts = [
    ...(stretched.length > 0 ? [`stretches ${list(stretched)}`] : []),
    ...(info?.followed?.length ? [`${list(info.followed)} follow`] : []),
    ...(info?.freed?.length ? [`frees ${list(info.freed)}`] : []),
    ...joins,
    ...(cuts.length > 0
      ? [`cut ${cuts.slice(0, 3).join(", ")}${cuts.length > 3 ? " …" : ""}`]
      : []),
    // "writes", not "keeps": the move writes the expression anew (review n3).
    ...(info?.kept?.length ? [`writes ${info.kept[0]}`] : []),
  ];
  return {
    text: parts.length > 0 ? parts.join(" · ") : "nothing else moves",
    shape: `${joins.join("|")}#${detach}`,
    joins: joins.length > 0,
  };
}

function list(ids: readonly string[]): string {
  return ids.length > 3
    ? `${ids.slice(0, 2).join(", ")} and ${ids.length - 2} more`
    : ids.join(", ");
}

/**
 * The joints a copying step makes, in words ("joins b9 (c20)"): those its first command copied
 * with the bars (`array`'s and `mirror`'s `info.joined`, the bars' own joints; design §6), then
 * each later command's that made one (an `autoConnect` at a new end).
 */
export function copiedJoins(r: Extract<DryRun, { ok: true }>): string[] {
  const carried = (r.results[0]?.info as { joined?: Record<string, string> } | undefined)?.joined;
  const own = Object.entries(carried ?? {}).map(([c, bar]) => `joins ${bar} (${c})`);
  const made = r.results
    .slice(1)
    .filter((x) => x.created.length > 0 && x.cmd !== "removeEntity")
    .map((x) => {
      const plan = x.info as { through?: string } | undefined;
      return `joins ${plan?.through ?? x.created.join(", ")} (${x.created.join(", ")})`;
    });
  return [...own, ...made];
}

/**
 * What a copy's dry run says it makes, by the pointer (Duplicate and Paste, E-UX-6): the new
 * entities, the joints their ends make and their cuts, or why the core refuses it. A joint the
 * copy carried is a join, not an entity it makes.
 */
export function copyWords(r: DryRun): JointWords {
  if (!r.ok) {
    const said = r.errors[0]?.message ?? r.why;
    return { text: said, shape: "refused", joins: false };
  }
  const carried = (r.results[0]?.info as { joined?: Record<string, string> } | undefined)?.joined;
  const made = (r.results[0]?.created ?? []).filter((id) => carried?.[id] === undefined);
  const joins = copiedJoins(r);
  const cuts = [...new Set(made.map((id) => r.effects.added[id]).filter((c) => c !== undefined))];
  const parts = [
    made.length > 0 ? `makes ${list(made)}` : "makes nothing",
    ...(joins.length > 3 ? [`${joins.length} joints`] : joins),
    ...(cuts.length > 0
      ? [`cut ${cuts.slice(0, 3).join(", ")}${cuts.length > 3 ? " …" : ""}`]
      : []),
  ];
  return { text: parts.join(" · "), shape: joins.join("|"), joins: joins.length > 0 };
}
