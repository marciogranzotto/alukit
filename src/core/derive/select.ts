/**
 * `alukit derive <dir> --json --select <paths>` (design §7.3): the derived model cut down to the
 * members a report builder asks for, each kept where it sits, so the answer is still
 * `alukit.derived/1`, with fewer members. `schema` and `variant` are always kept.
 *
 * A path is dotted from the top: `bars.b3`, `bars.b3.cut_mm`, `params`. `*` stands for every
 * member of an object, or every element of a list (`bars.*.cut_mm`, `pieces.*.item`); a list is
 * otherwise taken whole. Paths that meet merge (`bars.*.cut_mm,bars.b3` gives every bar's cut
 * length and all of b3). Members come out in the derived model's own order, whatever the order
 * of the paths. A named member the model does not have is reported, not skipped silently.
 */

type Selection = true | Map<string, Selection>;

/** A selection's tree from its paths; a malformed path is the caller's usage error. */
export function parsePaths(text: string): { paths: string[][] } | { error: string } {
  const paths = text.split(",").map((p) => p.trim());
  if (paths.some((p) => p === "")) return { error: "--select takes paths separated by commas" };
  const split = paths.map((p) => p.split("."));
  const bad = split.find((segs) => segs.some((s) => s === ""));
  if (bad) return { error: `"${bad.join(".")}" is not a path: members are joined by dots` };
  return { paths: split };
}

function union(a: Selection | undefined, b: Selection | undefined): Selection | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  if (a === true || b === true) return true;
  const out = new Map(a);
  for (const [k, v] of b) out.set(k, union(out.get(k), v) as Selection);
  return out;
}

function tree(paths: readonly (readonly string[])[]): Selection {
  let root: Selection = new Map();
  for (const segs of paths) {
    let sel: Selection = true;
    for (const s of [...segs].reverse()) sel = new Map([[s, sel]]);
    root = union(root, sel) as Selection;
  }
  return root;
}

const isObject = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);

const under = (at: string, k: string) => (at === "" ? k : `${at}.${k}`);

function apply(src: unknown, sel: Selection, at: string, missing: string[]): unknown {
  if (sel === true) return src;
  if (Array.isArray(src)) {
    const each = sel.get("*");
    for (const k of sel.keys()) {
      if (k !== "*") missing.push(`${under(at, k)} (${at} is a list: whole, or with *)`);
    }
    return each === undefined ? [] : src.map((x) => apply(x, each, under(at, "*"), missing));
  }
  if (!isObject(src)) {
    for (const k of sel.keys()) missing.push(`${under(at, k)} (${at} is a value)`);
    return src;
  }
  const every = sel.get("*");
  for (const k of sel.keys()) if (k !== "*" && !Object.hasOwn(src, k)) missing.push(under(at, k));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(src)) {
    const s = union(every, sel.get(k));
    if (s !== undefined) out[k] = apply(v, s, under(at, k), missing);
  }
  return out;
}

/** The members of `derived` the paths name, with its `schema` and `variant`; or what is not there. */
export function selectDerived(
  derived: Readonly<Record<string, unknown>>,
  paths: readonly (readonly string[])[],
): { ok: true; value: Record<string, unknown> } | { ok: false; missing: string[] } {
  const missing: string[] = [];
  const picked = apply(derived, tree(paths), "", missing) as Record<string, unknown>;
  if (missing.length > 0) return { ok: false, missing };
  const value: Record<string, unknown> = {};
  for (const k of ["schema", "variant"]) if (Object.hasOwn(derived, k)) value[k] = derived[k];
  for (const [k, v] of Object.entries(picked)) if (!(k in value)) value[k] = v;
  return { ok: true, value };
}
