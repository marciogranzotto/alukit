import { resolve } from "node:path";
import { checkModel } from "#core/check/check.ts";
import { modelOutputs, outputAccessors } from "#core/check/outputs.ts";
import { isDate, localDate } from "#core/dates.ts";
import { derive } from "#core/derive/derive.ts";
import { lockHash } from "#core/lock/pin.ts";
import { problemsAt, problemsText } from "#core/problems/problems.ts";
import type { Problem, ProblemGroup, ProblemsAnswer } from "#core/problems/types.ts";
import { openLiveCatalogs } from "#core/project/open.ts";
import { loadProject } from "#core/project/store.ts";
import { call, findServer } from "../server/client.ts";
import { parseOptions, usageError } from "./args.ts";
import type { Io } from "./cli.ts";
import { diagnosticLine, variantExists } from "./project.ts";
import { usageOf } from "./project-usage.ts";

/**
 * `alukit problems <dir> [--variant v] [--as-of YYYY-MM-DD] [--json]` (D-UX-12, BE-3): what
 * stands between the project and a sound build and a sendable order, as one list grouped by
 * consequence, each problem in words with its fixes: the app's Problems sheet, for an agent or
 * a script. Exit 1 when something blocks the order or is an error.
 *
 * With a server running, it asks the server, whose revision counter it reports; without one it
 * derives in-process as `alukit check` and `alukit order` do, at revision 0, as a server just
 * opened on the files would say. Either way the JSON is what `GET /api/problems` answers.
 */

const USAGE = usageOf("problems");

const HEADS: Readonly<Record<ProblemGroup, string>> = {
  "blocks-order": "blocks the order",
  error: "errors",
  warning: "warnings",
  note: "notes",
};

function plural(n: number, word: string, words = `${word}s`): string {
  return `${n} ${n === 1 ? word : words}`;
}

function problemLines(p: Problem): string[] {
  return [
    `  ${p.title}  [${p.code}]`,
    `    ${p.detail}`,
    ...p.fixes.map((f) => `    fix: ${f.label}`),
  ];
}

/** The human form: each group's problems in words, then a line of counts. */
function humanText(a: ProblemsAnswer): string[] {
  const out: string[] = [];
  const count = (g: ProblemGroup) => a.problems.filter((p) => p.group === g).length;
  for (const g of Object.keys(HEADS) as ProblemGroup[]) {
    const ps = a.problems.filter((p) => p.group === g);
    if (ps.length === 0) continue;
    out.push(`${HEADS[g]} (${ps.length}):`, ...ps.flatMap(problemLines));
  }
  out.push(
    `problems${a.variant ? ` (variant ${a.variant})` : ""}: ${count("blocks-order")} blocking the order, ${plural(count("error"), "error")}, ${plural(count("warning"), "warning")}, ${plural(count("note"), "note")}; the order is ${a.order.status} as of ${a.as_of}`,
  );
  return out;
}

/** The problems from the project's files, in-process: what a server just opened would answer. */
async function headless(
  dir: string,
  variant: string | undefined,
  asOf: string,
  io: Io,
): Promise<ProblemsAnswer | undefined> {
  const project = await loadProject(dir);
  for (const n of project.notices) io.err(`notice: ${n}`);
  if (project.raw === undefined || project.lock === undefined) {
    for (const d of project.diagnostics) io.err(diagnosticLine(d));
    return undefined;
  }
  if (!variantExists(project.raw, variant, io, "problems")) return undefined;
  const { items } = project;
  const derived = derive(project.raw, items, { variant });
  const lock = lockHash(project.lock);
  const outputs = modelOutputs(derived, items, { lock });
  const check = checkModel({
    raw: project.raw,
    derived,
    items,
    accessors: outputAccessors(outputs),
  });
  const catalogs = (await openLiveCatalogs(dir, project.raw)).diagnostics;
  return problemsAt({ rev: 0, derived, items, check, catalogs, outputs, lock }, asOf);
}

export async function problemsCommand(argv: readonly string[], io: Io): Promise<number> {
  const args = parseOptions(
    "problems",
    argv,
    { json: { type: "boolean" }, variant: { type: "string" }, "as-of": { type: "string" } },
    USAGE,
    io,
  );
  if (args === 2) return 2;
  const [dir, ...extra] = args.positionals;
  if (dir === undefined) return usageError("problems", "a project folder is needed", USAGE, io);
  if (extra.length > 0) return usageError("problems", `unexpected argument ${extra[0]}`, USAGE, io);
  const asOf = args.values["as-of"] ?? localDate();
  if (!isDate(asOf)) return usageError("problems", "--as-of takes a date, YYYY-MM-DD", USAGE, io);
  const variant = args.values.variant;
  const root = resolve(dir);

  let answer: ProblemsAnswer | undefined;
  const link = await findServer(root);
  if (link) {
    const q = new URLSearchParams({ as_of: asOf, ...(variant ? { variant } : {}) });
    const r = await call(link, "GET", `/api/problems?${q}`);
    if (r.status !== 200) {
      const m = (r.body as { message?: string }).message;
      io.err(`alukit problems: ${m ?? `the server answered ${r.status}`}`);
      return 1;
    }
    answer = r.body as ProblemsAnswer;
  } else answer = await headless(root, variant, asOf, io);
  if (!answer) return 1;

  if (args.values.json) io.out(problemsText(answer).trimEnd());
  else for (const line of humanText(answer)) io.out(line);
  return answer.problems.some((p) => p.group === "blocks-order" || p.group === "error") ? 1 : 0;
}
