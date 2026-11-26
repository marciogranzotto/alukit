import { resolve } from "node:path";
import { bom } from "#core/bom/bom.ts";
import { bomCsv, bomJson, bomMarkdown } from "#core/bom/format.ts";
import { cutList } from "#core/cutlist/cutlist.ts";
import { cutListCsv, cutListJson, cutListMarkdown } from "#core/cutlist/format.ts";
import { type Derived, derive } from "#core/derive/derive.ts";
import { derivedJson, jsonText } from "#core/derive/output.ts";
import { type Diagnostic, sortDiagnostics } from "#core/diagnostics.ts";
import type { ItemSource } from "#core/items.ts";
import { type LoadedProject, loadProject } from "#core/project/store.ts";
import { parseOptions, usageError } from "./args.ts";
import type { Io } from "./cli.ts";
import { PROJECT_USAGE } from "./project-usage.ts";

/**
 * `alukit derive`, `alukit cutlist` and `alukit bom` (design §7.3). Exit codes: 0 fine, 1 the
 * project has errors, 2 a usage error. Without a server (M4a) they run the core in-process. Derive
 * reads the lock (§4.13): a missing lock is created, and a missing entry added, each with a notice
 * on stderr; `--frozen` makes either an error instead.
 */

export function diagnosticLine(d: Diagnostic): string {
  return `${d.severity} ${d.code}${d.entity ? ` ${d.entity}` : ""}: ${d.message}`;
}

export interface Loaded {
  project: LoadedProject;
  derived: Derived;
  items: ItemSource;
}

/**
 * Opens a project and derives it from its lock. Notices go to stderr. Returns the exit code 1
 * when the document or the lock cannot be read.
 */
export async function loadAndDerive(
  dir: string,
  io: Io,
  opts: { frozen?: boolean } = {},
): Promise<Loaded | 1> {
  const project = await loadProject(resolve(dir), opts);
  for (const n of project.notices) io.err(`notice: ${n}`);
  if (project.raw === undefined || project.lock === undefined) {
    for (const d of project.diagnostics) io.err(diagnosticLine(d));
    return 1;
  }
  const d = derive(project.raw, project.items);
  const derived = {
    ...d,
    diagnostics: sortDiagnostics([...project.diagnostics, ...d.diagnostics]),
  };
  return { project, derived, items: project.items };
}

export async function projectCommand(
  cmd: string,
  argv: readonly string[],
  io: Io,
): Promise<number> {
  const args = parseOptions(
    cmd,
    argv,
    {
      json: { type: "boolean" },
      format: { type: "string" },
      frozen: { type: "boolean" },
    },
    PROJECT_USAGE,
    io,
  );
  if (args === 2) return 2;
  const [dir, ...extra] = args.positionals;
  if (dir === undefined) return usageError(cmd, "a project folder is needed", PROJECT_USAGE, io);
  if (extra.length > 0)
    return usageError(cmd, `unexpected argument ${extra[0]}`, PROJECT_USAGE, io);
  const format = args.values.format ?? "md";
  if (format !== "md" && format !== "csv" && format !== "json") {
    return usageError(cmd, "--format takes md, csv or json", PROJECT_USAGE, io);
  }

  const loaded = await loadAndDerive(dir, io, { frozen: args.values.frozen === true });
  if (loaded === 1) return 1;
  const { derived, items } = loaded;

  if (cmd === "derive") {
    const hasErrors = derived.diagnostics.some((d) => d.severity === "error");
    if (args.values.json) {
      io.out(jsonText(derivedJson(derived)).trimEnd());
    } else {
      const rows = [...derived.bars].map(
        ([id, b]) =>
          `  ${id.padEnd(8)} ${b.placed.item.id.padEnd(24)} cut ${b.lengths.cut.toFixed(2).padStart(9)}  centre ${b.lengths.centre.toFixed(2).padStart(9)}`,
      );
      io.out([`${derived.bars.size} bars`, ...rows].join("\n"));
      for (const d of derived.diagnostics) io.err(diagnosticLine(d));
    }
    return hasErrors ? 1 : 0;
  }

  if (cmd === "bom") {
    const b = bom({ derived, items });
    const all = sortDiagnostics([...derived.diagnostics, ...b.diagnostics]);
    if (format === "json") {
      io.out(bomJson({ ...b, diagnostics: all }).trimEnd());
    } else {
      const shown = { ...b, diagnostics: [] };
      io.out((format === "csv" ? bomCsv(shown) : bomMarkdown(shown)).trimEnd());
      for (const d of all) io.err(diagnosticLine(d));
    }
    return all.some((d) => d.severity === "error") ? 1 : 0;
  }

  const cl = cutList({ derived, items });
  const all = sortDiagnostics([...derived.diagnostics, ...cl.diagnostics]);
  if (format === "json") {
    io.out(cutListJson({ ...cl, diagnostics: all }).trimEnd());
  } else {
    const shown = { ...cl, diagnostics: [] };
    io.out((format === "csv" ? cutListCsv(shown) : cutListMarkdown(shown)).trimEnd());
    for (const d of all) io.err(diagnosticLine(d));
  }
  return all.some((d) => d.severity === "error") ? 1 : 0;
}
