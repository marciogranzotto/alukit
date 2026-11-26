import { checkCatalog } from "#catalog/check.ts";
import { jsonSchema, SCHEMA_NAMES, type SchemaName } from "#catalog/json-schema.ts";
import { buildSection } from "#catalog/link.ts";
import { splitRef } from "#catalog/load.ts";
import { openCatalog } from "#catalog/open.ts";
import { reportJson, reportText } from "#catalog/report.ts";
import { QUANTUM, quantize } from "#core/quantum.ts";
import { sectionProperties } from "#core/section-properties.ts";
import { CATALOG_USAGE } from "./catalog-usage.ts";
import type { Io } from "./cli.ts";

/**
 * `alukit catalog check | show | schema` (design §3.6, §7.3, §7.4). Exit codes: 0 fine, 1 the
 * catalog has errors or the item was not found, 2 a usage error.
 */

export { CATALOG_USAGE };

interface Args {
  positional: string[];
  catalogs: string[];
  json: boolean;
}

function parse(argv: readonly string[]): Args | string {
  const out: Args = { positional: [], catalogs: [], json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (a === "--json") out.json = true;
    else if (a === "--catalog") {
      const dir = argv[++i];
      if (dir === undefined) return "--catalog needs a folder";
      out.catalogs.push(dir);
    } else if (a.startsWith("--")) return `unknown option ${a}`;
    else out.positional.push(a);
  }
  return out;
}

function json(x: unknown): string {
  return JSON.stringify(x, null, 2);
}

async function check(args: Args, io: Io): Promise<number> {
  const [target, ...rest] = args.positional;
  if (target === undefined || rest.length > 0) {
    io.err(`usage: ${CATALOG_USAGE.split("\n")[0]}`);
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
    io.err(`usage: ${CATALOG_USAGE.split("\n")[2]}`);
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
    io.err(`usage: ${CATALOG_USAGE.split("\n")[4]}`);
    return 2;
  }
  if (name !== undefined) io.out(json(jsonSchema(name as SchemaName)));
  else io.out(json(Object.fromEntries(SCHEMA_NAMES.map((n) => [n, jsonSchema(n)]))));
  return 0;
}

export async function catalogCommand(argv: readonly string[], io: Io): Promise<number> {
  const [sub, ...rest] = argv;
  const args = parse(rest);
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
    case "import":
      io.err(`alukit catalog ${sub}: not implemented yet`);
      return 2;
    default:
      io.err(`usage:\n${CATALOG_USAGE}`);
      return 2;
  }
}
