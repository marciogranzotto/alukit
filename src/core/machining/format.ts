import { LOCAL } from "../project-items/supplier.ts";
import { lockLines } from "../stamp.ts";
import type { MachiningSheet, SheetHole, SheetPart } from "./machining.ts";

/** The machining sheet as Markdown or JSON (M6). */

const mm = (x: number) => x.toFixed(2);

function optText(opt: Readonly<Record<string, string>>): string {
  return Object.keys(opt)
    .sort()
    .map((k) => `${k} ${opt[k]}`)
    .join(", ");
}

/** A hole's size: "M6, tap drill Ø5.00, through"; "Ø6.60, countersink Ø12.40 at 90.00°, 2.90 deep, through". */
export function holeSize(h: SheetHole): string {
  const parts = [h.thread ? `${h.thread}, tap drill Ø${mm(h.d_mm)}` : `Ø${mm(h.d_mm)}`];
  if (h.csk) {
    parts.push(
      `countersink Ø${mm(h.csk.d_mm)} at ${h.csk.angle_deg.toFixed(2)}°, ${mm(h.csk.depth_mm)} deep`,
    );
  }
  if (h.cbore) parts.push(`counterbore Ø${mm(h.cbore.d_mm)} × ${mm(h.cbore.depth_mm)} deep`);
  parts.push(h.depth_mm === undefined ? "through" : `${mm(h.depth_mm)} deep`);
  return parts.join(", ");
}

/**
 * What a part is, its stock and blank, and where its holes are measured from: one sentence each,
 * the sheet's words, which the app's Machining tab shows too.
 */
export function partLines(p: SheetPart): string[] {
  const what = p.kind === "plate" ? "Plate" : "Bent angle";
  const out = [
    `${what}, ${mm(p.thickness_mm)} mm ${p.material}, ${p.qty} off (${p.sources.join(", ")}), ${p.supplier === LOCAL ? "made in-house (local)" : `made by ${p.supplier}`}.`,
  ];
  if (p.outline_mm) {
    out.push(`Outline: ${p.outline_mm.map(([x, y]) => `(${mm(x)}, ${mm(y)})`).join(", ")}.`);
  }
  if (p.legs_mm && p.blank_mm && p.bend) {
    const b = p.bend;
    out.push(
      `Legs ${mm(p.legs_mm[0])} (a) and ${mm(p.legs_mm[1])} (b), each to the outside of the other, ${mm(p.length_mm ?? 0)} long; one ${b.angle_deg}° bend, inside radius ${mm(b.radius_mm)}, K-factor ${b.k_factor}.`,
      `Blank ${mm(p.blank_mm[0])} × ${mm(p.blank_mm[1])}; bend allowance ${mm(b.allowance_mm)}, the bend zone from ${mm(b.from_mm)} to ${mm(b.to_mm)} from ${p.blank_datum}.`,
    );
  }
  out.push(
    `Datum: ${p.datum}. Front: ${p.kind === "plate" ? "the face away from its mounting face" : "a leg's inside face"}.`,
  );
  return out;
}

function partHead(p: SheetPart): string[] {
  return [`## ${p.item}: ${p.name}`, "", ...partLines(p).flatMap((l) => [l, ""])];
}

/** The holes table's columns: a bent angle's holes name their leg and their place on the blank. */
export function holeColumns(p: SheetPart): string[] {
  return p.kind === "bent-angle"
    ? ["Hole", "Leg", "x", "From heel", "On blank", "Type", "Size", "From face"]
    : ["Hole", "x", "y", "Type", "Size", "From face"];
}

/** A hole's cells under `holeColumns`. */
export function holeCells(p: SheetPart, h: SheetHole): string[] {
  return p.kind === "bent-angle"
    ? [
        h.id,
        h.leg ?? "",
        mm(h.at_mm[0]),
        mm(h.at_mm[1]),
        h.flat_mm ? mm(h.flat_mm[1]) : "",
        h.type,
        holeSize(h),
        h.face,
      ]
    : [h.id, mm(h.at_mm[0]), mm(h.at_mm[1]), h.type, holeSize(h), h.face];
}

/** Columns that hold a length, right-aligned. */
export const NUMERIC_COLUMNS: ReadonlySet<string> = new Set(["x", "y", "From heel", "On blank"]);

function holeRows(p: SheetPart): string[] {
  if (p.holes.length === 0) return ["No holes.", ""];
  const head = holeColumns(p);
  return [
    `| ${head.join(" | ")} |`,
    `|${head.map((h) => (NUMERIC_COLUMNS.has(h) ? "---:" : "---")).join("|")}|`,
    ...p.holes.map((h) => `| ${holeCells(p, h).join(" | ")} |`),
    "",
  ];
}

export function machiningMarkdown(s: MachiningSheet): string {
  const out: string[] = [
    "# Machining sheet",
    "",
    "Custom parts, each hole from the part's datum. Lengths in mm.",
    "",
    ...lockLines(s.lock),
  ];
  if (s.parts.length === 0) out.push("No custom parts.", "");
  for (const p of s.parts) out.push(...partHead(p), ...holeRows(p));
  out.push("## Bars", "");
  if (s.bars.length === 0) out.push("No bar is machined.", "");
  else {
    out.push(
      "Each bar's machining is on the cut list (`alukit cutlist`), from a named end. These lines carry some:",
      "",
      "| Item | Options | Cut | Pieces | Ops each | Bars |",
      "|---|---|---:|---:|---:|---|",
      ...s.bars.map(
        (b) =>
          `| ${b.item} | ${optText(b.opt)} | ${mm(b.cut_mm)} | ${b.count} | ${b.ops} | ${b.sources.join(", ")} |`,
      ),
      "",
    );
  }
  if (s.diagnostics.length > 0) {
    out.push("## Problems", "");
    for (const d of s.diagnostics)
      out.push(`- ${d.severity} ${d.code}${d.entity ? ` ${d.entity}` : ""}: ${d.message}`);
    out.push("");
  }
  return out.join("\n");
}

export function machiningJson(s: MachiningSheet): string {
  return `${JSON.stringify(s, null, 2)}\n`;
}
