import type { ComponentChildren } from "preact";
import { activeTool } from "../tools.ts";

/**
 * An empty or idle state (docs/ux/visual-design.md §6.3): what is missing, why it is fine, and
 * the next step as a button. Never a blank pane, never an instruction alone. Owner: S4.
 */
export function EmptyState({
  title,
  glyph,
  children,
  actions,
  testid,
}: {
  title: string;
  /** A mark drawn above the title (a status glyph, say). */
  glyph?: ComponentChildren;
  children?: ComponentChildren;
  actions?: ComponentChildren;
  testid?: string;
}) {
  return (
    <div class="empty" {...(testid ? { "data-testid": testid } : {})}>
      {glyph && <div class="empty-glyph">{glyph}</div>}
      <p class="empty-title">{title}</p>
      {children && <p class="empty-text">{children}</p>}
      {actions && <div class="empty-actions">{actions}</div>}
    </div>
  );
}

/** The primary action of an empty cut list: arms the draw tool. */
export function DrawABar() {
  return (
    <button
      type="button"
      class="btn primary"
      onClick={() => {
        activeTool.value = "draw";
      }}
    >
      Draw a bar <kbd>B</kbd>
    </button>
  );
}

/**
 * Opens the catalog. The left column's Catalog tab is the documented seam (`left-catalog`, which
 * the app's layout keeps on whatever element opens the catalog, docs/ux/plan.md §5.3).
 */
export function OpenCatalog() {
  return (
    <button
      type="button"
      class="btn"
      onClick={() => document.querySelector<HTMLElement>('[data-testid="left-catalog"]')?.click()}
    >
      Open the catalog
    </button>
  );
}
