import { randomUUID } from "node:crypto";
import { derive } from "#core/derive/derive.ts";
import { jsonText } from "#core/derive/output.ts";
import { compareIds } from "#core/ids.ts";
import { diffLocks, isEmptyDiff, type LockDiff } from "#core/lock/diff.ts";
import { pinLock } from "#core/lock/pin.ts";
import { documentRefs } from "#core/lock/refs.ts";
import { emptyLock, LOCK_FILE, type Lock } from "#core/lock/schema.ts";
import { lockItems } from "#core/lock/source.ts";
import { openLiveCatalogs } from "#core/project/open.ts";
import { readDocument, readLock, withEditLock, writeProject } from "#core/project/store.ts";
import { QUANTUM, quantize } from "#core/quantum.ts";
import { call, findServer, type ServerLink } from "../server/client.ts";
import { parseOptions, usageError } from "./args.ts";
import type { Io } from "./cli.ts";
import { diagnosticLine } from "./project.ts";
import { usageOf } from "./project-usage.ts";

/**
 * `alukit lock update <dir> [--item <id>]... [--dry-run] [--json]` (design §4.13): refreshes the
 * lock from the live catalogs and shows exactly what changes, entry by entry and field by field,
 * and how cut lengths move. A catalog correction reaches a project only this way (call 11).
 * When a server owns the project, the refresh is its `lockUpdate` command, a step in its log
 * (§6), so every tab sees it; a dry run reads the files and changes nothing either way.
 */

const LOCK_USAGE = usageOf("lock");

export const LOCKDIFF_SCHEMA = "alukit.lockdiff/1";

export interface CutChange {
  bar: string;
  cut_mm: [number | null, number | null];
  centre_mm: [number | null, number | null];
}

const len = (x: number) => quantize(x, QUANTUM.len_mm);

/** Cut lengths derived with each lock, for the bars whose length moves (§4.13: "its effect"). */
export function cutEffect(raw: unknown, before: Lock, after: Lock): CutChange[] {
  const a = derive(raw, lockItems(before)).bars;
  const b = derive(raw, lockItems(after)).bars;
  const ids = [...new Set([...a.keys(), ...b.keys()])].sort(compareIds);
  const out: CutChange[] = [];
  for (const id of ids) {
    const x = a.get(id)?.lengths;
    const y = b.get(id)?.lengths;
    const cut: [number | null, number | null] = [x ? len(x.cut) : null, y ? len(y.cut) : null];
    const centre: [number | null, number | null] = [
      x ? len(x.centre) : null,
      y ? len(y.centre) : null,
    ];
    if (cut[0] !== cut[1] || centre[0] !== centre[1]) {
      out.push({ bar: id, cut_mm: cut, centre_mm: centre });
    }
  }
  return out;
}

function shown(v: unknown): string {
  if (v === undefined) return "(none)";
  const s = JSON.stringify(v);
  return s.length > 80 ? `${s.slice(0, 77)}...` : s;
}

const KIND_NAME = {
  items: "item",
  offers: "offer",
  sections: "section",
  materials: "material",
  grooves: "groove type",
  systems: "system",
} as const;

export function diffText(diff: LockDiff): string[] {
  const lines: string[] = [];
  for (const e of diff.entries) {
    lines.push(`  ${e.change} ${KIND_NAME[e.kind]} ${e.id}`);
    for (const f of e.fields ?? []) {
      lines.push(`      ${f.path || "(value)"}: ${shown(f.was)} -> ${shown(f.now)}`);
    }
  }
  for (const c of diff.catalogs) lines.push(`  catalog ${c.id}: ${c.change}`);
  return lines;
}

interface Outcome {
  dry: boolean;
  write: boolean;
  blocked: boolean;
  diff: LockDiff;
  cut: CutChange[];
  kept: string[];
  missing: string[];
}

/** What `lock update` found and did: printed the same way headless and through a server. */
function print(io: Io, json: boolean, o: Outcome): void {
  if (json) {
    io.out(
      jsonText({
        schema: LOCKDIFF_SCHEMA,
        dry_run: o.dry,
        written: o.write,
        entries: o.diff.entries,
        catalogs: o.diff.catalogs,
        cut: o.cut,
        kept: o.kept,
        missing: o.missing,
      }).trimEnd(),
    );
    return;
  }
  const n = o.diff.entries.length;
  io.out(`${LOCK_FILE}: ${n === 0 ? "no change" : `${n} change${n === 1 ? "" : "s"}`}`);
  for (const l of diffText(o.diff)) io.out(l);
  if (o.cut.length > 0) {
    io.out("cut lengths:");
    for (const c of o.cut) {
      const f = (x: number | null) => (x === null ? "(none)" : x.toFixed(2));
      io.out(
        `  ${c.bar.padEnd(8)} cut ${f(c.cut_mm[0])} -> ${f(c.cut_mm[1])}  centre ${f(c.centre_mm[0])} -> ${f(c.centre_mm[1])}`,
      );
    }
  }
  for (const k of o.kept) io.out(`kept ${k}: no longer in the live catalogs, pinned as it was`);
  for (const m of o.missing) io.err(`warn lock ${m}: in no catalog`);
  if (o.dry) io.out("dry run: nothing written");
  else if (o.blocked) io.err("not written: the catalogs have errors");
}

/** `lock update` as the server's `lockUpdate` command: one step of its log. */
async function updateThroughServer(
  link: ServerLink,
  only: string[] | undefined,
  io: Io,
  json: boolean,
): Promise<number> {
  try {
    const before = await call(link, "GET", "/api/project");
    const r = await call(link, "POST", "/api/commands", {
      commands: [{ cmd: "lockUpdate", args: only ? { items: only } : {} }],
      source: "cli",
      id: randomUUID(),
    });
    const body = r.body as {
      ok: boolean;
      kind?: string;
      message?: string;
      status?: { message?: string };
      failed?: { errors: { code: string; message: string }[] };
      results?: { info?: LockDiff & { kept: string[]; missing: string[] } }[];
    };
    if (!body.ok) {
      const why =
        body.kind === "read-only"
          ? `the project is read-only: ${body.status?.message ?? ""}`
          : body.kind === "refused"
            ? (body.failed?.errors ?? []).map((e) => `${e.code}: ${e.message}`).join("; ")
            : (body.message ?? `the server answered ${r.status}`);
      io.err(`alukit lock: not written: ${why}`);
      return 1;
    }
    const info = body.results?.[0]?.info;
    const after = await call(link, "GET", "/api/project");
    const b = before.body as { doc: unknown; lock: Lock };
    const a = after.body as { lock: Lock };
    const diff: LockDiff = { entries: info?.entries ?? [], catalogs: info?.catalogs ?? [] };
    print(io, json, {
      dry: false,
      write: !isEmptyDiff(diff),
      blocked: false,
      diff,
      cut: cutEffect(b.doc, b.lock, a.lock),
      kept: info?.kept ?? [],
      missing: info?.missing ?? [],
    });
    return 0;
  } catch (e) {
    io.err(`alukit lock: the server at ${link.url} did not answer: ${(e as Error).message}`);
    return 1;
  }
}

export async function lockCommand(argv: readonly string[], io: Io): Promise<number> {
  const args = parseOptions(
    "lock",
    argv,
    {
      item: { type: "string", multiple: true },
      "dry-run": { type: "boolean" },
      json: { type: "boolean" },
    },
    LOCK_USAGE,
    io,
  );
  if (args === 2) return 2;
  const [sub, dir, ...extra] = args.positionals;
  if (sub !== "update") return usageError("lock", "the only subcommand is update", LOCK_USAGE, io);
  if (dir === undefined) return usageError("lock", "a project folder is needed", LOCK_USAGE, io);
  if (extra.length > 0)
    return usageError("lock", `unexpected argument ${extra[0]}`, LOCK_USAGE, io);
  const dry = args.values["dry-run"] === true;
  const only = args.values.item;
  if (!dry) {
    const link = await findServer(dir);
    if (link) return updateThroughServer(link, only, io, args.values.json === true);
  }

  const doc = await readDocument(dir);
  if (doc.value === undefined) {
    for (const d of doc.diagnostics) io.err(diagnosticLine(d));
    return 1;
  }
  const current = await readLock(dir);
  if (current.diagnostics.length > 0) {
    for (const d of current.diagnostics) io.err(diagnosticLine(d));
    // A partial refresh builds on the lock; a full one replaces it, so it repairs a broken lock.
    if (only) return 1;
    io.err(`${LOCK_FILE} is rebuilt from the live catalogs`);
  }
  const live = await openLiveCatalogs(dir, doc.value);
  for (const d of live.diagnostics) io.err(diagnosticLine(d));
  const before = current.value;
  const pinned = pinLock(
    live.set,
    documentRefs(doc.value),
    before,
    only ? { kind: "refresh", only } : { kind: "refresh" },
  );
  const diff = diffLocks(before ?? emptyLock(), pinned.lock);
  const cut = before ? cutEffect(doc.value, before, pinned.lock) : [];
  const blocked = live.diagnostics.some((d) => d.severity === "error");
  const write = !dry && !blocked && (before === undefined || !isEmptyDiff(diff));
  if (write) await withEditLock(dir, () => writeProject(dir, undefined, pinned.lock));

  print(io, args.values.json === true, {
    dry,
    write,
    blocked,
    diff,
    cut,
    kept: pinned.kept,
    missing: pinned.missing,
  });
  return blocked ? 1 : 0;
}
