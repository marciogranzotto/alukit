import { type Diagnostic, sortDiagnostics } from "../diagnostics.ts";
import { compareIds } from "../ids.ts";
import type { ItemLookup, ItemSource } from "../items.ts";
import { type Doc, PROJECT_ITEM } from "../project/parse.ts";
import { type ResolvedProjectItem, resolveProjectItem } from "./resolve.ts";

/**
 * The items a document sees (design §4.8, §5.1 stage 1): its catalogs' (from the lock, or live)
 * and its own project items as `project:<id>`. Derive reads items through this source, and so do
 * the BOM, the order list and the machining sheet, so a project item is placed, borne on, counted
 * and priced like a catalog item. Resolved once per document and catalog source.
 */

export interface ProjectItems {
  /** The catalogs' items, and the document's own as `project:<id>`. */
  source: ItemSource;
  /** Every project item of the document, by full id, in id order. */
  resolved: ReadonlyMap<string, ResolvedProjectItem>;
  /** The project items' own problems, on `project:<id>`. */
  diagnostics: readonly Diagnostic[];
}

const memo = new WeakMap<Doc, WeakMap<ItemSource, ProjectItems>>();

export function projectItems(base: ItemSource, doc: Doc): ProjectItems {
  let byBase = memo.get(doc);
  if (!byBase) {
    byBase = new WeakMap();
    memo.set(doc, byBase);
  }
  const hit = byBase.get(base);
  if (hit) return hit;

  const diagnostics: Diagnostic[] = [];
  const resolved = new Map<string, ResolvedProjectItem>();
  for (const local of Object.keys(doc.items).sort(compareIds)) {
    const id = `${PROJECT_ITEM}${local}`;
    resolved.set(
      id,
      resolveProjectItem(id, doc.items[local] as Doc["items"][string], base, diagnostics),
    );
  }
  const source: ItemSource = {
    item(ref: string): ItemLookup {
      if (!ref.startsWith(PROJECT_ITEM)) return base.item(ref);
      const r = resolved.get(ref);
      return r
        ? { ok: true, id: r.id, item: r.view }
        : { ok: false, message: `no project item ${ref} in "items"` };
    },
    offers: (itemId) => (itemId.startsWith(PROJECT_ITEM) ? [] : base.offers(itemId)),
    material: (ref) => base.material(ref),
  };
  const out: ProjectItems = { source, resolved, diagnostics: sortDiagnostics(diagnostics) };
  byBase.set(base, out);
  return out;
}
