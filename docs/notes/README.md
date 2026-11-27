# Decision notes

Each note records the calls made while building one milestone, where [`design.md`](../design.md)
was silent or ambiguous, with the reason for each. They are numbered per note; other documents
cite them as "m4a decision 13". Where the build differed from draft 2.2 of the design, see
[`design-vs-built.md`](design-vs-built.md); design draft 2.3 folds in those entries and the notes'
decisions that change what the design says, so the notes now hold the detail and the reasons.

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
| [`m4c-decisions.md`](m4c-decisions.md) | M4c, the v1 gaps: `?variant=` on the API, export and revisions through the server, the variant switch, the section plane, the record tabs, pivots and fastened joints in Connect, `catalog search`/`import`, `derive --select`; the cart image's "brace" |
| [`m5-decisions.md`](m5-decisions.md) | M5: variants, diff, revisions and their stamps, the GLB writer and its shared mesh modules, the agent skill |
| [`m6-decisions.md`](m6-decisions.md) | M6: project items (plates, bent angles, generic items, placeholders), hole features, mass formulas, the machining sheet, gap G-B |
| [`a3-face-contact.md`](a3-face-contact.md) | gap A3: face connections on a section's real outline faces (an angle's or a channel's inner faces), the fastener's walk, grip and holes through them, golden case G29 |
| [`acceptance-gaps.md`](acceptance-gaps.md) | the gaps the v1 acceptance found: connector fit by role, joint recipes, a hole into an end a butt bears on, cost lines in variants, `services_on` lists, a sleeve's hole clearance; golden cases G30–G32 and suggested design wording |
| [`acceptance-gaps-2.md`](acceptance-gaps-2.md) | the gaps the acceptance's second run found: a butt held by another butt's through-fastener (`held_by`), a connector's machining at positions, a splice's taps per stud, coincident machining as an error; golden cases G33–G34 and the design wording applied to draft 2.3 |
| [`v1-limits-closed.md`](v1-limits-closed.md) | three v1 limits closed after the third acceptance run: every output states the stamp, `bbox()` over every drawn body, an end tap checked against its section's cores |
| [`section-cores.md`](section-cores.md) | every Forseti T-slot section's cores, the base-40 corner holes among them, page by page; drawn sections' `cores`; the vendor's thread labels on each core; a tap's fit to its core (a label fits; else 6H minor diameter, one pitch of drilling up) |
| [`x4-stock-length.md`](x4-stock-length.md) | gap X4, from the alternative frame's acceptance: a piece is ordered, billed and nested at its span (one end cut's long point to the other's along the axis), which parallel cuts make longer than the long-point length; golden case G38; shared cut lines in nesting as a v1 limit |
| [`f2-joint-geometry.md`](f2-joint-geometry.md) | the joint geometry the fourth acceptance run found (F2): an end hole along its fastener's axis, a butt's end face on its face (overhang, overlap), a screw head's seat on material; golden cases G35–G37 |
| [`x1-x3-f2ab.md`](x1-x3-f2ab.md) | the joints the alternative frame's acceptance could not write, and two of F2's limits: a blind fastener (X1), a butt's stack of bodies the screw passes (X2), a plain bar held by a screw in a drilled hole (X3), head diameters from the cited standard (F2a), a butt connector's screw heads seat-checked (F2b), a tap over a groove's opening (X5), a sleeve through both walls (X6); golden cases G39 and up |
| [`x7-x8-f7.md`](x7-x8-f7.md) | the round-3 acceptance's gaps: an access hole at its connector's core and connectors placed by a recipe's fastener set (X7), a connector's own head and a domed head under the lips (X8), a far-face head only on the hole F2 makes (F7); the quick connector's data in the Forseti catalog; golden cases G46–G48 |
| [`x9-f8-f9.md`](x9-f8-f9.md) | the round-4 acceptance's gaps: a cross hole's mouth clear of the other members, the face named by a requirement or a mount's hole, the machining sheet naming it (X9); a head bearing on the lips' underside, hooked lips (F8); a profile's own groove, printed, measured or read off a raster image with its range, and what its drawing does not give (F9); golden case G49 |
| [`forseti-traced-sections.md`](forseti-traced-sections.md) | Forseti's profiles traced from the catalogue's raster drawings: the method and its sources, its check against vector outlines, the tolerance (2 % of area, 4 % of inertia) in the importer and in `catalog check`, each profile's result and why five traces are refused, the 20x20 V-slot's vector outline, grooves against their traces, and what moved |
