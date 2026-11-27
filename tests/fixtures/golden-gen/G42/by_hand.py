"""G42, a head's seat from its standard's table, worked by hand.

This script is the hand calculation of G42's numbers, written independently of AluKit: it imports
nothing from it and works each from the case's data with plain arithmetic. It prints them and
checks them against expected.json beside it.

Run: python3 -I tests/fixtures/golden-gen/G42/by_hand.py (exit 1 on any mismatch).

The rule (design §3.4, a fastener's `standard`; docs/notes/x1-x3-f2ab.md, F2a): a fastener item
that cites a standard takes each dimension it does not state from that standard's row for its
thread; what it states wins. Its head's seat is then checked as G37's is (§4.5): the annulus from
the hole out to the bearing diameter (dw, else dk, else s), its fraction on the face's material,
below 50 % a `fit` warning. A fastener with no dimension and no standard is not checked (an info).

The geometry is G37's: the 40 x 40 b1 along +X, its top face with the c8 groove (opening 8.2) on
its centre line; the station 200 along it, so the head is centred on the groove; the screw's hole
Ø9 (ISO 273 medium for M8). test-x's synthetic standard SHCS gives dk 13 at M8. The screws: one
whose maker names SHCS, one taken to be made to it, one that states dk 10 itself, one with
neither. On a 50 x 10 flat bar instead, the face has no groove.
"""

import json
import math
import os

OPENING = 8.2
HOLE = 9.0
SHCS_M8 = {"dk_mm": 13.0, "k_mm": 8.0, "s_mm": 6.0}


def band(rho, h):
    """The area of a disc of radius rho within |x| <= h of its centre."""
    if h >= rho:
        return math.pi * rho * rho
    return 2 * (h * math.sqrt(rho * rho - h * h) + rho * rho * math.asin(h / rho))


def on_lips(d_out, d_in, opening=OPENING):
    """The fraction of the annulus d_in..d_out off a centred opening."""
    R, r = d_out / 2, d_in / 2
    ring = math.pi * (R * R - r * r)
    return 1 - (band(R, opening / 2) - band(r, opening / 2)) / ring


def dims(own, standard):
    """The item's dimensions once linked: the standard's row, under what the item states."""
    return {**(standard or {}), **own}


def bearing_d(d):
    return d.get("dw_mm", d.get("dk_mm", d.get("s_mm")))


def r2(x):
    return round(x, 2) + 0.0


def seat(item, d_out, fraction):
    return {
        "k": 1,
        "side": "head",
        "item": item,
        "on": "b1 +y",
        "d_in_mm": r2(HOLE),
        "d_out_mm": r2(d_out),
        "bearing_pct": r2(100 * fraction),
    }


WARN = [{"code": "fit", "entity": "c1", "refs": ["b1"]}]
SCREWS = {
    "base": ("test-x:SCR-M8x50-STD", {}, SHCS_M8, True),
    "the standard read from its type": ("test-x:SCR-M8x50-EST", {}, SHCS_M8, True),
    "its own head diameter": ("test-x:SCR-M8x50-OWN", {"dk_mm": 10.0}, SHCS_M8, True),
    "no standard": ("test-x:SCR-M8x50-BARE", {}, None, True),
    "its own head on a flat face": ("test-x:SCR-M8x50-OWN", {"dk_mm": 10.0}, SHCS_M8, False),
}

results = {}
for name, (item, own, standard, grooved) in SCREWS.items():
    d = bearing_d(dims(own, standard))
    if d is None:
        results[name] = {"seats": [], "warnings": []}
        continue
    f = on_lips(d, HOLE) if grooved else 1.0
    results[name] = {"seats": [seat(item, d, f)], "warnings": WARN if f < 0.5 else []}

here = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(here, "expected.json"), encoding="utf-8") as f:
    expected = json.load(f)
by_name = {"base": expected["expect"]}
for c in expected.get("cases", []):
    by_name[c["name"]] = c["expect"]

mismatches = []
for name, hand in results.items():
    want = by_name.get(name)
    print(f"{name}: {[s['bearing_pct'] for s in hand['seats']]}")
    if want is None:
        mismatches.append(f"{name}: no such case in expected.json")
        continue
    if want["seats"]["c1"] != hand["seats"]:
        mismatches.append(f"{name} seats: hand {hand['seats']}, expected.json {want['seats']['c1']}")
    if want["warnings"] != hand["warnings"]:
        mismatches.append(f"{name} warnings: hand {hand['warnings']}, expected.json {want['warnings']}")

if mismatches:
    print("\nMISMATCH")
    for m in mismatches:
        print("  " + m)
    raise SystemExit(1)
print("\nexpected.json agrees with the hand calculation")
