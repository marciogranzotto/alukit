import type { CutGroup, CutLine } from "#core/cutlist/cutlist.ts";
import { endText } from "#core/cutlist/format.ts";
import { DrawABar, EmptyState, OpenCatalog } from "../common/EmptyState.tsx";
import { EntityChips } from "../common/EntityChip.tsx";
import { Num } from "../common/Num.tsx";
import { date, mm, qty, withUnit } from "../format.ts";
import type { Model } from "../model.ts";
import { selectionOnly } from "../sheets/registry.ts";
import { anySelected, type Col, optText, Row, Sheet, SheetBar, SheetTable } from "./common.tsx";
import { EndsPictogram, GroupTitle, MachiningCell, StockDiagram } from "./pictograms.tsx";

/**
 * The cut list (design §8; `alukit cutlist`; docs/ux/visual-design.md §6.2): groups by item and
 * options, most pieces first, so the frame's main profile leads. Each line is a count, the cut
 * length as the row's figure (the centre-line, span and ordered lengths on a second line when they
 * differ), the two ends drawn and written, the machining as pills, and the bars it is for; a
 * group cut from stock bars comes with a cutting diagram. One table, one set of columns, for the
 * whole sheet. It comes with the revision's model. Owner: S4.
 */

const COLS: readonly Col[] = [
  { id: "qty", head: "Qty", w: "56px", align: "right" },
  { id: "cut", head: "Cut length", unit: "mm", w: "200px", align: "right" },
  { id: "ends", head: "Ends", w: "230px" },
  { id: "machining", head: "Machining" },
  { id: "bars", head: "Bars", w: "290px" },
];

/** The second line under a cut length: the other lengths the piece has, when they differ. */
function otherLengths(l: CutLine): string[] {
  const out: string[] = [];
  if (l.centre_mm !== undefined && l.centre_mm !== l.cut_mm) {
    out.push(`centre ${mm(l.centre_mm, { table: true })}`);
  }
  if (l.span_mm !== undefined && l.span_mm !== l.cut_mm) {
    out.push(`span ${mm(l.span_mm, { table: true })}`);
  }
  if (l.ordered_mm !== undefined && l.ordered_mm !== l.cut_mm) {
    out.push(`ordered ${mm(l.ordered_mm, { table: true })}`);
  }
  return out;
}

function supply(g: CutGroup): string {
  return g.mode === "cut"
    ? `Cut to order, ${g.offer}`
    : g.mode === "stock"
      ? "From stock bars"
      : "No offer by length";
}

function Group({ g }: { g: CutGroup }) {
  const opt = optText(g.opt);
  // Selection only: a group with no line of the selection is not shown, head and diagram included.
  if (selectionOnly.value && !g.lines.some((l) => anySelected(l.sources))) return null;
  return (
    <tbody data-group={`${g.item}${opt}`}>
      <tr class="group-head">
        <td colSpan={COLS.length}>
          <div class="group-title">
            <GroupTitle g={g} />
            {opt && <span class="sub">{opt}</span>}
            <span class="stats">
              <span class="stat">
                <span class="stat-k">Pieces</span>{" "}
                <span class="stat-v">{qty(g.pieces, { table: true })}</span>
              </span>
              <span class="stat">
                <span class="stat-k">Total</span>{" "}
                <span class="stat-v">{withUnit(mm(g.total_mm), "mm")}</span>
              </span>
              <span class="stat">
                <span class="stat-k">Supply</span> <span class="stat-v">{supply(g)}</span>
              </span>
            </span>
          </div>
        </td>
      </tr>
      {g.lines.map((l) => (
        <Row key={l.sources.join(",")} class="cut-row" ids={l.sources}>
          <td class="n">{qty(l.count)} ×</td>
          <td class="n">
            <div class="figure">
              <Num text={mm(l.cut_mm, { table: true })} />
            </div>
            {otherLengths(l).length > 0 && <div class="second">{otherLengths(l).join(" · ")}</div>}
          </td>
          <td>
            <div class="ends">
              <EndsPictogram a={l.ends.a} b={l.ends.b} />
              <span class="ends-text">
                {endText(l.ends.a)} / {endText(l.ends.b)}
              </span>
            </div>
          </td>
          <td>
            <MachiningCell machining={l.machining} rail={l.rail} />
          </td>
          <td>
            <EntityChips ids={l.sources} />
          </td>
        </Row>
      ))}
      {g.stock?.map((bar, i) => (
        <tr class="diagram" key={i}>
          <td colSpan={COLS.length}>
            <StockDiagram g={g} bar={bar} />
          </td>
        </tr>
      ))}
    </tbody>
  );
}

export function CutListSheet({ m }: { m: Model }) {
  const cl = m.cutlist;
  if (cl.groups.length === 0) {
    return (
      <Sheet testid="cutlist">
        <EmptyState
          title="Nothing to cut yet"
          actions={
            <>
              <DrawABar />
              <OpenCatalog />
            </>
          }
        >
          Draw a bar, or set a profile from the catalog as the palette.
        </EmptyState>
      </Sheet>
    );
  }
  // Most pieces first; equal counts keep the CLI's order (the item id's).
  const groups = cl.groups
    .map((g, i) => ({ g, i }))
    .sort((a, b) => b.g.pieces - a.g.pieces || a.i - b.i)
    .map((x) => x.g);
  return (
    <Sheet testid="cutlist">
      <SheetBar lock={cl.lock}>
        <span class="sub">
          Prices on the {cl.price_basis} basis; the oldest was read{" "}
          {cl.oldest_read ? date(cl.oldest_read) : "(none)"}
        </span>
      </SheetBar>
      <SheetTable cols={COLS}>
        {groups.map((g) => (
          <Group key={`${g.item}${optText(g.opt)}`} g={g} />
        ))}
      </SheetTable>
    </Sheet>
  );
}
