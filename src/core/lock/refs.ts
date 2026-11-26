import { z } from "zod";
import { compareIds } from "../ids.ts";
import { projectJsonSchema } from "../project/canonical.ts";
import { ItemRef } from "../project/schema.ts";
import { stringsWithPattern } from "../schema-walk.ts";
import type { Lock } from "./schema.ts";

/**
 * Every catalog entity a document names (design §4.13: "every catalog item any variant
 * resolves"). Item references are found through the document's JSON Schema, wherever a field is
 * typed `ItemRef`, so a field a later milestone adds to the schema is found without a change
 * here. Two places are not typed yet and are read by hand: a variant's `swap` (§4.10), both its
 * sides, and a project item's `material` (§4.8).
 */

export interface DocRefs {
  /** Catalog items by full id, in id order. */
  items: string[];
  /** Catalog materials by full id, in id order. */
  materials: string[];
}

let pattern: string | undefined;

/** The regular expression of `ItemRef`, as the JSON Schema export writes it. */
export function itemRefSource(): string {
  pattern ??= (z.toJSONSchema(ItemRef) as { pattern: string }).pattern;
  return pattern;
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function isCatalogRef(s: unknown): s is string {
  return typeof s === "string" && /^[a-z][a-z0-9-]*:/.test(s) && !s.startsWith("project:");
}

export function documentRefs(raw: unknown): DocRefs {
  const items = new Set<string>();
  const materials = new Set<string>();
  stringsWithPattern(raw, projectJsonSchema(), itemRefSource(), (s) => {
    if (isCatalogRef(s)) items.add(s);
  });
  if (isObject(raw)) {
    const list = isObject(raw.variants) ? raw.variants.list : undefined;
    if (isObject(list)) {
      for (const v of Object.values(list)) {
        const swap = isObject(v) ? v.swap : undefined;
        if (!isObject(swap)) continue;
        for (const [from, to] of Object.entries(swap)) {
          if (isCatalogRef(from)) items.add(from);
          if (isCatalogRef(to)) items.add(to);
        }
      }
    }
    if (isObject(raw.items)) {
      for (const it of Object.values(raw.items)) {
        if (isObject(it) && isCatalogRef(it.material)) materials.add(it.material);
      }
    }
  }
  return {
    items: [...items].sort(compareIds),
    materials: [...materials].sort(compareIds),
  };
}

/** True when the lock holds every catalog entity the document names directly. */
export function lockCovers(lock: Lock, refs: DocRefs): boolean {
  return (
    refs.items.every((r) => Object.hasOwn(lock.items, r)) &&
    refs.materials.every((r) => Object.hasOwn(lock.materials, r))
  );
}
