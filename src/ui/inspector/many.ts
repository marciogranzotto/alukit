import type { Model } from "../model.ts";
import type { Written } from "../tools/typed.ts";
import type { Command } from "./remove.ts";
import { isObject, written } from "./words.ts";

/**
 * Fields for several selected (docs/ux/editing-audit.md E4.5, E-UX-15; Revit's "varies"): each
 * shows the value every entity shares, or that it varies, and a change is one step, one patch per
 * entity, as `alukit do` would send it; the tags are one `tag` command over all of them. Pure, so
 * the unit tests read it. Owner: E4.
 */

/** The value every entry shares, or that they vary. */
export function shared<T>(values: readonly T[]): { value: T } | { varies: true } {
  if (values.length === 0) return { varies: true };
  const first = values[0] as T;
  return values.every((v) => JSON.stringify(v) === JSON.stringify(first))
    ? { value: first }
    : { varies: true };
}

/** The selection as bars of the document, when it is only that; else undefined. */
export function manyBars(m: Model, ids: readonly string[]): string[] | undefined {
  const bars = ids.filter(
    (id) => !id.includes("@") && /^b\d+$/.test(id) && isObject(written(m, id)),
  );
  return bars.length === ids.length && bars.length > 0 ? [...ids] : undefined;
}

/** The selection's document entities that take a label and tags (no pattern copies). */
export function labelled(m: Model, ids: readonly string[]): string[] | undefined {
  const own = ids.filter((id) => !id.includes("@") && isObject(written(m, id)));
  return own.length === ids.length && own.length > 0 ? [...ids] : undefined;
}

const setBar = (id: string, set: Record<string, unknown>): Command => ({
  cmd: "setBar",
  args: { id, set },
});

/** One option for each bar: a value, or `""` for the project's default (removed). */
export function optionBatch(ids: readonly string[], name: string, value: string): Command[] {
  return ids.map((id) => setBar(id, { opt: { [name]: value === "" ? null : value } }));
}

/** The anchor for each bar; the centre, the default, is removed. */
export function anchorBatch(ids: readonly string[], anchor: string): Command[] {
  return ids.map((id) => setBar(id, { anchor: anchor === "c" ? null : anchor }));
}

/** The roll for each bar, a param written as typed; nought is removed. */
export function rollBatch(ids: readonly string[], roll: Written): Command[] {
  return ids.map((id) => setBar(id, { roll_deg: roll === 0 ? null : roll }));
}

/** The label for each entity; an empty one is removed. */
export function labelBatch(ids: readonly string[], label: string): Command[] {
  const l = label.trim();
  return ids.map((id) => ({ cmd: "label", args: { id, label: l === "" ? null : l } }));
}

/** The tags every entity carries (`all`), and those only some do (`some`), each sorted. */
export function tagsOf(m: Model, ids: readonly string[]): { all: string[]; some: string[] } {
  const lists = ids.map((id) => {
    const w = written(m, id);
    return isObject(w) && Array.isArray(w.tags) ? (w.tags as string[]) : [];
  });
  const any = [...new Set(lists.flat())].sort();
  const all = any.filter((t) => lists.every((l) => l.includes(t)));
  return { all, some: any.filter((t) => !all.includes(t)) };
}

/**
 * The tags typed for all of them, against the ones they all share: a new tag is added to every
 * one, a shared tag left out is removed from every one, and a tag only some carry is left as it
 * is. One `tag` command, or none when nothing changes.
 */
export function tagBatch(m: Model, ids: readonly string[], text: string): Command[] {
  const next = [
    ...new Set(
      text
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    ),
  ];
  const { all } = tagsOf(m, ids);
  const add = next.filter((t) => !all.includes(t));
  const remove = all.filter((t) => !next.includes(t));
  if (add.length + remove.length === 0) return [];
  return [
    {
      cmd: "tag",
      args: {
        ids: [...ids],
        ...(add.length > 0 ? { add } : {}),
        ...(remove.length > 0 ? { remove } : {}),
      },
    },
  ];
}
