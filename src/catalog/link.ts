import { type Region, sectionProperties, type Vec2 } from "#core/section-properties.ts";
import type { Diagnostic } from "./diagnostics.ts";
import { type LoadedCatalog, type LoadedItem, type LoadedSection, splitRef } from "./load.ts";
import type { Source } from "./merge.ts";
import { factoryE } from "./rails.ts";
import { type Face, isValuedObject, num } from "./schema/common.ts";
import type { GrooveType, Material, System } from "./schema/files.ts";
import type { Item } from "./schema/items.ts";
import type { Offer } from "./schema/offers.ts";
import { GENERATORS, type GrooveDims } from "./sections/generators/index.ts";

/**
 * Several loaded catalogs, linked (design §3.1): references resolve across them, a catalog id
 * claimed twice is an error naming both folders, and a clone's ratings resolve from its
 * original (§3.4).
 */

export type EntityKind = "item" | "section" | "material" | "groove" | "system" | "offer";

export interface Resolved<T> {
  /** Full id: `<catalog>:<local>`. */
  id: string;
  catalog: LoadedCatalog;
  local: string;
  value: T;
}

interface EntityTypes {
  item: LoadedItem;
  section: LoadedSection;
  material: Material;
  groove: GrooveType;
  system: System;
  offer: Offer;
}

export class CatalogSet {
  readonly catalogs = new Map<string, LoadedCatalog>();

  /** Resolves `ref` (a full id, or a bare id in catalog `from`) to an entity of `kind`. */
  get<K extends EntityKind>(
    kind: K,
    ref: string,
    from: string,
  ): Resolved<EntityTypes[K]> | undefined {
    const { catalog, local } = splitRef(ref, from);
    const cat = this.catalogs.get(catalog);
    if (!cat) return undefined;
    const map = {
      item: cat.items,
      section: cat.sections,
      material: cat.materials,
      groove: cat.grooves,
      system: cat.systems,
      offer: cat.offers,
    }[kind] as Map<string, EntityTypes[K]>;
    const value = map.get(local);
    return value === undefined
      ? undefined
      : { id: `${catalog}:${local}`, catalog: cat, local, value };
  }

  /** Every offer of an item, from every loaded catalog, as [catalog, sku, offer]. */
  offersOf(itemId: string): { catalog: LoadedCatalog; sku: string; offer: Offer }[] {
    const out: { catalog: LoadedCatalog; sku: string; offer: Offer }[] = [];
    for (const cat of this.catalogs.values()) {
      for (const [sku, offer] of cat.offers) {
        const { catalog, local } = splitRef(offer.item, cat.id);
        if (`${catalog}:${local}` === itemId) out.push({ catalog: cat, sku, offer });
      }
    }
    return out;
  }
}

/** A reference inside an entity: where it is, what it names, and what kind it must be. */
export interface RefSite {
  field: string;
  ref: string;
  kind: EntityKind;
}

/** Every reference an item holds. */
export function itemRefs(item: Item): RefSite[] {
  const out: RefSite[] = [];
  const add = (field: string, ref: string | undefined, kind: EntityKind) => {
    if (ref !== undefined) out.push({ field, ref, kind });
  };
  add("material", item.material, "material");
  add("clone_of/item", item.clone_of?.item, "item");
  switch (item.kind) {
    case "bar":
      add("section", item.section, "section");
      add("system", item.system, "system");
      break;
    case "connector":
      for (const [i, sys] of item.fits.entries()) add(`fits[${i}]`, sys, "system");
      for (const [i, m] of (item.mounts ?? []).entries()) {
        for (const [sys, set] of Object.entries(m.fasteners ?? {})) {
          add(`mounts[${i}]/fasteners/${sys}`, sys, "system");
          for (const [j, f] of set.entries())
            add(`mounts[${i}]/fasteners/${sys}[${j}]/item`, f.item, "item");
        }
      }
      for (const [i, p] of (item.splice?.parts ?? []).entries())
        add(`splice/parts[${i}]/item`, p.item, "item");
      for (const [i, s] of (
        (item.ratings?.stiffness ?? []) as { pair: [string, string] }[]
      ).entries()) {
        for (const [j, sys] of s.pair.entries())
          add(`ratings/stiffness[${i}]/pair[${j}]`, sys, "system");
      }
      break;
    case "fastener":
      add("groove", item.groove, "groove");
      for (const [i, sys] of (item.fits ?? []).entries()) add(`fits[${i}]`, sys, "system");
      break;
    case "carriage":
      add("rail_system", item.rail_system, "system");
      break;
    case "accessory":
      for (const [i, sys] of (item.fits ?? []).entries()) add(`fits[${i}]`, sys, "system");
      break;
    default:
      break;
  }
  return out;
}

export function offerRefs(offer: Offer): RefSite[] {
  return [
    { field: "item", ref: offer.item, kind: "item" },
    ...(offer.kit ?? []).map((k, i) => ({
      field: `kit[${i}]/item`,
      ref: k.item,
      kind: "item" as const,
    })),
  ];
}

export function sectionRefs(s: LoadedSection["section"]): RefSite[] {
  const out: RefSite[] = (s.fidelity === "parametric" ? [] : (s.grooves ?? [])).map((g, i) => ({
    field: `grooves[${i}]/type`,
    ref: g.type,
    kind: "groove" as const,
  }));
  if (s.fidelity === "parametric" && s.generator === "tslot") {
    const p = s.params as { groove: string; grooves?: { type?: string }[] };
    out.push({ field: "params/groove", ref: p.groove, kind: "groove" });
    p.grooves?.forEach((g, i) => {
      if (g.type) out.push({ field: `params/grooves[${i}]/type`, ref: g.type, kind: "groove" });
    });
  }
  return out;
}

export interface LinkResult {
  set: CatalogSet;
  diagnostics: Diagnostic[];
}

/**
 * Links loaded catalogs: refuses a duplicate catalog id, checks every reference resolves to an
 * entity of the right kind, and fills clones' ratings from their originals.
 */
export function linkCatalogs(loaded: readonly LoadedCatalog[]): LinkResult {
  const set = new CatalogSet();
  const diagnostics: Diagnostic[] = [];
  const error = (code: string, message: string, files: string[], entity?: string, field?: string) =>
    diagnostics.push({ severity: "error", code, entity, field, files, message });

  for (const cat of loaded) {
    const prev = set.catalogs.get(cat.id);
    if (prev) {
      error(
        "duplicate-id",
        `two catalogs claim the id "${cat.id}"`,
        [`${prev.dir}/catalog.json`, `${cat.dir}/catalog.json`],
        cat.id,
      );
      continue;
    }
    // A copy with its own item and offer maps: filling clones' ratings and rails' factory end
    // distances must not change the caller's catalog.
    set.catalogs.set(cat.id, { ...cat, items: new Map(cat.items), offers: new Map(cat.offers) });
  }

  const checkRefs = (sites: RefSite[], from: string, entity: string, files: string[]) => {
    for (const site of sites) {
      if (set.get(site.kind, site.ref, from)) continue;
      const { catalog } = splitRef(site.ref, from);
      if (!set.catalogs.has(catalog)) {
        error(
          "ref-unknown-catalog",
          `"${site.ref}" names catalog "${catalog}", which is not loaded`,
          files,
          entity,
          site.field,
        );
      } else {
        error(
          "ref-unknown",
          `"${site.ref}" is not a ${site.kind} in catalog "${catalog}"`,
          files,
          entity,
          site.field,
        );
      }
    }
  };

  for (const cat of set.catalogs.values()) {
    for (const li of cat.items.values()) checkRefs(itemRefs(li.item), cat.id, li.id, li.files);
    for (const [sku, offer] of cat.offers) {
      checkRefs(offerRefs(offer), cat.id, `${cat.id}:offers/${sku}`, [`${cat.dir}/offers.json`]);
    }
    for (const s of cat.sections.values()) {
      checkRefs(sectionRefs(s.section), cat.id, `${cat.id}:sections/${s.id}`, [s.file]);
    }
    for (const [local, sys] of cat.systems) {
      if (sys.type === "tslot") {
        checkRefs(
          [{ field: "groove", ref: sys.groove, kind: "groove" }],
          cat.id,
          `${cat.id}:systems/${local}`,
          [`${cat.dir}/catalog.json`],
        );
      }
    }
  }

  // Clones: ratings the clone does not state come from its original, tagged as estimates.
  for (const cat of set.catalogs.values()) {
    for (const [local, li] of cat.items) {
      const ref = li.item.clone_of?.item;
      if (!ref) continue;
      const orig = set.get("item", ref, cat.id);
      if (!orig) continue; // reported above
      if (orig.value.item.kind !== li.item.kind) {
        error(
          "clone-kind",
          `clone_of ${orig.id} is a ${orig.value.item.kind}, this is a ${li.item.kind}`,
          li.files,
          li.id,
          "clone_of/item",
        );
        continue;
      }
      if (orig.value.item.clone_of) {
        error(
          "clone-chain",
          `clone_of ${orig.id}, which is itself a clone; point at the original`,
          li.files,
          li.id,
          "clone_of/item",
        );
        continue;
      }
      cat.items.set(local, withCloneRatings(li, orig.value));
    }
  }

  // Rails' stock offers that do not state factory_E_mm take the centred layout's, as an estimate.
  for (const cat of set.catalogs.values()) {
    for (const [sku, offer] of cat.offers) {
      if (offer.sale?.mode !== "stock" || offer.sale.factory_E_mm !== undefined) continue;
      const item = set.get("item", offer.item, cat.id)?.value.item;
      if (item?.kind !== "bar") continue;
      const e = factoryE(item, offer);
      if (e !== undefined)
        cat.offers.set(sku, { ...offer, sale: { ...offer.sale, factory_E_mm: e } });
    }
  }

  return { set, diagnostics };
}

/** A clone with the ratings it lacks filled from its original, each tagged `est` (§3.4). */
function withCloneRatings(clone: LoadedItem, orig: LoadedItem): LoadedItem {
  const own = (clone.item.ratings ?? {}) as Record<string, unknown>;
  const theirs = (orig.item.ratings ?? {}) as Record<string, unknown>;
  const ratings: Record<string, unknown> = { ...own };
  const sources = new Map<string, Source>(clone.sources);
  const note = `from ${orig.id}, the original of this clone; a clone is not guaranteed to match it`;
  for (const [key, value] of Object.entries(theirs)) {
    if (Object.hasOwn(own, key)) continue;
    // The original's own provenance for this value: its per-field one, else the item's default.
    const ref = (isValuedObject(value) ? value.ref : undefined) ?? orig.item.prov.ref;
    const read = (isValuedObject(value) ? value.read : undefined) ?? orig.item.prov.read;
    ratings[key] =
      typeof value === "number" || isValuedObject(value)
        ? {
            v: num(value as number),
            src: "est",
            ...(ref ? { ref } : {}),
            ...(read ? { read } : {}),
            note,
          }
        : value;
    sources.set(`ratings/${key}`, {
      file: orig.files[0] ?? orig.id,
      layer: "clone",
      from: orig.id,
    });
  }
  return { ...clone, item: { ...clone.item, ratings } as Item, sources };
}

/** A section's geometry, built: drawn for every fidelity, with properties where they mean something. */
export interface BuiltSection {
  id: string;
  fidelity: LoadedSection["section"]["fidelity"];
  props_ok: boolean;
  /** For drawing. */
  draw: Region;
  /** For properties (a threaded rod's stress area); the drawn region otherwise. */
  props: Region;
  bbox_mm: readonly [Vec2, Vec2];
  grooves: { face: Face; at_mm: number; type?: string }[];
  datums: Record<string, Vec2>;
}

function boxRing([a, b]: readonly [Vec2, Vec2]): Vec2[] {
  return [
    [a[0], a[1]],
    [b[0], a[1]],
    [b[0], b[1]],
    [a[0], b[1]],
  ];
}

/**
 * Builds a section's geometry: generators run here, with groove types resolved through the set.
 * Returns the problems instead when it cannot be built.
 */
export function buildSection(
  set: CatalogSet,
  ls: LoadedSection,
): BuiltSection | { problems: string[] } {
  const s = ls.section;
  if (s.fidelity === "parametric") {
    const gen = GENERATORS[s.generator];
    if (!gen) return { problems: [`no generator "${s.generator}"`] };
    const ctx = {
      groove(ref: string): GrooveDims | undefined {
        const g = set.get("groove", ref, ls.catalog)?.value;
        return (
          g && {
            opening_mm: num(g.opening_mm),
            lip_mm: num(g.lip_mm),
            depth_mm: num(g.depth_mm),
            undercut_mm: num(g.undercut_mm),
            ...(g.taper_from_mm !== undefined && g.bottom_mm !== undefined
              ? { taper_from_mm: num(g.taper_from_mm), bottom_mm: num(g.bottom_mm) }
              : {}),
          }
        );
      },
    };
    const problems = gen.problems(s.params, ctx);
    if (problems.length > 0) return { problems };
    const g = gen.generate(s.params, ctx);
    const draw = { outline: g.outline, holes: g.holes };
    return {
      id: s.id,
      fidelity: s.fidelity,
      props_ok: s.props_ok,
      draw,
      props: g.props ?? draw,
      bbox_mm: g.bbox_mm,
      grooves: g.grooves,
      datums: g.datums,
    };
  }
  if (s.fidelity === "box") {
    const draw = { outline: boxRing(s.bbox_mm), holes: [] };
    return {
      id: s.id,
      fidelity: s.fidelity,
      props_ok: false,
      draw,
      props: draw,
      bbox_mm: s.bbox_mm,
      grooves: s.grooves ?? [],
      datums: s.datums ?? {},
    };
  }
  const draw = { outline: s.outline, holes: s.holes ?? [] };
  try {
    sectionProperties([draw]);
  } catch (e) {
    return { problems: [e instanceof Error ? e.message : String(e)] };
  }
  return {
    id: s.id,
    fidelity: s.fidelity,
    props_ok: s.props_ok,
    draw,
    props: draw,
    bbox_mm: s.bbox_mm,
    grooves: s.grooves ?? [],
    datums: s.datums ?? {},
  };
}
