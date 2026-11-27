/**
 * The tables and records S4 owns, each of which registers its sheet when imported (see
 * src/ui/sheets/registry.ts): the app imports this module once. Owner: S4.
 */
import "./CutList.tsx";
import "./Machining.tsx";
import "./Bom.tsx";
import "./Order.tsx";
import "./Costs.tsx";
import "./Checks.tsx";
import "./History.tsx";
import "../records/OpenItems.tsx";
import "../records/Decisions.tsx";
