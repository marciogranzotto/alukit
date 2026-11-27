import { compareIds } from "#core/ids.ts";
import type { Model } from "../model.ts";
import type { Command } from "./remove.ts";
import { copyOf, isObject, written } from "./words.ts";

/**
 * Replacing a bar's profile (docs/ux/plan.md S5.3, F5): which bars "all like it" are, and the
 * batch that gives them a new item, as one step. Pure. Owner: S5.
 */

/** Options as one comparable string: `finish=anodised`. */
function optKey(opt: Readonly<Record<string, string>> | undefined): string {
  return Object.keys(opt ?? {})
    .sort()
    .map((k) => `${k}=${opt?.[k]}`)
    .join(",");
}

/**
 * The document's bars like this one: the same item with the same options as derived, which is
 * one line of the cut list and the BOM. A pattern copy stands for its template, which is what a
 * command changes. In id order.
 */
export function barsLike(m: Model, id: string): string[] {
  const me = m.derived.bars[id];
  if (!me) return [];
  const key = `${me.item}|${optKey(me.opt)}`;
  const out = new Set<string>();
  for (const [bid, b] of Object.entries(m.derived.bars)) {
    if (`${b.item}|${optKey(b.opt)}` !== key) continue;
    const own = copyOf(bid)?.template ?? bid;
    if (isObject(written(m, own))) out.add(own);
  }
  return [...out].sort(compareIds);
}

/**
 * The batch that makes these bars (or parts) the given item, one `setBar` (`setPart`) each: the
 * options picked are written, a value of `""` (the project's default) and every option the bar had
 * that the new item does not take are removed.
 */
export function replaceBatch(
  m: Model,
  ids: readonly string[],
  item: string,
  picked: Readonly<Record<string, string>>,
): Command[] {
  return ids.map((id) => {
    const w = written(m, id);
    const was = isObject(w) && isObject(w.opt) ? w.opt : {};
    const opt: Record<string, string | null> = {};
    for (const k of Object.keys(was)) opt[k] = null;
    for (const [k, v] of Object.entries(picked)) opt[k] = v === "" ? null : v;
    const cmd = id.startsWith("p") ? "setPart" : "setBar";
    return {
      cmd,
      args: { id, set: { item, ...(Object.keys(opt).length > 0 ? { opt } : {}) } },
    };
  });
}

/**
 * The value an option field shows for a bar: the written value; `""` when it is left to the
 * project's default (which gives one); undefined when nothing chooses one.
 */
export function chosenOption(m: Model, id: string, name: string): string | undefined {
  const w = written(m, id);
  const own = isObject(w) && isObject(w.opt) ? w.opt[name] : undefined;
  if (typeof own === "string") return own;
  const bar = isObject(m.defaults.bar) ? m.defaults.bar : {};
  const d = isObject(bar.opt) ? bar.opt[name] : undefined;
  return typeof d === "string" && !id.startsWith("p") ? "" : undefined;
}
