"""G31, a hole a connector asks for in the end face it bears on, worked by hand.

This script is the hand calculation of G31's numbers, written independently of AluKit: it imports
nothing from it and works each number from the case's geometry with plain arithmetic. It prints
them and checks them against expected.json beside it.

Run: python3 -I tests/fixtures/golden-gen/G31/by_hand.py (exit 1 on any mismatch).

The rule (design §3.4 `requires`, §4.5 bearing on an end; docs/notes/acceptance-gaps.md, A4): a
butt through a bar's end (`through: "b1.b"`, as G17) whose connector requires a hole `on:
"through"` drills it **into that end face, along the through bar's axis**, at the point where the
butting bar's centre line, moved by the spacer along the face's normal, meets the face. It is an
`end-hole` op on the through bar: its end, its offset from the section's box centre in the
section's x and y, its diameter or thread, and its depth (none: through the piece).

The geometry: the 40 x 40 block b1 runs from (0, 0, 0) to (120, 0, 0), centred; its end b is
square at x = 120, outward normal +X. A horizontal bar's section has local y = +Z and local
x = y × t, so along +X local x is +Y. The brace b2 runs from (1720, 1210, 0) to (120, 10, 0),
2000 long, direction (-0.8, -0.6, 0), centred, its end b cut on the plane (`cut: "angle"`).
"""

import json
import math
import os

A1 = (0.0, 0.0, 0.0)
B1 = (120.0, 0.0, 0.0)
A2 = (1720.0, 1210.0, 0.0)
B2 = (120.0, 10.0, 0.0)
HALF = 20.0  # half the 40 x 40 section
T1 = (1.0, 0.0, 0.0)
X1, Y1 = (0.0, 1.0, 0.0), (0.0, 0.0, 1.0)  # b1's section axes


def dot(u, v):
    return sum(a * b for a, b in zip(u, v))


def r2(x):
    return round(x + 0.0, 2)


def case(spacer):
    L = math.dist(A2, B2)
    t2 = tuple((b - a) / L for a, b in zip(A2, B2))
    # The face b2 bears on: b1's end face, x = 120, its normal reversed for b2's end (-X).
    # A spacer moves b2's plane along the face's outward normal (+X), toward the brace.
    plane_x = B1[0] + spacer
    s = (plane_x - A2[0]) / t2[0]  # along b2's centre line from its end a
    P = tuple(a + s * d for a, d in zip(A2, t2))
    # The angle between the plane's normal and the axis, and the long and short points.
    cos = abs(t2[0])
    tan = math.sqrt(1 - cos * cos) / cos
    angle = math.degrees(math.acos(cos))
    # The joint point moved by the spacer back along b2's end normal (-X) onto b1's end face.
    Q = (P[0] - spacer, P[1], P[2])
    off = (dot(tuple(q - a for q, a in zip(Q, A1)), X1), dot(tuple(q - a for q, a in zip(Q, A1)), Y1))
    return {
        "brace": {"centre": s, "long": s + HALF * tan, "short": s - HALF * tan, "angle": angle},
        "block": {"cut": math.dist(A1, B1)},
        "off": off,
    }


def end_hole_op(off, fields):
    op = {"op": "end-hole", "from": "b"}
    if r2(off[0]) != 0 or r2(off[1]) != 0:
        op["off"] = [r2(off[0]), r2(off[1])]
    op.update(fields)
    op["by"] = "c1"
    return op


def text(off, fields):
    """The cut list's words, for the block turned end for end (its canonical orientation: the
    machining named from end a sorts first). Turning about local y reverses x and keeps y."""
    x, y = r2(0 - off[0]), r2(off[1])
    what = f"tap {fields['thread']}" if "thread" in fields else f"Ø{fields['d']:.2f} hole"
    at = "at the centre" if x == 0 and y == 0 else f"at x {x:.2f}, y {y:.2f} from the centre"
    depth = f"{fields['depth']:.2f} deep" if "depth" in fields else "through"
    return f"{what} in end a along the axis, {at}, {depth}"


results = {}
for name, spacer, fields in [
    ("base", 0.0, {"d": 9}),
    ("spacer_mm 8", 8.0, {"d": 9}),
    ("a tapped hole, 20 deep", 0.0, {"thread": "M8", "depth": 20}),
]:
    r = case(spacer)
    results[name] = (r, end_hole_op(r["off"], fields), text(r["off"], fields))
    b = r["brace"]
    print(
        f"{name}: brace {r2(b['long']):.2f} / {r2(b['centre']):.2f} / {r2(b['short']):.2f} at "
        f"{r2(b['angle']):.2f}°; hole off {r['off']}; {results[name][2]}"
    )

here = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(here, "expected.json"), encoding="utf-8") as f:
    expected = json.load(f)
by_name = {"base": expected["expect"]}
for c in expected.get("cases", []):
    by_name[c["name"]] = c["expect"]

mismatches = []
for name, (r, op, words) in results.items():
    want = by_name.get(name)
    if want is None:
        mismatches.append(f"{name}: no such case in expected.json")
        continue
    if want["errors"] != []:
        mismatches.append(f"{name}: hand expects no errors, expected.json {want['errors']}")
    if want["ops"]["b1"] != [op]:
        mismatches.append(f"{name} b1 ops: hand {[op]}, expected.json {want['ops']['b1']}")
    b = r["brace"]
    lines = [
        {"count": 1, "cut_mm": r2(b["long"])},
        {"count": 1, "cut_mm": r2(r["block"]["cut"]), "machining": [words]},
    ]
    if want["lines"]["test:TS40"] != lines:
        mismatches.append(f"{name} lines: hand {lines}, expected.json {want['lines']['test:TS40']}")

if mismatches:
    print("\nMISMATCH")
    for m in mismatches:
        print("  " + m)
    raise SystemExit(1)
print("\nexpected.json agrees with the hand calculation")
