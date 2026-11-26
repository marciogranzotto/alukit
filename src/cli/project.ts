import { resolve } from "node:path";
import { bom } from "#core/bom/bom.ts";
import { bomCsv, bomJson, bomMarkdown } from "#core/bom/format.ts";
import { cutList } from "#core/cutlist/cutlist.ts";
import { cutListCsv, cutListJson, cutListMarkdown } from "#core/cutlist/format.ts";
import { type Derived, derive } from "#core/derive/derive.ts";
import { derivedJson, jsonText } from "#core/derive/output.ts";
import { type Diagnostic, sortDiagnostics } from "#core/diagnostics.ts";
import {
  costsCsv,
  costsJson,
  costsMarkdownDoc,
  costsOf,
  orderCsv,
  orderJson,
  orderMarkdown,
} from "#core/order/format.ts";
import { type Order, order } from "#core/order/order.ts";
import { openProject } from "#core/project/open.ts";
import type { Io } from "./cli.ts";
import { PROJECT_USAGE } from "./project-usage.ts";

/**
 * `alukit derive`, `cutlist`, `bom`, `order` and `costs` (design §7.3). Exit codes: 0 fine, 1 the
 * project has errors (for `order`: any supplier is blocked), 2 a usage error. Without a server
 * (M4a) they run the core in-process.
 */

interface Args {
  dir?: string;
  json: boolean;
  format: "md" | "csv" | "json";
  /** The order's date (the stale-price rule): YYYY-MM-DD, today by default. */
  asOf?: string;
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
    } else if (a === "--as-of") {
      const v = argv[++i];
      if (v === undefined || !isDate(v)) return "--as-of takes a date, YYYY-MM-DD";
      out.asOf = v;
    } else if (a.startsWith("--")) return `unknown option ${a}`;
    else if (out.dir === undefined) out.dir = a;
    else return `unexpected argument ${a}`;
  }
  return out;
}

function isDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s;
}

/** Today's local date, YYYY-MM-DD. */
function today(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
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

  if (cmd === "order" || cmd === "costs") {
    const b = bom({ derived, items });
    const o = order({
      derived,
      items,
      bom: b,
      cutList: cl,
      diagnostics: sortDiagnostics([...derived.diagnostics, ...cl.diagnostics, ...b.diagnostics]),
      asOf: args.asOf ?? today(),
    });
    if (cmd === "order") {
      if (args.format === "json") io.out(orderJson(o).trimEnd());
      else {
        const shown = { ...o, diagnostics: [] };
        io.out((args.format === "csv" ? orderCsv(shown) : orderMarkdown(shown)).trimEnd());
        for (const d of o.diagnostics) io.err(line(d));
      }
      // An agent cannot hand over a blocked list by skipping `alukit check` (§5.5).
      for (const l of blockedLines(o)) io.err(l);
      return o.status === "BLOCKED" ? 1 : 0;
    }
    const c = costsOf(o);
    if (args.format === "json") io.out(costsJson(c).trimEnd());
    else {
      const shown = { ...c, diagnostics: [] };
      io.out((args.format === "csv" ? costsCsv(shown) : costsMarkdownDoc(shown)).trimEnd());
      for (const d of c.diagnostics) io.err(line(d));
    }
    return c.diagnostics.some((d) => d.severity === "error") ? 1 : 0;
  }

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
