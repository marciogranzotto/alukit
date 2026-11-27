"""G48, a butt screw's head on the far face of the hole F2 makes, worked by hand.

This script is the hand calculation of G48's seats and verdicts, written independently of AluKit:
it imports nothing from it and works each from the case's geometry and item data with plain
arithmetic. It prints them and checks them against expected.json beside it.

Run: python3 -I tests/fixtures/golden-gen/G48/by_hand.py (exit 1 on any mismatch).

The rule (docs/notes/x7-x8-f7.md, F7): a screw through the through bar into a tap in the butting end
(its connector requires a through-hole at the tap's place) bears its head on the bar's far face,
round the hole F2 made, where that hole's axis leaves the bar: F2 drills a side hole square to its
face. Where F2 makes no hole, because the screw meets the side off square, no head is seated: F2's
error is the connection's, and the screw has nowhere to pass.

The geometry: a plain 80 x 80 block b1 along +X, its section centred on the axis (y and z within
±40), no grooves; a 40x40 post b2 on its top at x = 100; QJ1, an M8 x 110 socket screw (dk 13)
through a Ø9 hole up into a bush in the post's core. The 40x40 rail (Q40) has a groove on each face,
opening 8.18.
"""

import json
import math
import os

HOLE, DK, OPENING = 9.0, 13.0, 8.18
HALF = 40.0  # the block's half size
FIT_W = [{"code": "fit", "entity": "c1", "refs": ["b1"]}]


def band(rho, h):
    """The area of a disc of radius rho within |x| <= h of its centre."""
    if h >= rho:
        return math.pi * rho * rho
    return 2 * (h * math.sqrt(rho * rho - h * h) + rho * rho * math.asin(h / rho))


def r2(x):
    return round(x, 2) + 0.0


def head(on, f):
    return {"end": "b2.a", "side": "head", "item": "test-qc:QSCR-M8x110", "on": on, "d_in_mm": HOLE,
            "d_out_mm": DK, "bearing_pct": r2(100 * f)}


def plain_far_face(point):
    """The share of the Ø9-Ø13 annulus on a whole 80 x 80 face, centred at `point` (u, v) on it."""
    u, v = point
    R = DK / 2
    assert abs(u) + R <= HALF and abs(v) + R <= HALF  # the annulus lies on the face
    return 1.0


# The post on the block's top: the hole along -z from (100, 0, 40) leaves the bottom at (100, 0, -40),
# the face's centre.
base = ([head("b1 -y", plain_far_face((0, 0)))], [], [])
# A brace along +y onto the block's +y side at (100, 40, 0): the hole along -y leaves the -y side at
# its centre.
square = ([head("b1 -x", plain_far_face((0, 0)))], [], [])
# A brace rising 30° onto the same side: the screw's line from (100, 40, 0) runs along -(0, cos 30,
# sin 30), and F2 refuses a side hole off square. Had it a hole, the line would leave the block by its
# bottom (z = -40) at y = 40 - 40 / tan 30°, before the far side (y = -40).
t = math.radians(30)
y_out = 40 - HALF / math.tan(t)
print(f"the 30° screw's line leaves the block's bottom at y {y_out:.2f}, short of the far side at -40")
tilted = ([], [{"code": "connection", "entity": "c1", "refs": ["b1"]}], [])
# Through a 40x40 rail instead of the block: the head on its bottom face, centred on its groove.
R, r = DK / 2, HOLE / 2
f = 1 - (band(R, OPENING / 2) - band(r, OPENING / 2)) / (math.pi * (R * R - r * r))
rail = ([head("b1 -y", f)], [], FIT_W if f < 0.5 else [])
print(f"through the rail: {100 * f:.2f} % of the annulus on its bottom face's lips")

CASES = {
    "base": base,
    "a brace square to the block's side": square,
    "a brace 30° off the block's side": tilted,
    "through a 40x40 rail": rail,
}

here = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(here, "expected.json"), encoding="utf-8") as fh:
    expected = json.load(fh)
by_name = {"base": expected["expect"]}
for c in expected.get("cases", []):
    by_name[c["name"]] = c["expect"]

mismatches = []
for name, (heads, errors, warnings) in CASES.items():
    want = by_name.get(name)
    print(f"{name}: {[h['bearing_pct'] for h in heads]} {'error' if errors else ''}{'warning' if warnings else ''}")
    if want is None:
        mismatches.append(f"{name}: no such case in expected.json")
        continue
    if want["heads"]["c1"] != heads:
        mismatches.append(f"{name} heads: hand {heads}, expected.json {want['heads']['c1']}")
    if want["errors"] != errors:
        mismatches.append(f"{name} errors: hand {errors}, expected.json {want['errors']}")
    if "warnings" in want and want["warnings"] != warnings:
        mismatches.append(f"{name} warnings: hand {warnings}, expected.json {want['warnings']}")

if mismatches:
    print("\nMISMATCH")
    for m in mismatches:
        print("  " + m)
    raise SystemExit(1)
print("\nexpected.json agrees with the hand calculation")
