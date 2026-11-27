"""G45, a sleeve through both walls of a tube, worked by hand.

This script is the hand calculation of G45's sleeve lengths and holes, written independently of
AluKit: it imports nothing from it and works each case from the stack's heights along the bolt's
axis with plain arithmetic. It prints them and checks them against expected.json beside it.

Run: python3 -I tests/fixtures/golden-gen/G45/by_hand.py (exit 1 on any mismatch).

The rule (design §4.5; docs/notes/x1-x3-f2ab.md, X6): a stack sleeve's nut-side end is at the
nut-side wall's inner face (in the bore, draft 2.3's only mode), or, with `walls: "both"`, at that
wall's outer face; it runs its length toward the head. Where it passes a wall, the wall's hole
clears it (A7: ISO 273 medium for a shank of its outside diameter, 18 -> 20, or that diameter plus
`clearance_mm`); a solid layer it enters part way is counterbored to the same diameter, as deep as
it enters. Every other hole is the bolt's clearance, M10 -> 11.

The geometry (G32's): along the bolt's axis, head side first, flat b1 z 0..10, flat b2 10..30,
RHS b3 30..80 (walls 30..34 and 76..80, t 4, bore 42), flat b4 80..100, flat b5 100.5..110.5; four
stations, at 100 and 300, 15 either side of the centre line.
"""

import json
import os

T, LO, HI = 4.0, 30.0, 80.0
BORE = HI - LO - 2 * T
SLEEVE_HOLE = {0.5: 18.5, None: 20.0}  # 18 + clearance, or ISO 273 medium for 18
BOLT = 11.0


def case(length, both, clearance=None):
    """The sleeve's span along the axis, and the holes it gives b2 and b3."""
    top = HI if both else HI - T
    low = top - length
    hole = SLEEVE_HOLE[clearance]
    walls = []
    for a, z in ((LO, LO + T), (HI - T, HI)):
        walls.append(hole if low < z and top > a else BOLT)
    into_b2 = max(0.0, LO - low)  # b2 lies 10..30, below the RHS
    return {"len": length, "b3": walls, "b2_cbore": (hole, into_b2) if into_b2 > 0 else None}


CASES = {
    "base": case(BORE + 2 * T, True),
    "clearance_mm 0.5": case(BORE + 2 * T, True, 0.5),
    "a sleeve 4 longer": case(BORE + 2 * T + 4, True),
    "in the bore, as before": case(BORE + 2 * T, False),
}

here = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(here, "expected.json"), encoding="utf-8") as f:
    expected = json.load(f)
by_name = {"base": expected["expect"]}
for c in expected.get("cases", []):
    by_name[c["name"]] = c["expect"]

mismatches = []
for name, h in CASES.items():
    print(f"{name}: sleeve {h['len']:.2f}, b3's walls {h['b3']}, b2's counterbore {h['b2_cbore']}")
    want = by_name[name]
    lines = want.get("lines", expected["expect"]["lines"])["test-geo:TUBE-18x2"]
    if lines != [{"count": 4, "cut_mm": h["len"]}]:
        mismatches.append(f"{name}: sleeve {h['len']}, expected.json {lines}")
    b3 = want["ops"]["b3"]
    got = sorted({(o["face"], o["d"], o["depth"]) for o in b3})
    hand = sorted({("-x", h["b3"][0], T), ("+x", h["b3"][1], T)})
    if got != hand or len(b3) != 8:
        mismatches.append(f"{name} b3: hand {hand}, expected.json {got} ({len(b3)} holes)")
    b2 = want["ops"].get("b2")
    if b2 is not None:
        cb = {(o["d"], o["cbore"]["d"], o["cbore"]["depth"]) if "cbore" in o else (o["d"],) for o in b2}
        hand_cb = {(BOLT, *h["b2_cbore"])} if h["b2_cbore"] else {(BOLT,)}
        if cb != hand_cb or len(b2) != 4:
            mismatches.append(f"{name} b2: hand {hand_cb}, expected.json {cb}")
    if want["errors"] != []:
        mismatches.append(f"{name}: expected.json gives errors")

if mismatches:
    print("\nMISMATCH")
    for m in mismatches:
        print("  " + m)
    raise SystemExit(1)
print("\nexpected.json agrees with the hand calculation")
