import { signal } from "@preact/signals";
import type { ViewSection } from "../mesh/model.ts";

/**
 * The palette (design §8): the bar the draw tool draws with and the part the place tool places,
 * as chosen in the catalog ("set as palette"). The catalog, the parts bin and the start card set
 * it; the tools read it. Owner: S2 (S2.4 starts it from the document's `defaults.bar`).
 */

/** An item chosen in the catalog browser. */
export interface PaletteItem {
  id: string;
  kind: string;
  name: string;
  opt?: Readonly<Record<string, string>>;
  /** A bar's section, for the draw tool's preview and anchors. */
  section?: ViewSection;
  anchors?: readonly string[];
}

/** What the draw tool draws with (a bar item) and the place tool places (any other item). */
export const palette = signal<{ bar?: PaletteItem; part?: PaletteItem }>({});
