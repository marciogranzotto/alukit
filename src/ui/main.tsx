import { render } from "preact";
import { App } from "./App.tsx";
import { start } from "./store.ts";
import "./style.css";

const root = document.getElementById("app");
if (!root) throw new Error("#app is missing from index.html");
render(<App />, root);
void start();
