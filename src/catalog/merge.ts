import { isValuedObject, type Prov } from "./schema/common.ts";

/**
 * The field-by-field merge of design §3.1. A *field* is a path of object keys down to a leaf. A
 * leaf is anything that is not a plain object, or the object form of a valued field (`{ "v": … }`);
 * arrays are leaves, replaced whole. Plain objects (`ratings`, `core`, `options`, a definitions
 * map) merge key by key.
 *
 * Every leaf records the file that set it, so a collision names both files and an invalid field
 * names the file to fix.
 */

export type Tree = Record<string, unknown>;

/** Who set a field: the file, its layer, and the default provenance of what it wrote. */
export interface Source {
  file: string;
  layer: 1 | 2 | 3 | "clone";
  /** The default provenance of a bare number set here, when it is not the item's own `prov`. */
  prov?: Prov;
  /** For a field filled from a clone's original: that item's full id. */
  from?: string;
}

export interface Collision {
  path: string;
  first: Source;
  second: Source;
  was: unknown;
  now: unknown;
}

export function isPlainObject(x: unknown): x is Tree {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

/** A plain object that merges key by key, as opposed to a leaf. */
export function isBranch(x: unknown): x is Tree {
  return isPlainObject(x) && !isValuedObject(x);
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => Object.hasOwn(b, k) && deepEqual(a[k], b[k]));
  }
  return false;
}

export function joinPath(prefix: string, key: string): string {
  return prefix === "" ? key : `${prefix}/${key}`;
}

export function splitPath(path: string): string[] {
  return path === "" ? [] : path.split("/");
}

export function getAt(tree: Tree, path: string): unknown {
  let cur: unknown = tree;
  for (const k of splitPath(path)) {
    if (!isPlainObject(cur) || !Object.hasOwn(cur, k)) return undefined;
    cur = cur[k];
  }
  return cur;
}

/** Sets a value, creating plain objects on the way. */
export function setAt(tree: Tree, path: string, value: unknown): void {
  const keys = splitPath(path);
  let cur: Tree = tree;
  for (const k of keys.slice(0, -1)) {
    const next = cur[k];
    if (!isPlainObject(next)) cur[k] = {};
    cur = cur[k] as Tree;
  }
  cur[keys[keys.length - 1] as string] = value;
}

/** A JSON-safe deep copy, so merged trees never share structure with parsed files. */
export function clone<T>(x: T): T {
  return structuredClone(x);
}

/**
 * A tree plus the source of each of its fields. `sources` is keyed by field path (the root
 * entry, "", records who created the tree).
 */
export class Merged {
  readonly tree: Tree = {};
  readonly sources = new Map<string, Source>();

  /** Records `source` for every leaf of `value` at `path`. */
  private record(path: string, value: unknown, source: Source): void {
    if (isBranch(value) && Object.keys(value).length > 0) {
      for (const [k, v] of Object.entries(value)) this.record(joinPath(path, k), v, source);
    } else {
      this.sources.set(path, source);
    }
  }

  /** Drops the sources recorded at or under `path`. */
  forget(path: string): void {
    for (const p of [...this.sources.keys()]) {
      if (p === path || p.startsWith(`${path}/`)) this.sources.delete(p);
    }
  }

  /** The source of a field, or of the first leaf under it (in key order), or of the tree. */
  sourceOf(path: string): Source | undefined {
    const exact = this.sources.get(path);
    if (exact) return exact;
    const under = [...this.sources.keys()].filter((p) => p.startsWith(`${path}/`)).sort();
    const first = under[0];
    if (first !== undefined) return this.sources.get(first);
    const keys = splitPath(path);
    for (let n = keys.length - 1; n >= 0; n--) {
      const s = this.sources.get(keys.slice(0, n).join("/"));
      if (s) return s;
    }
    return undefined;
  }

  /** Every file that set some field of the tree, sorted. */
  files(): string[] {
    return [...new Set([...this.sources.values()].map((s) => s.file))].sort();
  }

  /**
   * Merges a fragment in. A field already set may be set again only to the same value: a later
   * layer may add, never change (design §3.1). Returns the collisions; the earlier value stays.
   */
  add(fragment: Tree, source: Source, prefix = ""): Collision[] {
    const out: Collision[] = [];
    if (prefix === "" && !this.sources.has("")) this.sources.set("", source);
    for (const [k, v] of Object.entries(fragment)) {
      const path = joinPath(prefix, k);
      const cur = getAt(this.tree, path);
      if (cur === undefined) {
        setAt(this.tree, path, clone(v));
        this.record(path, v, source);
      } else if (isBranch(cur) && isBranch(v)) {
        out.push(...this.add(v, source, path));
      } else if (!deepEqual(cur, v)) {
        const first = this.sourceOf(path) as Source;
        out.push({ path, first, second: source, was: cur, now: v });
      }
    }
    return out;
  }
}
