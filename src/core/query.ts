import {
  allIds,
  entityIds,
  entityJsonSchema,
  getEntity,
  hasEntity,
  isObject,
  KIND_NOUN,
  type Kind,
  kindOf,
} from "./commands/doc.ts";
import { outgoing, referrers } from "./commands/refs.ts";
import type { RawDoc } from "./commands/types.ts";
import { compareIds } from "./ids.ts";
import { itemRefSource } from "./lock/refs.ts";
import { stringsWithPattern } from "./schema-walk.ts";

/**
 * Selecting entities (design §7.3 `alukit query`): an id (`b7`, `K1`, `project:plate`), a kind
 * (`bars`, `bar`), `tag:<t>`, `item:<ref>`, or `<kind> of <id>`: the entities of that kind the
 * entity refers to or that refer to it (`connections of b2`, `bars of c3`). Over the document as
 * written: pattern copies are derive's, not entities of their own.
 */

export type Selection = { ok: true; ids: string[] } | { ok: false; message: string };

const KINDS = Object.keys(KIND_NOUN) as Kind[];

/** A kind by its plural or singular name; `point(s)` names nodes, as `alukit add point` does. */
export function kindNamed(name: string): Kind | undefined {
  if ((KINDS as string[]).includes(name)) return name as Kind;
  if (name === "point" || name === "points") return "nodes";
  return KINDS.find((k) => KIND_NOUN[k] === name || `${KIND_NOUN[k]}s` === name);
}

function tagsOf(v: unknown): readonly string[] {
  return isObject(v) && Array.isArray(v.tags) ? (v.tags as string[]) : [];
}

/** Every item an entity names, with a bar's default item when it names none. */
export function itemsOf(doc: RawDoc, id: string): string[] {
  const kind = kindOf(id);
  const v = getEntity(doc, id);
  if (kind === undefined || kind === "items") return [];
  const out = new Set<string>();
  stringsWithPattern(v, entityJsonSchema(kind), itemRefSource(), (ref) => {
    out.add(ref);
  });
  if (kind === "bars" && isObject(v) && v.item === undefined) {
    const d = isObject(doc.defaults) && isObject(doc.defaults.bar) ? doc.defaults.bar : {};
    if (typeof d.item === "string") out.add(d.item);
  }
  return [...out].sort();
}

export function select(doc: RawDoc, selector: string): Selection {
  const s = selector.trim();
  const of = /^(\S+)\s+of\s+(\S+)$/.exec(s);
  if (of) {
    const kind = kindNamed(of[1] as string);
    const id = of[2] as string;
    if (!kind) return { ok: false, message: `"${of[1]}" is not a kind of entity` };
    if (!hasEntity(doc, id)) return { ok: false, message: `there is no entity ${id}` };
    const linked = new Set<string>();
    for (const r of referrers(doc, id)) linked.add(r.from);
    for (const r of outgoing(doc, id)) linked.add(r.to);
    const ids = [...linked]
      .filter((x) => x !== id && kindOf(x) === kind && hasEntity(doc, x))
      .sort(compareIds);
    return { ok: true, ids };
  }
  if (s.startsWith("tag:")) {
    const tag = s.slice(4);
    if (tag === "") return { ok: false, message: "tag: needs a tag, e.g. tag:leg" };
    return { ok: true, ids: allIds(doc).filter((id) => tagsOf(getEntity(doc, id)).includes(tag)) };
  }
  if (s.startsWith("item:")) {
    const ref = s.slice(5);
    if (ref === "") return { ok: false, message: "item: needs an item, e.g. item:std:S40" };
    return { ok: true, ids: allIds(doc).filter((id) => itemsOf(doc, id).includes(ref)) };
  }
  const kind = kindNamed(s);
  if (kind) return { ok: true, ids: entityIds(doc, kind) };
  if (kindOf(s) !== undefined) {
    return hasEntity(doc, s)
      ? { ok: true, ids: [s] }
      : { ok: false, message: `there is no entity ${s}` };
  }
  return {
    ok: false,
    message: `"${s}" is not an id, a kind, tag:<t>, item:<ref> or "<kind> of <id>"`,
  };
}

/** Ids compressed into runs of consecutive numbers: `b1–b4, b7, c2–c3`. */
export function idRanges(ids: readonly string[]): string {
  const out: string[] = [];
  const sorted = [...ids].sort(compareIds);
  let i = 0;
  while (i < sorted.length) {
    const first = sorted[i] as string;
    const m = /^([A-Za-z]+)(\d+)$/.exec(first);
    let j = i;
    if (m) {
      while (j + 1 < sorted.length) {
        const n = /^([A-Za-z]+)(\d+)$/.exec(sorted[j + 1] as string);
        const cur = /^([A-Za-z]+)(\d+)$/.exec(sorted[j] as string);
        if (!n || !cur || n[1] !== m[1] || Number(n[2]) !== Number(cur[2]) + 1) break;
        j++;
      }
    }
    out.push(j > i + 1 ? `${first}–${sorted[j]}` : j === i + 1 ? `${first}, ${sorted[j]}` : first);
    i = j + 1;
  }
  return out.join(", ");
}
