import type { Connection } from "../project/schema.ts";
import type { Ctx } from "./context.ts";

/**
 * What is context, not part of the build (gap X11, docs/notes/x11.md).
 *
 * - **A member** is context when it says so: a bar or a placed part with `context: true` (a wall,
 *   a floor, a bench the frame stands beside). A pattern's copy carries its template's field. A
 *   part on a context bar's station is not context unless it says so: a bracket screwed to an
 *   existing beam is bought.
 * - **A connection** is context when every member it joins is: a butt's through bar (or the bar
 *   whose end it names, or its through body marked context), its butting ends' bars and its stack;
 *   a miter's or a splice's two ends; a pivot's base and its ends; a face connection's layers, a
 *   run standing for all its bars. It is the context's own joint (the existing bench's splice):
 *   what it brings is not counted and its machining is not listed. A connection with a built
 *   member is the build's, whatever else it joins.
 *
 * The ids are those derive works with after pattern expansion: `b7`, `p3@1`, `c12@2`.
 */
export function contextIds(ctx: Ctx): Set<string> {
  const out = new Set<string>();
  const marked = (spec: object) => "context" in spec && spec.context === true;
  for (const [id, e] of ctx.bars) if (marked(e.spec)) out.add(id);
  for (const [id, e] of ctx.parts) if (marked(e.spec)) out.add(id);
  const isContext = (ref: string | boolean): boolean => {
    if (typeof ref === "boolean") return ref;
    const id = ref.replace(/\.[ab]$/, "");
    const run = ctx.doc.runs[id];
    if (run !== undefined) {
      const bars = Array.isArray(run) ? run : run.bars;
      return bars.every((b) => out.has(b));
    }
    return out.has(id);
  };
  for (const [id, e] of ctx.conns) {
    const members = membersOf(e.spec);
    if (members.length > 0 && members.every(isContext)) out.add(id);
  }
  return out;
}

/**
 * The members a connection joins, as references (a bar, a bar's end, a run, a part), or, for a
 * butt's through body, whether it is context.
 */
function membersOf(c: Connection): (string | boolean)[] {
  switch (c.type) {
    case "butt":
      return [
        typeof c.through === "string" ? c.through : c.through.context === true,
        ...c.ends,
        ...(c.stack ?? []),
      ];
    case "miter":
    case "splice":
      return [...c.ends];
    case "pivot":
      return [c.base.bar, ...c.ends];
    case "face":
      return [...c.bars];
  }
}
