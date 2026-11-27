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

## X3: a plain bar held by a screw in a drilled hole

**The case.** A post's end screwed down through a plain aluminium block: an M8 through a Ø9 hole
in the block into a reducing bush in the post's core. **The cause** (**read**, `hardware.ts`
before this change): fit by role (acceptance-gaps A1, A9) held a through bar by its system, by a
sleeve in its bore, or by another butt's through-fastener (`held_by`). A block of no system has
none of these, so the joint was a `fit` error that blocked the order, though the screw holds it.
A1 decision 2 had kept a `requires` hole from holding a bar, rightly: a T-slot bracket that drills
its through bar holds it by its groove, and counting the hole would pass that bracket on an RHS.
What holds the block is not the hole but the screw through it into the butting end.

7. **The rule** (`screwThrough`): a fourth way to hold a butt's through bar. The connector
   requires a `through-hole` in it (`on` through or each) with a `d_mm` and no `depth_mm`, so the
   hole runs through and the head bears on the far side.
8. **The screw's hole**: at a position where the connector also taps the butting end (`end-tap`
   on butting or each, F2's pairing, call 40). A hole with no tap at its place is a hole for
   something else (an access hole, a bracket's bolt), and holds nothing.
9. **A headed fastener that passes it**: a chosen fastener set (for the butting bar's system)
   holds a `screw` or a `bolt` whose thread's nominal diameter is less than the hole's by more
   than `tol.len`. A stud has no head to bear; a hole the shank does not pass is no clearance.
   v1 does not tie the screw to a particular mount hole: any headed fastener of a chosen set
   counts, as the sets count once per hole (§3.4).
10. **Not hollow.** An RHS or a tube is held by a screw only with a sleeve in its bore (A1's way);
    a screw through both its walls would crush them. So J1 through an RHS still fails.
11. **The words.** A through bar held no way gets A1's error plus ", nor does a screw through it
    hold it: <why>", the first condition that fails for each through-hole; a connector that
    requires no through-hole keeps A1's words exactly. G30's mountless end connector on an RHS
    (it requires a through-hole) now says the RHS is hollow (**verified**: every fixture scanned).
12. **The holes are not a condition of success**: whether the hole is made (on the face, in the
    block) is the machining's own check, with its own error; fit reads what the connector says.

**G40** (**verified**: `by_hand.py`): a 40x40 post with an M16 core on an 80 x 80 block, J1 (an M16
end tap, a Ø9 through-hole, a bush and an M8 socket screw): no error, Ø9 through the block at 100,
the tap in the post. Through the block's end: an end hole along its axis, no error. A 20 deep
hole, a hole with no tap at its place, a Ø6 hole, a stud, an RHS: a `fit` error naming b1, each
with its reason (`x-gaps.test.ts`).

On the reproduction (**verified**: derived with this code), the J1 through the plain 80 x 80 block
derives with no `fit` error.

## X2: a butt's stack

**The case.** A post's end screwed down through an 8 mm end plate into a rail: the J1 screw comes up
through the rail, through the plate, into a bush in the post's core. **The cause** (**read**,
`ends.ts` and `hardware.ts` before this change): a butt bore on one face, the through bar's,
lifted only by `spacer_mm`. A spacer is a thickness, not a bar, so the plate written as the spacer
got no hole (X2a), and the plate written as the through bar left the rail under it undrilled, with
a `fit` error on the plate (X2b).

13. **A list of bars on the butt**, `stack`, from the face out. Not a `face` connection's layers:
    the stack sets where the end bears, so stage 3 must read it, and a face connection is resolved
    in stage 4, after the cuts. Not parts: a part is placed in stage 4 too (call 47). A plate is a
    bar of flat stock, as the record writes it.
14. **Laid out in stage 3** (`stackOn`), on the butting bar's centre line, at each butting end: each
    bar's two crossed faces square to the face's normal within `tol.ang`, its near face within
    `tol.len` of the face below. The depth lifts the end plane; the end's seat (F2) is measured on
    the last bar's far face. The stack bar's extent along its own axis is not read here (its ends
    may not be resolved yet): a hole that lands past its cut ends is stage 4's error, and the seat's
    overhang warns as for any face.
15. **No second spacer.** `spacer_mm` with a stack, or a connector with its own `spacer_mm`, is a
    `connection` error, said once per butt: v1 places no connector, so it cannot say whether its
    spacer or the stack lies nearer the face.
16. **The holes follow the through bar's.** Each hole the connector makes in the through bar (a
    `through-hole`, or an end tap whose screw comes from the butting side) is drilled through each
    stack bar where its axis crosses it: the hole's diameter, or the thread's ISO 273 medium
    clearance. For a side hole the axis is the face's normal through the joint point; for an end
    hole, its own axis (the screw's, when it pairs with a butting tap). A side hole is drilled square
    to its face, so an axis off square is an error, as F2's call 41 has it; so is one off the bar.
17. **What v1 does not drill.** An access hole or a counterbore in the through bar under a stack
    is a `connection` error: v1 does not know whether the tool or the head passes the stack.
18. **Held by the screw that clamps it**, X3's rule with the through bar's hole (conditions 1–3)
    and the stack bar's own shape (4): the screw from the through bar's far side passes it into the
    butting end. Its system does not hold it: nothing of a T-slot connector reaches a plate between.
    A connector that drills nothing in the through bar, or whose screw comes from the butting side,
    leaves the stack bar a `fit` error naming it (call 47).
19. **References.** `stack` entries are whole references (`refs.ts`): the joint is another without
    one. Patterns remap them; edits rewrite them.

**G41** (**verified**: `by_hand.py`): an 80 x 8 plate on a 40x40 rail, a 40x40 post with an M16 core
on it, J1 with `stack: ["b3"]`: the post's end at z 28, cut 572, seated on the plate (1600 mm²);
Ø9 through the rail at 300 and the plate at 40. Two plates: cut 564, a hole in each. Through the
rail's end with the plate standing on it: the end hole along the axis, the plate's at 40. A spacer
as well, a plate 2 mm off, a plate the post misses: a `connection` error; a tube, a hole at no tap:
a `fit` error naming the plate. `x-gaps.test.ts` adds the words, a tilted plate, the through bar in
its own stack, a through end-tap's clearance (Ø9 for M8), a pattern copy, and the references.

On the reproductions (**verified**: derived with this code): X2a with `stack` in place of
`spacer_mm` drills the plate Ø9 and cuts the post 552, with no error. X2b as written (the plate as
the through bar) now passes `fit` by X3, but the rail under the plate is still not drilled, and the
screw's head would sit between the plate and the rail: the head's seat on the plate's far face is
F2b's to check (below). The right model of X2b is X2a's, with the plate in the stack.
