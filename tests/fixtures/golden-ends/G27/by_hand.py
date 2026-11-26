"""G27, a strut bearing on a shoe mitred square to it, worked by hand.

This script is the hand calculation of G27's numbers (docs/design.md §4.6), written independently
of AluKit: it imports nothing from it and works each number from the case's geometry with plain
arithmetic. It prints the numbers and checks them against expected.json beside it, so the
fixture and the hand calculation cannot drift apart.

Run: python3 -I tests/fixtures/golden-ends/G27/by_hand.py (exit 1 on any mismatch).

The case lies in the world XZ plane (y = 0) and every section is a 40 x 40 box on its centre line:
- beam b1 (0,0,0)->(1000,0,0): its top face is z = 20;
- shoe b2, vertical, from the beam's top face at x = 540 up to n1 = (540,0,80). End a butts
  through the beam (on z = 20). End b is cut on the plane through n1 square to the strut's axis;
- strut b3 (0,0,800)->(600,0,0), a 3-4-5 line through n1. End b butts through the shoe's end b
  (design §4.5: on that end face, its normal reversed, moved by spacer_mm along the face's normal).

Rules used, from docs/design.md §4.5: a cut length is the long point (the longest of the box's
four edges between the two end planes), the centre line runs through the box's centre, and the
angle is between an end plane's normal and the bar's axis.
"""

import json
import math
import os

HALF = 20.0  # half of a 40 x 40 section
BEAM_TOP = 20.0
SHOE_X = 540.0


def unit(v):
    n = math.hypot(*v)
    return (v[0] / n, v[1] / n)


def shoe(n1_z, strut_a, strut_b):
    """The shoe's lengths: its end b on the plane through (SHOE_X, n1_z) square to the strut.

    In XZ the plane is the line through n1 with normal t, the strut's direction. The shoe's two
    edges in the XZ plane stand at x = SHOE_X -/+ 20; its other two edges (y = +/-20) lie on its
    centre line's x, so they equal the centre line. Each edge meets the plane at
    z = n1_z - (t_x / t_z) * (x - SHOE_X), and the shoe starts on the beam's top face.
    """
    tx, tz = unit((strut_b[0] - strut_a[0], strut_b[1] - strut_a[1]))
    slope = -tx / tz
    tops = [n1_z + slope * (x - SHOE_X) for x in (SHOE_X - HALF, SHOE_X + HALF)]
    lengths = [z - BEAM_TOP for z in tops]
    # The shoe's axis is +z; the plane's normal is +/-t, so the angle is acos|t_z|.
    angle = math.degrees(math.acos(abs(tz)))
    return {"cut_mm": max(lengths), "centre_mm": n1_z - BEAM_TOP, "short_mm": min(lengths), "angle_deg": angle}


def strut(n1_z, strut_a, strut_b, spacer=0.0, normal_from=None):
    """The strut's lengths: end b stops on the shoe's end face (moved by the spacer); end a is
    square at its design point.

    The face's normal is the strut's own direction (square to the strut), unless `normal_from`
    gives the direction it was typed from. Along the strut, a point is A + s*t; the plane is
    (P - n1) . n = 0, so s = (n1 - A) . n / (t . n). The spacer moves the plane toward the strut
    by `spacer` along n.
    """
    ax, az = strut_a
    t = unit((strut_b[0] - ax, strut_b[1] - az))
    n = unit(normal_from) if normal_from else t
    length = math.hypot(strut_b[0] - ax, strut_b[1] - az)
    dn = t[0] * n[0] + t[1] * n[1]
    angle = math.degrees(math.acos(min(1.0, abs(dn))))
    s = ((SHOE_X - ax) * n[0] + (n1_z - az) * n[1]) / dn
    s -= spacer / abs(dn)  # n is the face's normal: here along the strut's axis, so dn = 1
    hit_x = ax + s * t[0]
    return {
        "length": length,
        "s": s,
        "angle_deg": angle,
        "inside_shoe": SHOE_X - HALF < hit_x < SHOE_X + HALF,
        "hit": (round(hit_x, 4), round(az + s * t[1], 4)),
    }


cases = {}

# The base case: n1 at z = 80, the strut (0,0,800)->(600,0,0).
A, B = (0.0, 800.0), (600.0, 0.0)
sh = shoe(80.0, A, B)
st = strut(80.0, A, B)
assert st["inside_shoe"] and abs(st["angle_deg"]) < 1e-9, st
cases["base"] = {
    "b2": sh,
    "b3": {"cut_mm": st["s"], "centre_mm": st["s"], "move_b": st["s"] - st["length"]},
}

# An 8 mm end plate between them: the plane moves 8 toward the strut, along the face's normal.
st8 = strut(80.0, A, B, spacer=8.0)
cases["spacer_mm 8"] = {"b3": {"cut_mm": st8["s"]}}

# A taller shoe: n1 at z = 100. The strut, unchanged, now meets the face off its centre line.
sh100 = shoe(100.0, A, B)
st100 = strut(100.0, A, B)
assert st100["inside_shoe"], st100
cases["n1 at z = 100"] = {"b2": sh100, "b3": {"cut_mm": st100["s"]}}

# The strut redrawn at 4:3 through n1: (140,0,380)->(620,0,20). The shoe's plane follows it.
A2, B2 = (140.0, 380.0), (620.0, 20.0)
sh2 = shoe(80.0, A2, B2)
st2 = strut(80.0, A2, B2)
assert st2["inside_shoe"] and abs(st2["angle_deg"]) < 1e-9, st2
cases["strut redrawn"] = {"b2": sh2, "b3": {"cut_mm": st2["s"], "move_b": st2["s"] - st2["length"]}}

# The same redraw with the normal typed as the old strut's direction (3, 0, -4): the strut meets
# the stale plane at n1 but 16.26° off square, with no cut declared, so it stays at its design
# point (an angled-end error) and keeps its full length.
st2v = strut(80.0, A2, B2, normal_from=(3.0, -4.0))
assert st2v["inside_shoe"], st2v
cases["strut redrawn, normal typed"] = {"b3": {"angle_deg": st2v["angle_deg"], "cut_mm": st2v["length"]}}


def r2(x):
    return round(x + 0.0, 2)


for name, bars in cases.items():
    print(name)
    for bar, vals in bars.items():
        print("  " + bar + ": " + ", ".join(f"{k} {r2(v):.2f}" for k, v in vals.items()))

# Check against expected.json.
here = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(here, "expected.json"), encoding="utf-8") as f:
    expected = json.load(f)

by_name = {"base": expected["expect"]}
for c in expected.get("cases", []):
    by_name[c["name"]] = c["expect"]

mismatches = []


def check(case, bar, field, got, want):
    if want is not None and abs(r2(got) - want) > 0.005:
        mismatches.append(f"{case} {bar} {field}: hand {r2(got)}, expected.json {want}")


for name, bars in cases.items():
    want = by_name.get(name)
    if want is None:
        mismatches.append(f"{name}: no such case in expected.json")
        continue
    for bar, vals in bars.items():
        wb = want["bars"].get(bar, {})
        for field in ("cut_mm", "centre_mm", "short_mm"):
            if field in vals:
                check(name, bar, field, vals[field], wb.get(field))
        if "angle_deg" in vals:
            end = "b"
            check(name, bar, "angle_deg", vals["angle_deg"], wb.get("ends", {}).get(end, {}).get("angle_deg"))
        if "move_b" in vals:
            check(name, bar, "move_mm", vals["move_b"], wb.get("ends", {}).get("b", {}).get("move_mm"))

if mismatches:
    print("\nMISMATCH")
    for m in mismatches:
        print("  " + m)
    raise SystemExit(1)
print("\nexpected.json agrees with the hand calculation")
