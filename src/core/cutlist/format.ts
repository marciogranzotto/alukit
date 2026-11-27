import { lockLines, oldestText, stampRow } from "../stamp.ts";
import type { CutGroup, CutLine, CutList, EndCut, Machining, PieceRail } from "./cutlist.ts";

/** The cut list as Markdown, CSV or JSON (design §5.4: "Output as Markdown, CSV or JSON"). */

const mm = (x: number) => x.toFixed(2);
const plural = (n: number, what: string) => `${n} ${what}${n === 1 ? "" : "s"}`;

function optText(opt: Readonly<Record<string, string>>): string {
  const keys = Object.keys(opt).sort();
  return keys.map((k) => `${k} ${opt[k]}`).join(", ");
}

export function endText(e: EndCut): string {
  if (e === "square") return "square";
  const parts = [`${e.angle_deg.toFixed(2)}°`];
  if (e.mitre_deg !== 0) parts.push(`mitre ${e.mitre_deg.toFixed(2)}°`);
  if (e.bevel_deg !== 0) parts.push(`bevel ${e.bevel_deg.toFixed(2)}°`);
  return parts.join(" ");
}

export function machiningText(m: Machining): string {
  const depth = m.depth_mm === undefined ? "" : `, ${mm(m.depth_mm)} deep`;
  if (m.op === "end-tap") {
    const at = m.off_mm ? `, at x ${mm(m.off_mm[0])}, y ${mm(m.off_mm[1])} from the centre` : "";
    return `tap ${m.thread} in end ${m.from}${at}${depth}`;
  }
  const what = m.thread ? `tap ${m.thread}` : `Ø${m.d_mm === undefined ? "?" : mm(m.d_mm)} hole`;
  if (m.op === "end-hole") {
    const at = m.off_mm
      ? `at x ${mm(m.off_mm[0])}, y ${mm(m.off_mm[1])} from the centre`
      : "at the centre";
    if (m.exit_mm && m.angle_deg !== undefined) {
      // At an angle, following a screw (after acceptance run 4): where it comes out, or ends.
      const [x, y] = m.exit_mm;
      const out =
        m.depth_mm === undefined
          ? `exiting end ${m.from === "a" ? "b" : "a"} at x ${mm(x)}, y ${mm(y)}, through`
          : `${mm(m.depth_mm)} deep, its bottom at x ${mm(x)}, y ${mm(y)}`;
      return `${what} in end ${m.from} ${at}, ${m.angle_deg.toFixed(2)}° off square, ${out}`;
    }
    const how = m.depth_mm === undefined ? "through" : `${mm(m.depth_mm)} deep`;
    return `${what} in end ${m.from} along the axis, ${at}, ${how}`;
  }
  const across = m.across_mm === undefined ? "" : `, ${mm(m.across_mm)} across`;
  const cbore = m.cbore ? `, counterbore Ø${mm(m.cbore.d_mm)} × ${mm(m.cbore.depth_mm)}` : "";
  const csk = m.csk ? `, countersink Ø${mm(m.csk.d_mm)} at ${m.csk.angle_deg.toFixed(2)}°` : "";
  return `${what} ${mm(m.at_mm)} mm from end ${m.from} on face ${m.face}${across}${depth}${cbore}${csk}`;
}

/** A rail piece's holes: "20 holes at 60.00, E 30.00 at a (factory) / 40.00 at b". */
export function railText(r: PieceRail): string {
  const tag = (end: "a" | "b") => (r.factory === end ? " (factory)" : "");
  return `${r.holes} holes at ${mm(r.pitch_mm)}, E ${mm(r.E_a_mm)} at a${tag("a")} / ${mm(r.E_b_mm)} at b${tag("b")}`;
}

function groupTitle(g: CutGroup): string {
  const opt = optText(g.opt);
  const how =
    g.mode === "cut"
      ? `cut by the supplier (${g.offer})`
      : g.mode === "stock"
        ? `whole bars, nested (kerf ${mm(g.kerf_mm ?? 0)}, end trim ${mm(g.trim_mm ?? 0)})`
        : "no offer sells it by length";
  return `${g.item}, ${g.name}${opt ? `, ${opt}` : ""}: ${how}`;
}

function lineRow(g: CutGroup, l: CutLine): string {
  const cells = [
    String(l.count),
    mm(l.cut_mm),
    l.centre_mm === undefined ? "" : mm(l.centre_mm),
    `${endText(l.ends.a)} / ${endText(l.ends.b)}`,
    [...(l.rail ? [railText(l.rail)] : []), ...l.machining.map(machiningText)].join("; "),
  ];
  if (g.mode === "cut") cells.push(mm(l.ordered_mm ?? 0), mm(l.billed_mm ?? 0));
  cells.push(l.sources.join(", "));
  return `| ${cells.join(" | ")} |`;
}

export function cutListMarkdown(cl: CutList): string {
  const out: string[] = ["# Cut list", ""];
  out.push(
    "Lengths in mm at the long point; a piece with an angled end also gives its centre-line length.",
    `Prices on the ${cl.price_basis} basis, in minor units; ${oldestText(cl.oldest_read)}.`,
    "",
    ...lockLines(cl.lock),
  );
  for (const g of cl.groups) {
    out.push(`## ${groupTitle(g)}`, "");
    const head = ["Qty", "Cut", "Centre", "Ends (a / b)", "Machining"];
    const align = ["---:", "---:", "---:", "---", "---"];
    if (g.mode === "cut") {
      head.push("Ordered", "Billed");
      align.push("---:", "---:");
    }
    head.push("Bars");
    align.push("---");
    out.push(`| ${head.join(" | ")} |`, `|${align.join("|")}|`);
    for (const l of g.lines) out.push(lineRow(g, l));
    out.push("", `${plural(g.pieces, "piece")}, ${mm(g.total_mm)} mm in all.`);
    if (g.stock) {
      out.push(
        "",
        "| Stock bar | Length | Price | Pieces | Offcut | Waste |",
        "|---|---:|---:|---|---:|---:|",
      );
      g.stock.forEach((b, i) => {
        const pieces = b.pieces
          .map(
            (p) =>
              `${p.source} ${mm(p.cut_mm)}${p.factory_end ? ` (factory end at the ${p.factory_end})` : ""}`,
          )
          .join(", ");
        out.push(
          `| ${i + 1}: ${b.sku} | ${mm(b.length_mm)} | ${b.price_minor} | ${pieces} | ${mm(b.offcut_mm)} | ${mm(b.waste_mm)} |`,
        );
      });
      const currency = g.currency ? `${g.currency} ` : "";
      out.push(
        "",
        `${plural(g.stock.length, "stock bar")}, ${g.cost_minor} ${currency}minor units.`,
      );
    }
    out.push("");
  }
  if (cl.diagnostics.length > 0) {
    out.push("## Problems", "");
    for (const d of cl.diagnostics)
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
 * One row per line, then one per stock bar (`kind` tells them apart). Derived from a lock, a
 * first `stamp` row names the `lock` and gives its hash in `sources`, where a row says what it
 * comes from (§5.4). The CSV gives no prices, so no basis and no read date.
 */
export function cutListCsv(cl: CutList): string {
  const head = [
    "kind",
    "item",
    "options",
    "mode",
    "count",
    "cut_mm",
    "centre_mm",
    "short_mm",
    "end_a",
    "end_b",
    "machining",
    "ordered_mm",
    "billed_mm",
    "stock_sku",
    "stock_mm",
    "offcut_mm",
    "waste_mm",
    "sources",
  ];
  const rows: string[] = [head.join(",")];
  if (cl.lock !== undefined) {
    rows.push(stampRow(head, { kind: "stamp", item: "lock", sources: cl.lock }));
  }
  for (const g of cl.groups) {
    for (const l of g.lines) {
      rows.push(
        [
          "line",
          g.item,
          optText(g.opt),
          g.mode,
          l.count,
          mm(l.cut_mm),
          l.centre_mm === undefined ? undefined : mm(l.centre_mm),
          l.short_mm === undefined ? undefined : mm(l.short_mm),
          endText(l.ends.a),
          endText(l.ends.b),
          [...(l.rail ? [railText(l.rail)] : []), ...l.machining.map(machiningText)].join("; "),
          l.ordered_mm === undefined ? undefined : mm(l.ordered_mm),
          l.billed_mm === undefined ? undefined : mm(l.billed_mm),
          undefined,
          undefined,
          undefined,
          undefined,
          l.sources.join(" "),
        ]
          .map(csvCell)
          .join(","),
      );
    }
    for (const b of g.stock ?? []) {
      rows.push(
        [
          "stock",
          g.item,
          optText(g.opt),
          g.mode,
          b.pieces.length,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          b.sku,
          mm(b.length_mm),
          mm(b.offcut_mm),
          mm(b.waste_mm),
          b.pieces.map((p) => p.source).join(" "),
        ]
          .map(csvCell)
          .join(","),
      );
    }
  }
  return `${rows.join("\n")}\n`;
}

export function cutListJson(cl: CutList): string {
  return `${JSON.stringify(cl, null, 2)}\n`;
}
