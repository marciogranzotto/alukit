import { compareIds } from "#core/ids.ts";
import type { Problem, ProblemGroup } from "#core/problems/types.ts";
import { sizeOf } from "../catalog/SectionThumb.tsx";
import { type Corner, cornerRef } from "../corners.ts";
import { mm } from "../format.ts";
import type { Model } from "../model.ts";

/**
 * The model outline's rows and groups (docs/ux/plan.md S2.5, U19): each entity in words, label ·
 * item name · cut length ("b5 · top rail, front · 40×80 Básico · 1120.00 mm"), grouped by kind or
 * by tag; the Joints group lists the corners (src/ui/corners.ts, D-UX-10), each with the
 * connections there, then the connections at no corner. Pure. Owner: S2.
 */

export type EntityKind = "bars" | "runs" | "connections" | "parts" | "patterns" | "nodes";

export interface Row {
  /** The ref a click selects: an entity id or `corner:<key>`. */
  id: string;
  kind: EntityKind | "corner";
  /** What a person calls it, after the id: for a bar its label, else its item's code and size. */
  text: string;
  /**
   * Its figure, in a right-aligned column of its own (docs/ux/review-phase4.md M7): a bar's or a
   * run's length, so a narrow outline cuts the words, never the number.
   */
  figure: string;
  /** Everything in words, the item's full name too: the row's tooltip, and what the filter reads. */
  title: string;
  tags: string[];
  /** A pattern copy, which derive makes from its template. */
  copy: boolean;
}

export interface Group {
  key: string;
  title: string;
  /** A group's own ref, when the group stands for a thing (a corner). */
  ref?: string;
  /** The worst problem state of the group's thing, for a corner. */
  state?: Corner["state"];
  rows: Row[];
  groups?: Group[];
}

const isObject = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);

/** Catalog and project items' names, by id: the BOM's and the lock's. */
export function itemNames(m: Model): Map<string, string> {
  const names = new Map<string, string>();
  for (const [id, item] of Object.entries(m.items)) {
    if (typeof item.name === "string") names.set(id, item.name);
  }
  for (const g of m.bom.groups) for (const l of g.lines) names.set(l.item, l.name);
  const own = isObject(m.doc.items) ? m.doc.items : {};
  for (const [id, item] of Object.entries(own)) {
    if (isObject(item) && typeof item.name === "string") names.set(`project:${id}`, item.name);
  }
  return names;
}

const v3 = (p: unknown) =>
  Array.isArray(p) && p.length === 3
    ? `(${p.map((x) => (typeof x === "number" ? mm(x).replace(/\.00$/, "") : String(x))).join(", ")})`
    : "";

/** A connection in words: `butt: b5.a → b1`, `miter: b1.b, b2.a`, `face: b1, p6`. */
function connectionText(o: Record<string, unknown>): string {
  const type = typeof o.type === "string" ? o.type : "connection";
  const ends = Array.isArray(o.ends) ? (o.ends as unknown[]).map(String) : [];
  const layers = Array.isArray(o.layers) ? (o.layers as unknown[]).map(String) : [];
  if (typeof o.through === "string" && ends.length > 0)
    return `${type}: ${ends.join(", ")} → ${o.through}`;
  if (ends.length > 0) return `${type}: ${ends.join(", ")}`;
  if (layers.length > 0) return `${type}: ${layers.join(", ")}`;
  return type;
}

/** The rows of one kind, in id order: the document's entities and derive's pattern copies. */
export function rowsOf(m: Model, kind: EntityKind, names = itemNames(m)): Row[] {
  const written = isObject(m.doc[kind]) ? (m.doc[kind] as Record<string, unknown>) : {};
  const ids = new Set(Object.keys(written));
  if (kind === "bars") for (const id of Object.keys(m.derived.bars)) ids.add(id);
  if (kind === "parts") for (const id of Object.keys(m.derived.parts)) ids.add(id);
  const name = (item: string | undefined) => (item ? (names.get(item) ?? item) : "");
  return [...ids].sort(compareIds).map((id) => {
    const v = written[id];
    const o = isObject(v) ? v : {};
    const label = typeof o.label === "string" ? o.label : "";
    let parts: string[];
    // The words before the figure, when not all of `parts` but the last (a bar's).
    let short: string | undefined;
    let figure = "";
    switch (kind) {
      case "bars": {
        const b = m.derived.bars[id];
        const item = b?.item ?? (typeof o.item === "string" ? o.item : undefined);
        figure = b ? `${mm(b.cut_mm)} mm` : "";
        parts = [label, name(item), b ? figure : "does not derive"];
        short = label || barShort(m, id, item) || (b ? "" : "does not derive");
        break;
      }
      case "parts": {
        const p = m.derived.parts[id];
        parts = [
          label,
          name(p?.item),
          p?.bar ? `on ${p.bar}${p.s_mm !== undefined ? ` at ${mm(p.s_mm)}` : ""}` : "",
        ];
        break;
      }
      case "connections":
        parts = [label, connectionText(o)];
        break;
      case "runs": {
        const r = m.derived.runs[id];
        const bars = Array.isArray(v)
          ? (v as unknown[]).map(String)
          : Array.isArray(o.bars)
            ? (o.bars as unknown[]).map(String)
            : [];
        figure = r ? `${mm(r.len_mm)} mm` : "";
        parts = [label, bars.join(", "), figure];
        short = [label, bars.join(", ")].filter((x) => x !== "").join(" · ");
        break;
      }
      case "patterns": {
        const t = Array.isArray(o.template) ? (o.template as unknown[]).map(String).join(", ") : "";
        parts = [
          label,
          t ? `copies of ${t}` : "",
          typeof o.count === "number" ? `× ${o.count}` : "",
        ];
        break;
      }
      case "nodes":
        parts = [label, v3(Array.isArray(v) ? v : o.at)];
        break;
    }
    const title = parts.filter((x) => x !== "").join(" · ");
    return {
      id,
      kind,
      text: short ?? title,
      figure,
      title,
      tags: Array.isArray(o.tags) ? (o.tags as unknown[]).map(String) : [],
      copy: id.includes("@"),
    };
  });
}

/** A bar with no label in a few words: its item's code and its section's size, `PF40-01 40×40`. */
function barShort(m: Model, id: string, item: string | undefined): string {
  const e = item ? m.items[item] : undefined;
  const code = typeof e?.code === "string" ? e.code : (item?.split(":").pop() ?? "");
  const section = m.display?.sections[m.display.bars[id]?.section ?? ""];
  const size = section ? sizeOf({ thumb: section }) : undefined;
  return [code, size ? `${size[0]}×${size[1]}` : ""].filter((x) => x !== "").join(" ");
}

const KINDS: readonly [EntityKind, string][] = [
  ["bars", "Bars"],
  ["runs", "Runs"],
  ["connections", "Joints"],
  ["parts", "Parts"],
  ["patterns", "Patterns"],
  ["nodes", "Nodes"],
];

const CORNER_WORD: Readonly<Record<Corner["state"], string>> = {
  joined: "joined",
  open: "open",
  failed: "failed",
};

/** The Joints group: the corners, each with its connections, then the connections at none. */
function jointsGroup(rows: readonly Row[], corners: readonly Corner[]): Group {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const atCorner = new Set<string>();
  const groups: Group[] = corners.map((c) => {
    const own = c.connections.flatMap((id) => {
      const r = byId.get(id);
      return r ? [r] : [];
    });
    for (const r of own) atCorner.add(r.id);
    return {
      key: `corner:${c.key}`,
      ref: cornerRef(c.key),
      state: c.state,
      title: `Corner ${v3(c.at)} · ${CORNER_WORD[c.state]}${c.through ? ` · ${c.through} runs through` : ""}`,
      rows: own,
    };
  });
  const other = rows.filter((r) => !atCorner.has(r.id));
  if (corners.length === 0) return { key: "connections", title: "Joints", rows: other };
  return {
    key: "connections",
    title: "Joints",
    rows: [],
    groups: [
      ...groups,
      ...(other.length > 0
        ? [{ key: "other-connections", title: "Other connections", rows: other }]
        : []),
    ],
  };
}

/** Whether a row matches the filter: its id, its words or a tag. */
export function matches(r: Row, filter: string): boolean {
  const f = filter.trim().toLowerCase();
  return (
    f === "" ||
    r.id.toLowerCase().includes(f) ||
    r.title.toLowerCase().includes(f) ||
    r.text.toLowerCase().includes(f) ||
    r.tags.some((t) => t.toLowerCase().includes(f))
  );
}

/** The outline's groups: by kind (with Joints by corner) or by tag; empty groups left out. */
export function groupsOf(
  m: Model,
  opts: { byTag: boolean; filter: string; corners: readonly Corner[] },
): Group[] {
  const names = itemNames(m);
  const keep = (rs: Row[]) => rs.filter((r) => matches(r, opts.filter));
  if (opts.byTag) {
    const tags = new Map<string, Row[]>();
    for (const [k] of KINDS)
      for (const r of keep(rowsOf(m, k, names)))
        for (const t of r.tags.length > 0 ? r.tags : ["(untagged)"])
          tags.set(t, [...(tags.get(t) ?? []), r]);
    return [...tags]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([t, rows]) => ({ key: `tag:${t}`, title: t, rows }));
  }
  const out: Group[] = [];
  for (const [k, title] of KINDS) {
    const rows = keep(rowsOf(m, k, names));
    if (k === "connections") {
      const filtered = opts.filter.trim() !== "";
      const g = jointsGroup(rows, filtered ? [] : opts.corners);
      if (g.rows.length > 0 || (g.groups ?? []).length > 0) out.push(g);
    } else if (rows.length > 0) out.push({ key: k, title, rows });
  }
  return out;
}

/**
 * Every row under a group, its subgroups' rows included, in the tree's order: what a click on its
 * head selects (editing audit E2.2), and what its count counts.
 */
export function membersOf(g: Group): string[] {
  return [...(g.groups ?? []).flatMap(membersOf), ...g.rows.map((r) => r.id)];
}

/** Where a ref sits in the outline: the groups to open, outermost first, and its item's key. */
export interface Place {
  trail: Group[];
  /** The tree item that shows it: `r:<group>:<id>` for a row, `g:<group>` for a corner's head. */
  key: string;
}

/**
 * Every place in the outline of the refs wanted, in the tree's order (a group's head, its
 * subgroups, then its rows). Show reveals all of them, since it selects all of them: a problem at
 * c21 names c21 and the bars it joins, and c21's row is in its corner's group, closed by default.
 */
export function placesOf(groups: readonly Group[], want: ReadonlySet<string>): Place[] {
  const out: Place[] = [];
  const walk = (gs: readonly Group[], trail: Group[]) => {
    for (const g of gs) {
      if (g.ref && want.has(g.ref)) out.push({ trail, key: `g:${g.key}` });
      const inside = [...trail, g];
      if (g.groups) walk(g.groups, inside);
      for (const r of g.rows)
        if (want.has(r.id)) out.push({ trail: inside, key: `r:${g.key}:${r.id}` });
    }
  };
  walk(groups, []);
  return out;
}

/** The worst group of the problems about each entity: what a row's problem mark shows. */
export function problemsByEntity(problems: readonly Problem[]): Map<string, ProblemGroup> {
  const rank: Readonly<Record<ProblemGroup, number>> = {
    "blocks-order": 0,
    error: 1,
    warning: 2,
    note: 3,
  };
  const out = new Map<string, ProblemGroup>();
  for (const p of problems) {
    for (const t of p.targets) {
      const id = t.split(".")[0] as string;
      const was = out.get(id);
      if (was === undefined || rank[p.group] < rank[was]) out.set(id, p.group);
    }
  }
  return out;
}
