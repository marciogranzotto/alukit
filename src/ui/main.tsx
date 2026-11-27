import { render } from "preact";
import { App, Snapshot } from "./App.tsx";
import { start } from "./store.ts";
import { applyTheme } from "./theme/theme.ts";
// The stylesheets, in cascade order: the tokens, then what every region shares, then each
// region's own (docs/ux/contracts.md). A later file wins a tie, so the order is part of the look.
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/shell.css";
import "./styles/viewport.css";
import "./styles/tools.css";
import "./styles/inspector.css";
import "./styles/tables.css";

applyTheme();
const root = document.getElementById("app");
if (!root) throw new Error("#app is missing from index.html");
// `?snapshot=<view>`: the viewport alone at a named view, which `alukit snapshot` captures (§7.3).
const view = new URLSearchParams(location.search).get("snapshot");
render(view ? <Snapshot view={view} /> : <App />, root);
void start();
