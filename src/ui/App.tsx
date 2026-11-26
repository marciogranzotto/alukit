import { signal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import type { V3 } from "../mesh/model.ts";
import { createViewer, type Viewer, type ViewerStats } from "../viewer/scene.ts";
import { docViews } from "../viewer/views.ts";
import { Catalog } from "./Catalog.tsx";
import { Drawer } from "./Drawer.tsx";
import { meshInput } from "./model.ts";
import { Properties } from "./Properties.tsx";
import { model, redo, select, selection, summary, undo } from "./store.ts";
import { Hint, projection, Toolbar, ToolPanel, viewer } from "./ToolPanel.tsx";
import { NoAccess, ReadOnlyBanner, TopBar } from "./TopBar.tsx";
import { Tree } from "./Tree.tsx";
import {
  activeTool,
  createTools,
  drawOptions,
  drawState,
  hint,
  TOOL_KEYS,
  type Tools,
} from "./tools.ts";

/**
 * What tests and agents may read from a tab: the scene's counts, the revisions it shows, where a
 * world point is on the page, and what the active tool is doing. It holds no secret and changes
 * nothing.
 */
export interface AlukitHook {
  stats(): ViewerStats | undefined;
  /** The revision the server announced, and the one the scene draws. */
  rev(): number | undefined;
  drawnRev(): number | undefined;
  readOnly(): boolean;
  /** A world point (Z up, mm) on the page, in CSS pixels: where a script points the mouse. */
  screen(p: V3): [number, number] | undefined;
  /** The active tool, its draw options, the gesture's points and the hint by the pointer. */
  tool(): {
    name: string;
    anchor: string;
    roll: number;
    start?: string;
    end?: string;
    hint?: string;
  };
  /** Snapshot mode: "ready" once the named view is drawn, or why it cannot be. */
  snapshot(): string | undefined;
}

declare global {
  interface Window {
    __alukit?: AlukitHook;
  }
}

/** Snapshot mode's state (`?snapshot=<view>`, §7.3). */
const snapshotState = signal<string | undefined>(undefined);

/** The tools of this tab's viewport, which the key handler passes keys to. */
let tabTools: Tools | undefined;

function Viewport({ snapshot }: { snapshot?: string | undefined }) {
  const host = useRef<HTMLDivElement>(null);
  const v0 = useRef<Viewer | undefined>(undefined);
  const drawn = useRef<number | undefined>(undefined);
  const tools = useRef<Tools | undefined>(undefined);

  useEffect(() => {
    if (!host.current) return;
    const v = createViewer(host.current);
    v0.current = v;
    viewer.value = v;
    if (!snapshot) {
      tools.current = createTools(v);
      tabTools = tools.current;
      v.onSelect((ids, mode) => select(ids, mode));
    }
    window.__alukit = {
      stats: () => v0.current?.stats(),
      rev: () => summary.value?.rev,
      drawnRev: () => drawn.current,
      readOnly: () => summary.value?.status.readOnly === true,
      screen: (p) => v0.current?.project(p) as [number, number] | undefined,
      tool: () => {
        const { start, end } = drawState.value;
        return {
          name: activeTool.value,
          anchor: drawOptions.value.anchor,
          roll: drawOptions.value.roll,
          ...(start ? { start: start.label } : {}),
          ...(end ? { end: end.label } : {}),
          ...(hint.value ? { hint: hint.value.text } : {}),
        };
      },
      snapshot: () => snapshotState.value,
    };
    // The scene follows the signals without re-rendering the component.
    const offModel = model.subscribe((m) => {
      if (!m) return;
      v.setModel(meshInput(m));
      drawn.current = m.rev;
      host.current?.setAttribute("data-drawn-rev", String(m.rev));
      if (snapshot && snapshotState.value === undefined) {
        // §7.3: a named view, no animation, then the frame is final.
        if (!v.setView(snapshot, docViews(m.doc), false)) {
          snapshotState.value = `no view named "${snapshot}"`;
          return;
        }
        v.renderNow();
        requestAnimationFrame(() => {
          v.renderNow();
          snapshotState.value = "ready";
          document.body.dataset.snapshot = "ready";
        });
      }
    });
    const offSel = selection.subscribe((s) => v.setSelection(s));
    return () => {
      offModel();
      offSel();
      tools.current?.dispose();
      if (tabTools === tools.current) tabTools = undefined;
      v.dispose();
      v0.current = undefined;
      viewer.value = undefined;
    };
  }, []);

  if (snapshot) return <div class="viewport snapshot" ref={host} data-testid="viewport" />;
  return (
    <div class="viewport" ref={host} data-testid="viewport" data-tool={activeTool.value}>
      <Toolbar />
      <Hint />
      <div class="viewport-help">
        {activeTool.value === "select"
          ? "drag: orbit · right-drag: pan · wheel: zoom · Shift-drag: box select"
          : "click: pick · drag: orbit · Esc: back to select"}
      </div>
    </div>
  );
}

/** Keys: undo and redo, tool shortcuts, the active tool's keys, views (§8). */
function useKeys(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT"))
        return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (summary.value?.status.readOnly) return;
        if (e.shiftKey) void redo();
        else void undo();
        return;
      }
      if (mod || e.altKey) return;
      if (tabTools?.key(e)) {
        e.preventDefault();
        return;
      }
      const k = e.key.toLowerCase();
      if (e.key === "Escape") {
        if (activeTool.value !== "select") activeTool.value = "select";
        else select([], "replace");
        return;
      }
      if (TOOL_KEYS[k] && summary.value?.status.readOnly !== true) {
        activeTool.value = TOOL_KEYS[k] as typeof activeTool.value;
        return;
      }
      const v = viewer.value;
      if (k === "f") v?.fitSelection(selection.value);
      else if (k === "o" && v) {
        const next = projection.value === "perspective" ? "orthographic" : "perspective";
        v.setProjection(next);
        projection.value = next;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
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
  useKeys();
  return (
    <div class="app">
      <TopBar />
      <NoAccess />
      <ReadOnlyBanner />
      <div class="main">
        <Left />
        <Viewport />
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
