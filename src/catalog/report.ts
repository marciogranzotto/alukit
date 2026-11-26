import { quantize } from "#core/quantum.ts";
import type { CheckReport, Compared, PropertyRow } from "./check.ts";
import type { Diagnostic } from "./diagnostics.ts";

/**
 * The check report as text and as JSON. Numbers are quantised (design §2, §5.2): lengths to
 * 0.01 mm and mass to 0.001 kg as §2 says; §2 sets no quantum for areas, moduli and second
 * moments, so they take 0.01 in their own unit, and differences 0.01 %.
 */

const PER_UNIT: Record<Compared, number> = {
  area_mm2: 100,
  Ix_mm4: 100,
  Iy_mm4: 100,
  Wx_mm3: 100,
  Wy_mm3: 100,
  mass_kg_per_m: 1000,
};

function q(field: Compared, x: number): number {
  return quantize(x, PER_UNIT[field]);
}

/** A difference as a percentage, quantised to 0.01 %. */
function pct(diff: number): number {
  return quantize(diff * 100, 100);
}

export function reportJson(r: CheckReport): unknown {
  return {
    catalog: r.catalog,
    ok: r.counts.errors === 0,
    counts: r.counts,
    uncomputed: r.uncomputed,
    computed_vs_published: r.rows.map((row) => ({
      item: row.item,
      section: row.section,
      fidelity: row.fidelity,
      field: row.field,
      computed: q(row.field, row.computed),
      ...(row.published !== undefined ? { published: row.published } : {}),
      ...(row.diff !== undefined ? { diff_pct: pct(row.diff) } : {}),
      status: row.status,
      ...(row.why ? { why: row.why } : {}),
    })),
    diagnostics: r.diagnostics,
  };
}

function table(head: string[], body: string[][]): string[] {
  const widths = head.map((h, i) =>
    Math.max(h.length, ...body.map((row) => (row[i] ?? "").length)),
  );
  const line = (cells: string[]) =>
    cells
      .map((c, i) => (i === cells.length - 1 ? c : c.padEnd(widths[i] as number)))
      .join("  ")
      .trimEnd();
  return [line(head), ...body.map(line)];
}

function fmt(field: Compared, x: number): string {
  const v = q(field, x);
  return field === "mass_kg_per_m" ? v.toFixed(3) : v.toFixed(2);
}

function diffText(row: PropertyRow): string {
  if (row.diff === undefined) return "";
  const p = pct(row.diff);
  return `${p > 0 ? "+" : ""}${p.toFixed(2)} %`;
}

function diagLines(ds: Diagnostic[]): string[] {
  return ds.flatMap((d) => {
    const head = [d.code, d.entity, d.field].filter(Boolean).join("  ");
    return [
      `  ${head}`,
      `    ${d.message}`,
      ...(d.files.length ? [`    files: ${d.files.join(", ")}`] : []),
    ];
  });
}

export function reportText(r: CheckReport): string {
  const out: string[] = [
    `catalog ${r.catalog}: ${r.counts.items} items, ${r.counts.offers} offers, ${r.counts.sections} sections`,
  ];
  if (r.rows.length > 0) {
    out.push(
      "",
      "Computed against published (design §3.6; beyond 1 % is a mismatch unless accepted)",
    );
    out.push(
      ...table(
        ["item", "section", "fidelity", "field", "computed", "published", "diff", "status"],
        r.rows.map((row) => [
          row.item,
          row.section,
          row.fidelity,
          row.field,
          fmt(row.field, row.computed),
          row.published === undefined ? "-" : String(row.published),
          diffText(row),
          row.status === "accepted" ? `accepted: ${row.why ?? ""}` : row.status,
        ]),
      ).map((l) => `  ${l}`),
    );
  }
  if (r.uncomputed.length > 0) {
    out.push("", `Not computed (the section's props_ok is false): ${r.uncomputed.join(", ")}`);
  }
  for (const [severity, title] of [
    ["error", "Errors"],
    ["warn", "Warnings"],
    ["info", "Notes"],
  ] as const) {
    const ds = r.diagnostics.filter((d) => d.severity === severity);
    if (ds.length > 0) out.push("", `${title} (${ds.length})`, ...diagLines(ds));
  }
  const { errors, warnings } = r.counts;
  out.push(
    "",
    errors > 0
      ? `FAILED: ${errors} error${errors === 1 ? "" : "s"}, ${warnings} warning${warnings === 1 ? "" : "s"}`
      : `OK${warnings > 0 ? ` with ${warnings} warning${warnings === 1 ? "" : "s"}` : ""}`,
  );
  return out.join("\n");
}
