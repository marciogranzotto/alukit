import type { ProblemsAnswer } from "#core/problems/types.ts";
import type { ProblemBadge } from "../../viewer/scene.ts";
import { type Corner, cornerKey } from "../corners.ts";
import { deg, mm } from "../format.ts";
import type { Model } from "../model.ts";
import { resolveTargets } from "../targets.ts";

/**
 * What the viewport says in words and draws as badges, from the model: the hover label, the
 * selected bar's label, a corner's label, the problem badges. Pure, so the unit tests read them.
 * Owner: S3.
 */

/** A connection type's glyph (B's, D-UX-23): it goes in labels, not on the markers. */
export const CONNECTION_GLYPH: Readonly<Record<string, string>> = {
  butt: "⊥",
  miter: "⟋",
  splice: "‖",
  pivot: "⟳",
  face: "⊕",
};

/** An item's code as a label shows it: the catalog's code, else the id without its catalog. */
export function itemCode(m: Model, item: string): string {
  const code = (m.items?.[item] as { code?: unknown } | undefined)?.code;
  return typeof code === "string" ? code : (item.split(":").pop() ?? item);
}

/** An entity's own label in the document, when it has one. */
function labelOf(m: Model, kind: "bars" | "parts", id: string): string | undefined {
  const w = (m.doc?.[kind] as Record<string, { label?: unknown }> | undefined)?.[id]?.label;
  return typeof w === "string" ? w : undefined;
}

/** A connection's type, written or (for a copy) its template's. */
function connectionType(m: Model, id: string): string | undefined {
  const conns = (m.doc?.connections ?? {}) as Record<string, { type?: unknown }>;
  const t = conns[id]?.type ?? conns[id.split("@")[0] as string]?.type;
  return typeof t === "string" ? t : undefined;
}

/** A bar end as the selected bar's label writes it: square, or its angle. */
function endWord(angle: number): string {
  return Math.abs(angle) <= 0.005 ? "square" : `${deg(angle)}°`;
}

/** A corner in words: its connections with their glyphs, what runs through, its state. */
export function cornerWords(m: Model, c: Corner): string[] {
  const joints = c.connections.map((id) => {
    const t = connectionType(m, id);
    return t ? `${CONNECTION_GLYPH[t] ?? ""} ${id} ${t}`.trim() : id;
  });
  const state = { joined: "joined", open: "open: an end has no connection", failed: "failed" };
  return [
    `Corner (${c.key.split(",").join(", ")})`,
    ...(joints.length > 0 ? [joints.join(" · ")] : []),
    ...(c.through ? [`${c.through} runs through`] : []),
    state[c.state],
  ];
}

/**
 * What the hover label says about what the pointer is over (C §5.3): a bar's id, label, item
 * and cut length; a part's id, label and item; a connection's (its fasteners) id and type; a
 * corner's connections, through bar and state.
 */
export function hoverWords(m: Model, id: string, corners: readonly Corner[]): string[] {
  const key = cornerKey(id);
  if (key !== undefined) {
    const c = corners.find((x) => x.key === key);
    return c ? cornerWords(m, c) : [id];
  }
  const bar = m.derived?.bars?.[id];
  if (bar) {
    const label = labelOf(m, "bars", id);
    return [[id, label, itemCode(m, bar.item), `${mm(bar.cut_mm)} mm`].filter(Boolean).join("  ")];
  }
  const part = m.derived?.parts?.[id];
  if (part) {
    const label = labelOf(m, "parts", id);
    return [[id, label, itemCode(m, part.item)].filter(Boolean).join("  ")];
  }
  const t = connectionType(m, id);
  return [t ? `${id}  ${CONNECTION_GLYPH[t] ?? ""} ${t}` : id];
}

/** The selected bar's label (C §5.3): its cut length, then each end, square or angled. */
export function barWords(m: Model, id: string): string | undefined {
  const bar = m.derived?.bars?.[id];
  if (!bar) return undefined;
  return `${mm(bar.cut_mm)} mm  ${endWord(bar.ends.a.angle_deg)} · ${endWord(bar.ends.b.angle_deg)}`;
}

const SEVERITY = { "blocks-order": "block", error: "error", warning: "warn" } as const;

/**
 * The problems as badges on the entities they are about (S3.7): one per problem that blocks the
 * order, is an error or a warning (notes get none), on the bodies its targets stand for.
 */
export function badgesOf(p: ProblemsAnswer | undefined, m: Model): ProblemBadge[] {
  if (!p) return [];
  const out: ProblemBadge[] = [];
  for (const x of p.problems) {
    if (x.group === "note") continue;
    const ids = resolveTargets(m, x.targets).ids.filter(
      (id) => id in (m.derived?.bars ?? {}) || id in (m.derived?.parts ?? {}),
    );
    if (ids.length > 0) out.push({ ids, severity: SEVERITY[x.group] });
  }
  return out;
}

/** The legend's entries when the view is coloured by item: the BOM's items, in its order. */
export function legendItems(m: Model): { item: string; name: string }[] {
  const seen = new Set<string>();
  const out: { item: string; name: string }[] = [];
  for (const g of m.bom?.groups ?? []) {
    for (const l of g.lines) {
      if (seen.has(l.item)) continue;
      seen.add(l.item);
      out.push({ item: l.item, name: l.name });
    }
  }
  return out;
}
