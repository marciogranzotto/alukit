import type { ComponentChildren, JSX } from "preact";
import { useEffect, useState } from "preact/hooks";
import { getAtRev } from "../api.ts";
import { hover, select, selection } from "../focus.ts";
import { extendHook } from "../hook.ts";
import { selectionOnly } from "../sheets/registry.ts";
import { asOf, outputPath } from "../store.ts";

/**
 * The table system every sheet is built from (docs/ux/plan.md S4.4; visual-design.md §6.1): one
 * `<table>` per sheet with a shared `colgroup`, so a column sits at the same x in every group;
 * sticky heads; rows that set `focus.hover` and light from `focus.selection`; the
 * selection-only filter; long text that expands instead of wrapping; and stale answers dimmed
 * under a progress line. Owner: S4.
 */

declare module "../hook.ts" {
  interface AlukitHook {
    /** The entity ids the pointer is over in a table row or a chip, as `focus.hover` has them. */
    hovered(): readonly string[] | undefined;
  }
}
extendHook({ hovered: () => hover.value?.ids });

/** An item's options as words, by name: `finish anodised, length 3000`. */
export const optText = (opt: Readonly<Record<string, string>>) =>
  Object.keys(opt)
    .sort()
    .map((k) => `${k} ${opt[k]}`)
    .join(", ");

/** The lock an output was derived from (§4.13's stamp), shortened; the whole hash on hover. */
export function Stamp({ lock }: { lock: string | undefined }) {
  if (lock === undefined) return null;
  return (
    <span class="stamp" title={`Derived from the lock ${lock}`}>
      Lock {lock.slice(0, 19)}…
    </span>
  );
}

/** An output's answer; `stale` while it is another revision's, variant's or date's. */
export type Fetched<T> = { rev: number; value: T; stale: boolean } | { error: string };

/**
 * An output the server computes on request, for the drawn revision: asked again when the
 * revision or the path (its variant, its date) changes. The last answer stays on screen, marked
 * stale, until the one asked for arrives, so the sheet settles on what the scene shows.
 */
export function useOutput<T>(path: string, rev: number): Fetched<T> | undefined {
  const [got, setGot] = useState<{ rev: number; path: string; value: T } | { error: string }>();
  useEffect(() => {
    let live = true;
    getAtRev<T>(path).then(
      (r) => {
        if (live) setGot({ rev: r.rev, path, value: r.body });
      },
      (e: unknown) => {
        if (live) setGot({ error: e instanceof Error ? e.message : String(e) });
      },
    );
    return () => {
      live = false;
    };
  }, [path, rev]);
  if (got === undefined || "error" in got) return got;
  return { rev: got.rev, value: got.value, stale: got.rev !== rev || got.path !== path };
}

/** An output's path in the tab's variant, with the order's date when one was picked. */
export function withAsOf(path: string): string {
  return outputPath(path, { asOf: asOf.value });
}

/** The order's date: the server's today until one is picked; clearing it goes back to today. */
export function AsOfInput({ value }: { value: string }) {
  return (
    <label class="as-of">
      as of{" "}
      <input
        type="date"
        data-testid="as-of"
        value={value}
        onChange={(e) => {
          const v = (e.currentTarget as HTMLInputElement).value;
          asOf.value = v === "" ? undefined : v;
        }}
      />
    </label>
  );
}

// ---------------------------------------------------------------------------------------------
// A sheet

/**
 * A sheet's root: it carries the sheet's test id, the revision it shows and, while the answer on
 * screen is another revision's, the stale look (dimmed) and a progress line under the tab rail.
 */
export function Sheet({
  testid,
  rev,
  stale = false,
  children,
}: {
  testid: string;
  rev?: number;
  stale?: boolean;
  children: ComponentChildren;
}) {
  return (
    <div
      class={stale ? "sheet stale" : "sheet"}
      data-testid={testid}
      {...(rev !== undefined ? { "data-rev": rev } : {})}
      aria-busy={stale}
    >
      {stale && <div class="progress" role="progressbar" aria-label="Updating" />}
      {children}
    </div>
  );
}

/**
 * The strip at the head of a sheet: what the sheet says about itself (its basis, its date), the
 * selection-only switch every table honours, and the lock stamp. The stamp stays here until the
 * revision popover (S2) carries it.
 */
export function SheetBar({
  children,
  lock,
  filter = true,
}: {
  children?: ComponentChildren;
  lock?: string | undefined;
  /** Whether the sheet's rows name entities, so selection-only can filter them. */
  filter?: boolean;
}) {
  return (
    <div class="sheet-bar">
      <div class="sheet-bar-main">{children}</div>
      {filter && (
        <label class="sel-only" title="Show only the rows of the selected entities">
          <input
            type="checkbox"
            data-testid="selection-only"
            checked={selectionOnly.value}
            onChange={(e) => {
              selectionOnly.value = (e.currentTarget as HTMLInputElement).checked;
            }}
          />{" "}
          Selection only
        </label>
      )}
      <Stamp lock={lock} />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// The table

/** A column of a sheet's grid: shared by every group of the sheet. */
export interface Col {
  id: string;
  /** The head, in sentence case. */
  head: string;
  /** The unit, written in the head after a comma and never repeated in cells. */
  unit?: string;
  /** A CSS width; none takes what the other columns leave. */
  w?: string;
  align?: "right" | "center";
}

/** The sheet's one table: its shared `colgroup` and sticky head, then its bodies. */
export function SheetTable({
  cols,
  children,
  testid,
  class: cls,
}: {
  cols: readonly Col[];
  children: ComponentChildren;
  testid?: string;
  class?: string;
}) {
  return (
    <table
      class={cls ? `sheet-table ${cls}` : "sheet-table"}
      {...(testid ? { "data-testid": testid } : {})}
    >
      <colgroup>
        {cols.map((c) => (
          <col key={c.id} data-col={c.id} {...(c.w ? { style: { width: c.w } } : {})} />
        ))}
      </colgroup>
      <thead>
        <tr>
          {cols.map((c) => (
            <th key={c.id} scope="col" class={c.align}>
              {c.head}
              {c.unit && <span class="unit">, {c.unit}</span>}
            </th>
          ))}
        </tr>
      </thead>
      {children}
    </table>
  );
}

/** Whether any of the ids is selected. */
export const anySelected = (ids: readonly string[]) => ids.some((id) => selection.value.has(id));

type RowProps = Omit<JSX.IntrinsicElements["tr"], "ref">;

/**
 * A row that is about entities `ids`: pointing at it sets `focus.hover`, it lights while any of
 * them is selected, a click selects them (Ctrl or Cmd toggles), and selection-only hides it when
 * none is. A row of no entities (`ids` absent) is never filtered; one whose `ids` is empty is
 * about nothing selectable, and selection-only hides it.
 */
export function Row({
  ids,
  children,
  class: cls,
  ...rest
}: { ids?: readonly string[] } & RowProps) {
  const on = ids !== undefined && anySelected(ids);
  if (ids !== undefined && selectionOnly.value && !on) return null;
  const classes = [cls, ids && ids.length > 0 ? "pick" : "", on ? "selected" : ""]
    .filter(Boolean)
    .join(" ");
  return (
    <tr
      {...rest}
      class={classes || undefined}
      aria-selected={ids && ids.length > 0 ? on : undefined}
      onMouseEnter={() => {
        if (ids && ids.length > 0) hover.value = { ids, from: "row" };
      }}
      onMouseLeave={() => {
        if (hover.peek()?.from === "row") hover.value = undefined;
      }}
      onClick={(e) => {
        if (!ids || ids.length === 0) return;
        // A button or a field inside the row does its own thing.
        if ((e.target as HTMLElement).closest("button, input, select, textarea, a, summary"))
          return;
        select(ids, e.ctrlKey || e.metaKey ? "toggle" : "replace");
      }}
    >
      {children}
    </tr>
  );
}

/**
 * Long text on one line, with an ellipsis; a click opens the whole of it in place, so a row never
 * wraps into a paragraph (visual-design.md §6.1). The whole text is the tooltip.
 */
export function Clip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  if (text === "") return null;
  return (
    <button
      type="button"
      class={open ? "clip open" : "clip"}
      title={text}
      aria-expanded={open}
      onClick={() => setOpen(!open)}
    >
      {text}
    </button>
  );
}
