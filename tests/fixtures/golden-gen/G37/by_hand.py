"""G37, a screw head's seat on a T-slot face, worked by hand.

This script is the hand calculation of G37's numbers, written independently of AluKit: it imports
nothing from it and works each number from the case's geometry with plain arithmetic. It prints
them and checks them against expected.json beside it.

Run: python3 -I tests/fixtures/golden-gen/G37/by_hand.py (exit 1 on any mismatch).

The rule (design §4.5, a head's seat; docs/notes/f2-joint-geometry.md, part 3): a head, a nut or
a washer under either bears on the annulus from the hole (or the washer's bore, if wider) out to
its bearing diameter: a socket head's dk (ISO 4762), a hex head's or a nut's s across flats (ISO
4017, ISO 4032), a washer's outside d2 (ISO 7089). The fraction of that annulus on the face's
material is reported; below 50 %, a `fit` warning; on nothing at all, a `fit` error. A T-slot
face's material is its side less the groove's opening, so a seat centred on the groove bears
only on the two lips either side of it.

The geometry: the 40 x 40 b1 along +X, its top face z = 20 with the test catalog's c8 groove
(opening 8.2) along its centre; the station 200 along it, on its centre line, so every seat is
centred on a groove. The screw's holes are ISO 273 medium clearance: Ø9 for M8, Ø4.5 for M4. The
items are test-seat's: an M8 socket head dk 13, an M4 one dk 7, a hex bolt and a nut s 13, a
washer d1 8.4 and d2 16.
"""

import json
import math
import os

OPENING = 8.2


def band(rho, h):
    """The area of a disc of radius rho within |x| <= h of its centre."""
    if h >= rho:
        return math.pi * rho * rho
    return 2 * (h * math.sqrt(rho * rho - h * h) + rho * rho * math.asin(h / rho))


def on_lips(d_out, d_in, opening=OPENING):
    """The fraction of the annulus d_in..d_out off a centred opening: on the lips either side."""
    R, r = d_out / 2, d_in / 2
    ring = math.pi * (R * R - r * r)
    return 1 - (band(R, opening / 2) - band(r, opening / 2)) / ring


def r2(x):
    """To 0.01, with no negative zero."""
    return round(x, 2) + 0.0


def seat(side, item, on, d_in, d_out, fraction):
    return {
        "k": 1,
        "side": side,
        "item": item,
        "on": on,
        "d_in_mm": r2(d_in),
        "d_out_mm": r2(d_out),
        "bearing_pct": r2(100 * fraction),
    }


M8, W8, M4 = "test-seat:SHCS-M8x50", "test-seat:W8", "test-seat:SHCS-M4x50"
HEX, N8 = "test-seat:HEX-M8x90", "test-seat:N8"
head = on_lips(13, 9)
washer = on_lips(16, max(9, 8.4))
CASES = {
    "base": [seat("head", M8, "b1 +y", 9, 13, head)],
    "with a washer": [seat("head", W8, "b1 +y", 9, 16, washer)],
    "an M4 head": [seat("head", M4, "b1 +y", 4.5, 7, on_lips(7, 4.5))],
    # A 50 x 10 flat bar has no groove: the head bears on its face whole.
    "on a flat face": [seat("head", M8, "b1 +y", 9, 13, 1.0)],
    # Bolted through two 40x40s: the nut on the lower one's bottom face, also on its groove.
    "bolted through two 40x40s": [
        seat("head", HEX, "b1 +y", 9, 13, head),
        seat("nut", N8, "b2 -y", 9, 13, head),
    ],
    "bolted, with two washers": [
        seat("head", W8, "b1 +y", 9, 16, washer),
        seat("nut", W8, "b2 -y", 9, 16, washer),
    ],
}
FIT = {"code": "fit", "entity": "c1"}
WARNINGS = {
    "base": [{**FIT, "refs": ["b1"]}],
    "bolted through two 40x40s": [{**FIT, "refs": ["b1"]}, {**FIT, "refs": ["b2"]}],
}
ERRORS = {"an M4 head": [{**FIT, "refs": ["b1"]}]}

here = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(here, "expected.json"), encoding="utf-8") as f:
    expected = json.load(f)
by_name = {"base": expected["expect"]}
for c in expected.get("cases", []):
    by_name[c["name"]] = c["expect"]

mismatches = []
for name, seats in CASES.items():
    print(f"{name}: " + "; ".join(f"{s['side']} {s['item']} on {s['on']}: {s['bearing_pct']:.2f} %" for s in seats))
    want = by_name.get(name)
    if want is None:
        mismatches.append(f"{name}: no such case in expected.json")
        continue
    if want["seats"]["c1"] != seats:
        mismatches.append(f"{name} seats: hand {seats}, expected.json {want['seats']['c1']}")
    if want["warnings"] != WARNINGS.get(name, []):
        mismatches.append(f"{name} warnings: hand {WARNINGS.get(name, [])}, expected.json {want['warnings']}")
    if want["errors"] != ERRORS.get(name, []):
        mismatches.append(f"{name} errors: hand {ERRORS.get(name, [])}, expected.json {want['errors']}")

if mismatches:
    print("\nMISMATCH")
    for m in mismatches:
        print("  " + m)
    raise SystemExit(1)
print("\nexpected.json agrees with the hand calculation")
