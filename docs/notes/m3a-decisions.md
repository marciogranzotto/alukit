# M3a decisions

*2026-11-26. Calls made while building M3a (the geometry core: points, frames, placement, end
planes and connections, cut list) where [`design.md`](../design.md) is silent or ambiguous. For
the coordinator to fold into the design or veto.*

**No golden value was found wrong.** G1–G21 and the §4.4 frame table pass to 0.01 mm with the
design's numbers as written. G6, G14 and G17 (the angled and pivot cases) were also re-derived
by hand while building, and agree.

## Fixtures

| # | Decision | Why |
|---|---|---|
| 1 | Geometry-only items live in a second synthetic catalog, `tests/fixtures/catalogs/test-geo/` (RHS 100x50x4, flats 50x10 and 50x20, tube 18x2, a 40 mm cube, a hinge with pivot geometry, an 8 mm end plate, M10 washer and nut), not in `test/` | `test/` is M1's oracle and M2a works on catalogs in parallel; a separate catalog cannot conflict with either |
| 2 | Each G-case is `golden-ends/Gnn/{alukit.json, expected.json}`. `expected.json` holds the design's numbers verbatim; a variation ("with `through_end: node`", "then H = 1000") is an RFC 7396 merge patch of the base document in `cases`. Errors are asserted as the exact set of `{code, entity, refs}` | One document per case, as §4.6 says; a test cannot pass by accepting extra errors |
| 3 | The cart's expected cut list is written by `tests/fixtures/cart/hand/cutlist_by_hand.py` (since M3b `cart_by_hand.py`, which also writes the BOM), plain Python that imports nothing from AluKit. The test compares a projection of AluKit's cut list with it | §12: worked by hand, independently. The script is the hand calculation, kept so a reviewer can follow every number |
| 4 | The cart covers §12's M3a classes (eccentric anchors, a rolled 40x80, a steel beam, a strut bearing on another bar's end, a flat bar flush with a beam's cut ends, a spliced run, braces between pivots, a bolted stack of five layers with packers, a pattern) plus a free end counted from a cut and angled knee braces. Rails with factory ends, carriages, rods and sleeves cut from stock, rail-hole selections, price bands and cost lines join in M3b; the plate and placeholder in M6 | Their rules are those milestones' (G22–G26 are M3b's oracle); adding them now would fix outputs before their rules exist |

## The document and expressions

| # | Decision | Why |
|---|---|---|
| 5 | Each entity is validated on its own: a bad bar is reported and skipped, the rest derives. An unknown top-level field is an error; later milestones' fields (`items`, `costs`, `price_bands`, `order_rules`, `variants`, `checks`, `open`, `decisions`, `views`, `fx`, `only_in`, `rail_holes`) are accepted and not yet interpreted | §5.1: derive never throws on content. Fourteen junk documents are a test |
| 6 | An item reference in a document carries its catalog: `test:TS40`. A bare id is refused | A project reads several catalogs, so a bare id is ambiguous |
| 7 | Expressions: no `eval`; `^` is right-associative and binds tighter than unary minus (`-2^2` = −4); comparisons do not chain and are equal within `tol.snap`; trig is in degrees, exact at multiples of 30° (sin, cos) and 45° (tan), and the inverses exact on those values; `round` is half away from zero; `floor`/`ceil` snap within `tol.snap`; `if` evaluates one branch | Determinism across machines, and the numbers a person expects (`cos(60)` = 0.5 exactly) |
| 8 | `len`, `cut`, `pos`, `dist`, `bbox`, `mass`, `cost`, `count` are refused in document values (params, coordinates, lengths) with an `expr` error; `checks` (M3b) will use them. `sec(<bar>)` reads the bar's section parameters plus `width_mm`, `height_mm`, from the document's own bars | A value that read the derived model would need iteration; sections are catalog data, known before placement |
| 9 | A param cycle is reported on each member, once | Every member is equally the cause |

## Placement

| # | Decision | Why |
|---|---|---|
| 10 | A bar's options are its own, else `defaults.bar.opt` **for each option its item has**; an option the item lacks, or a value it does not list, is an `option` error, and the bar is placed all the same | A steel bar under a default `finish: anodised` must not inherit it; a bad value should be named on the bar, not surface as "no offer" |
| 11 | An unknown anchor or datum is an error and the bar uses `c` | The bar still derives |
| 12 | `near-vertical` warns only when the bar gives no `up` | Giving `up` is the fix the warning asks for |
| 13 | A station with no face or groove takes `off_mm` as [local x, local y]. With a face, [u, v] as P16. Grooves on a face are numbered by increasing section coordinate (`+x.1` is the lowest) | The design defines offsets only on faces |
| 14 | A point never reads a cut: `from: "a.cut"`/`"b.cut"` are refused for points, and a station `from: "b"` on a bar whose `b` is a free end counted from the cut is refused (its B is not known until stage 3) | Keeps placement free of iteration (§4.5) |
| 15 | Patterns: `count` includes the template (copies 1 … count − 1); `offsets_mm[i]` is copy i + 1's distance from the template, not cumulative; `skip` numbers copies, and a skip that names no copy (including 0) warns; an entity in two templates is an error on the later pattern; `along` must not be in the template | §4.7 numbers copies from 1 |
| 16 | A copy translates what it carries: its inline coordinates and its stations. A station on the pattern's `along` bar or run moves along it instead (`at_mm` + step), so a copy on a run lands on the piece that holds it. A named node outside the template stays put; one inside is copied | §4.7: references outside are kept, and a part copy on a run lands on its piece |
| 17 | A body's box is its item's `bbox_mm`, else `body.size_mm` centred on its origin; its `mount` datum lands on `at`, else its origin | G5's cube; §4.7's datum rule |
| 18 | A pivot's base must be a face or groove station. The angle checked against `range_deg` is measured in the hinge's plane from the base bar's +t (`axis: across`) or the face's u (`along`) toward the face's normal, so 90° stands square off the face. Outside the range is a `pivot-range` error (the bar is still cut); a carried bar not square to the hinge axis warns `pivot-plane` | §4.5 says the range is a check; it does not say from where the angle counts |

## End planes

| # | Decision | Why |
|---|---|---|
| 19 | A `miter` declares `cut: "angle"` on both its ends | Its bisector plane is never square (G9); requiring the declaration would make every mitre an error |
| 20 | An end whose provider fails (two providers, an undeclared angle, a chain, a miss) falls back to its default plane, and its own `extend_mm` still applies | The modifier is the bar's, not the provider's |
| 21 | A connection naming one end twice, and `through_end` on a butt through an end or a body, are `connection` errors | Otherwise they would be miscounted silently |
| 22 | The automatic `through_end` claim fires when the through end's design point is within `tol.len` of a butting end's | §4.5's "coincides" |
| 23 | `end-far` measures the end's design point's distance from the plane **along the face's normal**, against the through prism's depth along that normal plus the spacer plus `tol.len` | An angled brace moves a long way along its own axis without being far from its face |
| 24 | A butt's spacer is its `spacer_mm`, else its connector's `spacer_mm`, else 0 | §4.5: "from the connector, or given" |
| 25 | A free end counted from the cut is B = A + t·(s_a + len), s_a being where the centre line meets end a's end face | G21 |
| 26 | Each end's `move` is the signed distance along the axis from its design point to where the centre line meets its end face, positive outward | One sign for both ends |
| 27 | `cut_mm` is the longest of the four edges between the end planes (long point to long point along one edge); `short_mm` the shortest; `centre_mm` along the box's centre line | G6's three numbers |
| 28 | An angled end reports `angle` (between the plane's normal and the axis), `mitre` = atan2(n·x, n·e) and `bevel` = asin(n·y), with e the end's outward axis and x, y the bar's frame | A cut tilted about the bar's y is a pure mitre, about its x a pure bevel |

## Cut list

| # | Decision | Why |
|---|---|---|
| 29 | Identical pieces: same item and options, `cut_mm` to 0.01 mm, each end's angle, mitre and bevel to 0.01°, and the same sorted machining. The canonical orientation compares the sorted machining first (§5.3), then, on a tie, the ends: square before angled, then mitre, bevel and angle by value. A flip reverses t and x, so it swaps the ends, negates mitres and keeps bevels | §5.3 gives no tie-break for pieces without machining |
| 30 | Lines are sorted by cut length, longest first, then orientation, then first source id; groups by item then options | A stable order a person reads top-down |
| 31 | The mode is `order.<item>.sale`, else that of the offer `order.<item>.offer` names, else `cut` when a cut offer matches the options, else `stock`, else none (a `no-offer` warning). Among several cut offers, the first by SKU; choosing suppliers by price is the order list's (M3b) | §5.3: "overridable per project" |
| 32 | `cut`: ordered = round-half-away(cut / `res_mm`) · `res_mm` (default 1); billed = ceil(ordered / `step_mm`) · `step_mm` (default `res_mm`), then at least `min_bill_mm` per piece. A line-level minimum (`bill: "line"`) is left to the order list. Outside `min_mm`–`max_mm` is a `length` error per piece, the long side suggesting a splice. *Since gap X4 (2026-11-27), the piece's span takes the place of its cut length here, and in #33's Σ: [x4-stock-length](x4-stock-length.md) 5, 6* | Review M7's example: 1,234 mm bills as 1,240 |
| 33 | `stock`: kerf and trim from `order.<item>.kerf_mm`/`trim_mm`, else `defaults.cutting`, else kerf 3, trim 0. A bar holds pieces when 2·trim + Σ + (n − 1)·kerf ≤ its length. Lengths are integer hundredths of a millimetre | No float drift in a fit; G23's 1416 |
| 34 | FFD sorts longer first, ties by source id. A bar moves to the cheapest length that holds it, ties to the shorter. The result: cheapest, then fewer bars, then the longer **single** offcut | §5.3's "the longer offcut", read as the most reusable remnant |
| 35 | A piece longer than every stock length less its trims is a `length` error suggesting a splice, and is left out of the nesting | The rest still nests |
| 36 | A stock bar's price is on the project's `price_basis` (`sale` falls back to regular; `lowest` takes the lower); an offer priced per m is multiplied by its length, rounded half away | §4.11 |
| 37 | A stock bar reports `offcut_mm` (its length less what was used) and `waste_mm` (its length less its pieces: kerfs, trims and offcut) | "Waste is reported per bar" |

## Output and CLI

| # | Decision | Why |
|---|---|---|
| 38 | `derive --json` writes `alukit.derived/1`: maps in id order, lengths to 0.01 mm, angles to 0.01°, frame vectors to 1e-9, no −0, diagnostics sorted; `cutlist --format json` writes `alukit.cutlist/1` the same way | Byte-identical output run twice (a test, in-process and from two processes) |
| 39 | Exit 0 when fine (warnings allowed), 1 on any error, 2 on bad usage. Catalog problems met while opening a project come through as code `catalog` | Scripts test the exit code |

## For M3b

*Done in M3b part 1, which generates all of the below: see
[`m3b-gen-decisions.md`](m3b-gen-decisions.md). The cut list now takes the generated pieces
from the derived model, and `extraPieces` is gone. Kept as written at M3a.*

- `cutList({ derived, items, extraPieces })` takes the fasteners and sleeves cut from stock as
  extra `Piece`s; they group and nest with the bars.
- `face` connections are parsed and their references checked; their fasteners, stack, sleeves,
  stations and holes are not generated yet. The cart's bolted stack (`c23`) already names an
  M10 rod and a sleeve in its RHS.
- `ops` holes are resolved per bar (`DerivedBar.ops`) and listed from the named end's long point;
  generated machining should append to the same list.
- Factory ends on rails change nesting (§5.3, G23); the nesting module takes plain pieces today.
- Diagnostic codes so far: `schema`, `ref`, `expr`, `cycle`, `item`, `option`, `anchor`,
  `zero-length`, `up-parallel`, `near-vertical`, `station`, `joint`, `run`, `pattern`, `pivot`,
  `pivot-range`, `pivot-plane`, `plane`, `butt-miss`, `end-far`, `cover-none`, `connection`,
  `two-providers`, `angled-end`, `chain`, `miter`, `splice`, `length`, `order`, `no-offer`,
  `catalog`.
