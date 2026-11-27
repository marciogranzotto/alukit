import { parseTyped, typedNumber } from "../tools/typed.ts";
import type { Edit } from "./rows.tsx";

/**
 * What a connection's and a part's fields send (docs/ux/editing-audit.md E5.2, E5.4): each field
 * one merge patch, as `alukit do setConnection` (or `setPart`) takes it, or why the value typed
 * makes none, in which case nothing is sent. Lengths are typed as every length is (D-UX-17):
 * units and expressions over the params, written as typed when they read one. Pure. Owner: E5.
 */

type O = Record<string, unknown>;

const isObject = (x: unknown): x is O => typeof x === "object" && x !== null && !Array.isArray(x);

const WHOLE = /^\d+$/;

/** One step of one merge patch. */
function step(cmd: "setConnection" | "setPart", id: string, set: O): Edit {
  return { commands: [{ cmd, args: { id, set } }] };
}

/** One `setConnection`. */
export function connectionSet(id: string, set: O): Edit {
  return step("setConnection", id, set);
}

/** A quantity: a whole number, 1 or more; empty leaves it to the default. */
export function quantityEdit(id: string, text: string): Edit {
  const t = text.trim();
  if (t === "") return connectionSet(id, { qty: null });
  if (!WHOLE.test(t) || Number(t) < 1) return { why: "the quantity is a whole number, 1 or more" };
  return connectionSet(id, { qty: Number(t) });
}

/** A length field of a connection (a splice's gap, a butt's spacer): empty removes it. */
export function lengthEdit(
  id: string,
  field: "gap_mm" | "spacer_mm",
  text: string,
  params: Readonly<Record<string, number>>,
  label: string,
): Edit {
  if (text.trim() === "") return connectionSet(id, { [field]: null });
  const n = typedNumber(text, params);
  if ("why" in n) return { why: `the ${label}: ${n.why}` };
  return connectionSet(id, { [field]: n.written });
}

/**
 * A butt's through end (§4.5) as a select's value: "" when it is left to the corner (`cover` when
 * an end meets the through bar's end there), a mode at the corner, or an end named with its mode.
 */
export function throughEndCode(v: unknown): string {
  if (v === undefined) return "";
  if (typeof v === "string") return v;
  if (isObject(v) && typeof v.end === "string" && typeof v.mode === "string") {
    return `${v.end}:${v.mode}`;
  }
  return "?";
}

/** The through end's choices, in the order the select lists them. */
export const THROUGH_END_CHOICES: readonly { value: string; label: string }[] = [
  { value: "", label: "at a corner, covers the ends (the default)" },
  { value: "cover", label: "at a corner, covers the ends" },
  { value: "node", label: "at a corner, square at its point" },
  { value: "none", label: "not this butt's: left to its own" },
  { value: "a:cover", label: "end a covers the ends" },
  { value: "a:node", label: "end a square at its point" },
  { value: "b:cover", label: "end b covers the ends" },
  { value: "b:node", label: "end b square at its point" },
];

/** A through end chosen, as one `setConnection`. */
export function throughEndEdit(id: string, code: string): Edit {
  if (code === "") return connectionSet(id, { through_end: null });
  if (code === "cover" || code === "node" || code === "none") {
    return connectionSet(id, { through_end: code });
  }
  const named = /^([ab]):(cover|node)$/.exec(code);
  if (!named) return { why: `the through end: ${code} is none of the choices` };
  return connectionSet(id, { through_end: { end: named[1], mode: named[2] } });
}

/**
 * The face a cross-hole row shows for one butting end (F12's `hole_faces`): its one face, "" when
 * AluKit chooses, or `-list` when the end names a face per hole, which the field shows in words.
 */
export function holeFaceCode(written: unknown, end: string): string {
  const v = isObject(written) ? written[end] : undefined;
  if (typeof v === "string") return v;
  return Array.isArray(v) ? "-list" : "";
}

/**
 * One end's cross-hole face as one `setConnection`: a face for every hole in that bar's side at
 * that end, merged beside the other ends'; "" gives the choice back to AluKit, and taking the
 * last end's leaves no `hole_faces` behind.
 */
export function holeFacesEdit(id: string, written: unknown, end: string, face: string): Edit {
  if (face !== "") return connectionSet(id, { hole_faces: { [end]: face } });
  const others = Object.keys(isObject(written) ? written : {}).filter((k) => k !== end);
  return connectionSet(id, { hole_faces: others.length === 0 ? null : { [end]: null } });
}

/** A station's face or groove, as its merge patch: a station is on one or the other, or neither. */
export function stationFacePatch(v: string): O {
  if (v === "") return { face: null, groove: null };
  return v.includes(".") ? { groove: v, face: null } : { face: v, groove: null };
}

/** A station's own patch (a part's `on`, a pivot's `base`) as one step. */
export function stationEdit(
  cmd: "setPart" | "setConnection",
  id: string,
  key: "on" | "base",
  patch: O,
): Edit {
  return step(cmd, id, { [key]: patch });
}

/** A station's distance along its bar, typed as every length is. */
export function stationAtEdit(
  cmd: "setPart" | "setConnection",
  id: string,
  key: "on" | "base",
  text: string,
  params: Readonly<Record<string, number>>,
): Edit {
  const n = typedNumber(text, params);
  if ("why" in n) return { why: `the distance: ${n.why}` };
  return stationEdit(cmd, id, key, { at_mm: n.written });
}

/** A station's offset `u, v` (§4.3): across the face, then out from it; empty removes it. */
export function offsetEdit(
  cmd: "setPart" | "setConnection",
  id: string,
  key: "on" | "base",
  text: string,
  params: Readonly<Record<string, number>>,
): Edit {
  const typed = parseTyped(text, params);
  if (typed.kind === "empty") return stationEdit(cmd, id, key, { off_mm: null });
  if (typed.kind === "error") return { why: `the offset: ${typed.why}` };
  if (typed.kind !== "list" || typed.items.length !== 2) {
    return { why: "the offset is two lengths, u across the face and v out from it: 5, 0" };
  }
  return stationEdit(cmd, id, key, { off_mm: typed.items.map((x) => x.written) });
}
