import { afterEach, describe, expect, it } from "vitest";
import { clearShow, hover, select, selection, show, shown } from "./focus.ts";
import { hookFields } from "./hook.ts";
import { model } from "./store.ts";
import { SMALL } from "./testing.ts";

/** The selection, the hover and Show (focus.ts), outside a browser. */

afterEach(() => {
  selection.value = new Set();
  hover.value = undefined;
  clearShow();
  model.value = undefined;
});

describe("select", () => {
  it("replaces, toggles and adds", () => {
    select(["b1", "b2"], "replace");
    expect([...selection.value]).toEqual(["b1", "b2"]);
    select(["b2", "b3"], "toggle");
    expect([...selection.value]).toEqual(["b1", "b3"]);
    select(["b1", "b4"], "add");
    expect([...selection.value]).toEqual(["b1", "b3", "b4"]);
    select([], "replace");
    expect(selection.value.size).toBe(0);
  });

  it("is the selection store.ts re-exports", async () => {
    const store = await import("./store.ts");
    expect(store.selection).toBe(selection);
    expect(store.select).toBe(select);
  });
});

describe("show", () => {
  it("selects what the refs stand for, and records each request", () => {
    model.value = SMALL;
    select(["b2"], "replace");
    show({ refs: ["b1.a", "c1", "O1"], problem: "open-item/O1", field: "opt.finish" });
    expect([...selection.value]).toEqual(["b1", "c1"]);
    const first = shown.value;
    expect(first).toMatchObject({
      refs: ["b1.a", "c1", "O1"],
      problem: "open-item/O1",
      field: "opt.finish",
      isolate: false,
    });
    // The same refs again are a new request: the scene pulses again.
    show({ refs: ["b1.a", "c1", "O1"], isolate: true });
    expect(shown.value?.n).toBe((first?.n ?? 0) + 1);
    expect(shown.value).not.toHaveProperty("problem");
    expect(shown.value?.isolate).toBe(true);
    clearShow();
    expect(shown.value).toBeUndefined();
  });

  it("selects nothing before a model is drawn", () => {
    select(["b2"], "replace");
    show({ refs: ["b1"] });
    expect(selection.value.size).toBe(0);
  });
});

describe("the hook", () => {
  it("answers the revision and read-only state from the store, undefined before the server", () => {
    const h = hookFields();
    expect(h.rev?.()).toBeUndefined();
    expect(h.readOnly?.()).toBe(false);
  });
});
