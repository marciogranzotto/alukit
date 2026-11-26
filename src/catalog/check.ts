import { compareIds } from "#core/ids.ts";
import { type SectionProperties, sectionProperties } from "#core/section-properties.ts";
import { type Diagnostic, sortDiagnostics } from "./diagnostics.ts";
import { type BuiltSection, buildSection, type CatalogSet } from "./link.ts";
import { type LoadedCatalog, type LoadedItem, splitRef } from "./load.ts";
import { num, type Valued } from "./schema/common.ts";
import type { BarItem } from "./schema/items.ts";

/**
 * `alukit catalog check` (design §3.6): computed against published for every bar with a
 * section, plus the rules that span files and catalogs: references, stale overrides and family
 * collisions (reported by the loader), offers against their items, and options without offers.
 */

/** Beyond this relative difference a published value is a mismatch, unless accepted (§3.6). */
export const MISMATCH = 0.01;
/** A traced outline is accepted only within this of the published area (§3.5). */
export const TRACED_AREA = 0.02;
/** A drawn outline's box may differ from the declared nominal box by this much (mm). */
export const BBOX_SLACK_MM = 0.1;

export const COMPARED = [
  "area_mm2",
  "Ix_mm4",
  "Iy_mm4",
  "Wx_mm3",
  "Wy_mm3",
  "mass_kg_per_m",
] as const;
export type Compared = (typeof COMPARED)[number];

export type RowStatus = "ok" | "mismatch" | "accepted" | "computed";

/** One line of the computed-against-published table. */
export interface PropertyRow {
  item: string;
  section: string;
  fidelity: string;
  field: Compared;
  computed: number;
  published?: number;
  /** computed / published − 1. */
  diff?: number;
  status: RowStatus;
  /** For `accepted`: the override's reason. */
  why?: string;
}

export interface CheckReport {
  catalog: string;
  rows: PropertyRow[];
  /** Bars whose section gives no computed properties (`props_ok: false`, or a box). */
  uncomputed: string[];
  diagnostics: Diagnostic[];
  counts: { items: number; offers: number; sections: number; errors: number; warnings: number };
}

/** The shape each parametric generator draws; a bar of another shape on it is suspicious. */
const SHAPE_OF_GENERATOR: Record<string, string> = {
  tslot: "tslot",
  rhs: "rhs",
  tube: "tube",
  rod: "rod",
  "threaded-rod": "threaded-rod",
  flat: "flat",
  angle: "angle",
  rail: "rail",
};

/** Computed values for the compared fields; mass needs the material's density. */
export function computedValues(
  set: CatalogSet,
  li: LoadedItem,
  props: SectionProperties,
): Partial<Record<Compared, number>> {
  const out: Partial<Record<Compared, number>> = {
    area_mm2: props.area_mm2,
    Ix_mm4: props.Ix_mm4,
    Iy_mm4: props.Iy_mm4,
    Wx_mm3: props.Wx_mm3,
    Wy_mm3: props.Wy_mm3,
  };
  const material = li.item.material ? set.get("material", li.item.material, li.catalog) : undefined;
  const density = material?.value.density_kg_per_m3;
  // mm² × kg/m³ × 1e-6 m²/mm² = kg/m
  if (density !== undefined) out.mass_kg_per_m = props.area_mm2 * num(density) * 1e-6;
  return out;
}

export function checkCatalog(
  set: CatalogSet,
  catalogId: string,
  earlier: readonly Diagnostic[] = [],
): CheckReport {
  const ds: Diagnostic[] = [...earlier];
  const rows: PropertyRow[] = [];
  const cat = set.catalogs.get(catalogId);
  if (!cat) {
    const sorted = sortDiagnostics(ds);
    const errors = sorted.filter((d) => d.severity === "error").length;
    return {
      catalog: catalogId,
      rows,
      uncomputed: [],
      diagnostics: sorted,
      counts: { items: 0, offers: 0, sections: 0, errors: Math.max(errors, 1), warnings: 0 },
    };
  }
  const add = (
    severity: Diagnostic["severity"],
    code: string,
    message: string,
    files: string[],
    entity?: string,
    field?: string,
  ) => ds.push({ severity, code, entity, field, files, message });

  // Sections: build each once.
  const built = new Map<string, BuiltSection>();
  for (const ls of cat.sections.values()) {
    const b = buildSection(set, ls);
    const entity = `${cat.id}:sections/${ls.id}`;
    if ("problems" in b) {
      for (const p of b.problems) add("error", "section-invalid", p, [ls.file], entity);
      continue;
    }
    built.set(ls.id, b);
    const s = ls.section;
    if (s.fidelity === "exact" || s.fidelity === "traced") {
      const actual = sectionProperties([b.draw]).bbox_mm;
      const off = Math.max(
        Math.abs(actual[0][0] - b.bbox_mm[0][0]),
        Math.abs(actual[0][1] - b.bbox_mm[0][1]),
        Math.abs(actual[1][0] - b.bbox_mm[1][0]),
        Math.abs(actual[1][1] - b.bbox_mm[1][1]),
      );
      if (off > BBOX_SLACK_MM) {
        add(
          "warn",
          "section-bbox",
          `the outline's box differs from the declared bbox_mm by ${off.toFixed(3)} mm (more than ${BBOX_SLACK_MM} mm)`,
          [ls.file],
          entity,
        );
      }
    }
  }

  const items = [...cat.items.values()].sort((a, b) => compareIds(a.id, b.id));
  const uncomputed: string[] = [];
  for (const li of items) {
    const it = li.item;
    if (it.kind === "bar" && !checkBar(set, li, it, built, rows, add)) uncomputed.push(li.id);
    if (it.kind === "connector") {
      const fits = new Set(it.fits.map((s) => resolved(s, li.catalog)));
      it.mounts?.forEach((m, i) => {
        for (const sys of Object.keys(m.fasteners ?? {})) {
          if (!fits.has(resolved(sys, li.catalog))) {
            add(
              "warn",
              "fastener-set-unfit",
              `a fastener set for ${sys}, which the connector does not fit`,
              li.files,
              li.id,
              `mounts[${i}]/fasteners/${sys}`,
            );
          }
        }
      });
    }
    if (it.kind === "carriage") {
      const sys = set.get("system", it.rail_system, li.catalog);
      if (sys && sys.value.type !== "rail")
        add(
          "error",
          "system-type",
          `rail_system ${sys.id} is not a rail system`,
          li.files,
          li.id,
          "rail_system",
        );
    }
    // Every option of an item with offers has an offer (§3.6).
    const offers = set.offersOf(li.id);
    if (offers.length > 0) {
      for (const [name, values] of Object.entries(it.options ?? {})) {
        for (const v of values) {
          if (!offers.some((o) => o.offer.options?.[name] === v)) {
            add(
              "warn",
              "option-no-offer",
              `option ${name}=${v} has no offer`,
              li.files,
              li.id,
              `options/${name}`,
            );
          }
        }
      }
    }
  }

  checkOffers(set, cat, add);

  if (cat.offers.size > 0 && !cat.currency) {
    add(
      "error",
      "catalog-currency",
      "the catalog has offers but no currency",
      [`${cat.dir}/catalog.json`],
      cat.id,
    );
  }

  const sorted = sortDiagnostics(ds);
  return {
    catalog: cat.id,
    rows,
    uncomputed,
    diagnostics: sorted,
    counts: {
      items: cat.items.size,
      offers: cat.offers.size,
      sections: cat.sections.size,
      errors: sorted.filter((d) => d.severity === "error").length,
      warnings: sorted.filter((d) => d.severity === "warn").length,
    },
  };
}

function resolved(ref: string, from: string): string {
  const { catalog, local } = splitRef(ref, from);
  return `${catalog}:${local}`;
}

type Add = (
  severity: Diagnostic["severity"],
  code: string,
  message: string,
  files: string[],
  entity?: string,
  field?: string,
) => void;

function checkBar(
  set: CatalogSet,
  li: LoadedItem,
  it: BarItem,
  built: Map<string, BuiltSection>,
  rows: PropertyRow[],
  add: Add,
): boolean {
  // System type against shape.
  if (it.shape === "tslot" || it.shape === "rail") {
    const want = it.shape;
    if (!it.system)
      add(
        "error",
        "system-missing",
        `a ${it.shape} bar needs a ${want} system`,
        li.files,
        li.id,
        "system",
      );
    else {
      const sys = set.get("system", it.system, li.catalog);
      if (sys && sys.value.type !== want)
        add(
          "error",
          "system-type",
          `system ${sys.id} is not a ${want} system`,
          li.files,
          li.id,
          "system",
        );
    }
  }
  if (it.shape === "rail" && !it.rail)
    add(
      "error",
      "rail-missing",
      "a rail bar needs its hole pitch and end distances",
      li.files,
      li.id,
      "rail",
    );
  if (it.shape === "threaded-rod" && !it.thread)
    add(
      "warn",
      "thread-missing",
      "a threaded rod should name its thread",
      li.files,
      li.id,
      "thread",
    );

  const ref = set.get("section", it.section, li.catalog);
  if (!ref) return false; // reported by the linker
  const ls = ref.value;
  const s = ls.section;
  if (s.fidelity === "parametric" && SHAPE_OF_GENERATOR[s.generator] !== it.shape) {
    add(
      "warn",
      "shape-generator",
      `a ${it.shape} bar on a section made by the ${s.generator} generator`,
      li.files,
      li.id,
      "section",
    );
  }
  // Sections from another catalog are built on demand.
  const b =
    built.get(ls.id) && ref.catalog.id === li.catalog ? built.get(ls.id) : buildSection(set, ls);
  if (!b || "problems" in b || !b.props_ok) return false;

  const props = sectionProperties([b.props]);
  const computed = computedValues(set, li, props);
  const accepted = new Map(li.accepted.map((a) => [a.field, a.why]));
  for (const field of [
    ...new Set([...Object.keys(computed), ...li.accepted.map((a) => a.field)]),
  ] as Compared[]) {
    const c = computed[field];
    if (c === undefined) continue;
    const pub = it[field] as Valued | undefined;
    const base = { item: li.id, section: ref.id, fidelity: s.fidelity, field, computed: c };
    if (pub === undefined) {
      rows.push({ ...base, status: "computed" });
      continue;
    }
    const published = num(pub);
    const diff = c / published - 1;
    const why = accepted.get(field);
    let status: RowStatus = "ok";
    if (Math.abs(diff) > MISMATCH) status = why === undefined ? "mismatch" : "accepted";
    rows.push({
      ...base,
      published,
      diff,
      status,
      ...(why !== undefined && status === "accepted" ? { why } : {}),
    });
    if (status === "mismatch") {
      add(
        "error",
        "mismatch",
        `computed ${c.toPrecision(6)} against published ${published} (${(diff * 100).toFixed(2)} %, over ${MISMATCH * 100} %); fix the data or accept it in overrides.json`,
        [ls.file, ...li.files],
        li.id,
        field,
      );
    }
    if (status === "ok" && why !== undefined) {
      add(
        "info",
        "accept-unneeded",
        `the accepted mismatch is now within ${MISMATCH * 100} %`,
        li.files,
        li.id,
        field,
      );
    }
    if (field === "area_mm2" && s.fidelity === "traced" && Math.abs(diff) > TRACED_AREA) {
      add(
        "error",
        "traced-area",
        `a traced outline must be within ${TRACED_AREA * 100} % of the published area; it is ${(diff * 100).toFixed(2)} % off`,
        [ls.file],
        li.id,
        field,
      );
    }
  }
  return true;
}

function checkOffers(set: CatalogSet, cat: LoadedCatalog, add: Add): void {
  const file = `${cat.dir}/offers.json`;
  for (const [sku, offer] of cat.offers) {
    const entity = `${cat.id}:offers/${sku}`;
    const item = set.get("item", offer.item, cat.id);
    if (!offer.supplier && !cat.vendor)
      add(
        "error",
        "offer-supplier",
        "no supplier, and the catalog names no vendor",
        [file],
        entity,
        "supplier",
      );
    if (offer.sale?.mode === "cut" && offer.sale.min_mm > offer.sale.max_mm) {
      add("error", "offer-sale", "min_mm is above max_mm", [file], entity, "sale");
    }
    if (!item) continue; // reported by the linker
    const it = item.value.item;
    const isBar = it.kind === "bar";
    if (isBar && !offer.sale)
      add(
        "error",
        "offer-sale-missing",
        "a bar's offer needs a sale rule: cut or stock",
        [file],
        entity,
        "sale",
      );
    if (!isBar && offer.sale)
      add("error", "offer-sale", "only bars have a sale rule", [file], entity, "sale");
    const wantPer = !isBar
      ? "unit"
      : offer.sale?.mode === "cut"
        ? "m"
        : offer.sale?.mode === "stock"
          ? "bar"
          : undefined;
    if (wantPer && offer.price.per !== wantPer) {
      add(
        "error",
        "offer-price-per",
        `the price should be per ${wantPer}, not per ${offer.price.per}`,
        [file],
        entity,
        "price/per",
      );
    }
    const options = it.options ?? {};
    for (const [name, value] of Object.entries(offer.options ?? {})) {
      const allowed = options[name];
      if (!allowed)
        add(
          "error",
          "offer-option",
          `the item has no option "${name}"`,
          [file],
          entity,
          `options/${name}`,
        );
      else if (!allowed.includes(value)) {
        add(
          "error",
          "offer-option",
          `"${value}" is not one of the item's ${name} options (${allowed.join(", ")})`,
          [file],
          entity,
          `options/${name}`,
        );
      }
    }
    for (const name of Object.keys(options)) {
      if (offer.options?.[name] === undefined) {
        add(
          "error",
          "offer-option-missing",
          `the item has a ${name} option; the offer must say which it sells`,
          [file],
          entity,
          "options",
        );
      }
    }
    if (offer.kit) {
      const main = offer.kit[0];
      if (main && resolved(main.item, cat.id) !== item.id) {
        add(
          "error",
          "offer-kit-main",
          `the kit's first entry must be the offer's item, ${item.id}`,
          [file],
          entity,
          "kit[0]/item",
        );
      }
    }
  }
}
