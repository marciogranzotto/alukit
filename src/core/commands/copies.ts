import { isObject, MAP_KINDS } from "./doc.ts";
import type { RawDoc } from "./types.ts";
import { idList } from "./words.ts";

/**
 * What a copy carries (design §6, *2.3*; the editing review's m2;
 * docs/ux/review-last-items-decisions.md 1–3). A copy that stands as an entity of its own, which
 * `array` (the app's Duplicate and Paste), `mirror` and `explodePattern` make, keeps every field
 * of its original but its label, which it numbers: the rail copied from "top rail, front" is
 * "top rail, front (2)", as an independent copy gets a name of its own in CAD tools (Fusion's
 * Paste New, Blender's ".001"), while a live pattern's copies are instances, named by their ids
 * (`b13@1`) as SolidWorks numbers instances `<2>`. It keeps its tags, which have no kind: a tag
 * that places the original ("top") and one that says what it is ("leg", which a check counts)
 * look alike, so the copy says the tags it carries (`tagged`), and a person drops one in one step.
 */

/** A copy's number at the end of a label: "top rail, front (2)". */
const NUMBERED = /^(.*\S) \((\d+)\)$/;

/** Every label the document's entities carry. */
function labels(doc: RawDoc): Set<string> {
  const out = new Set<string>();
  for (const kind of MAP_KINDS) {
    const map = doc[kind];
    if (!isObject(map)) continue;
    for (const v of Object.values(map)) {
      if (isObject(v) && typeof v.label === "string") out.add(v.label);
    }
  }
  return out;
}

/**
 * The label of a copy of an entity labelled `label`, in `doc`: the label's name (without a
 * copy's number) and the lowest number from 2 that no entity's label has with that name, the
 * original counting as the first. A number that is part of the name ("rail 4040") stays the name's.
 */
export function copyLabel(doc: RawDoc, label: string): string {
  const name = NUMBERED.exec(label)?.[1] ?? label;
  const taken = labels(doc);
  let n = 2;
  while (taken.has(`${name} (${n})`)) n++;
  return `${name} (${n})`;
}

/** A copy's value: its original's, its label numbered against the document it joins. */
export function asCopy(doc: RawDoc, value: unknown): unknown {
  if (!isObject(value) || typeof value.label !== "string") return value;
  return { ...value, label: copyLabel(doc, value.label) };
}

/** The tags an entity's value carries. */
export function tagsOf(value: unknown): string[] {
  if (!isObject(value) || !Array.isArray(value.tags)) return [];
  return value.tags.filter((t): t is string => typeof t === "string");
}

/**
 * The tags the copies of a step carry, in words: "tagged top", "tagged top and post"; empty when
 * they carry none. `tagged` is a command's answer field: each copy's tags, by its id.
 */
export function taggedWords(
  tagged: Readonly<Record<string, readonly string[]>> | undefined,
): string {
  const tags = [...new Set(Object.values(tagged ?? {}).flat())];
  return tags.length > 0 ? `tagged ${idList(tags)}` : "";
}
