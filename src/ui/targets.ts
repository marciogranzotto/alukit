import type { Ref } from "#core/problems/types.ts";
import type { V3 } from "../mesh/model.ts";
import type { Model } from "./model.ts";

/**
 * What a list of refs stands for in the scene (docs/ux/plan.md §5.3): the entities to select, the
 * points to frame, and their box. Show (src/ui/focus.ts) and every link to an entity resolve refs
 * here. Pure. Owner: S3, which completes it in S3.6:
 *
 * - an end → its bar and the end's point; a copy → itself;
 * - a connection → its bars and fasteners;
 * - an item → the bars and parts of its BOM line's sources; a supplier → its lines' sources;
 * - an open item → its scope; a check with no entity → the whole model.
 *
 * Today it does what the order tab's reason links did: a ref that names an entity of the model,
 * or a part of one (`b3.a`, `c23.f1`), resolves to that entity, once; anything else resolves to
 * nothing. No points or box yet.
 */

export interface Targets {
  ids: string[];
  points: V3[];
  box?: [V3, V3];
}

/** The kinds of document entity a ref may name, as the outline lists them. */
const ENTITY_KINDS = ["bars", "runs", "connections", "parts", "patterns", "nodes"] as const;

/** Whether an id is an entity of the model: derived (a copy too) or written. */
function isEntity(m: Model, id: string): boolean {
  return (
    id in m.derived.bars ||
    id in m.derived.parts ||
    ENTITY_KINDS.some((k) => {
      const written = m.doc[k];
      return typeof written === "object" && written !== null && id in written;
    })
  );
}

export function resolveTargets(m: Model, refs: readonly Ref[]): Targets {
  const ids = [...new Set(refs.map((r) => r.split(".")[0] as string))].filter((id) =>
    isEntity(m, id),
  );
  return { ids, points: [] };
}
