import type { V3 } from "../mesh/model.ts";

/**
 * Named views (design §8: standard views top, front, side and iso; §4.2: the document's own
 * `views`, `{ pos, target }` in world millimetres). A standard view is a direction to look from,
 * fitted to the model; a document's view is a camera position and target as written.
 */

export const STANDARD_VIEWS = ["iso", "top", "front", "right", "left", "back", "bottom"] as const;
export type StandardView = (typeof STANDARD_VIEWS)[number];

/**
 * Where each standard view looks from, as a world direction from the target toward the camera
 * (Z up, §2). `side` is the right view. Iso looks from the front right, above.
 */
const FROM: Readonly<Record<StandardView, V3>> = {
  iso: [1, -1, 1],
  top: [0, 0, 1],
  bottom: [0, 0, -1],
  front: [0, -1, 0],
  back: [0, 1, 0],
  right: [1, 0, 0],
  left: [-1, 0, 0],
};

export function isStandard(name: string): name is StandardView {
  return (STANDARD_VIEWS as readonly string[]).includes(name) || name === "side";
}

/** The world direction a standard view looks from; `side` is `right`. */
export function viewFrom(name: StandardView | "side"): V3 {
  return FROM[name === "side" ? "right" : name];
}

/** A document's named view (§4.2), when it is one. */
export interface DocView {
  pos: V3;
  target: V3;
}

/** The document's views that are well formed: numbers only (a view is a camera, not geometry). */
export function docViews(doc: Readonly<Record<string, unknown>>): Record<string, DocView> {
  const out: Record<string, DocView> = {};
  const views = doc.views;
  if (typeof views !== "object" || views === null || Array.isArray(views)) return out;
  const vec = (v: unknown): V3 | undefined =>
    Array.isArray(v) &&
    v.length === 3 &&
    v.every((c) => typeof c === "number" && Number.isFinite(c))
      ? (v as unknown as V3)
      : undefined;
  for (const [name, v] of Object.entries(views as Record<string, unknown>)) {
    if (typeof v !== "object" || v === null) continue;
    const pos = vec((v as { pos?: unknown }).pos);
    const target = vec((v as { target?: unknown }).target);
    if (pos && target) out[name] = { pos, target };
  }
  return out;
}

/** World (Z up) to three.js (Y up): the scene root's rotation, −90° about X. */
export function toThree(p: V3): V3 {
  return [p[0], p[2], 0 - p[1]];
}

/** three.js (Y up) to world (Z up). */
export function fromThree(p: V3): V3 {
  return [p[0], 0 - p[2], p[1]];
}
