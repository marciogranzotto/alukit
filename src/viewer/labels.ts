import type { V3 } from "../mesh/model.ts";
import type { P2 } from "./snap.ts";

/** The gap a label keeps from the view's edges, CSS pixels. */
export const EDGE_GAP_PX = 4;

/** A box on the page, as `getBoundingClientRect` gives it. */
export interface PageBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * How far to move a box so it lies inside the view, `gap` pixels from its edges: nothing for a
 * box inside, else its overflow on each axis. A box wider (or taller) than the view goes to its
 * left (or top) edge, where its start is read. Pure.
 */
export function nudgeInside(b: PageBox, view: PageBox, gap: number): [number, number] {
  const axis = (lo: number, hi: number, vlo: number, vhi: number) => {
    if (lo < vlo + gap || hi - lo > vhi - vlo - 2 * gap) return vlo + gap - lo;
    if (hi > vhi - gap) return vhi - gap - hi;
    return 0;
  };
  return [
    axis(b.left, b.right, view.left, view.right),
    axis(b.top, b.bottom, view.top, view.bottom),
  ];
}

const shift = (b: PageBox, dx: number, dy: number): PageBox => ({
  left: b.left + dx,
  top: b.top + dy,
  right: b.right + dx,
  bottom: b.bottom + dy,
});

/** Whether a box comes within `gap` of another. */
const near = (b: PageBox, a: PageBox, gap: number) =>
  b.left < a.right + gap &&
  b.right > a.left - gap &&
  b.top < a.bottom + gap &&
  b.bottom > a.top - gap;

/**
 * How far to move a box, already inside the view, so it keeps `gap` pixels clear of every
 * footprint in `avoid` (the gizmo's, `gizmoFootprint`): nothing when it is clear; else the
 * shortest move out of a footprint it covers (up, down, left or right of it; on a tie the
 * vertical) that stays inside the view and clear of them all; nothing when no such move exists,
 * so a label in a view too small for both stays in the view. Pure.
 */
export function clearOf(
  b: PageBox,
  view: PageBox,
  avoid: readonly PageBox[],
  gap: number,
): [number, number] {
  const covered = avoid.filter((a) => near(b, a, gap));
  if (covered.length === 0) return [0, 0];
  const moves: [number, number][] = [];
  for (const a of covered) {
    moves.push(
      [0, a.top - gap - b.bottom],
      [0, a.bottom + gap - b.top],
      [a.left - gap - b.right, 0],
      [a.right + gap - b.left, 0],
    );
  }
  const inside = (x: PageBox) =>
    x.left >= view.left + gap &&
    x.right <= view.right - gap &&
    x.top >= view.top + gap &&
    x.bottom <= view.bottom - gap;
  const size = ([dx, dy]: [number, number]) => Math.abs(dx) + Math.abs(dy);
  // A stable sort keeps each footprint's order (up, down, left, right) among equal moves.
  for (const m of [...moves].sort((p, q) => size(p) - size(q))) {
    const x = shift(b, m[0], m[1]);
    if (inside(x) && !avoid.some((a) => near(x, a, gap))) return m;
  }
  return [0, 0];
}

/**
 * Places an element over the view at a point (page pixels), kept inside the view and clear of
 * the gizmo: the element is translated to the point, measured with its margins and CSS translate,
 * moved back inside by its overflow (the editing round's E2: a selected bar's label used to run
 * off the right edge), then out of any footprint in `avoid` it covers (a label over Rotate's ring
 * took the press meant for it).
 */
export function placeInside(
  el: HTMLElement,
  at: readonly [number, number],
  view: DOMRect,
  avoid: readonly PageBox[] = [],
): void {
  const x = Math.round(at[0] - view.left);
  const y = Math.round(at[1] - view.top);
  el.style.transform = `translate(${x}px, ${y}px)`;
  const b = el.getBoundingClientRect();
  const [dx, dy] = nudgeInside(b, view, EDGE_GAP_PX);
  const [cx, cy] = clearOf(shift(b, dx, dy), view, avoid, EDGE_GAP_PX);
  if (dx + cx !== 0 || dy + cy !== 0) {
    el.style.transform = `translate(${Math.round(x + dx + cx)}px, ${Math.round(y + dy + cy)}px)`;
  }
}

/**
 * Labels at world points (`Viewer.setLabel`, S5's joint preview): plain text in a box over the
 * canvas, moved after each frame so it follows its point, kept inside the view and clear of the
 * gizmo; hidden while its point is behind the camera. Each is a `.view-label` with `data-label=<key>`
 * (src/ui/styles/viewport.css). Owner: S3.
 */
export class Labels {
  private readonly items = new Map<string, { el: HTMLElement; at: V3 }>();
  private readonly container: HTMLElement;
  private readonly project: (p: V3) => P2 | undefined;
  /** The footprints a label keeps clear of: the gizmo's, so a press on it reaches it. */
  private readonly avoid: () => readonly PageBox[];

  constructor(
    container: HTMLElement,
    project: (p: V3) => P2 | undefined,
    avoid: () => readonly PageBox[] = () => [],
  ) {
    this.container = container;
    this.project = project;
    this.avoid = avoid;
  }

  set(key: string, at: V3 | undefined, text?: string): void {
    const had = this.items.get(key);
    if (!at) {
      had?.el.remove();
      this.items.delete(key);
      return;
    }
    const el = had?.el ?? document.createElement("div");
    if (!had) {
      el.className = "view-label";
      el.dataset.label = key;
      this.container.appendChild(el);
    }
    el.textContent = text ?? "";
    this.items.set(key, { el, at });
    this.place(el, at);
  }

  /** Moves every label to its point, after a frame. */
  update(): void {
    for (const { el, at } of this.items.values()) this.place(el, at);
  }

  private place(el: HTMLElement, at: V3): void {
    const s = this.project(at);
    if (!s) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    placeInside(el, s, this.container.getBoundingClientRect(), this.avoid());
  }

  dispose(): void {
    for (const { el } of this.items.values()) el.remove();
    this.items.clear();
  }
}
