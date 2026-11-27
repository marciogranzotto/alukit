"""G47, a connector's own head under a groove's lips, worked by hand.

This script is the hand calculation of G47's seats, rooms and verdicts, written independently of
AluKit: it imports nothing from it and works each from the case's geometry and item data with plain
arithmetic. It prints them and checks them against expected.json beside it.

Run: python3 -I tests/fixtures/golden-gen/G47/by_hand.py (exit 1 on any mismatch).

The rule (docs/notes/x7-x8-f7.md, X8): a connector whose dims give a head (a quick connector's pin,
in the butting bar's core) seats it as F2b seats a butt screw's head: with no through-hole at its
place, under the lips of the near face's groove that lies under the joint. Its shank (d) must pass
the opening (|offset| + d/2 within half the opening); the lip and its height k the groove's depth;
and its head, Ø dk up to its rim and a spherical cap of radius rf above it, the chamber at every
depth it reaches. A head with no rf is a cylinder dk x k. It bears on the lips' underside, the face's
outer material, over the annulus from its shank (a screw's: the thread's ISO 273 medium clearance)
out to dk; below half, a fit warning.

The groove (the test catalog's c8q, a base-40 canal-8 groove's numbers): opening 8.18, lip 3.79,
depth 9.99, undercut 22.01, narrowing straight from 7.03 deep to 12.24 at the floor. The head (the
quick connector's): dk 18, shank d 7.8, k 4.48, rf 17.5. Here the room is found by sampling the
head's height finely, not from the tangent points AluKit solves for, as a check on them.
"""

import json
import math
import os

OPENING, LIP, DEPTH, UNDER, TAPER, BOTTOM = 8.18, 3.79, 9.99, 22.01, 7.03, 12.24
DK, D, K, RF = 18.0, 7.8, 4.48, 17.5
HOLE_M8 = 9.0  # ISO 273 medium clearance for M8
TOL = 0.01
FIT = [{"code": "fit", "entity": "c1", "refs": ["b1"]}]


def chamber(z):
    if z <= TAPER:
        return UNDER
    return UNDER - (UNDER - BOTTOM) * min(1.0, (z - TAPER) / (DEPTH - TAPER))


def half_head(t, rf):
    """The head's half-width t above its flat underside."""
    R = DK / 2
    if rf is None:
        return R
    rise = rf - math.sqrt(rf * rf - R * R)
    if t <= K - rise:
        return R
    c0 = K - rf  # the cap's centre, above the underside
    return math.sqrt(max(0.0, rf * rf - (t - c0) ** 2))


def side_room(rf, n=200000):
    """The least half-width of the chamber less the head's, over the head's height, sampled; with
    the rim's top edge itself, where a sample would fall just beside it."""
    R = DK / 2
    ts = [K * i / n for i in range(n + 1)]
    if rf is not None:
        ts.append(K - (rf - math.sqrt(rf * rf - R * R)))
    return min(chamber(LIP + t) / 2 - half_head(t, rf) for t in ts)


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


def seat(item, d_in, rf, off=0.0, shank=D, at=None):
    """A head under the lips: its seat and its verdict."""
    if abs(off) > OPENING / 2:
        return [], FIT  # no groove under the joint: no way through
    if abs(off) + shank / 2 > OPENING / 2 + TOL:
        return [], FIT  # the shank does not pass the opening
    if LIP + K > DEPTH + TOL:
        return [], FIT  # past the floor
    room = side_room(rf)
    if room < -TOL / 2:
        return [], FIT  # wider than the chamber where it reaches
    f = on_lips(DK, d_in)
    h = {"end": "b2.a"}
    if at is not None:
        h["at_mm"] = at
    h.update({"side": "head", "item": item, "on": "b1 +y (under its lips)", "d_in_mm": r2(d_in),
              "d_out_mm": r2(DK), "bearing_pct": r2(100 * f), "depth_room_mm": r2(DEPTH - LIP - K),
              "side_room_mm": r2(room)})
    return [h], []


rise = RF - math.sqrt(RF * RF - (DK / 2) ** 2)
print(f"the dome rises {rise:.4f} over a {K - rise:.4f} rim; its top reaches {LIP + K:.2f} of {DEPTH:.2f} "
      f"({DEPTH - LIP - K:.2f} left)")
print(f"the rim's top edge {LIP + K - rise:.4f} deep, the chamber {chamber(LIP + K - rise):.2f} wide there: "
      f"{(chamber(LIP + K - rise) - DK) / 2:.4f} each side")
print(f"least side room, sampled: dome {side_room(RF):.4f}; a cylinder {side_room(None):.4f} "
      f"(the chamber {chamber(LIP + K):.4f} at its top, {LIP + K:.2f} deep)")
print(f"on the lips: the pin's annulus Ø{D}-Ø{DK} {100 * on_lips(DK, D):.2f} %, a screw's Ø{HOLE_M8}-Ø{DK} "
      f"{100 * on_lips(DK, HOLE_M8):.2f} %")

two = seat("test-qc:QC40", D, RF, at=[-20, -20])[0] + seat("test-qc:QC40", D, RF, at=[20, 20])[0]
CASES = {
    "base": seat("test-qc:QC40", D, RF),
    "its head as a cylinder": seat("test-qc:QC40-CYL", D, None),
    "3 off the groove's centre": seat("test-qc:QC40", D, RF, off=3),
    "off the groove": seat("test-qc:QC40", D, RF, off=10),
    "two in an 80x80's diagonal cores": (two, []),
    "a screw with the same domed head into a tap": seat("test-qc:QSCR-DOME", HOLE_M8, RF, shank=8.0),
    "the screw's head as a cylinder": seat("test-qc:QSCR-FLAT", HOLE_M8, None, shank=8.0),
}

here = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(here, "expected.json"), encoding="utf-8") as f:
    expected = json.load(f)
by_name = {"base": expected["expect"]}
for c in expected.get("cases", []):
    by_name[c["name"]] = c["expect"]

mismatches = []
for name, (heads, errors) in CASES.items():
    want = by_name.get(name)
    print(f"{name}: {[(h['bearing_pct'], h['depth_room_mm'], h['side_room_mm']) for h in heads]} "
          f"{'error' if errors else ''}")
    if want is None:
        mismatches.append(f"{name}: no such case in expected.json")
        continue
    if want["heads"]["c1"] != heads:
        mismatches.append(f"{name} heads: hand {heads}, expected.json {want['heads']['c1']}")
    if want["errors"] != errors:
        mismatches.append(f"{name} errors: hand {errors}, expected.json {want['errors']}")

if mismatches:
    print("\nMISMATCH")
    for m in mismatches:
        print("  " + m)
    raise SystemExit(1)
print("\nexpected.json agrees with the hand calculation")
