import { checkCatalog } from "#catalog/check.ts";
import { jsonSchema, SCHEMA_NAMES, type SchemaName } from "#catalog/json-schema.ts";
import { buildSection } from "#catalog/link.ts";
import { splitRef } from "#catalog/load.ts";
import { openCatalog } from "#catalog/open.ts";
import { reportJson, reportText } from "#catalog/report.ts";
import { QUANTUM, quantize } from "#core/quantum.ts";
import { sectionProperties } from "#core/section-properties.ts";
import { importCommand } from "./catalog-import.ts";
import { searchCommand } from "./catalog-search.ts";
import { CATALOG_USAGE, CATALOG_USAGES } from "./catalog-usage.ts";
import type { Io } from "./cli.ts";

/**
 * `alukit catalog check | show | search | schema | import` (design §3.6, §7.3, §7.4, §11). Exit
 * codes: 0 fine, 1 the catalog has errors, the item or the search found nothing, or the importer
 * could not run or failed, 2 a usage error.
 */

export { CATALOG_USAGE };

interface Args {
  positional: string[];
  catalogs: string[];
  json: boolean;
  /** A subcommand's own options: `--kind bar`, `--fetch`. */
  values: Record<string, string>;
  flags: Set<string>;
}

/** Each subcommand's own options, besides `--catalog` and `--json`. */
const OPTIONS: Readonly<Record<string, { values: readonly string[]; flags: readonly string[] }>> = {
  search: { values: ["kind", "prefer", "limit"], flags: [] },
  import: { values: ["python", "snapshot", "pdf", "out"], flags: ["fetch"] },
};

function parse(sub: string | undefined, argv: readonly string[]): Args | string {
  const own = OPTIONS[sub ?? ""] ?? { values: [], flags: [] };
  const out: Args = { positional: [], catalogs: [], json: false, values: {}, flags: new Set() };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    const name = a.slice(2);
    if (a === "--json") out.json = true;
    else if (a === "--catalog") {
      const dir = argv[++i];
      if (dir === undefined) return "--catalog needs a folder";
      out.catalogs.push(dir);
    } else if (a.startsWith("--") && own.values.includes(name)) {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) return `${a} needs a value`;
      out.values[name] = v;
    } else if (a.startsWith("--") && own.flags.includes(name)) out.flags.add(name);
    else if (a.startsWith("--")) return `unknown option ${a}`;
    else out.positional.push(a);
  }
  return out;
}

async function search(args: Args, io: Io): Promise<number> {
  const query = args.positional.join(" ").trim();
  const kind = args.values.kind;
  if (query === "" && kind === undefined) {
    io.err(`usage: ${CATALOG_USAGES.search[0]}`);
    return 2;
  }
  const limit = args.values.limit;
  if (limit !== undefined && !/^[1-9]\d{0,5}$/.test(limit)) {
    io.err("alukit catalog search: --limit takes a whole number, 1 or more");
    return 2;
  }
  const prefer = args.values.prefer;
  return searchCommand(
    {
      query,
      ...(kind !== undefined ? { kind } : {}),
      ...(prefer !== undefined ? { prefer } : {}),
      catalogs: args.catalogs,
      ...(limit !== undefined ? { limit: Number(limit) } : {}),
      json: args.json,
    },
    io,
  );
}

async function importCatalog(args: Args, io: Io): Promise<number> {
  const [name, ...rest] = args.positional;
  if (name === undefined || rest.length > 0 || args.catalogs.length > 0 || args.json) {
    io.err(`usage: ${CATALOG_USAGES.import[0]}`);
    return 2;
  }
  const v = args.values;
  return importCommand(
    {
      name,
      ...(v.python !== undefined ? { python: v.python } : {}),
      ...(v.snapshot !== undefined ? { snapshot: v.snapshot } : {}),
      ...(v.pdf !== undefined ? { pdf: v.pdf } : {}),
      ...(v.out !== undefined ? { out: v.out } : {}),
      fetch: args.flags.has("fetch"),
    },
    io,
  );
}

function json(x: unknown): string {
  return JSON.stringify(x, null, 2);
}

async function check(args: Args, io: Io): Promise<number> {
  const [target, ...rest] = args.positional;
  if (target === undefined || rest.length > 0) {
    io.err(`usage: ${CATALOG_USAGES.check[0]}`);
    return 2;
  }
  const opened = await openCatalog(target, { extra: args.catalogs });
  const report = checkCatalog(opened.set, opened.target ?? target, opened.diagnostics);
  io.out(args.json ? json(reportJson(report)) : reportText(report));
  return report.counts.errors > 0 ? 1 : 0;
}

const SECTION_QUANTA = {
  area_mm2: 100,
  Ix_mm4: 100,
  Iy_mm4: 100,
  Ixy_mm4: 100,
  I1_mm4: 100,
  I2_mm4: 100,
  Wx_mm3: 100,
  Wy_mm3: 100,
} as const;

async function show(args: Args, io: Io): Promise<number> {
  const [id, ...rest] = args.positional;
  if (id === undefined || rest.length > 0 || !id.includes(":")) {
    io.err(`usage: ${CATALOG_USAGES.show[0]}`);
    return 2;
  }
  const { catalog } = splitRef(id, "");
  const [first, ...others] = args.catalogs;
  const opened = await openCatalog(first ?? catalog, { extra: others });
  const found = opened.set.get("item", id, catalog);
  if (!found) {
    for (const d of opened.diagnostics.filter((x) => x.severity === "error"))
      io.err(`${d.code}: ${d.message}`);
    io.err(`alukit catalog show: no item ${id}`);
    return 1;
  }
  const li = found.value;
  const it = li.item;
  let section: unknown;
  if (it.kind === "bar") {
    const ls = opened.set.get("section", it.section, li.catalog);
    const b = ls && buildSection(opened.set, ls.value);
    if (ls && b && !("problems" in b)) {
      const p = sectionProperties([b.props]);
      const computed: Record<string, unknown> = {
        centroid_mm: p.centroid_mm.map((v) => quantize(v, QUANTUM.len_mm)),
        principal_deg: quantize(p.principal_deg, QUANTUM.ang_deg),
      };
      for (const [k, perUnit] of Object.entries(SECTION_QUANTA)) {
        computed[k] = quantize(p[k as keyof typeof SECTION_QUANTA], perUnit);
      }
      section = {
        id: ls.id,
        file: ls.value.file,
        fidelity: b.fidelity,
        props_ok: b.props_ok,
        bbox_mm: b.bbox_mm,
        grooves: b.grooves,
        datums: b.datums,
        computed,
      };
    } else if (ls && b && "problems" in b) {
      section = { id: ls.id, problems: b.problems };
    }
  }
  const sources: Record<string, string> = {};
  for (const [path, s] of [...li.sources.entries()].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )) {
    if (path === "") continue;
    sources[path] = s.from ? `${s.from} (clone_of)` : `${s.file} (layer ${s.layer})`;
  }
  const offers = opened.set.offersOf(li.id).map(({ catalog: c, sku, offer }) => ({
    sku: `${c.id}:${sku}`,
    supplier: offer.supplier ?? c.vendor,
    currency: c.currency,
    ...offer,
  }));
  io.out(
    json({
      id: li.id,
      files: li.files,
      item: it,
      sources,
      corrected: li.corrected,
      accepted: li.accepted,
      ...(section ? { section } : {}),
      offers,
    }),
  );
  return 0;
}

function schema(args: Args, io: Io): number {
  const [name, ...rest] = args.positional;
  if (rest.length > 0 || (name !== undefined && !SCHEMA_NAMES.includes(name as SchemaName))) {
    io.err(`usage: ${CATALOG_USAGES.schema[0]}`);
    return 2;
  }
  if (name !== undefined) io.out(json(jsonSchema(name as SchemaName)));
  else io.out(json(Object.fromEntries(SCHEMA_NAMES.map((n) => [n, jsonSchema(n)]))));
  return 0;
}

export async function catalogCommand(argv: readonly string[], io: Io): Promise<number> {
  const [sub, ...rest] = argv;
  const args = parse(sub, rest);
  if (typeof args === "string") {
    io.err(`alukit catalog: ${args}`);
    return 2;
  }
  switch (sub) {
    case "check":
      return check(args, io);
    case "show":
      return show(args, io);
    case "schema":
      return schema(args, io);
    case "search":
      return search(args, io);
    case "import":
      return importCatalog(args, io);
    default:
      io.err(`usage:\n${CATALOG_USAGE}`);
      return 2;
  }
}
