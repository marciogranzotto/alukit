import { holeCells, holeColumns, NUMERIC_COLUMNS, partLines } from "#core/machining/format.ts";
import type { MachiningSheet as MachiningAnswer } from "#core/machining/machining.ts";
import { EmptyState } from "../common/EmptyState.tsx";
import { EntityChips } from "../common/EntityChip.tsx";
import { ItemSwatch } from "../common/ItemSwatch.tsx";
import { Num } from "../common/Num.tsx";
import { mm, qty } from "../format.ts";
import type { Model } from "../model.ts";
import { registerSheet, selectionOnly } from "../sheets/registry.ts";
import { outputPath } from "../store.ts";
import {
  anySelected,
  type Col,
  optText,
  Row,
  Sheet,
  SheetBar,
  SheetTable,
  useOutput,
} from "./common.tsx";

/** A cell that is a plain number (a hole's position, a diameter): digits as figures. */
const NUMBER = /^-?\d+(\.\d+)?$/;

/** A custom part's holes, in the sheet's columns: from the part's datum, by type and size. */
function HoleTable({ p }: { p: MachiningAnswer["parts"][number] }) {
  if (p.holes.length === 0) return <p class="sub">No holes.</p>;
  const names = holeColumns(p);
  const cols: Col[] = names.map((c) => ({
    id: c,
    head: c,
    ...(NUMERIC_COLUMNS.has(c) ? { align: "right" as const, w: "96px" } : {}),
  }));
  return (
    <SheetTable cols={cols}>
      <tbody>
        {p.holes.map((h) => (
          <Row key={h.id} data-hole={h.id}>
            {holeCells(p, h).map((v, i) => (
              <td key={names[i]} class={NUMERIC_COLUMNS.has(names[i] ?? "") ? "n" : undefined}>
                {NUMBER.test(v) ? <Num text={v} /> : v}
              </td>
            ))}
          </Row>
        ))}
      </tbody>
    </SheetTable>
  );
}

const BAR_COLS: readonly Col[] = [
  { id: "item", head: "Item", w: "260px" },
  { id: "options", head: "Options" },
  { id: "cut", head: "Cut length", unit: "mm", w: "128px", align: "right" },
  { id: "pieces", head: "Pieces", w: "72px", align: "right" },
  { id: "ops", head: "Operations each", w: "132px", align: "right" },
  { id: "bars", head: "Bars", w: "230px" },
];

/**
 * The machining sheet (M6) in the sheet's own words (`alukit machining`): each custom plate and
 * bent angle, its stock and blank, and its holes from its datum; then the cut-list lines that
 * carry the bars' machining, whose operations are on the Cut list sheet. Asked of the server when
 * shown: a fabricator's document most revisions never need. Owner: S4.
 */
export function MachiningSheet({ m }: { m: Model }) {
  const got = useOutput<MachiningAnswer>(outputPath("/api/machining"), m.rev);
  if (got === undefined) return <p class="panel-empty">Reading the machining sheet…</p>;
  if ("error" in got) {
    return <p class="panel-empty">Cannot load the machining sheet: {got.error}</p>;
  }
  const s = got.value;
  const empty = s.parts.length === 0 && s.bars.length === 0;
  return (
    <Sheet testid="machining" rev={got.rev} stale={got.stale}>
      <SheetBar lock={s.lock} />
      {empty && (
        <EmptyState title="Nothing to machine">
          No custom part has holes and no bar carries machining.
        </EmptyState>
      )}
      {s.parts.length === 0 && !empty && <p class="sub pad">No custom parts.</p>}
      {s.parts.map((p) =>
        selectionOnly.value && !anySelected(p.sources) ? null : (
          <section key={p.item} data-item={p.item} class="block">
            <h4 class="block-head">
              <ItemSwatch item={p.item} />
              <span class="figure">{p.item}</span> <span class="sub">{p.name}</span>
              <span class="sub">
                {" "}
                for <EntityChips ids={p.sources} />
              </span>
            </h4>
            {partLines(p).map((l) => (
              <p class="sub part-line" key={l}>
                {l}
              </p>
            ))}
            <HoleTable p={p} />
          </section>
        ),
      )}
      {s.bars.length > 0 &&
        (!selectionOnly.value || s.bars.some((b) => anySelected(b.sources))) && (
          <section class="block">
            <h4 class="block-head">
              <span class="figure">Bars</span>
            </h4>
            <p class="sub part-line">
              Each bar's machining is on the Cut list sheet, from a named end. These lines carry
              some:
            </p>
            <SheetTable cols={BAR_COLS}>
              <tbody>
                {s.bars.map((b) => (
                  <Row key={b.sources.join(",")} ids={b.sources}>
                    <td>
                      <span class="item-cell">
                        <ItemSwatch item={b.item} />
                        <b>{b.item}</b>
                      </span>
                    </td>
                    <td>{optText(b.opt)}</td>
                    <td class="n">
                      <Num text={mm(b.cut_mm, { table: true })} />
                    </td>
                    <td class="n">{qty(b.count, { table: true })}</td>
                    <td class="n">{qty(b.ops, { table: true })}</td>
                    <td>
                      <EntityChips ids={b.sources} />
                    </td>
                  </Row>
                ))}
              </tbody>
            </SheetTable>
          </section>
        )}
    </Sheet>
  );
}

registerSheet({ id: "machining", title: "Machining", order: 30, Body: MachiningSheet });
