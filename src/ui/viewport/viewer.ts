import { signal } from "@preact/signals";
import type { Projection, SectionPlane, Viewer } from "../../viewer/scene.ts";

/**
 * The viewport's state, which other regions read: the viewer once the viewport has made it (the
 * tools wire themselves to it; the view controls drive its camera), the projection, and the
 * section plane. Owner: S3.
 */

export const viewer = signal<Viewer | undefined>(undefined);
export const projection = signal<Projection>("perspective");
/** The section clipping plane (§8), when it is on. */
export const sectionPlane = signal<SectionPlane | undefined>(undefined);
