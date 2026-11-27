# AluKit UX: S3's decisions (the 3D view)

*S3 of the [UX plan](plan.md) (§5.7): the 3D view, built against the [contracts](contracts.md)
and C's [rendering spec](visual-design.md#5-the-3d-view-rendering-spec). Labels as in the plan:
**measured** (run), **read** (from the code that runs), **inferred**.*

## Corners (S3.4)

1. **A corner follows the check's rules, so a marker and the `unconnected` warning agree.** Ends
   meet when their design points lie within the core's length tolerance (`TOL.len`, 0.01 mm),
   grouped as `unconnectedEnds` groups them. An unclaimed end (`by: "default"`) still counts as
   joined when it is the through member of a butt an end there bears on: a through bar left with
   `through_end: "none"`, or the bar end an end plate bears on (the cart's b31.b under c33). The
   through members come from the derived butts' `on` (`b5 -x`, `b31.b`), which cover pattern
   copies; the written connections do not.
2. **A T counts, a bar along the line does not.** D-UX-10 adds an end on another bar's line to
   the check's ends that meet. The line bar must cross the end's bar: the cart's linear rail b33
   lies along the profile b11, so its free end is no corner. A corner of a T is therefore a case
   the check does not warn about when it is open (one unclaimed end on a bar's line); the markers
   show it, and the problem model (S1.6) may choose to list it. An end 20 mm off a bar's line
   (the cart's b31.a, butted into b2 through c32) makes no corner: c32 is one of the outline's
   "Other connections", with the pivots and the face joints.
3. **Failed wins over open.** An end with two providers falls back to the default, unclaimed,
   with an error on the end that names both connections in its `refs`. A corner is failed when an
   error names one of its ends or connections (entity or refs), and the providers an error names
   join the corner's connections. Warnings (the cart's overhanging butts c21, c22) do not fail it.
4. **The key is the point,** `x,y,z` to 0.01 mm with no trailing zeros (`0,0,900`). It stays the
   same while the bars there do not move, as when Flip changes which bar runs through (the design
   points stay put). `through` is the butts' through bar there, when it is a bar (not a bar end).
5. **Measured on the cart:** 36 corners, all joined, every one checked against the fixture's
   coordinates. Grouping and the line test index points and bars in 250 mm cells, so a 1,000-bar
   model is not quadratic.
