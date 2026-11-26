import { z } from "zod";
import { type Derived, derive } from "../derive/derive.ts";
import type { ItemSource } from "../items.ts";
import { lockItems } from "../lock/source.ts";
import { parseProject } from "../project/parse.ts";
import { projectItems } from "../project-items/source.ts";
import { getEntity, KIND_NOUN, type Kind, kindOf, mergePatch, nextId, withEntity } from "./doc.ts";
import {
  type CommandContext,
  type CommandEnv,
  type CommandError,
  done,
  type Outcome,
  type RawDoc,
  refuse,
  type State,
} from "./types.ts";
import { checkEntity } from "./validate.ts";

/** Building blocks shared by the commands. */

export function makeContext(state: State, env: CommandEnv): CommandContext {
  let locked: ItemSource | undefined;
  let items: ItemSource | undefined;
  let derived: Derived | undefined;
  const base = () => {
    locked ??= lockItems(state.lock);
    return locked;
  };
  return {
    state,
    env,
    items() {
      // The lock's items and the document's own project items (§4.8), as derive sees them.
      items ??= projectItems(base(), parseProject(state.doc).doc).source;
      return items;
    },
    derived() {
      derived ??= derive(state.doc, base());
      return derived;
    },
  };
}

export function failed(errors: CommandError[]): Outcome {
  return { ok: false, errors };
}

/** Refuses unless `id` names an entity of one of `kinds`. */
export function requireEntity(doc: RawDoc, id: string, ...kinds: Kind[]): CommandError[] {
  const kind = kindOf(id);
  if (kind === undefined || (kinds.length > 0 && !kinds.includes(kind))) {
    const want = kinds.map((k) => KIND_NOUN[k]).join(" or ");
    return [
      {
        code: "args",
        entity: id,
        message: `"${id}" is not ${want ? `a ${want} id` : "an entity id"}`,
      },
    ];
  }
  if (getEntity(doc, id) === undefined) {
    return [{ code: "missing", entity: id, message: `there is no ${KIND_NOUN[kind]} ${id}` }];
  }
  return [];
}

/** The state with a new document, the lock as it was. */
export function withDoc(ctx: CommandContext, doc: RawDoc): State {
  return { doc, lock: ctx.state.lock };
}

/** Creates an entity with the next id of `prefix`, checked. */
export function create(ctx: CommandContext, prefix: string, value: unknown): Outcome {
  const { id, doc } = nextId(ctx.state.doc, prefix);
  const next = withEntity(doc, id, value);
  const errors = checkEntity(ctx, next, id);
  if (errors.length > 0) return failed(errors);
  return done(withDoc(ctx, next), { created: [id] });
}

/** Replaces an entity's value, checked. */
export function replace(
  ctx: CommandContext,
  id: string,
  value: unknown,
  doc = ctx.state.doc,
): Outcome {
  const next = withEntity(doc, id, value);
  const errors = checkEntity(ctx, next, id);
  if (errors.length > 0) return failed(errors);
  return done(withDoc(ctx, next), { changed: [id] });
}

/** Applies a `set` merge patch (null deletes a field) to an entity of one of `kinds`. */
export function patch(
  ctx: CommandContext,
  id: string,
  set: Record<string, unknown>,
  ...kinds: Kind[]
): Outcome {
  const missing = requireEntity(ctx.state.doc, id, ...kinds);
  if (missing.length > 0) return failed(missing);
  const value = mergePatch(getEntity(ctx.state.doc, id), set);
  return replace(ctx, id, value);
}

export const SetArgs = z.strictObject({
  id: z.string().describe("the entity to change"),
  set: z
    .record(z.string(), z.unknown())
    .describe("fields to change, as a JSON merge patch (RFC 7396): null removes a field"),
});

export { refuse };
