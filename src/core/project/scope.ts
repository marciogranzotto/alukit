/**
 * A name in an open item's scope (design §4.12), read one way by the order rules that it holds
 * (§5.5) and by the commands that keep it pointing at the right thing (§6):
 *
 * - `supplier:<id>` names a supplier;
 * - `<catalog>:<id>` names an item (`project:<id>` a project item, §4.8): the lines that buy it;
 * - anything else names an entity of the document, perhaps by a part of it: a bar end `b3.a`, a
 *   piece cut from stock for a connection `c23.f1` or `c23.s2`, a pattern copy `b26@2` (§4.7).
 */
export type ScopeName =
  | { supplier: string }
  | { item: string }
  | {
      /** The document's entity: for a pattern copy, its template. */
      entity: string;
      /** The copy suffix, `@2` (nested patterns: `@2@1`). */
      copy?: string;
      /** The part named: a bar end `.a` or `.b`, or a stock piece `.f1`, `.s2`. */
      part?: string;
    };

const ENTITY = /^([A-Za-z]+\d+)((?:@\d+)*)(\.[ab]|\.[fs]\d+)?$/;

export function scopeName(name: string): ScopeName {
  if (name.startsWith("supplier:")) return { supplier: name.slice("supplier:".length) };
  if (name.includes(":")) return { item: name };
  const m = ENTITY.exec(name);
  if (!m) return { entity: name };
  return {
    entity: m[1] as string,
    ...(m[2] ? { copy: m[2] } : {}),
    ...(m[3] ? { part: m[3] } : {}),
  };
}

/** A bar end as written (`b3.a`), with no copy suffix: the form an end reference takes. */
export function isBarEnd(s: ScopeName): boolean {
  return "entity" in s && s.copy === undefined && (s.part === ".a" || s.part === ".b");
}
