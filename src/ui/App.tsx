import { signal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { Catalog } from "./Catalog.tsx";
import { Drawer } from "./Drawer.tsx";
import { listenKeys, onKey } from "./keys.ts";
import { Properties } from "./Properties.tsx";
import { redo, summary, undo } from "./store.ts";
import { ToolButtons, ToolOverlay, ToolPanel } from "./ToolPanel.tsx";
import { NoAccess, ReadOnlyBanner, TopBar } from "./TopBar.tsx";
import { Tree } from "./Tree.tsx";
import { activeTool, connectTools } from "./tools.ts";
import { Viewport } from "./viewport/Viewport.tsx";

/**
 * The app's layout (design §8): the top bar and its banners, the left column (the project tree or
 * the catalog), the viewport with the tools in its slots, the tool panel above the properties on
 * the right, and the drawer below. It installs the keys (keys.ts) and wires the tools to the
 * viewport's viewer while it is shown. Owner: S2.
 */

/** Ctrl or Cmd with Z: undo; with Shift too: redo (none while read-only). */
function undoKey(e: KeyboardEvent): boolean {
  if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return false;
  if (summary.value?.status.readOnly) return true;
  if (e.shiftKey) void redo();
  else void undo();
  return true;
}

/** The keys, and the tools on the viewport's viewer, while the app is shown. */
function useWiring(): void {
  useEffect(() => {
    const offs = [listenKeys(), onKey("app", undoKey), connectTools()];
    return () => {
      for (const off of offs) off();
    };
  }, []);
}

const leftTab = signal<"project" | "catalog">("project");

function Left() {
  return (
    <aside class="left">
      <div class="left-tabs">
        {(["project", "catalog"] as const).map((t) => (
          <button
            type="button"
            key={t}
            data-testid={`left-${t}`}
            class={leftTab.value === t ? "ltab on" : "ltab"}
            onClick={() => {
              leftTab.value = t;
            }}
          >
            {t === "project" ? "Project" : "Catalog"}
          </button>
        ))}
      </div>
      {leftTab.value === "project" ? <Tree /> : <Catalog />}
    </aside>
  );
}

export function App() {
  useWiring();
  return (
    <div class="app">
      <TopBar />
      <NoAccess />
      <ReadOnlyBanner />
      <div class="main">
        <Left />
        <Viewport
          tool={activeTool.value}
          slots={{ left: <ToolButtons />, bottom: <ToolOverlay /> }}
        />
        <aside class="right">
          <ToolPanel />
          <Properties />
        </aside>
      </div>
      <Drawer />
    </div>
  );
}

/** `?snapshot=<view>` (§7.3): the viewport alone, at a named view, for `alukit snapshot`. */
export function Snapshot({ view }: { view: string }) {
  return (
    <div class="app snapshot">
      <Viewport snapshot={view} />
    </div>
  );
}
