import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { localDate } from "#core/dates.ts";
import { gitStamp } from "#core/project/git.ts";
import { loadProject, writeAtomic } from "#core/project/store.ts";
import { deriveOutputs } from "#core/revision/outputs.ts";
import { contentStamp } from "#core/revision/revision.ts";
import { writeGlb } from "../export/glb.ts";
import { glbScene } from "../export/model.ts";
import { parseOptions, usageError } from "./args.ts";
import { type Io, packageVersion } from "./cli.ts";
import { diagnosticLine, variantExists } from "./project.ts";
import { publishUsageOf } from "./publish-usage.ts";

/**
 * `alukit export glb <dir> -o <file.glb> [--variant v] [--frozen]` (design §9): the derived
 * model as binary glTF, from the lock like every output. `asset.extras` holds the stamp: AluKit's
 * version, the content hash of the document, lock and tool version, the variant, the revision
 * (none for a project folder), and the git commit and dirty flag as a hint. The same project
 * gives the same bytes.
 */

const USAGE = publishUsageOf("export");

export async function exportCommand(argv: readonly string[], io: Io): Promise<number> {
  const args = parseOptions(
    "export",
    argv,
    {
      out: { type: "string", short: "o" },
      variant: { type: "string" },
      frozen: { type: "boolean" },
    },
    USAGE,
    io,
  );
  if (args === 2) return 2;
  const [what, dir, ...extra] = args.positionals;
  if (what !== "glb") return usageError("export", "the only format is glb", USAGE, io);
  if (dir === undefined) return usageError("export", "a project folder is needed", USAGE, io);
  if (extra.length > 0) return usageError("export", `unexpected argument ${extra[0]}`, USAGE, io);
  const out = args.values.out;
  if (out === undefined) return usageError("export", "-o <file.glb> is needed", USAGE, io);

  const root = resolve(dir);
  const project = await loadProject(root, { frozen: args.values.frozen === true });
  for (const n of project.notices) io.err(`notice: ${n}`);
  for (const d of project.diagnostics) io.err(diagnosticLine(d));
  if (project.raw === undefined || project.lock === undefined) return 1;
  const variant = args.values.variant;
  if (!variantExists(project.raw, variant, io, "export")) return 1;

  const version = packageVersion();
  const { derived, outputs } = deriveOutputs({
    raw: project.raw,
    items: project.items,
    lock: project.lock,
    variant,
    // The order only names the SKUs here; its date changes none of them.
    asOf: localDate(),
  });
  const git = (await gitStamp(root)) ?? null;
  const name =
    typeof (project.raw as { name?: unknown }).name === "string"
      ? (project.raw as { name: string }).name
      : "alukit";
  const scene = glbScene({
    derived,
    items: project.items,
    outputs,
    name,
    generator: `AluKit ${version}`,
    stamp: {
      alukit: version,
      hash: contentStamp(version, project.raw, project.lock),
      variant: derived.variant ?? null,
      revision: null,
      git,
    },
  });
  const bytes = writeGlb(scene);
  const path = resolve(out);
  await mkdir(dirname(path), { recursive: true });
  await writeAtomic(path, bytes);

  const count = (kind: string) =>
    scene.nodes.filter((n) => (n.extras as { kind?: string } | undefined)?.kind === kind).length;
  const errors = derived.diagnostics.filter((d) => d.severity === "error").length;
  io.out(
    `wrote ${out}: ${count("bar")} bars, ${count("part")} parts, ${count("fastener")} fasteners; ${scene.meshes.length} meshes, ${bytes.length} bytes${derived.variant ? ` (variant ${derived.variant})` : ""}`,
  );
  if (errors > 0) {
    io.err(
      `warn: the model has ${errors} error${errors === 1 ? "" : "s"}; what did not derive is not in the file (see alukit check)`,
    );
  }
  return 0;
}
