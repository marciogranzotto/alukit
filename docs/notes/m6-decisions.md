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
