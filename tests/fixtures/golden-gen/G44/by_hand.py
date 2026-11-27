"""G44, a tap into a bar's face over a groove's opening, worked by hand.

This script is the hand calculation of G44's verdicts, written independently of AluKit: it imports
nothing from it and works each case from the geometry and the thread with plain arithmetic. It
prints them and checks them against expected.json beside it.

Run: python3 -I tests/fixtures/golden-gen/G44/by_hand.py (exit 1 on any mismatch).

The rule (design §4.5, §5.5; docs/notes/x1-x3-f2ab.md, X5): a tapped hole's thread is cut in the
face's wall, so the tap drill's circle (ISO's d - P, 6.75 for M8 x 1.25) must lie mostly on
material. More than half of it in a groove's opening is a `machining` error on the bar. The
fraction is the disc's area between the opening's two edges over its whole area.

The geometry: the 40x40 b1 along +X, its top (+y) face's c8 groove on its centre line, opening 8.2
(4.1 each side). The flat b2 lies on it from x 100 to 300; the station at 100 along b2 taps b1 at
200, `across_mm` from the face's centre line: 12, 0, 3, 6 and -12. A T-nut 10 across lies on no
groove: the fit error the T-nut fastening already gives (X5b, a regression).
"""

import json
import math
import os

D, P = 8.0, 1.25
R = (D - P) / 2
HALF = 8.2 / 2


def chord_integral(x):
    """The disc's area from its centre to x, along its x (x clipped to the disc)."""
    x = max(-R, min(R, x))
    return x * math.sqrt(R * R - x * x) + R * R * math.asin(x / R)


def in_opening(across):
    lo, hi = -HALF - across, HALF - across  # the opening's edges, from the disc's centre
    return (chord_integral(hi) - chord_integral(lo)) / (math.pi * R * R)


MACH = [{"code": "machining", "entity": "b1", "refs": ["c1"]}]
cases = {}
for name, across in [
    ("base", 12),
    ("on the groove's centre line", 0),
    ("3 across", 3),
    ("6 across", 6),
    ("12 the other way", -12),
]:
    f = in_opening(across)
    cases[name] = MACH if f > 0.5 else []
    print(f"{name}: tap drill {2 * R:.2f}, {100 * f:.2f} % in the opening")
cases["a T-nut off the groove"] = [{"code": "fit", "entity": "c1", "refs": ["b1"]}]
print("a T-nut 10 across: the opening's edge at 4.1, so no groove under it: a fit error")

here = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(here, "expected.json"), encoding="utf-8") as f:
    expected = json.load(f)
by_name = {"base": expected["expect"]}
for c in expected.get("cases", []):
    by_name[c["name"]] = c["expect"]

mismatches = []
for name, errors in cases.items():
    want = by_name.get(name)
    if want is None:
        mismatches.append(f"{name}: no such case in expected.json")
    elif want["errors"] != errors:
        mismatches.append(f"{name} errors: hand {errors}, expected.json {want['errors']}")
if round(100 * in_opening(3), 2) != 70.38 or round(100 * in_opening(6), 2) != 16.16:
    mismatches.append("the design text's 70.38 % and 16.16 % do not match")

if mismatches:
    print("\nMISMATCH")
    for m in mismatches:
        print("  " + m)
    raise SystemExit(1)
print("\nexpected.json agrees with the hand calculation")
