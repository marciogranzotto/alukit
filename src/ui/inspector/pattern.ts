import { parseTyped, typedNumber } from "../tools/typed.ts";
import type { Edit } from "./rows.tsx";

/**
 * Editing a live pattern (docs/ux/editing-audit.md E5.3, E-UX-13): each field typed in the
 * inspector is one `setPattern`, a merge patch of that field. Lengths are typed as every length
 * is (D-UX-17, the audit's D5): units and expressions over the project's params, written as the
 * number they come to when they read no param, and as typed when they do, so the param keeps
 * driving them. Pure. Owner: E5.
 */

export type PatternField = "along" | "pitch_mm" | "count" | "offsets_mm" | "skip";

const WHOLE = /^\d+$/;

/** One `setPattern` of one field. */
function setPattern(id: string, field: PatternField, value: unknown): Edit {
  return { commands: [{ cmd: "setPattern", args: { id, set: { [field]: value } } }] };
}

/** A pattern's field, typed or chosen, as one `setPattern`, or why the text makes none. */
export function patternEdit(
  id: string,
  field: PatternField,
  text: string,
  params: Readonly<Record<string, number>>,
): Edit {
  const t = text.trim();
  switch (field) {
    case "along":
      return t === "" ? { why: "pick the bar or run to repeat along" } : setPattern(id, field, t);
    case "pitch_mm": {
      const n = typedNumber(t, params);
      if ("why" in n) return { why: `the pitch: ${n.why}` };
      if (n.value === 0) return { why: "the pitch is a length in mm, not 0" };
      return setPattern(id, field, n.written);
    }
    case "count": {
      const n = Number(t);
      if (!WHOLE.test(t) || n < 1) return { why: "the count is a whole number, 1 or more" };
      return setPattern(id, field, n);
    }
    case "offsets_mm": {
      const typed = parseTyped(t, params);
      if (typed.kind === "empty") return { why: "give the offsets, comma-separated, in mm" };
      if (typed.kind === "error") return { why: `the offsets: ${typed.why}` };
      if (typed.kind === "point") return { why: "the offsets are a list, not a point" };
      const items = typed.kind === "value" ? [typed] : typed.items;
      return setPattern(
        id,
        field,
        items.map((x) => x.written),
      );
    }
    case "skip": {
      if (t === "") return setPattern(id, field, null);
      const parts = t.split(",").map((s) => s.trim());
      if (parts.some((s) => !WHOLE.test(s) || Number(s) < 1)) {
        return { why: "the copies left out are whole numbers, 1 or more: 3, 5" };
      }
      const ks = [...new Set(parts.map(Number))].sort((a, b) => a - b);
      return setPattern(id, field, ks);
    }
  }
}

/** Explode: the copies become entities of their own, as one step. */
export function explodeEdit(id: string): Edit {
  return { commands: [{ cmd: "explodePattern", args: { id } }] };
}
