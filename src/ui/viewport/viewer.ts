import { computed, signal } from "@preact/signals";
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

/**
 * The joint markers (D-UX-23; review m8): `problems`, the default, draws the open and failed
 * corners, and a joined one while it is hovered or selected; `all` draws every corner; `off`
 * none. The Joints button steps through them in that order, so its first press still hides them.
 */
export type JointMarkers = "problems" | "off" | "all";
export const jointMarkers = signal<JointMarkers>("problems");
/** Whether the view draws joint markers at all. */
export const showJoints = computed(() => jointMarkers.value !== "off");
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
