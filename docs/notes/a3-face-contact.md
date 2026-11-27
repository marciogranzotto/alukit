# A3: face connections on a section's real outline faces

*2026-11-26. Closes gap A3 of the v1 acceptance (§13): a face connection's layers could meet only
on their sections' four bounding faces, so a block bolted to an angle's inner leg face, or to a
channel's or a beam's inner faces, could not be a layer. For the coordinator to fold into
[`design.md`](../design.md) or veto; the design is not edited here. Labels as in the design:
**verified** (run or checked, with how), **read**, **inferred**.*

**Verdict: a build fix with one rule to state.** The design's §4.5 says a face connection's pairs
must have faces that are "antiparallel …, coplanar … and they overlap"; it never says which faces.
The build read "faces" as the bounding box's four sides, everywhere a face connection looks at a
layer. A layer's faces are now its bounding faces, as before, **plus the inner faces of its
section's outline**, and the stations, the fastener's walk, the grip and the generated holes use
the faces the fastener really passes. Golden case G29.

## The gap and its root cause

The reproduction (**verified**, on the built-in `std` angle and Forseti's exact 40x40, with the
code before this change): an `L-76.2x6.35` along +X with its heel on the design line, a `PF40-01`
on the inner face of its upright leg (y = 6.35), and one M12 bolt at 100 along the angle give
`error face c1: b1 and b2 are not in contact: no faces of theirs are antiparallel, coplanar and
overlapping`. On the leg's outer face the block is in contact.

The cause (**read**, `src/core/derive/fastenings.ts` before this change): a layer's body was its
placed bounding box's four sides (`barBody`), and three things used only those:

1. **Contact** tested pairs of those four faces. The angle's inner leg face lies inside its box,
   so it was never a candidate.
2. **The fastener's walk** entered and left each layer by the box face whose normal faced the
   axis. On the leg's outer face the block *was* in contact, but the bolt then ran through the
   angle's whole box, 76.2 deep, where only the 6.35 leg stands on its line: grip **116.20**
   instead of **46.35** (**verified**, the same reproduction on the outer face). This is the same
   cause, and no golden covered it.
3. **The station and the holes** sat on, and were named by, the box's faces.

The design's sentence "It is the bounding box, not the outline" is about the planes that cut bars
(§4.5, *What planes are built from*); m3b decision 17 carried the box over to contacts.

## The rule as built

**A layer's faces.** For a bar, its **bounding faces**, the box's four sides whole, as before:
§4.3 names them and cuts and stations use them. And its **inner faces**: the straight runs of its
section outline's outer ring that lie off the outline's own four sides (`src/core/derive/outline.ts`).
An angle has two (its inside leg faces), a channel three (both flanges' inner faces and the web's),
a beam its inner flange and web faces. A part's faces are its box's six, as before.

- **A grooved side is its bounding plane.** On a side where the section declares a groove, every
  excursion of the outline from that side and back to it is part of the face, the grooves and any
  marks rolled into it, and is closed along the side before the inner faces are taken. So a T-slot
  profile has no inner faces besides its corner radii's chords.
- **Holes are not faces.** A tube's bore and a T-slot's core and cavities are not faces a layer
  can bear on.

**Contact.** Two adjacent layers are in contact when a face of one is antiparallel to a face of
the other, coplanar with it or apart by the pair's declared gap, and overlapping, within the
existing tolerances (tol.ang, tol.len, an overlap above tol.len²). The bounding faces are tried
first, in the order they were before, so a pair that met on them meets on the same faces now.
Then every pair with an inner face in it, in face order. `faces` still names bounding faces only.

**Stations.** A station sits on the first layer's face toward the second, on that face's centre
line, then `across_mm` along §4.3's u. A bounding face's centre line is §4.3's. An inner face's is
**level with the box's centre**: the foot of the perpendicular from the box's centre line onto its
plane, with u as on the parallel bounding faces (local +y across a face that faces ±x, local +x
across one that faces ±y). A station must lie on the face, within tol.len.

**The walk.** The fastener enters each layer by its contact face with the layer before and leaves
by its contact face with the layer after. The first layer's head side and the last layer's nut
side are **the nearest face across the layer's material** that faces out along the axis and holds
it: the far side of an angle's leg or a channel's flange, and for a box-like section the opposite
side, as before. Every face the axis passes must hold it. The grip is as before: the depths of the
layers between those faces, plus the declared gaps.

**Holes.** A generated hole's op names one of the four faces (§4.4), so a solid layer's hole is
listed from a bounding face: the face the fastener enters by (as before), else the face it leaves
by, else a bounding face parallel to either across open air (an I-beam's web). It gets a
`depth_mm` when more of the section stands on its axis than the layer the fastener passes: a
channel's bottom flange, with the top flange on the same line. A counterbore needs its own end's
face. When none fits, a `face` error. Hollow layers are as before.

**T-nuts.** Grooves are declared on bounding faces, so a `tnut` whose last layer meets the stack
at an inner face is a `fit` error.

## Decisions

| # | Decision | Why |
|---|---|---|
| 1 | The bounding faces stay the box's four sides, whole; the outline adds inner faces | A round bar's tangent plane, an RHS's radiused side and a T-slot's grooved side all bear on the box's side, and none is a straight run of the outline there. Every earlier result stays as it was. What this leaves: a body against a bounding plane where the outline does not reach it (an angle's toe end above the toe) still counts as in contact, as before |
| 2 | A T-slot's grooved face counts as its bounding plane: every excursion of the outline back to a grooved side is closed | The groove is part of the face, not its end. A station's default is the groove's centre line, where a bolt through the profile passes the core; T-nuts and the lip are defined on that face; a head or washer spans the opening. Left open, a bolt through a 40x40 at its groove would stop at the far groove's floor. Forseti's exact outlines also carry 2 mm marks 0.19 deep in their faces (**measured**: `PF40-01` at 11..13 from the centre); those close too, so a bolt over a mark still bears on the face |
| 3 | An excursion from an ungrooved side stays open | A channel's interior is an excursion from its open side back to it; its walls are the channel's inner faces |
| 4 | "On a side" uses the outline's own extremes, within tol.len | An exact outline drawn on a drawing's stroke centreline sits a little inside its nominal box: **measured**, `PF45-02`'s ±x faces are 0.018 inside. Against the nominal box its grooves would not close and its true faces would be inner faces |
| 5 | Holes are not faces | A layer inside a hollow one (a block in a tube's bore) is out of scope; sleeves stay as §4.5 has them |
| 6 | An inner face's station is level with the box's centre, not the face's own middle | The face's middle depends on the root and toe radii, which `std` estimates; the box's centre does not. And a leg's inner and outer faces then share their centre line, so a block moved across the leg keeps the same hole. Centring on the overlap with the next layer would move every existing station |
| 7 | Contact tries bounding pairs first, then pairs with an inner face, in face order | Existing results cannot change. A block in an angle's corner, touching both inside faces, takes the first; `faces` cannot name an inner face yet |
| 8 | The head and the nut bear on the nearest face across the material | It is what the fastener passes: a leg, a flange. For a box-like layer it is the opposite side, as before |
| 9 | A hole between two bounding faces passes the whole section; otherwise the section's material on the axis decides `through` or `depth_mm` | The op's "through the whole section along the face's normal" (§4.4) would otherwise drill a channel's other flange |
| 10 | Inner faces are reported by the side they face and their plane's section coordinate, `+x@-31.75`; an oblique one by its normal, `[0.7071,0.7071]@12.34` | The contact report names faces; an inner face has no §4.3 name |
| 11 | Derive does not size or check the fastener's length | §4.5 leaves that to v1.1 (call 25). What derive gives, and G29 pins, is the fastener's **length through the layers**: from the face its head bears on to the last layer's far face (the stations' last `to_mm`, which the viewer draws). For a bolt it equals the grip |
| 12 | A section's faces are worked out once per built section; a bar's inner faces are looked up by direction and placed only when asked for | A section with radii has hundreds of inner faces, nearly all arc chords (546 edges for the `std` angle, 724 for an RHS) |

## G29, worked by hand

`tests/fixtures/golden-gen/G29/`: a synthetic catalog, `tests/fixtures/catalogs/test-open`, holds
the `std` angle's generator params, a sharp-cornered channel 100 x 50 (web 6, flanges 8) and an M12
bolt, so the golden does not move with the built-in catalogs. The block is the test catalog's
40x40. `by_hand.py` beside it recomputes every number with plain arithmetic, imports nothing from
AluKit, and checks `expected.json` (**verified**: it agrees).

Every bar runs along +X, so local x is world +Y and local y world +Z (§4.4).

- **Base** (the reproduction): the angle's upright leg fills y 0..6.35, z 0..76.2; its inner face,
  the plane y = 6.35, is flat from the root fillet's end, z = 6.35 + 9.525 = 15.875, to the toe
  radius, z = 76.2 − 4.76 = 71.44. The block, centred at (26.35, 50), spans y 6.35..46.35 and
  z 30..70: its −y face is on that plane and overlaps it over z 30..70. **In contact.** The station
  is at 100 along, on the plane, level with the box's centre: **(100, 6.35, 38.10)**. The bolt runs
  +Y; at z = 38.1 only the leg stands on its line (the horizontal leg and its fillet end at
  z = 15.875), so it passes the leg, **6.35**, then the block, **40**: **grip 46.35**, and **46.35
  through the layers**. One Ø13.5 hole (ISO 273 medium, M12) in each: the leg's from its outer face
  (`-x`), the block's from its `-x` face, 11.9 below that face's centre line.
- **The outer face**: the block centred at y = −20 bears on the leg's outer face, y = 0, the angle's
  bounding `-x` face. The bolt runs −Y through the leg from its inner face: **grip 46.35** (it was
  116.20 before this change: the box, 76.2, plus 40). The leg's hole is listed from its outer face.
- **0.1 mm off the inner face** (the block centred at y = 26.45): its face is 0.1 from the leg's,
  beyond tol.len: **a `face` error**, refs b1 and b2. With `gaps_mm: [0.1]`: **grip 46.45**.
- **`across_mm: [11.9]`**: the station at z = 50, the block's centre: **(100, 6.35, 50.00)**, still
  on the face; the block's hole is on its centre line.
- **A channel's inner flange**: the channel centred, its bottom flange z −50..−42 and its inner face
  the plane z = −42 from the web (y = −19) to the toe (y = 25). The block centred at (3, −22) rests
  on it. With `across_mm: [3]` the station is **(100, 3, −42)**. On the line y = 3 the channel is
  both flanges, z −50..−42 and 42..50: the bolt passes the bottom one, **8**, then the block:
  **grip 48.00**. The flange's hole is listed from its outer face (`-y`), **8 deep**, since a
  through hole would cross the top flange too.

## Verification

- `src/core/derive/contact.test.ts` (written first, failing on five of its six cases before the
  change): the reproduction on `std` and Forseti, its station across the face and off it, 0.1 mm
  off with and without the gap, the outer face, the channel's flange, and the T-slot decision
  (Forseti's exact 40x40 with a flat on its grooved face, bolted at its groove and over a mark:
  grip 50.00 both; this one passed before too and guards decision 2).
- `src/core/derive/outline.test.ts`: the faces of a channel, an angle and an RHS, groove and mark
  closing, the lookup by direction, and the material on a line.
- **Every committed fixture derives byte for byte as before** (**verified**: `derive --json` and
  the cut list of the cart, G1–G28, the order fixture and both base frames, with the code before
  and after this change, compared in-process). G1–G28 and the cart's tests pass unchanged.

## Performance

Warm in-process derives, the code before and after this change run alternately three times
(**measured**, Node 26.13.1, on a machine loaded by other test runs, so the minimums are steadier
than the medians):

| Workload | Before: medians; minimum | After: medians; minimum |
|---|---|---|
| The cart fixture (4 face connections), 500 runs | 0.88, 1.01, 0.92 ms; 0.69 ms | 0.97, 0.92, 0.99 ms; 0.73 ms |
| A full frame with 42 face connections, angles and RHS among the layers, 200 runs | 5.06, 4.79, 5.08 ms; 4.04 ms | 5.63, 5.50, 5.60 ms; 4.48 ms |
| Forseti's 1,034-item catalog: open, then `catalog check` | 42 ms, 87 ms | 40 ms, 73 ms |
| G29 (one face connection on an inner face), 500 runs | | 0.25 ms; 0.17 ms |

The cart is within its noise (about 0.04 ms on its minimum); the catalog does not run this code.
The frame's half millisecond is work it now does on its angle layers: finding their inner faces,
and the material on each angle hole's axis. A first version, which placed every inner face of
every layer it walked, took 7.6 ms on the frame; what brought it down: contact on bounding faces
is tried first and costs what it did; a bar's inner faces are looked up by the direction of their
normal (a binary search on the section's normals) and placed only when found; a section's faces
are worked out once per process, a bar's body once per derive; a face's own plane polygon once;
and a hole between two bounding faces skips the material test.

## Wording for the design

*Suggested; for §4.5's `face` row, its paragraphs, and §4.6.*

> **The faces of a layer** (*2.3*). A bar's faces are its four **bounding faces**, the sides of its
> placed bounding box, which §4.3 names, and its **inner faces**: the straight runs of its
> section's outline (the outer ring) that lie off the outline's sides, such as an angle's inside
> leg faces or a channel's inner flanges. On a side with a declared groove, the outline's
> excursions from that side and back (the grooves, any marks) are part of that face: a T-slot's
> grooved face is its bounding plane. Holes are not faces. A part's faces are its box's six.
> Contact is tried on the bounding faces first; `faces` names bounding faces.

In the table's `face` row, *Valid when*:

> each adjacent pair has faces (bounding or inner, above) that are antiparallel within `tol.ang`
> and coplanar within `tol.len`, or apart by that pair's `gaps_mm`, and that overlap

After *Stations of a face connection*:

> A station on an inner face lies on its plane level with the box's centre, and `across_mm` moves
> it along §4.3's u, as on the bounding faces parallel to it. The fastener enters and leaves each
> layer by its contact faces; the head and the nut bear on the nearest face across their layer's
> material, so a bolt through an angle's leg passes the leg, not the angle's box. A hole is listed
> from a bounding face at one of its ends and takes a depth when more of the section stands on its
> axis (a channel's other flange).

In *Generated holes*, after "both walls of a hollow one":

> ; a solid layer's hole is listed from a bounding face at one of its ends, else one across open
> air, and takes `depth_mm` when more of the section stands on its axis

The row for §4.6:

> | G29 | angle L76.2x6.35 (root 9.525, toe 4.76) b1 (0,0,0)→(300,0,0), anchor `heel`; a 40x40 b2 (0,26.35,50)→(300,26.35,50) on the upright leg's inner face; `face` [b1, b2], `bolt` M12, `at_mm: [100]` | a layer on an inner face (gap A3) | in contact on the leg's inner face; station (100, 6.35, 38.10); grip 46.35, 46.35 through the layers; Ø13.5 in each, the leg's from its outer face. On the outer face (b2 at y = −20): 46.35 (the box gave 116.20). 0.1 mm off: error; with `gaps_mm: [0.1]`, 46.45. `across_mm: [11.9]`: station z 50.00. On a channel 100x50x6x8's bottom flange, the block at (3, −22), `across_mm: [3]`: grip 48.00, the flange's hole 8 deep |

## Out of scope, and follow-ups

- **Naming an inner face in `faces`**, to choose between two contacts of one pair (a block in an
  angle's corner): the reported names (`+x@-31.75`) could be accepted there.
- **A layer inside a hollow one** (holes as faces).
- **A bounding face trimmed to where the outline touches it**, so that a body against an angle's
  toe-end plane above the toe is not in contact. It needs a line-contact rule for round bars,
  whose outline touches its box's sides only at a point.
- **Sizing or checking the fastener's length** (v1.1, call 25): the length through the layers is
  where it would start.
- A `channel` and a `beam` generator (§3.5) do not exist yet; their sections are `exact`, `traced`
  or `box` until they do, and the inner faces come from those outlines.
