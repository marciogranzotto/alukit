import { effect, signal } from "@preact/signals";
import type { V3 } from "../../mesh/model.ts";
import { bodiesOf, selection } from "../focus.ts";
import { mm } from "../format.ts";
import { onKey } from "../keys.ts";
import type { Model } from "../model.ts";
import { model } from "../store.ts";
import { boxOf } from "../targets.ts";
import { viewer } from "./viewer.ts";

/**
 * The size readout (docs/ux/editing-audit.md E2.5, §4.6: the overall size is the dimension a
 * frame designer checks most): the bounding box of what draws some refs, as the view lights them
 * (src/ui/targets.ts), or of every body when no refs are given. World axes, millimetres: W along
 * X, D along Y, H along Z. The box and its words are pure; `connectSizeBox` shows the box in the
 * view while Alt is held. Owner: E2.
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

/** Whether Alt is held over the app: the size box shows in the view while it is. */
export const altHeld = signal(false);

/**
 * The size box in the view while Alt is held (E2.5): the selection's box, or the model's, its
 * edges drawn over every body with W, D and H by them. Alt's press is taken (its default would
 * move the focus to the browser's menu on some systems); letting it go, or the window losing the
 * focus, takes the box away. Returns the undo.
 */
export function connectSizeBox(): () => void {
  const offKey = onKey("app", (e) => {
    if (e.key !== "Alt") return false;
    if (!altHeld.peek()) altHeld.value = true;
    return true;
  });
  const up = (e: KeyboardEvent) => {
    if (e.key === "Alt") altHeld.value = false;
  };
  const blur = () => {
    altHeld.value = false;
  };
  window.addEventListener("keyup", up);
  window.addEventListener("blur", blur);
  const offEffect = effect(() => {
    const v = viewer.value;
    if (!v) return;
    const m = model.value;
    const sel = [...selection.value];
    const box = altHeld.value && m ? sizeOf(m, sel.length > 0 ? sel : undefined) : undefined;
    if (!box) {
      v.setDimensions(undefined);
      return;
    }
    const [w, d, h] = extentOf(box).map(sizeNumber) as [string, string, string];
    v.setDimensions({ box, words: [`W ${w}`, `D ${d}`, `H ${h}`] });
  });
  return () => {
    offKey();
    offEffect();
    window.removeEventListener("keyup", up);
    window.removeEventListener("blur", blur);
    altHeld.value = false;
  };
}
