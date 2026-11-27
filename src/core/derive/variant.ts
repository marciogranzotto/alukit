import {
  entityIds,
  entityJsonSchema,
  getEntity,
  isObject,
  KIND_NOUN,
  type Kind,
  kindOf,
  MAP_KINDS,
  withEntity,
  withField,
  withoutEntity,
} from "../commands/doc.ts";
import { type Ref, references } from "../commands/refs.ts";
import type { RawDoc } from "../commands/types.ts";
import { type Diagnostic, Diagnostics } from "../diagnostics.ts";
import { compareIds } from "../ids.ts";
import type { ItemSource } from "../items.ts";
import { itemRefSource } from "../lock/refs.ts";
import { projectJsonSchema } from "../project/canonical.ts";
import { parseProject } from "../project/parse.ts";
import { type Variant, Variants } from "../project/schema.ts";
import { projectItems } from "../project-items/source.ts";
import { mapStringsWithPattern, type PathKey, propertySchema } from "../schema-walk.ts";

/**
 * Applying a variant (design §4.10, §5.1 stage 1): the document a variant builds, from the
 * document as written. A pure function on the raw document; derive runs it first.
 *
 * - **Which variant.** The one named, else `variants.default`, else none: the document as
 *   written, with no params overridden and nothing swapped.
 * - **Scope.** An entity with `only_in` is in the variants it lists, and in no other (so not in
 *   the document derived with no variant); one with `not_in` is in every variant but those. A
 *   cost line takes them too, so a lump job priced for one option is in that option only.
 * - **What hangs on a left-out entity.** A list that can lose a member keeps its meaning
 *   (§6's cascade): a connection drops the ends of bars the variant leaves out, a run or a
 *   pattern's template its members, an open item its scope's members, each with an info. A
 *   connection left with fewer ends or layers than it needs, or naming a left-out bar as a
 *   whole (a butt's through bar, a pivot's base), is left out too, with an info. Anything else
 *   that names a left-out entity (a point on it, a part on it, a pattern along it) is an error
 *   in that variant ("scope it too"), and is left out with it.
 * - **Params** the variant gives replace or add to the document's.
 * - **Swaps** replace an item wherever the frame names one: the entities and `defaults`. The
 *   records about buying (`order`, `costs`, `price_bands`) keep naming what they name. A bar or
 *   part whose item a swap replaces keeps only the options its new item has; each one dropped is
 *   an info. The new item may be a project item (§4.8), which has none.
 */

export interface VariantResult {
  /** The document the variant builds. */
  raw: unknown;
  /** The variant applied; undefined for the document as written. */
  variant?: string;
  /** Entities the variant leaves out, in id order: by their own scope, or by what they name. */
  omitted: string[];
  diagnostics: Diagnostic[];
}

/** The document's variants as written, when they are valid; undefined otherwise. */
export function variantsOf(raw: unknown): Variants | undefined {
  if (!isObject(raw) || raw.variants === undefined) return undefined;
  const r = Variants.safeParse(raw.variants);
  return r.success ? r.data : undefined;
}

/** The variant `name` selects: itself when it exists, else the default; undefined for none. */
export function selectedVariant(raw: unknown, name?: string): string | undefined {
  const vs = variantsOf(raw);
  if (name !== undefined) return vs && Object.hasOwn(vs.list, name) ? name : undefined;
  return vs?.default !== undefined && Object.hasOwn(vs.list, vs.default) ? vs.default : undefined;
}

/**
 * Why a variant cannot be derived, for a CLI flag or a server query that names it (§4.10): the
 * document does not list it. Undefined when it may be: `name` is absent (the default) or listed.
 */
export function unknownVariant(raw: unknown, name: string | undefined): string | undefined {
  if (name === undefined || selectedVariant(raw, name) !== undefined) return undefined;
  const names = Object.keys(variantsOf(raw)?.list ?? {}).sort(compareIds);
  return `there is no variant ${name}; ${names.length === 0 ? "the project has none" : `the project has ${names.join(", ")}`}`;
}

function known(list: Readonly<Record<string, unknown>>): string {
  const names = Object.keys(list).sort(compareIds);
  return names.length === 0 ? "; the document has none" : `; it has ${names.join(", ")}`;
}

function scopeOf(v: unknown): { only_in?: unknown; not_in?: unknown } {
  return isObject(v) ? v : {};
}

function strings(x: unknown): string[] | undefined {
  return Array.isArray(x) ? x.filter((s): s is string => typeof s === "string") : undefined;
}

function getAt(v: unknown, path: readonly PathKey[]): unknown {
  let cur = v;
  for (const k of path) {
    cur = isObject(cur) || Array.isArray(cur) ? (cur as Record<string, unknown>)[k] : undefined;
  }
  return cur;
}

function setAt(v: unknown, path: readonly PathKey[], value: unknown): unknown {
  if (path.length === 0) return value;
  const [k, ...rest] = path as [string, ...PathKey[]];
  const o = isObject(v) ? v : {};
  return { ...o, [k]: setAt(o[k], rest, value) };
}

/** What a list member names: an id, the bar of an end reference, a sleeve's hollow layer. */
function memberTarget(x: unknown): string | undefined {
  if (typeof x === "string") return /^b\d+\.[ab]$/.test(x) ? x.split(".")[0] : x;
  if (isObject(x) && typeof x.inside === "string") return x.inside;
  return undefined;
}

/** A member as the info names it: an end, an id, a sleeve. */
function memberText(x: unknown): string {
  if (typeof x === "string") return x;
  if (isObject(x) && typeof x.item === "string") return `the sleeve ${x.item}`;
  return JSON.stringify(x);
}

/** Kinds whose lists may shrink, or which may go, with only an info. */
const SOFT: ReadonlySet<Kind> = new Set(["connections", "runs", "patterns", "open"]);

/**
 * What takes `only_in` and `not_in`: the entity maps, and cost lines (acceptance gap A5), whose
 * amounts may differ between options as a part's do.
 */
const SCOPED: readonly Kind[] = [...MAP_KINDS, "costs"];

export function applyVariant(raw: unknown, items?: ItemSource, name?: string): VariantResult {
  if (!isObject(raw)) return { raw, omitted: [], diagnostics: [] };
  const d = new Diagnostics();
  // An invalid `variants` is a schema error of parseProject's; the document derives as written.
  const vs = variantsOf(raw);
  const list: Readonly<Record<string, Variant>> = vs?.list ?? {};

  let selected: string | undefined;
  if (name !== undefined) {
    if (Object.hasOwn(list, name)) selected = name;
    else d.error("variant", undefined, `there is no variant ${name}${known(list)}`);
  } else if (vs?.default !== undefined) {
    if (Object.hasOwn(list, vs.default)) selected = vs.default;
    else {
      d.error("variant", undefined, `variants/default: there is no variant ${vs.default}`, {
        field: "variants/default",
      });
    }
  }
  const where = selected === undefined ? "the document without a variant" : `variant ${selected}`;

  // Each entity's own scope, and each cost line's.
  const out: string[] = [];
  for (const kind of SCOPED) {
    for (const id of entityIds(raw, kind)) {
      const s = scopeOf(getEntity(raw, id));
      const only = strings(s.only_in);
      const not = strings(s.not_in);
      if (vs || raw.variants === undefined) {
        for (const [field, names] of [
          ["only_in", only],
          ["not_in", not],
        ] as const) {
          for (const n of names ?? []) {
            if (!Object.hasOwn(list, n)) {
              d.error("variant", id, `${field} names no variant ${n}${known(list)}`, { field });
            }
          }
        }
      }
      const inOnly = only === undefined || (selected !== undefined && only.includes(selected));
      const inNot = not === undefined || selected === undefined || !not.includes(selected);
      if (!(inOnly && inNot)) out.push(id);
    }
  }

  // What hangs on them (§6's cascade, softened for the lists that can lose a member).
  let doc: RawDoc = raw;
  const byTarget = new Map<string, Ref[]>();
  if (out.length > 0) {
    for (const r of references(raw)) {
      if (r.how === "expr") continue;
      const rs = byTarget.get(r.to);
      if (rs) rs.push(r);
      else byTarget.set(r.to, [r]);
    }
  }
  const removed = new Set<string>();
  const queue = [...out];
  while (queue.length > 0) {
    const x = queue.shift() as string;
    if (removed.has(x)) continue;
    removed.add(x);
    for (const r of byTarget.get(x) ?? []) {
      if (removed.has(r.from)) continue;
      const kind = kindOf(r.from);
      // Top-level fields (params, defaults, order) name entities only in expressions.
      if (kind === undefined || kind === "items") continue;
      if (r.how === "member" && r.list) {
        const v = getEntity(doc, r.from);
        const members = getAt(v, r.list.path);
        if (Array.isArray(members)) {
          const gone = members.filter((m) => memberTarget(m) === x);
          const kept = members.filter((m) => memberTarget(m) !== x);
          if (kept.length >= r.list.min) {
            if (gone.length > 0) {
              doc = withEntity(doc, r.from, setAt(v, r.list.path, kept));
              d.info(
                "variant",
                r.from,
                `${gone.map(memberText).join(", ")} dropped: ${x} is not in ${where}`,
                { field: r.list.path.join("/"), refs: [x] },
              );
            }
            continue;
          }
        }
      }
      const noun = KIND_NOUN[kind];
      if (SOFT.has(kind) && !(kind === "patterns" && r.how === "whole")) {
        d.info("variant", r.from, `${noun} left out: it names ${x}, which is not in ${where}`, {
          field: r.field,
          refs: [x],
        });
      } else {
        d.error(
          "variant",
          r.from,
          `${r.field}: names ${x}, which is not in ${where}; scope ${r.from} to the same variants (only_in, not_in)`,
          { field: r.field, refs: [x] },
        );
      }
      queue.push(r.from);
    }
  }
  for (const x of removed) doc = withoutEntity(doc, x);

  const variant = selected === undefined ? undefined : list[selected];
  if (variant?.params) {
    const params = isObject(doc.params) ? doc.params : {};
    doc = withField(doc, "params", { ...params, ...variant.params });
  }
  if (variant?.swap && Object.keys(variant.swap).length > 0) {
    const source = items ? withProjectItems(items, raw) : undefined;
    doc = swapItems(doc, raw, variant.swap, selected as string, source, d);
  }

  return {
    raw: doc,
    ...(selected !== undefined ? { variant: selected } : {}),
    omitted: [...removed].sort(compareIds),
    diagnostics: d.sorted(),
  };
}

/**
 * The items a swap's new item is looked up in: the catalogs' and the document's own project items
 * (§4.8), as derive reads them. A variant changes no project item, so the document as written
 * holds them; they are resolved only when a swapped entity has options to check.
 */
function withProjectItems(items: ItemSource, raw: RawDoc): ItemSource {
  let own: ItemSource | undefined;
  const get = () => {
    own ??= projectItems(items, parseProject(raw).doc).source;
    return own;
  };
  return {
    item: (ref) => get().item(ref),
    offers: (itemId) => get().offers(itemId),
    material: (ref) => get().material(ref),
  };
}

/** The item a bar or part names: its own, or (a bar) the default bar item. */
function itemOf(doc: RawDoc, kind: Kind, v: unknown): string | undefined {
  if (isObject(v) && typeof v.item === "string") return v.item;
  if (kind !== "bars") return undefined;
  const defaults = isObject(doc.defaults) ? doc.defaults : {};
  const bar = isObject(defaults.bar) ? defaults.bar : {};
  return typeof bar.item === "string" ? bar.item : undefined;
}

function swapItems(
  doc0: RawDoc,
  written: RawDoc,
  swap: Readonly<Record<string, string>>,
  variant: string,
  items: ItemSource | undefined,
  d: Diagnostics,
): RawDoc {
  const used = new Set<string>();
  const source = itemRefSource();
  const map = (s: string) => {
    const to = swap[s];
    if (to === undefined) return s;
    used.add(s);
    return to;
  };
  let doc = doc0;
  for (const kind of MAP_KINDS) {
    const schema = entityJsonSchema(kind);
    for (const id of entityIds(doc0, kind)) {
      const v = getEntity(doc0, id);
      const w = mapStringsWithPattern(v, schema, source, map);
      const was = itemOf(written, kind, v);
      const now = was === undefined ? undefined : (swap[was] ?? was);
      const next =
        (kind === "bars" || kind === "parts") && was !== now && now !== undefined
          ? keepOptions(id, w, now, was as string, items, d)
          : w;
      if (next !== v) doc = withEntity(doc, id, next);
    }
  }
  if (doc0.defaults !== undefined) {
    const schema = propertySchema(projectJsonSchema(), "defaults");
    const w = mapStringsWithPattern(doc0.defaults, schema, source, map);
    if (w !== doc0.defaults) doc = withField(doc, "defaults", w);
  }
  for (const from of Object.keys(swap).sort(compareIds)) {
    if (!used.has(from)) {
      d.warn("variant", undefined, `variant ${variant} swaps ${from}, which nothing names`, {
        field: `variants/list/${variant}/swap`,
      });
    }
  }
  return doc;
}

/** A swapped bar's or part's options, cut to those its new item has (each dropped an info). */
function keepOptions(
  id: string,
  v: unknown,
  now: string,
  was: string,
  items: ItemSource | undefined,
  d: Diagnostics,
): unknown {
  if (!items || !isObject(v) || !isObject(v.opt)) return v;
  const found = items.item(now);
  if (!found.ok) return v;
  const has = found.item.options ?? {};
  const opt: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v.opt)) {
    if (Object.hasOwn(has, k)) opt[k] = x;
    else {
      d.info("variant", id, `opt/${k} dropped: ${now}, swapped in for ${was}, has no such option`, {
        field: `opt/${k}`,
      });
    }
  }
  if (Object.keys(opt).length === Object.keys(v.opt).length) return v;
  const { opt: _, ...rest } = v;
  return Object.keys(opt).length > 0 ? { ...rest, opt } : rest;
}
