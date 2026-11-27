import { createElement } from "preact";
import { lazy } from "../lazy.tsx";
import { registerSheet } from "../sheets/registry.ts";
import { LinesBadge, OrderBadge, PiecesBadge, ProblemsBadge } from "./badges.tsx";
import { CutListSheet } from "./CutList.tsx";

/**
 * The sheets S4 owns, registered with the container (src/ui/sheets/registry.ts): the app imports
 * this module once. Cut list, BOM, Machining, Order & costs, Problems and Records, in the rail's
 * order, each with its badge (badges.tsx). The cut list, the sheet shown first, comes with the
 * page; every other sheet's body is a chunk of its own, fetched the first time its tab is shown
 * (src/ui/lazy.tsx, docs/ux/integration-decisions.md). Owner: S4.
 */

registerSheet({
  id: "cutlist",
  title: "Cut list",
  order: 10,
  badge: () => createElement(PiecesBadge, null),
  Body: CutListSheet,
});
registerSheet({
  id: "bom",
  title: "BOM",
  order: 20,
  badge: () => createElement(LinesBadge, null),
  Body: lazy(() => import("./Bom.tsx").then((m) => m.BomSheet)),
});
registerSheet({
  id: "machining",
  title: "Machining",
  order: 30,
  Body: lazy(() => import("./Machining.tsx").then((m) => m.MachiningSheet)),
});
registerSheet({
  id: "order",
  title: "Order & costs",
  order: 40,
  badge: () => createElement(OrderBadge, null),
  Body: lazy(() => import("./OrderCosts.tsx").then((m) => m.OrderCostsSheet)),
});
registerSheet({
  id: "problems",
  title: "Problems",
  order: 50,
  badge: () => createElement(ProblemsBadge, null),
  Body: lazy(() => import("../problems/ProblemsSheet.tsx").then((m) => m.ProblemsSheet)),
});
registerSheet({
  id: "records",
  title: "Records",
  order: 60,
  Body: lazy(() => import("../records/Records.tsx").then((m) => m.RecordsSheet)),
});
