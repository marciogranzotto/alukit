import { z } from "zod";
import { type Derived, derive } from "../derive/derive.ts";
import type { ItemSource } from "../items.ts";
import { pinLock } from "../lock/pin.ts";
import { documentRefs, lockCovers } from "../lock/refs.ts";
import { lockItems } from "../lock/source.ts";
import { parseProject } from "../project/parse.ts";
import { projectItems } from "../project-items/source.ts";
import { getEntity, KIND_NOUN, type Kind, kindOf, mergePatch, nextId, withEntity } from "./doc.ts";
import {
  type CommandContext,
  type CommandDef,
  type CommandEnv,
  type CommandError,
  type Did,
  done,
  type Outcome,
  type RawDoc,
  refuse,
  type State,
} from "./types.ts";
import { checkEntity, schemaErrors } from "./validate.ts";

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

/**
 * Pins what the document newly names, when the live catalogs are open (§4.13): after each
 * command, so the next one, and derive, see it.
 */
export function pinNew(state: State, env: CommandEnv): State {
  if (!env.live) return state;
  const refs = documentRefs(state.doc);
  if (lockCovers(state.lock, refs)) return state;
  return { doc: state.doc, lock: pinLock(env.live, refs, state.lock, { kind: "add" }).lock };
}

/** A command's definition and its arguments as written, run inside another command. */
export interface Step {
  /** Any command: its arguments are checked by its own schema before it runs. */
  def: CommandDef<unknown>;
  args: unknown;
}

/**
 * Runs commands inside one command, in order, each on the state the one before it left and
 * pinning what it names, as a batch does: a command made of others (`addFrame`) keeps their
 * rules rather than repeating them, and stays one step. The first refusal refuses it all.
 */
export function runSteps(
  state: State,
  env: CommandEnv,
  steps: readonly Step[],
): { ok: true; state: State; did: Did[] } | { ok: false; errors: CommandError[] } {
  const did: Did[] = [];
  let at = state;
  for (const { def, args } of steps) {
    const parsed = def.args.safeParse(args);
    if (!parsed.success) {
      const errors = schemaErrors(def.args, args).map((e) => ({ ...e, code: "args" }));
      return { ok: false, errors };
    }
    const out = def.apply(makeContext(at, env), parsed.data);
    if (!out.ok) return out;
    at = pinNew(out.state, env);
    did.push({ ...out.effect, ...(out.info !== undefined ? { info: out.info } : {}) });
  }
  return { ok: true, state: at, did };
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
