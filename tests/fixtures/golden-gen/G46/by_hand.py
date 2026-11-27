"""G46, an access hole at its connector's core, worked by hand.

This script is the hand calculation of G46's holes and verdicts, written independently of AluKit:
it imports nothing from it and works each from the case's geometry and item data with plain
arithmetic. It prints them and checks them against expected.json beside it.

Run: python3 -I tests/fixtures/golden-gen/G46/by_hand.py (exit 1 on any mismatch).

The rule (docs/notes/x7-x8-f7.md, X7): a hole a connector requires in the butting bar's side stands
`from_end_mm` in from the butting end. With positions (`at_mm`, `at_holes`, or the hole of a
recipe's mount that holds the connector) it is drilled over each position, square to the face of
the butting bar's box nearest it (ties to the first of +y, -y, +x, -x), its offset across that face
the position's coordinate along the face (x on a y face, y on an x face); a blind hole must reach
the position, and a position must lie on the end. With none it stays on +y at the centre line.

The geometry: an 80x80 sill b1 along +X, its top at z = 40; an 80x80 post b2 standing on it from
(300, 0, 40), its section x along world X and y along world Y (a vertical bar's frame), its cores
at (±20, ±20). The quick connector's cross hole: Ø18 x 28, its centre 25 from the end. A 40x40 post
(box ±20) has its core at the centre; a 40x80 (x ±20, y ±40) has two, at (0, ±20).
"""

import json
import os

TOL = 0.01
D, DEPTH, FROM_END = 18.0, 28.0, 25.0


def nearest(hx, hy, p):
    """The face of a box (half sizes hx, hy) nearest a position p, and its distance."""
    sides = [("+y", hy - p[1]), ("-y", hy + p[1]), ("+x", hx - p[0]), ("-x", hx + p[0])]
    best = sides[0]
    for s in sides[1:]:
        if s[1] < best[1] - TOL:
            best = s
    return best


def side_holes(hx, hy, positions, depth=DEPTH, d=D):
    """The ops and the errors of one requirement's holes at its positions."""
    ops, errors = [], []
    for p in positions:
        if abs(p[0]) > hx - TOL or abs(p[1]) > hy - TOL:
            errors.append({"code": "connection", "entity": "c1", "refs": ["b2"]})
            continue
        face, dist = nearest(hx, hy, p)
        print(f"   position {p}: face {face}, {dist:.2f} in; a {depth:.0f} deep hole reaches "
              f"{depth - dist:+.2f} past it")
        if depth < dist - TOL:
            errors.append({"code": "connection", "entity": "c1", "refs": ["b2"]})
            continue
        across = p[0] if face[1] == "y" else p[1]
        op = {"op": "hole", "face": face, "from": "a", "at": FROM_END}
        if abs(across) > TOL / 100:
            op["across"] = across
        op.update({"d": d, "depth": depth, "by": "c1"})
        ops.append(op)
    # one error for the positions of one requirement off the end, as for end taps
    return ops, errors[:1] if errors else []


def words(op):
    across = f", {op['across']:.2f} across" if "across" in op else ""
    return f"Ø{op['d']:.2f} hole {op['at']:.2f} mm from end a on face {op['face']}{across}, {op['depth']:.2f} deep"


DIAG = [(-20, -20), (20, 20)]
CASES = {}
print("base: the recipe's own requirement, at_mm (-20, -20) and (20, 20), on the 80x80 post")
CASES["base"] = side_holes(40, 40, DIAG) + ({},)
print("a quick connector in each of the recipe's two holes: the connector's own unplaced hole, moved to each hole")
CASES["a quick connector in each of the recipe's two holes"] = side_holes(40, 40, DIAG) + ({"test-qc:QC40": 2},)
print("as sold, in a 40x40's core: the connector's unplaced hole stays on +y at the centre line")
CASES["as sold, in a 40x40's core"] = (
    [{"op": "hole", "face": "+y", "from": "a", "at": FROM_END, "d": D, "depth": DEPTH, "by": "c1"}], [],
    {"test-qc:QC40": 1})
print("a 40x80's two cores")
CASES["a 40x80's two cores"] = side_holes(20, 40, [(0, -20), (0, 20)]) + ({"test-qc:QC40": 2},)
print("a hole 15 deep")
CASES["too shallow to reach the core"] = side_holes(40, 40, [(20, 20)], depth=15) + ({},)
print("a position off the end")
CASES["a position off the end"] = side_holes(40, 40, [(50, 0)]) + ({},)
CASES["a mount off the joint's plane"] = ([], [{"code": "connection", "entity": "c1"}], {})

base_ops = CASES["base"][0]
print("cut list:", "; ".join(words(o) for o in sorted(base_ops, key=lambda o: o["face"])))

here = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(here, "expected.json"), encoding="utf-8") as f:
    expected = json.load(f)
by_name = {"base": expected["expect"]}
for c in expected.get("cases", []):
    by_name[c["name"]] = c["expect"]

mismatches = []
for name, (ops, errors, hardware) in CASES.items():
    want = by_name.get(name)
    if want is None:
        mismatches.append(f"{name}: no such case in expected.json")
        continue
    if want["ops"]["b2"] != ops:
        mismatches.append(f"{name} ops: hand {ops}, expected.json {want['ops']['b2']}")
    if want["errors"] != errors:
        mismatches.append(f"{name} errors: hand {errors}, expected.json {want['errors']}")
    if want.get("hardware", {}) != hardware:
        mismatches.append(f"{name} hardware: hand {hardware}, expected.json {want.get('hardware', {})}")
lines = expected["expect"]["lines"]["test-qc:Q80"][0]["machining"]
if lines != [words(o) for o in sorted(base_ops, key=lambda o: o["face"])]:
    mismatches.append(f"base cut list: expected.json {lines}")

if mismatches:
    print("\nMISMATCH")
    for m in mismatches:
        print("  " + m)
    raise SystemExit(1)
print("\nexpected.json agrees with the hand calculation")
