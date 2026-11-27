import type { V3 } from "../../mesh/model.ts";
import { bodiesOf } from "../focus.ts";
import { mm } from "../format.ts";
import type { Model } from "../model.ts";
import { boxOf } from "../targets.ts";

/**
 * The size readout (docs/ux/editing-audit.md E2.5, §4.6: the overall size is the dimension a
 * frame designer checks most): the bounding box of what draws some refs, as the view lights them
 * (src/ui/targets.ts), or of every body when no refs are given. World axes, millimetres: W along
 * X, D along Y, H along Z. Pure. Owner: E2.
 */

export type SizeBox = readonly [V3, V3];

/** The box of the refs' bodies, or of the whole model; undefined when nothing draws them. */
export function sizeOf(m: Model, refs?: readonly string[]): SizeBox | undefined {
  return boxOf(m, refs ? bodiesOf(m, refs) : undefined);
}

/** A box's extent along each axis. */
export function extentOf(b: SizeBox): V3 {
  return [b[1][0] - b[0][0], b[1][1] - b[0][1], b[1][2] - b[0][2]];
}

/** A length as the readout writes it: to 0.01 mm, with no trailing `.00`. */
export const sizeNumber = (x: number) => mm(x).replace(/\.00$/, "");

/** `1000 × 600 × 750 mm`. */
export function sizeText(b: SizeBox): string {
  return `${extentOf(b).map(sizeNumber).join(" × ")} mm`;
}
