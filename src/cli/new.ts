import { access, mkdir, readFile } from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";
import { builtinIds } from "#catalog/open.ts";
import { sellsTslot } from "#catalog/search.ts";
import { idList } from "#core/commands/words.ts";
import { pinLock } from "#core/lock/pin.ts";
import { documentRefs } from "#core/lock/refs.ts";
import { LOCK_FILE } from "#core/lock/schema.ts";
import { projectText } from "#core/project/canonical.ts";
import { DOCUMENT, isPath, openLiveCatalogs } from "#core/project/open.ts";
import { PROJECT_SCHEMA, ProjectDoc } from "#core/project/schema.ts";
import { STATE_DIR, withEditLock, writeAtomic, writeProject } from "#core/project/store.ts";
import { parseOptions, usageError } from "./args.ts";
import type { Io } from "./cli.ts";
import { diagnosticLine } from "./project.ts";
import { usageOf } from "./project-usage.ts";

/**
 * `alukit new <dir> [--name] [--catalog <id|path>]... [--currency <code>]` (design §7.3):
 * creates a project folder: `alukit.json`, its lock pinning the catalogs it names (§4.13), and a
 * `.gitignore` line for `.alukit/`, the edit lock's folder (§7.1). Without `--catalog` it names
 * the built-in `std` catalog. It refuses a folder that already holds a project. When none of the
 * catalogs it names sells T-slot profile, a notice says which built-in ones do (D-UX-7): naming
 * one by default would make one vendor the tool's default, which is a call beyond the command.
 */

const NEW_USAGE = usageOf("new");
const DEFAULT_CATALOG = "std";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** `.gitignore` with a line for the state folder, added when it is not there yet. */
async function ignoreState(dir: string): Promise<boolean> {
  const path = join(dir, ".gitignore");
  const line = `${STATE_DIR}/`;
  let text = "";
  try {
    text = await readFile(path, "utf8");
  } catch {
    // none yet
  }
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  if (lines.includes(line) || lines.includes(STATE_DIR) || lines.includes(`/${line}`)) return false;
  await writeAtomic(path, `${text}${text === "" || text.endsWith("\n") ? "" : "\n"}${line}\n`);
  return true;
}

export async function newCommand(argv: readonly string[], io: Io): Promise<number> {
  const args = parseOptions(
    "new",
    argv,
    {
      name: { type: "string" },
      catalog: { type: "string", multiple: true },
      currency: { type: "string" },
    },
    NEW_USAGE,
    io,
  );
  if (args === 2) return 2;
  const [dir, ...extra] = args.positionals;
  if (dir === undefined) return usageError("new", "a project folder is needed", NEW_USAGE, io);
  if (extra.length > 0) return usageError("new", `unexpected argument ${extra[0]}`, NEW_USAGE, io);
  const root = resolve(dir);
  if (await exists(join(root, DOCUMENT))) {
    io.err(`alukit new: ${join(dir, DOCUMENT)} already exists`);
    return 1;
  }

  // A path on the command line is the shell's; the document's paths are the project's (§3.1).
  const catalogs = (args.values.catalog ?? [DEFAULT_CATALOG]).map((c) => {
    if (!isPath(c)) return c;
    const rel = relative(root, resolve(c)).split(sep).join("/");
    // A bare folder name would read as a built-in id.
    return rel === "" ? "." : rel.startsWith(".") ? rel : `./${rel}`;
  });
  const doc = {
    schema: PROJECT_SCHEMA,
    name: args.values.name ?? basename(root),
    catalogs,
    ...(args.values.currency !== undefined ? { currency: args.values.currency } : {}),
  };
  const valid = ProjectDoc.safeParse(doc);
  if (!valid.success) {
    for (const i of valid.error.issues) io.err(`alukit new: ${i.path.join("/")}: ${i.message}`);
    return 2;
  }

  await mkdir(root, { recursive: true });
  const live = await openLiveCatalogs(root, doc);
  if (live.diagnostics.some((d) => d.severity === "error")) {
    for (const d of live.diagnostics) io.err(diagnosticLine(d));
    io.err("alukit new: the catalogs have errors; nothing was written");
    return 1;
  }
  const { lock } = pinLock(live.set, documentRefs(doc), undefined, { kind: "add" });
  await withEditLock(root, () => writeProject(root, projectText(doc), lock));
  const ignored = await ignoreState(root);
  io.out(
    `created ${join(dir, DOCUMENT)} and ${join(dir, LOCK_FILE)} (catalogs: ${catalogs.join(", ")})` +
      (ignored ? `; ${STATE_DIR}/ added to .gitignore` : ""),
  );
  if (!sellsTslot(live.set, live.named)) {
    const others: string[] = [];
    for (const id of await builtinIds()) {
      if (catalogs.includes(id)) continue;
      const one = await openLiveCatalogs(root, { catalogs: [id] });
      if (sellsTslot(one.set, [id])) others.push(id);
    }
    if (others.length > 0) {
      io.err(
        `notice: no catalog here sells T-slot profile; ${idList(others, others.length)} ${others.length === 1 ? "does" : "do"}: name it with --catalog ${others[0]}, or add it later with setProject`,
      );
    }
  }
  return 0;
}
