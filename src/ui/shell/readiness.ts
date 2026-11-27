import { plural } from "../format.ts";
import { model, problems } from "../store.ts";

/**
 * The order's readiness (D-UX-3), as `alukit problems` judges it for the drawn revision: nothing
 * to order, ready, ready with warnings, or blocked by n things to resolve; "pricing" until the
 * first answer. While the answer for a newer revision is on its way, the last one shows, marked
 * stale. The top bar's pill and the project panel's summary read it. Owner: S2.
 *
 * Ready with warnings (docs/ux/review-phase4.md B1): the order can be sent, but one of its rules
 * warns, as `no-connector` does for butts that buy nothing to join them. It is never shown as a
 * plain ready: its glyph and look are the warning's, and `warnings` says which.
 */
export interface Readiness {
  status: "PRICING" | "EMPTY" | "READY" | "BLOCKED";
  text: string;
  glyph?: "ready" | "warn" | "blocked";
  stale: boolean;
  /** The titles of what the order warns about while it can be sent, or holds while blocked. */
  warnings: string[];
}

export function readiness(): Readiness | undefined {
  const m = model.value;
  if (!m) return undefined;
  const p = problems.value;
  if (!p) return { status: "PRICING", text: "Pricing…", stale: false, warnings: [] };
  const stale = p.rev !== m.rev || p.variant !== m.variant;
  // The order's own warnings: its rules that warn, one problem each over its suppliers.
  const warnings = p.problems
    .filter((x) => x.from.includes("order") && x.group !== "blocks-order")
    .map((x) => x.title);
  switch (p.order.status) {
    case "EMPTY":
      return { status: "EMPTY", text: "Nothing to order", stale, warnings: [] };
    case "READY":
      return warnings.length === 0
        ? { status: "READY", text: "Ready to order", glyph: "ready", stale, warnings }
        : {
            status: "READY",
            text: `Ready, ${plural(warnings.length, "warning")}`,
            glyph: "warn",
            stale,
            warnings,
          };
    case "BLOCKED":
      return {
        status: "BLOCKED",
        text: `Blocked · ${plural(p.order.blocks, "thing")} to resolve`,
        glyph: "blocked",
        stale,
        warnings,
      };
  }
}
