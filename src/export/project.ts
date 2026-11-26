import type { Derived } from "#core/derive/derive.ts";
import type { ItemSource } from "#core/items.ts";
import type { Lock } from "#core/lock/schema.ts";
import type { GitStamp } from "#core/project/git.ts";
import { deriveOutputs } from "#core/revision/outputs.ts";
import { contentStamp } from "#core/revision/revision.ts";
import { type GltfScene, writeGlb } from "./glb.ts";
import { glbScene } from "./model.ts";

/**
 * A project as binary glTF (design §9), the one path `alukit export glb` and the server's
 * `/api/export/glb` share, so both give the same bytes for the same document, lock, variant and
 * git state. `asset.extras` holds the stamp: AluKit's version, the content hash of the document,
 * lock and tool version, the variant, the revision (none: this is a project, not a saved
 * revision) and the git commit and dirty flag as a hint.
 */

export interface ProjectGlbInput {
  /** The document as written. */
  raw: unknown;
  lock: Lock;
  /** The items derive reads: the lock's. */
  items: ItemSource;
  /** The variant to derive; absent: the document's default, if it names one (§4.10). */
  variant?: string | undefined;
  /** AluKit's version, for the stamp and the generator. */
  version: string;
  git: GitStamp | null;
  /** The order's date: it names the SKUs only, and no date changes them. */
  asOf: string;
}

export interface ProjectGlb {
  bytes: Uint8Array;
  scene: GltfScene;
  derived: Derived;
}

export function projectGlb(input: ProjectGlbInput): ProjectGlb {
  const { derived, outputs } = deriveOutputs({
    raw: input.raw,
    items: input.items,
    lock: input.lock,
    variant: input.variant,
    asOf: input.asOf,
  });
  const named = (input.raw as { name?: unknown }).name;
  const scene = glbScene({
    derived,
    items: input.items,
    outputs,
    name: typeof named === "string" ? named : "alukit",
    generator: `AluKit ${input.version}`,
    stamp: {
      alukit: input.version,
      hash: contentStamp(input.version, input.raw, input.lock),
      variant: derived.variant ?? null,
      revision: null,
      git: input.git,
    },
  });
  return { bytes: writeGlb(scene), scene, derived };
}
