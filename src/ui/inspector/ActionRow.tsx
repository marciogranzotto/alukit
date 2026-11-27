import {
  type ActionContext,
  type ActionGroup,
  actions,
  actionsFor,
  runAction,
  titleOf,
} from "../actions/registry.ts";
import type { Model } from "../model.ts";

/**
 * The inspector's action row (docs/ux/editing-audit.md E-UX-1, e0 9): the registry's actions on
 * the selection, of the groups given, as buttons, so each has a pointer path beside the menu and
 * its keys; one that cannot run is greyed and says why. Actions the inspector already shows a
 * button for (Delete, Join, Replace) are left out. Owner: E4.
 */

/** Actions with a button of their own in the inspector. */
const OWN = new Set(["delete", "join-end", "replace"]);

export function ActionRow({
  m,
  ids,
  groups,
}: {
  m: Model;
  ids: readonly string[];
  groups: readonly ActionGroup[];
}) {
  actions.value; // read again when actions are registered
  const c: ActionContext = { m, selection: new Set(ids), from: "button" };
  const list = actionsFor(c).filter(
    (x) => groups.includes(x.action.group) && !OWN.has(x.action.id),
  );
  if (list.length === 0) return null;
  return (
    <div class="insp-actions" data-testid="insp-actions">
      {list.map(({ action, enabled }) => (
        <button
          key={action.id}
          type="button"
          class="btn"
          data-testid={`action-${action.id}`}
          disabled={enabled !== true}
          title={enabled === true ? action.help : enabled}
          onClick={() => runAction(action.id, c)}
        >
          {titleOf(action, c)}
        </button>
      ))}
    </div>
  );
}
