"""G28, bars bearing on a placeholder's box at a pose, worked by hand.

This script is the hand calculation of G28's numbers, written independently of AluKit: it imports
nothing from it and works each number from the case's geometry with plain arithmetic. It prints
the numbers and checks them against expected.json beside it, so the fixture and the hand
calculation cannot drift apart.

Run: python3 -I tests/fixtures/golden-ends/G28/by_hand.py (exit 1 on any mismatch).

The case (docs/design.md §4.5, "a butt through a body", and §4.7 for a pose):
- the placeholder `motor` has the box [-100, 100] x [0, 120] x [0, 80] in its own frame, measured
  from its origin, or from its mount datum when it has one;
- c1 places that box with its datum at `pos`, turned by `rot_deg` (here only about z: a turn of
  +90° takes the box's +x to the world's +y and its +y to the world's -x);
- three 40 x 40 bars butt through it with their end b: each end stops on the first face of the
  box that its centre line crosses, travelling from end a toward end b. Every end is square, so
  the cut length is the distance from end a to that crossing.
"""

import json
import math
import os

BOX = ((-100.0, 0.0, 0.0), (100.0, 120.0, 80.0))
BARS = {
    "b1": ((0.0, 30.0, 40.0), (600.0, 30.0, 40.0)),
    "b2": ((540.0, 400.0, 40.0), (540.0, 0.0, 40.0)),
    "b3": ((560.0, 30.0, 300.0), (560.0, 30.0, 0.0)),
}
TOL = 0.01  # a crossing this close to an edge of the face is refused (§4.5); none here is


def to_local(p, pos, turn_deg, datum):
    """A world point in the box's frame: undo the move, then the turn about z, then the datum."""
    x, y, z = p[0] - pos[0], p[1] - pos[1], p[2] - pos[2]
    c, s = math.cos(math.radians(turn_deg)), math.sin(math.radians(turn_deg))
    lx, ly = c * x + s * y, -s * x + c * y
    return (lx + datum[0], ly + datum[1], z + datum[2])


def first_face(a, b, pos, turn_deg, datum):
    """The distance from a, along a -> b, at which the centre line enters the box (slab method)."""
    la, lb = to_local(a, pos, turn_deg, datum), to_local(b, pos, turn_deg, datum)
    length = math.dist(a, b)
    d = [(lb[i] - la[i]) / length for i in range(3)]
    enter, leave = -math.inf, math.inf
    for i in range(3):
        if abs(d[i]) < 1e-12:
            assert BOX[0][i] < la[i] < BOX[1][i], "the centre line misses the box"
            continue
        t1, t2 = (BOX[0][i] - la[i]) / d[i], (BOX[1][i] - la[i]) / d[i]
        enter, leave = max(enter, min(t1, t2)), min(leave, max(t1, t2))
    assert enter < leave, "the centre line misses the box"
    hit = [la[i] + enter * d[i] for i in range(3)]
    # Not on an edge: on the two axes the face spans, the crossing is inside by more than TOL.
    inside = [min(hit[i] - BOX[0][i], BOX[1][i] - hit[i]) for i in range(3)]
    assert sorted(inside)[1] > TOL, ("too near an edge", hit)
    return enter


def lengths(pos, turn_deg, datum=(0.0, 0.0, 0.0)):
    return {bar: first_face(a, b, pos, turn_deg, datum) for bar, (a, b) in BARS.items()}


cases = {
    # Turned 90°: the box spans x 480..600, y -100..100 in the world.
    "base": lengths((600.0, 0.0, 0.0), 90.0),
    # Unturned: x 500..700, y 0..120.
    "at a point, unturned": lengths((600.0, 0.0, 0.0), 0.0),
    # The datum (0, 40, 0) sits at pos: the turned box spans x 520..640.
    "mount datum at (0,40,0)": lengths((600.0, 0.0, 0.0), 90.0, (0.0, 40.0, 0.0)),
    # 20 lower: the top face at z = 60.
    "moved to (600,0,-20)": lengths((600.0, 0.0, -20.0), 90.0),
    # No box: the butt places nothing, and each end stays at its design point.
    "a project item with no box": {bar: math.dist(a, b) for bar, (a, b) in BARS.items()},
}
# Each butting end moved from its design point by its bar's length less the cut.
moves = {bar: cases["base"][bar] - math.dist(a, b) for bar, (a, b) in BARS.items()}


def r2(x):
    return round(x + 0.0, 2)


for name, bars in cases.items():
    print(name + ": " + ", ".join(f"{bar} {r2(v):.2f}" for bar, v in bars.items()))
print("base moves: " + ", ".join(f"{bar}.b {r2(v):.2f}" for bar, v in moves.items()))

here = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(here, "expected.json"), encoding="utf-8") as f:
    expected = json.load(f)

by_name = {"base": expected["expect"]}
for c in expected.get("cases", []):
    by_name[c["name"]] = c["expect"]

mismatches = []
for name, bars in cases.items():
    want = by_name.get(name)
    if want is None:
        mismatches.append(f"{name}: no such case in expected.json")
        continue
    for bar, v in bars.items():
        w = want["bars"].get(bar, {}).get("cut_mm")
        if w is None or abs(r2(v) - w) > 0.005:
            mismatches.append(f"{name} {bar} cut_mm: hand {r2(v)}, expected.json {w}")
for bar, v in moves.items():
    w = expected["expect"]["bars"][bar]["ends"]["b"]["move_mm"]
    if abs(r2(v) - w) > 0.005:
        mismatches.append(f"base {bar}.b move_mm: hand {r2(v)}, expected.json {w}")

if mismatches:
    print("\nMISMATCH")
    for m in mismatches:
        print("  " + m)
    raise SystemExit(1)
print("\nexpected.json agrees with the hand calculation")
