"""G40, a plain block held by a screw in a drilled hole, worked by hand.

This script is the hand calculation of G40's verdicts and holes, written independently of AluKit:
it imports nothing from it and works each from the case's geometry and connector data. It prints
them and checks them against expected.json beside it.

Run: python3 -I tests/fixtures/golden-gen/G40/by_hand.py (exit 1 on any mismatch).

The rule (design §3.4, fit by role; docs/notes/x1-x3-f2ab.md, X3): a butt's through bar of no
system the connector fits is held by a screw through it, a fourth way beside its system, a sleeve
in its bore and `held_by`, when (1) the connector requires a through-hole in it with a diameter
and no depth, so the screw's head bears on its far side, (2) at a place where the connector taps
the butting end, so the hole is the clearance for a screw into that tap, (3) a fastener set of the
connector holds a screw or bolt whose thread's nominal diameter is less than the hole's, and (4)
the bar is not hollow: a screw through both walls of an RHS crushes them, which a sleeve prevents.
Anything else leaves the block held no way: a `fit` error on the butt naming it.

The geometry: b1, an 80 x 80 block along +X from x = 0 to 200; b2, a 40x40 post with its core
tapped M16, standing on b1's top face (z = 40) at x = 100. J1 taps M16 in b2's end (for a reducing
bush, M16 outside, M8 inside) and drills Ø9 through b1 where b2's centre line meets it, 100 along
b1; its fastener set is the bush and an M8 socket screw. Through the block's end, b2 lies along
the block's axis and bears on its end b: the hole is an end hole along the axis, through.
"""

import json
import os

M8 = 8.0  # the screw's nominal diameter


def holds(conn):
    """J1's verdict on the block, from the connector's data and the block's shape."""
    if conn["hollow"]:
        return False  # (4): a screw through both walls needs a sleeve in the bore
    if conn["depth"] is not None:
        return False  # (1): a blind hole leaves the head no far side to bear on
    if not conn["tap_at_hole"]:
        return False  # (2): no screw into the butting end passes it
    if not any(d < conn["hole"] for d in conn["headed"]):
        return False  # (3): no screw or bolt whose shank passes the hole
    return True


J1 = {"hollow": False, "depth": None, "tap_at_hole": True, "hole": 9.0, "headed": [M8]}
CASES = {
    "base": J1,
    "through the block's end": J1,
    "a blind hole": {**J1, "depth": 20.0},
    "no tap at the hole": {**J1, "tap_at_hole": False},
    "a hole too small for the screw": {**J1, "hole": 6.0},
    "a stud for the screw": {**J1, "headed": []},  # a stud is no screw or bolt
    "an RHS for the block": {**J1, "hollow": True},
}
FIT = [{"code": "fit", "entity": "c1", "refs": ["b1"]}]

# The holes, where the base and the end case give them.
OPS = {
    "base": {
        # b2's centre line (x = 100) meets b1's top face 100 along it from x = 0: a Ø9 through.
        "b1": [{"op": "hole", "face": "+y", "from": "a", "at": 100.0, "d": 9.0, "by": "c1"}],
        "b2": [{"op": "end-tap", "from": "a", "thread": "M16", "by": "c1"}],
    },
    "through the block's end": {
        # b2 on the block's axis: the hole enters end b at its centre and runs along the axis.
        "b1": [{"op": "end-hole", "from": "b", "d": 9.0, "by": "c1"}],
        "b2": [{"op": "end-tap", "from": "b", "thread": "M16", "by": "c1"}],
    },
}

here = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(here, "expected.json"), encoding="utf-8") as f:
    expected = json.load(f)
by_name = {"base": expected["expect"]}
for c in expected.get("cases", []):
    by_name[c["name"]] = c["expect"]

mismatches = []
for name, conn in CASES.items():
    errors = [] if holds(conn) else FIT
    print(f"{name}: {'held' if not errors else 'a fit error'}")
    want = by_name.get(name)
    if want is None:
        mismatches.append(f"{name}: no such case in expected.json")
        continue
    if want["errors"] != errors:
        mismatches.append(f"{name} errors: hand {errors}, expected.json {want['errors']}")
    if name in OPS and want.get("ops") != OPS[name]:
        mismatches.append(f"{name} ops: hand {OPS[name]}, expected.json {want.get('ops')}")

if mismatches:
    print("\nMISMATCH")
    for m in mismatches:
        print("  " + m)
    raise SystemExit(1)
print("\nexpected.json agrees with the hand calculation")
