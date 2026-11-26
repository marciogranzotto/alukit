import { stat } from "node:fs/promises";
import { join } from "node:path";
import {
  type OutputSummary,
  outputSummary,
  readRevisionFile,
  revisionFiles,
  variantLabel,
} from "#core/revision/files.ts";
import { REVISIONS_DIR, type Stamp } from "#core/revision/revision.ts";

/**
 * The revisions a project's server lists (design §4.13, §8: the top bar's revision): each saved
 * file's name, date, stamp and what its outputs come to. A revision file holds every variant's
 * outputs and can be large, so each is read once and kept while its size and time stay the same.
 */

export interface RevisionEntry {
  /** The file, relative to the project folder. */
  file: string;
  name: string;
  as_of: string;
  stamp: Stamp;
  variants: string[];
  outputs: OutputSummary[];
}

export interface RevisionList {
  revisions: RevisionEntry[];
  /** Files in `revisions/` that are not revisions, and why. */
  problems: string[];
}

export class RevisionIndex {
  private readonly dir: string;
  private readonly cache = new Map<string, { key: string; entry: RevisionEntry | string[] }>();

  constructor(dir: string) {
    this.dir = dir;
  }

  async list(): Promise<RevisionList> {
    const files = await revisionFiles(this.dir);
    const revisions: RevisionEntry[] = [];
    const problems: string[] = [];
    for (const f of files) {
      const file = join(REVISIONS_DIR, f);
      const path = join(this.dir, file);
      let key: string;
      try {
        const s = await stat(path);
        key = `${s.size}:${s.mtimeMs}`;
      } catch {
        continue; // removed since the folder was read
      }
      let hit = this.cache.get(f);
      if (hit?.key !== key) {
        const r = await readRevisionFile(path, file);
        hit = {
          key,
          entry: r.ok
            ? {
                file,
                name: r.value.name,
                as_of: r.value.as_of,
                stamp: r.value.stamp,
                variants: r.value.outputs.map((o) => variantLabel(o.variant)),
                outputs: r.value.outputs.map(outputSummary),
              }
            : [...r.problems, ...(r.details ?? []).map((d) => `  ${d}`)],
        };
        this.cache.set(f, hit);
      }
      if (Array.isArray(hit.entry)) problems.push(...hit.entry);
      else revisions.push(hit.entry);
    }
    for (const f of this.cache.keys()) if (!files.includes(f)) this.cache.delete(f);
    return { revisions, problems };
  }
}
