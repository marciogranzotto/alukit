import type { Bom } from "../bom/bom.ts";
import { type CheckResult, checkModel } from "../check/check.ts";
import {
  checkedBom,
  checkedCutList,
  checkedMachining,
  checkedOrder,
  modelOutputs,
  outputAccessors,
} from "../check/outputs.ts";
import type { CutList } from "../cutlist/cutlist.ts";
import { type Derived, derive } from "../derive/derive.ts";
import { derivedJson } from "../derive/output.ts";
import { type Diagnostic, sortDiagnostics } from "../diagnostics.ts";
import type { ItemSource } from "../items.ts";
import { lockHash } from "../lock/pin.ts";
import type { Lock } from "../lock/schema.ts";
import type { MachiningSheet } from "../machining/machining.ts";
import { type CostsOutput, costsOf } from "../order/format.ts";
import type { Order } from "../order/order.ts";

/**
 * A project's outputs for one variant, as the CLI prints them in JSON (design §5.1 stages 1–6):
 * the derived model, the cut list, the bill of materials, the order list, the costs, the
 * machining sheet (M6) and the model's checks. One function, so that what a revision stores
 * (§4.13), what `revision verify` recomputes and what `alukit diff` compares are the same numbers
 * as `alukit derive --json`, `cutlist`, `bom`, `order`, `costs` and `machining --format json`
 * print.
 */

export interface Outputs {
  /** The variant derived; absent for the document as written. */
  variant?: string;
  /** `alukit.derived/1`. */
  derived: Record<string, unknown>;
  cutlist: CutList;
  bom: Bom;
  order: Order;
  costs: CostsOutput;
  /** The machining sheet, with the problems met on the way to it (`checkedMachining`). */
  machining: MachiningSheet;
  /** The project's checks and the model's diagnostics, as `alukit check` finds them (§5.5). */
  check: { checks: CheckResult[]; diagnostics: Diagnostic[] };
}

export interface OutputsInput {
  raw: unknown;
  items: ItemSource;
  /** The lock the items come from: every output states its hash. */
  lock?: Lock;
  variant?: string;
  /** The order's date (the stale-price rule). */
  asOf: string;
  /** Problems found reading the files or the catalogs, reported with derive's. */
  diagnostics?: readonly Diagnostic[];
}

/** A value as its JSON text reads back: undefined fields gone, numbers as printed. */
function plain<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

export function projectOutputs(input: OutputsInput): Outputs {
  return deriveOutputs(input).outputs;
}

/** The outputs, and the derived model they come from (the GLB writer places meshes from it). */
export function deriveOutputs(input: OutputsInput): { derived: Derived; outputs: Outputs } {
  const { raw, items } = input;
  const d = derive(raw, items, { variant: input.variant });
  const derived = {
    ...d,
    diagnostics: sortDiagnostics([...(input.diagnostics ?? []), ...d.diagnostics]),
  };
  // Each output states the lock it was derived from (the stamp, §5.4).
  const stamp = input.lock ? { lock: lockHash(input.lock) } : {};
  const outputs = modelOutputs(derived, items, stamp);
  const checked = checkModel({ raw, derived, items, accessors: outputAccessors(outputs) });
  const order = checkedOrder(outputs, checked.diagnostics, { asOf: input.asOf, ...stamp });
  const outputsJson = plain({
    ...(derived.variant !== undefined ? { variant: derived.variant } : {}),
    derived: derivedJson(derived, stamp),
    cutlist: checkedCutList(derived, outputs),
    bom: checkedBom(derived, outputs),
    order,
    costs: costsOf(order),
    machining: checkedMachining(derived, outputs),
    check: { checks: checked.checks, diagnostics: checked.diagnostics },
  });
  return { derived, outputs: outputsJson };
}
