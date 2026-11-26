import { access, mkdir, readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseJson } from "#catalog/json.ts";
import { bomCsv, bomJson, bomMarkdown } from "#core/bom/format.ts";
import { cutListCsv, cutListJson, cutListMarkdown } from "#core/cutlist/format.ts";
import { jsonText } from "#core/derive/output.ts";
import type { Diagnostic } from "#core/diagnostics.ts";
import type { FieldChange } from "#core/lock/diff.ts";
import {
  costsCsv,
  costsJson,
  costsMarkdownDoc,
  money,
  orderCsv,
  orderJson,
  orderMarkdown,
} from "#core/order/format.ts";
import { gitStamp } from "#core/project/git.ts";
import { loadProject, withEditLock, writeAtomic } from "#core/project/store.ts";
import type { Outputs } from "#core/revision/outputs.ts";
import {
  makeRevision,
  REVISIONS_DIR,
  type Revision,
  readRevision,
  revisionSlug,
  storedOutputs,
  verified,
  verifyRevision,
} from "#core/revision/revision.ts";
import { parseOptions, usageError } from "./args.ts";
import { type Io, packageVersion } from "./cli.ts";
import { diagnosticLine, isDate, today } from "./project.ts";
import { publishUsageOf } from "./publish-usage.ts";

/**
 * `alukit revision save | list | show | verify` (design §4.13, §7.3). A revision is
 * `revisions/<slug>.json` in the project folder: the document, its lock, the outputs of every
 * variant and the stamp. A saved revision is never overwritten. `show` prints what was stored;
 * `verify` re-derives from the stored document and lock with this tool, reads nothing else and
 * writes nothing, and exits 1 on any drift.
 */

const USAGE = publishUsageOf("revision");
const OUTPUTS = ["derive", "cutlist", "bom", "order", "costs", "check"] as const;
type OutputName = (typeof OUTPUTS)[number];

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** `[<dir>] <name>`: one positional is the name, in the current folder. */
function dirAndName(positionals: readonly string[]): { dir: string; name?: string } | undefined {
  if (positionals.length === 1) return { dir: ".", name: positionals[0] };
  if (positionals.length === 2) return { dir: positionals[0] as string, name: positionals[1] };
  return undefined;
}

export function revisionFile(root: string, name: string): string {
  return join(root, REVISIONS_DIR, `${revisionSlug(name)}.json`);
}

/** Reads a revision file; prints why it cannot and returns undefined. */
export async function loadRevision(
  path: string,
  io: Io,
  cmd: string,
): Promise<Revision | undefined> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (e) {
    io.err(`alukit ${cmd}: cannot read ${path}: ${e instanceof Error ? e.message : String(e)}`);
    return undefined;
  }
  const parsed = parseJson(text);
  if (!parsed.ok) {
    for (const p of parsed.problems)
      io.err(`alukit ${cmd}: ${path}${p.line ? `:${p.line}` : ""}: ${p.message}`);
    return undefined;
  }
  const r = readRevision(parsed.value);
  if (!r.ok) {
    io.err(`alukit ${cmd}: ${path} is not a revision (${"alukit.revision/1"}):`);
    for (const p of r.problems) io.err(`  ${p}`);
    return undefined;
  }
  return r.value;
}

const variantLabel = (v: string | undefined) => v ?? "(no variant)";

function gitText(r: Revision): string {
  const g = r.stamp.git;
  return g ? `git ${g.commit.slice(0, 12)}${g.dirty ? " (dirty)" : ""}` : "no git commit";
}

function summaryLine(o: Outputs): string {
  const bars = Object.keys((o.derived.bars as Record<string, unknown> | undefined) ?? {}).length;
  const pieces = o.cutlist.groups.reduce((n, g) => n + g.pieces, 0);
  const t = o.order.totals.total;
  const cur = o.order.currency ?? "";
  return `  ${variantLabel(o.variant).padEnd(14)} ${String(bars).padStart(4)} bars  ${String(pieces).padStart(4)} pieces  ${o.bom.mass_kg.toFixed(3).padStart(10)} kg  ${o.order.status.padEnd(7)}  ${cur} ${money(t.likely_minor)} (${money(t.low_minor)} – ${money(t.high_minor)})`;
}

function changeLines(changes: readonly FieldChange[], limit = 20): string[] {
  const shown = (v: unknown) => {
    if (v === undefined) return "(none)";
    const s = JSON.stringify(v);
    return s.length > 80 ? `${s.slice(0, 77)}...` : s;
  };
  const lines = changes
    .slice(0, limit)
    .map((c) => `      ${c.path || "(value)"}: ${shown(c.was)} -> ${shown(c.now)}`);
  if (changes.length > limit) lines.push(`      … and ${changes.length - limit} more`);
  return lines;
}

async function save(argv: readonly string[], io: Io): Promise<number> {
  const args = parseOptions(
    "revision save",
    argv,
    { "as-of": { type: "string" }, frozen: { type: "boolean" }, json: { type: "boolean" } },
    USAGE,
    io,
  );
  if (args === 2) return 2;
  const pos = dirAndName(args.positionals);
  if (!pos?.name) return usageError("revision save", "a revision name is needed", USAGE, io);
  const { name } = pos;
  const slug = revisionSlug(name);
  if (slug === "") {
    return usageError(
      "revision save",
      `"${name}" has no letter or digit to name a file`,
      USAGE,
      io,
    );
  }
  const asOf = args.values["as-of"] ?? today();
  if (!isDate(asOf))
    return usageError("revision save", "--as-of takes a date, YYYY-MM-DD", USAGE, io);
  const root = resolve(pos.dir);
  const path = revisionFile(root, name);
  if (await exists(path)) {
    io.err(
      `alukit revision save: ${join(REVISIONS_DIR, `${slug}.json`)} exists; a revision is never overwritten`,
    );
    return 1;
  }

  const project = await loadProject(root, { frozen: args.values.frozen === true });
  for (const n of project.notices) io.err(`notice: ${n}`);
  if (project.raw === undefined || project.lock === undefined) {
    for (const d of project.diagnostics) io.err(diagnosticLine(d));
    return 1;
  }
  for (const d of project.diagnostics) io.err(diagnosticLine(d));
  const rev = makeRevision({
    name,
    document: project.raw,
    lock: project.lock,
    asOf,
    version: packageVersion(),
    node: process.version,
    git: (await gitStamp(root)) ?? null,
  });
  await withEditLock(root, async () => {
    await mkdir(join(root, REVISIONS_DIR), { recursive: true });
    await writeAtomic(path, jsonText(rev));
  });

  const file = join(REVISIONS_DIR, `${slug}.json`);
  const variants = rev.outputs.map((o) => variantLabel(o.variant));
  const errors = rev.outputs.reduce(
    (n, o) => n + o.check.diagnostics.filter((d) => d.severity === "error").length,
    0,
  );
  if (args.values.json) {
    io.out(jsonText({ file, name, as_of: asOf, stamp: rev.stamp, variants, errors }).trimEnd());
  } else {
    io.out(
      `saved ${file}: "${name}", as of ${asOf}; ${rev.stamp.hash.slice(0, 19)}…, ${gitText(rev)}`,
    );
    for (const o of rev.outputs) io.out(summaryLine(o));
    if (errors > 0)
      io.err(`warn: the model has ${errors} error${errors === 1 ? "" : "s"} (see alukit check)`);
  }
  return 0;
}

async function list(argv: readonly string[], io: Io): Promise<number> {
  const args = parseOptions("revision list", argv, { json: { type: "boolean" } }, USAGE, io);
  if (args === 2) return 2;
  if (args.positionals.length > 1) {
    return usageError("revision list", `unexpected argument ${args.positionals[1]}`, USAGE, io);
  }
  const root = resolve(args.positionals[0] ?? ".");
  let files: string[] = [];
  try {
    files = (await readdir(join(root, REVISIONS_DIR))).filter((f) => f.endsWith(".json")).sort();
  } catch {
    // no revisions yet
  }
  const rows: {
    file: string;
    name: string;
    as_of: string;
    alukit: string;
    git: Revision["stamp"]["git"];
    variants: string[];
  }[] = [];
  let bad = 0;
  for (const f of files) {
    const r = await loadRevision(join(root, REVISIONS_DIR, f), io, "revision list");
    if (!r) {
      bad++;
      continue;
    }
    rows.push({
      file: join(REVISIONS_DIR, f),
      name: r.name,
      as_of: r.as_of,
      alukit: r.stamp.alukit,
      git: r.stamp.git,
      variants: r.outputs.map((o) => variantLabel(o.variant)),
    });
  }
  if (args.values.json) io.out(jsonText(rows).trimEnd());
  else if (rows.length === 0) io.out("no revisions");
  else {
    for (const r of rows) {
      const g = r.git ? `${r.git.commit.slice(0, 12)}${r.git.dirty ? "+" : ""}` : "-";
      io.out(
        `${r.file.padEnd(28)} ${r.as_of}  alukit ${r.alukit}  ${g.padEnd(13)} "${r.name}"  ${r.variants.join(", ")}`,
      );
    }
  }
  return bad > 0 ? 1 : 0;
}

function printOutput(o: Outputs, what: OutputName, format: "md" | "csv" | "json", io: Io): void {
  const stderr = (ds: readonly Diagnostic[]) => {
    for (const d of ds) io.err(diagnosticLine(d));
  };
  switch (what) {
    case "derive":
      io.out(jsonText(o.derived).trimEnd());
      return;
    case "check":
      io.out(jsonText(o.check).trimEnd());
      return;
    case "cutlist":
      if (format === "json") io.out(cutListJson(o.cutlist).trimEnd());
      else {
        const shown = { ...o.cutlist, diagnostics: [] };
        io.out((format === "csv" ? cutListCsv(shown) : cutListMarkdown(shown)).trimEnd());
        stderr(o.cutlist.diagnostics);
      }
      return;
    case "bom":
      if (format === "json") io.out(bomJson(o.bom).trimEnd());
      else {
        const shown = { ...o.bom, diagnostics: [] };
        io.out((format === "csv" ? bomCsv(shown) : bomMarkdown(shown)).trimEnd());
        stderr(o.bom.diagnostics);
      }
      return;
    case "order":
      if (format === "json") io.out(orderJson(o.order).trimEnd());
      else {
        const shown = { ...o.order, diagnostics: [] };
        io.out((format === "csv" ? orderCsv(shown) : orderMarkdown(shown)).trimEnd());
        stderr(o.order.diagnostics);
      }
      return;
    case "costs":
      if (format === "json") io.out(costsJson(o.costs).trimEnd());
      else {
        const shown = { ...o.costs, diagnostics: [] };
        io.out((format === "csv" ? costsCsv(shown) : costsMarkdownDoc(shown)).trimEnd());
        stderr(o.costs.diagnostics);
      }
      return;
  }
}

async function show(argv: readonly string[], io: Io): Promise<number> {
  const args = parseOptions(
    "revision show",
    argv,
    { variant: { type: "string" }, output: { type: "string" }, format: { type: "string" } },
    USAGE,
    io,
  );
  if (args === 2) return 2;
  const pos = dirAndName(args.positionals);
  if (!pos?.name) return usageError("revision show", "a revision name is needed", USAGE, io);
  const what = args.values.output;
  if (what !== undefined && !(OUTPUTS as readonly string[]).includes(what)) {
    return usageError("revision show", `--output takes ${OUTPUTS.join(", ")}`, USAGE, io);
  }
  const format = args.values.format ?? "md";
  if (format !== "md" && format !== "csv" && format !== "json") {
    return usageError("revision show", "--format takes md, csv or json", USAGE, io);
  }
  const r = await loadRevision(revisionFile(resolve(pos.dir), pos.name), io, "revision show");
  if (!r) return 1;
  const v = args.values.variant;
  const o = storedOutputs(r, v);
  if (!o) {
    io.err(
      `alukit revision show: "${r.name}" stores no outputs for ${v === undefined ? "the document without a variant" : `variant ${v}`}; it has ${r.outputs.map((x) => variantLabel(x.variant)).join(", ")}`,
    );
    return 1;
  }
  if (what !== undefined) {
    printOutput(o, what as OutputName, format, io);
    return 0;
  }
  if (format === "json") {
    io.out(
      jsonText({
        name: r.name,
        as_of: r.as_of,
        stamp: r.stamp,
        variants: r.outputs.map((x) => x.variant ?? null),
      }).trimEnd(),
    );
    return 0;
  }
  io.out(
    `"${r.name}", as of ${r.as_of}: alukit ${r.stamp.alukit} on Node ${r.stamp.node}, ${gitText(r)}`,
  );
  io.out(`stamp ${r.stamp.hash}`);
  for (const x of r.outputs) io.out(summaryLine(x));
  return 0;
}

async function verify(argv: readonly string[], io: Io): Promise<number> {
  const args = parseOptions("revision verify", argv, { json: { type: "boolean" } }, USAGE, io);
  if (args === 2) return 2;
  const pos = dirAndName(args.positionals);
  if (!pos?.name) return usageError("revision verify", "a revision name is needed", USAGE, io);
  const r = await loadRevision(revisionFile(resolve(pos.dir), pos.name), io, "revision verify");
  if (!r) return 1;
  const v = verifyRevision(r, packageVersion());
  const ok = verified(v);
  if (args.values.json) {
    io.out(jsonText({ name: r.name, ok, ...v }).trimEnd());
    return ok ? 0 : 1;
  }
  io.out(
    `"${r.name}", as of ${r.as_of}: saved by alukit ${r.stamp.alukit} on Node ${r.stamp.node}`,
  );
  if (v.version) io.out(`note: re-derived with alukit ${v.version.now}`);
  if (!v.intact) io.out("CHANGED: the stored document or lock no longer hashes to the stamp");
  for (const m of v.variants.missing)
    io.out(`CHANGED: ${m} is stored but the document no longer has it`);
  for (const m of v.variants.extra) io.out(`CHANGED: ${m} derives but has no stored outputs`);
  for (const d of v.drift) {
    io.out(
      `drift: ${variantLabel(d.variant)}, ${d.output}: ${d.changes.length} field${d.changes.length === 1 ? "" : "s"}`,
    );
    for (const l of changeLines(d.changes)) io.out(l);
  }
  if (ok) {
    io.out(
      `verified: zero drift in ${r.outputs.length} variant${r.outputs.length === 1 ? "" : "s"} (derive, cutlist, bom, order, costs, check)`,
    );
  }
  return ok ? 0 : 1;
}

export async function revisionCommand(argv: readonly string[], io: Io): Promise<number> {
  const [sub, ...rest] = argv;
  switch (sub) {
    case "save":
      return save(rest, io);
    case "list":
      return list(rest, io);
    case "show":
      return show(rest, io);
    case "verify":
      return verify(rest, io);
    default:
      return usageError("revision", "the subcommands are save, list, show and verify", USAGE, io);
  }
}
