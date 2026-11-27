import type { Derived, DerivedBar } from "#core/derive/derive.ts";
import { partJson } from "#core/derive/output.ts";
import { compareIds } from "#core/ids.ts";
import type { ItemSource } from "#core/items.ts";
import { projectItems } from "#core/project-items/source.ts";
import { addScaled, dot } from "#core/vec.ts";
import { applyMatrix } from "./data.ts";
import { displayFasteners, displayParts } from "./display.ts";
import type { PartJson, V3, ViewFastener, ViewShape } from "./model.ts";
import { fastenerId, fastenerMatrix, type PartShape, partShape } from "./place.ts";
import { shapePrism } from "./shapes.ts";
import { rodRing } from "./solids.ts";

/**
 * The bodies of a derived model as points (design §4.9's `bbox()`): what the viewer draws and the
 * GLB holds (§8, §9) of the build, from the same shapes and the same placement, so the three
 * agree. Context (gap X11) is drawn and exported too, flagged, and is not in it.
 *
 * - A bar: its section's box swept between its end planes, exact for every planar cut. Its mesh
 *   is its section's display outline, which fills that box on a T-slot, a flat or a hollow
 *   section.
 * - A placed part: a project plate's or bent angle's prism (`shapes.ts`), else its item's box (a
 *   placeholder's too), in its frame on its station (`partShape`). An item that gives no box is
 *   drawn as a marker, which is not its extent: such a part is reported, not measured.
 * - A face connection's fastener: its rod (`rodRing`, under `fastenerMatrix`).
 *
 * A project item's hole markers stand proud of its faces to show; they mark holes, they are not
 * bodies. Nothing here uses three.js: the checks read it.
 */

export interface Body {
  /** As the GLB names its node: `b3`, `p1@2`, `c23.f1`. */
  id: string;
  kind: "bar" | "part" | "fastener";
  /** In world millimetres; the body's extent is theirs. */
  points: V3[];
}

/** A placed part whose item gives no box, so its extent is not known. */
export interface NoBox {
  id: string;
  item: string;
}

export interface Extent {
  min: V3;
  max: V3;
}

/**
 * The corners of a bar's body: its placed box swept between its end planes. Exact for every
 * planar cut: each corner line meets its end plane.
 */
export function bodyCorners(b: DerivedBar): V3[] {
  const { frame, box } = b.placed;
  const out: V3[] = [];
  for (const e of [b.ends.a, b.ends.b]) {
    const along = dot(e.normal, frame.t);
    for (const u of [box.x0, box.x1]) {
      for (const v of [box.y0, box.y1]) {
        const off = addScaled(addScaled([0, 0, 0], frame.x, u), frame.y, v);
        const s = Math.abs(along) < 1e-12 ? 0 : -dot(e.normal, off) / along;
        out.push(addScaled(addScaled(e.point, off, 1), frame.t, s) as unknown as V3);
      }
    }
  }
  return out;
}

/** A project shape's vertices in the item's frame: its prism's ring at both ends. */
export function shapePoints(s: ViewShape): V3[] {
  const { ring, depth, axes } = shapePrism(s);
  const out: V3[] = [];
  for (const w of [0, depth]) {
    for (const [u, v] of ring) {
      const p = [0, 0, 0];
      p[axes[0]] = u;
      p[axes[1]] = v;
      p[axes[2]] = w;
      out.push(p as unknown as V3);
    }
  }
  return out;
}

/** A box's eight corners. */
function boxPoints([lo, hi]: readonly [V3, V3]): V3[] {
  const out: V3[] = [];
  for (const x of [lo[0], hi[0]])
    for (const y of [lo[1], hi[1]]) for (const z of [lo[2], hi[2]]) out.push([x, y, z]);
  return out;
}

/** A placed part's points in the world: its shape, else its box, under its frame. */
export function partPoints(p: PartShape): V3[] {
  const own = p.shape ? shapePoints(p.shape) : boxPoints(p.box);
  return own.map((q) => applyMatrix(p.matrix, q));
}

/** A fastener's rod in the world: its ring at both ends, as `rodMesh` places its vertices. */
export function fastenerPoints(f: ViewFastener): V3[] {
  const m = fastenerMatrix(f);
  const out: V3[] = [];
  for (const y of [0.5, -0.5]) {
    for (const [s, c] of rodRing()) out.push(applyMatrix(m, [s / 2, y, c / 2]));
  }
  return out;
}

/**
 * Every body of the build, and its placed parts that give no box. What is context is drawn but is
 * not the build (gap X11): a bar or a part marked so, and a context connection's fasteners, are
 * left out, so a wall or a floor slab does not move `bbox()`.
 */
export function modelBodies(
  derived: Derived,
  items: ItemSource,
): { bodies: Body[]; noBox: NoBox[] } {
  const own = projectItems(items, derived.doc);
  const bodies: Body[] = [];
  const noBox: NoBox[] = [];
  for (const [id, b] of derived.bars) {
    if (!b.context) bodies.push({ id, kind: "bar", points: bodyCorners(b) });
  }
  const views = displayParts(derived, own);
  for (const [id, p] of derived.parts) {
    if (p.placed && p.context) continue;
    const view = views[id];
    const placed = partShape(partJson(p) as PartJson, view);
    if (!placed) continue;
    if (!view?.shape && !view?.box) {
      noBox.push({ id, item: p.item });
      continue;
    }
    bodies.push({ id, kind: "part", points: partPoints(placed) });
  }
  for (const f of displayFasteners(derived, own)) {
    if (f.context) continue;
    bodies.push({ id: fastenerId(f), kind: "fastener", points: fastenerPoints(f) });
  }
  return { bodies, noBox: noBox.sort((a, b) => compareIds(a.id, b.id)) };
}

/** The extent of some points along each world axis; undefined for none. */
export function extentOf(points: Iterable<V3>): Extent | undefined {
  let min: number[] | undefined;
  let max: number[] | undefined;
  for (const c of points) {
    min = min ? min.map((m, i) => Math.min(m, c[i] as number)) : [...c];
    max = max ? max.map((m, i) => Math.max(m, c[i] as number)) : [...c];
  }
  return min && max ? { min: min as unknown as V3, max: max as unknown as V3 } : undefined;
}

/** The model's extent over every body, or the parts whose extent is not known. */
export function modelExtent(
  derived: Derived,
  items: ItemSource,
): { ok: true; extent: Extent | undefined } | { ok: false; noBox: NoBox[] } {
  const { bodies, noBox } = modelBodies(derived, items);
  if (noBox.length > 0) return { ok: false, noBox };
  return { ok: true, extent: extentOf(bodies.flatMap((b) => b.points)) };
}
