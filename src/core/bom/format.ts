import { lockLines, stampRow } from "../stamp.ts";
import type { Bom, BomLine } from "./bom.ts";

/** The BOM as Markdown, CSV or JSON (design §5.4: "Output as Markdown, CSV or JSON"). */

const mm = (x: number) => x.toFixed(2);
const kg = (x: number) => x.toFixed(3);

const TITLES: Record<string, string> = {
  bar: "Bars",
  connector: "Connectors",
  fastener: "Fasteners",
  carriage: "Carriages",
  accessory: "Accessories",
  panel: "Panels",
  generic: "Other items",
  plate: "Plates",
  "bent-angle": "Bent angles",
  placeholder: "Placeholders",
};

function optText(opt: Readonly<Record<string, string>>): string {
  return Object.keys(opt)
    .sort()
    .map((k) => `${k} ${opt[k]}`)
    .join(", ");
}

function unplacedText(l: BomLine): string {
  return (l.unplaced ?? []).map((u) => `${u.part}: ${u.qty} unplaced, ${u.why}`).join("; ");
}

export function bomMarkdown(b: Bom): string {
  const out: string[] = ["# Bill of materials", ""];
  out.push(
    "Masses as the catalog publishes them, else computed from the section's area and the material's density (calc). Bars: pieces and the length of bar they take, each its span (its cut length, unless its two cuts lean the same way).",
    "",
    ...lockLines(b.lock),
  );
  for (const g of b.groups) {
    out.push(`## ${TITLES[g.kind] ?? g.kind}`, "");
    const bars = g.kind === "bar";
    const head = bars
      ? ["Item", "Name", "Options", "Pieces", "Length", "kg/m", "Mass kg", "Used by"]
      : ["Item", "Name", "Options", "Qty", "kg each", "Mass kg", "Used by"];
    out.push(
      `| ${head.join(" | ")} |`,
      `|${head.map((h) => (/^(Pieces|Qty|Length|kg|Mass)/.test(h) ? "---:" : "---")).join("|")}|`,
    );
    for (const l of g.lines) {
      const used = [l.sources.join(", "), unplacedText(l)].filter((x) => x !== "").join("; ");
      const m =
        l.mass_kg === undefined ? "?" : `${kg(l.mass_kg)}${l.mass_src === "calc" ? " (calc)" : ""}`;
      const unit = l.unit_mass_kg === undefined ? "?" : kg(l.unit_mass_kg);
      const cells = bars
        ? [l.item, l.name, optText(l.opt), String(l.qty), mm(l.length_mm ?? 0), unit, m, used]
        : [l.item, l.name, optText(l.opt), String(l.qty), unit, m, used];
      out.push(`| ${cells.join(" | ")} |`);
    }
    out.push("", `${kg(g.mass_kg)} kg.`, "");
  }
  if (b.recipes && b.recipes.length > 0) {
    out.push(
      "## Joint recipes",
      "",
      "Connectors with no body of their own: not bought and weighing nothing. The fasteners, sleeves and machining each brings are on their own lines above, used by the same connections.",
      "",
      "| Item | Name | Uses | Used by |",
      "|---|---|---:|---|",
    );
    for (const r of b.recipes)
      out.push(`| ${r.item} | ${r.name} | ${r.qty} | ${r.sources.join(", ")} |`);
    out.push("");
  }
  if (b.context && b.context.length > 0) {
    out.push(
      "## Context",
      "",
      "Members marked context: drawn and checked against, not built or bought, so in no total. Machining the build makes on them is on the machining sheet, made in place.",
      "",
      "| Member | Item | Name | Options |",
      "|---|---|---|---|",
    );
    for (const c of b.context) {
      const what = c.kind === "body" ? `${c.id}'s through body` : c.id;
      out.push(`| ${what} | ${c.item} | ${c.name} | ${optText(c.opt)} |`);
    }
    out.push("");
  }
  out.push(`Total mass: ${kg(b.mass_kg)} kg.`);
  if (b.mass_unknown.length > 0) {
    out.push(`No mass for ${b.mass_unknown.join(", ")}: left out of the totals.`);
  }
  out.push("");
  if (b.diagnostics.length > 0) {
    out.push("## Problems", "");
    for (const d of b.diagnostics)
      out.push(`- ${d.severity} ${d.code}${d.entity ? ` ${d.entity}` : ""}: ${d.message}`);
    out.push("");
  }
  return out.join("\n");
}

function csvCell(s: string | number | undefined): string {
  if (s === undefined) return "";
  const t = String(s);
  return /[",\n]/.test(t) ? `"${t.replaceAll('"', '""')}"` : t;
}

/**
 * One row per line. Derived from a lock, a first `stamp` row names the `lock` and gives its hash
 * in `sources`, where a row says what it comes from (§5.4).
 */
export function bomCsv(b: Bom): string {
  const head = [
    "kind",
    "item",
    "name",
    "options",
    "qty",
    "length_mm",
    "unit_mass_kg",
    "mass_kg",
    "mass_src",
    "sources",
    "unplaced",
  ];
  const rows: string[] = [head.join(",")];
  if (b.lock !== undefined)
    rows.push(stampRow(head, { kind: "stamp", item: "lock", sources: b.lock }));
  for (const g of b.groups) {
    for (const l of g.lines) {
      rows.push(
        [
          g.kind,
          l.item,
          l.name,
          optText(l.opt),
          l.qty,
          l.length_mm === undefined ? undefined : mm(l.length_mm),
          l.unit_mass_kg === undefined ? undefined : kg(l.unit_mass_kg),
          l.mass_kg === undefined ? undefined : kg(l.mass_kg),
          l.mass_src,
          l.sources.join(" "),
          unplacedText(l) || undefined,
        ]
          .map(csvCell)
          .join(","),
      );
    }
  }
  // Joint recipes: kind `recipe`, no mass; not bought (§3.4).
  for (const r of b.recipes ?? []) {
    rows.push(
      ["recipe", r.item, r.name, "", r.qty, "", "", "", "", r.sources.join(" "), ""]
        .map(csvCell)
        .join(","),
    );
  }
  // Context members: kind `context`, no quantity and no mass; not built or bought (X11).
  for (const c of b.context ?? []) {
    rows.push(
      ["context", c.item, c.name, optText(c.opt), "", "", "", "", "", c.id, ""]
        .map(csvCell)
        .join(","),
    );
  }
  return `${rows.join("\n")}\n`;
}

export function bomJson(b: Bom): string {
  return `${JSON.stringify(b, null, 2)}\n`;
}
