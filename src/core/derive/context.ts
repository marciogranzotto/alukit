import { Diagnostics } from "../diagnostics.ts";
import { type Ast, ExprError, type ExprScope, evalNumber, type Value } from "../expr.ts";
import type { ItemSource } from "../items.ts";
import type { Doc } from "../project/parse.ts";
import type { Bar, Connection, Expr, Node, Param, Part } from "../project/schema.ts";
import { AXIS, type AxisName, type V3 } from "../vec.ts";
import type { Copy, PlacedBar, PlacedPivot, PlacedRun } from "./types.ts";

/**
 * Shared state of one derive run: the document after pattern expansion, the item source,
 * diagnostics, params, and the memo tables of stage 2. Resolution is lazy and memoised, in
 * dependency order, with cycle detection over every kind of entity (design §4.3: "a cycle is an
 * error on every entity in it").
 */

export interface Entity<T> {
  spec: T;
  copy?: Copy;
}

const BUSY = Symbol("busy");
const FAILED = Symbol("failed");
type Memo<T> = Map<string, T | typeof BUSY | typeof FAILED>;

/** Accessors that read the derived model: for checks (M3b), never for document values. */
const MODEL_ACCESSORS = new Set(["len", "cut", "pos", "dist", "bbox", "mass", "cost", "count"]);

export class Ctx {
  readonly doc: Doc;
  readonly items: ItemSource;
  readonly d = new Diagnostics();

  readonly nodes = new Map<string, Entity<Node>>();
  readonly bars = new Map<string, Entity<Bar>>();
  readonly conns = new Map<string, Entity<Connection>>();
  readonly parts = new Map<string, Entity<Part>>();

  readonly placedBars: Memo<PlacedBar> = new Map();
  readonly placedNodes: Memo<V3> = new Map();
  readonly placedRuns: Memo<PlacedRun> = new Map();
  readonly placedPivots: Memo<PlacedPivot> = new Map();

  /** Entities on the current resolution path, for cycle detection. */
  private readonly path: string[] = [];
  /** Entities found in a cycle: their own dependency failures are not reported again. */
  readonly inCycle = new Set<string>();

  private readonly params = new Map<string, number | typeof BUSY | typeof FAILED>();
  readonly scope: ExprScope;

  constructor(doc: Doc, items: ItemSource) {
    this.doc = doc;
    this.items = items;
    this.scope = {
      name: (n) => this.param(n),
      accessor: (name, args) => this.accessor(name, args),
    };
  }

  // -------------------------------------------------------------------------------------------
  // Params (stage 1): evaluated lazily in dependency order; a cycle is an error on each.

  /** A param's value; undefined when there is no such param. Throws when it cannot be valued. */
  param(name: string): number | undefined {
    if (!Object.hasOwn(this.doc.params, name)) return undefined;
    const st = this.params.get(name);
    if (typeof st === "number") return st;
    if (st === FAILED) throw new ExprError(`param ${name} has an error`);
    const key = `param:${name}`;
    if (st === BUSY) {
      this.cycle(key);
      throw new ExprError(`param ${name} is part of a cycle`);
    }
    this.params.set(name, BUSY);
    this.path.push(key);
    const p = this.doc.params[name] as Param;
    const raw: Expr = typeof p === "object" ? p.v : p;
    try {
      const v = evalNumber(raw, this.scope);
      this.params.set(name, v);
      return v;
    } catch (e) {
      this.params.set(name, FAILED);
      if (!this.inCycle.has(key)) {
        this.d.error("expr", name, `param ${name}: ${(e as Error).message}`, { field: "params" });
      }
      throw new ExprError(`param ${name} has an error`);
    } finally {
      this.path.pop();
    }
  }

  /** Every param, valued; failures are reported once. */
  allParams(): Map<string, number> {
    const out = new Map<string, number>();
    for (const name of Object.keys(this.doc.params).sort()) {
      try {
        const v = this.param(name);
        if (v !== undefined) out.set(name, v);
      } catch {
        // reported where it failed
      }
    }
    return out;
  }

  private accessor(name: string, args: readonly Ast[]): Value | undefined {
    if (name === "sec") return this.sec(args);
    if (MODEL_ACCESSORS.has(name)) {
      throw new ExprError(
        `${name}() reads the derived model: checks may use it, document values may not`,
      );
    }
    return undefined;
  }

  /** `sec(b3)`: the bar's section, after swaps (§4.9): generator params and its box size. */
  private sec(args: readonly Ast[]): Value {
    const [a] = args;
    if (args.length !== 1 || a?.t !== "name") throw new ExprError("sec takes one bar id");
    const bar = this.bars.get(a.name);
    if (!bar) throw new ExprError(`sec(${a.name}): no bar ${a.name}`);
    const ref = bar.spec.item ?? this.doc.defaults.bar?.item;
    if (!ref) throw new ExprError(`sec(${a.name}): the bar names no item`);
    const found = this.items.item(ref);
    if (!found.ok) throw new ExprError(`sec(${a.name}): ${found.message}`);
    if (!found.bar) throw new ExprError(`sec(${a.name}): ${ref} is not a bar item`);
    const [[x0, y0], [x1, y1]] = found.bar.section.bbox_mm;
    return {
      kind: "rec",
      what: `section ${found.bar.sectionId}`,
      fields: { ...found.bar.sectionParams, width_mm: x1 - x0, height_mm: y1 - y0 },
    };
  }

  // -------------------------------------------------------------------------------------------
  // Values

  /** A document number or expression; undefined (with a diagnostic) when it cannot be valued. */
  num(owner: string, field: string, x: Expr): number | undefined {
    try {
      return evalNumber(x, this.scope);
    } catch (e) {
      if (e instanceof ExprError) {
        this.d.error("expr", owner, `${field}: ${e.message}`, { field });
        return undefined;
      }
      throw e;
    }
  }

  vec(owner: string, field: string, v: readonly [Expr, Expr, Expr]): V3 | undefined {
    const x = this.num(owner, `${field}[0]`, v[0]);
    const y = this.num(owner, `${field}[1]`, v[1]);
    const z = this.num(owner, `${field}[2]`, v[2]);
    return x === undefined || y === undefined || z === undefined ? undefined : [x, y, z];
  }

  /** A direction: an axis name or a vector expression (not normalised). */
  dir(owner: string, field: string, v: AxisName | readonly [Expr, Expr, Expr]): V3 | undefined {
    return typeof v === "string" ? AXIS[v] : this.vec(owner, field, v);
  }

  // -------------------------------------------------------------------------------------------
  // Memoised resolution with cycle detection

  /**
   * Resolves `key` through `compute` once. A key met again while it is being resolved is a
   * cycle: every entity on the path from it is reported, and the lookup fails.
   */
  memo<T>(table: Memo<T>, key: string, compute: () => T | undefined): T | undefined {
    const st = table.get(key);
    if (st === FAILED) return undefined;
    if (st === BUSY) {
      this.cycle(key);
      return undefined;
    }
    if (st !== undefined) return st;
    table.set(key, BUSY);
    this.path.push(key);
    let out: T | undefined;
    try {
      out = compute();
    } finally {
      this.path.pop();
    }
    table.set(key, out === undefined ? FAILED : out);
    return out;
  }

  private cycle(key: string): void {
    const i = this.path.lastIndexOf(key);
    const members = this.path.slice(i);
    const shown = members.map((m) => m.replace(/^param:/, ""));
    const text = `${[...shown, shown[0]].join(" → ")}`;
    for (const m of members) {
      if (this.inCycle.has(m)) continue;
      this.inCycle.add(m);
      this.d.error("cycle", m.replace(/^param:/, ""), `a dependency cycle: ${text}`);
    }
  }

  /** Reports that `owner` cannot resolve because `dep` failed, unless a cycle explains it. */
  depFailed(owner: string, field: string, dep: string): void {
    if (this.inCycle.has(owner)) return;
    this.d.error("ref", owner, `${field}: depends on ${dep}, which could not be resolved`, {
      field,
      refs: [dep],
    });
  }
}
