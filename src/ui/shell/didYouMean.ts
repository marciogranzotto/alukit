/**
 * "Did you mean" for a field the schema does not know (S2.14, U34): the known name nearest to the
 * one written, when it is near enough to be a slip of the keyboard. Owner: S2.
 */

/** The edit distance between two words (Levenshtein: insertions, deletions, substitutions). */
export function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(
        (prev[j] as number) + 1,
        (row[j - 1] as number) + 1,
        (prev[j - 1] as number) + cost,
      );
    }
    prev = row;
  }
  return prev[b.length] as number;
}

/**
 * The candidate nearest to `word`, when it is within a slip: at most two edits, and fewer than
 * half the word's letters. Ties go to the first candidate in the order given.
 */
export function didYouMean(word: string, candidates: Iterable<string>): string | undefined {
  const w = word.toLowerCase();
  let best: { name: string; d: number } | undefined;
  for (const c of candidates) {
    if (c === word) return undefined;
    const d = editDistance(w, c.toLowerCase());
    if (best === undefined || d < best.d) best = { name: c, d };
  }
  if (!best) return undefined;
  return best.d <= 2 && best.d * 2 < word.length ? best.name : undefined;
}

/** The names an "unknown field" message gives: `unknown fields "lenght", "lable"`. */
export function unknownFields(message: string): string[] {
  const m = /unknown fields? (.*)$/.exec(message);
  if (!m) return [];
  return [...(m[1] ?? "").matchAll(/"([^"]+)"/g)].map((x) => x[1] as string);
}
