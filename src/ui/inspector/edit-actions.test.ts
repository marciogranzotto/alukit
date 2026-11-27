import { rm } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { scratchFixtures } from "#core/testing.ts";
import { type ActionContext, runAction } from "../actions/registry.ts";
import { selection } from "../focus.ts";
import type { Model } from "../model.ts";
import { menuEntries } from "../shell/ContextMenu.tsx";
import { viewOf } from "../testing.ts";
import { viewActions } from "../viewport/actions.ts";
import { inspectorActions } from "./actions.ts";
import { asked, editActions } from "./edit-actions.ts";

/**
 * The connection, pattern and part actions in the menu (docs/ux/editing-audit.md E5.6): each
 * kind's menu holds what is about it, Delete beside them, and an action that cannot run says why.
 * On the cart.
 */

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
  asked.value = undefined;
  selection.value = new Set();
});

const on = (...ids: string[]): ActionContext => ({
  m: cart,
  selection: new Set(ids),
  from: "view",
});
const ids = (c: ActionContext) => menuEntries(c).map((e) => e.id);

describe("the menu on a connection, a pattern and a part (E5.6)", () => {
  it("a connection: Delete, Edit and Change connector; a face joint names fasteners, no connector", () => {
    offs.push(inspectorActions(), editActions(), viewActions());
    // c9, the splice of b11 and b12.
    const splice = menuEntries(on("c9"));
    expect(splice.map((e) => [e.id, e.title])).toEqual([
      ["delete", "Delete"],
      ["edit-connection", "Edit c9…"],
      ["change-connector", "Change connector…"],
      ["fit", "Fit to the selection"],
      ["show", "Show"],
    ]);
    expect(splice.find((e) => e.id === "edit-connection")?.enabled).toBe(true);
    expect(ids(on("c13"))).toContain("change-connector");
    expect(ids(on("c1"))).toContain("change-connector");
    expect(ids(on("c23"))).toEqual(["delete", "edit-connection", "fit", "show"]);
    // A pattern copy's connection is edited through its template: greyed, saying so.
    const copy = menuEntries(on("c26@1")).find((e) => e.id === "edit-connection");
    expect(copy?.enabled).toBe("c26@1 is a pattern copy: change c26, its template");
    // Edit asks the inspector to take the focus to the connection's fields.
    expect(runAction("edit-connection", on("c9"))).toBe(true);
    expect(asked.value).toMatchObject({ id: "c9", what: "edit" });
    expect(runAction("change-connector", on("c13"))).toBe(true);
    expect(asked.value).toMatchObject({ id: "c13", what: "connector" });
  });

  it("a joint marker's menu offers its joint's, when one joint is there", () => {
    offs.push(inspectorActions(), editActions(), viewActions());
    // The splice c9 is the one joint where b11 and b12 meet.
    const splice = menuEntries(on("corner:700,300,900"));
    expect(splice.find((e) => e.id === "edit-connection")?.title).toBe("Edit c9…");
    expect(splice.map((e) => e.id)).toContain("change-connector");
    expect(runAction("change-connector", on("corner:700,300,900"))).toBe(true);
    expect(asked.value).toMatchObject({ id: "c9", what: "connector" });
    expect(selection.value).toEqual(new Set(["c9"]));
  });

  it("a pattern or one of its copies: Explode; a part: Replace; a bar: neither", () => {
    offs.push(inspectorActions(), editActions(), viewActions());
    const pattern = menuEntries(on("pt1"));
    expect(pattern.map((e) => e.id)).toEqual(["delete", "explode-pattern", "fit", "show"]);
    expect(pattern.find((e) => e.id === "explode-pattern")?.title).toBe("Explode pt1");
    expect(menuEntries(on("b26@2")).find((e) => e.id === "explode-pattern")?.title).toBe(
      "Explode pt1",
    );
    expect(ids(on("p1"))).toEqual(["delete", "replace-part", "fit", "show"]);
    expect(runAction("replace-part", on("p1"))).toBe(true);
    expect(asked.value).toMatchObject({ id: "p1", what: "replace" });
    // A bar's menu is as the inspector and the view made it.
    expect(ids(on("b1"))).toEqual(["delete", "join-end", "replace", "fit", "show"]);
    // Two selected: none of these is about one thing.
    expect(ids(on("c9", "c13"))).toEqual(["delete", "fit", "show"]);
  });
});
