"""G50, a cover that arrives after assembly and a cross hole's face named on the connection,
worked by hand.

This script is the hand calculation of G50's hole faces and verdicts, written independently of
AluKit: it imports nothing from it and works each from the case's geometry with plain arithmetic
(the cover by sampling the mouth on a grid, the bearing under the lips from the area of a disc's
band). It prints them and checks them against expected.json beside it.

Run: python3 -I tests/fixtures/golden-gen/G50/by_hand.py (exit 1 on any mismatch).

The rules (docs/notes/f11-f12.md, after X9 in docs/notes/x9-f8-f9.md):

- X9. A quick connector's cross hole in the butting bar's side takes a tool through its mouth, so
  no other member may stand in front of the mouth within the tool's room (30 mm). Of the faces from
  which the hole reaches its core, the nearest whose mouth is clear wins, ties to the first of +y,
  -y, +x, -x; with none clear, the nearest, and a `connection` error naming who covers.
- F11. The tool turns when the joint is made. A member placed after assembly (`after_assembly`)
  is not there then, unless the joint itself is made after assembly (it joins such a member), when
  every member stands. So: of the reaching faces, the nearest no member covers at all; else the
  nearest only later members cover, a `connection` warning naming them (it cannot be re-tightened
  once they are in place); else the error. A named face that only later members cover is that
  warning; one a member there at the joint covers is the error.
- F12. The connection may name a face for every side hole at an end, or for the hole at a
  position; it is kept and judged as a named face is. One the hole does not reach from (deeper
  than the hole) is a `connection` error, and no hole is made there.

The members are boxes. The 80x80 post b2 stands x 260..340, y -40..40 from z 40; a quick connector
in each of two diagonal cores, (-20, -20) and (20, 20) in its section (local x along world +X,
local y along world +Y): each cross hole Ø18 and 28 deep, 25 up from the end (z 65), so it reaches
its core only from the two faces 20 from it (the others are 60). Under the sill's lips each head
(Ø18 on a Ø7.8 shank) bears on the band from the opening (8.18) out to the hooks (13.6): below half,
a `fit` warning at each.
"""

import json
import math
import os

D_HOLE, HOLE_Z, ACCESS, DEPTH, TOL = 18.0, 65.0, 30.0, 28.0, 0.01
FACES = ["+y", "-y", "+x", "-x"]
POST = {"x": (260.0, 340.0), "y": (-40.0, 40.0)}
CORES = [(-20.0, -20.0), (20.0, 20.0)]


def box(x0, x1, y0, y1, z0, z1):
    return {"x": (x0, x1), "y": (y0, y1), "z": (z0, z1)}


B1 = box(0, 340, -40, 40, -40, 40)  # the sill
B3 = box(300, 340, 42, 82, 40, 300)  # a 40x40 2 off the post's +y face, over the (20, 20) core
WALL = box(364.5, 394.5, -500, 500, 0, 1000)  # 24.5 off the post's +x face
WALL_Y = box(-200, 800, 64.5, 94.5, 0, 1000)  # the wall turned 90° about z, 24.5 off +y
B4 = box(342, 382, 0, 40, 40, 300)  # a 40x40 2 off the post's +x face


def face_geometry(face, core):
    """The face's axis, its plane, its outward sign, and the mouth's centre on it."""
    px, py = core
    cx, cy = 300.0 + px, py
    axis = "y" if face[1] == "y" else "x"
    sign = 1 if face[0] == "+" else -1
    plane = POST[axis][1] if sign > 0 else POST[axis][0]
    centre = {"x": cx, "y": cy, "z": HOLE_Z}
    return axis, plane, sign, centre


def distance(face, core):
    px, py = core
    return {"+y": 40 - py, "-y": 40 + py, "+x": 40 - px, "-x": 40 + px}[face]


def share(face, core, member, n=300):
    """The fraction of the mouth that the member's box stands in front of, within ACCESS of the
    face, by sampling the disc (radius 9 - TOL) on an n x n grid."""
    axis, plane, sign, centre = face_geometry(face, core)
    lo, hi = member[axis]
    near, far = (lo - plane, hi - plane) if sign > 0 else (plane - hi, plane - lo)
    if far <= TOL or near > ACCESS + TOL:
        return 0.0
    u, v = [a for a in ("x", "y", "z") if a != axis]
    r = D_HOLE / 2 - TOL
    inside = hit = 0
    for i in range(n):
        for j in range(n):
            pu = -r + (i + 0.5) * 2 * r / n
            pv = -r + (j + 0.5) * 2 * r / n
            if pu * pu + pv * pv > r * r:
                continue
            inside += 1
            a, b = centre[u] + pu, centre[v] + pv
            if member[u][0] < a < member[u][1] and member[v][0] < b < member[v][1]:
                hit += 1
    return hit / inside


def judged(face, core, members, late_joint):
    """Who covers the face's mouth: those there when the joint is made, and those only later."""
    covers = sorted(k for k, (m, _) in members.items() if share(face, core, m) > 1e-6)
    block = [k for k in covers if late_joint or not members[k][1]]
    later = [k for k in covers if k not in block]
    return block, later


def ordered(core):
    return sorted(FACES, key=lambda f: (round(distance(f, core) / TOL), FACES.index(f)))


def hole(core, members, late_joint, named=None):
    """The face drilled at the core (None: no hole), and the diagnostics, as (severity, refs)."""
    if named:
        if distance(named, core) > DEPTH + TOL:
            return None, [("error", ["b2"])]
        block, later = judged(named, core, members, late_joint)
        if block:
            return named, [("error", ["b2", *block])]
        if later:
            return named, [("warn", ["b2", *later])]
        return named, []
    reaching = [f for f in ordered(core) if distance(f, core) <= DEPTH + TOL]
    judge = {f: judged(f, core, members, late_joint) for f in reaching}
    for f in reaching:
        if not judge[f][0] and not judge[f][1]:
            return f, []
    for f in reaching:
        if not judge[f][0]:
            return f, [("warn", ["b2", *judge[f][1]])]
    by = sorted({k for f in reaching for k in judge[f][0]})
    return reaching[0], [("error", ["b2", *by])]


def band(rho, h):
    """The area of a disc of radius rho within |x| <= h of its centre."""
    if h >= rho:
        return math.pi * rho * rho
    return 2 * (h * math.sqrt(rho * rho - h * h) + rho * rho * math.asin(h / rho))


def on_lips(opening=8.18, hook=13.6, dk=18.0, d_in=7.8):
    R, r = dk / 2, d_in / 2
    lips = lambda rho: band(rho, hook / 2) - band(rho, opening / 2)  # noqa: E731
    return (lips(R) - lips(r)) / (math.pi * (R * R - r * r))


def op(face, core):
    across = core[0] if face[1] == "y" else core[1]
    return {"op": "hole", "face": face, "from": "a", "at": 25, "across": across, "d": 18,
            "depth": 28, "by": "c1"}


def words(o):
    return f"Ø18.00 hole 25.00 mm from end a on face {o['face']}, {o['across']:.2f} across, 28.00 deep"


BEARING = on_lips()
HEADS = [{"code": "fit", "entity": "c1", "refs": ["b1"]}] * 2 if BEARING < 0.5 else []


def case(members, late_post=False, names=None):
    names = names or {}
    ops, diags = [], []
    for core in CORES:
        face, ds = hole(core, members, late_post, names.get(core))
        if face:
            ops.append(op(face, core))
        diags += ds
    errors = [{"code": "connection", "entity": "c1", "refs": refs} for s, refs in diags if s == "error"]
    warns = [{"code": "connection", "entity": "c1", "refs": refs} for s, refs in diags if s == "warn"]
    return {"ops": ops, "warnings": warns + HEADS, "errors": errors}


LATE_WALL = {"b1": (B1, False), "b3": (B3, False), "p1": (WALL, True)}
FRAME_WALL = {"b1": (B1, False), "b3": (B3, False), "p1": (WALL, False)}
EVERY = {c: f for c in CORES for f in ["-x"]}

CASES = {
    "base": case(LATE_WALL),
    "the wall placed with the frame": case(FRAME_WALL),
    "the connection names +x at the (20, 20) core": case(LATE_WALL, names={(20.0, 20.0): "+x"}),
    "+x named, the wall placed with the frame": case(FRAME_WALL, names={(20.0, 20.0): "+x"}),
    "the connection names +y at the (20, 20) core": case(LATE_WALL, names={(20.0, 20.0): "+y"}),
    "the connection names -x for every hole at the end": case(LATE_WALL, names=EVERY),
    "the wall turned to stand off +y, b3 gone": case({"b1": (B1, False), "p1": (WALL_Y, True)}),
    "a 40x40 fitted last 2 off +x, no wall": case({"b1": (B1, False), "b3": (B3, False), "b4": (B4, True)}),
    "the post fitted after assembly": case(LATE_WALL, late_post=True),
}

base_ops = CASES["base"]["ops"]
print(f"the head on the lips' underside: {100 * BEARING:.2f} % (a fit warning at each core)")
for core in CORES:
    for f in ordered(core):
        shares = {k: round(100 * share(f, core, m), 1) for k, (m, _) in LATE_WALL.items()}
        print(f"core {core}, face {f}: {distance(f, core):.0f} from it; covers {shares}")
print("cut list:", "; ".join(sorted(words(o) for o in base_ops)))

here = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(here, "expected.json"), encoding="utf-8") as f:
    expected = json.load(f)
by_name = {"base": expected["expect"]}
for c in expected.get("cases", []):
    by_name[c["name"]] = c["expect"]

mismatches = []
for name, got in CASES.items():
    want = by_name.get(name)
    print(f"{name}: {[(o['face'], o['across']) for o in got['ops']]}, errors {got['errors']}, "
          f"warnings {got['warnings'][:-2] if HEADS else got['warnings']}")
    if want is None:
        mismatches.append(f"{name}: no such case in expected.json")
        continue
    for what, w, g in [("ops", want["ops"]["b2"], got["ops"]), ("warnings", want.get("warnings"), got["warnings"]),
                       ("errors", want["errors"], got["errors"])]:
        if w != g:
            mismatches.append(f"{name} {what}: hand {g}, expected.json {w}")
lines = expected["expect"]["lines"]["test-cover:H80"][0]["machining"]
if lines != sorted(words(o) for o in base_ops):
    mismatches.append(f"base machining: hand {sorted(words(o) for o in base_ops)}, expected.json {lines}")

if mismatches:
    print("\nMISMATCH")
    for m in mismatches:
        print("  " + m)
    raise SystemExit(1)
print("\nexpected.json agrees with the hand calculation")
