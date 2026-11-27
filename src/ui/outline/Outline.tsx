import type { TargetedKeyboardEvent } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { ProblemGroup } from "#core/problems/types.ts";
import { selectActions } from "../actions/select.ts";
import { openCatalog } from "../catalog/state.ts";
import { type Status, StatusGlyph } from "../common/StatusGlyph.tsx";
import { cornersOf } from "../corners.ts";
import { hidden, hover, select, selection, shown } from "../focus.ts";
import { problemList } from "../problems/source.ts";
import { outlineMenu } from "../shell/ContextMenu.tsx";
import { marks } from "../shell/presence.ts";
import { model } from "../store.ts";
import { resolveTargets } from "../targets.ts";
import { type Group, groupsOf, membersOf, placesOf, problemsByEntity, type Row } from "./rows.ts";

/**
 * The model outline (docs/ux/plan.md S2.5; design §8, left): every entity in words, by kind or by
 * tag, with the Joints group by corner; a problem's mark (a shape and a word, never colour alone:
 * U55) on the rows it is about; another source's new entities marked until the person's next
 * step. One tree widget (WAI-ARIA's tree pattern): Tab enters it once and leaves it once (U52),
 * the arrow keys move, open and close, Enter or Space selects (Ctrl or Cmd adds). A group's head
 * selects its members, every row under it (a tag's, a kind's), while its twisty opens and closes
 * it; a corner's head selects the corner (editing audit E2.2). A right-click on a row or a head
 * opens the context menu about it (E2.1). A hidden entity's row says so. Show reveals and scrolls
 * to the row of what it shows. The selection verbs register here (src/ui/actions/select.ts).
 * Owner: S2; the editing round's E2.
 */

/**
 * Selects a head's members; with Ctrl or Cmd, adds them, or takes them out when every one is
 * selected already.
 */
function selectMembers(ids: readonly string[], toggle: boolean): void {
  if (!toggle) {
    select(ids, "replace");
    return;
  }
  const sel = selection.peek();
  if (ids.length > 0 && ids.every((id) => sel.has(id))) {
    const out = new Set(ids);
    select(
      [...sel].filter((id) => !out.has(id)),
      "replace",
    );
  } else select(ids, "add");
}

/** A line of the tree as the keyboard walks it: a group head or a row. */
interface Item {
  key: string;
  level: number;
  group?: Group;
  row?: Row;
  /** The group this item sits in (its head's key), for ArrowLeft. */
  parent?: string;
}

const STATUS: Readonly<Record<ProblemGroup, { status: Status; word: string }>> = {
  "blocks-order": { status: "blocked", word: "blocks the order" },
  error: { status: "blocked", word: "error" },
  warning: { status: "warn", word: "warning" },
  note: { status: "info", word: "note" },
};

const CORNER_STATUS: Readonly<Record<"joined" | "open" | "failed", Status>> = {
  joined: "ready",
  open: "warn",
  failed: "blocked",
};

/** The items the keyboard walks: the heads, and the rows of the open groups. */
function flatten(groups: readonly Group[], isOpen: (g: Group) => boolean): Item[] {
  const out: Item[] = [];
  const walk = (gs: readonly Group[], level: number, parent?: string) => {
    for (const g of gs) {
      out.push({ key: `g:${g.key}`, level, group: g, ...(parent ? { parent } : {}) });
      if (!isOpen(g)) continue;
      if (g.groups) walk(g.groups, level + 1, `g:${g.key}`);
      for (const r of g.rows)
        out.push({ key: `r:${g.key}:${r.id}`, level: level + 1, row: r, parent: `g:${g.key}` });
    }
  };
  walk(groups, 1);
  return out;
}

export function Outline() {
  const m = model.value;
  const [byTag, setByTag] = useState(false);
  const [filter, setFilter] = useState("");
  // Top groups are open unless closed; corners and other subgroups are closed unless opened.
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set(["nodes"]));
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const [focusKey, setFocusKey] = useState<string | undefined>(undefined);
  const [revealed, setRevealed] = useState<string | undefined>(undefined);
  const tree = useRef<HTMLDivElement>(null);
  // The selection verbs, for the keys and the menus, while the outline is shown.
  useEffect(() => selectActions(), []);

  const corners = useMemo(() => (m ? cornersOf(m) : []), [m]);
  const groups = useMemo(
    () => (m ? groupsOf(m, { byTag, filter, corners }) : []),
    [m, byTag, filter, corners],
  );
  const isTop = (g: Group) => groups.includes(g);
  const isOpen = (g: Group) => (isTop(g) ? !closed.has(g.key) : opened.has(g.key));
  const items = flatten(groups, isOpen);
  const problems = problemsByEntity(problemList.value?.answer.problems ?? []);
  const sel = selection.value;
  const off = hidden.value;
  const newBy = marks.value;
  // Several new rows in one group: one mark on its head (review p3), a quiet edge on each row.
  const headMarks = new Map<string, string>();
  const quiet = new Set<string>();
  const markGroups = (gs: readonly Group[]) => {
    for (const g of gs) {
      const made = g.rows.filter((r) => newBy.has(r.id));
      if (made.length > 1) {
        const by = new Set(made.map((r) => newBy.get(r.id)));
        headMarks.set(g.key, `${made.length} new · ${by.size === 1 ? [...by][0] : "others"}`);
        for (const r of made) quiet.add(r.id);
      }
      if (g.groups) markGroups(g.groups);
    }
  };
  markGroups(groups);

  const setOpen = (g: Group, open: boolean) => {
    if (isTop(g)) {
      const next = new Set(closed);
      if (open) next.delete(g.key);
      else next.add(g.key);
      setClosed(next);
    } else {
      const next = new Set(opened);
      if (open) next.add(g.key);
      else next.delete(g.key);
      setOpened(next);
    }
  };

  // Show: open the groups that hold every target shown, since Show selects them all, and scroll
  // the first one's row into view.
  const shownNow = shown.value;
  useEffect(() => {
    if (!shownNow || !m) return;
    const want = new Set([...shownNow.refs, ...resolveTargets(m, shownNow.refs).ids]);
    const places = placesOf(groupsOf(m, { byTag, filter: "", corners }), want);
    const first = places[0];
    if (!first) return;
    if (filter !== "") setFilter("");
    const tops = new Set(places.flatMap((p) => p.trail.slice(0, 1).map((g) => g.key)));
    setClosed((c) => new Set([...c].filter((k) => !tops.has(k))));
    setOpened((o) => new Set([...o, ...places.flatMap((p) => p.trail.slice(1).map((g) => g.key))]));
    setFocusKey(first.key);
    setRevealed(first.key);
  }, [shownNow?.n]);
  useEffect(() => {
    if (!revealed) return;
    tree.current
      ?.querySelector<HTMLElement>(`[data-key="${CSS.escape(revealed)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [revealed, items.length]);

  if (!m) return <div class="panel-empty">No model yet.</div>;
  const current = items.find((i) => i.key === focusKey) ?? items[0];

  const focusItem = (it: Item | undefined) => {
    if (!it) return;
    setFocusKey(it.key);
    tree.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(it.key)}"]`)?.focus();
  };
  const activate = (it: Item, e: { ctrlKey: boolean; metaKey: boolean }) => {
    const mode = e.ctrlKey || e.metaKey ? "toggle" : "replace";
    if (it.row) select([it.row.id], mode);
    else if (it.group?.ref) select([it.group.ref], mode);
    else if (it.group) selectMembers(membersOf(it.group), mode === "toggle");
  };
  const onKeyDown = (e: TargetedKeyboardEvent<HTMLDivElement>) => {
    const i = items.findIndex((x) => x.key === current?.key);
    const it = items[i];
    if (!it) return;
    let handled = true;
    switch (e.key) {
      case "ArrowDown":
        focusItem(items[i + 1]);
        break;
      case "ArrowUp":
        focusItem(items[i - 1]);
        break;
      case "Home":
        focusItem(items[0]);
        break;
      case "End":
        focusItem(items[items.length - 1]);
        break;
      case "ArrowRight":
        if (it.group && !isOpen(it.group)) setOpen(it.group, true);
        else if (it.group) focusItem(items[i + 1]);
        break;
      case "ArrowLeft":
        if (it.group && isOpen(it.group)) setOpen(it.group, false);
        else focusItem(items.find((x) => x.key === it.parent));
        break;
      case "Enter":
      case " ":
        activate(it, e);
        break;
      default:
        handled = false;
    }
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const empty = groups.length === 0 && filter === "";
  return (
    <nav class="outline" aria-label="Model outline">
      <div class="tree-tools">
        <input
          type="search"
          aria-label="Filter the outline"
          placeholder="Filter: id, label, item, tag"
          value={filter}
          onInput={(e) => setFilter((e.target as HTMLInputElement).value)}
        />
        <label title="Group the outline by tag instead of by kind">
          <input type="checkbox" checked={byTag} onChange={() => setByTag(!byTag)} /> by tag
        </label>
      </div>
      {empty ? (
        <div class="outline-empty" data-testid="tree">
          <p>Bars, joints and parts appear here as you draw them.</p>
          <button type="button" class="btn" onClick={() => openCatalog()}>
            Browse the catalog <kbd>/</kbd>
          </button>
        </div>
      ) : (
        <div
          class="tree"
          role="tree"
          aria-label="Model outline"
          aria-multiselectable="true"
          data-testid="tree"
          ref={tree}
        >
          {items.map((it) => {
            const tab = it.key === current?.key ? 0 : -1;
            if (it.group) {
              const g = it.group;
              const open = isOpen(g);
              const selected = g.ref !== undefined && sel.has(g.ref);
              const count = g.rows.length + (g.groups?.reduce((n, x) => n + x.rows.length, 0) ?? 0);
              return (
                <div
                  key={it.key}
                  role="treeitem"
                  data-key={it.key}
                  {...(g.ref ? { "data-id": g.ref } : {})}
                  tabIndex={tab}
                  onKeyDown={onKeyDown}
                  aria-level={it.level}
                  aria-expanded={open}
                  aria-selected={g.ref ? selected : undefined}
                  class={`tree-head level-${it.level}${selected ? " selected" : ""}${revealed === it.key ? " revealed" : ""}`}
                  onClick={(e) => {
                    setFocusKey(it.key);
                    const toggle = e.ctrlKey || e.metaKey;
                    if ((e.target as HTMLElement).closest(".twisty")) setOpen(g, !open);
                    else if (g.ref) select([g.ref], toggle ? "toggle" : "replace");
                    else selectMembers(membersOf(g), toggle);
                  }}
                  onContextMenu={(e) => {
                    setFocusKey(it.key);
                    outlineMenu(e, g.ref ? [g.ref] : membersOf(g));
                  }}
                >
                  <span
                    class="twisty"
                    aria-hidden="true"
                    title={open ? "Close the group" : "Open the group"}
                  >
                    {open ? "▾" : "▸"}
                  </span>
                  {g.state && (
                    <span class="mark">
                      <StatusGlyph status={CORNER_STATUS[g.state]} size={12} />
                    </span>
                  )}
                  <span class="title">{g.title}</span>
                  {headMarks.has(g.key) && (
                    <span class="new-mark" data-testid="new-mark">
                      {headMarks.get(g.key)}
                    </span>
                  )}
                  {!g.ref && <span class="count">{count}</span>}
                </div>
              );
            }
            const r = it.row as Row;
            const p = problems.get(r.id);
            const by = newBy.get(r.id);
            const selected = sel.has(r.id);
            const isHidden = off.has(r.id);
            return (
              <div
                key={it.key}
                role="treeitem"
                data-key={it.key}
                data-id={r.id}
                tabIndex={tab}
                onKeyDown={onKeyDown}
                aria-level={it.level}
                aria-selected={selected}
                class={`row level-${it.level}${selected ? " selected" : ""}${r.copy ? " copy" : ""}${by ? " new" : ""}${revealed === it.key ? " revealed" : ""}${isHidden ? " hidden-row" : ""}`}
                onClick={(e) => {
                  setFocusKey(it.key);
                  select([r.id], e.ctrlKey || e.metaKey ? "toggle" : "replace");
                }}
                onContextMenu={(e) => {
                  setFocusKey(it.key);
                  outlineMenu(e, [r.id]);
                }}
                onMouseEnter={() => {
                  hover.value = { ids: [r.id], from: "tree" };
                }}
                onMouseLeave={() => {
                  if (hover.peek()?.from === "tree") hover.value = undefined;
                }}
              >
                <span class="id">{r.id}</span>
                <span class="text" title={r.title}>
                  {r.text}
                </span>
                {r.figure && <span class="figure">{r.figure}</span>}
                {isHidden && (
                  <span class="hidden-mark" data-testid="hidden-mark">
                    hidden
                  </span>
                )}
                {by && !quiet.has(r.id) && (
                  <span class="new-mark" data-testid="new-mark">
                    new · {by}
                  </span>
                )}
                {p && (
                  <span class="mark" title={STATUS[p].word}>
                    <StatusGlyph status={STATUS[p].status} size={12} />
                    <span class="sr-only">{STATUS[p].word}</span>
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </nav>
  );
}
