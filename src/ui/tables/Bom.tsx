import { EntityChips } from "../common/EntityChip.tsx";
import { kg, mm } from "../format.ts";
import type { Model } from "../model.ts";
import { registerSheet } from "../sheets/registry.ts";
import { optText, Stamp } from "./common.tsx";

/**
 * The bill of materials (design §8; `alukit bom`): by kind, each line's item, options, quantity,
 * length and mass, and what uses it; the total mass, and what has none. It comes with the
 * revision's model. Owner: S4.
 */
export function BomSheet({ m }: { m: Model }) {
  const b = m.bom;
  return (
    <div data-testid="bom">
      <p class="sub">
        Total mass {kg(b.mass_kg)} kg
        {b.mass_unknown.length > 0 && `, without ${b.mass_unknown.join(", ")} (no mass given)`}.{" "}
        <Stamp lock={b.lock} />
      </p>
      {b.groups.map((g) => (
        <section key={g.kind}>
          <h4>
            {g.kind} <span class="sub">· {kg(g.mass_kg)} kg</span>
          </h4>
          <table class="grid">
            <thead>
              <tr>
                <th>item</th>
                <th>name</th>
                <th>options</th>
                <th>qty</th>
                <th>length mm</th>
                <th>mass kg</th>
                <th>used by</th>
              </tr>
            </thead>
            <tbody>
              {g.lines.map((l) => (
                <tr key={`${l.item}${optText(l.opt)}`}>
                  <td>{l.item}</td>
                  <td>{l.name}</td>
                  <td>{optText(l.opt)}</td>
                  <td class="n">{l.qty}</td>
                  <td class="n">
                    {l.length_mm === undefined ? "" : mm(l.length_mm, { table: true })}
                  </td>
                  <td class="n" title={l.mass_src ? `mass: ${l.mass_src}` : "no mass"}>
                    {l.mass_kg === undefined ? "" : kg(l.mass_kg, { table: true })}
                  </td>
                  <td>
                    <EntityChips ids={l.sources} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}

registerSheet({ id: "bom", title: "BOM", order: 30, Body: BomSheet });
