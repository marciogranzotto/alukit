import { compareIds } from "../ids.ts";
import { tapDrill } from "../threads.ts";
import type { Ctx } from "./context.ts";
import type { DerivedBar, HoleOp } from "./derive.ts";
import { opText } from "./duplicates.ts";
import { holeCentre } from "./fastenings.ts";
import { grooveOffsets } from "./place.ts";

/**
 * Taps into a bar's face on its wall (after the alternative frame's acceptance, X5), the face
 * analogue of `coreTaps`. A tapped hole cuts its thread in the material round its tap drill, and a
 * groove's opening has none: a tap on a T-slot profile's groove centre line threads nothing.
 *
 * Each tapped hole in a bounding face (a `screw` fastening's, a connector's, or one a person
 * wrote) whose tap drill's circle (ISO's d − P, `tapDrill`) lies more than half in the opening of
 * a groove of that face is a `machining` error on the bar, naming the face, the groove, the
 * hole's offset from the groove's centre line and how much of the circle lies in the opening.
 * A thread whose tap drill is not known (no pitch) is not checked. A pattern copy's bar is its
 * template's, which reports.
 */
export function faceTaps(ctx: Ctx, bars: ReadonlyMap<string, DerivedBar>): void {
  for (const id of [...bars.keys()].sort(compareIds)) {
    const b = bars.get(id) as DerivedBar;
    if (b.placed.copy) continue;
    for (const o of b.ops) {
      if (o.op !== "hole" || o.thread === undefined) continue;
      const d = tapDrill(o.thread);
      if (d === undefined) continue;
      check(ctx, b, o, d);
    }
  }
}

/** The most of a tap drill's circle that may lie in a groove's opening. */
export const TAP_IN_OPENING_MAX = 0.5;

function check(ctx: Ctx, b: DerivedBar, o: HoleOp, d: number): void {
  const X = holeCentre(b, o);
  for (const { groove: g, off } of grooveOffsets(b.placed, o.face, X)) {
    if (g.opening_mm === undefined) continue;
    const f = bandFraction(d / 2, off, g.opening_mm / 2);
    if (f <= TAP_IN_OPENING_MAX) continue;
    const groove = `the groove${g.type ? ` ${g.type}` : ""} on face ${o.face} at ${mm(g.at_mm)}`;
    ctx.d.error(
      "machining",
      b.placed.id,
      `${opText(b, o)}${o.by ? ` (${o.by})` : ""}: its Ø${mm(d)} tap drill lies ${(100 * f).toFixed(1)} % in the ${mm(g.opening_mm)} opening of ${groove}, ${mm(Math.abs(off))} off its centre line, so its thread has less than half its circle of wall`,
      o.by ? { refs: [o.by] } : {},
    );
  }
}

/**
 * The fraction of a disc of radius r whose centre lies `c` from a band's centre line that lies
 * within the band, `h` either side of the line: the disc's area between two chords.
 */
export function bandFraction(r: number, c: number, h: number): number {
  // The area of the disc from its centre to x along its axis, x within the disc.
  const F = (x: number) => {
    const t = Math.max(-r, Math.min(r, x));
    return t * Math.sqrt(r * r - t * t) + r * r * Math.asin(t / r);
  };
  return Math.max(0, (F(h - c) - F(-h - c)) / (Math.PI * r * r));
}

const mm = (x: number) => (Math.abs(x) < 0.005 ? 0 : x).toFixed(2);
