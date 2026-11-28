import { compareIds } from "../ids.ts";
import type { From } from "../project/schema.ts";
import { QUANTUM, quantize } from "../quantum.ts";
import type { Ctx } from "./context.ts";
import type { DerivedBar, HoleOp, ResolvedOp } from "./derive.ts";

/**
 * Coincident machining (acceptance gap A8): two ops of one bar that are one op in the shop, the
 * same kind and size at the same place, made twice. A connector that wrote the same requirement
 * once per screw, or a splice with several studs and no positions for their cores, put them all
 * at one point; so do two ends that each pass a through-fastener on one axis. Each such group is
 * a `machining` error on the bar, naming the connections that made it.
 *
 * Places compare as the cut list's identity does (§5.3): to the output quantum, a hole by its
 * distance from design point a, and a plain through hole (no depth, countersink or counterbore)
 * by its axis, since the same hole can be drilled from either face; likewise a through hole into
 * an end, from either end. A pattern copy's bar is its template's, which reports.
 */
export function duplicateOps(ctx: Ctx, bars: ReadonlyMap<string, DerivedBar>): void {
  for (const id of [...bars.keys()].sort(compareIds)) {
    const b = bars.get(id) as DerivedBar;
    if (b.placed.copy) continue;
    const groups = new Map<string, ResolvedOp[]>();
    for (const o of b.ops) {
      const k = placeKey(b, o);
      groups.set(k, [...(groups.get(k) ?? []), o]);
    }
    for (const ops of groups.values()) {
      if (ops.length < 2) continue;
      const first = ops[0] as ResolvedOp;
      const by = [...new Set(ops.flatMap((o) => (o.by ? [o.by] : [])))].sort(compareIds);
      const written = ops.filter((o) => !o.by).length;
      const who = [...by, ...(written > 0 ? [`${written} written in ops`] : [])].join(", ");
      ctx.d.error(
        "machining",
        id,
        `${opText(b, first)} is made ${ops.length} times at one place (${who}): give each its own position, or make it once`,
        by.length > 0 ? { refs: by } : {},
      );
    }
  }
}

const q = (x: number) => quantize(x, QUANTUM.len_mm);
const mm = (x: number) => q(x).toFixed(2);

function placeKey(b: DerivedBar, o: ResolvedOp): string {
  const off = (p: readonly [number, number] | undefined) => [q(p?.[0] ?? 0), q(p?.[1] ?? 0)];
  if (o.op === "end-tap") return JSON.stringify(["tap", o.from, ...off(o.off), o.thread, o.depth]);
  if (o.op === "end-hole") {
    if (o.exit && o.depth === undefined) {
      // Through at an angle: the same hole from either end, by where it meets each end.
      const [atA, atB] = o.from === "a" ? [o.off, o.exit] : [o.exit, o.off];
      return JSON.stringify(["end-angled", ...off(atA), ...off(atB), o.d, o.thread]);
    }
    const end = o.depth === undefined ? "*" : o.from;
    const tilt = o.exit ? [...off(o.exit), quantize(o.angle ?? 0, QUANTUM.ang_deg)] : [];
    return JSON.stringify(["end", end, ...off(o.off), ...tilt, o.d, o.thread, o.depth]);
  }
  const s = o.from === "a" ? o.at : b.lengths.len - o.at;
  const plain = o.depth === undefined && !o.csk && !o.cbore;
  return JSON.stringify([
    "hole",
    q(s),
    plain ? `±${o.face[1]}` : o.face,
    q(o.across ?? 0),
    o.d,
    o.thread,
    o.depth,
    o.csk?.d,
    o.csk?.angle,
    o.cbore?.d,
    o.cbore?.depth,
  ]);
}

/** An op as one line of a message: what it is, then where. */
export function opText(b: DerivedBar, o: ResolvedOp): string {
  const at = (p: readonly [number, number] | undefined) =>
    p ? `at x ${mm(p[0])}, y ${mm(p[1])} from the centre` : "at the centre";
  if (o.op === "end-tap") return `the tap ${o.thread} in end ${o.from} ${at(o.off)}`;
  const what = o.thread ? `tap ${o.thread}` : `Ø${o.d === undefined ? "?" : mm(o.d)} hole`;
  if (o.op === "end-hole") {
    if (o.exit && o.angle !== undefined) {
      return `the ${what} in end ${o.from} ${at(o.off)}, ${mm(o.angle)}° off square`;
    }
    return `the ${what} in end ${o.from} along the axis, ${at(o.off)}`;
  }
  const [s, from] = holePlace(b, o);
  const across = o.across === undefined ? "" : `, ${mm(o.across)} across`;
  const through = o.depth === undefined && !o.csk && !o.cbore ? ", through" : "";
  return `the ${what} ${mm(s)} from ${from} on face ${o.face}${across}${through}`;
}

const REFERENCE: Record<From, string> = {
  a: "design point a",
  b: "design point b",
  "a.cut": "end a's cut",
  "b.cut": "end b's cut",
};

/**
 * Where a hole in a bar's side lies, in its own reference (re-check N3): a written hole's
 * distance from what it counts from, as written (§4.4); a generated one's from design point a.
 * Every message about a hole names it so, whatever the check measures from.
 */
export function holePlace(b: DerivedBar, o: HoleOp): [number, string] {
  if (o.written) return [o.written.at, REFERENCE[o.written.from]];
  return [o.from === "a" ? o.at : b.lengths.len - o.at, REFERENCE.a];
}
