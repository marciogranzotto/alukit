import { useEffect, useRef } from "preact/hooks";
import { createViewer, type Viewer, type ViewerStats } from "../viewer/scene.ts";
import { Drawer } from "./Drawer.tsx";
import { meshInput } from "./model.ts";
import { Properties } from "./Properties.tsx";
import { model, redo, select, selection, summary, undo } from "./store.ts";
import { NoAccess, ReadOnlyBanner, TopBar } from "./TopBar.tsx";
import { Tree } from "./Tree.tsx";

/**
 * What tests and agents may read from a tab: the scene's counts and the revisions it shows. It
 * holds no secret and changes nothing.
 */
export interface AlukitHook {
  stats(): ViewerStats | undefined;
  /** The revision the server announced, and the one the scene draws. */
  rev(): number | undefined;
  drawnRev(): number | undefined;
  readOnly(): boolean;
}

declare global {
  interface Window {
    __alukit?: AlukitHook;
  }
}

function Viewport() {
  const host = useRef<HTMLDivElement>(null);
  const viewer = useRef<Viewer | undefined>(undefined);
  const drawn = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!host.current) return;
    const v = createViewer(host.current);
    viewer.current = v;
    v.onSelect((ids, mode) => select(ids, mode));
    window.__alukit = {
      stats: () => viewer.current?.stats(),
      rev: () => summary.value?.rev,
      drawnRev: () => drawn.current,
      readOnly: () => summary.value?.status.readOnly === true,
    };
    // The scene follows the signals without re-rendering the component.
    const offModel = model.subscribe((m) => {
      if (!m) return;
      v.setModel(meshInput(m));
      drawn.current = m.rev;
      host.current?.setAttribute("data-drawn-rev", String(m.rev));
    });
    const offSel = selection.subscribe((s) => v.setSelection(s));
    return () => {
      offModel();
      offSel();
      v.dispose();
      viewer.current = undefined;
    };
  }, []);

  return (
    <div class="viewport" ref={host} data-testid="viewport">
      <div class="viewport-help">
        drag: orbit · right-drag: pan · wheel: zoom · Shift-drag: box select
      </div>
    </div>
  );
}

export function App() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (summary.value?.status.readOnly) return;
        if (e.shiftKey) void redo();
        else void undo();
      } else if (e.key === "Escape") select([], "replace");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div class="app">
      <TopBar />
      <NoAccess />
      <ReadOnlyBanner />
      <div class="main">
        <aside class="left">
          <Tree />
        </aside>
        <Viewport />
        <aside class="right">
          <Properties />
        </aside>
      </div>
      <Drawer />
    </div>
  );
}
