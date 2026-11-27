# F2: the joint geometry at screwed end joints

*2026-11-27. Closes finding F2 of the acceptance's fourth run (§13): comparing with the reference
frame's own joint check, `check` saw 2 of the 13 faults it lists at screwed end joints, and one
of AluKit's derived results was wrong. Three gaps, each fixed at its root with failing tests
written first and a golden case worked by an independent hand script (G35–G37). The design text
follows (marked *2.3*, listed in its changelog under "After acceptance run 4"; calls 39–43).
Labels: **verified** (run, with how), **read** (from the code or a document), **inferred**.*

**Golden values.** No golden value moved: the lengths, ops, hardware and lines of G1–G34, the
cart's cut list and BOM and the base frame's outputs; the cart's order list and machining sheet
gain only the diagnostics below (**verified**: the unit suite and the gate).
The new checks add diagnostics to earlier fixtures where their geometry really does what the
checks catch; each is listed below with why it is right. None was weakened to avoid one.

## Part 1: an end hole follows its fastener's axis

**The cause** (**read**, `src/core/derive/hardware.ts` before this change). Gap A4 made a hole a
connector requires in a block whose end a butt bears on "into that end face along its axis": the
through bar's axis, entering where the butting bar's line at the position meets the end face. When
the connector also taps the butting end at that position, the fastener is a screw through the
block into that tap, so it runs along the **butting** bar's axis. On an angled butt the two part:
on the reference frame's 40x80, 7.53° off its blocks, a drift of about 21 mm over a 160 block,
with no diagnostic.

1. **Which holes follow a screw.** A hole the connector requires `on` the through bar, at a
   position where the same connector requires an `end-tap` `on` the butting bar (or `each`), is
   the clearance for a screw into that tap. The pairing is read from the connector's own
   `requires`, matching positions within `tol.len`, not from a new field naming the fastener (call
   39): a recipe for screws through a block into a bar's cores already writes both. A hole with no tap at its place keeps A4's rule.
2. **Its line.** The butting bar's axis through the position: the box centre's line moved by the
   position in the butting section's x and y, pointing into the joint. The entry is where it meets
   the through bar's end face; the exit where it meets the other end face, or the hole's end at
   its `depth_mm`. The op carries `exit` (from the section's centre, like `off`) and `angle`, the
   angle between the line and the end face's normal. A hole parallel to the through bar's axis has
   neither, so every earlier end hole is written as before (G31).
3. **It must stay in the block.** Along the line, the axis's offset in the section is linear, so
   the box decides: if the axis crosses a side before the other end face (or its depth), the
   screw has no place, a `connection` error on the connection naming the face, how far in, and
   where the hole's wall reached that side first; no op is made.
4. **Its wall.** Across a section of the block, a tilted cylinder of radius r cuts an ellipse
   whose half-width along a section axis e is r √(1 + (u·e / u·t)²). Where that wall stands past a
   side by more than `tol.len` (at an end, since it is linear between them), the hole is made and
   a `connection` error says from where and by how much. This applies to an end hole along the
   axis too: G31's spacer case (its Ø9 at 16.00 off centre on a 40 block, 16 + 4.5 = 20.5 past 20)
   now has the error, rightly.
5. **A side hole** for such a screw, a butt through a bar's side, is drilled square to its face. A
   screw meeting the face at an angle (more than `tol.ang`) is a `connection` error and no hole is
   made (call 40); positions whose lines miss the face are reported first, as before. v1 drills no
   angled side hole. On the reference frame this names the back diagonal's two upper foot screws
   (22.83° off the foot block's face) beside its two that miss the face, as before.
6. **A tapped end hole at an angle** runs across the bar's cores, which lie along its axis: a
   `machining` error (`cores.ts`), not a core-position check.
7. **Words.** `derive --json` gives `exit_mm` and `angle_deg`; the cut list "Ø9.00 hole in end a at
   x 10.18, y 0.00 from the centre, 7.59° off square, exiting end b at x -11.16, y 0.00, through"
   (a blind one "…, 20.00 deep, its bottom at x …, y …"); the order's service "hole Ø9.00 into an
   end, 7.59° off square, through", an angled hole being its own setup. Turned end for end, the
   exit's x turns over with the entry's; the identity and the duplicate key compare exit and
   angle (two angled through holes are one hole when they meet both ends at the same places).
8. **G35** (**verified**: `by_hand.py`). A 40x80, rolled flat, from (1660, −190, 0) to (160, 10, 0),
   tan θ = 2/15 (7.59°) to an 80x80 block's axis, bears on its end b; J2 taps M8 at (0, ±20) in the
   40x80 and drills Ø9 at the same places. Its line through (0, −20) enters the block's end at
   x −10.18 (10 − 20 · √229/15) and leaves the other end at 11.16 (a drift of 21.33 over 160); the
   one through (0, 20) enters at 30.18 and crosses the side x = 40 73.67 mm in, its wall
   (4.5 · √229/15 = 4.54 off its axis) from 39.62: an error and no hole. 20 lower, both stay in.
   With no tap in the 40x80 (J2-H), A4's holes along the axis at −10.18 and 30.18.

On the reference frame (**measured**, its document derived with this code), the 40x80's rail end:
its +20 screw leaves the rail block 78.68 in, its wall from 44.34. The fourth run's own
calculation, from the derived frames, gave 44.7 for where it leaves (**read**); the two are not
reconciled here, and that figure is nearer the wall's 44.34 than the axis's 78.68.

## Part 2: a butt's end face sits on its face

**The cause** (**read**, `ends.ts`). A butt checked that the butting bar's centre line crosses the
face (`butt-miss`), never the end face itself: its outline could reach past the face, and the bar
could go into the receiving body beyond it.

9. **Where it is measured.** Stage 3 records the face each butting end bears on (a side of the
   through bar's box, the through bar's end, or a slab of a through body's box), and the seats are
   measured on the trimmed bars at its end, before stage 4; only ends whose plane is the butt's own
   (not a fallback after an error) are measured.
10. **The end face** is the butting section's outline with every grooved side closed (A3's
    machinery, `outline.ts`), on its end's plane. **The face** is a side of the through bar's box,
    whole across (A3 decision 1: a grooved side is its bounding plane, so an end face over a
    groove is not an overhang) and trimmed by its end faces; the through bar's end face, its
    outline closed the same way; or a side of the body's box. Both are seen along the face's
    normal (a spacer's offset falls away).
11. **The overhang** is the greatest distance of an end-face vertex from the face's outline, and
    the area of the end face past it (its area less what it shares with the face, exact for any
    outline: the face cut into convex pieces, the end face clipped by each). A vertex is enough on
    a convex face, where the distance is greatest at one; on a concave end face (an angle's) an
    edge could reach further between two vertices, so the length is a lower bound there (the area
    is exact). The distance is Euclidean (call 41): a corner past two sides counts its diagonal.
12. **The threshold.** A warning, not an error (§5.5 lists no overhang among the errors, and a
    designed overhang is a choice): past the connector's `overhang_mm`, else the project's
    `defaults.butt.overhang_mm`, else 0, by more than `tol.len` (0.01). The connector's comes
    first, being specific to the joint; an end plate larger than the bar's end says so this way,
    since a spacer is otherwise taken to be no larger than the face.
13. **The overlap** is how far the butting bar's body goes into the receiving body beyond the
    face's plane: the greatest depth n · (p − X) over the points X of both. The butting body is its
    outline's prism between its end faces, cut into triangles' prisms; the receiving body is the
    through bar's box between its end faces, or the body's box. Each pair is convex, so the depth
    is a linear programme, greatest at a vertex where three of their planes meet (all triples
    tried; at most 11 planes). A triangle none of whose own vertices goes past the plane by more
    than `tol.len` is skipped, and when no vertex of the bar does, the depth is 0, so a flush end
    costs nothing. More than `tol.len`: a `connection` error.
14. **Only the joined pair.** The record's own check also finds members overlapping members they
    are not joined to (a diagonal's foot in a floor tie, a bracket in a rail's end cleat). That is
    a clash check between any two bodies, which v1 does not make; it is not this check.
15. **G36** (**verified**: `by_hand.py`): a 40x40 post on a 40x40's top, flush, 1600.00 mm²; 10
    across, 10.00 and 400.00 mm² past (25.0 %); at the through bar's end with `through_end:
    "node"`, 20.00 and 800.00; `defaults.butt.overhang_mm: 10` lets the 10 pass, a connector's 5
    warns again; a 45° brace's 2262.74 mm² end face lies on the face, and pushed 2 in along its
    axis (`extend_mm: 2`) it goes 2/√2 = 1.41 in, an error.
16. **G17's angled bearing end stays clean of errors.** Its brace's end is cut on the block's end
    face, so no part of it goes into the block (overlap 0, also with the block's end extended 20,
    the brace following it). Its end face is 40 / cos 36.87° = 50 wide on a 40 end, so it reaches
    5.00 past each side, 400 of 2000 mm²: the warning is true of that geometry, and making G17
    quiet would mean raising the default past a real overhang. Extended 20, the brace's centre
    line meets the end 15 off centre: 20.00 and 800 mm².
17. **Earlier fixtures the warning flags** (**verified**: every fixture derived before and after).
    G2: its through end stops at the node, so half the post's end, 20.00 and 800 mm², hangs past
    it, the case's point. G17's three cases (above; with an 8 mm spacer the brace meets the end 6
    off centre, 11.00). G27 with n1 at z = 100: the strut on the shoe's end, 7.00. G31's three
    cases: the brace 10 off centre on a 40 end, 15.00 (21.00 with the spacer). G35's: its 40x80,
    80.71 wide on the block's end, 10 off centre, reaches 10.35 past the 80 block's side. The
    cart: the steel beam's 100-tall ends on the 40-tall base rails, 30.00 above and below, and
    the grip's 45° end on the arm's end through an end plate the arm's size, 16.28; its hand
    script now works these three, and the tests that list the cart's diagnostics expect them.
    Tests whose fixtures are not about seats (a rolled brace and its mirror image, a post off a
    beam's centre line) now expect the warning they really have.

On the reference frame (**measured**) the warning gives the record's own figures for the 40x80's
two block ends, 10.92, and 9.88 for the rail end, which is the corner's distance of the record's
9.78 across and 1.40 above (√(9.78² + 1.40²) = 9.88); and the back diagonal's foot, 26.56. It also
flags the two back rails' ends, 40.00 past the posts they butt, half of each end face
(**measured**; *inferred*: at the posts' tops), where the record names no fixing.

## Part 3: a screw head seats on material

**The cause.** Nothing looked at what a head bears on: on a T-slot face a head centred over the
groove bears only on the two lips either side of the opening.

18. **Where.** Face connections only, at each station: the head on the first layer's face that the
    walk enters by, and a bolt's nut on the last layer's face it leaves by. A screw's or a tnut's
    other end is in its tapped hole or T-nut. A butt connector's screws are not checked (a v1
    limit): its fastener sets do not say which part bears on which face. So the record's two
    diagonal-foot heads (2.19 off the block's back face) are not caught by this change.
19. **What bears.** At the head the fastener's own head; for a fastener with none there (a rod cut
    from stock, a hammer screw whose head is in the groove), the stack's first nut. At the nut, the
    stack's next nut. Washers in the stack's order: the first under the head, the next under the
    nut (call 43); a washer's outside diameter replaces what it is under, as the brief has it, so a
    single washer in a bolt's stack is taken to be under the head. A stack that means it under the
    nut lists two.
20. **Diameters.** The item's `dims`: `dw_mm` (a bearing face, where given), else `dk_mm` (a round
    head, ISO 4762), else `s_mm` (across flats of a hex head or a nut, ISO 4017, ISO 4032: the
    inscribed circle, which bears); a washer's `d2_mm` and its bore `d1_mm`. `std`'s fasteners
    carry them (**read**: `catalogs/std`). An item with none is not checked: one `fit` info per
    item, entity its first connection, naming every connection it is in (not one per station).
    There is no fallback to the ISO tables by the item's `head` (call 43): derive reads only the
    lock, and a vendor item that names no standard (Forseti's screws) would not be helped by one.
21. **The annulus** runs from the hole (the ISO 273 medium clearance the fastening drills, or the
    thread's nominal diameter where none is known) or a washer's bore, whichever is wider, out to
    the bearing diameter, centred where the fastener's axis meets the face.
22. **The material.** A bar's bounding face is its side less every opening: where the section's
    raw outline, read 0.1 mm below the face (`SEAT_DEPTH`), is not there (`materialAlong`, A3), and
    each groove the section declares on that face, its type's `opening_mm` wide (the groove type
    now carries it). The face is trimmed by the bar's end faces, so a head near an end loses what
    hangs past it. An inner face or a part's box face is whole.
23. **The fraction.** The area of the annulus on the material, exact: for each convex piece of
    material, the area a disc shares with it (the sum over its edges of the disc's share of the
    triangle from the centre to each edge, a triangle inside the circle and a sector outside),
    the outer disc's less the inner's; over the annulus's area.
24. **Thresholds** (call 42). Below 50 % on material, a `fit` warning with the fraction: a head on
    less than half its seat stands mostly over air, whatever the load (loads are v2). On none (the
    fraction at most 10⁻⁹), a `fit` error: wholly over an opening, or off the face. Stations with
    the same seat and fraction share one diagnostic. The 50 % is a stated geometric rule, not a
    rating; it is not settable in v1.
25. **G37** (**verified**: `by_hand.py`, with the disc-in-a-band formula 2(h √(ρ² − h²) + ρ² asin
    (h/ρ))): an M8 socket head, dk 13, centred on a 40x40's c8 groove (opening 8.2) over its Ø9
    hole: 45.87 %, a warning; a washer d2 16: 53.74 %; an M4 head, dk 7, inside the opening: 0, an
    error; on a 50 x 10 flat face: 100 %; bolted through two 40x40s, the hex head and the nut (s 13)
    each 45.87 %, two warnings, and with two washers 53.74 % each.
26. **Earlier fixtures** (**verified**). No seat warning or error on any earlier fixture: their
    fastener items give no diameters, so each gets the info instead, G24 (the rail screws), G25 and
    G32 (the rods' washers), G29 (its M12 bolt) and the cart's rods' washers and rail screws (its
    hand script now lists the two). On the reference frame its M8 screws (Forseti's) and its M12
    sets give none: four infos, one per item.

## Tolerances

`tol.len` (0.01 mm) for an overhang, an overlap, a hole's wall past a side and a screw's position
matching a tap's; `tol.ang` for a screw square to a side face; 0.1 mm below a face for the
material a seat bears on. The polygon work (`polygon.ts`) is exact for simple outlines: clipping by
convex pieces, ear-clipping triangulation (Meisters; trying only reflex vertices, after Eberly),
and the disc–polygon area.

## Open

Angled side holes, a clash check between members that are not joined, the seats of a butt
connector's screws, a settable seat threshold, and head diameters from the ISO tables for items
that name their standard but give no dimensions: each would follow its own request.
