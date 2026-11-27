import { signal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { CatalogOverlay } from "./catalog/CatalogOverlay.tsx";
import { PartsBin } from "./catalog/PartsBin.tsx";
import { keepPalette, startPalette } from "./catalog/state.ts";
import { showKey } from "./focus.ts";
import { listenKeys, onKey } from "./keys.ts";
import { Outline } from "./outline/Outline.tsx";
import { Properties } from "./Properties.tsx";
import { Sheets } from "./sheets/Sheets.tsx";
import { Help } from "./shell/Help.tsx";
import { isNumber, readPref, writePref } from "./shell/prefs.ts";
import { Splitter } from "./shell/Splitter.tsx";
import { StatusBar } from "./shell/StatusBar.tsx";
import { model, redo, summary, undo } from "./store.ts";
import { ToolButtons, ToolOverlay, ToolPanel } from "./ToolPanel.tsx";
import { NoAccess, ReadOnlyBanner, TopBar } from "./TopBar.tsx";
import { activeTool, connectTools } from "./tools.ts";
import { Viewport } from "./viewport/Viewport.tsx";
// The sheets, which register themselves with the container (sheets/registry.ts).
import "./tables/index.ts";
import "./records/Params.tsx";

/**
 * The app's layout (docs/ux/plan.md §1, D-UX-1, D-UX-2, S2.1): the top bar and its banners; then
 * the left column (the parts bin above the model outline), the canvas (the viewport with the
 * tools in its slots, and the status bar under it) and the right column (the active tool's form
 * above the inspector), with a splitter between each, their widths kept per browser; the
 * catalog, wide, over the left column and the canvas when opened; and the sheets below. It
 * installs the keys (keys.ts) and wires the tools to the viewport's viewer while it is shown.
 * Owner: S2.
 *
 * Landmarks: the top bar is the banner, the canvas is the main region (the skip link's target,
 * so Tab reaches the tools in two stops), the columns are complementary, the sheets a region.
 */

/** Ctrl or Cmd with Z: undo; with Shift too: redo (none while read-only). */
function undoKey(e: KeyboardEvent): boolean {
  if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return false;
  if (summary.value?.status.readOnly) return true;
  if (e.shiftKey) void redo();
  else void undo();
  return true;
}

/** The columns' widths, kept per browser; each has its limits, and the canvas keeps the rest. */
const COLUMN = {
  left: { key: "alukit.layout.left", initial: 272, min: 200, max: 440 },
  right: { key: "alukit.layout.right", initial: 320, min: 260, max: 560 },
} as const;
const leftWidth = signal(readPref(COLUMN.left.key, COLUMN.left.initial, isNumber));
const rightWidth = signal(readPref(COLUMN.right.key, COLUMN.right.initial, isNumber));

/** The keys, the tools on the viewport's viewer, and the palette, while the app is shown. */
function useWiring(): void {
  useEffect(() => {
    let started = false;
    const offs = [
      listenKeys(),
      onKey("app", undoKey),
      onKey("app", showKey, 10),
      connectTools(),
      keepPalette(),
      model.subscribe((m) => {
        if (!m || started) return;
        started = true;
        void startPalette(m.defaults);
      }),
    ];
    return () => {
      for (const off of offs) off();
    };
  }, []);
}

function ColumnSplitter({ side }: { side: "left" | "right" }) {
  const c = COLUMN[side];
  const w = side === "left" ? leftWidth : rightWidth;
  return (
    <Splitter
      label={
        side === "left" ? "Resize the parts and outline column" : "Resize the inspector column"
      }
      testid={`splitter-${side}`}
      value={w.value}
      min={c.min}
      max={c.max}
      grows={side === "left" ? "right" : "left"}
      onChange={(size, done) => {
        w.value = size;
        if (done) writePref(c.key, size);
      }}
    />
  );
}

export function App() {
  useWiring();
  return (
    <div class="app">
      <button
        type="button"
        class="skip-link"
        data-testid="skip-link"
        onClick={() => document.getElementById("canvas")?.focus()}
      >
        Skip to the 3D view and its tools
      </button>
      <TopBar />
      <NoAccess />
      <ReadOnlyBanner />
      <div class="work">
        <div
          class="main"
          style={{ "--left-w": `${leftWidth.value}px`, "--right-w": `${rightWidth.value}px` }}
        >
          <aside class="left" aria-label="Parts and model">
            <PartsBin />
            <Outline />
          </aside>
          <ColumnSplitter side="left" />
          <main id="canvas" class="canvas" tabIndex={-1} aria-label="3D view and tools">
            <Viewport
              tool={activeTool.value}
              slots={{ left: <ToolButtons />, bottom: <ToolOverlay /> }}
            />
            <StatusBar />
          </main>
          <ColumnSplitter side="right" />
          <aside class="right" aria-label="Inspector">
            <ToolPanel />
            <Properties />
          </aside>
          <CatalogOverlay />
        </div>
        <Sheets />
      </div>
      <Help />
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
