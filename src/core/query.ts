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
import { outgoing, type Ref, references, referrers } from "./commands/refs.ts";
import type { RawDoc } from "./commands/types.ts";
import type { Derived } from "./derive/derive.ts";
import { compareIds } from "./ids.ts";
import { itemRefSource } from "./lock/refs.ts";
import { optKey } from "./order/types.ts";
import { stringsWithPattern } from "./schema-walk.ts";

/**
 * Selecting entities (design §7.3 `alukit query`): an id (`b7`, `K1`, `project:plate`), a kind
 * (`bars`, `bar`), `tag:<t>`, `item:<ref>`, `<kind> of <id>`: the entities of that kind the
 * entity refers to or that refer to it (`connections of b2`, `bars of c3`), `like:<id>` (what is
 * like it, `similarTo`, by item; `like:<id> by tag`, by its tags; the app's select similar and
 * same tags), and `connected:<ids>` and `connected*:<ids>` (the bars joined to them,
 * `connectedTo`). Over the document as written: pattern copies are derive's, not entities of
 * their own.
 */

export type Selection = { ok: true; ids: string[] } | { ok: false; message: string };

/** What makes two entities alike for `similarTo` (E1.5): their item and options, or their tags. */
export type Likeness = "item" | "tag";

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

/**
 * What is like an entity (E1.5, the app's "select similar"), itself included, in id order: the
 * entities of its kind that share
 *
 * - by `item`: its item and options. A bar's are the ones it derives with (its own, else the
 *   project's default bar's), a part's likewise; one that does not derive is taken as written. A
 *   connection must also be of its type (a butt is not like a splice with the same connector).
 *   Any other kind compares the items it names, so every entity of a kind that names none is
 *   alike.
 * - by `tag`: every tag it carries. An entity with no tags is like nothing but itself.
 *
 * Pattern copies are not entities of the document, so none is returned. Empty when `id` names
 * no entity.
 */
export function similarTo(doc: RawDoc, derived: Derived, id: string, by: Likeness): string[] {
  const kind = kindOf(id);
  if (kind === undefined || !hasEntity(doc, id)) return [];
  const ids = entityIds(doc, kind);
  if (by === "tag") {
    const tags = tagsOf(getEntity(doc, id));
    if (tags.length === 0) return [id];
    return ids.filter((x) => {
      const own = tagsOf(getEntity(doc, x));
      return tags.every((t) => own.includes(t));
    });
  }
  const key = (x: string): string => {
    const v = getEntity(doc, x);
    if (kind === "bars") {
      const b = derived.bars.get(x)?.placed;
      if (b) return optKeyed(b.item.id, b.opt);
    }
    if (kind === "parts") {
      const p = derived.parts.get(x);
      if (p) return optKeyed(p.item, p.opt);
    }
    const own = isObject(v) && isObject(v.opt) ? (v.opt as Record<string, string>) : undefined;
    const items = itemsOf(doc, x).join(" ");
    if (kind === "bars" || kind === "parts") return optKeyed(items, own);
    if (kind === "connections") return `${isObject(v) ? String(v.type) : ""}\u0000${items}`;
    return items;
  };
  const mine = key(id);
  return ids.filter((x) => key(x) === mine);
}

function optKeyed(item: string, opt: Readonly<Record<string, string>> | undefined): string {
  return `${item}\u0000${optKey(opt ?? {})}`;
}

/**
 * The bars joined to some entities by a connection (E1.5, the app's "select connected"), with the
 * entities themselves, in id order. A connection joins every bar it names structurally: its
 * through bar, its ends' bars, a pivot's base bar, a face connection's layers (a run's bars), a
 * stack's bars; a bar an expression reads (`len(b3)`) is not joined by it. From a bar, the bars
 * of every connection that names it; from a connection or a run, its bars; from anything else
 * (a part, a node, a pattern), the bars it names and the bars that name it. `transitive` follows
 * the joints from each bar found until no new bar is reached: the whole assembly the entities
 * belong to. Ids that name no entity of the document (a pattern copy) are left out.
 */
export function connectedTo(
  doc: RawDoc,
  ids: readonly string[],
  opts: { transitive?: boolean } = {},
): string[] {
  const seeds = ids.filter((id) => hasEntity(doc, id));
  const refs = references(doc).filter((r) => r.how !== "expr");
  const barsOf = (to: string): string[] => {
    const kind = kindOf(to);
    if (kind === "bars") return hasEntity(doc, to) ? [to] : [];
    if (kind === "runs") return runBars(doc, to);
    return [];
  };
  // Each connection's bars, and the connections that name each bar.
  const connBars = new Map<string, Set<string>>();
  const barConns = new Map<string, Set<string>>();
  const byFrom = new Map<string, Ref[]>();
  const byTo = new Map<string, Ref[]>();
  for (const r of refs) {
    byFrom.set(r.from, [...(byFrom.get(r.from) ?? []), r]);
    byTo.set(r.to, [...(byTo.get(r.to) ?? []), r]);
    if (kindOf(r.from) !== "connections") continue;
    for (const bar of barsOf(r.to)) {
      connBars.set(r.from, (connBars.get(r.from) ?? new Set()).add(bar));
      barConns.set(bar, (barConns.get(bar) ?? new Set()).add(r.from));
    }
  }
  const joined = (bar: string): string[] =>
    [...(barConns.get(bar) ?? [])].flatMap((c) => [...(connBars.get(c) ?? [])]);

  const out = new Set<string>(seeds);
  const found: string[] = [];
  for (const id of seeds) {
    const kind = kindOf(id);
    if (kind === "bars") found.push(...joined(id));
    else if (kind === "connections") found.push(...(connBars.get(id) ?? []));
    else if (kind === "runs") found.push(...runBars(doc, id));
    else {
      for (const r of byFrom.get(id) ?? []) found.push(...barsOf(r.to));
      for (const r of byTo.get(id) ?? []) found.push(...barsOf(r.from));
    }
  }
  // The seeds are in already; a transitive walk goes on from each bar it reaches.
  for (let i = 0; i < found.length; i++) {
    const bar = found[i] as string;
    if (out.has(bar)) continue;
    out.add(bar);
    if (opts.transitive) found.push(...joined(bar));
  }
  return [...out].sort(compareIds);
}

/** A run's bars, as written. */
function runBars(doc: RawDoc, id: string): string[] {
  const v = getEntity(doc, id);
  const list = Array.isArray(v) ? v : isObject(v) ? v.bars : undefined;
  return Array.isArray(list)
    ? list.filter((x): x is string => typeof x === "string" && hasEntity(doc, x))
    : [];
}

/** The ids a `like:` or `connected:` selector names, comma-separated. */
function idsIn(list: string): string[] {
  return list
    .split(",")
    .map((x) => x.trim())
    .filter((x) => x !== "");
}

export function select(doc: RawDoc, selector: string, derived?: () => Derived): Selection {
  const s = selector.trim();
  const like = /^like:(.*)$/.exec(s);
  if (like) {
    // `like:b1` by item and options; `like:b1 by tag` by every tag it carries (E2.2).
    const by = /^(\S*)\s+by\s+(\S+)$/.exec((like[1] as string).trim());
    const id = (by ? (by[1] as string) : (like[1] as string)).trim();
    const likeness = by ? by[2] : "item";
    if (id === "") return { ok: false, message: "like: needs an id, e.g. like:b1" };
    if (likeness !== "item" && likeness !== "tag") {
      return { ok: false, message: "like: compares by item or by tag, e.g. like:b1 by tag" };
    }
    if (!hasEntity(doc, id)) return { ok: false, message: `there is no entity ${id}` };
    if (!derived) return { ok: false, message: "like: reads the derived model" };
    return { ok: true, ids: similarTo(doc, derived(), id, likeness) };
  }
  const connected = /^connected(\*?):(.*)$/.exec(s);
  if (connected) {
    const ids = idsIn(connected[2] as string);
    if (ids.length === 0) {
      return { ok: false, message: "connected: needs ids, e.g. connected:b1 or connected*:b1,b5" };
    }
    const missing = ids.filter((id) => !hasEntity(doc, id));
    if (missing.length > 0) {
      return {
        ok: false,
        message: `there is no entity ${missing.join(", ")}`,
      };
    }
    return { ok: true, ids: connectedTo(doc, ids, { transitive: connected[1] === "*" }) };
  }
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
