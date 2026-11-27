import { type Ast, FUNCTIONS, freeNames, parseExpr } from "../expr.ts";
import { itemRefSource } from "../lock/refs.ts";
import { projectJsonSchema } from "../project/canonical.ts";
import { scopeName } from "../project/scope.ts";
import {
  type JsonSchema,
  type PathKey,
  propertySchema,
  stringsWithPattern,
  visitExprs,
} from "../schema-walk.ts";
import {
  allIds,
  entityJsonSchema,
  getEntity,
  isObject,
  type Kind,
  kindOf,
  PROJECT_ITEM,
} from "./doc.ts";
import type { RawDoc } from "./types.ts";

/**
 * What refers to what in a document (design §6: `removeEntity` refuses when anything refers to
 * the entity, and `cascade` removes the referrers). A reference is held either whole (a bar's
 * `a` naming a node; without its target the referrer means nothing) or as one member of a list
 * (one of a butt's ends; the list can lose it and keep its meaning, down to a minimum length).
 * Expressions refer to entities through accessors (`sec(b3)`, `len(b3)`), which hold them whole.
 *
 * References are read from the document as written, defensively: a hand edit may hold any
 * shape, and a reference that does not parse is not one.
 */

export interface Ref {
  /** The referring entity's id, or a top-level field (`params/H`, `defaults`, `order`). */
  from: string;
  /** Where in it, keys joined by "/". */
  field: string;
  /** The entity referred to. */
  to: string;
  how: "whole" | "member" | "expr";
  /** For a member: the list's path within `from`, and how short the list may become. */
  list?: { path: PathKey[]; min: number };
  /**
   * For a member that is an entry of a map keyed by a bar end (a connection's `hole_faces`, F12):
   * the map's path within `from` and the entry's key. The map can always lose it.
   */
  entry?: { path: PathKey[]; key: string };
}

const ACCESSORS_WITH_IDS = new Set(["sec", "len", "cut", "pos", "dist"]);

/** The entity ids an expression's accessors name. Unparseable text names none. */
export function exprEntityIds(src: string): string[] {
  let ast: Ast;
  try {
    ast = parseExpr(src);
  } catch {
    return [];
  }
  const out: string[] = [];
  const walk = (a: Ast): void => {
    switch (a.t) {
      case "unary":
        walk(a.e);
        break;
      case "bin":
        walk(a.l);
        walk(a.r);
        break;
      case "member":
        walk(a.e);
        break;
      case "call":
        if (!FUNCTIONS.has(a.name) && ACCESSORS_WITH_IDS.has(a.name)) {
          for (const x of a.args) if (x.t === "name") out.push(x.name);
        } else for (const x of a.args) walk(x);
        break;
      default:
        break;
    }
  };
  walk(ast);
  return out;
}

const pathText = (p: readonly PathKey[]) => p.map(String).join("/");

class Collect {
  readonly out: Ref[] = [];
  readonly from: string;
  constructor(from: string) {
    this.from = from;
  }

  whole(to: unknown, field: string): void {
    if (typeof to === "string" && to !== "")
      this.out.push({ from: this.from, field, to, how: "whole" });
  }

  /** An end reference `b7.a` refers to its bar. */
  end(ref: unknown, field: string): void {
    if (typeof ref === "string" && /^b\d+\.[ab]$/.test(ref)) this.whole(ref.split(".")[0], field);
  }

  member(list: unknown, path: PathKey[], min: number, end = false): void {
    if (!Array.isArray(list)) return;
    list.forEach((x, i) => {
      const to = end && typeof x === "string" ? x.split(".")[0] : x;
      if (typeof to === "string" && to !== "") {
        this.out.push({
          from: this.from,
          field: pathText([...path, i]),
          to,
          how: "member",
          list: { path, min },
        });
      }
    });
  }

  station(st: unknown, field: string): void {
    if (isObject(st)) this.whole(st.bar, `${field}/bar`);
  }

  /** A map keyed by bar ends (`hole_faces`, F12): each entry names its end's bar, and can go. */
  endKeys(map: unknown, path: PathKey[]): void {
    if (!isObject(map)) return;
    for (const key of Object.keys(map)) {
      if (!/^b\d+\.[ab]$/.test(key)) continue;
      this.out.push({
        from: this.from,
        field: pathText([...path, key]),
        to: key.split(".")[0] as string,
        how: "member",
        entry: { path, key },
      });
    }
  }

  point(p: unknown, field: string): void {
    if (typeof p === "string") this.whole(p, field);
    else if (isObject(p)) {
      if ("on" in p) this.station(p.on, `${field}/on`);
      if ("pivot" in p) this.whole(p.pivot, `${field}/pivot`);
    }
  }
}

/**
 * An entity without one entry of a map keyed by a bar end (`Ref.entry`, F12); a map left empty
 * goes too, so no empty field is written.
 */
export function withoutEntry(v: unknown, entry: NonNullable<Ref["entry"]>): unknown {
  const at = (x: unknown, path: readonly PathKey[]): unknown => {
    if (path.length === 0) {
      if (!isObject(x)) return x;
      const { [entry.key]: _, ...rest } = x;
      return rest;
    }
    if (!isObject(x)) return x;
    const [k, ...more] = path as [string, ...PathKey[]];
    const inner = at(x[k], more);
    if (isObject(inner) && Object.keys(inner).length === 0) {
      const { [k]: _, ...rest } = x;
      return rest;
    }
    return { ...x, [k]: inner };
  };
  return at(v, entry.path);
}

/** The references one entity holds, by kind. */
function structural(kind: Kind, id: string, v: unknown, c: Collect): void {
  if (kind === "nodes") {
    if (isObject(v)) {
      c.point("on" in v ? { on: v.on } : "pivot" in v ? { pivot: v.pivot } : undefined, "");
    }
    return;
  }
  if (!isObject(v) && !(kind === "runs" && Array.isArray(v))) return;
  switch (kind) {
    case "bars": {
      const b = v as Record<string, unknown>;
      c.point(b.a, "a");
      if (!(isObject(b.b) && "len_mm" in b.b)) c.point(b.b, "b");
      const ends = isObject(b.ends) ? b.ends : {};
      for (const e of ["a", "b"] as const) {
        const plane = isObject(ends[e]) && isObject(ends[e].plane) ? ends[e].plane : undefined;
        if (!plane) continue;
        const f = `ends/${e}/plane`;
        if ("point" in plane) c.point(plane.point, `${f}/point`);
        // A normal may name a bar: the plane is square to its axis (gap G-A, G27).
        if (typeof plane.normal === "string") c.whole(plane.normal, `${f}/normal`);
        if (isObject(plane.face)) c.whole(plane.face.bar, `${f}/face/bar`);
        if ("of" in plane) c.end(plane.of, `${f}/of`);
      }
      break;
    }
    case "runs":
      if (Array.isArray(v)) c.member(v, [], 2);
      else c.member((v as Record<string, unknown>).bars, ["bars"], 2);
      break;
    case "connections": {
      const x = v as Record<string, unknown>;
      // The faces named for side holes, per butting end (F12): an entry goes with its end.
      if (x.type !== "face") c.endKeys(x.hole_faces, ["hole_faces"]);
      switch (x.type) {
        case "butt":
          if (typeof x.through === "string") {
            if (x.through.includes(".")) c.end(x.through, "through");
            else c.whole(x.through, "through");
          } else if (isObject(x.through)) {
            const at = x.through.at;
            // A pose places the body in the world; a point may name a node or a station.
            if (!(isObject(at) && "pos" in at)) c.point(at, "through/at");
          }
          c.member(x.ends, ["ends"], 1, true);
          // Held by another butt's through-fastener (acceptance gap A9): without it, its ends
          // are not held through the bar.
          c.whole(x.held_by, "held_by");
          // A stack's bars set where the ends bear (after the alternative frame's acceptance,
          // X2): without one, the joint is another.
          if (Array.isArray(x.stack)) {
            x.stack.forEach((s, i) => {
              c.whole(s, `stack/${i}`);
            });
          }
          break;
        case "miter":
        case "splice":
          if (Array.isArray(x.ends)) {
            x.ends.forEach((e, i) => {
              c.end(e, `ends/${i}`);
            });
          }
          break;
        case "pivot":
          c.station(x.base, "base");
          c.member(x.ends, ["ends"], 1, true);
          break;
        case "face": {
          c.member(x.bars, ["bars"], 2);
          if (Array.isArray(x.stack)) {
            x.stack.forEach((s, i) => {
              if (isObject(s) && typeof s.inside === "string") {
                c.out.push({
                  from: id,
                  field: `stack/${i}/inside`,
                  to: s.inside,
                  how: "member",
                  list: { path: ["stack"], min: 0 },
                });
              }
            });
          }
          const st = isObject(x.stations) ? x.stations : {};
          if (isObject(st.rail_holes)) c.whole(st.rail_holes.along, "stations/rail_holes/along");
          c.whole(st.pattern, "stations/pattern");
          break;
        }
      }
      break;
    }
    case "parts":
      c.station((v as Record<string, unknown>).on, "on");
      break;
    case "patterns": {
      const x = v as Record<string, unknown>;
      c.member(x.template, ["template"], 1);
      if (typeof x.along === "string") c.whole(x.along, "along");
      if (isObject(x.rail_holes)) c.whole(x.rail_holes.along, "rail_holes/along");
      break;
    }
    case "open": {
      // A scope emptied would widen the block to the whole order (§4.12): its minimum is one.
      // A member names a supplier, an item or an entity (perhaps by its end, piece or copy);
      // only an entity of the document, or a project item, is a reference.
      const scope = (v as Record<string, unknown>).scope;
      if (Array.isArray(scope)) c.member(scope.map(scopeEntity), ["scope"], 1);
      break;
    }
    default:
      break;
  }
}

/** The document entity an open item's scope member names, if any. */
function scopeEntity(name: unknown): string | undefined {
  if (typeof name !== "string") return undefined;
  const s = scopeName(name);
  if ("supplier" in s) return undefined;
  if ("item" in s) return s.item.startsWith(PROJECT_ITEM) ? s.item : undefined;
  return s.entity;
}

/** Expressions inside an entity, and the ids their accessors name. */
function expressions(kind: Kind, v: unknown, c: Collect): void {
  const visit = (src: string, path: readonly PathKey[]) => {
    for (const to of exprEntityIds(src)) {
      c.out.push({ from: c.from, field: pathText(path), to, how: "expr" });
    }
  };
  if (kind === "checks") {
    // Checks are not typed yet (§4.9): their value, limit and expr are expressions.
    if (isObject(v))
      for (const k of ["value", "limit", "expr"])
        if (typeof v[k] === "string") visit(v[k] as string, [k]);
    return;
  }
  visitExprs(v, entityJsonSchema(kind), visit);
}

/** Project items named by an entity: `project:<id>` wherever a field takes a catalog item. */
function projectItems(schema: JsonSchema, v: unknown, c: Collect): void {
  stringsWithPattern(v, schema, itemRefSource(), (s, path) => {
    if (s.startsWith(PROJECT_ITEM)) c.whole(s, pathText(path));
  });
}

/** Every reference the document holds, from entities and from top-level fields. */
export function references(doc: RawDoc): Ref[] {
  const out: Ref[] = [];
  for (const id of allIds(doc)) {
    const kind = kindOf(id) as Kind;
    const v = getEntity(doc, id);
    const c = new Collect(id);
    structural(kind, id, v, c);
    expressions(kind, v, c);
    if (kind !== "items") projectItems(entityJsonSchema(kind), v, c);
    out.push(...c.out);
  }
  // Params read entities through `sec()`; defaults and order name project items.
  const root = projectJsonSchema();
  const params = isObject(doc.params) ? doc.params : {};
  for (const [name, p] of Object.entries(params)) {
    const c = new Collect(`params/${name}`);
    visitExprs(p, propertySchema(propertySchema(root, "params"), name), (src, path) => {
      for (const to of exprEntityIds(src))
        c.out.push({ from: `params/${name}`, field: pathText(path), to, how: "expr" });
    });
    out.push(...c.out);
  }
  for (const key of ["defaults", "order"]) {
    const c = new Collect(key);
    projectItems(propertySchema(root, key), doc[key], c);
    out.push(...c.out);
  }
  return out;
}

/** Every expression of the document, with who holds it: entities, then params. */
export function documentExprs(
  doc: RawDoc,
  visit: (src: string, from: string, field: string) => void,
): void {
  for (const id of allIds(doc)) {
    const kind = kindOf(id) as Kind;
    const v = getEntity(doc, id);
    if (kind === "checks") {
      if (isObject(v)) {
        for (const k of ["value", "limit", "expr"])
          if (typeof v[k] === "string") visit(v[k] as string, id, k);
      }
      continue;
    }
    if (kind === "items") continue;
    visitExprs(v, entityJsonSchema(kind), (src, path) => visit(src, id, pathText(path)));
  }
  const root = projectJsonSchema();
  const params = isObject(doc.params) ? doc.params : {};
  for (const [name, p] of Object.entries(params)) {
    visitExprs(p, propertySchema(propertySchema(root, "params"), name), (src, path) =>
      visit(src, `params/${name}`, pathText(path)),
    );
  }
}

/** Who reads a param: entities and other params whose expressions name it. */
export function paramReaders(doc: RawDoc, name: string): { from: string; field: string }[] {
  const out: { from: string; field: string }[] = [];
  documentExprs(doc, (src, from, field) => {
    if (from === `params/${name}`) return;
    try {
      if (freeNames(parseExpr(src)).has(name)) out.push({ from, field });
    } catch {
      // Not an expression that parses: it reads nothing.
    }
  });
  return out;
}

/** The references to one entity. */
export function referrers(doc: RawDoc, id: string): Ref[] {
  return references(doc).filter((r) => r.to === id);
}

/** The references one entity holds. */
export function outgoing(doc: RawDoc, id: string): Ref[] {
  const kind = kindOf(id);
  if (!kind) return [];
  const v = getEntity(doc, id);
  const c = new Collect(id);
  structural(kind, id, v, c);
  expressions(kind, v, c);
  if (kind !== "items") projectItems(entityJsonSchema(kind), v, c);
  return c.out;
}
