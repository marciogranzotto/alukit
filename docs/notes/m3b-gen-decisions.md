# M3b decisions: generation and the BOM

*2026-11-26. Calls made while building M3b part 1 (stage 4 of derive: rail holes, parts on
stations, face fastenings, connector hardware and machining; and the BOM) where
[`design.md`](../design.md) is silent or ambiguous. For the coordinator to fold into the design or
veto. Part 2 (commands, canonical form, lock file) and part 3 (offers, order list, costs, G26) are
built elsewhere.*

**No golden value was found wrong.** G22–G25 pass to 0.01 mm with the design's numbers as written.
G22 was re-derived by hand (factory a: 30 + 60k while 1210 − 30 − 60k ≥ 20, k ≤ 19, so 20 holes and
E_b = 40; drilled: 20 + (1170 − 1140) / 2 = 35), and G25's grip is 10 + 20 + 50 + 20 + 10 + 0.5.
G1–G21 still pass unchanged.

## Fixtures

| # | Decision | Why |
|---|---|---|
| 1 | A third synthetic catalog, `tests/fixtures/catalogs/test-gen/`: rail G (pitch 60, E 20–50) sold in 1500 with `factory_E_mm` 30, a plain flat of the same use, carriage G, an end connector with `requires`, an M5x25 screw and an M5 T-nut for groove c8 | G22–G24 need a rail whose numbers match the design's table; `test/` is M1's oracle and `test-geo/` M3a's |
| 2 | `golden-gen/Gnn/{alukit.json, expected.json}`, as for G1–G21: the design's values verbatim, variations as merge patches, errors as the exact set | One document per case |
| 3 | The cart's hand script is now `hand/cart_by_hand.py` and writes both `expected-cutlist.json` and `expected-bom.json`. It still imports nothing from AluKit, and has its own canonical orientation and nesting | §12: worked by hand, independently |
| 4 | The cart gains: a rail run `r2` of two 470 pieces of `test:RAIL20`, each with its factory end at the splice and `stock_mm: 1000`, nested into one 1000 bar; a carriage `p1` with a pattern of three, the third across the joint; rail screws into T-nuts in the middle rail's groove at a `rail_holes` selection (every 2, plus first, last, joint: ten); a nut under the head of the bolted stack; an unplaced line of ten T-nuts | §12's M3b classes; the splice taps, clearance holes, rods and sleeves now come out of what the cart already declared |

## Rails (§4.7)

| # | Decision | Why |
|---|---|---|
| 5 | A rail's holes are a record on the bar (`rail`: how, factory end, stock length, pitch, every hole position, E at each end), not one op per hole. The cut list prints it as "8 holes at 60.00, E 20.00 at a (factory) / 30.00 at b" | The holes come with the rail (factory) or are its standard drilling; §5.3 asks rails to "list E at each end" |
| 6 | E is measured along the box centre line, where the holes stand, from each end face | An angled end would otherwise give two E |
| 7 | `holes` absent: `factory: "a"` with a warning when an offer sells the rail in stock lengths, else drilled to order | A stock rail always keeps a factory end; which one is the author's |
| 8 | A factory end takes `factory_E_mm` from the stock offers. Offers that state none take the centred layout's as an estimate (catalog linking, M2a). When the lengths differ in E, `stock_mm` must name one (an error otherwise, laid out from the shortest length that holds the piece); a `stock_mm` nobody sells is an error. With `stock_mm` the piece nests only in that length | The holes depend on the length's factory end; nesting must never move one (G23) |
| 9 | A factory end must be square (an error) | Its factory cut is square |
| 10 | Holes start at E from the factory end and continue while the cut end keeps at least `E_min_mm`; E outside `E_min`–`E_max` at either end is an error on `<bar>.<end>` | G22 |
| 11 | A `rail_holes` selection numbers every hole of the rail or run from its start. `every: n` (default 1) takes holes 1, 1 + n, 1 + 2n, …; `plus` adds the first, the last, and, per joint, the last hole before it and the first after; each hole once, in order | G24's ten stations |
| 12 | A pattern `rail_holes` puts its template's `at_mm` as an offset from each selected hole (0 is on the hole), and takes no `from` | A carriage on a hole, or beside it |

## Parts on stations (§4.3)

| # | Decision | Why |
|---|---|---|
| 13 | A part's frame on a station: z is the face's outward normal (the bar's local y when no face is named), x is the bar's t, y = z × x, then `roll_deg` about z. The `run` datum of a carriage lands on the station, else `mount`, else the item's origin | A carriage rides its rail's top along it; a station with no face is on the design line |
| 14 | A carriage must share its rail's `rail_system` (`fit` error) | §3.4 |
| 15 | A station on a run's joint is a `joint` error (G24 at 470) | §4.3 |
| 16 | An unplaced line (`unplaced: true`, `qty`, `why`) counts in the BOM and nowhere else | §4.7 |

## Face fastenings (§4.5)

| # | Decision | Why |
|---|---|---|
| 17 | Contact is checked on the trimmed bars' faces: each pair of adjacent layers needs antiparallel faces, coplanar or apart by `gaps_mm[i]`, whose outlines overlap. The fastener's axis is the first layer's facing face's normal; every pair must face along it | §5.1: contacts on the trimmed bars |
| 18 | Stations are measured along the first layer from its end a (`at_mm`), times `across_mm` across its outer face; or a rail's holes; or a pattern's stations. A station that misses a layer is an error | G25's four fasteners |
| 19 | Generated holes are ops `{face, from: "a", at, across, d \| thread, depth?, cbore?, by}` on the face the fastener enters each layer by; the cut list lists them from the piece's end a like M3a's ops | One list of machining per bar |
| 20 | Clearance holes: ISO 273, medium series (M3 3.4, M4 4.5, M5 5.5, M6 6.6, M8 9, M10 11, M12 13.5 … M150 158). A thread outside the table is one error, raised only when a hole is needed | The common default; checked against the published table |
| 21 | `bolt`: a clearance hole in every layer. `screw`: clearance in every layer but the last, which is tapped (`tap_depth_mm`, else a hollow layer's wall, else through); the grip leaves the tapped layer out. `tnut`: nothing in the last layer; the station must land on a groove of the facing face (`fit` error otherwise), the T-nut must fit by its `fits` systems or its groove type, and the grip runs to the groove's lip | What each fastening holds; G25's grip includes the 0.5 gap |
| 22 | A hollow layer (RHS, tube) gets one hole per wall, each as deep as the wall | Each wall is drilled |
| 23 | A rail layer is not drilled where the station is one of its own holes | Its counterbored holes take the screw |
| 24 | A sleeve `{inside, len_mm}` stands on the nut-side inner wall of its layer and reaches back toward the head. A wall or layer it passes whole is drilled to the sleeve's diameter; one it enters part way gets a counterbore of the sleeve's diameter and the depth it enters. `len_mm: "bore"` is the inside depth along the axis | The bore case (G25) needs nothing more; a longer sleeve then has one place to go |
| 25 | A fastener `{bar, len_mm}` and each sleeve are cut from bar stock as pieces `<connection>.f<k>` and `<connection>.s<n>` (numbered in station order), with the bar item's default options; they group and nest with the bars | G25's cut list |
| 26 | The stack's items count once per station | G25's 8 washers and 8 nuts |

## Connectors (§3.4)

| # | Decision | Why |
|---|---|---|
| 27 | A butt counts its connector once per butting end (times `qty`); `defaults.butt` supplies the connector when the connection names none | One end connector per joint end |
| 28 | A connector must fit every joined bar's system (`fit` error). Its mount's fastener set is the one keyed by a joined bar's system, the through bar's first; it counts once per mount hole and unit | §3.4: "a connector's fastener set once per hole" |
| 29 | `requires`: once per butting end. An end tap goes in the butting end; an access hole on the butting bar's +y face, `from_end_mm` in from that end; a hole in the through bar where the butting bar's centre line, moved by the spacer, meets the face it butts into | The design names the ops, not where they go |
| 30 | A splice counts its `parts` as their own lines and taps both spliced ends with its `tap` | The cart's SPL-40 and its stud |

## The cut list and nesting (§5.3)

| # | Decision | Why |
|---|---|---|
| 31 | The cut list takes every piece the derived model cuts (bars, fasteners, sleeves) without the caller listing them | One source of pieces |
| 32 | Identity and the canonical orientation compare machining by where it physically is: an end tap by its end, a hole by its distance from end a; a through hole by its axis, whichever side it is named from. Then a rail's hole count, pitch and E, then the ends | M3a compared `from` first, so a mirrored hole could make two lines |
| 33 | A factory piece stands at a stock end with no trim there; a bar holds at most two. Its bar keeps the stock length the piece names. With neither, nesting is M3a's exactly | G23; the cart's two rails share one 1000 bar (0 × 5 + 940 + 3 = 943) |

## The BOM (§5.4)

| # | Decision | Why |
|---|---|---|
| 34 | Groups in §3.4's kind order; lines by item id then options. Bars give pieces and their total cut length; everything else units | "Every item and quantity, grouped by kind" |
| 35 | Bar mass is each piece's centre-line length times the mass per metre: the published `mass_kg_per_m`, else area × density (the published area, else the section's closed form when `props_ok`). Units take `mass_kg`. A line's `mass_src` is the catalog's provenance or `calc`. A threaded rod whose catalog publishes its stress area (the cart's M10, 58 mm²) weighs a little light by that area | §3.5's authority rule, applied as written |
| 36 | Each line's mass is rounded once to 0.001 kg; groups and the total add the rounded lines. An item with no mass is a `mass` warning, listed in `mass_unknown` and left out of the totals | Totals that add up on paper; a missing mass is a catalog gap, not a broken project |
| 37 | Unplaced lines merge into their item's line, with their `why` | One line per item |
| 38 | `alukit bom <dir> [--format md\|csv\|json]` (`alukit.bom/1`); exit 1 on any derive error. `derive --json` adds `parts`, `fastenings`, `pieces`, `hardware` and the generated ops with `by` | §5.4; deterministic like M3a's outputs |

## For part 3 (offers, order list, costs)

- The BOM's lines are `{item, opt, qty, length_mm?}` per kind; bar lines are covered by the cut
  list's stock bars (`sku`, `length_mm`, price on the basis) and supplier-cut lines
  (`ordered_mm`, `billed_mm`); everything else by unit offers and packs.
- A rail piece's stock length is in the cut list's stock bars; a factory piece never moves bar.
- Machining services, when priced, can count ops by their `by` connection and kind (end tap,
  clearance hole, counterbore).
- `bill: "line"` (a line-level minimum) and G26's price bands are still open, as M3a left them.
- New diagnostic codes: `rail`, `fit`, `face`, `part`, and the BOM's `mass` (a warning).
