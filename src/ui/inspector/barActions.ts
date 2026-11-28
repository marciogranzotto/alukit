import { signal } from "@preact/signals";
import { type Action, type ActionContext, registerAction } from "../actions/registry.ts";
import { splitBatch } from "../edit/batches.ts";
import type { Model } from "../model.ts";
import { busy, sendCommands } from "../store.ts";
import { readOnly } from "./Fields.tsx";
import { isObject, written } from "./words.ts";

/**
 * A bar's actions (docs/ux/editing-audit.md E4.3, E4.4, E-UX-21, E-UX-22, E-UX-24): Split here,
 * at the station the view's menu was opened on, to the whole millimetre; Split at a typed
 * distance, which opens the inspector's split form; Reverse; Add a hole here, which opens the
 * inspector's hole form on that face and station. Registered while the inspector is shown, as its other
 * actions are; no single letter (E-UX-24). Each sends one existing command, as `alukit do` would.
 * Owner: E4.
 */

/** The bar the inspector's Split form is open for, as the Split at… action asks. */
export const splitAsked = signal<string | undefined>(undefined);

/**
 * The hole the inspector's hole form is open for, prefilled where the menu was opened: its face,
 * and its distance from where it counts (end a's cut when the menu offers it; review M3).
 */
export const holeAsked = signal<HoleAsked | undefined>(undefined);

type Face = "+x" | "-x" | "+y" | "-y";

export interface HoleAsked {
  bar: string;
  face: Face;
  at_mm: number;
  from: "a.cut" | "b.cut" | "a" | "b";
}

/** The one bar the context is about, a pattern copy being no bar of its own. */
export function oneBar(c: ActionContext): string | undefined {
  const ids = [...c.selection];
  const id = ids.length === 1 ? (ids[0] as string) : undefined;
  return id && !id.includes("@") && c.m.derived.bars[id] ? id : undefined;
}

/** The run a bar is in, if any (§4.7). */
export function runOf(m: Model, bar: string): string | undefined {
  const runs = isObject(m.doc.runs) ? m.doc.runs : {};
  for (const [id, r] of Object.entries(runs)) {
    const bars = Array.isArray(r) ? r : isObject(r) && Array.isArray(r.bars) ? r.bars : [];
    if (bars.includes(bar)) return id;
  }
  return undefined;
}

/** Where Split here cuts: the station the view's menu opened on, on the bar selected. */
export function splitHere(c: ActionContext): { bar: string; at_mm: number } | undefined {
  const bar = oneBar(c);
  const st = c.hit?.station;
  if (!bar || c.hit?.id !== bar || !st || st.bar !== bar) return undefined;
  return { bar, at_mm: Math.round(st.at_mm) };
}

/** Why no step can be sent now, or undefined. */
function cannotSend(): string | undefined {
  if (readOnly()) return "the project is read-only";
  if (busy.peek()) return "a step is on its way";
  return undefined;
}

const SPLIT_HERE: Action = {
  id: "split-here",
  title: (c) => {
    const s = splitHere(c);
    return s ? `Split ${s.bar} here, ${s.at_mm} mm from end a` : "Split here";
  },
  group: "bar",
  applies: (c) => splitHere(c) !== undefined,
  when(c) {
    const s = splitHere(c);
    if (!s) return "open the menu on the bar where it splits";
    const b = splitBatch(c.m, s.bar, s.at_mm);
    if ("why" in b) return b.why;
    return cannotSend() ?? true;
  },
  async run(c) {
    const s = splitHere(c);
    const b = s && splitBatch(c.m, s.bar, s.at_mm);
    if (s && b && !("why" in b)) await sendCommands(b, `split ${s.bar} at ${s.at_mm} mm`);
  },
};

const SPLIT_AT: Action = {
  id: "split-at",
  title: (c) => `Split ${oneBar(c) ?? "a bar"} at…`,
  group: "bar",
  applies: (c) => oneBar(c) !== undefined,
  when: () => (readOnly() ? "the project is read-only" : true),
  run(c) {
    splitAsked.value = oneBar(c);
  },
};

/** Why a bar cannot be reversed from here, as `reverseBar` would refuse it. */
function reverseWhy(m: Model, bar: string): string | undefined {
  const run = runOf(m, bar);
  if (run) return `${bar} is in run ${run}, whose bars all point the same way: reverse the run`;
  const w = written(m, bar);
  if (isObject(w) && isObject(w.b) && w.b.len_mm !== undefined) {
    return `${bar}'s end b is a free end; give it a point before reversing the bar`;
  }
  return undefined;
}

const REVERSE: Action = {
  id: "reverse",
  title: (c) => `Reverse ${oneBar(c) ?? "a bar"}`,
  group: "bar",
  help: "Swap a bar's ends; its body, its joints and what is placed on it stay where they are",
  applies: (c) => oneBar(c) !== undefined,
  when(c) {
    const bar = oneBar(c);
    if (!bar) return "select one bar";
    return reverseWhy(c.m, bar) ?? cannotSend() ?? true;
  },
  async run(c) {
    const bar = oneBar(c);
    if (bar) await sendCommands([{ cmd: "reverseBar", args: { id: bar } }], `reverse ${bar}`);
  },
};

/**
 * Where Add a hole here drills: the side face and station the view's menu opened on, counted from
 * end a's cut, its long point, as the cut list and the shop measure (review M3). The station is
 * from design point a; the bar's view says where its cut lies from there.
 */
export function holeHere(c: ActionContext): HoleAsked | undefined {
  const bar = oneBar(c);
  const hit = c.hit;
  const face = hit?.face;
  if (!bar || hit?.id !== bar || !hit.station || hit.station.bar !== bar) return undefined;
  if (face !== "+x" && face !== "-x" && face !== "+y" && face !== "-y") return undefined;
  const la = c.m.display.bars[bar]?.long_mm?.[0] ?? 0;
  return { bar, face, at_mm: Math.round(hit.station.at_mm - la), from: "a.cut" };
}

const ADD_HOLE: Action = {
  id: "add-hole",
  title: (c) => {
    const h = holeHere(c);
    return h
      ? `Add a hole on ${h.bar}'s face ${h.face}, ${h.at_mm} mm from end a's cut…`
      : "Add a hole here…";
  },
  group: "bar",
  help: "A hole a person adds (§4.4), on the face and at the station the menu was opened on",
  applies: (c) => holeHere(c) !== undefined,
  when: () => (readOnly() ? "the project is read-only" : true),
  run(c) {
    const h = holeHere(c);
    if (h) holeAsked.value = h;
  },
};

/** Registers a bar's actions; returns the undo. */
export function barActions(): () => void {
  const offs = [SPLIT_HERE, SPLIT_AT, REVERSE, ADD_HOLE].map(registerAction);
  return () => {
    for (const off of offs) off();
  };
}
