import { rm } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { scratchFixtures } from "#core/testing.ts";
import { selection } from "../focus.ts";
import { inspectorActions } from "../inspector/actions.ts";
import { routeKey } from "../keys.ts";
import type { Model } from "../model.ts";
import { menuEntries } from "../shell/ContextMenu.tsx";
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

/**
 * The action registry (editing audit E0.2): keys bind through keys.ts exactly as named, the help
 * lists every action that has keys, no two actions share a key in one scope, and the seeded
 * actions (Delete, Join end, Replace, Fit, Show) are what the menu offers on a bar.
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
    offs.push(inspectorActions(), viewActions());
    const keyed = actions.value.filter((a) => a.keys?.length);
    expect(keyed.map((a) => a.id).sort()).toEqual(["delete", "fit"]);
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
    expect(entries.map((e) => e.id)).toEqual(["delete", "join-end", "replace", "fit", "show"]);
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
    expect(onPart).toEqual(["delete", "fit", "show"]);
    // Delete works in Select only, and says so in a tool.
    activeTool.value = "draw";
    expect(runAction("delete", c)).toBe("Delete works in Select: press Esc first");
  });
});
