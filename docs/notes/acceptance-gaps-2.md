# Acceptance gaps, second run: a through-fastener for two ends, and machining at positions

*2026-11-26. The second acceptance run passed all four numeric tests with no exception at all, and
failed overall on one model gap, A9: a joint of one stud through a tube into a bush on each side
could not be written without an error. It found a second gap, A8, that moves no test but makes the
machining wrong without a diagnostic. Each is closed here at its root, with failing tests written
first and a golden case whose numbers an independent hand script works (`by_hand.py`, no AluKit
import). The rules below are folded into [`design.md`](../design.md) draft 2.3 (marked *2.3*, and
listed in its changelog under "After acceptance run 2"); the last section keeps the wording as
proposed. Labels: **verified** (run, with how), **read** (from the code or a document),
**inferred**.*

**Golden values.** G1–G32, the cart's cut list, BOM, order, costs and machining sheet, and the
base frame's outputs are unchanged (**verified**: the full unit suite, 699 tests, and the gate).

## A9: one through-fastener for two butting ends (gap)

**The case.** An RHS 200x100x4.75 of no system along +X; two 40x40 T-slot bars butting into it
from +Y and from -Y on one centre line. The joint is one M8 stud through the RHS, in one 16x3
sleeve cut to the bore, into a bush in each bar's core. Two connectors describe it: a *stud end*
(the stud, a bush, the sleeve; an M16 tap in the butting end, a Ø9 hole through the through bar)
and a *bush end* (a bush and the tap).

**Root cause.** A butt counts its connector, and everything the connector brings, once per butting
end (m3b-gen 27; §4.5). Nothing in the model related two butting ends that share a fastener. So the
joint had two wrong spellings (**verified** on the reproduction, before the fix):

- one butt with both ends and the stud end: no error, but two studs, two bushes, two sleeves of
  90.50, and the Ø9 hole through the RHS made twice, once from each face;
- one butt per end, the stud end on one and the bush end on the other: the counts right, but the
  bush end's butt holds the RHS neither by its system (it has none) nor by its bore (its connector
  sets no sleeve), so fit by role (acceptance-gaps A1) gives a `fit` error that blocks the order.

The second spelling is the right model, a connector per end; what it lacked was a way to say that
the bush end's butt is held by the stud end's through-fastener. A looser fit rule (say, any butt
through a bar some other butt sleeves) would have passed bars that nothing holds.

**The rule as built** (`src/core/derive/hardware.ts`, `heldBy` and `ConnectorGen.fit`):

1. A butt may name **`held_by`**: another butt whose connector's **through-fastener** also holds its
   ends. A through-fastener is what a connector passes through its through bar: a sleeve a chosen
   fastener set puts in the bore (`inside: "through"`), or a hole it requires through the bar (a
   `through-hole` on the through bar with no `depth_mm`, which goes through the whole section).
2. The holder is a butt through the **side** of the same bar, held by nothing itself, whose
   connector passes a through-fastener. Each end of the held butt must be **coaxial** with one of
   the holder's ends (centre lines parallel within `tol.ang` and within `tol.len` of each other)
   and bear on the bar **from the far side**; each holder end holds one end. The held butt's own
   connector passes **nothing** through the bar: the through-fastener is the holder's.
3. The held butt's through bar is then held, a third way beside its system and its bore; its
   butting bars are still held by its own connector's system.
4. Anything else is a `connection` error on the held butt (`ref` for a `held_by` that names no
   connection), naming what failed: not a butt, a chain, another bar or a bar's end, no
   through-fastener, the held butt's own through-fastener, an end not coaxial (with the angle or
   the offset, or "from the same side"), or a holder end already holding one. The through bar is
   then not judged again: one cause, one error.
5. Counting is unchanged: each butt counts its own connector once per end. So the holder brings
   the stud, the sleeve (one piece, `bore` long) and the hole through both walls, once; the held
   butt brings its bush and its tap.

Golden case **G33** (`tests/fixtures/golden-gen/G33`): no error; each 40x40 550.00; one stud, two
bushes, one sleeve 90.50 (100 less two 4.75 walls); one Ø9 hole through the RHS at 500.00 from the
face b2 meets; an M16 tap in each butting end. The variations: one butt with both ends and the stud
end on each (two studs, two sleeves, the hole made twice: a `machining` error, A8's rule); two
butts and no `held_by` (the `fit` error on c2); the held end 20 off the stud's centre line, a
holder that passes nothing through the RHS, and a held end whose connector passes its own stud
(each a `connection` error on c2). `joints.test.ts` adds the refusals G33 does not reach (an
unknown connection, itself, a chain, a splice as holder, a holder end holding twice), a pattern
whose copies hold their own copies, and the edit path.

| # | Decision | Why |
|---|---|---|
| 1 | The relation is a field on the held butt, `held_by`, not a fastener set counted once per connection | The joint's two ends have two connectors (a stud end and a bush end), which one butt with one `connector` cannot hold; the acceptance's own second spelling is right but for the relation. A per-connection set would need the catalog to mark which of a set's parts pass the bar, and still count a body per end |
| 2 | Coaxial and from the far side, or an error | The case to cover is a stud through a bar into two opposite ends. Not coaxial, one stud cannot reach both cores; from the same side, the two bars overlap |
| 3 | A through-fastener is a sleeve in the bore or a hole through the bar | That is what the model can see passing the bar; a hole with a depth is blind and holds nothing on the far side |
| 4 | The holder is held by nothing and passes a through-fastener; the held butt passes none | A chain says nothing a direct `held_by` does not; two through-fasteners on one axis are the double count this gap is about |
| 5 | `held_by` names a connection, and its ends are matched by geometry | A holder with several ends (two studs along one bar) holds the end on its own axis; naming an end would repeat what the geometry says |
| 6 | Derive does not size the shared stud | v1 counts a connector's catalog fastener and checks no fastener's length (call 25, review m15: v1.1). The span the stud crosses is the distance between the two butting end faces, the through bar's depth along the axis plus the spacers: in G33, 100.00, so the 140 stud leaves 20.00 in each bush (G33's hand script) |
| 7 | One butt with two coaxial ends and a stud end on each stays as written: two of everything | It is what that document says; the hole made twice is a `machining` error (A8), which points at it. G30's two bush ends, with a sleeve each and no hole, keep their values and no error (G30 unchanged) |
| 8 | `held_by` is a whole reference | Removing the holder refuses, or cascades the held butt; a variant that leaves the holder out leaves the held butt out with it (**read**: `refs.ts`, `variant.ts`); a pattern remaps it inside its template (**verified**: `joints.test.ts`), and `rewriteEntity`, which array, mirror and split use, carries it (**verified** for `rewriteEntity`; the commands' use of it **read**) |

## A8: a connector's machining has no position (gap, machining only)

**The case.** An 80x80 T-slot bar with four cores at (±20, ±20) along +X; an 80x80 post butting on
its top face with *J4*: an M16 tap in each of the post's four cores and a Ø9 hole through the bar
under each, a bush in each core; a post above it spliced with *SPLICE4*, four M16 studs.

**Root cause.** A connector's `requires` had no position (m3b-gen 29): an end tap went to the
butting end's centre and a hole to the joint point, where the butting bar's centre line meets the
face, because v1 does not place a connector and its mount's frame is not known (acceptance-gaps
decision 12). A joint of four screws, written as the same requirement four times, put all four at
one point; a splice tapped one core an end whatever its stud count (m3b-gen 30). Nothing compared
ops, so the coincident ones passed `check` silently (**verified** on the reproduction: four
identical `hole +y at 300 Ø9`, four identical `end-tap a M16`, one splice tap an end, and no
diagnostic).

**The rule as built** (`src/catalog/schema/items.ts`, `src/core/derive/hardware.ts`,
`src/core/derive/duplicates.ts`, the cut list):

1. A requirement takes **positions**: `at_mm`, a list of `[x, y]`, or `at_holes`, a mount's index,
   whose holes' x and y are the positions. It makes one op at each. A requirement with none makes
   one op where it did before.
2. Positions are read in the **butting bar's section**, x and y from its box centre, at either
   end: the frame the cut list already states end holes and end taps in. v1 does not turn a
   connector to suit the end.
3. They lie in the joint's plane, so they place an **end tap** (in the butting end, or in the
   through bar's end) and a **hole in the through bar**: where the line along the butting bar's
   axis at that position crosses its end plane, carried by the spacer onto the face it butts into,
   or, through an end, onto that end face. The schema refuses them on a hole in the butting bar's
   side (it stands `from_end_mm` in from the end), refuses `at_mm` with `at_holes`, and refuses
   `at_holes` that names no mount, a mount with no holes, or a mount whose plane is not square to
   the connector's z. Derive refuses them on a pivot's base.
4. A position off the butting end's section box, or whose hole misses the through bar's face
   (across it, or past its cut ends) or end face, makes no op; it is a `connection` error, one for
   the positions of one requirement at one end.
5. A **splice** taps one core per stud in both spliced ends: at each position its item gives in
   `splice.at_mm`; with none, one tap per stud (its parts that are fasteners of subtype `stud`, by
   quantity, at least one), each at the centre.
6. **Coincident machining** is an error: two ops of one bar of the same kind and size at the same
   place are one op made twice, a `machining` error on the bar naming the connections that made
   them. Places compare as the cut list's identity does: to 0.01 mm; a hole by its distance from
   design point a; a plain through hole (no depth, countersink or counterbore) by its axis, from
   either face; a through end hole from either end.
7. An end tap with a position carries it: `off` in derive, `off_mm` in `derive --json` and the cut
   list, which words it "tap M16 in end a, at x -20.00, y -20.00 from the centre", lists an end's
   taps by place, and turns it with the piece as an end hole's (x reverses, y stays). The order's
   service is still "tap M16 in an end".
8. `catalog check` warns (`splice-taps`) about a splice whose studs number more than its one
   centred tap, and refuses one whose positions do not number its studs.

Golden case **G34** (`tests/fixtures/golden-gen/G34`): b1 600.00 with four Ø9 holes on face +y at
280.00 and 320.00 from end a, 20.00 either side of its centre line; the post b2 460.00 with four
M16 taps in each end at x and y ±20.00; b3 500.00 with four in end a; four bushes and four studs;
no error; the cut list words each. The positions written out as `at_mm`: the same. The acceptance's
spelling, each requirement four times with no position: a `machining` error on b1 and on b2. A
splice with four studs and no positions: four taps at the centre of each end, a `machining` error on
b2 and on b3. J4 on 40x40 posts: its taps fall off the post's end (a `connection` error), and b1's
four holes stand. `joints.test.ts` adds end holes and end taps placed in a through bar's end, a
tap's offset turning with the piece, the offset in `derive --json`, the schema's refusals, and the
two checks.

| # | Decision | Why |
|---|---|---|
| 9 | Positions in the butting bar's section, from its box centre | v1 places no connector (§4.5), so the only frame a mount's holes can be read in is the bar the connector sits on; it is the cut list's frame for end ops, so a position reads the same in the item, in derive and on the cut list |
| 10 | Not turned to suit the end | A frame with z out of each end would mirror x between ends a and b. Every pattern the acceptance met is symmetric; an asymmetric one is placed as written, and the cut list turns it with the piece. Turning connectors waits for placing them (v1.1 or later) |
| 11 | `at_holes` reads a mount's holes only when the mount's plane is square to the connector's z | Otherwise a hole's x and y are no place in the joint's plane |
| 12 | No positions on a hole in the butting bar's side, nor on a pivot's base | The first stands `from_end_mm` in from the end (m3b-gen 29), the second at the pivot's station: neither is in the joint's plane |
| 13 | A position that falls off is no op and one error per requirement and end | As an end hole off its face (acceptance-gaps 13); one cause, one error |
| 14 | A splice with no positions taps once per stud, at the centre | "One core per stud": a four-stud splice with one tap was silently wrong. Its taps now coincide, so the project's `check` names it, and `catalog check` names the item |
| 15 | Coincident machining is an error, `machining` | A shop sent four taps at one point taps one core, so the order would buy a joint that cannot be built, as a wrong cut would. An error blocks only the suppliers of the bar it names (§5.5) |
| 16 | A through hole is identified by its axis, from either face | The cut list's identity (m3b-gen 32): it is one hole whichever face it is named from |
| 17 | Requirements and splice taps stay once per butting end, not per unit | m3b-gen 29 and 30, unchanged |

## Left open

- A connector is still not placed: it is not drawn, its positions are not turned to suit the end
  (decision 10), and a mount sleeve has no position along the joint's axis beyond the bore
  (acceptance-gaps, left open).
- Derive does not size a connector's fastener, so it does not check that the shared stud spans the
  through bar and reaches both bushes (decision 6; v1.1 with the fastener-length check).
- Two ends that each set a sleeve on one axis in one bore, with no hole, are not flagged (G30's two
  bush ends, kept as they were).

## Suggested design wording

(Applied to [`design.md`](../design.md) as *2.3* text.)

**§3.4, connector row.** "`requires` [machining on the joined bars …: `{ op, on, thread?, d_mm?,
depth_mm?, from_end_mm?, at_mm?, at_holes? }`]; … `splice` { the stud or plates, the tap it needs,
`at_mm`: each stud's core }".

**§3.4, fit by role.** Add: "A butt `held_by` another holds its through bar by that butt's
through-fastener (§4.5)."

**§3.4, where `requires` machines.** Add: "**Positions** (gap A8): `at_mm` lists `[x, y]`, or
`at_holes` names a mount whose holes' x and y they are (its plane square to the connector's z); one
op at each. They are read in the butting bar's section from its box centre, at either end, as the
cut list states an end tap's place, and lie in the joint's plane: an end tap stands at its position,
a hole in the through bar where the line along the butting bar's axis there meets the face it butts
into, or its end face. A hole in the butting bar's side takes none. A position off the end, or whose
hole misses the face, is a `connection` error. A splice taps one core per stud in both ends: at its
`at_mm`, else each at the centre."

**§4.5, butt row, Takes.** Add "`held_by`: a butt whose through-fastener holds these ends too".

**§4.5, after "A butt's connector".** "**A through-fastener for two ends** (gap A9). A butt may be
`held_by` another butt through the side of the same bar, whose connector passes a through-fastener:
a sleeve in the bore, or a hole through the bar. Each held end is coaxial with one of the holder's
ends and bears on the bar from the far side; each holder end holds one; the held butt's own
connector passes nothing through the bar, and the holder is held by nothing. The held butt's
through bar is then held, and one stud, one sleeve and one hole serve both ends (G33). Anything
else is a `connection` error on the held butt."

**§5.1, stage 4.** Add "machining at positions; coincident machining, an error".

**§5.3.** "… 'tap M16 in end a, at x -20.00, y -20.00 from the centre' (an end tap at a position)
…"; an end tap's x turns over with the piece, as an end hole's.

**§5.5, checks.** Add a row: "Machining | two ops of one bar of the same kind and size at one place
(§5.1) | error".
