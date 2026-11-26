import { resolve } from "node:path";
import { bom } from "#core/bom/bom.ts";
import { bomCsv, bomJson, bomMarkdown } from "#core/bom/format.ts";
import { checkModel } from "#core/check/check.ts";
import { checkedOrder, modelOutputs, outputAccessors } from "#core/check/outputs.ts";
import { cutList } from "#core/cutlist/cutlist.ts";
import { cutListCsv, cutListJson, cutListMarkdown } from "#core/cutlist/format.ts";
import { isDate, localDate } from "#core/dates.ts";
import { type Derived, derive } from "#core/derive/derive.ts";
import { derivedJson, jsonText } from "#core/derive/output.ts";
import { type Diagnostic, sortDiagnostics } from "#core/diagnostics.ts";
import type { ItemSource } from "#core/items.ts";
import { lockHash } from "#core/lock/pin.ts";
import {
  costsCsv,
  costsJson,
  costsMarkdownDoc,
  costsOf,
  orderCsv,
  orderJson,
  orderMarkdown,
} from "#core/order/format.ts";
import type { Order } from "#core/order/order.ts";
import { type LoadedProject, loadProject } from "#core/project/store.ts";
import { parseOptions, usageError } from "./args.ts";
import type { Io } from "./cli.ts";
import { PROJECT_USAGE } from "./project-usage.ts";

/**
 * `alukit derive`, `cutlist`, `bom`, `order` and `costs` (design §7.3). Exit codes: 0 fine, 1 the
 * project has errors (for `order`: any supplier is blocked), 2 a usage error. Without a server
 * (M4a) they run the core in-process. They derive from the lock (§4.13): a missing lock is
 * created, and a missing entry added, each with a notice on stderr; `--frozen` makes either an
 * error instead.
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

/** Why each blocked supplier is blocked, one line per reason. */
function blockedLines(o: Order): string[] {
  return o.suppliers.flatMap((s) =>
    s.status === "BLOCKED"
      ? s.reasons
          .filter((r) => r.action === "block")
          .map((r) => `BLOCKED ${s.supplier ?? "(unsourced)"}: ${r.rule}: ${r.message}`)
      : [],
  );
}

export async function projectCommand(
  cmd: string,
  argv: readonly string[],
  io: Io,
): Promise<number> {
  const priced = cmd === "order" || cmd === "costs";
  const args = parseOptions(
    cmd,
    argv,
    {
      json: { type: "boolean" },
      format: { type: "string" },
      frozen: { type: "boolean" },
      // The order's date (the stale-price rule): only the commands that price take it.
      ...(priced ? { "as-of": { type: "string" as const } } : {}),
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
  const asOf = (args.values as { "as-of"?: string })["as-of"];
  if (asOf !== undefined && !isDate(asOf)) {
    return usageError(cmd, "--as-of takes a date, YYYY-MM-DD", PROJECT_USAGE, io);
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

  if (priced) {
    // §5.1: the outputs, then the built-in and project checks (whose cost() and mass() read
    // them), then the order rules, which take every error so far (check-error, §5.5).
    const outputs = modelOutputs(derived, items);
    const checked = checkModel({
      raw: loaded.project.raw,
      derived,
      items,
      accessors: outputAccessors(outputs),
    });
    const o = checkedOrder(outputs, checked.diagnostics, {
      asOf: asOf ?? localDate(),
      ...(loaded.project.lock ? { lock: lockHash(loaded.project.lock) } : {}),
    });
    if (cmd === "order") {
      if (format === "json") io.out(orderJson(o).trimEnd());
      else {
        const shown = { ...o, diagnostics: [] };
        io.out((format === "csv" ? orderCsv(shown) : orderMarkdown(shown)).trimEnd());
        for (const d of o.diagnostics) io.err(diagnosticLine(d));
      }
      // An agent cannot hand over a blocked list by skipping `alukit check` (§5.5).
      for (const l of blockedLines(o)) io.err(l);
      return o.status === "BLOCKED" ? 1 : 0;
    }
    const c = costsOf(o);
    if (format === "json") io.out(costsJson(c).trimEnd());
    else {
      const shown = { ...c, diagnostics: [] };
      io.out((format === "csv" ? costsCsv(shown) : costsMarkdownDoc(shown)).trimEnd());
      for (const d of c.diagnostics) io.err(diagnosticLine(d));
    }
    return c.diagnostics.some((d) => d.severity === "error") ? 1 : 0;
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
