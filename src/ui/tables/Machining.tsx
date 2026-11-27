import { holeCells, holeColumns, NUMERIC_COLUMNS, partLines } from "#core/machining/format.ts";
import type { MachiningSheet as Sheet } from "#core/machining/machining.ts";
import { EntityChips } from "../common/EntityChip.tsx";
import { mm } from "../format.ts";
import type { Model } from "../model.ts";
import { registerSheet } from "../sheets/registry.ts";
import { outputPath } from "../store.ts";
import { optText, Stamp, useOutput } from "./common.tsx";

/** A custom part's holes, in the sheet's columns: from the part's datum, by type and size. */
function HoleTable({ p }: { p: Sheet["parts"][number] }) {
  if (p.holes.length === 0) return <p class="sub">No holes.</p>;
  const cols = holeColumns(p);
  const cls = (c: string | undefined) =>
    c !== undefined && NUMERIC_COLUMNS.has(c) ? "n" : undefined;
  return (
    <table class="grid">
      <thead>
        <tr>
          {cols.map((c) => (
            <th key={c} class={cls(c)}>
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {p.holes.map((h) => (
          <tr key={h.id} data-hole={h.id}>
            {holeCells(p, h).map((v, i) => (
              <td key={cols[i]} class={cls(cols[i])}>
                {v}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * The machining sheet (M6) in the sheet's own words (`alukit machining`): each custom plate and
 * bent angle, its stock and blank, and its holes from its datum; then the cut-list lines that
 * carry the bars' machining, whose operations are on the Cut list tab. Asked of the server when
 * shown: a fabricator's document most revisions never need. Owner: S4.
 */
export function MachiningSheet({ m }: { m: Model }) {
  const got = useOutput<Sheet>(outputPath("/api/machining"), m.rev);
  if (got === undefined) return <p class="panel-empty">Reading the machining sheet…</p>;
  if ("error" in got) {
    return <p class="panel-empty">Cannot load the machining sheet: {got.error}</p>;
  }
  const s = got.value;
  const stale = got.stale;
  return (
    <div
      data-testid="machining"
      data-rev={got.rev}
      class={stale ? "stale" : undefined}
      aria-busy={stale}
    >
      {s.lock !== undefined && (
        <p class="sub">
          <Stamp lock={s.lock} />
        </p>
      )}
      {s.parts.length === 0 && <p class="sub">No custom parts.</p>}
      {s.parts.map((p) => (
        <section key={p.item} data-item={p.item}>
          <h4>
            {p.item} <span class="sub">{p.name}</span>{" "}
            <span class="sub">
              · for <EntityChips ids={p.sources} />
            </span>
          </h4>
          {partLines(p).map((l) => (
            <p class="sub" key={l}>
              {l}
            </p>
          ))}
          <HoleTable p={p} />
        </section>
      ))}
      <section>
        <h4>Bars</h4>
        {s.bars.length === 0 ? (
          <p class="sub">No bar is machined.</p>
        ) : (
          <>
            <p class="sub">
              Each bar's machining is on the Cut list tab, from a named end. These lines carry some:
            </p>
            <table class="grid">
              <thead>
                <tr>
                  <th>item</th>
                  <th>options</th>
                  <th class="n">cut mm</th>
                  <th class="n">pieces</th>
                  <th class="n">ops each</th>
                  <th>bars</th>
                </tr>
              </thead>
              <tbody>
                {s.bars.map((b) => (
                  <tr key={b.sources.join(",")}>
                    <td>{b.item}</td>
                    <td>{optText(b.opt)}</td>
                    <td class="n">{mm(b.cut_mm, { table: true })}</td>
                    <td class="n">{b.count}</td>
                    <td class="n">{b.ops}</td>
                    <td>
                      <EntityChips ids={b.sources} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>
    </div>
  );
}

registerSheet({ id: "machining", title: "Machining", order: 20, Body: MachiningSheet });
