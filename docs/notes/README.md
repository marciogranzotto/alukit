# Decision notes

Each note records the calls made while building one milestone, where [`design.md`](../design.md)
was silent or ambiguous, with the reason for each. They are numbered per note; other documents
cite them as "m4a decision 13". Where the build differs from the design, see
[`design-vs-built.md`](design-vs-built.md).

| Note | Covers |
|---|---|
| [`m1-decisions.md`](m1-decisions.md) | M1, the catalog core: file layout, schemas and ids, the three-layer merge, units and suffixes, sections and section properties, computed-against-published |
| [`m2a-decisions.md`](m2a-decisions.md) | M2a, the first catalogs: Forseti's importer, offers and price fields, `std` and `ref-hiwin`, factory ends and rail drilling data |
| [`m2b-decisions.md`](m2b-decisions.md) | M2b, the rest of Forseti: all 1,196 orderable SKUs mapped to offers, the extra stock-length offers, and what the shop data turned up |
| [`std-hiwin-verification.md`](std-hiwin-verification.md) | every number and citation in `std` and `ref-hiwin` compared with a public source: verified, corrected or unverifiable |
| [`m3a-decisions.md`](m3a-decisions.md) | M3a, the geometry core: golden cases, frames and anchors, stations, end planes, butt/miter/splice/pivot rules, the cut list |
| [`g-a-end-bearing.md`](g-a-end-bearing.md) | gap G-A: a strut bearing on a shoe mitred square to it, and the `plane.normal` rule that closes it |
| [`m3b-gen-decisions.md`](m3b-gen-decisions.md) | M3b part 1, generation: rail holes, parts on stations, face fastenings, connector hardware and machining, the BOM |
| [`m3b-doc-decisions.md`](m3b-doc-decisions.md) | M3b part 2, the edit path: canonical form, commands and ids, undo steps, `new`/`do`/`add`/`query`/`check`/`fmt`, the lock file and `lock update`, expressions in checks |
| [`m3b-order-decisions.md`](m3b-order-decisions.md) | M3b part 3: offer selection, the order list per supplier, the order rules, cost lines and totals, price bands |
| [`m4a-decisions.md`](m4a-decisions.md) | M4a, the viewer and the server that owns the document: history and the watcher, the API and its security, rendering, the drawer's tabs, `pnpm dev` |
| [`m4b-decisions.md`](m4b-decisions.md) | M4b, drawing with the mouse: the base-frame oracle, draw/connect/place/pattern/measure, snapping, the work plane, the catalog browser, cameras and `snapshot` |
| [`m5-decisions.md`](m5-decisions.md) | M5: variants, diff, revisions and their stamps, the GLB writer and its shared mesh modules, the agent skill |
| [`m6-decisions.md`](m6-decisions.md) | M6: project items (plates, bent angles, generic items, placeholders), hole features, mass formulas, the machining sheet, gap G-B |
