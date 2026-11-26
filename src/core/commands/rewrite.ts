import type { Expr, Face } from "../project/schema.ts";
import { isBarEnd, scopeName } from "../project/scope.ts";
import { isObject, type Kind } from "./doc.ts";
import type { CommandError } from "./types.ts";

/**
 * Rewriting what an entity names (design §6): the edits that move or copy geometry (reverse,
 * split, mirror, array, explode) change points, stations, bar ends and ids wherever an entity
 * holds them. `rewriteEntity` walks those places in one entity; a `Rewriter` says what each
 * becomes, and keeps everything else. A rewriter that cannot express a result throws a
 * `Refusal`, which the command turns into its answer.
 */

export class Refusal extends Error {
  readonly errors: CommandError[];
  constructor(errors: CommandError[]) {
    super(errors.map((e) => e.message).join("; "));
    this.name = "Refusal";
    this.errors = errors;
  }
}

export function refusal(code: string, message: string, extra: Partial<CommandError> = {}): Refusal {
  return new Refusal([{ code, message, ...extra }]);
}

type O = Record<string, unknown>;
type Vec = readonly [Expr, Expr, Expr];

/** What each kind of reference becomes. Every method defaults to keeping what it gets. */
export interface Rewriter {
  /** An entity id (a node, bar, run, connection, part or pattern), where one is named. */
  id?(id: string): string;
  /** A bar end, `b7.a`. */
  end?(ref: string): string;
  /** An inline point, [x, y, z]. */
  coords?(v: Vec): Vec;
  /** A direction or normal. */
  direction?(v: Vec | string): Vec | string;
  /** A station (§4.3), with the entity and field it sits in for messages. */
  station?(st: O, where: string): O;
  /** A world pose (§4.7). */
  pose?(p: O, where: string): O;
  /** A face of a named bar, in an end plane `{ face: { bar, face } }`. */
  face?(bar: string, face: Face, where: string): Face;
  /** Whole entities, after their references: a bar's own fields, a part's roll, a pattern's step. */
  /** A list-form run or node arrives as its array, typed loosely: read it with care. */
  entity?(kind: Kind, id: string, value: O): unknown;
}

function vec(x: unknown): x is Vec {
  return Array.isArray(x) && x.length === 3;
}

function point(p: unknown, rw: Rewriter, where: string): unknown {
  if (typeof p === "string") return rw.id ? rw.id(p) : p;
  if (vec(p)) return rw.coords ? rw.coords(p) : p;
  if (isObject(p)) {
    if (isObject(p.on)) return { ...p, on: rw.station ? rw.station(p.on, where) : p.on };
    if (typeof p.pivot === "string") return { ...p, pivot: rw.id ? rw.id(p.pivot) : p.pivot };
  }
  return p;
}

function endSpec(e: unknown, rw: Rewriter, where: string): unknown {
  if (!isObject(e) || !isObject(e.plane)) return e;
  const pl = e.plane;
  if ("point" in pl) {
    const normal = vec(pl.normal) && rw.direction ? rw.direction(pl.normal) : pl.normal;
    return { ...e, plane: { ...pl, point: point(pl.point, rw, `${where}/point`), normal } };
  }
  if (isObject(pl.face) && typeof pl.face.bar === "string") {
    const bar = pl.face.bar;
    const face = rw.face ? rw.face(bar, pl.face.face as Face, where) : pl.face.face;
    return { ...e, plane: { face: { ...pl.face, bar: rw.id ? rw.id(bar) : bar, face } } };
  }
  if (typeof pl.of === "string") return { ...e, plane: { of: rw.end ? rw.end(pl.of) : pl.of } };
  return e;
}

function ids(list: unknown, rw: Rewriter): unknown {
  return Array.isArray(list) && rw.id
    ? list.map((x) => (typeof x === "string" ? (rw.id as (s: string) => string)(x) : x))
    : list;
}

/**
 * An open item's scope member (§4.12): a bar end as an end, an entity named by its piece or copy
 * through its own id; suppliers and items are not the document's to rewrite.
 */
function scopeMember(x: string, rw: Rewriter): string {
  const s = scopeName(x);
  if (!("entity" in s)) return x;
  if (isBarEnd(s)) return rw.end ? rw.end(x) : x;
  const id = rw.id ? rw.id(s.entity) : s.entity;
  return `${id}${s.copy ?? ""}${s.part ?? ""}`;
}

function ends(list: unknown, rw: Rewriter): unknown {
  return Array.isArray(list) && rw.end
    ? list.map((x) => (typeof x === "string" ? (rw.end as (s: string) => string)(x) : x))
    : list;
}

function bar(id: string, b: O, rw: Rewriter): O {
  const out: O = { ...b, a: point(b.a, rw, `${id}/a`) };
  if (isObject(b.b) && "len_mm" in b.b) {
    const dir = b.b.dir;
    out.b = {
      ...b.b,
      dir: rw.direction && (vec(dir) || typeof dir === "string") ? rw.direction(dir) : dir,
    };
  } else out.b = point(b.b, rw, `${id}/b`);
  if (b.up !== undefined && rw.direction && (vec(b.up) || typeof b.up === "string"))
    out.up = rw.direction(b.up);
  if (isObject(b.ends)) {
    const e: O = {};
    if (b.ends.a !== undefined) e.a = endSpec(b.ends.a, rw, `${id}/ends/a/plane`);
    if (b.ends.b !== undefined) e.b = endSpec(b.ends.b, rw, `${id}/ends/b/plane`);
    out.ends = e;
  }
  return out;
}

function connection(id: string, c: O, rw: Rewriter): O {
  switch (c.type) {
    case "butt": {
      let through = c.through;
      if (typeof through === "string") {
        through = through.includes(".")
          ? rw.end
            ? rw.end(through)
            : through
          : rw.id
            ? rw.id(through)
            : through;
      } else if (isObject(through)) {
        const at = through.at;
        through = {
          ...through,
          at:
            isObject(at) && "pos" in at
              ? rw.pose
                ? rw.pose(at, `${id}/through/at`)
                : at
              : point(at, rw, `${id}/through/at`),
        };
      }
      return { ...c, through, ends: ends(c.ends, rw) };
    }
    case "miter":
    case "splice":
      return { ...c, ends: ends(c.ends, rw) };
    case "pivot":
      return {
        ...c,
        base: isObject(c.base) && rw.station ? rw.station(c.base, `${id}/base`) : c.base,
        ends: ends(c.ends, rw),
      };
    case "face": {
      const out: O = { ...c, bars: ids(c.bars, rw) };
      if (Array.isArray(c.stack)) {
        out.stack = c.stack.map((s) =>
          isObject(s) && typeof s.inside === "string" && rw.id
            ? { ...s, inside: rw.id(s.inside) }
            : s,
        );
      }
      if (isObject(c.stations)) {
        const st: O = { ...c.stations };
        if (isObject(st.rail_holes) && typeof st.rail_holes.along === "string" && rw.id) {
          st.rail_holes = { ...st.rail_holes, along: rw.id(st.rail_holes.along) };
        }
        if (typeof st.pattern === "string" && rw.id) st.pattern = rw.id(st.pattern);
        out.stations = st;
      }
      return out;
    }
    default:
      return c;
  }
}

/** One entity with its references rewritten. */
export function rewriteEntity(kind: Kind, id: string, value: unknown, rw: Rewriter): unknown {
  let out: unknown = value;
  switch (kind) {
    case "nodes":
      if (vec(value)) out = rw.coords ? rw.coords(value) : value;
      else if (isObject(value)) {
        if (vec(value.at)) out = { ...value, at: rw.coords ? rw.coords(value.at) : value.at };
        else out = { ...value, ...(point(value, rw, id) as O) };
      }
      break;
    case "bars":
      if (isObject(value)) out = bar(id, value, rw);
      break;
    case "runs":
      out = Array.isArray(value)
        ? ids(value, rw)
        : isObject(value)
          ? { ...value, bars: ids(value.bars, rw) }
          : value;
      break;
    case "connections":
      if (isObject(value)) out = connection(id, value, rw);
      break;
    case "parts":
      if (isObject(value)) {
        if (isObject(value.on) && rw.station)
          out = { ...value, on: rw.station(value.on, `${id}/on`) };
        else if (isObject(value.at) && rw.pose)
          out = { ...value, at: rw.pose(value.at, `${id}/at`) };
      }
      break;
    case "patterns":
      if (isObject(value)) {
        const p: O = { ...value, template: ids(value.template, rw) };
        if (typeof value.along === "string" && rw.id) p.along = rw.id(value.along);
        else if (isObject(value.along) && vec(value.along.dir) && rw.direction) {
          p.along = { dir: rw.direction(value.along.dir) };
        }
        if (isObject(value.rail_holes) && typeof value.rail_holes.along === "string" && rw.id) {
          p.rail_holes = { ...value.rail_holes, along: rw.id(value.rail_holes.along) };
        }
        out = p;
      }
      break;
    case "open":
      if (isObject(value) && Array.isArray(value.scope)) {
        out = {
          ...value,
          scope: value.scope.map((x) => (typeof x === "string" ? scopeMember(x, rw) : x)),
        };
      }
      break;
    default:
      break;
  }
  return (isObject(out) || Array.isArray(out)) && rw.entity ? rw.entity(kind, id, out as O) : out;
}
