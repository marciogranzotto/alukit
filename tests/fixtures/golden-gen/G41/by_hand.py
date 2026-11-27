"""G41, a butt's stack of plates, worked by hand.

This script is the hand calculation of G41's end planes, holes, seats and verdicts, written
independently of AluKit: it imports nothing from it and works each from the case's geometry. It
prints them and checks them against expected.json beside it.

Run: python3 -I tests/fixtures/golden-gen/G41/by_hand.py (exit 1 on any mismatch).

The rule (design §4.5, butt `stack`; docs/notes/x1-x3-f2ab.md, X2): the bars of a butt's stack
lie between the face the butt bears on and the butting end, each flat on the one before (its faces
square to the face's normal, its near face on it within tol.len), the first on the face. The end
bears on the last one's far face, so its plane is the face lifted by the stack's depth; no spacer
may be given with a stack. Each stack bar is drilled through, with the through bar's hole's
diameter, where that hole's axis crosses it; and it is held only by the screw that passes it: a
through-hole in the through bar at a place where the connector taps the butting end, passed by a
headed screw of its set, the bar not hollow (X3's rule).

The geometry: b1, a 40x40 rail along +X from x = 0 to 600, its top face at z = 20; b3, an
80 x 8 plate along +X from x = 260 to 340, 8 thick in z, centred at z = 24 (so 20 to 28); b2, a
40x40 post along +Z from (300, 0, 28) to (300, 0, 600). J1 taps M16 in b2's end and drills Ø9
through b1 where b2's centre line meets it; its set is a bush and an M8 socket screw.
"""

import json
import os

TOL_LEN = 0.05  # tol.len, mm (design §2)
RAIL_TOP = 20.0  # b1's +y face, z
PLATE_T = 8.0  # the plate's thickness
POST_X = 300.0  # b2's centre line
POST_TOP = 600.0
J1_HOLE = 9.0


def plate_ok(z0, below):
    """A plate lies on what is below it when its near face is within tol.len of it."""
    return abs(z0 - below) <= TOL_LEN


def on_plate(a_x, b_x, x):
    """The post's centre line lands on a plate's face between its cut ends, clear by tol.len."""
    return a_x + TOL_LEN <= x <= b_x - TOL_LEN


results = {}

# Base: one plate, z 20 to 28. The end plane is the rail's face lifted by 8.
end_z = RAIL_TOP + PLATE_T
results["base"] = {
    "ops": {
        "b1": [{"op": "hole", "face": "+y", "from": "a", "at": POST_X, "d": J1_HOLE, "by": "c1"}],
        "b2": [{"op": "end-tap", "from": "a", "thread": "M16", "by": "c1"}],
        # 300 - 260 = 40 along the plate from its a.
        "b3": [{"op": "hole", "face": "+y", "from": "a", "at": POST_X - 260.0, "d": J1_HOLE, "by": "c1"}],
    },
    "bars": {"b2": {"cut_mm": POST_TOP - end_z}},
    "seat": "b3 +y",
    "errors": [],
}

# Two plates: b4 (270 to 330) on b3, z 28 to 36.
end2 = RAIL_TOP + 2 * PLATE_T
assert plate_ok(RAIL_TOP + PLATE_T, RAIL_TOP + PLATE_T)
results["two plates"] = {
    "ops": {
        "b1": [{"op": "hole", "face": "+y", "from": "a", "at": POST_X, "d": J1_HOLE, "by": "c1"}],
        "b3": [{"op": "hole", "face": "+y", "from": "a", "at": POST_X - 260.0, "d": J1_HOLE, "by": "c1"}],
        "b4": [{"op": "hole", "face": "+y", "from": "a", "at": POST_X - 270.0, "d": J1_HOLE, "by": "c1"}],
    },
    "bars": {"b2": {"cut_mm": POST_TOP - end2}},
    "seat": "b4 +y",
    "errors": [],
}

# Through the rail's end b (x = 600): the plate stands on it, 600 to 608, from z = -40 to 40; the
# post runs from x = 608 to 1200 on the rail's axis, so the hole runs along it and crosses the
# plate 40 along it from its a at z = -40 (the rail's axis is at z = 0).
results["through the rail's end"] = {
    "ops": {
        "b1": [{"op": "end-hole", "from": "b", "d": J1_HOLE, "by": "c1"}],
        "b2": [{"op": "end-tap", "from": "a", "thread": "M16", "by": "c1"}],
        "b3": [{"op": "hole", "face": "+y", "from": "a", "at": 0.0 - (-40.0), "d": J1_HOLE, "by": "c1"}],
    },
    "bars": {"b2": {"cut_mm": 1200.0 - (600.0 + PLATE_T)}},
    "errors": [],
}

# The failures, each named on c1; the plate gets no hole where the stack does not stand.
CONN_B3 = [{"code": "connection", "entity": "c1", "refs": ["b3"]}]
FIT_B3 = [{"code": "fit", "entity": "c1", "refs": ["b3"]}]
# A spacer as well: the stack is the spacer, so the two are refused together (no bar named).
results["a spacer as well"] = {"ops": {"b3": []}, "errors": [{"code": "connection", "entity": "c1", "refs": []}]}
# 2 mm off the rail: its near face at z 22, 2.00 > tol.len off the face.
assert not plate_ok(26.0 - PLATE_T / 2, RAIL_TOP)
results["a plate 2 mm off the rail"] = {"ops": {"b3": []}, "errors": CONN_B3}
# From 400 to 480: x = 300 is off it, so its hole has no place.
assert not on_plate(400.0, 480.0, POST_X)
results["a plate the post misses"] = {"ops": {"b3": []}, "errors": CONN_B3}
# A 60 x 3 tube lies on the rail (z 20 to 80): hollow, so the screw would crush it.
results["a tube for the plate"] = {"errors": FIT_B3}
# J1-HOLE drills b1 but taps nothing in b2's end: no screw into the butting end passes the plate.
results["a hole at no tap"] = {
    "ops": {"b3": [{"op": "hole", "face": "+y", "from": "a", "at": POST_X - 260.0, "d": J1_HOLE, "by": "c1"}]},
    "errors": FIT_B3,
}

here = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(here, "expected.json"), encoding="utf-8") as f:
    expected = json.load(f)
by_name = {"base": expected["expect"]}
for c in expected.get("cases", []):
    by_name[c["name"]] = c["expect"]

mismatches = []
for name, hand in results.items():
    want = by_name.get(name)
    if want is None:
        mismatches.append(f"{name}: no such case in expected.json")
        continue
    print(f"{name}: {hand.get('bars', {})} {hand['errors'] or 'no error'}")
    if want["errors"] != hand["errors"]:
        mismatches.append(f"{name} errors: hand {hand['errors']}, expected.json {want['errors']}")
    for bar, ops in hand.get("ops", {}).items():
        if want.get("ops", {}).get(bar) != ops:
            mismatches.append(f"{name} {bar} ops: hand {ops}, expected.json {want.get('ops', {}).get(bar)}")
    for bar, lengths in hand.get("bars", {}).items():
        if want.get("bars", {}).get(bar) != lengths:
            mismatches.append(f"{name} {bar}: hand {lengths}, expected.json {want.get('bars', {}).get(bar)}")
    if "seat" in hand:
        on = want.get("butts", {}).get("c1", [{}])[0].get("on")
        if on != hand["seat"]:
            mismatches.append(f"{name} seat: hand {hand['seat']}, expected.json {on}")

if mismatches:
    print("\nMISMATCH")
    for m in mismatches:
        print("  " + m)
    raise SystemExit(1)
print("\nexpected.json agrees with the hand calculation")
