import { signal } from "@preact/signals";
import { Fragment } from "preact";
import { useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  type Action,
  type ActionContext,
  type ActionGroup,
  actionsFor,
  keyCaps,
  registerAction,
  runAction,
  titleOf,
} from "../actions/registry.ts";
import { select, selection } from "../focus.ts";
import { extendHook } from "../hook.ts";
import { onKey } from "../keys.ts";
import { capsText } from "../platform.ts";
import { model, tell } from "../store.ts";
import { activeTool, gesture } from "../tools/state.ts";
import { type SizeBox, sizeOf } from "../viewport/size.ts";
import { viewer } from "../viewport/viewer.ts";

/**
 * The context menu (docs/ux/editing-audit.md E-UX-1, E-UX-2, E0.4): the actions that belong to
 * what it was opened on, from the action registry, by group, each with its keys; one that cannot
 * run now is greyed and says why. WAI-ARIA's menu pattern: it takes focus when it opens and gives
 * it back when it closes; ↑ ↓ Home End move, a typed letter goes to the entry whose access key it
 * is (underlined; review m11), else to the next entry starting with it, Enter or Space runs one, Esc or Tab closes it, and so does a press outside it or a new
 * revision (what it was opened on may have changed). `openMenu` opens it; `connectMenu` has the
 * view open it on a right-click that did not move. Owner: E2.
 */

export interface MenuRequest {
  ctx: ActionContext;
  /** Where it opens, CSS pixels from the page's top left. */
  at: readonly [number, number];
  /** Counts the menus opened, so opening one again starts it afresh. */
  n: number;
}

/** The menu open now. */
export const menu = signal<MenuRequest | undefined>(undefined);

let opened = 0;

export function openMenu(ctx: ActionContext, at: readonly [number, number]): void {
  menu.value = { ctx, at, n: ++opened };
}

export function closeMenu(): void {
  if (menu.peek()) menu.value = undefined;
}

/** The groups in the menu's order: what is chosen, what it is, then the view. */
const ORDER: readonly ActionGroup[] = [
  "select",
  "edit",
  "transform",
  "bar",
  "connection",
  "pattern",
  "part",
  "view",
];

export interface MenuEntry {
  id: string;
  title: string;
  group: ActionGroup;
  /** True, or why it cannot run now. */
  enabled: true | string;
  /** Each key that runs it, as caps. */
  keys: string[][];
  /** Its access key, a lower-case letter of its title, no other entry's (review m11). */
  access?: string;
}

/** What the menu lists for a context, in its order, each with its access key. */
export function menuEntries(ctx: ActionContext): MenuEntry[] {
  const listed = actionsFor(ctx)
    .map(({ action, enabled }) => ({
      id: action.id,
      title: titleOf(action, ctx),
      group: action.group,
      enabled,
      keys: (action.keys ?? []).map(keyCaps),
      ...(action.access ? { access: action.access.toLowerCase() } : {}),
    }))
    .sort((a, b) => ORDER.indexOf(a.group) - ORDER.indexOf(b.group));
  return withAccessKeys(listed);
}

/**
 * Gives each entry its own access key, as a menu's mnemonics are (review m11: the letter jump
 * took D to Delete, whose dialog then took a typed space): first the letters actions ask for;
 * then an entry's own key's letter (Duplicate's D of Ctrl+D, Hide's H); then the first letter of
 * a word of its title; then any letter of it. A letter is used once; an entry left with none is
 * reached by the arrows.
 */
export function withAccessKeys(entries: readonly MenuEntry[]): MenuEntry[] {
  const used = new Set(entries.flatMap((e) => (e.access ? [e.access] : [])));
  const out = entries.map((e) => ({ ...e }));
  const take = (e: MenuEntry, letters: readonly string[]) => {
    const l = letters.find(
      (x) => /^[a-z]$/.test(x) && !used.has(x) && e.title.toLowerCase().includes(x),
    );
    if (l === undefined) return;
    e.access = l;
    used.add(l);
  };
  for (const e of out) {
    const own = e.keys.map((k) => (k[k.length - 1] ?? "").toLowerCase());
    if (!e.access) take(e, own);
  }
  for (const e of out) {
    if (e.access) continue;
    const words = e.title.toLowerCase().match(/[a-z]+/g) ?? [];
    take(e, [...words.map((w) => w[0] as string), ...words.join("")]);
  }
  return out;
}

/** A title with its access key's first appearance underlined. */
function AccessTitle({ title, access }: { title: string; access?: string | undefined }) {
  const i = access ? title.toLowerCase().indexOf(access) : -1;
  if (i < 0) return <>{title}</>;
  return (
    <>
      {title.slice(0, i)}
      <u class="access-key">{title[i]}</u>
      {title.slice(i + 1)}
    </>
  );
}

/** What the menu is about, as its heading says it. */
export function menuTitle(ctx: ActionContext): string {
  const ids = [...ctx.selection];
  if (ids.length === 1) return ids[0] as string;
  return ids.length === 0 ? "Nothing selected" : `${ids.length} selected`;
}

/** A typed letter's prefix lasts this long, ms, as list boxes do. */
const TYPE_AHEAD_MS = 600;

function MenuBox({ r }: { r: MenuRequest }) {
  const entries = useMemo(() => menuEntries(r.ctx), [r]);
  const title = menuTitle(r.ctx);
  const box = useRef<HTMLDivElement>(null);
  const first = Math.max(
    0,
    entries.findIndex((e) => e.enabled === true),
  );
  const [focus, setFocus] = useState(first);
  const [at, setAt] = useState<readonly [number, number]>(r.at);
  const typedAhead = useRef({ text: "", t: 0 });
  const focusRef = useRef(focus);
  focusRef.current = focus;

  const items = () => [...(box.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
  const move = (i: number) => {
    const n = entries.length;
    if (n === 0) return;
    const k = ((i % n) + n) % n;
    setFocus(k);
    items()[k]?.focus();
  };
  const activate = (i: number) => {
    const e = entries[i];
    if (e?.enabled !== true) return;
    closeMenu();
    const ran = runAction(e.id, r.ctx);
    if (ran !== true) tell(`${e.title}: ${ran}`, true);
  };

  // Before it paints: kept on the page, focused, and its keys its own while open.
  useLayoutEffect(() => {
    const before = document.activeElement;
    const el = box.current;
    if (el) {
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      setAt([
        Math.max(4, Math.min(r.at[0], window.innerWidth - w - 4)),
        Math.max(4, Math.min(r.at[1], window.innerHeight - h - 4)),
      ]);
    }
    (items()[first] ?? el)?.focus();
    const outside = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) closeMenu();
    };
    // The browser's own menu never opens over this one (the Menu key and Shift+F10 also send
    // `contextmenu`, after the key that opened this).
    const native = (e: Event) => e.preventDefault();
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("contextmenu", native, true);
    window.addEventListener("resize", closeMenu);
    let rev = model.peek()?.rev;
    const offModel = model.subscribe((m) => {
      if (m?.rev !== rev) closeMenu();
      rev = m?.rev;
    });
    const offKey = onKey(
      "overlay",
      (e) => {
        if (e.ctrlKey || e.metaKey || e.altKey) {
          closeMenu();
          return false;
        }
        const i = focusRef.current;
        switch (e.key) {
          case "Escape":
          case "Tab":
            closeMenu();
            return true;
          case "ArrowDown":
            move(i + 1);
            return true;
          case "ArrowUp":
            move(i - 1);
            return true;
          case "Home":
            move(0);
            return true;
          case "End":
            move(entries.length - 1);
            return true;
          case "Enter":
          case " ":
            activate(i);
            return true;
        }
        if (e.key.length !== 1) return false;
        // An entry's access key goes to it (it does not run it: Enter does, as for any entry).
        const byAccess = entries.findIndex((x) => x.access === e.key.toLowerCase());
        if (byAccess >= 0) {
          move(byAccess);
          return true;
        }
        // Type-ahead: the next entry whose title starts with what was typed.
        const now = performance.now();
        const t = typedAhead.current;
        t.text = (now - t.t < TYPE_AHEAD_MS ? t.text : "") + e.key.toLowerCase();
        t.t = now;
        const n = entries.length;
        for (let k = 1; k <= n; k++) {
          // A longer prefix may still fit the entry it is on; one letter again goes on to the next.
          const j = (i + (t.text.length > 1 ? k - 1 : k)) % n;
          if (entries[j]?.title.toLowerCase().startsWith(t.text)) {
            move(j);
            break;
          }
        }
        return true;
      },
      200,
    );
    return () => {
      offKey();
      offModel();
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("contextmenu", native, true);
      window.removeEventListener("resize", closeMenu);
      if (before instanceof HTMLElement && before.isConnected) before.focus();
    };
  }, [r]);

  let group: ActionGroup | undefined;
  return (
    <div
      ref={box}
      class="context-menu"
      role="menu"
      aria-label={`Actions on ${title}`}
      data-testid="context-menu"
      tabIndex={-1}
      style={{ left: `${at[0]}px`, top: `${at[1]}px` }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div class="context-menu-head" aria-hidden="true">
        {title}
      </div>
      {entries.length === 0 && <div class="context-menu-empty">Nothing to do here</div>}
      {entries.map((e, i) => {
        const sep = group !== undefined && group !== e.group;
        group = e.group;
        const why = e.enabled === true ? undefined : e.enabled;
        return (
          <Fragment key={e.id}>
            {sep && <hr class="context-menu-sep" />}
            {/* Its keys are the menu's (the overlay handler above), Enter and Space included. */}
            <button
              type="button"
              role="menuitem"
              class="context-menu-item"
              data-action={e.id}
              tabIndex={i === focus ? 0 : -1}
              aria-disabled={why ? "true" : undefined}
              onPointerEnter={() => move(i)}
              onClick={() => activate(i)}
            >
              <span class="label">
                <AccessTitle title={e.title} access={e.access} />
              </span>
              {e.keys[0] && <kbd class="keys">{capsText(e.keys[0])}</kbd>}
              {why && <span class="why">{why}</span>}
            </button>
          </Fragment>
        );
      })}
    </div>
  );
}

/**
 * Where the keyboard opens the menu (E-UX-2's Shift+F10 and Menu key): by the outline's row when
 * the focus is on one, about that row; else at the selection's middle in the view, about the
 * selection; else in the middle of the view.
 */
function keyedMenuAt(m: ActionContext["m"]): { at: [number, number]; from: ActionContext["from"] } {
  const row = (document.activeElement as HTMLElement | null)?.closest?.('[role="treeitem"]');
  if (row) {
    const r = row.getBoundingClientRect();
    return { at: [r.left + 24, r.bottom], from: "outline" };
  }
  const v = viewer.peek();
  const box = selection.peek().size > 0 ? sizeOf(m, [...selection.peek()]) : undefined;
  const mid = box && v?.project(centreOf(box));
  if (mid) return { at: [mid[0], mid[1]], from: "key" };
  const vp = document.querySelector('[data-testid="viewport"]')?.getBoundingClientRect();
  return { at: vp ? [vp.left + vp.width / 2, vp.top + vp.height / 2] : [0, 0], from: "key" };
}

const centreOf = (b: SizeBox): [number, number, number] => [
  (b[0][0] + b[1][0]) / 2,
  (b[0][1] + b[1][1]) / 2,
  (b[0][2] + b[1][2]) / 2,
];

/**
 * Shift+F10 and the Menu key open the menu for the selection (E-UX-2; WAI-ARIA's menu pattern).
 * It is never an entry of a menu itself.
 */
const OPEN_MENU: Action = {
  id: "menu",
  title: "Open the menu",
  group: "select",
  keys: ["shift+f10", "contextmenu"],
  help: "Open the menu of the selection (or of the outline's row)",
  applies: () => false,
  when: () => (menu.peek() ? "the menu is open" : true),
  run(c) {
    const { at, from } = keyedMenuAt(c.m);
    openMenu({ m: c.m, selection: selection.peek(), from }, at);
  },
};

/**
 * Opens the menu from the outline (E2.1): a right-click on a row is about that row, selecting it
 * first when it is not selected, as in the view; on a group's head, about its members.
 */
export function outlineMenu(e: MouseEvent, ids: readonly string[]): void {
  e.preventDefault();
  // A menu open now was opened by the key this event trails (Shift+F10 and the Menu key send
  // `contextmenu` after themselves): opening it again would reset it and lose a letter typed in
  // between (review m11's Shift+F10, D). A right-click elsewhere closed it on its pointerdown.
  if (menu.peek()) return;
  const m = model.peek();
  if (!m || ids.length === 0) return;
  const sel = selection.peek();
  if (!ids.every((id) => sel.has(id))) select(ids, "replace");
  openMenu({ m, selection: selection.peek(), from: "outline" }, [e.clientX, e.clientY]);
}

/**
 * Opens the menu from the view (E-UX-2): a right-click that did not move, in Select with no drag
 * on, opens it on what is under the pointer, selecting that first when it is not selected; on
 * empty space, on the selection. Registers the menu's keys (Shift+F10, Menu). Returns the undo.
 */
export function connectMenu(): () => void {
  let offView: (() => void) | undefined;
  const off = viewer.subscribe((v) => {
    offView?.();
    offView = v?.onContextMenu((hit, at) => {
      const m = model.peek();
      if (!m || activeTool.peek() !== "select" || gesture.peek()) return;
      if (hit && !selection.peek().has(hit.id)) select([hit.id], "replace");
      openMenu({ m, selection: selection.peek(), ...(hit ? { hit } : {}), from: "view" }, at);
    });
  });
  const offKeys = registerAction(OPEN_MENU);
  return () => {
    off();
    offView?.();
    offKeys();
  };
}

export function ContextMenu() {
  const r = menu.value;
  return r ? <MenuBox key={r.n} r={r} /> : null;
}

declare module "../hook.ts" {
  interface AlukitHook {
    /** The context menu open now: what it is on, and each entry, enabled or why not. */
    menu():
      | {
          title: string;
          entries: {
            id: string;
            title: string;
            enabled: boolean;
            why?: string;
            keys: string[];
            /** Its access key (review m11). */
            access?: string;
          }[];
        }
      | undefined;
  }
}

extendHook({
  menu: () => {
    const r = menu.value;
    if (!r) return undefined;
    return {
      title: menuTitle(r.ctx),
      entries: menuEntries(r.ctx).map((e) => ({
        id: e.id,
        title: e.title,
        enabled: e.enabled === true,
        ...(e.enabled === true ? {} : { why: e.enabled }),
        keys: e.keys.map((k) => capsText(k)),
        ...(e.access ? { access: e.access } : {}),
      })),
    };
  },
});
