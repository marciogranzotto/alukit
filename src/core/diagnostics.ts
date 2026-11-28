import { compareIds } from "./ids.ts";

/**
 * A problem found in a project (design §5.1): `{ severity, code, entity, message }`, tied to the
 * entity it concerns. Derive never throws on document content; every problem is one of these and
 * the rest still derives.
 */
export type Severity = "error" | "warn" | "info";

/**
 * Every code a project's diagnostic carries, one per kind of problem: derive's (§5.1), the cut
 * list's, the BOM's and the order's, the check's (§5.5), and reading and writing the project's
 * files. The problem list words each one (`CHECK_TITLE`, src/core/problems/words.ts, E1.3), so a
 * code is added here, with its words, before anything may emit it.
 */
export const DIAGNOSTIC_CODES = [
  "anchor",
  "angled-end",
  "bend",
  "butt-miss",
  "butt-no-connector",
  "catalog",
  "chain",
  "check",
  "check-pending",
  "coincident",
  "connection",
  "cover-none",
  "covers",
  "currency",
  "cycle",
  "end-far",
  "expr",
  "face",
  "fit",
  "format",
  "hole",
  "item",
  "joint",
  "json",
  "length",
  "lock",
  "lock-behind",
  "machining",
  "mass",
  "miter",
  "near-vertical",
  "no-offer",
  "option",
  "order",
  "outline",
  "part",
  "pattern",
  "pivot",
  "pivot-plane",
  "pivot-range",
  "plane",
  "price-band",
  "rail",
  "ref",
  "run",
  "schema",
  "splice",
  "station",
  "two-providers",
  "unconnected",
  "up-parallel",
  "variant",
  "write",
  "zero-length",
] as const;

export type DiagnosticCode = (typeof DIAGNOSTIC_CODES)[number];

export interface Diagnostic {
  severity: Severity;
  code: DiagnosticCode;
  /** The entity: `b7`, a bar end `b7.a`, a pattern copy `b30@2`, a param `H`. */
  entity?: string;
  /** A field path within the entity, keys joined by "/". */
  field?: string;
  /** Other entities the problem names: both providers of an end, both ends of a chain. */
  refs?: string[];
  /**
   * What a check whose code covers several findings found (`machining`'s: a hole off its piece,
   * a tap in a groove's opening, …): the problem list titles it by this, never by its words
   * (re-check N10; docs/ux/recheck-fixes-core-decisions.md 15).
   */
  reason?: MachiningReason;
  message: string;
}

/**
 * The findings of derive's machining checks (§5.5), each a `machining` diagnostic's `reason`:
 * a hole reaching past a cut face (`on-piece.ts`), a tap more than half in a groove's opening
 * (`face-taps.ts`), one machining made twice at one place (`duplicates.ts`), and an end tap on
 * a section with no known cores, on no core, not fitting its core, or whose fit is not known
 * (`cores.ts`).
 */
export const MACHINING_REASONS = [
  "off-piece",
  "tap-in-groove",
  "repeated",
  "no-cores",
  "off-core",
  "core-fit",
  "fit-unchecked",
] as const;
export type MachiningReason = (typeof MACHINING_REASONS)[number];

const RANK: Record<Severity, number> = { error: 0, warn: 1, info: 2 };

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** A fixed order (design §5.2): severity, entity in id order, code, field, refs, message. */
export function sortDiagnostics(ds: readonly Diagnostic[]): Diagnostic[] {
  return [...ds].sort(
    (a, b) =>
      RANK[a.severity] - RANK[b.severity] ||
      compareIds(a.entity ?? "", b.entity ?? "") ||
      cmp(a.code, b.code) ||
      cmp(a.field ?? "", b.field ?? "") ||
      cmp((a.refs ?? []).join(","), (b.refs ?? []).join(",")) ||
      cmp(a.message, b.message),
  );
}

/** Collects diagnostics, dropping exact repeats (one cause reached along two paths). */
export class Diagnostics {
  private readonly seen = new Set<string>();
  readonly list: Diagnostic[] = [];

  add(d: Diagnostic): void {
    const key = JSON.stringify([d.severity, d.code, d.entity, d.field, d.refs, d.message]);
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.list.push(d);
  }

  error(
    code: DiagnosticCode,
    entity: string | undefined,
    message: string,
    extra: Partial<Diagnostic> = {},
  ) {
    this.add({ severity: "error", code, ...(entity ? { entity } : {}), ...extra, message });
  }

  warn(
    code: DiagnosticCode,
    entity: string | undefined,
    message: string,
    extra: Partial<Diagnostic> = {},
  ) {
    this.add({ severity: "warn", code, ...(entity ? { entity } : {}), ...extra, message });
  }

  info(
    code: DiagnosticCode,
    entity: string | undefined,
    message: string,
    extra: Partial<Diagnostic> = {},
  ) {
    this.add({ severity: "info", code, ...(entity ? { entity } : {}), ...extra, message });
  }

  sorted(): Diagnostic[] {
    return sortDiagnostics(this.list);
  }
}
