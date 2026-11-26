/**
 * Id order (design §2, §5.2): runs of digits compare by value, everything else by code point,
 * never `localeCompare`. So `b2 < b10 < b10@1 < b10@2 < c1`, and `PF40-01 < PF40-02 < PF45-01`.
 * Ids equal by that rule (`a01` and `a1`) fall back to plain code-point order, so the order is
 * total and the same on every machine.
 */

const CHUNK = /\d+|\D+/g;

function compareDigits(a: string, b: string): number {
  const x = a.replace(/^0+(?=\d)/, "");
  const y = b.replace(/^0+(?=\d)/, "");
  if (x.length !== y.length) return x.length - y.length;
  return x < y ? -1 : x > y ? 1 : 0;
}

function compareCodePoints(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function compareIds(a: string, b: string): number {
  const ca = a.match(CHUNK) ?? [];
  const cb = b.match(CHUNK) ?? [];
  const n = Math.min(ca.length, cb.length);
  for (let i = 0; i < n; i++) {
    const x = ca[i] as string;
    const y = cb[i] as string;
    const dx = /^\d/.test(x);
    const dy = /^\d/.test(y);
    const c = dx && dy ? compareDigits(x, y) : compareCodePoints(x, y);
    if (c !== 0) return c;
  }
  if (ca.length !== cb.length) return ca.length - cb.length;
  return compareCodePoints(a, b);
}

/**
 * True for a string a JS engine treats as an array index, which object key order puts first
 * whatever the insertion order (review M4). Ids must never look like this.
 */
export function isIntegerLike(key: string): boolean {
  return /^(?:0|[1-9]\d*)$/.test(key);
}
