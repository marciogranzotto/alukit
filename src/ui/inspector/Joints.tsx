import { useRef } from "preact/hooks";
import { EntityChips } from "../common/EntityChip.tsx";
import type { Model } from "../model.ts";
import { editConnection, useAsked } from "./edit-actions.ts";
import { Row } from "./Fields.tsx";
import { barJoints, jointLine } from "./joints.ts";

/**
 * A bar's joints in the inspector (docs/ux/review-editing.md M7): every connection it takes part
 * in, face joints included, in words from the bar's side ("face joint c36 (T-nut plate): with b35,
 * 2 stations"), each with Edit, which selects the joint and opens its fields, as a joint marker's
 * menu does. The bar's menu reaches the same ("Edit c36…", or "Edit a joint of b5…", which comes
 * here). Owner: the review fixes (app).
 */
export function JointRows({ m, id }: { m: Model; id: string }) {
  const joints = barJoints(m, id);
  const host = useRef<HTMLUListElement>(null);
  useAsked(id, "joints", () => {
    const first = host.current?.querySelector<HTMLElement>("button");
    first?.scrollIntoView({ block: "nearest" });
    first?.focus();
  });
  return (
    <Row label="Joints" testid="row-joints">
      {joints.length === 0 ? (
        <span class="sub">none</span>
      ) : (
        <ul class="joint-list" ref={host}>
          {joints.map((j) => (
            <li key={j.id} data-testid={`joint-${j.id}`}>
              <span>{jointLine(j)}</span> <EntityChips ids={[j.id, ...j.others]} max={4} />
              <button
                type="button"
                class="btn"
                data-testid={`joint-edit-${j.id}`}
                aria-label={`Edit ${j.id}`}
                onClick={() => editConnection(j.id)}
              >
                Edit
              </button>
            </li>
          ))}
        </ul>
      )}
    </Row>
  );
}
