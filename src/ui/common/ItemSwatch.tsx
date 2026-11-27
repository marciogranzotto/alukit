import { computed } from "@preact/signals";
import { model } from "../store.ts";
import { theme } from "../theme/theme.ts";
import { itemSwatches, swatchCss } from "../theme/tokens.ts";

/**
 * The colour of each catalog item the drawn model uses, for the tables' swatches and for colouring
 * the view by item (docs/ux/visual-design.md §4.1): one table, so a profile is the same colour in
 * the cut list, the BOM, the order and the frame. Owner: S4.
 */
export const swatches = computed(() => {
  const m = model.value;
  return m ? itemSwatches(m, theme.value) : new Map<string, number>();
});

/** A small square in the item's colour; an empty outline when the model does not use the item. */
export function ItemSwatch({ item }: { item: string }) {
  const n = swatches.value.get(item);
  if (n === undefined) return <span class="swatch none" aria-hidden="true" />;
  return <span class="swatch" style={{ background: swatchCss(n) }} aria-hidden="true" />;
}
