import type { Model } from "../model.ts";
import { Sheet } from "../tables/common.tsx";
import { DecisionsSection } from "./Decisions.tsx";
import { HistorySection } from "./History.tsx";

/**
 * The Records sheet (docs/ux/plan.md D-UX-2, S4.9): the project's memory, apart from what blocks
 * it. Decisions with their add form, then the history of steps with who made each. Open items
 * sit in Problems, where they block the order; Params sit in the project panel (S2). Owner: S4.
 */
export function RecordsSheet({ m }: { m: Model }) {
  return (
    <Sheet testid="records">
      <DecisionsSection m={m} />
      <HistorySection />
    </Sheet>
  );
}
