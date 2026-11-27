import { compareIds } from "#core/ids.ts";
import { ApiError, get } from "../api.ts";
import { hidden, select, selection } from "../focus.ts";
import type { Model } from "../model.ts";
import { tell, variant } from "../store.ts";
import { type Action, type ActionContext, registerAction } from "./registry.ts";

/**
 * The selection verbs (docs/ux/editing-audit.md E2.2, E2.8): select all (Ctrl/Cmd+A), similar
 * (the same item and options), the same tags, connected (the bars its connections join) and the
 * whole assembly. Similar, the same tags and connected are `alukit query`'s selectors, `like:`,
 * `like: … by tag`, `connected:` and `connected*:`, asked of the server (`/api/query`), so the app
 * reads the core's `similarTo` and `connectedTo` over the document and the derived model it holds.
 * None is a step. Owner: E2.
 */

/** The document's entities a selection verb starts from. */
const ENTITY_KINDS = ["bars", "parts", "connections", "runs", "patterns", "nodes"] as const;

function entity(m: Model, id: string): Record<string, unknown> | undefined {
  for (const k of ENTITY_KINDS) {
    const all = m.doc[k];
    if (typeof all !== "object" || all === null) continue;
    const v = (all as Record<string, unknown>)[id];
    if (v !== undefined)
      return typeof v === "object" && v !== null && !Array.isArray(v)
        ? (v as Record<string, unknown>)
        : {};
  }
  return undefined;
}

/** The selected ids that are the document's entities (not a copy, an end, a corner or an item). */
export function selectedEntities(c: ActionContext): string[] {
  return [...c.selection].filter((id) => entity(c.m, id) !== undefined).sort(compareIds);
}

/** The one entity selected, when exactly one is. */
function oneEntity(c: ActionContext): string | undefined {
  const ids = [...c.selection];
  return ids.length === 1 && entity(c.m, ids[0] as string) ? ids[0] : undefined;
}

/** An entity's tags, as written. */
function tagsOf(m: Model, id: string): string[] {
  const t = entity(m, id)?.tags;
  return Array.isArray(t) ? t.map(String) : [];
}

/**
 * What Select all takes: every bar and placed part of the document that the view draws and does
 * not hide. Not pattern copies (their template is the entity), nor connections, nodes or runs,
 * which have no body of their own to select in the view (e2 7).
 */
export function selectable(m: Model): string[] {
  const off = hidden.peek();
  const bars = Object.keys(m.doc.bars ?? {}).filter((id) => m.derived.bars[id] && !off.has(id));
  const parts = Object.keys(m.doc.parts ?? {}).filter((id) => {
    const p = m.derived.parts[id];
    return p !== undefined && !p.unplaced && !off.has(id);
  });
  return [...bars, ...parts].sort(compareIds);
}

/** The ids a selector names, as `alukit query` selects them, in the tab's variant. */
export async function queryIds(selector: string): Promise<string[]> {
  const q = new URLSearchParams({ select: selector });
  const v = variant.peek();
  if (v !== undefined) q.set("variant", v);
  return (await get<{ ids: string[] }>(`/api/query?${q}`)).ids;
}

/**
 * Selects what a selector names, unless the person changed the selection while it was asked;
 * a refusal is told in a toast.
 */
async function selectBy(c: ActionContext, what: string, selector: string): Promise<void> {
  const asked = selection.peek();
  try {
    const ids = await queryIds(selector);
    if (selection.peek() !== asked) return;
    select(ids, "replace");
  } catch (e) {
    tell(`${what}: ${e instanceof ApiError ? e.message : String(e)}`, true);
  }
}

const SELECT_ALL: Action = {
  id: "select-all",
  title: "Select all",
  group: "select",
  keys: ["mod+a"],
  help: "Select every bar and part shown",
  when: (c) => (selectable(c.m).length > 0 ? true : "nothing to select"),
  run(c) {
    select(selectable(c.m), "replace");
  },
};

const SIMILAR: Action = {
  id: "select-similar",
  title: "Select similar",
  group: "select",
  help: "Select what has the same item and options",
  applies: (c) => oneEntity(c) !== undefined,
  when: (c) => (oneEntity(c) ? true : "select one bar, part or joint"),
  run(c) {
    const id = oneEntity(c);
    if (id) return selectBy(c, "Select similar", `like:${id}`);
  },
};

const SAME_TAGS: Action = {
  id: "select-tagged",
  title: (c) => {
    const id = oneEntity(c);
    const tags = id ? tagsOf(c.m, id) : [];
    return tags.length > 0 ? `Select tagged ${tags.join(" + ")}` : "Select the same tags";
  },
  group: "select",
  help: "Select what carries every tag the selection carries",
  applies: (c) => oneEntity(c) !== undefined,
  when: (c) => {
    const id = oneEntity(c);
    if (!id) return "select one bar, part or joint";
    return tagsOf(c.m, id).length > 0 ? true : `${id} has no tag`;
  },
  run(c) {
    const id = oneEntity(c);
    if (id) return selectBy(c, "Select the same tags", `like:${id} by tag`);
  },
};

const CONNECTED: Action = {
  id: "select-connected",
  title: "Select connected",
  group: "select",
  help: "Select the bars the selection's joints join to it",
  applies: (c) => selectedEntities(c).length > 0,
  when: (c) => (selectedEntities(c).length > 0 ? true : "select a bar, a joint or a run"),
  run(c) {
    return selectBy(c, "Select connected", `connected:${selectedEntities(c).join(",")}`);
  },
};

const ASSEMBLY: Action = {
  id: "select-assembly",
  title: "Select the whole assembly",
  group: "select",
  help: "Select every bar joined to the selection, joint after joint",
  applies: (c) => selectedEntities(c).length > 0,
  when: (c) => (selectedEntities(c).length > 0 ? true : "select a bar, a joint or a run"),
  run(c) {
    return selectBy(c, "Select the whole assembly", `connected*:${selectedEntities(c).join(",")}`);
  },
};

/** Registers the selection verbs; returns the undo. */
export function selectActions(): () => void {
  const offs = [SELECT_ALL, SIMILAR, SAME_TAGS, CONNECTED, ASSEMBLY].map(registerAction);
  return () => {
    for (const off of offs) off();
  };
}
