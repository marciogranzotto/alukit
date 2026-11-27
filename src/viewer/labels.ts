import type { V3 } from "../mesh/model.ts";
import type { P2 } from "./snap.ts";

/**
 * Labels at world points (`Viewer.setLabel`, S5's joint preview): plain text in a box over the
 * canvas, moved after each frame so it follows its point; hidden while its point is behind the
 * camera. Each is a `.view-label` with `data-label=<key>` (src/ui/styles/viewport.css). Owner: S3.
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
    const r = this.container.getBoundingClientRect();
    el.hidden = false;
    el.style.transform = `translate(${Math.round(s[0] - r.left)}px, ${Math.round(s[1] - r.top)}px)`;
  }

  dispose(): void {
    for (const { el } of this.items.values()) el.remove();
    this.items.clear();
  }
}
