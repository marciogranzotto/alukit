import { resolve } from "node:path";
import { inlineJson } from "#core/canonical.ts";
import { getEntity, isObject, KIND_NOUN, type Kind, kindOf } from "#core/commands/doc.ts";
import type { RawDoc } from "#core/commands/types.ts";
import type { Derived } from "#core/derive/derive.ts";
import { jsonText } from "#core/derive/output.ts";
import { DOCUMENT } from "#core/project/open.ts";
import { readDocument } from "#core/project/store.ts";
import { QUANTUM, quantize } from "#core/quantum.ts";
import { idRanges, itemsOf, select } from "#core/query.ts";
import { parseOptions, usageError } from "./args.ts";
import type { Io } from "./cli.ts";
import { diagnosticLine, loadAndDerive } from "./project.ts";
import { usageOf } from "./project-usage.ts";

/**
 * `alukit query <dir> <selector> [--fields a,b] [--limit n] [--summary] [--json]` (design §7.3):
 * entities as written, bounded for an agent's context: at most `--limit` entities (50), each on
 * one line cut at 200 characters, or with `--summary` only counts and id ranges per kind.
 * `--fields` picks fields; a bar's `cut`, `len` and `centre` and a node's `pos` come from derive,
 * as does what `like:<id>` compares (E1.5).
 */

export const QUERY_SCHEMA = "alukit.query/1";
const QUERY_USAGE = usageOf("query");
const DEFAULT_LIMIT = 50;
const LINE = 200;

/** Fields read from the derived model, per kind. */
const DERIVED: Partial<Record<Kind, readonly string[]>> = {
  bars: ["cut", "len", "centre"],
  nodes: ["pos"],
};

/** An entity as an object: a bare point is `{ at }`, a list-form run is `{ bars }`. */
function asObject(kind: Kind, v: unknown): Record<string, unknown> {
  if (isObject(v)) return v;
  if (kind === "nodes") return { at: v };
  if (kind === "runs") return { bars: v };
  return { value: v };
}

function derivedField(d: Derived, id: string, field: string): unknown {
  const len = (x: number) => quantize(x, QUANTUM.len_mm);
  const b = d.bars.get(id);
  if (b) {
    if (field === "cut") return len(b.lengths.cut);
    if (field === "len") return len(b.lengths.len);
    if (field === "centre") return len(b.lengths.centre);
  }
  const p = d.nodes.get(id);
  if (p && field === "pos") return p.map(len);
  return null;
}

export async function queryCommand(argv: readonly string[], io: Io): Promise<number> {
  const args = parseOptions(
    "query",
    argv,
    {
      fields: { type: "string" },
      limit: { type: "string" },
      summary: { type: "boolean" },
      json: { type: "boolean" },
    },
    QUERY_USAGE,
    io,
  );
  if (args === 2) return 2;
  const [dir, ...words] = args.positionals;
  if (dir === undefined || words.length === 0) {
    return usageError("query", "give a project folder and a selector", QUERY_USAGE, io);
  }
  const selector = words.join(" ");
  const limit = args.values.limit === undefined ? DEFAULT_LIMIT : Number(args.values.limit);
  if (!Number.isInteger(limit) || limit < 1) {
    return usageError("query", "--limit takes a whole number from 1", QUERY_USAGE, io);
  }
  const fields = args.values.fields
    ?.split(",")
    .map((f) => f.trim())
    .filter((f) => f !== "");

  // Derive only when a derived field, or what is like an entity, is asked for (it reads, and may
  // create, the lock).
  const wantsDerived =
    /^like:/.test(selector.trim()) ||
    fields?.some((f) => Object.values(DERIVED).some((l) => l?.includes(f)));
  let raw: unknown;
  let derived: Derived | undefined;
  if (wantsDerived) {
    const loaded = await loadAndDerive(dir, io);
    if (loaded === 1) return 1;
    raw = loaded.project.raw;
    derived = loaded.derived;
  } else {
    const read = await readDocument(resolve(dir));
    if (read.value === undefined) {
      for (const d of read.diagnostics) io.err(diagnosticLine(d));
      return 1;
    }
    raw = read.value;
  }
  if (!isObject(raw)) {
    io.err(`alukit query: ${DOCUMENT} is not a JSON object`);
    return 1;
  }
  const doc = raw as RawDoc;
  const sel = select(doc, selector, derived && (() => derived as Derived));
  if (!sel.ok) {
    io.err(`alukit query: ${sel.message}`);
    return 1;
  }
  const total = sel.ids.length;

  if (args.values.summary) {
    const byKind = new Map<Kind, string[]>();
    for (const id of sel.ids) {
      const k = kindOf(id) as Kind;
      byKind.set(k, [...(byKind.get(k) ?? []), id]);
    }
    if (args.values.json) {
      io.out(
        jsonText({
          schema: QUERY_SCHEMA,
          selector,
          total,
          kinds: Object.fromEntries(
            [...byKind].map(([k, ids]) => [k, { count: ids.length, ids: idRanges(ids) }]),
          ),
        }).trimEnd(),
      );
    } else {
      io.out(`${total} match${total === 1 ? "" : "es"} for ${selector}`);
      for (const [k, ids] of byKind)
        io.out(`  ${ids.length} ${KIND_NOUN[k]}${ids.length === 1 ? "" : "s"}: ${idRanges(ids)}`);
    }
    return 0;
  }

  const shown = sel.ids.slice(0, limit);
  const rows = shown.map((id) => {
    const kind = kindOf(id) as Kind;
    const value = asObject(kind, getEntity(doc, id));
    if (!fields) return { id, kind, value };
    const picked: Record<string, unknown> = {};
    for (const f of fields) {
      if (derived && DERIVED[kind]?.includes(f)) picked[f] = derivedField(derived, id, f);
      else if (f === "items") picked[f] = itemsOf(doc, id);
      else if (Object.hasOwn(value, f)) picked[f] = value[f];
    }
    return { id, kind, value: picked };
  });

  if (args.values.json) {
    io.out(
      jsonText({
        schema: QUERY_SCHEMA,
        selector,
        total,
        shown: rows.length,
        entities: rows.map((r) => ({
          id: r.id,
          kind: r.kind,
          ...(fields ? { fields: r.value } : { value: r.value }),
        })),
      }).trimEnd(),
    );
    return 0;
  }
  if (total === 0) {
    io.out(`no match for ${selector}`);
    return 0;
  }
  const width = Math.max(...rows.map((r) => r.id.length));
  for (const r of rows) {
    const body = fields
      ? Object.entries(r.value)
          .map(([k, v]) => `${k}=${typeof v === "string" ? v : inlineJson(v)}`)
          .join("  ")
      : inlineJson(r.value);
    const line = `${r.id.padEnd(width)}  ${body}`;
    io.out(line.length > LINE ? `${line.slice(0, LINE - 1)}…` : line);
  }
  if (total > rows.length) {
    io.out(
      `… and ${total - rows.length} more (${idRanges(sel.ids.slice(rows.length))}); raise --limit or use --summary`,
    );
  }
  return 0;
}
