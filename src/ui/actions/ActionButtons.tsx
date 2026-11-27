import { selection } from "../focus.ts";
import type { Model } from "../model.ts";
import { busy, summary, tell } from "../store.ts";
import { activeTool, gesture } from "../tools/state.ts";
import {
  type ActionContext,
  type ActionGroup,
  actionsFor,
  keyCaps,
  runAction,
  titleOf,
} from "./registry.ts";

/**
 * The selection header's buttons (docs/ux/editing-audit.md E-UX-1, E2.1): the action registry's
 * edits on the selection, the groups that change the document as a whole (`edit`: Delete;
 * `transform`: what moves and copies), each as its title and first key, greyed with why it cannot
 * run, in the order they registered. Each stream's verbs appear here as it registers them; a
 * bar's, a joint's or a part's own actions belong to the inspector's action row (E4), the select
 * and view verbs to the menu and the keys. While the project is read-only, or a step is on its
 * way, they are disabled, as an edit button always was. Owner: E2.
 */

const HEADER: ReadonlySet<ActionGroup> = new Set<ActionGroup>(["edit", "transform"]);

export function ActionButtons({ m }: { m: Model }) {
  // An action's `when` reads its state with `peek` (it runs from key handlers too): the buttons
  // follow what those read, besides the model and the selection, by reading it here: the tool and
  // its gesture.
  void activeTool.value;
  void gesture.value;
  const ctx: ActionContext = { m, selection: selection.value, from: "button" };
  const list = actionsFor(ctx).filter(({ action }) => HEADER.has(action.group));
  const locked = summary.value?.status.readOnly === true || busy.value;
  return (
    <>
      {list.map(({ action, enabled }) => {
        const title = titleOf(action, ctx);
        const first = action.keys?.[0];
        const why = enabled === true ? undefined : enabled;
        return (
          <button
            key={action.id}
            type="button"
            class="btn"
            data-action={action.id}
            disabled={locked}
            aria-disabled={why ? "true" : undefined}
            title={why ?? (action.help ? `${action.help}` : title)}
            onClick={() => {
              const ran = runAction(action.id, ctx);
              if (ran !== true) tell(`${title}: ${ran}`, true);
            }}
          >
            {title}
            {first && <kbd>{keyCaps(first).join("+")}</kbd>}
          </button>
        );
      })}
    </>
  );
}
