import { model } from "../store.ts";
import { activeSheet, openSheet, sheets, sheetsOpen } from "./registry.ts";

/**
 * The sheets' container (design §8's drawer): a tab per registered sheet (registry.ts) and the
 * active sheet's body. Clicking the active tab collapses it; any other opens that sheet. It knows
 * no sheet by name. Owner: S2.
 */
export function Sheets() {
  const m = model.value;
  const open = sheetsOpen.value;
  const active = activeSheet.value;
  const list = sheets.value;
  const shown = list.find((s) => s.id === active);
  return (
    <section class={`drawer${open ? " open" : ""}`}>
      <div class="tabs" role="tablist">
        {list.map((s) => (
          <button
            type="button"
            role="tab"
            class="tab"
            key={s.id}
            aria-selected={open && active === s.id}
            onClick={() => {
              if (open && active === s.id) sheetsOpen.value = false;
              else openSheet(s.id);
            }}
          >
            {s.title}
            {s.badge?.()}
          </button>
        ))}
      </div>
      {open && m && shown && (
        <div class="drawer-body">
          <shown.Body m={m} />
        </div>
      )}
    </section>
  );
}
