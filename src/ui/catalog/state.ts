import { signal } from "@preact/signals";
import type { ItemCard } from "../../server/catalog.ts";
import { get } from "../api.ts";
import { type PaletteItem, palette } from "../palette.ts";
import { readPref, writePref } from "../shell/prefs.ts";
import { dismissStart, startShown } from "../shell/start.ts";
import { summary } from "../store.ts";
import { activeTool, type ToolName } from "../tools/state.ts";

/**
 * The catalog's state, kept while the overlay is closed (D-UX-1, S2.3; U15: switching away used
 * to drop the search, the filters and the open card), the parts bin's pins and recent items, and
 * arming an item: setting the palette the draw and place tools use (palette.ts). Owner: S2.
 */

/** A vendor › kind › family filter, as the catalog's tree browses. */
export interface CatalogFilter {
  vendor?: string;
  kind?: string;
  family?: string;
}

export const catalogOpen = signal(false);
export const catalogQuery = signal("");
export const catalogFilter = signal<CatalogFilter>({});
/** The item whose card is open, and whether it is one of the project's own (§4.8). */
export const catalogChosen = signal<{ id: string; project: boolean } | undefined>(undefined);
/** The kind facet was set by the active tool, not the person: the next tool may change it. */
let kindFromTool = false;

/** The kind of item a tool works with, as the catalog ranks and filters by it. */
export function toolKind(tool: ToolName): string | undefined {
  return tool === "draw" ? "bar" : tool === "connect" ? "connector" : undefined;
}

/**
 * Opens the catalog overlay. The kind facet follows the active tool (A F2: Draw looks for bars),
 * unless the person chose a kind; the search and the open card are as they were left.
 */
export function openCatalog(): void {
  const kind = toolKind(activeTool.peek());
  const f = catalogFilter.peek();
  if (f.kind === undefined || kindFromTool) {
    kindFromTool = kind !== undefined;
    if (kind !== f.kind) catalogFilter.value = kind ? { kind } : {};
  }
  catalogOpen.value = true;
}

export function closeCatalog(): void {
  catalogOpen.value = false;
}

/** The person chose a filter: it is theirs now, whatever the tool. */
export function chooseFilter(f: CatalogFilter): void {
  kindFromTool = false;
  catalogFilter.value = f;
}

// ---------------------------------------------------------------------------------------------
// Item cards, fetched once per item while the project's catalogs stay as they are

const cards = new Map<string, Promise<ItemCard>>();

/** An item's card (`/api/catalog/item`): its section, anchors, options and offers. */
export function cardOf(id: string): Promise<ItemCard> {
  let c = cards.get(id);
  if (!c) {
    c = get<ItemCard>(`/api/catalog/item?id=${encodeURIComponent(id)}`);
    c.catch(() => cards.delete(id));
    cards.set(id, c);
  }
  return c;
}

/** Forgets the cards: the catalogs or the project's own items changed. */
export function forgetCards(): void {
  cards.clear();
}

// ---------------------------------------------------------------------------------------------
// Arming: the palette

/** The palette's entry for an item, with the options chosen. */
export function paletteItem(card: ItemCard, opt: Readonly<Record<string, string>>): PaletteItem {
  return {
    id: card.entry.id,
    kind: card.entry.kind,
    name: card.entry.name,
    ...(Object.keys(opt).length > 0 ? { opt: { ...opt } } : {}),
    ...(card.section ? { section: card.section } : {}),
    ...(card.anchors ? { anchors: card.anchors } : {}),
  };
}

/** One item in the bin's lists: its id and the options it is armed with. */
export interface BinItem {
  id: string;
  opt?: Record<string, string>;
  /** Its name, as the catalog gives it, for the list. */
  name?: string;
}

const binKey = (b: BinItem) => `${b.id}|${JSON.stringify(b.opt ?? {})}`;
const isBinList = (x: unknown): x is BinItem[] =>
  Array.isArray(x) &&
  x.every(
    (b) =>
      typeof b === "object" &&
      b !== null &&
      typeof (b as BinItem).id === "string" &&
      ((b as BinItem).opt === undefined || typeof (b as BinItem).opt === "object"),
  );

const RECENT = "alukit.bin.recent";
/** What was armed in this tab, newest first (kept for the tab's session). */
export const recent = signal<readonly BinItem[]>(readPref(RECENT, [], isBinList, "session"));

/**
 * Arms an item: a bar for the draw tool, anything else for the place tool, and switches to that
 * tool. The palette is kept for the tab's session (S2.4). The start card closes: the person has
 * chosen to draw, and its tool must not work unseen behind the card (review m4).
 */
export function arm(card: ItemCard, opt: Readonly<Record<string, string>>): void {
  if (startShown.peek()) dismissStart();
  const item = paletteItem(card, opt);
  const isBar = card.entry.kind === "bar";
  palette.value = isBar ? { ...palette.value, bar: item } : { ...palette.value, part: item };
  const tool: ToolName = isBar ? "draw" : "place";
  if (activeTool.peek() !== tool) activeTool.value = tool;
  const b: BinItem = {
    id: item.id,
    ...(item.opt ? { opt: { ...item.opt } } : {}),
    name: item.name,
  };
  recent.value = [b, ...recent.value.filter((x) => binKey(x) !== binKey(b))].slice(0, 6);
  writePref(RECENT, recent.value, "session");
}

/** Pins, per browser and project (§7: pins in the document wait). */
const pinsKey = () => `alukit.bin.pins.${summary.peek()?.name ?? ""}`;
export const pins = signal<readonly BinItem[]>([]);

/** Reads the project's pins: once its name is known. */
export function loadPins(): void {
  pins.value = readPref(pinsKey(), [], isBinList);
}

export function pin(b: BinItem): void {
  if (pins.value.some((x) => binKey(x) === binKey(b))) return;
  pins.value = [...pins.value, b];
  writePref(pinsKey(), pins.value);
}

export function unpin(b: BinItem): void {
  pins.value = pins.value.filter((x) => binKey(x) !== binKey(b));
  writePref(pinsKey(), pins.value);
}

export const sameBinItem = (a: BinItem, b: BinItem) => binKey(a) === binKey(b);

// ---------------------------------------------------------------------------------------------
// The palette for the tab's session (S2.4)

const PALETTE = "alukit.palette";
const isPalette = (x: unknown): x is { bar?: PaletteItem; part?: PaletteItem } =>
  typeof x === "object" && x !== null && !Array.isArray(x);

/** Keeps the palette for the tab's session; returns the undo. */
export function keepPalette(): () => void {
  return palette.subscribe((p) => writePref(PALETTE, p, "session"));
}

/** The palette this tab had, if it had one. */
export function savedPalette(): { bar?: PaletteItem; part?: PaletteItem } {
  return readPref(PALETTE, {}, isPalette, "session");
}

/**
 * The palette a tab starts with (S2.4, U28): what it had this session, else the document's
 * `defaults.bar`, armed with no options of its own, so the bars drawn take `defaults.bar.opt` as
 * derive gives it. Before, the palette started empty in every tab and every session, and Draw
 * said "click a start point" while a click did nothing (B F7, F33).
 */
export async function startPalette(defaults: Readonly<Record<string, unknown>>): Promise<void> {
  const saved = savedPalette();
  if (saved.bar || saved.part) {
    palette.value = saved;
    return;
  }
  const bar = defaults.bar as { item?: unknown } | undefined;
  if (typeof bar?.item !== "string" || palette.peek().bar) return;
  try {
    const card = await cardOf(bar.item);
    if (card.entry.kind === "bar" && !palette.peek().bar) {
      palette.value = { ...palette.peek(), bar: paletteItem(card, {}) };
    }
  } catch {
    // The default names an item no catalog holds: derive says so; the palette stays empty.
  }
}
