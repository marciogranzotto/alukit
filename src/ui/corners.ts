import type { CornerMarker } from "../viewer/scene.ts";
import type { Model } from "./model.ts";

/**
 * Corners (D-UX-10): a point where two or more bar ends meet, or where an end meets another bar's
 * line. Corners are not entities: they are derived here, in the browser, from the view model
 * (the bars' placed points and `ends.*.by`), and the selection may hold `corner:<key>`.
 *
 * - joined: every end there is claimed by a connection;
 * - open: some end there is not;
 * - failed: a connection there has an error.
 *
 * Pure. Owner: S3, which builds `cornersOf` first (S3.4: unit-tested on the cart, and on an
 * auto-connected ground rectangle, 4 joined, then 4 open without its butts); the outline's Joints
 * group (S2.5), the joint markers (S3.5) and the corner inspector (S5.5) read it. Until then it
 * finds none.
 */

export interface Corner extends CornerMarker {
  /** The bar ends that meet here (`b1.a`). */
  ends: string[];
  /** The bars that meet here, through bars included. */
  bars: string[];
  /** The connections that claim an end here. */
  connections: string[];
}

/** The selection's ref for a corner. */
export function cornerRef(key: string): string {
  return `corner:${key}`;
}

export function cornersOf(_m: Model): Corner[] {
  return [];
}
