import { select, selection } from "../focus.ts";

/**
 * An entity named in a table, a problem or a form: its id, which selects it (Ctrl or Cmd adds it
 * to the selection or takes it out), lit while it is selected. Owner: S4, which makes it hover in
 * the 3D view, show the entity's label and collapse long lists to +N (S4.3).
 */
export function EntityChip({ id }: { id: string }) {
  return (
    <button
      type="button"
      class={`link${selection.value.has(id) ? " selected" : ""}`}
      onClick={(e) => select([id], e.ctrlKey || e.metaKey ? "toggle" : "replace")}
    >
      {id}
    </button>
  );
}

/** A list of entities' chips. */
export function EntityChips({ ids }: { ids: readonly string[] }) {
  return (
    <span class="sources">
      {ids.map((id) => (
        <EntityChip key={id} id={id} />
      ))}
    </span>
  );
}
