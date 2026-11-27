import { money as coreMoney } from "#core/order/format.ts";

/**
 * How the app writes numbers (docs/ux/plan.md §5.3): every number on screen goes through one of
 * these, so a quantity reads the same in every table and panel. `table` asks for a table cell's
 * form (S4.2 groups thousands from four digits there, from five in running text). Owner: S4,
 * which sets the grouping, the dimmed decimals and the units in S4.2.
 *
 * Today's forms are the tables', which are the CLI's: millimetres and degrees to two decimals,
 * kilograms to three, money in its currency's minor units as `alukit order` prints it, and no
 * grouping.
 */

export interface FormatOptions {
  /** A table cell's form, rather than running text's. */
  table?: boolean;
}

/** A length, mm. */
export function mm(x: number, _o: FormatOptions = {}): string {
  return x.toFixed(2);
}

/** An angle, degrees. */
export function deg(x: number, _o: FormatOptions = {}): string {
  return x.toFixed(2);
}

/** A mass, kg. */
export function kg(x: number, _o: FormatOptions = {}): string {
  return x.toFixed(3);
}

/** A mass per length, kg/m. */
export function kgPerM(x: number, _o: FormatOptions = {}): string {
  return x.toFixed(3);
}

/** An amount of money, from its minor units (cents): `1234.50`. */
export function money(minor: number, _o: FormatOptions = {}): string {
  return coreMoney(minor);
}

/** A count. */
export function qty(n: number, _o: FormatOptions = {}): string {
  return String(n);
}

/** A number already written, with its thousands grouped; today none are. */
export function group(text: string, _o: FormatOptions = {}): string {
  return text;
}
