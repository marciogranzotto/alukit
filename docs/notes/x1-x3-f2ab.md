# X1–X3, F2a, F2b: joints the alternative frame's acceptance could not write

*2026-11-27. Closes gaps X1–X3 of the alternative frame's acceptance (frame X) and two v1 limits
F2 left ([`f2-joint-geometry.md`](f2-joint-geometry.md), its "Open" section): a butt connector's
screw heads were not seat-checked (F2b), and a head was checked only when its item gave its
diameter (F2a). Each is fixed at its root with failing tests written first and a golden case worked
by an independent hand script (G39 and up). The design text follows (marked *2.3*, listed in its
changelog under "After the alternative frame's acceptance, part 2"; open calls from 45). Labels:
**verified** (run, with how), **read** (from the code or a document), **inferred**.*

**Golden values.** No golden value of G1–G38 moved, nor the cart's or the base frame's outputs,
except the diagnostics listed under each gap, each with why it is right (**verified**: the unit
suite and the gate).

## X1: a blind fastener

**The case.** A plate fixed to an RHS from one side with blind expansion bolts (a Hollo-Bolt):
the bolt's sleeve goes through a hole in the plate and the RHS's near wall, and expands inside the
bore. **The cause** (**read**, `fastenings.ts` before this change): a face connection knew `bolt`,
which drills an ISO 273 clearance through every layer and both walls of a hollow one, and `screw`,
which taps the last layer (its near wall when hollow). Neither makes a plain hole in the near wall
alone, and neither drills the hole the maker states: an M8 Hollo-Bolt needs Ø14, ISO 273 gives 9.

1. **A fastening kind, not an item property alone.** `fastening: "blind"` says how the joint is
   made (which layers are drilled, what the grip counts), as `bolt`, `screw` and `tnut` do; the
   item says what the maker states. A blind rivet through two plates and an expansion bolt into a
   tube are both `blind`.
2. **The maker's hole.** The fastener item states it, `hole_mm` (a valued field, with its own
   provenance). No standard gives a blind fastener's hole, so a `blind` fastening whose item states
   none is a `face` error, not an ISO 273 guess; so is a fastener cut from bar stock, which has no
   maker's hole. Other fastenings do not read `hole_mm`.
3. **Which walls.** Every layer before the last is drilled whole (both walls of a hollow one, as a
   bolt). A hollow last layer (an RHS or a tube, `hollowOf`) is drilled in its near wall alone, the
   wall the axis meets first (`walls()`: an RHS's wall thickness, a tube's chord at the axis's
   offset); a solid last layer is drilled through, the fastener gripping behind it.
4. **The grip** is the material the fastener passes: every layer before the last whole, the last
   layer whole when solid, its near wall when hollow, plus the declared gaps. Outside the item's
   `grip_min_mm` to `grip_max_mm` (either may be given alone) by more than `tol.len`, a `fit`
   error per grip value, naming its stations (a fastener that cannot clamp the joint is as wrong
   as a T-nut that does not fit). Two fields, not a `{ min, max }` pair: every valued field names
   its unit in its own key (§2).
5. **No sleeve in the last layer's bore**, where the fastener grips: a `face` error.
6. **The head** seats on the first layer like any head (F2's seat check, with the maker's hole as
   the annulus's inside); there is no nut.

**G39** (**verified**: `by_hand.py`): a 12 mm plate on a 200 x 100 x 4.75 RHS's top wall, two blind
M8s (hole 14, grip 3 to 22): Ø14 through the plate, Ø14 4.75 deep in the top wall, none in the
bottom wall, grip 16.75; a 25 mm plate grips 29.75, a `fit` error; on a solid 8 mm flat, through,
grip 20.00; with no `hole_mm`, a `face` error and no hole. `x-gaps.test.ts` adds a tube (its near
wall, 3 deep, grip 15), the sleeve and the bar-stock refusals, and the words.

On the reproduction (**verified**: its document derived with this code, its HB08 given `hole_mm`
14 and a grip of 3 to 22), `fastening: "blind"` gives Ø14 through the plate and Ø14 4.75 deep in
the RHS's top wall only; `bolt` still drills both walls and `screw` still taps, as those kinds say.
