import type { z } from "zod";
import { compareIds } from "#core/ids.ts";

/**
 * A problem found while loading or checking catalogs, tied to the entity and the files it
 * concerns (design §5.1's `{ severity, code, entity, message }`, plus the files).
 */
export type Severity = "error" | "warn" | "info";

export interface Diagnostic {
  severity: Severity;
  code: string;
  /** A full id: `test:TS40`, `test:sections/TS40-P`, `test:offers/TS40-c7`. */
  entity?: string;
  /** A field path within the entity, keys joined by "/". */
  field?: string;
  /** The files involved, every one of them for a collision. */
  files: string[];
  message: string;
}

const RANK: Record<Severity, number> = { error: 0, warn: 1, info: 2 };

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** A fixed order (design §5.2): severity, code, entity in id order, field, files, message. */
export function sortDiagnostics(ds: readonly Diagnostic[]): Diagnostic[] {
  return [...ds].sort(
    (a, b) =>
      RANK[a.severity] - RANK[b.severity] ||
      cmp(a.code, b.code) ||
      compareIds(a.entity ?? "", b.entity ?? "") ||
      cmp(a.field ?? "", b.field ?? "") ||
      cmp(a.files.join("\n"), b.files.join("\n")) ||
      cmp(a.message, b.message),
  );
}

/** A path as a field string: keys joined by "/", array indices in brackets. */
export function pathString(path: readonly PropertyKey[]): string {
  let out = "";
  for (const p of path) {
    if (typeof p === "number") out += `[${p}]`;
    else out += out === "" ? String(p) : `/${String(p)}`;
  }
  return out;
}

/** One line per Zod issue, with its path. */
export function issueLines(
  error: z.ZodError,
  prefix: readonly PropertyKey[] = [],
): { path: PropertyKey[]; message: string }[] {
  return error.issues.map((issue) => {
    const path = [...prefix, ...issue.path];
    let message = issue.message;
    if (issue.code === "unrecognized_keys")
      message = `unknown field${issue.keys.length > 1 ? "s" : ""} ${issue.keys.map((k) => `"${k}"`).join(", ")}`;
    return { path, message };
  });
}
