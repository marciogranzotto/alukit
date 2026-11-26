import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { BUILTIN_DIR, builtinIds, openCatalog } from "#catalog/open.ts";
import { catalogIndex, SEARCH_LIMIT, searchCatalog } from "#catalog/search.ts";
import { jsonText } from "#core/derive/output.ts";
import type { Io } from "./cli.ts";

/**
 * `alukit catalog search <query> [--kind <kind>] [--catalog <id|dir>]... [--limit n] [--json]`
 * (design §7.3): items whose id, code, name or family hold every word of the query, accents and
 * case aside, in the catalogs named (every built-in one by default). Ranked as the app's catalog
 * browser ranks them: an exact id or code first, then codes that start with the query, then the
 * rest, each in id order. The output is bounded, 20 items by default and 200 at most, and says
 * how many more matched.
 */

export const SEARCH_SCHEMA = "alukit.catalog-search/1";
const DEFAULT_LIMIT = 20;

export interface SearchArgs {
  query: string;
  kind?: string;
  catalogs: string[];
  limit?: number;
  json: boolean;
}

/** A catalog named on the command line: a folder, else a built-in id. */
function catalogDir(target: string): string {
  const dir = resolve(target);
  return existsSync(join(dir, "catalog.json")) ? dir : join(BUILTIN_DIR, target);
}

export async function searchCommand(a: SearchArgs, io: Io): Promise<number> {
  const targets = a.catalogs.length > 0 ? a.catalogs : await builtinIds();
  const [first, ...rest] = targets;
  if (first === undefined) {
    io.err("alukit catalog search: there is no catalog to search");
    return 1;
  }
  const opened = await openCatalog(first, { extra: rest.map(catalogDir) });
  const failed = opened.diagnostics.filter((d) => d.severity === "error");
  if (opened.named.length < targets.length) {
    for (const d of failed) io.err(`${d.code}: ${d.message}`);
    io.err(`alukit catalog search: not every catalog named could be opened`);
    return 1;
  }
  const limit = Math.min(a.limit ?? DEFAULT_LIMIT, SEARCH_LIMIT);
  const found = searchCatalog(catalogIndex(opened.set, undefined, opened.named), {
    q: a.query,
    ...(a.kind !== undefined ? { kind: a.kind } : {}),
    limit,
  });
  if (a.json) {
    io.out(
      jsonText({
        schema: SEARCH_SCHEMA,
        query: a.query,
        ...(a.kind !== undefined ? { kind: a.kind } : {}),
        catalogs: opened.named,
        total: found.total,
        items: found.items.map((e) => ({
          id: e.id,
          kind: e.kind,
          family: e.family,
          name: e.name,
          ...(e.code !== undefined ? { code: e.code } : {}),
          vendor: e.vendor,
        })),
      }).trimEnd(),
    );
    return found.total > 0 ? 0 : 1;
  }
  if (found.total === 0) {
    io.err(
      `no item matches "${a.query}"${a.kind ? ` among the ${a.kind} items` : ""} in ${opened.named.join(", ")}`,
    );
    return 1;
  }
  const w = (k: "id" | "kind" | "family") => Math.max(...found.items.map((e) => e[k].length));
  const [wi, wk, wf] = [w("id"), w("kind"), w("family")];
  for (const e of found.items) {
    io.out(`${e.id.padEnd(wi)}  ${e.kind.padEnd(wk)}  ${e.family.padEnd(wf)}  ${e.name}`);
  }
  const more = found.total - found.items.length;
  if (more > 0) {
    io.out(
      `… ${more} more of ${found.total}: narrow the query${a.kind === undefined ? ", add --kind," : ""} or raise --limit (${SEARCH_LIMIT} at most)`,
    );
  }
  return 0;
}
