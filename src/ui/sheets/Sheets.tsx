import { effect } from "@preact/signals";
import type { TargetedKeyboardEvent } from "preact";
import { useEffect } from "preact/hooks";
import { shown } from "../focus.ts";
import { chord, describeKeys, onKey } from "../keys.ts";
import type { Model } from "../model.ts";
import { Splitter } from "../shell/Splitter.tsx";
import { model } from "../store.ts";
import { activeTool } from "../tools/state.ts";
import {
  activeSheet,
  firstOutputPending,
  openSheet,
  SHEETS_HEIGHT,
  setSheets,
  sheets,
  sheetsHeight,
  sheetsMax,
  sheetsOpen,
} from "./registry.ts";

/**
 * The sheets' container (D-UX-2, S2.2): a rail of tabs, one per registered sheet (registry.ts),
 * each with its badge so it reads closed; the active sheet's body; and the controls to collapse,
 * split and maximize. It knows no sheet by name. Owner: S2.
 *
 * - The rail is a tablist (arrow keys, Home and End move between tabs and open them); the body is
 *   its tabpanel.
 * - Collapse is a button (and `T`), not a click on the active tab (A R16).
 * - The split is resized by the splitter on its top edge, kept per browser.
 * - Maximized (`Shift+T`), the sheets cover the main area; the canvas keeps its size under them,
 *   so nothing in the scene moves. Show (focus.ts) brings back the split, to show the 3D view.
 * - An empty project's sheets start collapsed and open by themselves, once, on the cut list when
 *   the first output exists and no tool is active: never in the middle of drawing, where a
 *   canvas that shrinks would move the scene under the pointer (plan §8).
 */

/** Whether a model holds anything to cut, buy or place. */
export function hasOutput(m: Model): boolean {
  return m.cutlist.groups.length > 0 || m.bom.groups.length > 0;
}

/** Whether a model is an empty project: no bars and no parts (B §4.3). */
export function isEmptyProject(m: Model): boolean {
  return Object.keys(m.derived.bars).length === 0 && Object.keys(m.derived.parts).length === 0;
}

/** T: collapse or open; Shift+T: maximize or restore. */
function sheetsKey(e: KeyboardEvent): boolean {
  if (chord(e) || e.key.toLowerCase() !== "t") return false;
  if (e.shiftKey) {
    if (sheetsMax.value) setSheets({ max: false });
    else setSheets({ open: true, max: true });
  } else setSheets({ open: !sheetsOpen.value });
  return true;
}

/** The tablist's keys: the arrows, Home and End move to a tab and open it. */
function railKey(e: TargetedKeyboardEvent<HTMLDivElement>): void {
  const list = sheets.value;
  const i = list.findIndex((s) => s.id === activeSheet.value);
  const to =
    e.key === "ArrowRight"
      ? (i + 1) % list.length
      : e.key === "ArrowLeft"
        ? (i - 1 + list.length) % list.length
        : e.key === "Home"
          ? 0
          : e.key === "End"
            ? list.length - 1
            : -1;
  const next = list[to];
  if (!next) return;
  e.preventDefault();
  e.stopPropagation();
  openSheet(next.id);
  e.currentTarget.querySelector<HTMLElement>(`#sheet-tab-${next.id}`)?.focus();
}

/** The app's own openings: collapsed on an empty project, open once on its first output. */
function useFirstOutput(): void {
  useEffect(() => {
    let seen = false;
    return effect(() => {
      const m = model.value;
      const tool = activeTool.value;
      if (!m) return;
      if (!seen) {
        seen = true;
        if (isEmptyProject(m)) {
          setSheets({ open: false }, false);
          firstOutputPending.value = true;
        }
        return;
      }
      if (firstOutputPending.peek() && tool === "select" && hasOutput(m)) {
        firstOutputPending.value = false;
        activeSheet.value = "cutlist";
        setSheets({ open: true }, false);
      }
    });
  }, []);
}

export function Sheets() {
  useFirstOutput();
  useEffect(() => {
    const offs = [
      onKey("app", sheetsKey),
      describeKeys({
        id: "sheets",
        title: "Sheets",
        order: 40,
        rows: [
          { keys: ["T"], does: "Collapse or open the sheets" },
          { keys: ["Shift", "T"], does: "Maximize the sheets, or restore them" },
        ],
      }),
      // Show points at the 3D view: a maximized sheet steps back to the split.
      shown.subscribe((s) => {
        if (s && sheetsMax.peek()) setSheets({ max: false }, false);
      }),
    ];
    return () => {
      for (const off of offs) off();
    };
  }, []);

  const m = model.value;
  const open = sheetsOpen.value;
  const max = open && sheetsMax.value;
  const active = activeSheet.value;
  const list = sheets.value;
  const current = list.find((s) => s.id === active);
  const h = sheetsHeight.value;
  const limit = Math.max(
    SHEETS_HEIGHT.min,
    (typeof window === "undefined" ? 900 : window.innerHeight) - 260,
  );
  return (
    <section
      class={`sheets${open ? " open" : ""}${max ? " max" : ""}`}
      aria-label="Sheets"
      data-testid="sheets"
      data-state={max ? "max" : open ? "split" : "collapsed"}
      style={open ? { height: `${Math.min(h, limit)}px` } : undefined}
    >
      {open && !max && (
        <Splitter
          label="Resize the sheets"
          testid="sheets-splitter"
          value={Math.min(h, limit)}
          min={SHEETS_HEIGHT.min}
          max={limit}
          grows="up"
          onChange={(size, done) => setSheets({ height: size }, done)}
        />
      )}
      <div class="sheets-panel">
        <div class="sheet-rail">
          <div class="sheet-tabs" role="tablist" aria-label="Sheets" onKeyDown={railKey}>
            {list.map((s) => {
              const on = active === s.id;
              return (
                <button
                  type="button"
                  role="tab"
                  id={`sheet-tab-${s.id}`}
                  class="tab"
                  key={s.id}
                  aria-selected={open && on}
                  aria-controls={open && on ? "sheet-panel" : undefined}
                  tabIndex={on ? 0 : -1}
                  onClick={() => openSheet(s.id)}
                >
                  {s.title}
                  {s.badge?.()}
                </button>
              );
            })}
          </div>
          <span class="spacer" />
          <button
            type="button"
            class="rail-btn"
            data-testid="sheets-toggle"
            aria-expanded={open}
            title={open ? "Collapse the sheets (T)" : "Open the sheets (T)"}
            onClick={() => setSheets({ open: !open })}
          >
            {open ? "Collapse" : "Open"} <kbd>T</kbd>
          </button>
          <button
            type="button"
            class="rail-btn"
            data-testid="sheets-max"
            aria-pressed={max}
            title={max ? "Restore the split (Shift+T)" : "Maximize the sheets (Shift+T)"}
            onClick={() => (max ? setSheets({ max: false }) : setSheets({ open: true, max: true }))}
          >
            {max ? "Restore" : "Maximize"} <kbd>⇧T</kbd>
          </button>
        </div>
        {open && m && current && (
          <div
            class="drawer-body sheet-body"
            role="tabpanel"
            id="sheet-panel"
            aria-labelledby={`sheet-tab-${current.id}`}
          >
            <current.Body m={m} />
          </div>
        )}
      </div>
    </section>
  );
}
