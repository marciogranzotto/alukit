# Gap X4: a piece is ordered at the stock it takes, its span

*2026-11-27. Found by the first acceptance run on the reference project's alternative frame; fixed
at its root, with the failing tests written first. For the coordinator to fold into the design or
veto. Cited as "x4" (decision numbers below).*

## The gap

A bar whose two ends are cut on **parallel** angled planes is a parallelogram in side view: all
four of its edges have the same length L. A piece of straight stock that holds it has to reach the
farthest point of each cut, and those lie on **opposite** edges, so the stock is
**L + w · tan θ** long along the axis, where w is the section's depth in the plane of the cut and
θ the cut's angle from square.

AluKit ordered, priced and nested such a piece at `cut_mm`, the long-point length, which §4.5
defined as the longest of the four edges: L. *Measured* on G38's brace (a 40 x 40 between two faces
1000 apart, 1 across for 2 up): `cut_mm` 1118.03, but it spans 1138.03 of bar; ordered 1118 and
billed 1120 where 1138 and 1140 were due (R$ 141.68 against R$ 144.21 at R$ 126.50/m); nested at
5676.15 in a 6000 bar where it uses 5696.15. On the alternative frame a diagonal was ordered at
4926 where its record, correctly, orders 4960 (*read* from the acceptance report; not re-measured
here).

For a trapezoid, two cuts closing toward each other, both long points are on the same edge, so the
long-point length already is what the piece takes; nothing changed there.

## The convention and its source

A cut list orders a member at the length of the straight blank it is cut from, its extent along
its own axis, and that blank must contain the farthest point of each end cut.

- *Read*, Autodesk Inventor's help: a Frame Generator member is authored as an extrusion "From To"
  between a Start Plane and an End Plane square to its axis, the planes offset by
  `G_OFFSET_START` and `B_L + G_OFFSET_END`, and `G_L` is "the base length", the export parameter
  the parts list reads ([structural shape authoring](https://help.autodesk.com/cloudhelp/2014/ENU/Inventor/files/GUID-ECBD0CEB-6130-4980-9BE7-E908F660A231.htm));
  its end treatments then cut that body. And "for a straight frame member with a miter on each
  end, such as an angled beam between two opposite inside corners … the correct frame length
  computes automatically"
  ([Frame Generator overview](https://help.autodesk.com/cloudhelp/2026/ENU/Inventor-Help/files/GUID-953F560A-C2D3-4031-8348-762054C7C779.htm)).
  *Inferred* from the two: the base length of a member mitred on parallel planes is the extrusion
  that contains both cuts, from one long point to the other along the axis. The help states no
  number for that case.
- *Read*, an informal description of SOLIDWORKS weldments (a CSWP study page, version not
  stated): "Solidworks will provide the length as the maximum point to point distance along the
  normal of the profile"
  ([3D Engineer](https://www.3dengr.com/trimextend-command-cswp-weldments.html)). The profile's
  normal is the member's axis, so this is the span. SOLIDWORKS's own help pages render in the
  browser and could not be read here.
- The geometry settles it without either: a straight bar holds a piece only if it reaches both
  long points, and the distance between them along the axis is the span.

## Decisions

| # | Decision | Why |
|---|---|---|
| 1 | A piece's **span** is its extent along the axis, from end a's long point to end b's: the farthest each end face reaches outward over the four corners of the placed **bounding box**. Derive reports it per bar (`lengths.span`, with the long points `la` and `lb`) | §4.5: the bounding box, not the outline, sets every cut, so `cut_mm` and the span use the same corners. For a cut tilted about one section axis (a mitre or a bevel alone, every case so far) the extreme over the outline is on the box's side, or within the small inset of an outline from its nominal box, so the two agree; a compound cut on a section with rounded corners differs more, the box overstating by part of the corner radius, on the safe side. It keeps span ≥ `cut_mm` always, and equal to it for trapezoids. The brief said "over the section outline"; this is the deviation, for those reasons |
| 2 | The rule is the span, not "parallel cuts": the long points fall on opposite edges whenever the two cuts lean the same way about a section axis, parallel or not. G38's case "ends leaning the same way, not parallel": long point 1125.18, span 1130.89 | A "parallel" test would miss the same error on two same-leaning cuts at different angles. Opposite-leaning cuts (a trapezoid) and one square end keep span = `cut_mm` |
| 3 | Named `span_mm`, not `stock_mm` | `stock_mm` already names a rail piece's required stock length and a stock bar's length (§4.7, §5.3); one name for two different lengths on the same line would mislead |
| 4 | Reported where `centre_mm` and `short_mm` are, with an angled end: derive's bars (`span_mm`), the cut list's lines and the stock bars' pieces; the Markdown gains a Span column, the CSV a `span_mm` column; the viewer's cut-list tab and properties show it. A square-cut piece states none: it spans its `cut_mm` | The design's pattern for the other angled-end lengths. A document with no angled end gives the same bytes as before, so its stored revisions do not drift |
| 5 | The span is what is **ordered and billed** (`ordered_mm` is the span rounded to `res_mm`, then `step_mm` steps), what chooses the cheapest cut offer, and what `min_mm`/`max_mm` bound; an error states both lengths when they differ ("is 3016.33 mm of stock (2996.33 at its long point), longer than …") | The supplier cuts, and charges for, the length of bar the piece takes |
| 6 | **Nesting** takes each piece at its span: `used_mm`, `offcut_mm` and `waste_mm` follow, and an unplaced piece's error names both lengths | Same reason. Waste stays "everything outside the pieces' blanks", as for a trapezoid's corner offcuts before |
| 7 | The BOM's `length_mm` and the cut list's group total add the spans | They state how much bar the pieces take, which is what is bought. Mass stays the centre-line length (§5.4): a parallelogram's volume is its section times its centre line |
| 8 | Identical pieces also share the span (to the quantum), and lines of one cut length, machining and ends sort by span, longest first, before the source id | One line, one span. No two existing lines differ only by span, so no order moved |
| 9 | Machining is still measured from each end's long point (§5.3), now read from derive's `la` and `lb`; the cut list no longer computes long points itself. A hole named from end b converts by the span, as it always did | One definition of the long points. On a parallel piece the two are on opposite edges, so a hole's distances from a and from b add up to the span, not to `cut_mm` (a unit test) |
| 10 | The order list's `pieces` keep `cut_mm` to name each piece; its line's `length_mm` is the ordered span. The machining sheet's bar references keep `cut_mm`. `alukit diff` still compares bars by `cut_mm` and `centre_mm`; a span that moves reaches it through the BOM's length and the order lines | Each names the piece as the cut list does; the buying quantities already carry the span |

## Nesting: a cut line two pieces share (v1 limit)

Two parallel-cut pieces sawn one after the other from the same bar can share one angled cut: the
second then takes only L, plus the kerf. **Not built**; each piece keeps its whole span, which is
conservative by w · tan θ per shared cut (20 mm on G38's brace).

The design's nesting is first-fit decreasing over independent lengths: a bar holds pieces when the
trims, their lengths and a kerf between neighbours fit (§5.3). A shared cut breaks each part of
that: a piece's length would depend on its neighbour and on which way each is turned, so the order
and orientation within a bar become part of the result; the kerf of an angled cut is
kerf / cos θ along the axis, not kerf; and the same holds for mirrored pieces turned alternately
(a picture frame's mitres), so it is a common-line cutting model, not a tweak to parallel pieces.
The cut list would also have to say which pieces are sawn together and how each is turned. That is
v1.1 or later, with its own design.

## Earlier goldens

Every fixture project and every case patch (G1–G34, the cart, the order fixture, the base frame)
was derived and each bar's span compared with its `cut_mm` (*measured*, a scan through derive): no
piece has span ≠ `cut_mm`. The angled pieces are all one-angled-end or trapezoid pieces: G6, G9,
G17 and its two cases, G27 and its four, G31 and its two, the cart's four knee braces (b27–b30) and
its grip (b32). **No golden value moved.**

What changed beside the values:

- The cart's `expected-cutlist.json` gains `span_mm` on its two angled lines, 153.14 (the knee
  braces, = their long point, 113.14 + 2 · 20 · tan 45°) and 291.53 (the grip, square at a:
  271.53 + 20 · tan 45°). `cart_by_hand.py` works them from the box's corners and the rails' faces,
  and now orders, nests, groups and converts machining by the span, and totals the BOM by it; its
  BOM, order and machining outputs are byte-identical.
- The CLI test's Markdown row gains the Span column (`| 4 | 153.14 | 113.14 | 153.14 | …`).
- G38 (§4.6) is new, with its own catalog `test-span` (a 40 x 40 square bar cut to length at
  R$ 126.50/m in 10 mm steps, 40–3000 mm, and stock bars of 3000 and 6000) and
  `golden-gen/G38/by_hand.py`. The golden-gen harness gains per-bar lengths, a line's span,
  ordered and billed lengths, the lengths a stock bar's pieces take, several order lines per item,
  the BOM's length and the cut list's own errors.

G38's numbers, from `by_hand.py`:

| Piece | Cut (long point) | Span | Ordered / billed | Price |
|---|---:|---:|---|---:|
| b3, parallel brace, 26.57° each end | 1118.03 | 1138.03 = 1118.03 + 40 · tan 26.57° | 1138 / 1140 | R$ 144.21 |
| b5, trapezoid knee brace, 45° each end | 549.12 (centre 509.12, short 469.12) | 549.12 | 549 / 550 | R$ 69.58 |
| b1, b2, b4, square | 2000, 2000, 1000 | the same | the same | R$ 253.00, 253.00, 126.50 |

Total R$ 846.29 (it was R$ 843.76). Nested from stock bars: 2000 + 2000 + 1138.03 + 549.12 + 3 × 3
= 5696.15 in a 6000, and the post in a 3000, R$ 930.00. With b2 raised to z = 2720 the brace's long
point is 2996.33, inside the offer's 3000, and its span 3016.33 is a `length` error.
