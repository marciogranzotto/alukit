"""G49, a cross hole's face clear of the other members, a head on hooked lips, and a profile's own
groove, worked by hand.

This script is the hand calculation of G49's hole faces, seats, rooms and verdicts, written
independently of AluKit: it imports nothing from it and works each from the case's geometry and
item data with plain arithmetic (the cover by sampling the mouth on a grid, the bearing from the
area of a disc's band). It prints them and checks them against expected.json beside it.

Run: python3 -I tests/fixtures/golden-gen/G49/by_hand.py (exit 1 on any mismatch).

The rules (docs/notes/x9-f8-f9.md):

- X9. A quick connector's cross hole in the butting bar's side takes a tool through its mouth once
  the frame stands, so no other member may stand in front of the mouth within the tool's room (30
  mm by default, `access_mm` on the requirement). A hole with no position goes on +y while +y is
  clear; else on the nearest face, as near the core as +y, that is clear, ties to the first of +y,
  -y, +x, -x. A face named by the requirement or by the mount's hole is kept, and when something
  covers it, or when no face is clear, that is a `connection` error naming who covers it.
- F8. A head under the lips bears on the lips' underside: just above the lip's depth, from the
  opening out to the hooks, where the chamber rises toward the face. The fraction of its annulus
  (from its shank out to dk) there; below half, a fit warning.
- F9. A profile's own groove dimensions, where its drawing gives them, replace its groove type's;
  where they are not given, a head under its lips is not seated, and check says so (an info).

The members are boxes: the post b2 stands x 280..320, y -20..20 from z 20; its cross hole, Ø18 and
28 deep, 25 up from its end (z 45), heads for its core 20 in from every face. The groove type: opening
8.18, lip 3.79, depth 9.99, undercut 22.01 narrowing straight from 7.03 deep to 12.24 at the floor,
hooks 13.6 wide, the face wall 1.8 thick beyond them. The head: dk 18, shank 7.8, k 4.48, a dome of
radius 17.5.
"""

import json
import math
import os

D_HOLE, HOLE_Z, ACCESS = 18.0, 45.0, 30.0
FACES = ["+y", "-y", "+x", "-x"]
# Each face of the post at the hole: its plane's coordinate, the axis it faces along, its sign, and
# the mouth's centre in the other two axes.
POST = {"+y": ("y", 20.0, +1), "-y": ("y", -20.0, -1), "+x": ("x", 320.0, +1), "-x": ("x", 280.0, -1)}
CENTRE = {"x": 300.0, "y": 0.0, "z": HOLE_Z}

TYPE = {"opening": 8.18, "lip": 3.79, "depth": 9.99, "under": 22.01, "taper": 7.03, "bottom": 12.24,
        "hook": 13.6}
OWN = {**TYPE, "opening": 8.1, "lip": 4.0, "hook": 14.3}
DK, D_IN, K, RF = 18.0, 7.8, 4.48, 17.5
TOL = 0.01


def box(x0, x1, y0, y1, z0, z1):
    return {"x": (x0, x1), "y": (y0, y1), "z": (z0, z1)}


B1 = box(0, 600, -20, 20, -20, 20)


def along_x(y, z, x0=200, x1=400):
    return box(x0, x1, y - 20, y + 20, z - 20, z + 20)


def along_y(x, z, y0, y1):
    return box(x - 20, x + 20, y0, y1, z - 20, z + 20)


def share(face, member, access, n=400):
    """The fraction of the face's mouth (Ø18) that the member's box stands in front of, within
    `access` of the face, by sampling the disc on an n x n grid."""
    axis, plane, sign = POST[face]
    lo, hi = member[axis]
    near, far = (lo - plane, hi - plane) if sign > 0 else (plane - hi, plane - lo)
    if far <= TOL or near > access + TOL:
        return 0.0
    u, v = [a for a in ("x", "y", "z") if a != axis]
    r = D_HOLE / 2
    inside = hit = 0
    for i in range(n):
        for j in range(n):
            pu = -r + (i + 0.5) * 2 * r / n
            pv = -r + (j + 0.5) * 2 * r / n
            if pu * pu + pv * pv > r * r:
                continue
            inside += 1
            a, b = CENTRE[u] + pu, CENTRE[v] + pv
            if member[u][0] < a < member[u][1] and member[v][0] < b < member[v][1]:
                hit += 1
    return hit / inside


def covers(face, members, access):
    return sorted(name for name, m in members.items() if share(face, m, access) > 1e-6)


def hole(members, named=None, access=ACCESS):
    """The face the cross hole goes in from, and the error naming who covers it, if any."""
    err = [{"code": "connection", "entity": "c1", "refs": ["b2"]}]
    if named:
        by = covers(named, members, access)
        return named, ([{**err[0], "refs": ["b2", *by]}] if by else [])
    if not covers("+y", members, access):
        return "+y", []
    # Every face of a 40x40 is 20 from the core, as near it as +y: the first clear in tie order.
    for f in FACES[1:]:
        if not covers(f, members, access):
            return f, []
    by = sorted({c for f in FACES for c in covers(f, members, access)})
    return "+y", [{**err[0], "refs": ["b2", *by]}]


def band(rho, h):
    """The area of a disc of radius rho within |x| <= h of its centre."""
    if h >= rho:
        return math.pi * rho * rho
    return 2 * (h * math.sqrt(rho * rho - h * h) + rho * rho * math.asin(h / rho))


def on_lips(g):
    """The fraction of the head's annulus on the lips' underside, |x| from opening/2 to hook/2."""
    R, r = DK / 2, D_IN / 2
    lips = lambda rho: band(rho, g["hook"] / 2) - band(rho, g["opening"] / 2)  # noqa: E731
    return (lips(R) - lips(r)) / (math.pi * (R * R - r * r))


def chamber(g, z):
    if z <= g["taper"]:
        return g["under"]
    return g["under"] - (g["under"] - g["bottom"]) * min(1.0, (z - g["taper"]) / (g["depth"] - g["taper"]))


def half_head(t):
    R = DK / 2
    rise = RF - math.sqrt(RF * RF - R * R)
    if t <= K - rise:
        return R
    return math.sqrt(max(0.0, RF * RF - (t - (K - RF)) ** 2))


def side_room(g, n=200000):
    R = DK / 2
    ts = [K * i / n for i in range(n + 1)] + [K - (RF - math.sqrt(RF * RF - R * R))]
    return min(chamber(g, g["lip"] + t) / 2 - half_head(t) for t in ts)


def r2(x):
    return round(x, 2) + 0.0


def head(g, item, at=None):
    f = on_lips(g)
    h = {"end": "b2.a", **({"at_mm": at} if at is not None else {}), "side": "head", "item": item,
         "on": "b1 +y (under its lips)", "d_in_mm": r2(D_IN), "d_out_mm": r2(DK),
         "bearing_pct": r2(100 * f), "depth_room_mm": r2(g["depth"] - g["lip"] - K),
         "side_room_mm": r2(side_room(g))}
    warn = [{"code": "fit", "entity": "c1", "refs": ["b1"]}] if f < 0.5 else []
    return [h], warn


def op(face):
    return {"op": "hole", "face": face, "from": "a", "at": 25, "d": 18, "depth": 28, "by": "c1"}


BASE = {"b1": B1, "b3": along_x(40, 45)}
OFF = {"b1": B1, "b3": along_x(42, 45)}
ALL = {**BASE, "b4": along_x(-40, 45), "b5": along_y(340, 45, -15, 15), "b6": along_y(260, 45, -15, 15)}

CASES = {}


def case(name, members, named=None, access=ACCESS, g=TYPE, unread=False, item="test-cover:HC40", at=None):
    face, errors = hole(members, named, access)
    heads, warns = ([], []) if unread else head(g, item, at)
    out = {"ops": [op(face)], "heads": heads, "warnings": warns, "errors": errors}
    if unread:
        out["infos"] = [{"code": "fit", "entity": "c1"}]
    CASES[name] = out


case("base", BASE)
case("the requirement names the covered face", BASE, named="+y", item="test-cover:HC40-FACE")
case("the bar 2 mm off the face", OFF)
case("the bar 2 mm off, a tool that needs 1 mm", OFF, access=1.0, item="test-cover:HC40-ACCESS")
case("every face covered", ALL)
# The recipe's mount holds the connector at the core, (0, 0): the head is placed there.
case("a mount's hole names -x", BASE, named="-x", at=[0, 0])
case("a rail whose drawing gives its own groove", BASE, g=OWN)
case("a rail whose drawing does not give its lips' undersides", BASE, unread=True)

for f in FACES:
    print(f"base, face {f}: covered by {covers(f, BASE, ACCESS)} "
          f"({', '.join(f'{k} {100 * share(f, m, ACCESS):.1f} %' for k, m in BASE.items())})")
print(f"on the hooked lips: {100 * on_lips(TYPE):.4f} % (the face beside the opening would give "
      f"{100 * on_lips({**TYPE, 'hook': 40}):.4f} %); own groove {100 * on_lips(OWN):.4f} %")
print(f"room: type {TYPE['depth'] - TYPE['lip'] - K:.2f} deep, {side_room(TYPE):.4f} a side; "
      f"own {OWN['depth'] - OWN['lip'] - K:.2f} deep, {side_room(OWN):.4f} a side")

here = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(here, "expected.json"), encoding="utf-8") as f:
    expected = json.load(f)
by_name = {"base": expected["expect"]}
for c in expected.get("cases", []):
    by_name[c["name"]] = c["expect"]

mismatches = []
for name, got in CASES.items():
    want = by_name.get(name)
    print(f"{name}: {got['ops'][0]['face']}, {[h['bearing_pct'] for h in got['heads']]}, "
          f"errors {got['errors']}, warnings {got['warnings']}")
    if want is None:
        mismatches.append(f"{name}: no such case in expected.json")
        continue
    checks = [("ops", want["ops"]["b2"], got["ops"]), ("heads", want["heads"]["c1"], got["heads"]),
              ("warnings", want.get("warnings"), got["warnings"]), ("errors", want["errors"], got["errors"])]
    if "infos" in got:
        checks.append(("infos", want.get("infos"), got["infos"]))
    for what, w, g in checks:
        if w != g:
            mismatches.append(f"{name} {what}: hand {g}, expected.json {w}")

if mismatches:
    print("\nMISMATCH")
    for m in mismatches:
        print("  " + m)
    raise SystemExit(1)
print("\nexpected.json agrees with the hand calculation")
