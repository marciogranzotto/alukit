import { useState } from "preact/hooks";
import { hover, select, selection } from "../focus.ts";

/**
 * An entity named in a table, a problem or a form (docs/ux/visual-design.md §6.1): its id as a
 * chip. A click selects it (Ctrl or Cmd adds it to the selection or takes it out), and it is lit
 * while selected, in the selection's amber. Pointing at it, or focusing it, sets `focus.hover`,
 * which the 3D view tints (S3.2). Owner: S4.
 */
export function EntityChip({ id }: { id: string }) {
  const on = selection.value.has(id);
  const enter = () => {
    hover.value = { ids: [id], from: "chip" };
  };
  const leave = () => {
    if (hover.peek()?.from === "chip") hover.value = undefined;
  };
  return (
    <button
      type="button"
      class={on ? "chip selected" : "chip"}
      aria-pressed={on}
      onClick={(e) => {
        // A row's own click selects the row's entities; the chip selects only itself.
        e.stopPropagation();
        select([id], e.ctrlKey || e.metaKey ? "toggle" : "replace");
      }}
      onMouseEnter={enter}
      onMouseLeave={leave}
      onFocus={enter}
      onBlur={leave}
    >
      {id}
    </button>
  );
}

/**
 * A list of entities' chips: at most `max`, then a `+N` chip that opens the rest in place. A
 * selected entity is never hidden.
 */
export function EntityChips({ ids, max = 4 }: { ids: readonly string[]; max?: number }) {
  const [open, setOpen] = useState(false);
  const hiddenSelected = ids.slice(max).some((id) => selection.value.has(id));
  const all = open || hiddenSelected || ids.length <= max;
  const shown = all ? ids : ids.slice(0, max);
  return (
    <span class="chips">
      {shown.map((id) => (
        <EntityChip key={id} id={id} />
      ))}
      {!all && (
        <button
          type="button"
          class="chip more"
          title={`${ids.length - max} more: ${ids.slice(max).join(", ")}`}
          onClick={(e) => {
            e.stopPropagation();
            setOpen(true);
          }}
        >
          +{ids.length - max}
        </button>
      )}
    </span>
  );
}
