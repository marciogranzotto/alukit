import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { CHECK_SCHEMA, checkModel } from "#core/check/check.ts";
import { modelOutputs, outputAccessors } from "#core/check/outputs.ts";
import { jsonText } from "#core/derive/output.ts";
import { type Diagnostic, Diagnostics } from "#core/diagnostics.ts";
import { diffLocks, isEmptyDiff } from "#core/lock/diff.ts";
import { pinLock } from "#core/lock/pin.ts";
import { documentRefs } from "#core/lock/refs.ts";
import { LOCK_FILE, lockText } from "#core/lock/schema.ts";
import { projectText } from "#core/project/canonical.ts";
import { DOCUMENT, openLiveCatalogs } from "#core/project/open.ts";
import { QUANTUM, quantize } from "#core/quantum.ts";
import { parseOptions, usageError } from "./args.ts";
import type { Io } from "./cli.ts";
import { diagnosticLine, loadAndDerive } from "./project.ts";
import { usageOf } from "./project-usage.ts";

/**
 * `alukit check <dir> [--json] [--frozen]` (design §5.5, §7.3): validates, derives and runs the
 * checks, and exits 1 on an error. Beyond the model's own checks it reports, as info, a lock
 * behind the live catalogs (§4.13) and a file not in canonical form (§2). `--frozen` reads only
 * the lock: it does not open the catalogs, so it reports no lock staleness.
 */

const CHECK_USAGE = usageOf("check");

async function textOf(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

function plural(n: number, word: string, words = `${word}s`): string {
  return `${n} ${n === 1 ? word : words}`;
}

export async function checkCommand(argv: readonly string[], io: Io): Promise<number> {
  const args = parseOptions(
    "check",
    argv,
    { json: { type: "boolean" }, frozen: { type: "boolean" }, variant: { type: "string" } },
    CHECK_USAGE,
    io,
  );
  if (args === 2) return 2;
  const [dir, ...extra] = args.positionals;
  if (dir === undefined) return usageError("check", "a project folder is needed", CHECK_USAGE, io);
  if (extra.length > 0)
    return usageError("check", `unexpected argument ${extra[0]}`, CHECK_USAGE, io);
  const frozen = args.values.frozen === true;
  const root = resolve(dir);

  const loaded = await loadAndDerive(root, io, {
    frozen,
    variant: args.values.variant,
    cmd: "check",
  });
  if (loaded === 1) return 1;
  const { project, derived, items } = loaded;
  const raw = project.raw;
  const lock = project.lock;
  if (lock === undefined) return 1;
  const result = checkModel({
    raw,
    derived,
    items,
    accessors: outputAccessors(modelOutputs(derived, items)),
  });
  const d = new Diagnostics();
  for (const x of result.diagnostics) d.add(x);

  if (!frozen) {
    const live = await openLiveCatalogs(root, raw);
    for (const x of live.diagnostics) d.add(x);
    if (!live.diagnostics.some((x) => x.severity === "error")) {
      const fresh = pinLock(live.set, documentRefs(raw), lock, { kind: "refresh" });
      const diff = diffLocks(lock, fresh.lock);
      if (!isEmptyDiff(diff)) {
        const { entries, catalogs } = diff;
        const what = [
          entries.length > 0 ? plural(entries.length, "entry", "entries") : "",
          catalogs.length > 0 ? plural(catalogs.length, "catalog hash", "catalog hashes") : "",
        ].filter((p) => p !== "");
        const one = entries.length + catalogs.length === 1;
        d.info(
          "lock-behind",
          undefined,
          `${LOCK_FILE} is behind the catalogs: ${what.join(" and ")} ${one ? "differs" : "differ"} (see alukit lock update --dry-run)`,
        );
      }
    }
  }
  const docText = await textOf(join(root, DOCUMENT));
  if (docText !== undefined && docText !== projectText(raw)) {
    d.info("format", undefined, `${DOCUMENT} is not in canonical form (run alukit fmt)`);
  }
  const lockFileText = await textOf(join(root, LOCK_FILE));
  if (lockFileText !== undefined && lockFileText !== lockText(lock)) {
    d.info("format", undefined, `${LOCK_FILE} is not in canonical form (run alukit fmt)`);
  }

  const all: Diagnostic[] = d.sorted();
  const count = (s: Diagnostic["severity"]) => all.filter((x) => x.severity === s).length;
  const errors = count("error");
  const checks = result.checks;
  const passed = checks.filter((c) => c.pass === true).length;
  const failed = checks.filter((c) => c.pass === false).length;
  const pending = checks.filter((c) => c.pending).length;

  if (args.values.json) {
    io.out(
      jsonText({
        schema: CHECK_SCHEMA,
        ...(derived.variant !== undefined ? { variant: derived.variant } : {}),
        ok: errors === 0,
        counts: { error: errors, warn: count("warn"), info: count("info") },
        checks,
        diagnostics: all,
      }).trimEnd(),
    );
    return errors > 0 ? 1 : 0;
  }
  for (const x of all) io.out(diagnosticLine(x));
  for (const c of checks) {
    if (c.pass === undefined) continue;
    const margin = c.margin !== undefined ? `, margin ${quantize(c.margin, QUANTUM.len_mm)}` : "";
    io.out(`${c.pass ? "pass" : "FAIL"} ${c.id}${c.text ? ` ${c.text}` : ""}${margin}`);
  }
  io.out(
    `check${derived.variant ? ` (variant ${derived.variant})` : ""}: ${plural(errors, "error")}, ${plural(count("warn"), "warning")}, ${count("info")} info; ` +
      `${plural(checks.length, "check")}: ${passed} passed, ${failed} failed${pending > 0 ? `, ${pending} pending` : ""}`,
  );
  return errors > 0 ? 1 : 0;
}
