import { negate, plus } from "#core/commands/numbers.ts";
import type { Expr } from "#core/project/schema.ts";
import type { V3 } from "../../mesh/model.ts";
import type { DryRun } from "../client/dryrun.ts";
import type { Model } from "../model.ts";
import type { JointWords } from "./joint.ts";
import type { Cmd } from "./preview.ts";
import { parseTyped } from "./typed.ts";

/**
 * The Move tool's rules (docs/ux/drag-ends-decisions.md, "The Move tool"), pure, so the unit
 * tests read them: what a selection moves, the axis a lone part slides on, a typed offset, the
 * step a move is, and its dry run in words. The tool itself is `wire/move.ts`. Owner: S5.
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

/** What a selection moves: its bars, parts and nodes; a pattern copy moves with its template. */
export interface MoveSet {
  ids: string[];
  bars: string[];
  parts: string[];
  nodes: string[];
}

export function moveSet(m: Model, selected: Iterable<string>): MoveSet | { why: string } {
  const out: MoveSet = { ids: [], bars: [], parts: [], nodes: [] };
  for (const id of [...selected].sort()) {
    if (id.includes("@")) {
      return { why: `${id} is a pattern copy: move ${id.split("@")[0]}, its template` };
    }
    if (m.derived.bars[id]) out.bars.push(id);
    else if (m.derived.parts?.[id]) out.parts.push(id);
    else if (m.derived.nodes[id]) out.nodes.push(id);
    else continue;
    out.ids.push(id);
  }
  return out.ids.length > 0 ? out : { why: "select the bars, parts or points to move" };
}

/**
 * The axis a selection slides on by itself: parts alone, all on stations of one bar, move along
 * it (`transform` refuses them off it, E-UX-4), so the drag reads the pointer along that bar.
 */
export function slideAxis(m: Model, set: MoveSet): { bar: string; u: V3 } | undefined {
  if (set.bars.length > 0 || set.nodes.length > 0 || set.parts.length === 0) return undefined;
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

/**
 * The step a move is (design §6): one `transform`, then an `autoConnect` at each end of the bars
 * it moves, as drawing a bar sends one per end, so an end that lands on a bar joins it by the
 * corner rule. `detach` frees what joins the selection to the rest (Alt).
 */
export function moveCommands(
  set: MoveSet,
  written: Vec,
  detach: boolean,
  prefer: string | undefined,
): Cmd[] {
  const join = set.bars.slice(0, 12).flatMap((b) =>
    (["a", "b"] as const).map((e) => ({
      cmd: "autoConnect",
      args: { end: `${b}.${e}`, optional: true, ...(prefer ? { prefer } : {}) },
    })),
  );
  return [
    {
      cmd: "transform",
      args: { ids: set.ids, by: written, ...(detach ? { joined: "detach" } : {}) },
    },
    ...join,
  ];
}

/** What a move's dry run says will happen, by the pointer: what follows, frees, joins, is cut. */
export function moveWords(r: DryRun, detach: boolean): JointWords {
  if (!r.ok) {
    // The refusal's own words, without the batch's "command 1 (transform):" before them.
    const said = r.errors[0]?.message ?? r.why;
    const hint = !detach && /joined: "detach"/.test(said) ? " · Alt: detach" : "";
    const why = said.replace(/; give joined: "detach" to free (it|what joins it)/, "");
    return { text: `${why}${hint}`, shape: "refused", joins: false };
  }
  const info = r.results[0]?.info as
    | { followed?: string[]; freed?: string[]; kept?: string[] }
    | undefined;
  const joins = r.results
    .slice(1)
    .filter((x) => x.created.length > 0)
    .map((x) => {
      const plan = x.info as { through?: string } | undefined;
      return `joins ${plan?.through ?? x.created.join(", ")} (${x.created.join(", ")})`;
    });
  const cuts = Object.entries(r.effects.cuts).map(([b, [a, c]]) => `${b} ${a} → ${c}`);
  const parts = [
    ...(info?.followed?.length ? [`${list(info.followed)} follow`] : []),
    ...(info?.freed?.length ? [`frees ${list(info.freed)}`] : []),
    ...joins,
    ...(cuts.length > 0
      ? [`cut ${cuts.slice(0, 3).join(", ")}${cuts.length > 3 ? " …" : ""}`]
      : []),
    ...(info?.kept?.length ? [`keeps ${info.kept[0]}`] : []),
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
