import { compareIds } from "../ids.ts";
import { LOCK_KINDS, type Lock, type LockKind } from "./schema.ts";

/**
 * What changes between two locks, field by field (design §4.13: `lock update` "prints a semantic
 * diff: which fields and prices changed"). Objects compare key by key; arrays of the same length
 * element by element, otherwise whole. Pure.
 */

export interface FieldChange {
  /** Keys and indices joined by "/". */
  path: string;
  /** Absent when the field was added. */
  was?: unknown;
  /** Absent when the field was removed. */
  now?: unknown;
}

export interface EntryChange {
  kind: LockKind;
  id: string;
  change: "added" | "removed" | "changed";
  /** For a changed entry: what changed in its value. */
  fields?: FieldChange[];
}

export interface CatalogChange {
  id: string;
  change: "added" | "removed" | "changed";
}

export interface LockDiff {
  entries: EntryChange[];
  catalogs: CatalogChange[];
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => same(x, b[i]));
  }
  if (isObject(a) && isObject(b)) {
    const ka = Object.keys(a);
    return (
      ka.length === Object.keys(b).length &&
      ka.every((k) => Object.hasOwn(b, k) && same(a[k], b[k]))
    );
  }
  return false;
}

/** The changed leaves between two values. */
export function fieldChanges(a: unknown, b: unknown, path = ""): FieldChange[] {
  if (same(a, b)) return [];
  const at = (k: string | number) => (path === "" ? String(k) : `${path}/${k}`);
  if (isObject(a) && isObject(b)) {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort(compareIds);
    return keys.flatMap((k) => {
      if (!Object.hasOwn(a, k)) return [{ path: at(k), now: b[k] }];
      if (!Object.hasOwn(b, k)) return [{ path: at(k), was: a[k] }];
      return fieldChanges(a[k], b[k], at(k));
    });
  }
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) {
    return a.flatMap((x, i) => fieldChanges(x, b[i], at(i)));
  }
  return [{ path, was: a, now: b }];
}

const VALUE_KEY = Object.fromEntries(LOCK_KINDS) as Record<LockKind, string>;

export function diffLocks(a: Lock, b: Lock): LockDiff {
  const entries: EntryChange[] = [];
  for (const [kind] of LOCK_KINDS) {
    const ea = a[kind] as Record<string, Record<string, unknown>>;
    const eb = b[kind] as Record<string, Record<string, unknown>>;
    const ids = [...new Set([...Object.keys(ea), ...Object.keys(eb)])].sort(compareIds);
    for (const id of ids) {
      const x = ea[id];
      const y = eb[id];
      if (!x) entries.push({ kind, id, change: "added" });
      else if (!y) entries.push({ kind, id, change: "removed" });
      else if (x.hash !== y.hash) {
        const key = VALUE_KEY[kind];
        entries.push({ kind, id, change: "changed", fields: fieldChanges(x[key], y[key]) });
      }
    }
  }
  const catalogs: CatalogChange[] = [];
  const cids = [...new Set([...Object.keys(a.catalogs), ...Object.keys(b.catalogs)])].sort(
    compareIds,
  );
  for (const id of cids) {
    const x = a.catalogs[id];
    const y = b.catalogs[id];
    if (!x) catalogs.push({ id, change: "added" });
    else if (!y) catalogs.push({ id, change: "removed" });
    else if (x.hash !== y.hash) catalogs.push({ id, change: "changed" });
  }
  return { entries, catalogs };
}

export function isEmptyDiff(d: LockDiff): boolean {
  return d.entries.length === 0 && d.catalogs.length === 0;
}
