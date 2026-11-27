/**
 * The sheets S4 owns, each of which registers itself when imported (see
 * src/ui/sheets/registry.ts): the app imports this module once. Cut list, BOM, Machining, Order &
 * costs, Problems and Records, in the rail's order. Owner: S4.
 */
import "./CutList.tsx";
import "./Bom.tsx";
import "./Machining.tsx";
import "./OrderCosts.tsx";
import "../problems/ProblemsSheet.tsx";
import "../records/Records.tsx";
