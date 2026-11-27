import { afterEach, describe, expect, it, vi } from "vitest";
import { chord, type KeyHandler, onKey, routeKey, typingIn } from "./keys.ts";

/** The key router (keys.ts): the text-entry guard, the order handlers are offered a key in. */

const offs: (() => void)[] = [];
afterEach(() => {
  for (const off of offs.splice(0)) off();
});

function key(k: string, opts: { target?: unknown; ctrl?: boolean; alt?: boolean } = {}) {
  return {
    key: k,
    ctrlKey: opts.ctrl === true,
    metaKey: false,
    altKey: opts.alt === true,
    shiftKey: false,
    target: opts.target ?? null,
    preventDefault: vi.fn(),
  } as unknown as KeyboardEvent & { preventDefault: ReturnType<typeof vi.fn> };
}

const el = (tagName: string, type?: string, editable = false) => ({
  tagName,
  type,
  isContentEditable: editable,
});

describe("typingIn", () => {
  it("is true in a text field, a list or an editable, and false on buttons and boxes", () => {
    expect(typingIn(el("INPUT", "text") as unknown as EventTarget)).toBe(true);
    expect(typingIn(el("INPUT", "search") as unknown as EventTarget)).toBe(true);
    expect(typingIn(el("INPUT", "number") as unknown as EventTarget)).toBe(true);
    expect(typingIn(el("TEXTAREA") as unknown as EventTarget)).toBe(true);
    expect(typingIn(el("SELECT") as unknown as EventTarget)).toBe(true);
    expect(typingIn(el("DIV", undefined, true) as unknown as EventTarget)).toBe(true);
    for (const t of ["checkbox", "radio", "button", "submit", "range"])
      expect(typingIn(el("INPUT", t) as unknown as EventTarget), t).toBe(false);
    expect(typingIn(el("BUTTON") as unknown as EventTarget)).toBe(false);
    expect(typingIn(null)).toBe(false);
  });
});

describe("routeKey", () => {
  it("offers a key by scope, then priority, then registration, until one takes it", () => {
    const seen: string[] = [];
    const handler =
      (name: string, takes = false): KeyHandler =>
      () => {
        seen.push(name);
        return takes;
      };
    offs.push(onKey("app", handler("app")));
    offs.push(onKey("tool", handler("tool, first")));
    offs.push(onKey("tool", handler("tool, second")));
    offs.push(onKey("tool", handler("tool, high"), 5));
    offs.push(onKey("overlay", handler("overlay")));
    const e = key("x");
    expect(routeKey(e)).toBe(false);
    expect(seen).toEqual(["overlay", "tool, high", "tool, first", "tool, second", "app"]);
    expect(e.preventDefault).not.toHaveBeenCalled();

    seen.length = 0;
    offs.push(onKey("tool", handler("taker", true), 1));
    const taken = key("x");
    expect(routeKey(taken)).toBe(true);
    expect(seen).toEqual(["overlay", "tool, high", "taker"]);
    expect(taken.preventDefault).toHaveBeenCalledOnce();
  });

  it("gives a key typed into a field to the field alone", () => {
    const h = vi.fn(() => true);
    offs.push(onKey("app", h));
    expect(routeKey(key("b", { target: el("INPUT", "text") }))).toBe(false);
    expect(h).not.toHaveBeenCalled();
    expect(routeKey(key("b", { target: el("INPUT", "checkbox") }))).toBe(true);
  });

  it("stops offering a key to a handler once it is unregistered", () => {
    const h = vi.fn(() => true);
    const off = onKey("app", h);
    off();
    expect(routeKey(key("b"))).toBe(false);
    expect(h).not.toHaveBeenCalled();
  });
});

describe("chord", () => {
  it("is Ctrl, Cmd or Alt held; Shift alone is no chord", () => {
    expect(chord(key("z", { ctrl: true }))).toBe(true);
    expect(chord(key("z", { alt: true }))).toBe(true);
    expect(chord({ ctrlKey: false, metaKey: true, altKey: false })).toBe(true);
    expect(chord(key("Z"))).toBe(false);
  });
});
