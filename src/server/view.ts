import { derivedJson } from "#core/derive/output.ts";
import { type Diagnostic, sortDiagnostics } from "#core/diagnostics.ts";
import type { ResolvedHole, ResolvedProjectItem } from "#core/project-items/resolve.ts";
import { projectItems } from "#core/project-items/source.ts";
import { QUANTUM, quantize } from "#core/quantum.ts";
import { threadDiameter } from "#core/threads.ts";
import { TOL } from "#core/tolerances.ts";
import { addScaled, type V3 } from "#core/vec.ts";
import type {
  ViewBar,
  ViewFastener,
  ViewHole,
  ViewPart,
  ViewSection,
  ViewShape,
} from "../mesh/model.ts";
import { type P2, simplifyRing } from "../mesh/outline.ts";
import type { Snapshot } from "./host.ts";

/**
 * What the app draws and shows for one revision (`alukit.view/1`), built once per revision on
 * the server, which owns the document (§7.1). One answer holds everything a tab shows, so every
 * panel is at the same revision:
 *
 * - `derived`: the derived model as `alukit.derived/1` (§7.3), the contract report builders read;
 * - `display`: what drawing needs beyond it: each bar's section and where the section sits on
 *   the design line, the sections' display outlines (§3.5: simplified at 0.05 mm), parts' boxes,
 *   the shapes and holes of the project's plates and bent angles (§4.8), and fasteners'
 *   positions;
 * - `items`: the catalog entries the model uses, as the lock pins them, with their provenance
 *   (§1, principle 3), for the properties panel;
 * - `check`, `cutlist`, `bom`: the bottom drawer's tables (§8).
 *
 * The status (read-only or not) and the undo and redo steps are not here: they change without a
 * revision, and reach a tab on the event stream.
 */

export const VIEW_SCHEMA = "alukit.view/1";

const len = (x: number) => quantize(x, QUANTUM.len_mm);
const mass = (x: number) => quantize(x, QUANTUM.mass_kg);

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function ring(r: readonly (readonly [number, number])[]): P2[] {
  return simplifyRing(r).map(([x, y]) => [len(x), len(y)] as P2);
}

const p2 = (p: readonly [number, number]): P2 => [len(p[0]), len(p[1])];

function holeView(h: ResolvedHole): ViewHole {
  const mouth = h.csk ?? h.cbore;
  return {
    at: p2(h.at),
    ...(h.leg ? { leg: h.leg } : {}),
    d: len(h.d),
    ...(h.depth !== undefined ? { depth: len(h.depth) } : {}),
    ...(mouth ? { mouth: { d: len(mouth.d), depth: len(mouth.depth) } } : {}),
    face: h.face,
  };
}

/**
 * A project plate's or bent angle's shape (§4.8), when it can be drawn: an outline of three
 * corners or more, or legs longer than the bend's outside setback. Otherwise it is drawn as its
 * box, and the checks say why.
 */
function shapeOf(r: ResolvedProjectItem): ViewShape | undefined {
  const T = r.thickness;
  if (T === undefined) return undefined;
  if (r.plate && r.plate.outline.length >= 3 && r.plate.area > TOL.len * TOL.len) {
    return {
      kind: "plate",
      thickness: len(T),
      outline: r.plate.outline.map(p2),
      holes: r.holes.map(holeView),
    };
  }
  const a = r.angle;
  if (a && a.legs[0] > a.radius + T + TOL.len && a.legs[1] > a.radius + T + TOL.len) {
    return {
      kind: "bent-angle",
      thickness: len(T),
      legs: p2(a.legs),
      length: len(a.length),
      radius: len(a.radius),
      holes: r.holes.map(holeView),
    };
  }
  return undefined;
}

export function viewModel(snap: Snapshot) {
  const { derived, items, state } = snap;
  const sections: Record<string, ViewSection> = {};
  const bars: Record<string, ViewBar> = {};
  for (const [id, b] of derived.bars) {
    const item = b.placed.item;
    if (!sections[item.sectionId]) {
      const s = item.section;
      sections[item.sectionId] = {
        fidelity: s.fidelity,
        outline: ring(s.draw.outline),
        holes: s.draw.holes.map(ring),
        bbox: [
          [s.bbox_mm[0][0], s.bbox_mm[0][1]],
          [s.bbox_mm[1][0], s.bbox_mm[1][1]],
        ],
      };
    }
    const pm = item.mass_kg_per_m;
    bars[id] = {
      section: item.sectionId,
      shift: [len(b.placed.off[0] - b.placed.anchor[0]), len(b.placed.off[1] - b.placed.anchor[1])],
      ...(pm ? { mass_kg: mass((b.lengths.centre * pm.v) / 1000), mass_src: pm.src } : {}),
    };
  }

  // Parts read items as derive does: the catalogs' and the project's own (§4.8).
  const own = projectItems(items, derived.doc);
  const parts: Record<string, ViewPart> = {};
  for (const [id, p] of derived.parts) {
    if (!p.placed) continue;
    const found = own.source.item(p.item);
    const raw = found.ok ? (found.item as { bbox_mm?: unknown }).bbox_mm : undefined;
    const box = Array.isArray(raw) && raw.length === 2 ? (raw as [V3, V3]) : undefined;
    const r = own.resolved.get(p.item);
    const shape = r ? shapeOf(r) : undefined;
    const m = r?.view.mass_kg;
    parts[id] = {
      ...(box ? { box } : {}),
      translucent: !box || p.kind === "placeholder",
      ...(p.kind === "placeholder" ? { placeholder: true } : {}),
      ...(shape ? { shape } : {}),
      ...(m ? { mass_kg: mass(m.v), mass_src: m.src } : {}),
    };
  }

  const fasteners: ViewFastener[] = [];
  for (const [id, f] of derived.fastenings) {
    if (!f.fastener) continue;
    const found = items.item(f.fastener.item);
    const it = found.ok ? (found.item as { thread?: unknown }) : {};
    const bar = found.ok ? found.bar : undefined;
    const thread = typeof it.thread === "string" ? it.thread : bar?.thread;
    const d = (thread ? threadDiameter(thread) : undefined) ?? 6;
    for (const st of f.stations) {
      const first = st.layers[0];
      const last = st.layers[st.layers.length - 1];
      if (!first || !last) continue;
      // Layers are measured along the axis from the head side of the first one, whose far face
      // holds the station point (§4.5): the head is that far back.
      const head = addScaled(st.point, st.axis, -first.to);
      fasteners.push({
        connection: id,
        k: st.k,
        head: head.map(len) as unknown as V3,
        axis: st.axis,
        len: len(last.to),
        d,
      });
    }
  }

  // The catalog entries the model uses, as pinned, with their provenance.
  const used = new Set<string>();
  for (const b of derived.bars.values()) used.add(b.placed.item.id);
  for (const p of derived.parts.values()) used.add(p.item);
  for (const h of derived.hardware) used.add(h.item);
  for (const p of derived.pieces) used.add(p.item);
  const catalogItems: Record<string, unknown> = {};
  for (const id of [...used].sort()) {
    const e = state.lock.items[id];
    if (e) catalogItems[id] = e.item;
  }

  const cl = snap.outputs.cutList();
  const b = snap.outputs.bom();
  const diagnostics: Diagnostic[] = sortDiagnostics([...snap.catalogs, ...snap.check.diagnostics]);
  const rawDoc = state.doc;
  return {
    schema: VIEW_SCHEMA,
    rev: snap.rev,
    ...(typeof rawDoc.name === "string" ? { name: rawDoc.name } : {}),
    doc: rawDoc,
    derived: derivedJson(derived),
    display: { bars, sections, parts, fasteners },
    items: catalogItems,
    defaults: isObject(rawDoc.defaults) ? rawDoc.defaults : {},
    check: { diagnostics, checks: snap.check.checks },
    cutlist: { ...cl, diagnostics: sortDiagnostics([...cl.diagnostics]) },
    bom: { ...b, diagnostics: sortDiagnostics([...b.diagnostics]) },
  };
}

export type ViewModel = ReturnType<typeof viewModel>;
