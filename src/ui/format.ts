import { money as coreMoney } from "#core/order/format.ts";

/**
 * How the app writes numbers (docs/ux/plan.md §5.3, §5.8 S4.2; docs/ux/visual-design.md §4.4):
 * every number on screen goes through one of these, so a quantity reads the same in every table
 * and panel. Owner: S4.
 *
 * - **Precision** is the CLI's: lengths and angles to two decimals, masses to three, money from
 *   its minor units as `alukit order` prints it.
 * - **The decimal point** stays the point the CLI prints, so a table and the CLI say one thing.
 * - **Grouping** puts a narrow no-break space (U+202F) between thousands, from four digits in a
 *   table (`table: true`, so a column's digits line up) and from five in running text, as the SI
 *   practice has it. A test and a reader compare numbers after removing U+202F (`plain`).
 * - **Units** go in a column's head, not its cells; in running text a no-break space separates a
 *   number and its unit (`withUnit`).
 * - **Dimmed decimals**: a trailing `.00` is drawn in `--text-3` (`splitNumber`, which `Num`
 *   uses), so `1 120.00` reads as eleven-twenty and still shows its precision.
 */

export interface FormatOptions {
  /** A table cell's form (grouping from four digits), rather than running text's (from five). */
  table?: boolean;
}

/** The thousands separator: a narrow no-break space. */
export const THIN = " ";
/** A no-break space, between a number and its unit. */
export const NBSP = " ";

/**
 * Groups the integer digits of an already-written number in threes: `14433.61` is
 * `14 433.61`. The sign and the decimals are kept; a number with fewer digits than the form's
 * threshold (four in a table, five in running text) is left as it is.
 */
export function group(text: string, o: FormatOptions = {}): string {
  const m = /^([+\-−]?)(\d+)(.*)$/.exec(text);
  if (m === null) return text;
  const [, sign = "", digits = "", rest = ""] = m;
  if (digits.length < (o.table === true ? 4 : 5)) return text;
  return `${sign}${digits.replace(/\B(?=(\d{3})+$)/g, THIN)}${rest}`;
}

/** A written number with its grouping removed: what the CLI prints. */
export function plain(text: string): string {
  return text.replaceAll(THIN, "");
}

/** A number's text split where its dimmed part starts: a trailing `.00` (or `.000`). */
export function splitNumber(text: string): { main: string; dim: string } {
  const m = /^(.*?)(\.0+)$/.exec(text);
  return m === null ? { main: text, dim: "" } : { main: m[1] ?? text, dim: m[2] ?? "" };
}

/** A length, mm. */
export function mm(x: number, o: FormatOptions = {}): string {
  return group(x.toFixed(2), o);
}

/** An angle, degrees. */
export function deg(x: number, o: FormatOptions = {}): string {
  return group(x.toFixed(2), o);
}

/** A mass, kg. */
export function kg(x: number, o: FormatOptions = {}): string {
  return group(x.toFixed(3), o);
}

/** A mass per length, kg/m. */
export function kgPerM(x: number, o: FormatOptions = {}): string {
  return group(x.toFixed(3), o);
}

/** An amount of money, from its minor units (cents): `1 234.50` as `alukit order` writes 1234.50. */
export function money(minor: number, o: FormatOptions = {}): string {
  return group(coreMoney(minor), o);
}

/** A count. */
export function qty(n: number, o: FormatOptions = {}): string {
  return group(String(n), o);
}

/** A number and its unit in running text, kept on one line: `860.00 mm`, `31.74 %`. */
export function withUnit(text: string, unit: string): string {
  return `${text}${NBSP}${unit}`;
}
