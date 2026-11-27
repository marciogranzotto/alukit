/**
 * The stamp every output states (design §5.4, §4.13, §9): the lock it was derived from (the
 * sha256 of the canonical lock, `lockHash`), and, where the output carries prices, the price basis
 * and the oldest price read date. JSON states them as top-level fields, `price_basis`,
 * `oldest_read` and `lock`, in that order; Markdown as lines under the title; CSV as the first
 * rows, `stamp` rows. Outputs called from code without a lock state none (the hand goldens).
 *
 * Nothing here hashes: the caller that read the lock passes its hash in, so this module, and
 * everything that formats an output, stays free of Node.
 */

/** The top-level fields that make an output's stamp. */
export const STAMP_FIELDS = ["price_basis", "oldest_read", "lock"] as const;

/** The oldest of the read dates (YYYY-MM-DD, so text order is date order); null for none. */
export function oldestRead(reads: Iterable<string | undefined>): string | null {
  let oldest: string | null = null;
  for (const r of reads) if (r !== undefined && (oldest === null || r < oldest)) oldest = r;
  return oldest;
}

/** "the oldest was read 2026-10-01", as the Markdown outputs word it. */
export function oldestText(oldest: string | null): string {
  return `the oldest was read ${oldest ?? "(none)"}`;
}

/** The lock an output was derived from, as a Markdown line of its own and the blank line after. */
export function lockLines(lock: string | undefined): string[] {
  return lock === undefined ? [] : [`Derived from the lock ${lock}.`, ""];
}

/**
 * A `stamp` row of a CSV under `columns`: the cells named, the rest empty. Each output puts
 * `stamp` in its row-type column, the stamp field's name in the column that names a row, and the
 * value in a free-text column.
 */
export function stampRow(
  columns: readonly string[],
  cells: Readonly<Record<string, string>>,
): string {
  const cell = (t: string) => (/[",\n]/.test(t) ? `"${t.replaceAll('"', '""')}"` : t);
  return columns.map((c) => cell(cells[c] ?? "")).join(",");
}
