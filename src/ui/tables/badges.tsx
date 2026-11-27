import type { Order, SupplierOrder } from "#core/order/types.ts";
import { StatusGlyph } from "../common/StatusGlyph.tsx";
import { plural } from "../format.ts";
import { problemCounts } from "../problems/source.ts";
import { model } from "../store.ts";
import { useOutput, withAsOf } from "./common.tsx";

/**
 * The sheets' badges (S4.12): what each tab shows beside its name, read closed. They sit apart
 * from the sheets' bodies, which load when their tab is first shown (tables/index.ts), because
 * the rail shows every badge from the start. Owner: S4.
 */

/** The cut list's badge: how many pieces there are to cut. */
export function PiecesBadge() {
  const groups = model.value?.cutlist.groups ?? [];
  const n = groups.reduce((sum, g) => sum + g.pieces, 0);
  return n > 0 ? <span class="badge plain">{plural(n, "piece")}</span> : null;
}

/** The BOM's badge: how many lines the bill has. */
export function LinesBadge() {
  const n = model.value?.bom.groups.reduce((sum, g) => sum + g.lines.length, 0) ?? 0;
  return n > 0 ? <span class="badge plain">{plural(n, "line")}</span> : null;
}

/** A supplier's reasons that block the order. */
export const blocks = (s: SupplierOrder) => s.reasons.filter((r) => r.action === "block");

/** The distinct things that block the order: one open item holding three suppliers is one. */
export function thingsToResolve(o: Order): number {
  return new Set(o.suppliers.flatMap((s) => blocks(s).map((r) => `${r.rule}|${r.message}`))).size;
}

/**
 * Order & costs' badge: how many things hold the order. It asks for the order itself, as the
 * sheet does (the server prices a revision once), so it does not wait for the problems answer.
 */
export function OrderBadge() {
  const m = model.value;
  const got = useOutput<Order>(withAsOf("/api/order"), m?.rev ?? 0);
  if (!m || got === undefined || "error" in got) return null;
  const things = thingsToResolve(got.value);
  if (things === 0) {
    if (got.value.suppliers.length === 0) return null;
    // The order's own warnings, each once (`order.warnings`; review M3, B1).
    const warns = new Set(
      got.value.suppliers.flatMap((s) =>
        s.reasons.filter((r) => r.action === "warn").map((r) => `${r.rule}|${r.message}`),
      ),
    ).size;
    return warns === 0 ? (
      <span class="badge ok" title="Every supplier can be ordered from">
        <StatusGlyph status="ready" size={12} />
        <span class="sr-only">Ready to order</span>
      </span>
    ) : (
      <span
        class="badge"
        title={`Ready to order, with ${plural(warns, "warning")} to check before it is sent`}
      >
        <span class="badge-n warn">
          <StatusGlyph status="warn" size={12} />
          {warns}
          <span class="sr-only"> {warns === 1 ? "warning" : "warnings"}: ready to order</span>
        </span>
      </span>
    );
  }
  return (
    <span
      class="badge"
      title={`${plural(things, "thing")} to resolve before the order can be sent`}
    >
      <span class="badge-n blocked">
        <StatusGlyph status="blocked" size={12} />
        {things}
        <span class="sr-only"> to resolve</span>
      </span>
    </span>
  );
}

/**
 * The Problems badge: what blocks the order and the errors, then the warnings, each as a glyph and
 * a number, counted as the sheet lists them (docs/ux/review-phase4.md M3).
 */
export function ProblemsBadge() {
  const { blocks, errors, warnings } = problemCounts.value;
  if (blocks === 0 && errors === 0 && warnings === 0) {
    return (
      <span class="badge ok" title="Nothing blocks the order, and no errors or warnings">
        <StatusGlyph status="ready" size={12} /> <span class="sr-only">No errors or warnings</span>
      </span>
    );
  }
  // What blocks the order and the errors share the red mark, as both must be fixed.
  const severe = [
    blocks > 0 ? `${blocks} ${blocks === 1 ? "blocks" : "block"} the order` : "",
    errors > 0 ? plural(errors, "error") : "",
  ].filter((x) => x !== "");
  const title = [...severe, ...(warnings > 0 ? [plural(warnings, "warning")] : [])].join(", ");
  return (
    <span class="badge" title={title}>
      {blocks + errors > 0 && (
        <span class="badge-n blocked">
          <StatusGlyph status="blocked" size={12} />
          {blocks + errors}
          <span class="sr-only"> ({severe.join(", ")})</span>
        </span>
      )}
      {warnings > 0 && (
        <span class="badge-n warn">
          <StatusGlyph status="warn" size={12} />
          {warnings}
          <span class="sr-only">{warnings === 1 ? " warning" : " warnings"}</span>
        </span>
      )}
    </span>
  );
}
