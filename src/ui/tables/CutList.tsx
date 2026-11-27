import { endText, machiningText, railText } from "#core/cutlist/format.ts";
import { EntityChips } from "../common/EntityChip.tsx";
import { mm } from "../format.ts";
import type { Model } from "../model.ts";
import { registerSheet } from "../sheets/registry.ts";
import { optText, Stamp } from "./common.tsx";

/**
 * The cut list (design §8; `alukit cutlist`): its groups by item and options, each line's count,
 * cut, centre and span, end cuts, machining and the pieces it is for, and the stock bars a group
 * is cut from. It comes with the revision's model. Owner: S4.
 */
export function CutListSheet({ m }: { m: Model }) {
  const cl = m.cutlist;
  if (cl.groups.length === 0) return <p class="panel-empty">No pieces.</p>;
  return (
    <div data-testid="cutlist">
      <p class="sub">
        Prices on the {cl.price_basis} basis; the oldest was read {cl.oldest_read ?? "(none)"}.{" "}
        <Stamp lock={cl.lock} />
      </p>
      {cl.groups.map((g) => (
        <section key={`${g.item}${optText(g.opt)}`}>
          <h4>
            {g.item} <span class="sub">{g.name}</span>{" "}
            {optText(g.opt) && <span class="sub">({optText(g.opt)})</span>}
            <span class="sub">
              {" "}
              · {g.pieces} piece{g.pieces === 1 ? "" : "s"}, {mm(g.total_mm)} mm ·{" "}
              {g.mode === "cut"
                ? `cut to order (${g.offer})`
                : g.mode === "stock"
                  ? `from stock bars`
                  : "no offer by length"}
            </span>
          </h4>
          <table class="grid">
            <thead>
              <tr>
                <th>count</th>
                <th>cut mm</th>
                <th>centre mm</th>
                <th>span mm</th>
                <th>ends a / b</th>
                <th>machining</th>
                <th>pieces</th>
              </tr>
            </thead>
            <tbody>
              {g.lines.map((l) => (
                <tr key={l.sources.join(",")}>
                  <td class="n">{l.count}</td>
                  <td class="n">{mm(l.cut_mm, { table: true })}</td>
                  <td class="n">
                    {l.centre_mm === undefined ? "" : mm(l.centre_mm, { table: true })}
                  </td>
                  <td class="n">{l.span_mm === undefined ? "" : mm(l.span_mm, { table: true })}</td>
                  <td>
                    {endText(l.ends.a)} / {endText(l.ends.b)}
                  </td>
                  <td>
                    {[
                      ...(l.rail ? [railText(l.rail)] : []),
                      ...l.machining.map(machiningText),
                    ].join("; ")}
                  </td>
                  <td>
                    <EntityChips ids={l.sources} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {g.stock && (
            <p class="sub">
              {g.stock.length} stock bar{g.stock.length === 1 ? "" : "s"}:{" "}
              {g.stock.map((s) => `${s.length_mm} (offcut ${mm(s.offcut_mm)})`).join(", ")}
            </p>
          )}
        </section>
      ))}
    </div>
  );
}

registerSheet({ id: "cutlist", title: "Cut list", order: 10, Body: CutListSheet });
