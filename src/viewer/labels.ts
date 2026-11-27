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

/**
 * Places an element over the view at a point (page pixels), kept inside the view: the element is
 * translated to the point, measured with its margins and CSS translate, and moved back inside by
 * its overflow (the editing round's E2: a selected bar's label used to run off the right edge).
 */
export function placeInside(el: HTMLElement, at: readonly [number, number], view: DOMRect): void {
  const x = Math.round(at[0] - view.left);
  const y = Math.round(at[1] - view.top);
  el.style.transform = `translate(${x}px, ${y}px)`;
  const [dx, dy] = nudgeInside(el.getBoundingClientRect(), view, EDGE_GAP_PX);
  if (dx !== 0 || dy !== 0) {
    el.style.transform = `translate(${Math.round(x + dx)}px, ${Math.round(y + dy)}px)`;
  }
}

/**
 * Labels at world points (`Viewer.setLabel`, S5's joint preview): plain text in a box over the
 * canvas, moved after each frame so it follows its point, kept inside the view; hidden while its
 * point is behind the camera. Each is a `.view-label` with `data-label=<key>`
 * (src/ui/styles/viewport.css). Owner: S3.
 */
export class Labels {
  private readonly items = new Map<string, { el: HTMLElement; at: V3 }>();
  private readonly container: HTMLElement;
  private readonly project: (p: V3) => P2 | undefined;

  constructor(container: HTMLElement, project: (p: V3) => P2 | undefined) {
    this.container = container;
    this.project = project;
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
    placeInside(el, s, this.container.getBoundingClientRect());
  }

  dispose(): void {
    for (const { el } of this.items.values()) el.remove();
    this.items.clear();
  }
}
