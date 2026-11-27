import { signal } from "@preact/signals";
import type { Projection, SectionPlane, Viewer } from "../../viewer/scene.ts";
import type { Corner } from "../corners.ts";
import type { Shown } from "../focus.ts";

/**
 * The viewport's state, which other regions read: the viewer once the viewport has made it (the
 * tools wire themselves to it; the view controls drive its camera), the projection, the section
 * plane, and the display toggles (joint markers, problem badges, colour by). Owner: S3.
 */

export const viewer = signal<Viewer | undefined>(undefined);
export const projection = signal<Projection>("perspective");
/** The section clipping plane (§8), when it is on. */
export const sectionPlane = signal<SectionPlane | undefined>(undefined);

/** Whether the view draws a marker at every corner (D-UX-23). */
export const showJoints = signal(true);
/** Whether the view draws the problems on their entities (S3.7). */
export const showProblems = signal(true);
/** What colours the bodies: their finish (the default), or their item, with a legend (S3.10). */
export const colourBy = signal<"finish" | "item">("finish");

/** The drawn revision's corners (src/ui/corners.ts), as the joint markers show them. */
export const drawnCorners = signal<readonly Corner[]>([]);

/**
 * Whether a Show dims the rest of the model: when its caller asks (`isolate`, as the legend
 * does), and always for a problem, which B §5.3 shows with "others dimmed" until Esc.
 */
export function ghostsRest(s: Pick<Shown, "isolate" | "problem">): boolean {
  return s.isolate || s.problem !== undefined;
}
