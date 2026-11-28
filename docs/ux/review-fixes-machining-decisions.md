# AluKit review fixes: machining words, hole references, Move's speed

*2026-11-27. Fixes three majors of the designer review of the editing round
([review-editing.md](review-editing.md)): M1, an unpriced machining service blocks the order as
"No supplier sells…" with a disabled fix; M3, a hole's distance counts from the design end in
the document and from the cut in the cut list; M6, each Move on a 1,008-bar project waits about
2 s for its preview and 2 s for its step. Design §4.4, §5.3, §5.5 and §8 state the result
(*2.3*), with the changelog group "Review fixes, machining and speed" and calls 125–129.
Labels as in the stream notes: **measured** (a test or a run says so), **read** (from the code or
the page cited), **inferred**. Cited as "rm n".*

## Done

| Item | What | Where | Test | Failed first |
|---|---|---|---|---|
| M1 | A supplier's unpriced machining is its own problem: "2 machining services on Profile 40x40 (test:TS40) have no price", on the bars that carry it, the cost line that prices it in its detail, and no fix button. "Set a price…" is offered only for a project's own item, the only price the app sets; no fix is ever shown disabled for a reason it does not give | `core/problems/problems.ts`; `ui/problems/Fixes.tsx`; `ui/tables/OrderCosts.tsx` | `problems.test.ts` (2 tests, and the cart's estimate); `view.spec` (the badges count the bars with machining) | yes (both) |
| M3 | A hole may count from an end's cut (`"from": "a.cut"`, `"b.cut"`), and every writer AluKit ships writes it so: the app's form and menu, the guide, the skill. A hole whose circle reaches past a cut is a `machining` error. Reverse and split keep such a hole where it is | `core/project/schema.ts`; `core/derive/derive.ts` (`resolveOps`), `on-piece.ts` (`holesOnPiece`), `attach.ts`; `core/commands/maps.ts`, `geometry.ts`; `ui/inspector/holes.ts`, `Holes.tsx`, `barActions.ts`; `mesh/display.ts` (`long_mm`) | `hole-ends.test.ts` (7 tests), `commands.test.ts` (reverse, split), `holes.test.ts` (words, ops, the menu's distance), `edit.test.ts` (`alukit do setBar` and `alukit check`); `edit.spec` and `menu.spec` | yes (the unit tests); the CLI and e2e tests were rewritten with the change |
| M6 | A batch derives each state once, the server reuses the derives it has, and a state's catalog pins are looked at once. Move asks for a join only at a moved end that can take one; a frame moved whole is one `transform` | `core/commands/helpers.ts` (`sharedDerives`, `pinNew`), `apply.ts`, `transform.ts`, `types.ts` (`deriveOf`); `server/host.ts`; `ui/edit/batches.ts` (`joinable`); `ui/tools/wire/move.ts` | `commands.test.ts` (each state derived once), `batch-cost.test.ts` (a step under five derives of the lattice), `moves.test.ts` (2 tests); `move.spec` on the lattice, 500 ms at the server | yes (all; `move.spec` measured failing on main, 1,218 and 1,194 ms) |

## Research: from where a shop counts a hole

| Source | What it says | What AluKit takes |
|---|---|---|
| MISUMI, aluminium extrusion alterations (catalogue pages such as [p2_767](https://stg0-my.misumi-ec.com/pdf/fa/2014/p2_767.pdf) and [2019 US 2880](https://mx.misumi-ec.com/en/pdf/fa/2019/2019_US_2880.pdf)) | "Specify the desired hole position from the left end"; "The hole intervals are specified in XA / XB / XC / XD / XE order from the left end"; a table column "Distance from the Left End Plane"; ranges such as 7~(L−7), L the ordered length; a wrench hole offset by an end cap's 3 mm | A hole on a cut piece is placed from the piece's end plane, as cut, and its range is counted in the piece's own length (**read**, from the search engine's excerpts of these pages; the PDFs refused a direct fetch) |
| Systeal, standard machining on aluminium profiles ([Usinages standards](https://www.systeal.com/en/content/67-usinages-standards-sur-profiles-aluminium)) | "Drilling position from the end: 10 mm for 20x20 profiles, 15 mm for 30x30 profiles, 20 mm for 40x40 profiles" | A shop's standard access hole is placed from the profile's end: the guide's "20 mm from end a" on a 40x40 is this hole (**read**, from a search excerpt; the page refused the connection) |
| Protolabs, CNC hole design ([through, blind, tapped and more](https://www.protolabs.com/resources/blog/cnc-hole-design-through-blind-tapped-and-more/)) | When checking a hole's edge distance, use the largest diameter of the feature, a counterbore's included | The off-piece check measures a hole's widest circle: a counterbore's or countersink's mouth, a thread's major diameter (**read**, search excerpt) |
| AluKit's cut list (design §5.3) and part inspector | A piece lists its machining "from a named end", from that end's long point; a part's station already offers "end a's cut" (§4.3) | The document and the app now say what the cut list prints, in the words stations already use (**read**) |

## M1: unpriced machining in its own words

| # | Decision | Why |
|---|---|---|
| 1 | **The order's machining reason is its own problem**: `missing-price` with the message "no price for N machining service(s)" is titled "N machining service(s) on <item> has/have no price". Its detail names the bars that carry the machining and the services ("on b1 and b2 (2 × angled cut)"), says a supplier's machining has no price until a cost line covers it, and gives that cost line as `alukit do`'s `addCost` with `"covers": { "supplier": …, "services": true }`. Its targets are those bars, so **Select the places** selects them; its id stays the item's and the supplier's, so it is one problem while bars gain or lose holes | The old words fell through to "No supplier sells", true of no catalog item that is sold (**read**: the message matched none of the branches). The order rule itself stands: services are priced by a covering cost line ([design-vs-built](../notes/design-vs-built.md) 14) |
| 2 | **No fix button for it**, and **no disabled fix anywhere**: costs have no app path yet (§8), so the fix is the cost line's CLI form in the detail, which the toast copies. "Set a price…" is offered only for a project's own item (`project:`), the only price the app writes; a catalog item's estimate says "its catalog's offer gives an estimate, so source it there and update the lock". A fix button is disabled only while a step is in flight or the app is read-only | The review: "a fix that is always disabled is no fix". A button whose reason is hidden in a tooltip asks a person to find out what they cannot do |

## M3: a hole counts from the cut

| # | Decision | Why |
|---|---|---|
| 3 | **What a person types counts from the cut end**: `ops` take `"from": "a.cut"` or `"b.cut"`, an end's long point (where the cut list measures, §5.3), as stations do for parts (§4.3). The app's form and menu, the guide and the skill write it | What the shop measures from (MISUMI, Systeal above), what the cut list prints, and what the guide's "20 mm from end a" means. On a rail cut back at both ends, "20 from end a" as a design distance was printed −60 (the review) |
| 4 | **An absent `from`, `"a"` and `"b"` keep meaning design points** | A document written before would otherwise move every hole on a bar whose ends are cut back or extended, silently, with nothing to migrate it; stations mean the same by the same words; a writer that drops a default value would move holes. A design point stays useful for a hole that must line up with another bar's axis whatever the cuts do |
| 5 | **Derive converts once**: a hole from `a.cut` at x lies at `la + x` from design point a, one from `b.cut` at x at `len − lb + x` from design point b (`la`, `lb` each end's long point along the axis from a). The derived hole stays design-relative, so the cut list, the machining sheet, the GLB and the checks read it as before | One conversion, at the one place that reads `ops`. No derived output moved for a hole written as before (**measured**, What moved) |
| 6 | **A hole off its piece is a `machining` error**, as §4.8's plate hole a shop cannot make: when one of its circles reaches past an end's cut face by more than `tol.len`. The circles are the drill along its depth (through: the section's extent) and a counterbore's or countersink's mouth; a thread counts its major diameter. The reach is exact for an angled end: a circle centred at X, radius r, square to the hole's axis f, reaches n·(X − P) + r·\|n − (n·f) f\| past the end plane (normal n through P). Written and generated holes alike; the words say where the cut list would put it: "the Ø7.00 hole on face +y, -60.00 mm from end a's cut, reaches 63.50 mm past end a's cut face: off the piece, a shop cannot make it there" (the review's case) | The review: `alukit check` said nothing about a hole at −60. Protolabs's edge rule for the widest circle. No fixture's hole is off its piece (**measured**: no new diagnostic anywhere) |
| 7 | **Reverse and split keep a cut-counted hole where it is**: `reverseBar` turns `a.cut` into `b.cut` and back, as it turns `a` and `b`; `splitBar` counts each hole on the piece it lands on, from the same kind of reference | The hole is on the metal, not on the numbers (**measured**: the world positions before and after, `commands.test.ts`) |
| 8 | **The app says which**: the hole row and form offer "end a's cut", "end b's cut", "design point a", "design point b"; a new hole, from the menu or **Add a hole…**, counts from end a's cut, and the menu offers that distance ("Add a hole on b1's face +x, 300 mm from end a's cut…"), read from the view model's long points (`long_mm`), so the number offered is the one the cut list prints | The review's "say which in the row"; the menu offered 274 where the cut list printed 194 |

## M6: Move on a large project

**Measured first**, on the review's lattice (84 box frames of 500 mm, 1,008 bars, 672 butts),
built by commands from `tests/fixtures/ux/lattice` (`latticeBatch`, `core/testing.ts`), one
frame of 12 bars moved by `0, 0, 300`, at the server (`ProjectHost`, as `alukit serve` runs it),
medians of seven, main and the branch back to back under the same load (load average 60–86):

| | main | branch |
|---|---|---|
| The preview's dry run, the app's batch | 837 ms (25 commands) | 128 ms (1 command) |
| The step, the app's batch | 879 ms | 142 ms |
| The dry run with a join at every moved end | 843 ms | 109 ms |
| The step with a join at every moved end | 837 ms | 167 ms |
| `move.spec`, request to response in the browser (load 100–150) | 1,218 and 1,194 ms | 326 and 282 ms |

| # | Decision | Why |
|---|---|---|
| 9 | **The cost was derives, not the join rule**: every command of a batch derived the model again (`makeContext`), though an `autoConnect` that finds nothing leaves the state as it found it: 25 derives for one frame moved, 28–40 ms each here. And after each command, `pinNew` walked every item the document names to pin new ones (5.2 ms here). `planJoin` itself took 0.3 ms. So `autoConnect` gets **no spatial index**: it would save under 8 ms of 24 joins, and touch the rule the joins stream is changing | **Measured** (`performance.now` around each part, in-process). The review's 75 ms per `autoConnect` was one derive under its load |
| 10 | **A batch derives each state once** (`sharedDerives`): derives are shared by state identity, which is safe because a state is immutable and derive is pure. `transform` derives the state it leaves for its guard, and the joins after it read that derive (`ctx.deriveOf`). The server gives its snapshot's derive for the state a batch starts from, and keeps the batch's derive of the state it ends at for the dry run's answer and the next snapshot | The root cause, fixed for every batch (Rotate's, Duplicate's, the CLI's `alukit do`), not only Move's. The review's other option, an `autoConnect` taking a list of ends, would have changed a command's shape and CLI form for the same single derive |
| 11 | **A state's catalog pins are looked at once**: a state whose lock covers what its document names is remembered, so a command that leaves it as it was walks nothing | 5.2 ms a command on the lattice, the rest of a skipped join's cost (**measured**) |
| 12 | **Move asks for a join only at a moved end a join can take**. `autoConnect` joins the free ends at an end's point (`planJoin`: an end no connection claims, `m.claims`); with none there it finds nothing. So a moved end is asked when, after the move, a free end may be at its point: it is free itself, Alt frees it, another free end lands where it lands, or a free end of a bar that stays was where it was (one written on a moved bar or node follows it there). Points meet within 0.05 mm, wider than the core's 0.01, so none is missed. The first-24 bound and the order stay, so the joins sent are a subset of the old ones, in the old order. Rotate, Align, a part's slide and Duplicate ask every end, as before | The review's fix ("only re-join ends that were freed or moved onto something new"). After rm 10 and 11 it saves little time (the table: 128 against 109 ms is noise); what it changes is the step: a frame moved whole is one `transform` in the log and in undo, not 25 commands. Its premise mirrors `planJoin`, so a change of which ends `autoConnect` can take must change `joinable` too; the test of rm 13 compares it with a join at every end |
| 13 | **Proved the same**: on `ux/move` and the brace (five moves, one landing a corner on b4's free end and joining it), the app's batch and a join at every moved end make the same document and create the same joints (`moves.test.ts`). A sweep of 238 moves on the 59 fixture projects (each project's first six bars, by `100, 0, 0` with follow and `0, 0, 50` with Alt): the batch with shared derives, the same commands applied one by one with a fresh derive each, and the app's batch gave the same document every time, 10 of them making joints (**measured**, a scratch script) | The brief: behaviour-preserving, proved by identical outputs |
| 14 | **The budgets**: `batch-cost.test.ts` holds a frame's move and its 24 joins under five derives of the lattice, measured in the same process so the ratio holds under any load (**measured**: 27.7 on main, 5.19 with rm 10 alone, 2.34 with rm 11). `move.spec` holds the app's preview and step under 500 ms each at the server, in the style of `live.spec`'s 1 s, and checks the step is the `transform` alone | Generous against what the branch measures under heavy load (326 ms), failing on main (1,218 ms). No existing timing test changed |

## What moved

- **Golden values, cut lists, BOMs, machining sheets, orders, derived models, diagnostics**: none,
  on all 192 fixture and golden outputs (**measured**: every output dumped before and after and
  compared). No `by_hand.py` and no golden's expected file changed; the reference change (rm 4)
  leaves every hole written before where it was.
- **Problems**, in 129 outputs, all for M1's reasons:
  - 57 outputs' "No supplier sells Profile 40x40 (parametric) (test:TS40)" (54) or "… Square bar
    40x40 … (test-span:SQ40)" (3), each with a set-price fix, are now "N machining services on
    <item> have no price", on the bars with the machining, with no fix (rm 1, 2): the golden
    cases whose connections or angled ends generate machining on those items: G06, G09, G12, G17,
    G27, G29, G31, G36, G37, G38 (test-span:SQ40), G41, G42, G43, G44 and G51, with their variants.
  - The problems for catalog items that no catalog sells keep their words and lose the disabled
    "Set a price…" (rm 2); the cart's estimate for test:PSU-24V loses it too, its detail saying
    where to source the price.
- **A new fixture**, `tests/fixtures/ux/lattice`: a project with nothing in it, which the tests
  fill by `latticeBatch`.
- **`view.spec`'s badge count** on the cart is 3, not 5: the machining problem targets the post
  that carries the hole, where the old one targeted every bar of the profile.
- **The hole e2e and the menu's words** say "from end a's cut".

## Tests

- `src/core/problems/problems.test.ts`: the machining problem's words, targets, id and empty fixes,
  cleared by the cost line; a price form only for a project item.
- `src/core/derive/hole-ends.test.ts`: a hole from `a.cut` and `b.cut` is the cut list's number; it
  follows an extended end; it is the same piece as the design-point hole at the same place; off
  the piece, at 3.5 and 3 mm from the cut, a counterbore's mouth, an M6's major diameter, an angled
  end blind and through.
- `src/core/commands/commands.test.ts`: reverse and split of cut-counted holes; each state of a
  batch derived once.
- `src/cli/edit.test.ts`: `alukit do setBar` writes a hole from end a's cut, which the cut list
  prints as written; a hole off the piece makes `alukit check` exit 1.
- `src/ui/inspector/holes.test.ts`: the row's words, the ops it writes, the menu's distance from
  the cut.
- `src/ui/tools/moves.test.ts`: the joins a move sends, and the same step as every end.
- `src/core/commands/batch-cost.test.ts`: the lattice, and a step under five derives of it.
- `tests/e2e/move.spec.ts`: a Move on the lattice, the preview and the step under 500 ms at the
  server; `edit.spec`, `menu.spec`, `view.spec` as above.
