import { createHash } from "node:crypto";
import { z } from "zod";
import { selectedVariant, variantsOf } from "../derive/variant.ts";
import { compareIds } from "../ids.ts";
import { type FieldChange, fieldChanges } from "../lock/diff.ts";
import { type Lock, LockFile, lockText } from "../lock/schema.ts";
import { lockItems } from "../lock/source.ts";
import { projectText } from "../project/canonical.ts";
import { PROJECT_SCHEMA } from "../project/schema.ts";
import { STAMP_FIELDS } from "../stamp.ts";
import { type Outputs, projectOutputs } from "./outputs.ts";

/**
 * Revisions (design §4.13): `revisions/<slug>.json` holds the document, its lock, the outputs
 * derived from them, one set per variant, and a stamp. Opening a revision shows what was
 * published, whatever the tool does now; `verify` re-derives from the stored document and lock
 * (read only: no catalog is opened, nothing is written) and reports any drift. Pure: the caller
 * reads and writes the files and asks git for the commit.
 */

export const REVISION_SCHEMA = "alukit.revision/1";
export const REVISIONS_DIR = "revisions";

export interface Stamp {
  /** AluKit's version. */
  alukit: string;
  /** Node's version: trigonometry is stable within one Node major (§5.2). */
  node: string;
  /** The document's schema version. */
  schema: string;
  /** sha256 of the tool version, the canonical document and the canonical lock. */
  hash: string;
  /** The project's commit and whether its folder had changes: a hint, never an input. */
  git: { commit: string; dirty: boolean } | null;
}

export interface Revision {
  schema: typeof REVISION_SCHEMA;
  name: string;
  /** The order's date: prices older than 30 days before it are stale (§5.5). */
  as_of: string;
  stamp: Stamp;
  document: unknown;
  lock: Lock;
  /**
   * One set per variant the document lists, in name order; with no default variant, the
   * document as written first (what the outputs give with no `--variant`).
   */
  outputs: Outputs[];
}

/**
 * A revision file as read: the envelope and the lock are checked; stored outputs are taken as
 * they were written (they are never migrated, §4.13).
 */
export const RevisionFile = z.object({
  schema: z.literal(REVISION_SCHEMA),
  name: z.string().min(1),
  as_of: z.iso.date(),
  stamp: z.object({
    alukit: z.string(),
    node: z.string(),
    schema: z.string(),
    hash: z.string(),
    git: z.object({ commit: z.string(), dirty: z.boolean() }).nullable(),
  }),
  document: z.record(z.string(), z.unknown()),
  lock: LockFile,
  outputs: z.array(
    z.looseObject({
      variant: z.string().optional(),
      derived: z.record(z.string(), z.unknown()),
      cutlist: z.record(z.string(), z.unknown()),
      bom: z.record(z.string(), z.unknown()),
      order: z.record(z.string(), z.unknown()),
      costs: z.record(z.string(), z.unknown()),
      check: z.record(z.string(), z.unknown()),
    }),
  ),
});

/** Reads a revision file's JSON; the problems, one per line, when it is not one. */
export function readRevision(
  json: unknown,
): { ok: true; value: Revision } | { ok: false; problems: string[] } {
  const r = RevisionFile.safeParse(json);
  if (r.success) return { ok: true, value: r.data as unknown as Revision };
  return {
    ok: false,
    problems: r.error.issues
      .slice(0, 20)
      .map((i) => `${i.path.join("/") || "(file)"}: ${i.message}`),
  };
}

/** A revision's file name: `Rev 1.2` is `rev-1.2`. Empty when the name has no letter or digit. */
export function revisionSlug(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
}

/** The content hash of a document and lock under a tool version (§4.13's stamp). */
export function contentStamp(version: string, document: unknown, lock: Lock): string {
  const h = createHash("sha256");
  h.update(`alukit ${version}\n`);
  h.update(projectText(document));
  h.update(lockText(lock));
  return `sha256:${h.digest("hex")}`;
}

/** The variants a revision stores outputs for: see `Revision.outputs`. */
export function revisionVariants(document: unknown): (string | undefined)[] {
  const names = Object.keys(variantsOf(document)?.list ?? {}).sort(compareIds);
  return selectedVariant(document) === undefined ? [undefined, ...names] : names;
}

export interface SaveInput {
  name: string;
  document: unknown;
  lock: Lock;
  asOf: string;
  version: string;
  node: string;
  git: Stamp["git"];
}

export function makeRevision(input: SaveInput): Revision {
  const items = lockItems(input.lock);
  const outputs = revisionVariants(input.document).map((variant) =>
    projectOutputs({ raw: input.document, items, lock: input.lock, variant, asOf: input.asOf }),
  );
  return {
    schema: REVISION_SCHEMA,
    name: input.name,
    as_of: input.asOf,
    stamp: {
      alukit: input.version,
      node: input.node,
      schema: PROJECT_SCHEMA,
      hash: contentStamp(input.version, input.document, input.lock),
      git: input.git,
    },
    document: input.document,
    lock: input.lock,
    outputs,
  };
}

/** The stored outputs for a variant: the one named, else what no `--variant` gives. */
export function storedOutputs(r: Revision, variant?: string): Outputs | undefined {
  const want = variant ?? selectedVariant(r.document);
  return r.outputs.find((o) => o.variant === want);
}

export interface OutputDrift {
  variant?: string;
  /** Which output: derived, cutlist, bom, order, costs, machining, check. */
  output: keyof Omit<Outputs, "variant">;
  changes: FieldChange[];
}

export interface Verification {
  /** The stored document and lock still hash to the stamp (the file was not edited). */
  intact: boolean;
  /** The stamp's tool version, when it is not this one. */
  version?: { saved: string; now: string };
  /** Variants stored and not derivable now, or derivable and not stored. */
  variants: { missing: string[]; extra: string[] };
  drift: OutputDrift[];
}

const OUTPUT_KEYS = ["derived", "cutlist", "bom", "order", "costs", "machining", "check"] as const;

const label = (v: string | undefined) => v ?? "(no variant)";

/**
 * Re-derives a revision from its stored document and lock with this tool, and compares every
 * output with what was stored, field by field.
 */
export function verifyRevision(r: Revision, version: string): Verification {
  const intact = contentStamp(r.stamp.alukit, r.document, r.lock) === r.stamp.hash;
  const want = revisionVariants(r.document);
  const stored = r.outputs.map((o) => o.variant);
  const missing = stored.filter((v) => !want.includes(v)).map(label);
  const extra = want.filter((v) => !stored.includes(v)).map(label);
  const items = lockItems(r.lock);
  const drift: OutputDrift[] = [];
  for (const old of r.outputs) {
    if (!want.includes(old.variant)) continue;
    const now = projectOutputs({
      raw: r.document,
      items,
      lock: r.lock,
      variant: old.variant,
      asOf: r.as_of,
    });
    for (const key of OUTPUT_KEYS) {
      const changes = fieldChanges(old[key], storedStamp(old[key], now[key]));
      if (changes.length > 0) {
        drift.push({
          ...(old.variant !== undefined ? { variant: old.variant } : {}),
          output: key,
          changes,
        });
      }
    }
  }
  return {
    intact,
    ...(r.stamp.alukit !== version ? { version: { saved: r.stamp.alukit, now: version } } : {}),
    variants: { missing, extra },
    drift,
  };
}

/**
 * An output as re-derived, without the stamp fields the stored one does not state (§5.4): an
 * earlier AluKit stamped only the order and the costs. The stamp says where the numbers came
 * from (the lock, whose hash the revision's own stamp covers, and the oldest price read date);
 * it is not one of them, so a stamp the store never had is not drift. A stamp it has is compared.
 */
function storedStamp(stored: unknown, now: unknown): unknown {
  if (typeof stored !== "object" || stored === null || typeof now !== "object" || now === null) {
    return now;
  }
  const out = { ...(now as Record<string, unknown>) };
  for (const k of STAMP_FIELDS) if (!Object.hasOwn(stored, k)) delete out[k];
  return out;
}

/** No drift, nothing missing, and the file as it was saved. */
export function verified(v: Verification): boolean {
  return (
    v.intact &&
    v.drift.length === 0 &&
    v.variants.missing.length === 0 &&
    v.variants.extra.length === 0
  );
}
