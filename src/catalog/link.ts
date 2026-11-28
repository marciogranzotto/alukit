import { type Region, sectionProperties, type Vec2 } from "#core/section-properties.ts";
import type { Diagnostic } from "./diagnostics.ts";
import { type LoadedCatalog, type LoadedItem, type LoadedSection, splitRef } from "./load.ts";
import type { Source } from "./merge.ts";
import { factoryE } from "./rails.ts";
import { type Face, isValuedObject, num, type Src } from "./schema/common.ts";
import type { GrooveType, Material, Standard, System } from "./schema/files.ts";
import { type GrooveGeometry, type OwnGroove, ownGroove } from "./schema/groove.ts";
import type { FastenerItem, Item } from "./schema/items.ts";
import type { Offer } from "./schema/offers.ts";
import {
  GENERATORS,
  type GeneratorContext,
  type GrooveDims,
  type SectionCore,
} from "./sections/generators/index.ts";
import { coreProblems } from "./sections/geometry.ts";

/**
 * Several loaded catalogs, linked (design §3.1): references resolve across them, a catalog id
 * claimed twice is an error naming both folders, and a clone's ratings resolve from its
 * original (§3.4).
 */

export type EntityKind =
  | "item"
  | "section"
  | "material"
  | "groove"
  | "system"
  | "standard"
  | "offer";

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
  standard: Standard;
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
      standard: cat.standards,
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
      add("standard/id", item.standard?.id, "standard");
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

  // Fasteners made to a standard: the dimensions they do not state come from its row for their
  // thread (after the alternative frame's acceptance, F2a).
  for (const cat of set.catalogs.values()) {
    for (const [local, li] of cat.items) {
      if (li.item.kind !== "fastener" || !li.item.standard) continue;
      const std = set.get("standard", li.item.standard.id, cat.id);
      if (!std) continue; // reported above
      const size = li.item.thread;
      const row = size === undefined ? undefined : std.value.sizes[size];
      if (!row) {
        error(
          "standard-size",
          size === undefined
            ? `standard ${std.id} is read at the fastener's thread, and it gives none`
            : `standard ${std.id} (${std.value.name}) has no row for ${size}`,
          li.files,
          li.id,
          size === undefined ? "thread" : "standard/id",
        );
        continue;
      }
      cat.items.set(local, withStandardDims(li, li.item, std, size as string, row));
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

/**
 * A fastener with the dimensions it does not state filled from its standard's row for its thread
 * (after the alternative frame's acceptance, F2a). What the item states wins. Each filled value
 * keeps the table's own provenance, an estimate when the item is only taken to be made to the
 * standard (its `standard.src` is `est`), and says where it came from.
 */
function withStandardDims(
  li: LoadedItem,
  item: FastenerItem,
  std: Resolved<Standard>,
  size: string,
  row: Readonly<Record<string, unknown>>,
): LoadedItem {
  const own = (item.dims ?? {}) as Record<string, unknown>;
  const cited = item.standard as NonNullable<FastenerItem["standard"]>;
  const dims: Record<string, unknown> = { ...own };
  const sources = new Map<string, Source>(li.sources);
  const how =
    cited.src === "est" ? "the standard it is taken to be made to" : "the standard it cites";
  for (const [key, value] of Object.entries(row)) {
    if (Object.hasOwn(own, key)) continue;
    const obj = isValuedObject(value) ? value : undefined;
    const ref = obj?.ref ?? std.value.prov?.ref;
    const read = obj?.read ?? std.value.prov?.read;
    dims[key] = {
      v: num(value as number),
      src: cited.src === "est" ? "est" : (obj?.src ?? std.value.prov?.src ?? "src"),
      ...(ref ? { ref } : {}),
      ...(read ? { read } : {}),
      note: `from ${std.id}'s row for ${size}, ${how}`,
    };
    sources.set(`dims/${key}`, {
      file: `${std.catalog.dir}/catalog.json`,
      layer: "standard",
      from: std.id,
    });
  }
  return { ...li, item: { ...item, dims } as Item, sources };
}

/**
 * The provenance of a value computed from a section (§3.5's fidelity table, *2.3*): `est` from a
 * traced outline, which carries the trace's uncertainty; `calc` from an exact outline or a
 * generator's closed form. A box has no computed properties to tag.
 */
export function computedSrc(fidelity: BuiltSection["fidelity"]): Src {
  return fidelity === "traced" ? "est" : "calc";
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
  /**
   * Its grooves' own dimensions, stated over their groove type's, and those its drawing does not
   * give (after the round-4 acceptance, F9); absent when it states none.
   */
  own?: OwnGroove;
  datums: Record<string, Vec2>;
  /**
   * Its cores, where an end tap is cut (§5.5), in section coordinates: a generator's, where its
   * params give them (a `tslot`'s `bores`), or a drawn section's `cores`, each checked to be one
   * of its holes. Absent when not known: a drawn section's holes alone do not say which is a core,
   * and a box has none drawn.
   */
  cores?: readonly SectionCore[];
  /**
   * How far its drawn outline's edges may lie from the section's (§3.5), where its file states it
   * (`from.uncertainty`, which a traced section must); absent for a generator's or a box.
   */
  uncertainty?: { overall_mm: number; local_mm: number };
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
/** A generator's context for a section: its groove types, resolved in the section's catalog. */
export function generatorContext(set: CatalogSet, ls: LoadedSection): GeneratorContext {
  return {
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
          ...(g.hook_mm !== undefined && g.wall_mm !== undefined
            ? { hook_mm: num(g.hook_mm), wall_mm: num(g.wall_mm) }
            : {}),
        }
      );
    },
  };
}

export function buildSection(
  set: CatalogSet,
  ls: LoadedSection,
): BuiltSection | { problems: string[] } {
  const s = ls.section;
  if (s.fidelity === "parametric") {
    const gen = GENERATORS[s.generator];
    if (!gen) return { problems: [`no generator "${s.generator}"`] };
    const ctx = generatorContext(set, ls);
    const problems = gen.problems(s.params, ctx);
    if (problems.length > 0) return { problems };
    const g = gen.generate(s.params, ctx);
    const draw = { outline: g.outline, holes: g.holes };
    const own = ownGroove((s.params as { groove_dims?: GrooveGeometry }).groove_dims);
    return {
      id: s.id,
      fidelity: s.fidelity,
      props_ok: s.props_ok,
      draw,
      props: g.props ?? draw,
      bbox_mm: g.bbox_mm,
      grooves: g.grooves,
      ...(own ? { own } : {}),
      datums: g.datums,
      ...(g.cores ? { cores: g.cores } : {}),
    };
  }
  if (s.fidelity === "box") {
    const draw = { outline: boxRing(s.bbox_mm), holes: [] };
    const own = ownGroove(s.groove_dims);
    return {
      id: s.id,
      fidelity: s.fidelity,
      props_ok: false,
      draw,
      props: draw,
      bbox_mm: s.bbox_mm,
      grooves: s.grooves ?? [],
      ...(own ? { own } : {}),
      datums: s.datums ?? {},
    };
  }
  const draw = { outline: s.outline, holes: s.holes ?? [] };
  try {
    sectionProperties([draw]);
  } catch (e) {
    return { problems: [e instanceof Error ? e.message : String(e)] };
  }
  const problems = coreProblems(s.cores ?? [], draw.holes);
  if (problems.length > 0) return { problems };
  const own = ownGroove(s.groove_dims);
  return {
    id: s.id,
    fidelity: s.fidelity,
    props_ok: s.props_ok,
    draw,
    props: draw,
    bbox_mm: s.bbox_mm,
    grooves: s.grooves ?? [],
    ...(own ? { own } : {}),
    datums: s.datums ?? {},
    ...(s.cores ? { cores: s.cores } : {}),
    ...(s.from?.uncertainty ? { uncertainty: s.from.uncertainty } : {}),
  };
}
