# M6 decisions: project items, hole features, the machining sheet, placeholders

*2026-11-26. Calls made while building M6 (custom plates and bent angles with hole features,
generic items and placeholders, the machining sheet, gap G-B) where [`design.md`](../design.md)
is silent or ambiguous. For the coordinator to fold into the design or veto.*

**No earlier golden value changed.** The cart's cut list is unchanged; its BOM, order list and
costs differ only by the added lines and the totals they feed (the BOM's total mass, the order
groups holding the new lines, the order totals, the share per supplier, `unpriced` 1 → 2, and
K5, the contingency, which is 10 % of the subtotal). G1–G21 and G27 pass as before.

## Formulas and their sources

| What | Formula | Source |
|---|---|---|
| Bend allowance, a bend of A° | BA = A · (π / 180) · (R + K · T): the length of the neutral fibre's arc, which runs K · T inside the inner face | Wikipedia, [Bending (metalworking)](https://en.wikipedia.org/wiki/Bending_(metalworking)), "Calculations" |
| Developed length, one 90° bend | L = (a − (R + T)) + (b − (R + T)) + BA, with a and b each measured to the outside of the other leg | Geometry: the outer face's arc, radius R + T, meets each outside face R + T from the virtual sharp, so each flat is its leg less R + T |
| Tap drill | major diameter − pitch; the pitch is ISO 261's coarse one unless the thread writes it (`M8x1`) | Wikipedia, [Drill and tap size chart](https://en.wikipedia.org/wiki/Drill_and_tap_size_chart) ("For metric V threads, major minus pitch yields a good tap drill diameter") and [Tap and die](https://en.wikipedia.org/wiki/Tap_and_die) (about a 75 % thread); coarse pitches from the ISO 262 table on [ISO metric screw thread](https://en.wikipedia.org/wiki/ISO_metric_screw_thread) |
| Countersink depth | h = ((D − d) / 2) / tan(θ / 2) | Geometry of the cone |
| Material a hole removes | drill: π d² / 4 × depth (the thickness when through); countersink: the frustum π h (D² + D d + d²) / 12 less the drill's cylinder over h; counterbore: π / 4 (D² − d²) × its depth | Geometry |
| Mass of a plate or a bent angle | (area × T − Σ removed) × density; area is the outline's (shoelace) or L × length. Rounded once per BOM line to 0.001 kg, tagged `calc` | §3.3's mass rule, applied to a volume |

## Items

| # | Decision | Why |
|---|---|---|
| 1 | The K-factor is required on a bent angle, 0 < K ≤ 0.5. No default | Published values run 0.3–0.5 by material, radius and tooling; DIN 6935's correction factor could not be checked against the standard's text. The shop that bends it knows its K |
| 2 | One 90° bend per bent angle in v1; legs given to the outside of the other leg, the inside radius as `bend_radius_mm` | How a bent angle is dimensioned on a drawing; other angles and more bends are later work |
| 3 | A project item holds numbers, not expressions | It is item data, resolved before derive like a catalog item's; a parametric plate is a catalog item (§3.4) |
| 4 | Plates and bent angles default to supplier `local` (made in-house), a group of its own in the order; placeholders and generic items without a supplier go to the unsourced group | A part drawn in the project is made by someone; `local` is the brief's word for it, and it keeps a fabricator's lines apart from what the user makes |
| 5 | A generic project item takes a price and a supplier, no packs or offers | Packs and offers belong in a project-local catalog (P18) |
| 6 | Items are validated one by one; each problem names `project:<id>` and the field, and a bad item does not hide the others | One bad hole should not mask the rest of the document |
| 7 | A material is a catalog material (`<catalog>:<id>`, never `project:`), checked against the lock or the live catalogs; the lock pins it | Density lives in the catalogs; `lock/refs.ts` already reads `items[*].material` |
| 8 | Canonical form: outline points and datum points are quantised to 0.01 mm, like other points; the K-factor is dimensionless | §2's quantum; a diff should not show float noise |
| 9 | An item with an invalid hole or outline has no mass (the BOM shows it missing) and still resolves for the rest | §5.1: report, then go as far as possible |

## Holes

| # | Decision | Why |
|---|---|---|
| 10 | A hole is `d_mm` (through, or blind with `depth_mm`), `thread` (tapped at its tap drill, or at `d_mm` when given), `csk {d_mm, angle_deg}` or `cbore {d_mm, depth_mm}`. Not both a countersink and a counterbore; neither on a threaded hole | The four kinds the brief names; the combinations a fabricator would query |
| 11 | A threaded hole may name its drill as `d_mm`, and must when the thread has no known pitch (`1/4-20 UNC`) | Charts round M8's 6.75 differently (the Wikipedia chart lists 6.9; 6.7 and 6.8 are common elsewhere); the shop's drill wins |
| 12 | `face`: front (default) is a plate's face away from its mounting face, or a leg's inside face; back is the other | A countersink or counterbore needs a side |
| 13 | Checks: a hole's widest radius (its countersink's or counterbore's) stays inside the outline; two holes do not overlap; a countersink or counterbore is wider than its drill; a counterbore is shallower than its hole; a blind hole is shallower than the thickness; a hole on a leg lies on that leg's flat, clear of the bend zone | Each is a hole a shop could not make, or would make wrong |

## The order (§5.5)

| # | Decision | Why |
|---|---|---|
| 14 | A project item is one order line of `unit`s under its supplier, priced as entered in the project's currency; no price band applies | It has no offer |
| 15 | `est-price` blocks and `stale-price` warns on a project item's price as on a catalog price; a bare number is an estimate. No price at all is `missing-price` ("no price") | One rule for every priced line |
| 16 | The `placeholder` rule holds only the group holding the placeholder's line: the unsourced group, or the supplier it names. An unpriced placeholder gives no `missing-price` besides | §5.5's table says "its own line, under unsourced"; the brief says "its supplier, or an unsourced group, not every supplier" |
| 17 | An open item's scope may name `project:<id>` | The cart's O2 holds the bracket until it is priced |

## The machining sheet

| # | Decision | Why |
|---|---|---|
| 18 | `alukit machining <dir> [--format md|json] [--frozen]`, schema `alukit.machining/1`; no CSV | A part's holes nest under the part; a flat CSV would repeat the part on every row |
| 19 | It lists every plate and bent angle the BOM counts (qty, the parts using it), its supplier, material, thickness, datum, outline (a plate) or legs, blank and bend (an angle), and each hole: id, leg, position from the datum, position on the blank, type, drill, thread, depth, countersink with its depth, counterbore, face | What a fabricator needs to make it |
| 20 | Datums: a plate's outline origin; an angle's heel at end 0 (y up each leg from the outside of the other); on its blank, leg a's free edge. The bend zone is given on the blank | One named datum per part, as the brief asks |
| 21 | Bars are cross-referenced, not repeated: each cut-list line with machining, by item, options, cut, count, operations per piece and bars | Bars' machining is the cut list's, from a named end |
| 22 | Placeholders and generic items are not on the sheet; an unused project item is not either, though its problems are still reported | Only what is made is machined |

## Gap G-B: a placeholder other bars bear on

No new rule. §4.5 already lets a butt run through `{ "body": <item>, "at": <point or pose> }`
with any item that has a box; what was missing was a project item to name. Project items now
resolve through the same item source derive uses, so `bodyPrism` reads a placeholder's
`bbox_mm`, measured from its `datums.mount` when it has one, as it reads a catalog cube's
(G5). The body is counted once, with the connection (`sources: ["c1"]`), and is not also a part.
**G28** (`tests/fixtures/golden-ends/G28`) has three bars bearing on a turned placeholder from x,
−y and above (480.00, 300.00, 220.00), with variations unturned, with a mount datum, moved, and
with no box (an `item` error); `by_hand.py` works each length with no AluKit import.

## The cart

| # | Decision | Why |
|---|---|---|
| 23 | Added: p6, a steel motor plate from `test-fab` (8 mm, a cut corner; M6 tapped, Ø6.6 countersunk, Ø6.6 counterbored, Ø8.5 through; quoted R$ 85.00); p7, a 3 mm aluminium bent angle made locally (Ø5.5 on leg a, M4 on leg b; no price, held by O2); p8, a placeholder gear motor (2.8 kg, R$ 300–700, likely 450, unsourced) | The three things the brief asks for, each in a different order group |
| 24 | `expected-machining.json` is written by the hand script exactly as `JSON.stringify(x, null, 2)` prints it and excluded from Biome, like `expected-order.json` | Compared byte for byte |
| 25 | `expected-bom.json` gains an `unrounded` block: the plate's and the angle's masses and the angle's developed length before the output quantum | So the test checks the hand calculation to 1e-12, not only to 0.001 kg |

## The merge into main, and what it folded in

Main had gained M4a: the server that owns the document, the viewer and its drawer, `/api/order`
and `/api/costs`. The README was the one conflict, and both sides were kept. The CLI merged with
every command, `machining` among them. `lock update` and `fmt` leave the cart and G28 as they are.
Decisions 26–33 join M6 to the server and the viewer. Labels as in M4a's note: **verified** (run,
with how), **read**, **inferred**.

| # | Decision | Why |
|---|---|---|
| 26 | The server needed no change to count project items: derive, the BOM, the order and the machining sheet wrap whatever item source they are given with `projectItems`, so the server's lock-backed source gets them too | **Verified**: `server.test.ts`, unchanged, still finds the cart's `/api/order` equal to `expected-order.json` (as M6 left it) plus the lock's stamp, byte for byte |
| 27 | `GET /api/machining` answers what `alukit machining --format json` prints, byte for byte. Both build it with `checkedMachining`: the revision's `machining()` output, a stage-5 output computed on first use like the cut list and the BOM, plus the problems met deriving the model and building those two | One function for both, as `checkedOrder` is for the order (M4a decision 41). **Verified**: `server.test.ts`, the cart's answer equals `expected-machining.json` and the CLI's output |
| 28 | The drawer's Machining tab sits next to Cut list. It fetches `/api/machining` when shown and at each revision the scene draws, keeping an older answer dimmed, as Order and Costs do. Its sentences and hole columns are the Markdown sheet's (`partLines`, `holeColumns`, `holeCells`), so the tab and `alukit machining` say the same. A part's sources select it in the scene | §8; M4a decision 42. **Verified**: `outputs.spec.ts`, each part and hole against the CLI's JSON, and a CLI `setItem` (the plate 10 mm thick) reaching the tab live. The Markdown sheet is the same, byte for byte, before and after the split, for the cart and G28 |
| 29 | `LOCAL` moved to a leaf module, `project-items/supplier.ts`; `resolve.ts` imports it from there | Before, the sheet's wording could reach the app's bundle only through the resolver and the zod catalog schemas behind it. **Verified**: the built bundle has no zod |
| 30 | The view model reads parts' items through `projectItems`, as derive does. Each placed project plate or bent angle carries its shape (`display.parts[id].shape`): its outline or legs, length and bend radius, its thickness, and its holes as the sheet values them. A placeholder is flagged, and a project item's mass comes with its source. The properties panel shows a project part's item as the document writes it, with that mass | Before, a project item's box was looked up in the lock alone: p6, p7 and p8 each drew as a 20 mm marker. Principle 3 for the mass |
| 31 | Drawing (`src/mesh/items.ts`, Node-safe like `bars.ts`). A plate is its outline extruded from z = 0 to T. A bent angle is an L section with its inside (R) and outside (R + T) arcs about one centre, extruded along x: leg a lies on the mounting face along +y, leg b rises along +z, so its box is resolve.ts's [0, 0, 0]–[L, a, b]. A placeholder is its box, translucent and outlined; hatching still waits for a texture (M4a decision 34). A shape that cannot be drawn (an outline of fewer than three corners, a leg not longer than R + T) is drawn as its box, and the checks say why | §3.2's frame; decisions 2, 12 and 20. **Verified**: `mesh.test.ts`. The plate's volume is exactly area × T. The angle's is within 0.1 % of its section × L, and every vertex lies on a flat or in the bend |
| 32 | Holes are marked, not cut. Each hole is a dark rod of its drill's diameter through the material, or as deep as a blind hole, from its face. A countersink or counterbore adds a wider rod as deep as itself. Each rod stands 0.5 mm proud of the face, so it shows. They are one `InstancedMesh`; a pick selects the part, and selection does not recolour them | A cut needs CSG, and the shop works from the sheet, not the picture. **Verified**: `mesh.test.ts`, the cart's rods against the sheet's holes, and by eye on a two-bar scratch project with p6–p8 |
| 33 | Test hook: `stats()` adds `plates`, `bentAngles`, `placeholders` and `holes` (holes marked, not rods) | M4a decision 39. The rendering test checks one body per placed part from `alukit derive --json` and the holes from `alukit machining` |

**Test expectations changed by the merge.** `tests/e2e/canvas.spec.ts` checked that the cart drew
3 parts, and that a box over the viewport selected 42 entities. It now draws 6 parts (the three
carriages, plus M6's p6, p7 and p8, all placed), and the box selects 45. The 39 bars are
unchanged. No unit or server test hard-coded a cart count, and the `/api/order` test reads
`expected-order.json`, so no other expectation changed. No golden value changed.

**Found while checking by eye, and fixed.** The app's grid gave `.main` the fourth row only when
both banners rendered. With neither, it was placed in an `auto` row, and the empty `1fr` row took
the rest of the window. The cart's long tree hid this; a short project's viewport shrank to its
tree. `.main` and the drawer now name their rows.
