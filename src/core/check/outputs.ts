import { type Bom, bom } from "../bom/bom.ts";
import { type CutList, cutList } from "../cutlist/cutlist.ts";
import type { Derived } from "../derive/derive.ts";
import { type Diagnostic, sortDiagnostics } from "../diagnostics.ts";
import { type Ast, ExprError } from "../expr.ts";
import type { ItemSource } from "../items.ts";
import { type Order, orderOf, type PricedOrder, priceOrder } from "../order/order.ts";
import type { Accessor } from "./model.ts";

/**
 * The outputs a project check may read (design §4.9): `mass()` from the bill of materials and
 * `cost()` from the priced order list, supplied through the accessor table `checkModel` takes.
 * The outputs are stage 5 of the pipeline (§5.1); the checks are stage 6, before the order rules.
 */

/** Stage 5 for one derived model: each output computed once, on first use. */
export interface ModelOutputs {
  cutList(): CutList;
  bom(): Bom;
  priced(): PricedOrder;
}

function once<T>(f: () => T): () => T {
  let done = false;
  let v: T;
  return () => {
    if (!done) {
      v = f();
      done = true;
    }
    return v;
  };
}

export function modelOutputs(derived: Derived, items: ItemSource): ModelOutputs {
  const cl = once(() => cutList({ derived, items }));
  const b = once(() => bom({ derived, items }));
  const priced = once(() => priceOrder({ derived, items, bom: b(), cutList: cl() }));
  return { cutList: cl, bom: b, priced };
}

/**
 * The order list with its rules (§5.1 stage 6, §5.5), after the checks: every error so far, the
 * checks' and the BOM's, holds an order through `check-error`. `alukit order`, `alukit costs` and
 * the server's `/api/order` and `/api/costs` all build it here, so they answer the same.
 */
export function checkedOrder(
  outputs: ModelOutputs,
  checks: readonly Diagnostic[],
  input: { asOf: string; lock?: string },
): Order {
  return orderOf(outputs.priced(), {
    diagnostics: sortDiagnostics([...checks, ...outputs.bom().diagnostics]),
    asOf: input.asOf,
    ...(input.lock !== undefined ? { lock: input.lock } : {}),
  });
}

const BOUNDS = ["low", "likely", "high"] as const;

/**
 * `mass()`: the BOM's total mass in kg. `cost()`, `cost(low)`, `cost(likely)` and `cost(high)`:
 * the order's total in the project's currency, in its major unit (minor units / 100, as the
 * outputs print it); `cost()` is the likely total.
 *
 * A total that leaves something out cannot answer a check, so the check cannot be evaluated (an
 * error naming what is missing) rather than pass on a partial sum: an item with no mass, an order
 * line with no price, a cost line with no exchange rate.
 */
export function outputAccessors(outputs: ModelOutputs): Record<string, Accessor> {
  return {
    mass: (args) => {
      if (args.length !== 0) throw new ExprError("mass takes no arguments");
      const b = outputs.bom();
      if (b.mass_unknown.length > 0) {
        throw new ExprError(
          `mass(): ${count(b.mass_unknown.length, "item has", "items have")} no mass (${b.mass_unknown.join(", ")})`,
        );
      }
      return b.mass_kg;
    },
    cost: (args) => {
      const bound = boundOf(args);
      const p = outputs.priced();
      const t = p.totals.totals;
      if (t.unpriced > 0) {
        throw new ExprError(
          `cost(): ${count(t.unpriced, "order line has", "order lines have")} no price`,
        );
      }
      const noRate = p.costs.filter((c) => !p.totals.converted.has(c.id)).map((c) => c.id);
      if (noRate.length > 0) {
        throw new ExprError(
          `cost(): no exchange rate into ${t.currency ?? "the project's currency"} for ${noRate.join(", ")}`,
        );
      }
      return t.total[`${bound}_minor`] / 100;
    },
  };
}

function boundOf(args: readonly Ast[]): (typeof BOUNDS)[number] {
  if (args.length === 0) return "likely";
  const [a] = args;
  if (args.length === 1 && a?.t === "name" && (BOUNDS as readonly string[]).includes(a.name)) {
    return a.name as (typeof BOUNDS)[number];
  }
  throw new ExprError("cost takes nothing, or one of low, likely and high: cost(high)");
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}
