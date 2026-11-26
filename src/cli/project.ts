import { resolve } from "node:path";
import { bom } from "#core/bom/bom.ts";
import { bomCsv, bomJson, bomMarkdown } from "#core/bom/format.ts";
import { cutList } from "#core/cutlist/cutlist.ts";
import { cutListCsv, cutListJson, cutListMarkdown } from "#core/cutlist/format.ts";
import { type Derived, derive } from "#core/derive/derive.ts";
import { derivedJson, jsonText } from "#core/derive/output.ts";
import { type Diagnostic, sortDiagnostics } from "#core/diagnostics.ts";
import { openProject } from "#core/project/open.ts";
import type { Io } from "./cli.ts";
import { PROJECT_USAGE } from "./project-usage.ts";

/**
 * `alukit derive`, `alukit cutlist` and `alukit bom` (design §7.3). Exit codes: 0 fine, 1 the project has
 * errors, 2 a usage error. Without a server (M4a) they run the core in-process.
 */

interface Args {
  dir?: string;
  json: boolean;
  format: "md" | "csv" | "json";
}

function parse(argv: readonly string[]): Args | string {
  const out: Args = { json: false, format: "md" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (a === "--json") out.json = true;
    else if (a === "--format") {
      const f = argv[++i];
      if (f !== "md" && f !== "csv" && f !== "json") return `--format takes md, csv or json`;
      out.format = f;
    } else if (a.startsWith("--")) return `unknown option ${a}`;
    else if (out.dir === undefined) out.dir = a;
    else return `unexpected argument ${a}`;
  }
  return out;
}

function line(d: Diagnostic): string {
  return `${d.severity} ${d.code}${d.entity ? ` ${d.entity}` : ""}: ${d.message}`;
}

async function load(
  dir: string,
): Promise<
  { derived: Derived; items: Awaited<ReturnType<typeof openProject>>["items"] } | Diagnostic[]
> {
  const opened = await openProject(resolve(dir));
  if (opened.raw === undefined) return opened.diagnostics;
  const d = derive(opened.raw, opened.items);
  const derived = { ...d, diagnostics: sortDiagnostics([...opened.diagnostics, ...d.diagnostics]) };
  return { derived, items: opened.items };
}

export async function projectCommand(
  cmd: string,
  argv: readonly string[],
  io: Io,
): Promise<number> {
  const args = parse(argv);
  if (typeof args === "string" || args.dir === undefined) {
    io.err(`alukit ${cmd}: ${typeof args === "string" ? args : "a project folder is needed"}`);
    io.err(`usage:\n${PROJECT_USAGE}`);
    return 2;
  }
  const loaded = await load(args.dir);
  if (Array.isArray(loaded)) {
    for (const d of loaded) io.err(line(d));
    return 1;
  }
  const { derived, items } = loaded;

  if (cmd === "derive") {
    const hasErrors = derived.diagnostics.some((d) => d.severity === "error");
    if (args.json) {
      io.out(jsonText(derivedJson(derived)).trimEnd());
    } else {
      const rows = [...derived.bars].map(
        ([id, b]) =>
          `  ${id.padEnd(8)} ${b.placed.item.id.padEnd(24)} cut ${b.lengths.cut.toFixed(2).padStart(9)}  centre ${b.lengths.centre.toFixed(2).padStart(9)}`,
      );
      io.out([`${derived.bars.size} bars`, ...rows].join("\n"));
      for (const d of derived.diagnostics) io.err(line(d));
    }
    return hasErrors ? 1 : 0;
  }

  if (cmd === "bom") {
    const b = bom({ derived, items });
    const all = sortDiagnostics([...derived.diagnostics, ...b.diagnostics]);
    if (args.format === "json") {
      io.out(bomJson({ ...b, diagnostics: all }).trimEnd());
    } else {
      const shown = { ...b, diagnostics: [] };
      io.out((args.format === "csv" ? bomCsv(shown) : bomMarkdown(shown)).trimEnd());
      for (const d of all) io.err(line(d));
    }
    return all.some((d) => d.severity === "error") ? 1 : 0;
  }

  const cl = cutList({ derived, items });
  const all = sortDiagnostics([...derived.diagnostics, ...cl.diagnostics]);
  if (args.format === "json") {
    io.out(cutListJson({ ...cl, diagnostics: all }).trimEnd());
  } else {
    const shown = { ...cl, diagnostics: [] };
    io.out((args.format === "csv" ? cutListCsv(shown) : cutListMarkdown(shown)).trimEnd());
    for (const d of all) io.err(line(d));
  }
  return all.some((d) => d.severity === "error") ? 1 : 0;
}
