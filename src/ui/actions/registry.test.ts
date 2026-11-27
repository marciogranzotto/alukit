import { rm } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { scratchFixtures } from "#core/testing.ts";
import { hidden, selection } from "../focus.ts";
import { inspectorActions } from "../inspector/actions.ts";
import { routeKey } from "../keys.ts";
import type { Model } from "../model.ts";
import { connectMenu, menuEntries } from "../shell/ContextMenu.tsx";
import { model } from "../store.ts";
import { viewOf } from "../testing.ts";
import { activeTool } from "../tools/state.ts";
import { viewActions } from "../viewport/actions.ts";
import {
  type Action,
  type ActionContext,
  actions,
  actionsFor,
  helpSections,
  keyCaps,
  keyMatches,
  registerAction,
  runAction,
} from "./registry.ts";
import { selectActions, selectable } from "./select.ts";

/**
 * The action registry (editing audit E0.2): keys bind through keys.ts exactly as named, the help
 * lists every action that has keys, no two actions share a key in one scope, and the seeded
 * actions (Delete, Join end, Replace, Fit, Show), the view's Hide, Isolate and Show all, and the
 * selection verbs (E2.2, E2.4, E2.8) are what the menu offers on a bar.
 */

function key(k: string, mods: { ctrl?: boolean; meta?: boolean; shift?: boolean } = {}) {
  return {
    key: k,
    ctrlKey: mods.ctrl === true,
    metaKey: mods.meta === true,
    altKey: false,
    shiftKey: mods.shift === true,
    target: null,
    preventDefault: vi.fn(),
  } as unknown as KeyboardEvent;
}

const action = (over: Partial<Action> & { id: string }): Action => ({
  title: over.id,
  group: "edit",
  when: () => true,
  run: () => {},
  ...over,
});

let cart: Model;
let root: string;
beforeAll(async () => {
  root = await scratchFixtures();
  cart = await viewOf(join(root, "cart"));
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

const offs: (() => void)[] = [];
afterEach(() => {
  for (const off of offs.splice(0)) off();
  model.value = undefined;
  selection.value = new Set();
  hidden.value = new Set();
  activeTool.value = "select";
});

describe("keys", () => {
  it("match exactly the modifiers they name; a symbol carries its own Shift", () => {
    expect(keyMatches("f", key("f"))).toBe(true);
    expect(keyMatches("f", key("F", { shift: true }))).toBe(false);
    expect(keyMatches("shift+h", key("H", { shift: true }))).toBe(true);
    expect(keyMatches("mod+d", key("d", { ctrl: true }))).toBe(true);
    expect(keyMatches("mod+d", key("d", { meta: true }))).toBe(true);
    expect(keyMatches("mod+d", key("d"))).toBe(false);
    expect(keyMatches("delete", key("Delete", { ctrl: true }))).toBe(false);
    expect(keyMatches("?", key("?", { shift: true }))).toBe(true);
    expect(keyMatches("shift+f10", key("F10", { shift: true }))).toBe(true);
    // Alt: H as typed, or, where Alt composes a character (Option+H is ˙ on a Mac), by its key.
    const alt = (k: string, code: string) => ({ ...key(k), altKey: true, code });
    expect(keyMatches("alt+h", alt("h", "KeyH"))).toBe(true);
    expect(keyMatches("alt+h", alt("˙", "KeyH"))).toBe(true);
    expect(keyMatches("alt+h", alt("a", "KeyQ"))).toBe(false);
    expect(keyMatches("alt+h", key("h"))).toBe(false);
    expect(keyMatches("h", alt("˙", "KeyH"))).toBe(false);
    expect(keyCaps("mod+shift+d")).toEqual(["Ctrl", "Shift", "D"]);
    expect(keyCaps("delete")).toEqual(["Delete"]);
  });

  it("run their action through keys.ts when it can run, and are left to others when not", () => {
    model.value = cart;
    const run = vi.fn();
    let can: true | string = true;
    offs.push(registerAction(action({ id: "t", keys: ["mod+k"], when: () => can, run })));
    expect(routeKey(key("k", { ctrl: true }))).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]?.[0]).toMatchObject({ from: "key" });
    can = "not now";
    expect(routeKey(key("k", { ctrl: true }))).toBe(false);
    expect(routeKey(key("k"))).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("are one action's in a scope: a second action on the key throws; the same id replaces", () => {
    offs.push(registerAction(action({ id: "a", keys: ["mod+k"] })));
    expect(() => registerAction(action({ id: "b", keys: ["mod+k"] }))).toThrow(/a's key/);
    // Another scope is another key.
    offs.push(registerAction(action({ id: "c", keys: ["mod+k"], scope: "overlay" })));
    offs.push(registerAction(action({ id: "a", keys: ["mod+j"] })));
    expect(actions.value.filter((x) => x.id === "a")).toHaveLength(1);
    expect(() => offs.push(registerAction(action({ id: "b", keys: ["mod+k"] })))).not.toThrow();
  });
});

describe("the seeded actions", () => {
  it("every action with keys is in the help, and no two share a key in one scope", () => {
    offs.push(inspectorActions(), viewActions(), selectActions(), connectMenu());
    const keyed = actions.value.filter((a) => a.keys?.length);
    expect(keyed.map((a) => a.id).sort()).toEqual([
      "delete",
      "fit",
      "hide",
      "isolate",
      "menu",
      "select-all",
      "show-all",
    ]);
    const rows = helpSections.value.flatMap((s) => s.rows);
    for (const a of keyed) {
      for (const k of a.keys ?? []) {
        const caps = keyCaps(k).join("+");
        expect(
          rows.some((r) => [r.keys, ...(r.or ?? [])].some((x) => x.join("+") === caps)),
          `${a.id} ${k}`,
        ).toBe(true);
      }
    }
    const slots = keyed.flatMap((a) =>
      (a.keys ?? []).map((k) => `${a.scope ?? "app"} ${keyCaps(k).join("+")}`),
    );
    expect(new Set(slots).size).toBe(slots.length);
    // Delete's line is where it was, under Editing, with Backspace as its other key.
    const editing = helpSections.value.find((s) => s.id === "editing");
    expect(editing?.rows[0]).toMatchObject({ keys: ["Delete"], or: [["Backspace"]] });
    // F is the View section's first line, before the O a region describes.
    expect(helpSections.value.find((s) => s.id === "view")?.rows[0]?.keys).toEqual(["F"]);
  });

  it("the menu on a bar offers them, each enabled or saying why not", () => {
    offs.push(inspectorActions(), viewActions());
    const c: ActionContext = { m: cart, selection: new Set(["b1"]), from: "view" };
    const entries = menuEntries(c);
    expect(entries.map((e) => e.id)).toEqual([
      "delete",
      "join-end",
      "replace",
      "fit",
      "show",
      "hide",
      "isolate",
    ]);
    const by = Object.fromEntries(entries.map((e) => [e.id, e]));
    expect(by.delete?.enabled).toBe(true);
    expect(by.replace?.enabled).toBe(true);
    expect(by.show?.enabled).toBe(true);
    // No view in a unit test: Fit says why.
    expect(by.fit?.enabled).toBe("the view is not ready");
    // b1's end a is open (inspector.test.ts) and its end b is joined: the menu by end b says so.
    const nearB = menuEntries({
      ...c,
      hit: { id: "b1", p: cart.derived.bars.b1?.b as never, normal: [0, 0, 1], face: "b" },
    }).find((e) => e.id === "join-end");
    expect(nearB?.title).toBe("Join b1.b");
    expect(nearB?.enabled).toMatch(/^b1\.b /);
    const a = actionsFor({ ...c, ref: "b1.a" }).find((x) => x.action.id === "join-end");
    expect(a?.enabled).toBe(true);
    // A part has no ends to join and no profile to replace.
    const part = Object.keys(cart.derived.parts)[0] as string;
    const onPart = menuEntries({ ...c, selection: new Set([part]) }).map((e) => e.id);
    expect(onPart).toEqual(["delete", "fit", "show", "hide", "isolate"]);
    // Delete works in Select only, and says so in a tool.
    activeTool.value = "draw";
    expect(runAction("delete", c)).toBe("Delete works in Select: press Esc first");
  });
});

describe("the selection verbs and the view's visibility (E2.2, E2.4)", () => {
  it("offer select all, similar, the same tags and connected on a bar, each saying why not", () => {
    offs.push(selectActions(), viewActions());
    const on = (id: string) =>
      Object.fromEntries(
        menuEntries({ m: cart, selection: new Set([id]), from: "view" }).map((e) => [e.id, e]),
      );
    const b1 = on("b1");
    expect(Object.keys(b1)).toEqual([
      "select-all",
      "select-similar",
      "select-tagged",
      "select-connected",
      "select-assembly",
      "fit",
      "show",
      "hide",
      "isolate",
    ]);
    expect(b1["select-tagged"]?.title).toBe("Select tagged post");
    expect(b1["select-tagged"]?.enabled).toBe(true);
    // The top rail carries no tag: the verb says so.
    expect(on("b5")["select-tagged"]).toMatchObject({
      title: "Select the same tags",
      enabled: "b5 has no tag",
    });
    // A pattern copy is no entity of its own: no similar, no connected.
    const copy = Object.keys(cart.derived.bars).find((id) => id.includes("@")) as string;
    expect(Object.keys(on(copy))).not.toContain("select-similar");
    expect(Object.keys(on(copy))).not.toContain("select-connected");
  });

  it("select all takes the document's drawn bars and parts, less what is hidden", () => {
    const all = selectable(cart);
    expect(all.filter((id) => id.startsWith("b"))).toHaveLength(34);
    expect(all.some((id) => id.includes("@"))).toBe(false);
    expect(all.every((id) => cart.derived.bars[id] || cart.derived.parts[id])).toBe(true);
    hidden.value = new Set(["b1", "b2"]);
    expect(selectable(cart)).toEqual(all.filter((id) => id !== "b1" && id !== "b2"));
    model.value = cart;
    offs.push(selectActions());
    expect(routeKey(key("a", { ctrl: true }))).toBe(true);
    expect([...selection.value].sort()).toEqual([...selectable(cart)].sort());
  });

  it("H hides the selection and takes it out of it; Shift+H isolates; Alt+H shows all", () => {
    model.value = cart;
    offs.push(viewActions());
    selection.value = new Set(["b9"]);
    expect(routeKey(key("h"))).toBe(true);
    expect([...hidden.value]).toEqual(["b9"]);
    expect([...selection.value]).toEqual([]);
    selection.value = new Set(["b10"]);
    expect(routeKey(key("H", { shift: true }))).toBe(true);
    expect(hidden.value.has("b10")).toBe(false);
    expect(hidden.value.has("b9")).toBe(true);
    expect(hidden.value.has("b1")).toBe(true);
    expect(routeKey({ ...key("˙"), altKey: true, code: "KeyH" } as KeyboardEvent)).toBe(true);
    expect([...hidden.value]).toEqual([]);
    // Nothing hidden: Alt+H has nothing to do, and leaves the key alone.
    expect(routeKey({ ...key("h"), altKey: true, code: "KeyH" } as KeyboardEvent)).toBe(false);
  });
});
