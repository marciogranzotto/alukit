"""G32, the clearance a hole takes for a sleeve that passes it, worked by hand.

This script is the hand calculation of G32's numbers, written independently of AluKit: it imports
nothing from it and works each hole from the case's layers with plain arithmetic. It prints them
and checks them against expected.json beside it.

Run: python3 -I tests/fixtures/golden-gen/G32/by_hand.py (exit 1 on any mismatch).

The rule (design §4.5 generated holes; docs/notes/acceptance-gaps.md, A7): a bolt's clearance
hole is ISO 273's medium series for its thread. Where a sleeve passes a wall or a layer whole,
that hole takes the sleeve's clearance instead (the larger of the two); where it enters a layer
part way, that layer gets a counterbore of the sleeve's clearance as deep as it enters. The
sleeve's clearance is ISO 273 medium for a shank of the sleeve's outside diameter (the smallest
diameter of the table not below it), or the outside diameter plus the sleeve's `clearance_mm`.

The layers stack along +Z, head to nut (G25): flat 50x10 z 0..10, flat 50x20 z 10..30, the RHS
100x50x4 across its 50, z 30..80 (walls 30..34 and 76..80, bore 42), flat 50x20 z 80..100, and
flat 50x10 z 100.5..110.5. Four M10 rods, at (100, -15), (100, 15), (300, -15), (300, 15). The
sleeve, tube 18x2 (outside diameter 18), stands on the RHS's nut-side inner wall (z 76) and
reaches back toward the head by its length.
"""

import json
import os

# ISO 273:1979, medium series, from its national adoption IS 1821:1987, p. 2: the rows this
# case reads (d -> d_h).
ISO273_MEDIUM = {10: 11.0, 12: 13.5, 14: 15.5, 16: 17.5, 18: 20.0, 20: 22.0}
TOL = 0.01

SOLID = [("b1", 0.0, 10.0), ("b2", 10.0, 30.0), ("b4", 80.0, 100.0), ("b5", 100.5, 110.5)]
RHS_WALLS = [("b3", 30.0, 34.0), ("b3", 76.0, 80.0)]
INNER_NUT_WALL = 76.0
OD = 18.0
BORE = 42.0
T = 4.0
STATIONS = [(100, -15), (100, 15), (300, -15), (300, 15)]


def sleeve_hole(clearance):
    if clearance is not None:
        return OD + clearance
    d = min(k for k in ISO273_MEDIUM if k >= OD - TOL)
    return ISO273_MEDIUM[d]


def holes(sleeve_len, clearance):
    bolt = ISO273_MEDIUM[10]
    s_hole = sleeve_hole(clearance)
    lo, hi = INNER_NUT_WALL - sleeve_len, INNER_NUT_WALL
    out = []  # (bar, d, counterbore or None), per station, bars in id order
    for bar, a, b in sorted(SOLID + RHS_WALLS, key=lambda x: (x[0], x[1])):
        wall = bar == "b3"
        inside = min(b, hi) - max(a, lo)
        d, cb = bolt, None
        if inside > TOL:
            whole = lo <= a + TOL and hi >= b - TOL
            if whole or wall:
                d = max(d, s_hole)
            else:
                cb = (s_hole, inside)
        out.append((bar, d, cb))
    return [h for h in out for _ in STATIONS]


def r2(x):
    return round(x + 0.0, 2)


cases = {
    "base": (BORE + T, None),
    "clearance_mm 1": (BORE + T, 1.0),
    "clearance_mm 0": (BORE + T, 0.0),
    "a 50 mm sleeve, into the flat below": (50.0, None),
}
results = {}
for name, (length, clearance) in cases.items():
    hs = holes(length, clearance)
    per_bar = {}
    for bar, _, _ in hs:
        per_bar[bar] = per_bar.get(bar, 0) + 1
    diameters = []
    for _, d, _ in hs:
        if r2(d) not in diameters:
            diameters.append(r2(d))
    b2 = [
        {
            "op": "hole",
            "face": "+y",
            "from": "a",
            "at": at,
            "across": across,
            "d": r2(d),
            "cbore": {"d": r2(cb[0]), "depth": r2(cb[1])},
            "by": "c1",
        }
        for (at, across) in STATIONS
        for bar, d, cb in [h for h in holes(length, clearance)[::4] if h[0] == "b2"]
        if cb is not None
    ]
    results[name] = {
        "sleeve": r2(length),
        "holes": {"total": len(hs), "d_mm": diameters, "per_bar": per_bar},
        "b2": b2,
    }
    print(f"{name}: sleeve {length:.2f}, holes {results[name]['holes']}, b2 counterbores {len(b2)}")

here = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(here, "expected.json"), encoding="utf-8") as f:
    expected = json.load(f)
by_name = {"base": expected["expect"]}
for c in expected.get("cases", []):
    by_name[c["name"]] = c["expect"]

mismatches = []
for name, r in results.items():
    want = by_name.get(name)
    if want is None:
        mismatches.append(f"{name}: no such case in expected.json")
        continue
    if want["holes"] != r["holes"]:
        mismatches.append(f"{name} holes: hand {r['holes']}, expected.json {want['holes']}")
    sleeve = want.get("lines", {}).get("test-geo:TUBE-18x2")
    if sleeve is not None and sleeve != [{"count": 4, "cut_mm": r["sleeve"]}]:
        mismatches.append(f"{name} sleeve: hand {r['sleeve']}, expected.json {sleeve}")
    if "ops" in want and want["ops"]["b2"] != r["b2"]:
        mismatches.append(f"{name} b2: hand {r['b2']}, expected.json {want['ops']['b2']}")

if mismatches:
    print("\nMISMATCH")
    for m in mismatches:
        print("  " + m)
    raise SystemExit(1)
print("\nexpected.json agrees with the hand calculation")
