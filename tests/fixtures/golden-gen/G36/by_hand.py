"""G36, a butt's end face on the face it bears on, worked by hand.

This script is the hand calculation of G36's numbers, written independently of AluKit: it imports
nothing from it and works each number from the case's geometry with plain arithmetic. It prints
them and checks them against expected.json beside it.

Run: python3 -I tests/fixtures/golden-gen/G36/by_hand.py (exit 1 on any mismatch).

The rule (design §4.5, a butt's end face on its face; docs/notes/f2-joint-geometry.md, part 2):

- The **overhang** is the part of the butting end face that does not lie on the face it bears on,
  both seen along that face's normal: the end face is the butting section's outline (its grooves
  closed) on the end's plane; the face is the through bar's side, whole across (§4.5: the faces of a
  layer), between its two end faces. Reported as the end face's area, the area outside the face,
  and the greatest distance an end-face vertex lies outside it. Past a threshold (the connector's
  `overhang_mm`, else the project's `defaults.butt.overhang_mm`, else 0), plus 0.01, a
  `connection` warning on the connection.
- The **overlap** is how far the butting bar's body (its box, between its end faces) goes into
  the through bar's (its box, between its end faces) beyond the face's plane. Past 0.01, a
  `connection` error on the connection.

The geometry: the 40 x 40 b1 from (0, 0, 0) to (600, 0, 0), centred; its top face (+y, local y is
+Z) is the plane z = 20, between x = 0 and 600 (its ends square at its design points) and
y = -20 .. 20. The 40 x 40 post b2 rises from b1's centre line, its end a on that face. The test
catalog's 40 x 40 is a box less its slots, so with its grooves closed its outline is its box.
"""

import json
import math
import os

HALF = 20.0
TOL = 0.01


def r2(x):
    """To 0.01, with no negative zero."""
    return round(x, 2) + 0.0


def rect_overlap(a, b):
    """Two axis-aligned rectangles (x0, x1, y0, y1): the area they share."""
    w = min(a[1], b[1]) - max(a[0], b[0])
    h = min(a[3], b[3]) - max(a[2], b[2])
    return max(w, 0.0) * max(h, 0.0)


def outside(p, r):
    """A point's distance from a rectangle, 0 inside."""
    dx = max(r[0] - p[0], 0.0, p[0] - r[1])
    dy = max(r[2] - p[1], 0.0, p[1] - r[3])
    return math.hypot(dx, dy)


def seat(end_face, face):
    """The end face's area, the greatest distance of a corner past the face, and its area outside."""
    area = (end_face[1] - end_face[0]) * (end_face[3] - end_face[2])
    corners = [(x, y) for x in end_face[:2] for y in end_face[2:]]
    over = max(outside(c, face) for c in corners)
    return area, over, area - rect_overlap(end_face, face)


def post(x, y, b1_end=600.0):
    """A square post centred at (x, y): its end face is its 40 x 40 box on z = 20."""
    return (x - HALF, x + HALF, y - HALF, y + HALF), (0.0, b1_end, -HALF, HALF)


def brace(extend):
    """The brace from (300, 0, 0) toward (800, 0, 500), at 45°, its end a cut on z = 20, then
    moved `extend` along its axis outward (toward a). Its section's local x is +Y and its local y
    (-1, 0, 1)/√2, so a section point (lx, ly) on its end plane z = 20 - extend/√2 lies at
    x = 300 + (20 - extend/√2) - √2 ly. Its end face, seen along +Z, spans x 320 ∓ 20√2 (shifted
    by -extend/√2) and y ±20; the body above it, b1's below z = 20: they overlap by extend/√2."""
    s2 = math.sqrt(2.0)
    shift = extend / s2
    x0 = 300.0 + 20.0 - shift - s2 * HALF
    x1 = 300.0 + 20.0 - shift + s2 * HALF
    return (x0, x1, -HALF, HALF), (0.0, 600.0, -HALF, HALF), shift


CASES = []
for name, ef_face, limit in [
    ("base", post(300, 0), 0.0),
    ("10 across", post(300, 10), 0.0),
    ("at b1's end, not covering it", post(600, 0, 600.0), 0.0),
    ("the project allows 10", post(300, 10), 10.0),
    ("a connector that allows 5", post(300, 10), 5.0),
]:
    CASES.append((name, ef_face, limit, 0.0))
for name, extend in [("a 45° brace", 0.0), ("the brace pushed 2 in", 2.0)]:
    ef, face, depth = brace(extend)
    CASES.append((name, (ef, face), 0.0, depth))

here = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(here, "expected.json"), encoding="utf-8") as f:
    expected = json.load(f)
by_name = {"base": expected["expect"]}
for c in expected.get("cases", []):
    by_name[c["name"]] = c["expect"]

mismatches = []
for name, (end_face, face), limit, depth in CASES:
    area, over, out = seat(end_face, face)
    print(
        f"{name}: end face {area:.2f} mm², {out:.2f} outside, overhang {over:.2f}; overlap {depth:.4f}"
    )
    want = by_name.get(name)
    if want is None:
        mismatches.append(f"{name}: no such case in expected.json")
        continue
    got = [
        {
            "end": "b2.a",
            "on": "b1 +y",
            "area_mm2": r2(area),
            "overhang_mm": r2(over),
            "overhang_mm2": r2(out),
            "overlap_mm": r2(depth),
        }
    ]
    if want["butts"]["c1"] != got:
        mismatches.append(f"{name} butts: hand {got}, expected.json {want['butts']['c1']}")
    warnings = (
        [{"code": "connection", "entity": "c1", "refs": ["b2", "b1"]}] if over > limit + TOL else []
    )
    if want["warnings"] != warnings:
        mismatches.append(f"{name} warnings: hand {warnings}, expected.json {want['warnings']}")
    errors = [{"code": "connection", "entity": "c1", "refs": ["b2", "b1"]}] if depth > TOL else []
    if want["errors"] != errors:
        mismatches.append(f"{name} errors: hand {errors}, expected.json {want['errors']}")

if mismatches:
    print("\nMISMATCH")
    for m in mismatches:
        print("  " + m)
    raise SystemExit(1)
print("\nexpected.json agrees with the hand calculation")
