"""G43, a butt connector's screw heads, worked by hand.

This script is the hand calculation of G43's seats and verdicts, written independently of AluKit:
it imports nothing from it and works each from the case's geometry and item data with plain
arithmetic. It prints them and checks them against expected.json beside it.

Run: python3 -I tests/fixtures/golden-gen/G43/by_hand.py (exit 1 on any mismatch).

The rule (design §3.4, §4.5; docs/notes/x1-x3-f2ab.md, F2b): a screw into a tap the connector makes
in the butting end seats its head on the through bar's far face where the connector drills a
through-hole for it at that place (it comes through the bar), and otherwise under the lips of the
groove of the near face that lies under the joint. Under the lips: the shank must pass the
opening (its edge, |offset| + d/2, within the opening's half), the lip, a T-nut seat's body and the
head must fit the groove's depth, and the head the chamber's width there; with no T-nut, the head
bears on the lips' underside, which the opening leaves as the face's outer material. Each seat is
the annulus from the hole (ISO 273 medium, Ø9 for M8; a washer's bore if wider) to the bearing
diameter (dk, or a washer's d2), its fraction on material; below 50 % a `fit` warning.

The geometry: the 40 x 40 rail b1 along +X, its top (+y) and bottom (-y) faces each with the test
catalog's c8 groove on the centre line: opening 8.2, lip 2.2, depth 12.25, chamber 14.5. The post
b2 stands on the top face at x = 300, its axis on the groove's centre line (moved 3 and 10 across
in two cases). The screws: M8, dk 13, k 8; a Ø16 head; a washer d1 8.4, d2 16; T-nut seats with
bodies 5.5 and 2 high.
"""

import json
import math
import os

OPENING, LIP, DEPTH, CHAMBER = 8.2, 2.2, 12.25, 14.5
TOL = 0.05
HOLE = 9.0  # ISO 273 medium for M8, and J1's through-hole
M8 = 8.0


def band(rho, h):
    """The area of a disc of radius rho within |x| <= h of its centre."""
    if h >= rho:
        return math.pi * rho * rho
    return 2 * (h * math.sqrt(rho * rho - h * h) + rho * rho * math.asin(h / rho))


def on_lips(d_out, d_in):
    R, r = d_out / 2, d_in / 2
    return 1 - (band(R, OPENING / 2) - band(r, OPENING / 2)) / (math.pi * (R * R - r * r))


def r2(x):
    return round(x, 2) + 0.0


FIT = [{"code": "fit", "entity": "c1", "refs": ["b1"]}]


def head(item, on, d_in, d_out, f):
    return {"end": "b2.a", "side": "head", "item": item, "on": on,
            "d_in_mm": r2(d_in), "d_out_mm": r2(d_out), "bearing_pct": r2(100 * f)}


def slot(item, dk, k, seat_k=None, off=0.0):
    """A head under the lips: its seat and verdict."""
    if abs(off) > OPENING / 2:
        return [], FIT, []  # no groove under the joint: no way through
    if abs(off) + M8 / 2 > OPENING / 2 + TOL:
        return [], FIT, []  # the shank does not pass the opening
    reach = LIP + (seat_k or 0) + k
    if reach > DEPTH + TOL:
        return [], FIT, []  # past the groove's floor
    if dk > CHAMBER + TOL:
        return [], FIT, []  # wider than the chamber
    if seat_k is not None:
        return [], [], []  # the T-nut is the seat
    f = on_lips(dk, HOLE)
    return [head(item, "b1 +y (under its lips)", HOLE, dk, f)], [], FIT if f < 0.5 else []


def far(item, d_out, d_in):
    """A head (or a washer under it) on the rail's bottom face, centred on its groove."""
    f = on_lips(d_out, d_in)
    return [head(item, "b1 -y", d_in, d_out, f)], [], FIT if f < 0.5 else []


CASES = {
    "base": slot("test-x:SCR-M8x20", 13, 8),
    "on a T-nut seat": slot("test-x:SCR-M8x20", 13, 8, seat_k=5.5),
    "on a thin T-nut seat": slot("test-x:SCR-M8x20", 13, 8, seat_k=2),
    "a head too wide for the chamber": slot("test-x:SCR-M8x20-WIDE", 16, 8),
    "3 off the groove's centre": slot("test-x:SCR-M8x20", 13, 8, off=3),
    "off the groove": slot("test-x:SCR-M8x20", 13, 8, off=10),
    "through the rail": far("test-x:SCR-M8x100", 13, HOLE),
    "through the rail, on a washer": far("test-x:W8", 16, max(HOLE, 8.4)),
}
print(f"under the lips: reaches {LIP + 8:.2f}; on the 5.5 seat {LIP + 5.5 + 8:.2f}, "
      f"{LIP + 5.5 + 8 - DEPTH:.2f} past; on the 2 seat {LIP + 2 + 8:.2f}")

here = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(here, "expected.json"), encoding="utf-8") as f:
    expected = json.load(f)
by_name = {"base": expected["expect"]}
for c in expected.get("cases", []):
    by_name[c["name"]] = c["expect"]

mismatches = []
for name, (heads, errors, warnings) in CASES.items():
    want = by_name.get(name)
    print(f"{name}: {[h['bearing_pct'] for h in heads]} {'error' if errors else ''}{'warning' if warnings else ''}")
    if want is None:
        mismatches.append(f"{name}: no such case in expected.json")
        continue
    if want["heads"]["c1"] != heads:
        mismatches.append(f"{name} heads: hand {heads}, expected.json {want['heads']['c1']}")
    if want["errors"] != errors:
        mismatches.append(f"{name} errors: hand {errors}, expected.json {want['errors']}")
    if "warnings" in want and want["warnings"] != warnings:
        mismatches.append(f"{name} warnings: hand {warnings}, expected.json {want['warnings']}")

if mismatches:
    print("\nMISMATCH")
    for m in mismatches:
        print("  " + m)
    raise SystemExit(1)
print("\nexpected.json agrees with the hand calculation")
