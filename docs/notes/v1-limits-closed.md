# Three v1 limits closed: the stamp, `bbox()`, and end taps on cores

*2026-11-26. After the third acceptance run passed, three limits that [`design.md`](../design.md)
draft 2.3 named are closed in the build, each with failing tests written first. The design text
follows (marked *2.3*, listed in its changelog under "After acceptance run 3"). Labels:
**verified** (run, with how), **read** (from the code or a document), **inferred**.*

**Golden values.** No golden value moved: the lengths, ops, hardware and lines of G1–G34, the
cart's cut list, BOM, order and machining sheet, the base frame's cut list and BOM
(**verified**: the unit suite and the gate). Where a test compares an output with a golden byte
for byte, it compares the golden plus the stamp's lines, as the order's test did since M3b
(m3b-doc 40). Three golden *verdicts* gained an error from the third limit's check, each a case
written to show a fault, with its hand script extended by the rule (decision 20).

## 1. Every output states the stamp (§5.4, §9, §4.13)

**Before.** Only the order list and the costs stated the lock they were derived from
(m3b-doc 40); the cut list, the BOM, the machining sheet and `derive --json` did not, and only the
order stated its oldest price read date (**read**: `order/format.ts`, `cutlist/format.ts`).

| # | Decision | Why |
|---|---|---|
| 1 | The stamp is three top-level JSON fields, `price_basis`, `oldest_read` and `lock`, in that order, as the order list already had them. `lock` is `lockHash`: the sha256 of the lock's canonical text. The caller that read the lock hashes it and passes the hash in (`modelOutputs(derived, items, { lock })`, `derivedJson(d, { lock })`); an output built without one states no lock | One function for every output, as the brief asks; the output modules stay free of Node, and the hand goldens stay statements about values, not about one lock's bytes |
| 2 | An output **carries prices** when it states one or chooses by one: the cut list (its stock bars' prices, and the cheapest of several cut offers), the order list and the costs. The BOM, the machining sheet and the derived model carry none, so they state the lock alone | §5.4's "price basis and oldest read date" means something only where a price is used |
| 3 | The cut list's oldest read date is that of the offers it chose: each cut-to-length group's offer and each nested stock bar's offer. It can be older than the order's: a line a cost line covers is nested and priced in the cut list but not priced in the order (the cart's packers, covered by K3) | The date says how old the prices behind that output are |
| 4 | The costs state the order's oldest read date: their totals add the order lines' prices. A cost line's own `read` stays on its line | The costs are the order's cost lines and totals (§4.11) |
| 5 | Markdown: a line "Derived from the lock sha256:…" under the opening lines, as the order had; the cut list's and the costs' price line gains "the oldest was read …". CSV: the stamp is the first rows, `stamp` rows. The cut list and the BOM put `stamp` in `kind`, `lock` in `item` and the hash in `sources`, the column that says where a row comes from; the order and the costs keep the lock row in `name` and `details` and add `price_basis` and `oldest_read` rows after it. The cut list's CSV gives no price, so no basis row | Each CSV keeps its own columns; a reader skips `stamp` rows as it skips `stock` or `total` rows |
| 6 | `derive --json` states `lock` after `schema` and `variant`; `derive --select` keeps it, as it keeps those two. The view model's derived model, which the viewer draws from, carries none: it is not an output | A selection is still `alukit.derived/1`, with fewer members (§7.3) |
| 7 | One builder per output, shared by the CLI, the server and the revisions: `checkedCutList`, `checkedBom`, `checkedMachining`, `checkedOrder` and `derivedJson`. The server's `/api/derived`, `/api/cutlist` and `/api/bom` now answer the CLI's text byte for byte (before, compact JSON without derive's own diagnostics); its snapshot hashes the lock once per revision. The drawer's Cut list, BOM and Machining tabs show the lock as Order and Costs do | **Verified**: `server.test.ts`, each answer against the CLI's output, in a variant too |
| 8 | A revision stores each output with its stamp (stored outputs are the CLI's JSON, m5 10). `revision verify` compares a stamp field the stored output has; one it does not have is not drift. So a revision saved before this change (only the order and the costs stamped, only the order with an oldest read date) verifies with zero drift, and a stored stamp that no longer matches is drift. Nothing stored is migrated | The stamp says where the values came from; it is not one of them. The lock is already covered by the revision's own content hash (§4.13), and the oldest read date follows from offers the stored lines and the stored lock pin. **Verified**: `revision.test.ts`, a revision with the new stamp fields deleted, then one with a stamp changed |
| 9 | The tests compute the stamp without AluKit: the lock's hash as sha256 of the lock file (`lockStamp`), the cut list's oldest read date from the golden's chosen offers and the lock file's read dates (`oldestCutRead`), and the golden text plus those lines (`withStamp`, `src/core/testing.ts`) | The goldens stay the hand values; the stamp is checked by an independent route |

## 2. `bbox()` covers every drawn body (§4.9)

**Before.** `bbox()` was the extent of the bar bodies only (m3b-doc 34): on the cart it gave
(1564.14, 600, 917.5) from the origin, missing the plate, the bent angle and the carriages that
reach past the bars (**verified**: the new test's variation with no parts gives that box).

| # | Decision | Why |
|---|---|---|
| 10 | The bodies are what the viewer draws and the GLB holds: the bars, the placed parts and the face connections' fasteners. A part's hole markers are not bodies: they stand 0.5 mm proud of its faces only to show | One meaning of "the model's extent" across the check, the viewer and the export |
| 11 | They come from `src/mesh/`, through the functions the viewer and the GLB writer use: `partShape` places a part from `derive --json`'s placement and the view model's box or shape, `fastenerMatrix` a rod, and a project shape is the prism `shapes.ts` gives both the mesh (`items.ts`) and the points (`extent.ts`). The rod's points are `rodRing`'s, the ring `rodMesh` draws | So the three agree by construction. **Verified**: `glb.test.ts`, every node of the cart's GLB against the body of the same id, and `mesh.test.ts`, each shape's points against its mesh's vertices |
| 12 | A bar stays its section's box swept between its end planes, from derive's own numbers (exact for every planar cut, as before). The GLB places it from `derive --json`'s numbers, rounded to 0.01 mm, and draws its outline, which fills the box on the cart's sections: they agree to the output quantum | A bars-only model's `bbox()` does not move; the 0.01 mm is the outputs' own rounding |
| 13 | A placed part whose item gives no box (drawn as a 20 mm marker) has no known extent: a check that reads `bbox()` cannot be evaluated, an error naming the item and the parts ("no box for test:TNUT-M8 (p9): its item gives no bbox_mm"). Unplaced lines have no place and are not bodies | §4.9's rule for `mass()` and `cost()`: never a pass on a partial total. The marker is a sign, not a size. *Worth a look*: of the Forseti catalog's non-bar items only the 8 carriages and 5 of the 100 connectors give a box today (no fastener, accessory, panel or generic item does), so a project that places other Forseti parts and checks `bbox()` gets this error until those items have boxes |
| 14 | A fastener is its rod as drawn: through its layers, as thick as its thread (6 mm when it names none, as the viewer draws it) | The same body; a rod through layers rarely reaches past them, but it is drawn, so it is measured |
| 15 | `src/core/check/model.ts` imports `src/mesh/extent.ts`, the one place `src/core` reads `src/mesh`. Everything it reaches is three-free (the bend's section moved from `items.ts` to `shapes.ts` for this); a test walks the imports of `src/core` and `src/catalog` and fails on any that reaches three.js or a `.tsx` | §10: the core imports no three.js; now a test holds it to that |

**The cart's box, worked by hand** (in `check.test.ts`, from the document's numbers and the frames
of §4.4 and §4.7, no AluKit): x from −20 (the bent angle p7's leg a, off the left top rail's
outside) to 1200 + 350 + 20/√2 = 1564.14 (the push handle's grip, a bar, at its free end); y from
0 to 630 (the motor plate p6's far edge); z from 0 to 930 (the carriages, 917.5 + 12.5, and p7's
leg b, 900 + 30). The push handle sets the high x, as it did with bars alone. The placeholder
motor p8 reaches y 625 and z 238, inside the plate and the carriages, so on the cart as written it
sets no side; the test's variation gives it a box reaching y 640 and z 978, and the box follows it
there. With no parts the box is the bars' (1564.14, 600, 917.5), so the parts set three sides.

## 3. A tap into a bar's end is checked against its section's cores (§5.5, §13)

**Before.** The third acceptance run found it: an end tap was never compared with the section's
cores, so a tap given no position on an 80x80 with four cores stood at the centre and passed.

| # | Decision | Why |
|---|---|---|
| 16 | Every tap into a bar's end is checked: an end tap, a connector's in a butting end or in a through bar's end or a splice's, and a tapped end hole (an `end-hole` with a thread, §4.5). Its centre must lie within `tol.len` (0.01 mm) of a core's; a drilled end hole is not a tap and is not checked | A thread is cut in material, and on a T-slot profile the cores are where it is. The cut list already words a tapped end hole as a tap ("tap M8 in end a along the axis"); leaving it out would leave the same fault unchecked. The tolerance is the positions' own: they are written as the cores' |
| 17 | The cores are a section's: a `tslot` generator's `bores` become `cores` on the built section (`src/catalog/link.ts`), in section coordinates, compared from the section's box centre, the frame an end tap's place is given in. `bores: []` says it has none, and every end tap on it errors; the bar item's `core` (bore and tap size) gives no position, so it places none | One source for the drawn bores and the checked cores |
| 18 | One error per place on a bar (its end, its position to the output quantum, its thread), on the bar, naming the end, the place, the connections that made it (also its `refs`), the section and every core at the least distance, with that distance: "the tap M16 in end a at the centre (c1) is on no core of test-stud:TS80; the nearest, 28.28 off: x -20.00, y -20.00; …" | The shop and the author need the place and the nearest fix; the `refs` let the order rules block that bar's suppliers (§5.5) |
| 19 | A section that gives no core positions is not checked: one `machining` **info** on the bar names its tapped ends and the connections. Not an error, and not nothing | A drawn or traced section's holes do not say which is a core, and a box has none drawn. In the Forseti catalog 8 drawn sections (PF20-14, PF30-02, PF30-04, PF40-00, PF40-01, PF40-03, PF45-02, PF45-12) and one generated without bores (PF50-01) give none (**read**); an error would block every tapped joint on them for a check AluKit cannot make, and silence would hide that the check did not run. *Superseded 2026-11-27* ([`section-cores.md`](section-cores.md) 1, 5): the eight drawn sections now name their cores, and PF50-01's drawing does dimension a Ø13.7 centre core ("not drawn" was wrong), which its section now has; the info stays for a section that names none |
| 20 | Coincident taps at a place off every core get both errors: the coincidence and the missing core. G34's "each requirement written four times with no positions" and "a splice with four studs and no positions" cases gain the second on each bar with taps at the centre, and G31's "a tapped hole, 20 deep" gains one (its M8 10.00 off the 40x40's centre core). Their values do not move; `by_hand.py` beside each states the rule and computes the verdicts without AluKit | Two faults: making the taps once still leaves one at a centre with no core. Each case was written to show a fault, and the new check sees one more; no fixture is wrong, so none was changed |
| 21 | Every base golden and the cart pass: their taps are on cores (the cart's and G12's at a TS40's centre core, G33's at a TS40C's, G34's at TS80's four), and no fixture taps a section without core data (**verified**: a scan of every fixture project's derived ops, and the suite) | The check catches the fault the run found and nothing else in the record |

**On the third run's own record** (**verified**, `alukit check` on its decided variant): the
check finds what the run's finding described, 18 M16 end taps given no position at the centre of
80x80 ends with four cores and of 40x80 ends with two, each a `machining` error naming the nearest
cores, and 4 infos for taps on a drawn section. The record is not changed here. Its `bbox().z`
check reads 2251.4 before and after the second limit: every placed part there has a box, and none
widens the model's height.

**Tests, written first** (`src/core/derive/joints.test.ts`, "an end tap on its section's cores"):
the brief's two reproductions, an 80x80 post's end tap with no position (BUSH-END on G34's post,
28.28 from each of four cores) and a tap placed at (10, 10) on a 40x80 (14.14 from its core at
(0, 20)), then the same tap on a core passing; a splice's taps in both ends and a through bar's end
taps; G31's tapped end hole; and the info for TS80 with its bores removed. Three earlier tests of
that file now expect the new errors beside what they test (positions mapped into a through bar's
end at (0, ±10), a splice tap at (10, 5) turned with the piece, the coincident taps).
