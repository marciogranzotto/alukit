import { plural } from "../format.ts";
import { model, problems } from "../store.ts";

/**
 * The order's readiness (D-UX-3), as `alukit problems` judges it for the drawn revision: nothing
 * to order, ready, or blocked by n things to resolve; "pricing" until the first answer. While the
 * answer for a newer revision is on its way, the last one shows, marked stale. The top bar's
 * pill and the project panel's summary read it. Owner: S2.
 */
export interface Readiness {
  status: "PRICING" | "EMPTY" | "READY" | "BLOCKED";
  text: string;
  glyph?: "ready" | "blocked";
  stale: boolean;
}

export function readiness(): Readiness | undefined {
  const m = model.value;
  if (!m) return undefined;
  const p = problems.value;
  if (!p) return { status: "PRICING", text: "Pricing…", stale: false };
  const stale = p.rev !== m.rev || p.variant !== m.variant;
  switch (p.order.status) {
    case "EMPTY":
      return { status: "EMPTY", text: "Nothing to order", stale };
    case "READY":
      return { status: "READY", text: "Ready to order", glyph: "ready", stale };
    case "BLOCKED":
      return {
        status: "BLOCKED",
        text: `Blocked · ${plural(p.order.blocks, "thing")} to resolve`,
        glyph: "blocked",
        stale,
      };
  }
}
