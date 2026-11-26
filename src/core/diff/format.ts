import { money } from "../order/format.ts";
import type { DiffReport, Pair, SideInfo } from "./diff.ts";

/** The diff report as Markdown (`alukit diff`, §7.3); JSON is the report itself. */

const KIND_NAME: Record<string, string> = {
  items: "item",
  offers: "offer",
  sections: "section",
  materials: "material",
  grooves: "groove type",
  systems: "system",
};

function value(v: unknown): string {
  if (v === undefined || v === null) return "(none)";
  const s = JSON.stringify(v);
  return s.length > 80 ? `${s.slice(0, 77)}...` : s;
}

function num(x: number | null, f: (n: number) => string = String): string {
  return x === null ? "–" : f(x);
}

function pair(p: Pair<number>, f: (n: number) => string = String): string {
  if (p[0] === p[1]) return num(p[0], f);
  const delta =
    p[0] !== null && p[1] !== null
      ? ` (${p[1] - p[0] > 0 ? "+" : ""}${f(Math.round((p[1] - p[0]) * 1e6) / 1e6)})`
      : "";
  return `${num(p[0], f)} → ${num(p[1], f)}${delta}`;
}

function text(p: Pair<string>): string {
  return p[0] === p[1] ? (p[0] ?? "–") : `${p[0] ?? "–"} → ${p[1] ?? "–"}`;
}

const mm = (x: number) => x.toFixed(2);
const kg = (x: number) => x.toFixed(3);

function optText(opt: Readonly<Record<string, string>>): string {
  return Object.keys(opt)
    .sort()
    .map((k) => `${k} ${opt[k]}`)
    .join(", ");
}

function sideLine(name: string, s: SideInfo): string {
  const v = s.variant === null ? "" : `, variant ${s.variant}`;
  const stored = s.stored ? ", outputs as stored" : "";
  return `- **${name}**: ${s.label}${v}; lock ${s.lock.slice(0, 19)}…; as of ${s.as_of}${stored}`;
}

export function diffMarkdown(r: DiffReport): string {
  const out: string[] = ["# Diff", "", sideLine("a", r.a), sideLine("b", r.b), ""];
  if (r.same) {
    out.push("No differences.");
    return `${out.join("\n")}\n`;
  }

  if (r.lock.entries.length > 0 || r.lock.catalogs.length > 0) {
    out.push("## Lock", "");
    for (const e of r.lock.entries) {
      out.push(`- ${e.change} ${KIND_NAME[e.kind] ?? e.kind} ${e.id}`);
      for (const f of e.fields ?? []) {
        out.push(`  - ${f.path || "(value)"}: ${value(f.was)} → ${value(f.now)}`);
      }
    }
    for (const c of r.lock.catalogs) out.push(`- catalog ${c.id}: ${c.change}`);
    out.push("");
  }

  if (r.entities.length > 0 || r.fields.length > 0) {
    out.push("## Document", "");
    for (const e of r.entities) {
      out.push(`- ${e.change} ${e.id}`);
      for (const f of e.fields ?? []) {
        out.push(`  - ${f.path || "(value)"}: ${value(f.was)} → ${value(f.now)}`);
      }
    }
    for (const f of r.fields) out.push(`- ${f.path}: ${value(f.was)} → ${value(f.now)}`);
    out.push("");
  }

  if (r.params.length > 0) {
    out.push("## Params", "", "| Param | Value |", "|---|---:|");
    for (const p of r.params) out.push(`| ${p.name} | ${pair(p.value)} |`);
    out.push("");
  }

  if (r.bars.length > 0 || r.pieces.length > 0) {
    out.push(
      "## Cut lengths",
      "",
      "| Bar or piece | Item | Cut (mm) | Centre (mm) |",
      "|---|---|---:|---:|",
    );
    for (const b of r.bars) {
      out.push(`| ${b.id} | ${text(b.item)} | ${pair(b.cut_mm, mm)} | ${pair(b.centre_mm, mm)} |`);
    }
    for (const p of r.pieces)
      out.push(`| ${p.source} | ${text(p.item)} | ${pair(p.len_mm, mm)} | |`);
    out.push("");
  }

  if (r.bom.length > 0 || r.mass_kg[0] !== r.mass_kg[1]) {
    out.push("## Bill of materials", "");
    if (r.bom.length > 0) {
      out.push(
        "| Kind | Item | Options | Qty | Length (mm) | Mass (kg) |",
        "|---|---|---|---:|---:|---:|",
      );
      for (const l of r.bom) {
        out.push(
          `| ${l.kind} | ${l.item} | ${optText(l.opt)} | ${pair(l.qty)} | ${pair(l.length_mm, mm)} | ${pair(l.mass_kg, kg)} |`,
        );
      }
      out.push("");
    }
    out.push(`Mass: ${pair(r.mass_kg, kg)} kg.`, "");
  }

  if (r.order.length > 0 || r.suppliers.length > 0 || r.status[0] !== r.status[1]) {
    out.push("## Order", "");
    if (r.order.length > 0) {
      out.push(
        "| Supplier | Item | SKU | Unit | Qty | Unit price | Likely |",
        "|---|---|---|---|---:|---:|---:|",
      );
      for (const l of r.order) {
        const unit = l.length_mm === null ? l.unit : `${l.unit} ${mm(l.length_mm)} mm`;
        const cover =
          l.covered_by[0] !== null || l.covered_by[1] !== null
            ? ` (covered by ${text(l.covered_by)})`
            : "";
        out.push(
          `| ${l.supplier ?? "(unsourced)"} | ${l.item}${optText(l.opt) ? ` (${optText(l.opt)})` : ""} | ${l.sku ?? ""} | ${unit} | ${pair(l.qty)} | ${pair(l.unit_price_minor, money)} | ${pair(l.likely_minor, money)}${cover} |`,
        );
      }
      out.push("");
    }
    if (r.suppliers.length > 0) {
      out.push("| Supplier | Status | Likely |", "|---|---|---:|");
      for (const s of r.suppliers) {
        out.push(
          `| ${s.supplier ?? "(unsourced)"} | ${text(s.status)} | ${pair(s.likely_minor, money)} |`,
        );
      }
      out.push("");
    }
    if (r.status[0] !== r.status[1]) out.push(`Order: ${text(r.status)}.`, "");
  }

  if (r.totals.length > 0 || r.currency[0] !== r.currency[1]) {
    const cur =
      r.currency[0] === r.currency[1]
        ? ` (${r.currency[0] ?? "no currency"})`
        : ` (${text(r.currency)})`;
    out.push(`## Totals${cur}`, "", "| | Low | Likely | High |", "|---|---:|---:|---:|");
    for (const t of r.totals) {
      out.push(
        `| ${t.what} | ${pair(t.low_minor, money)} | ${pair(t.likely_minor, money)} | ${pair(t.high_minor, money)} |`,
      );
    }
    out.push("");
  }
  return `${out.join("\n").trimEnd()}\n`;
}
