import { EntityChips } from "../common/EntityChip.tsx";
import { ItemSwatch } from "../common/ItemSwatch.tsx";
import { Num } from "../common/Num.tsx";
import { StatusGlyph } from "../common/StatusGlyph.tsx";
import { kg, mm, qty, withUnit } from "../format.ts";
import type { Model } from "../model.ts";
import { selectionOnly } from "../sheets/registry.ts";
import { anySelected, type Col, optText, Row, Sheet, SheetBar, SheetTable } from "./common.tsx";

/**
 * The bill of materials (design §8; `alukit bom`; docs/ux/visual-design.md §6.2): by kind, with
 * each kind's mass at the figure size; each line's item (with its swatch), options, quantity,
 * length and mass, an `estimate` triangle where the mass is estimated, and what uses it. The
 * total mass, and what has none, sit in the strip above. It comes with the revision's model.
 * Owner: S4.
 */

const COLS: readonly Col[] = [
  { id: "item", head: "Item", w: "300px" },
  { id: "options", head: "Options" },
  { id: "qty", head: "Qty", w: "64px", align: "right" },
  { id: "length", head: "Length", unit: "mm", w: "120px", align: "right" },
  { id: "mass", head: "Mass", unit: "kg", w: "112px", align: "right" },
  { id: "used", head: "Used by", w: "230px" },
];

export function BomSheet({ m }: { m: Model }) {
  const b = m.bom;
  return (
    <Sheet testid="bom">
      <SheetBar lock={b.lock}>
        <span>
          Total mass <b class="figure">{withUnit(kg(b.mass_kg), "kg")}</b>
        </span>
        {b.mass_unknown.length > 0 && (
          <span class="sub"> without {b.mass_unknown.join(", ")} (no mass given)</span>
        )}
      </SheetBar>
      <SheetTable cols={COLS}>
        {b.groups.map((g) =>
          selectionOnly.value && !g.lines.some((l) => anySelected(l.sources)) ? null : (
            <tbody key={g.kind} data-kind={g.kind}>
              <tr class="group-head">
                <td colSpan={COLS.length}>
                  <div class="group-title">
                    <span class="figure kind">{g.kind}</span>
                    <span class="stats">
                      <span class="stat">
                        <span class="stat-k">Mass</span>{" "}
                        <span class="stat-v">{withUnit(kg(g.mass_kg), "kg")}</span>
                      </span>
                    </span>
                  </div>
                </td>
              </tr>
              {g.lines.map((l) => (
                <Row key={`${l.item}${optText(l.opt)}`} ids={l.sources}>
                  <td>
                    <span class="item-cell">
                      <ItemSwatch item={l.item} />
                      <b>{l.item}</b> <span class="sub">{l.name}</span>
                    </span>
                  </td>
                  <td>{optText(l.opt)}</td>
                  <td class="n">{qty(l.qty, { table: true })}</td>
                  <td class="n">
                    {l.length_mm === undefined ? (
                      ""
                    ) : (
                      <Num text={mm(l.length_mm, { table: true })} />
                    )}
                  </td>
                  <td class="n" title={l.mass_src ? `mass: ${l.mass_src}` : "no mass"}>
                    {l.mass_src === "est" && (
                      <span class="est" title="The mass is an estimate">
                        <StatusGlyph status="warn" size={12} />
                        <span class="sr-only">estimate </span>
                      </span>
                    )}
                    {l.mass_kg === undefined ? "" : <Num text={kg(l.mass_kg, { table: true })} />}
                  </td>
                  <td>
                    <EntityChips ids={l.sources} />
                  </td>
                </Row>
              ))}
            </tbody>
          ),
        )}
      </SheetTable>
    </Sheet>
  );
}
