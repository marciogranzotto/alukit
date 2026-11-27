"""The cart's cut list, bill of materials, order list and machining sheet, worked by hand.

This script is the hand calculation of tests/fixtures/cart/alukit.json's outputs, written
independently of AluKit: it imports nothing from it and works each number from the cart's
geometry and the synthetic catalogs with plain arithmetic, the way a person would on paper. It
writes tests/fixtures/cart/expected-cutlist.json, expected-bom.json, expected-order.json and
expected-machining.json, which the cart test compares AluKit's outputs with.

Run: python3 -I tests/fixtures/cart/hand/cart_by_hand.py, then
pnpm exec biome format --write tests/fixtures/cart (the repository's JSON style).

Rules used, from docs/design.md:
- cut lengths come from the placed bounding boxes (§4.5); a butt stops a bar at the first face of
  the through bar it meets, or at the end face it names, moved by the connector's spacer along
  that face's normal; a through bar's end covers a corner; a pivot cuts its bar square at the
  hinge's end distance from the pivot point;
- a bolt through layers gets an ISO 273 medium clearance hole in each layer, both walls of a
  hollow one (M10: 11 mm); a sleeve cut to the bore takes the bore's inside depth (§4.5);
- a splice stud needs its tap in both spliced ends (§3.4);
- a stock rail's holes start at its factory end's E and keep E_min at the cut end (§4.7);
- the cut list groups identical pieces, a piece and its end-for-end flip being the same, the
  canonical orientation being the one whose machining, then rail end distances, then end cuts
  compare first; machining compares by where it physically is, a hole by its distance from
  end a; it nests stock items first-fit decreasing, then each bar into the cheapest stock length
  that holds it, cheapest result winning; a factory-drilled rail piece keeps a stock end, with
  no trim there, and stays in the stock length it names (§5.3);
- the BOM counts every item and option, bars by pieces and total cut length, with mass from the
  published value, else area × density; a bar's mass by its centre-line length (§3.5, §5.4);
- the order list buys each BOM line on the regular price: supplier-cut pieces priced per metre
  on their billed length, whole stock bars per bar, other items by the project's choice (a kit,
  whose contents count against the other needs) or else the cheapest cover of packs; a line takes
  its offer's quoted range, else the most specific price band, rounded once half away from zero;
  cost lines cover machining and items; an open item, an estimated price and a missing offer
  block their suppliers, a price read more than 30 days before the order warns (§4.11, §5.4, §5.5);
- the project's own items (§4.8, M6): a plate's or a bent angle's mass is its net volume (the
  outline's area, or the developed length times the length, times the thickness, less what each
  hole removes) times its material's density; a bent angle's developed length is its two legs
  less the outside setback R + T each, plus the bend allowance (π / 2)(R + K T); a threaded hole
  is drilled at its tap drill, the major diameter less the pitch; each project item is one order
  line under its own supplier (a plate or an angle that names none is made locally), priced as
  entered; a placeholder blocks only its own line's group;
- the machining sheet lists each custom part's holes from its datum: a plate's outline origin, an
  angle's heel (and, on its flat blank, leg a's free edge); bars' machining stays on the cut list,
  which the sheet only points to;
- a butting end face that reaches past the face it bears on, both seen along the face's normal, is
  a `connection` warning that says how far and how much of it: the sheet and the order list carry
  derive's warnings (§4.5, §5.5, after acceptance run 4).

Run with python3 -I; then Biome formats expected-cutlist.json and expected-bom.json, while
expected-order.json and expected-machining.json are left exactly as written (they are compared
byte for byte).
"""

import datetime
import functools
import itertools
import json
import math
import os
import re
from fractions import Fraction

# The cart's dimensions (params) and sections.
W, D, H, HB = 1200, 600, 900, 100
T40 = 40  # TS40: 40 x 40
T80 = 80  # TS4080's long side; rolled 90° on the top rails, so the 80 lies flat
KERF, TRIM = 3, 5  # defaults.cutting

TS40 = ("test:TS40", {"finish": "anodised"})
TS4080 = ("test:TS4080", {"finish": "anodised"})
RHS = ("test-geo:RHS-100x50x4", {})
FB10 = ("test-geo:FB-50x10", {})
FB20 = ("test-geo:FB-50x20", {})
TUBE = ("test-geo:TUBE-18x2", {})
ROD = ("test:M10-ROD", {})
RAIL = ("test:RAIL20", {})

pieces = []


def piece(item, source, cut, ends=("square", "square"), centre=None, short=None, machining=(), rail=None):
    pieces.append(
        {
            "item": item[0],
            "opt": item[1],
            "source": source,
            "cut": cut,
            "centre": cut if centre is None else centre,
            "short": short,
            "angled": centre is not None,
            "ends": ends,
            "machining": list(machining),
            "rail": rail,
        }
    )


def q(v):
    """The 0.01 mm quantum, half away from zero."""
    return math.floor(abs(v) * 100 + 0.5) / 100 * (1 if v >= 0 else -1) + 0.0


def qkg(v):
    """The 0.001 kg quantum."""
    return math.floor(v * 1000 + 0.5) / 1000


# --- The frame --------------------------------------------------------------------------------
# Posts, 40 x 40, anchored into each corner: front-left x 0..40, y 0..40, and so on.
# Top rails (40x80 rolled 90°): 80 flat, front y 0..80, back y 520..600, z 860..900, full width.
# They run over the posts: the posts butt up into their underside, z = H - 40 = 860.
for b in ("b1", "b2", "b3", "b4"):
    piece(TS40, b, H - T40)

# The top rails' ends cover the corners: the farthest face of the bars butting into them is
# the outer face of the side rails, x = 0 and x = W, so they keep the full width.
for b in ("b5", "b6"):
    piece(TS4080, b, W)

# Side rails (x 0..40 and 1160..1200, z 860..900) butt between the top rails' inner faces,
# y = 80 and y = 520.
for b in ("b7", "b8"):
    piece(TS40, b, D - 2 * T80)

# Base rails at z = 100 (z 80..120), outer faces flush: between the posts' inner faces,
# x = 40 and x = W - 40.
for b in ("b9", "b10"):
    piece(TS40, b, W - 2 * T40)

# The middle rail is a run of two pieces spliced at x = 700 (no gap), each butting into a side
# rail's inner face: x = 40 and x = W - 40. The splice (SPL-40) is a stud in tapped cores: an M8
# tap, 20 deep, in each spliced end: b11's end b and b12's end a. Turned end for end, b11's tap is
# at its end a, which compares first, so both list the tap at end a.
TAP = {"op": "end-tap", "from": "a", "thread": "M8", "depth_mm": 20}
piece(TS40, "b11", 700 - T40, machining=[{**TAP, "from": "b"}])
piece(TS40, "b12", (W - T40) - 700, machining=[TAP])

# The hanger hangs 300 below the middle rail, counted from its cut (the rail's underside).
piece(TS40, "b13", 300)

# --- Braces between hinges ---------------------------------------------------------------------
# Front-left: a hinge on the post's inner face (x = 40, centred at y = 20) at z = 650, and one on
# the base rail's top face (z = 120, centred at y = 20) at x = 400. A hinge's pivot stands 15 off
# its face, and cuts the brace square 25 from it.
p1 = (40 + 15, 650)  # (x, z)
p2 = (400, 120 + 15)
between = math.hypot(p2[0] - p1[0], p2[1] - p1[1])  # 619.879…
brace = between - 2 * 25  # 569.879…
# The other three are mirror images (hinges at x = W - 40 - 15 and x = W - 400; y = 580 at the
# back), so the same length.
for b in ("b14", "b15", "b16", "b17"):
    piece(TS40, b, brace)

# --- The steel beam, its cover strip, and the bolted stack ------------------------------------
# The beam (RHS 100x50x4, 50 wide in x, 100 tall) runs across at x = 600 (x 575..625,
# z 50..150) between the base rails' inner faces, y = 40 and y = 560.
# A cover strip on its top, its ends flush with the beam's cut ends: the same length.
# The bolted stack, head to nut along +x: strap b20 (x 545..555), packer b21 (555..575), the beam
# (575..625), packer b22 (625..645), strap b23 (645..655); straps y 150..450, packers y 200..400,
# all 50 tall (z 75..125). Every layer touches the next: the grip is 10 + 20 + 50 + 20 + 10 = 110.
# Stations: 100 and 200 along the first strap from its end a (y = 250 and 350), each 15 either
# side across its face (u runs along the strap's local x, which its 90° roll turns to +z):
# z = 85 and 115. Four M10 rods, each a clearance hole of Ø11 (ISO 273, medium) in every layer.
# The straps and packers lie along +y rolled 90°: local x = +z, local y = +x, so the face the
# bolt enters by (normal -x) is -y, and u = z - 100. The beam lies along +y unrolled: local x = -x,
# local y = +z, so it enters by +x and leaves by -x, u = z - 100, and each wall (4 thick) gets its
# own hole, 4 deep. Positions count from each piece's end a: y - 150, y - 200 and y - 40 (the
# beam's cut). The layouts are symmetric, so turning a piece end for end lists them the same way.


def stack_holes(starts_at, faces, depth=None):
    out = []
    for y in (250, 350):
        for z in (85, 115):
            for face in faces:
                m = {"op": "hole", "face": face, "from": "a", "at_mm": y - starts_at, "across_mm": z - 100, "d_mm": 11}
                if depth is not None:
                    m["depth_mm"] = depth
                out.append(m)
    return out


piece(RHS, "b18", D - 2 * T40, machining=stack_holes(40, ("+x", "-x"), depth=4))
piece(FB10, "b19", D - 2 * T40)
piece(FB10, "b20", 450 - 150, machining=stack_holes(150, ("-y",)))
piece(FB20, "b21", 400 - 200, machining=stack_holes(200, ("-y",)))
piece(FB20, "b22", 400 - 200, machining=stack_holes(200, ("-y",)))
piece(FB10, "b23", 450 - 150, machining=stack_holes(150, ("-y",)))
# Each rod is cut 140 from M10 stock; each sleeve (tube 18x2) fills the beam's bore along the
# bolt: 50 - 2 × 4 = 42. A sleeve that only fills the bore passes no wall, so no hole widens.
for k in (1, 2, 3, 4):
    piece(ROD, f"c23.f{k}", 140)
    piece(TUBE, f"c23.s{k}", 50 - 2 * 4)
# Kick strips on the top rails' tops, from x = 40 to x = W - 40.
piece(FB10, "b24", (W - 40) - 40)
piece(FB10, "b25", (W - 40) - 40)

# --- Slats -----------------------------------------------------------------------------------
# A pattern every 150 from x = 150, seven stations, skipping the fourth (x = 600, the beam):
# copies 1, 2, 4, 5 and 6. Each slat butts between the base rails' inner faces.
for b in ("b26", "b26@1", "b26@2", "b26@4", "b26@5", "b26@6"):
    piece(TS40, b, D - 2 * T40)

# --- The linear rail run on the middle rail -------------------------------------------------
# RAIL20 (pitch 60, E 20 to 40) is sold in 500 and 1000 stock lengths; the 1000 is drilled with
# E 20 at both ends, the 500 states none (its centred layout, ((500 - 40) mod 60) / 2 + 20 = 40),
# so the two differ and each piece names its stock length, 1000. Two pieces of 470, x 130..600 and
# 600..1070, each with its factory end at the joint.
# b33, factory end b: holes 20, 80, …, 20 + 60k from b while 470 - (20 + 60k) ≥ 20: k ≤ 7, 8
# holes, the last 440 from b, so E 30 at end a. b34, factory end a: the mirror image, E 20 at a
# and 30 at b. Turned end for end, b33 is b34: one line, listed with E 20 at a (the smaller first).
piece(RAIL, "b33", 470, rail={"holes": 8, "pitch_mm": 60, "E_a_mm": 30, "E_b_mm": 20, "factory": "b", "stock_mm": 1000})
piece(RAIL, "b34", 470, rail={"holes": 8, "pitch_mm": 60, "E_a_mm": 20, "E_b_mm": 30, "factory": "a", "stock_mm": 1000})
# The rail is fixed with M5 screws into T-nuts in the middle rail's top groove, at every other hole
# plus the first, the last and the two beside the joint. The rail's own holes take the screws and
# the T-nuts sit in the groove, so nothing is drilled. Holes along the run from x = 130: b33's at
# x = 160, 220, …, 580 and b34's at x = 620, 680, …, 1040 (16 holes); every other from the first:
# 160, 280, 400, 520, 620, 740, 860, 980; plus the last (1040) and the joint's (580, 620): ten.
RAIL_STATIONS = [160, 280, 400, 520, 580, 620, 740, 860, 980, 1040]

# --- Angled ends: the bar's frame ----------------------------------------------------------------


def unit(v):
    n = math.sqrt(sum(c * c for c in v))
    return tuple(c / n for c in v)


def dot(u, v):
    return sum(p * q for p, q in zip(u, v))


def cross(u, v):
    return (u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0])


def frame(a, b):
    """§4.4 for a bar that is not vertical: t along it, y = +Z made perpendicular to t, x = y × t."""
    t = unit(tuple(q - p for p, q in zip(a, b)))
    y = unit(tuple(z - t[2] * c for z, c in zip((0, 0, 1), t)))
    return t, cross(y, t), y


def r2(v):
    return round(v + 0.0, 2)


def angled(normal, outward, x, y):
    """An angled end (§4.5): the angle between the plane's normal and the axis, the mitre
    atan2(n · x, n · e) and the bevel asin(n · y), e the end's outward axis."""
    return {
        "angle_deg": r2(math.degrees(math.acos(dot(normal, outward)))),
        "mitre_deg": r2(math.degrees(math.atan2(dot(normal, x), dot(normal, outward)))),
        "bevel_deg": r2(math.degrees(math.asin(dot(normal, y)))),
    }


# --- Knee braces at the top corners -----------------------------------------------------------
# Front-left: from 200 along the front rail to 200 along the left rail, in plan the line
# x + y = 200, its top flush with the rails (z 860..900). It meets the front rail's inner face
# y = 80 at x = 120, and the left rail's inner face x = 40 at y = 160.
centre = math.hypot(120 - 40, 160 - 80)  # 80·√2 = 113.137…
# Both faces are at 45° to the brace, and the cuts close toward the corner (a trapezoid in plan):
# each long point is 20·tan 45° beyond the centre line, each short point 20·tan 45° short of it.
half = T40 / 2 * math.tan(math.radians(45))

# Design points, and the outward normal of each end: away from the brace, into the rail.
corners = {
    "b27": ((200, 0, H), (0, 200, H), (0, -1, 0), (-1, 0, 0)),  # front rail, left rail
    "b28": ((W - 200, 0, H), (W, 200, H), (0, -1, 0), (1, 0, 0)),  # front rail, right rail
    "b29": ((200, D, H), (0, D - 200, H), (0, 1, 0), (-1, 0, 0)),  # back rail, left rail
    "b30": ((W - 200, D, H), (W, D - 200, H), (0, 1, 0), (1, 0, 0)),  # back rail, right rail
}
for b, (pa, pb, na, nb) in corners.items():
    t, x, y = frame(pa, pb)
    ends = (angled(na, tuple(-c for c in t), x, y), angled(nb, t, x, y))
    piece(TS40, b, centre + 2 * half, ends, centre, centre - 2 * half)

# --- The push handle --------------------------------------------------------------------------
# An arm off the right front post's outer face (x = W) at z = 800, 150 long, its end b square at
# its design point x = W + 150.
piece(TS40, "b31", 150)
# The grip runs at 45° from (W + 350, 20, 600) up to the arm's end. It bears on that end through
# an 8 mm end plate: the arm's end face x = W + 150 moved 8 along its own normal, x = W + 158.
# The centre line covers 350 − 158 = 192 in x, so 192·√2 along the grip. Its end b is cut at 45°:
# its long point is 20·tan 45° beyond the centre line, its short point as far short of it. End a
# is left square at its design point.
pa, pb = (W + 350, 20, 600), (W + 150, 20, 800)
t, x, y = frame(pa, pb)
centre = (350 - 158) * math.sqrt(2)
ends = ("square", angled((-1, 0, 0), t, x, y))  # the plane's normal, out of the grip's end b
piece(TS40, "b32", centre + half, ends, centre, centre - half)

# --- Butt seats (§4.5, after acceptance run 4) ---------------------------------------------------
# A butting end face that reaches past the face it bears on is a `connection` warning: the
# greatest distance of its outline past the face, and the area of it that bears on nothing, both
# seen along the face's normal. Three of the cart's butts do; every other end face lies on its
# face, and none goes into the bar it bears on.
# - The beam's ends (c21, c22) on the base rails' inner faces (b9's +x, which its local x turns to
#   +y; b10's -x, to -y): the RHS's end face is 50 wide in x and 100 tall, z 50..150, its corners
#   rounded to the outer radius 6; a rail's face is 40 tall, z 80..120, and runs past the beam on
#   both sides. The end face reaches 30 past it above and below; of its 50·100 − (4 − π)·6² mm²,
#   the 50 x 40 on the face bear and the rest does not.
# - The grip's end b (c33) on the arm's end, through the 8 mm end plate (as big as the arm's end):
#   its centre line meets the plate's face, x = W + 158, at z = 600 + 192 = 792. Its end, cut at
#   45°, is 40 wide in y and 40·√2 tall, z 792 ∓ 20·√2, on the arm's end, z 780..820, y 0..40:
#   it reaches 780 − (792 − 20·√2) past it, and all of it but the 40 x 40 bears on nothing.


def overhang(conn, end, refs, on, by, area, bearing):
    outside = area - bearing
    pct = 100 * outside / area
    message = (
        f"{end}'s end face overhangs {on} by {by:.2f} mm: {outside:.2f} of its {area:.2f} mm² "
        f"({pct:.1f} %) bear on nothing"
    )
    return {"severity": "warn", "code": "connection", "entity": conn, "refs": refs, "message": message}


beam_end = 50 * 100 - (4 - math.pi) * 6**2
grip_end = T40 * T40 * math.sqrt(2)
SEATS = [
    overhang("c21", "b18.a", ["b18", "b9"], "b9's face +x", (100 - T40) / 2, beam_end, 50 * T40),
    overhang("c22", "b18.b", ["b18", "b10"], "b10's face -x", (100 - T40) / 2, beam_end, 50 * T40),
    overhang("c33", "b32.b", ["b32", "b31"], "b31's end b", 780 - (792 - 20 * math.sqrt(2)), grip_end, T40 * T40),
]

# --- Id order, the canonical orientation and grouping ---------------------------------------


def cmp_ids(a, b):
    """§2's id order: runs of digits by value, everything else by code point."""
    ca, cb = re.findall(r"\d+|\D+", a), re.findall(r"\d+|\D+", b)
    for x_, y_ in zip(ca, cb):
        if x_.isdigit() and y_.isdigit():
            c = (int(x_) > int(y_)) - (int(x_) < int(y_))
        else:
            c = (x_ > y_) - (x_ < y_)
        if c:
            return c
    return (len(ca) > len(cb)) - (len(ca) < len(cb)) or (a > b) - (a < b)


id_key = functools.cmp_to_key(cmp_ids)


def physical(m, span):
    """Where a piece of machining is, whichever end names it: a tap by its end, a hole by its
    distance from end a; a plain through hole by its axis, not by the face it is named from."""
    if m["op"] == "end-tap":
        return (0, m["from"], m["thread"], m.get("depth_mm", -1))
    pos = m["at_mm"] if m["from"] == "a" else q(span - m["at_mm"])
    plain = "depth_mm" not in m
    face = "+" + m["face"][1] if plain else m["face"]
    return (1, pos, face, m.get("across_mm", 0), m.get("d_mm", -1), m.get("thread", ""), m.get("depth_mm", -1))


def end_key(e):
    return (0,) if e == "square" else (1, e["mitre_deg"], e["bevel_deg"], e["angle_deg"])


def rail_key(r):
    return () if r is None else (r["holes"], r["pitch_mm"], r["E_a_mm"], r["E_b_mm"], r.get("stock_mm", -1))


def orientation_key(p):
    return (
        sorted(physical(m, q(p["cut"])) for m in p["machining"]),
        rail_key(p["rail"]),
        end_key(p["ends"][0]),
        end_key(p["ends"][1]),
    )


def flip(p):
    """End for end: t and x reverse, y stays. Ends swap, a mitre changes sign; a hole's end swaps,
    a ±x face becomes the other, and an offset across a ±y face changes sign; E swaps."""
    other = {"a": "b", "b": "a"}
    fe = lambda e: e if e == "square" else {**e, "mitre_deg": r2(-e["mitre_deg"])}  # noqa: E731
    ms = []
    for m in p["machining"]:
        m = {**m, "from": other[m["from"]]}
        if m["op"] == "hole":
            m["face"] = {"+x": "-x", "-x": "+x"}.get(m["face"], m["face"])
            if m["face"] in ("+y", "-y") and "across_mm" in m:
                m["across_mm"] = -m["across_mm"]
        ms.append(m)
    rail = p["rail"]
    if rail is not None:
        rail = {**rail, "E_a_mm": rail["E_b_mm"], "E_b_mm": rail["E_a_mm"], "factory": other[rail["factory"]]}
    return {**p, "ends": (fe(p["ends"][1]), fe(p["ends"][0])), "machining": ms, "rail": rail}


def canonical(p):
    f = flip(p)
    return f if orientation_key(f) < orientation_key(p) else p


def listed(m):
    """Machining as listed: from end a first; at each end its tap, then holes by position, face,
    offset across and size."""
    if m["op"] == "end-tap":
        return (m["from"], 0, m["thread"], m.get("depth_mm", -1))
    return (m["from"], 1, m["at_mm"], m["face"], m.get("across_mm", 0), m["d_mm"], "", m.get("depth_mm", -1))


# --- Nesting ----------------------------------------------------------------------------------

# Offers (tests/fixtures/catalogs): TS40 and TS4080 are cut by the supplier (res 1, step 10);
# the rest is sold in stock lengths, priced per bar on the regular basis.
CUT = {"test:TS40": "test:TS40-c7", "test:TS4080": "test:TS4080-c7"}
STOCK = {
    "test-geo:RHS-100x50x4": [("test-geo:RHS-100x50x4-6000", 6000, 28900)],
    "test-geo:FB-50x10": [("test-geo:FB-50x10-3000", 3000, 4000), ("test-geo:FB-50x10-6000", 6000, 7000)],
    "test-geo:FB-50x20": [("test-geo:FB-50x20-6000", 6000, 13500)],
    "test-geo:TUBE-18x2": [("test-geo:TUBE-18x2-6000", 6000, 5200)],
    "test:M10-ROD": [("test:M10-ROD-1000", 1000, 1250)],
    "test:RAIL20": [("test:RAIL20-500", 500, 9800), ("test:RAIL20-1000", 1000, 17900)],
}


def used(ps):
    """A trim at each stock end that no factory end takes, the pieces, a kerf between each."""
    f = sum(1 for p in ps if p["factory"])
    return (2 - f) * TRIM + sum(p["cut"] for p in ps) + (len(ps) - 1) * KERF


def holds(length, ps):
    return sum(1 for p in ps if p["factory"]) <= 2 and used(ps) <= length


def nest(ps, stocks):
    """First-fit decreasing per stock length, each bar then into the cheapest length that holds
    it (a bar holding a piece that names its length keeps it); the cheapest result wins."""
    order = sorted(ps, key=lambda p: (-p["cut"], id_key(p["source"])))
    best = None
    for _, length, _ in sorted(stocks, key=lambda s: s[1]):
        if any(p["stock"] is None and not holds(length, [p]) for p in ps):
            continue
        bars = []
        for p in order:
            for bar in bars:
                if (p["stock"] is None or bar["stock"][1] == p["stock"]) and holds(bar["stock"][1], bar["pieces"] + [p]):
                    bar["pieces"].append(p)
                    bar["pinned"] = bar["pinned"] or p["stock"] is not None
                    break
            else:
                own = next(s for s in stocks if s[1] == p["stock"]) if p["stock"] else next(s for s in stocks if s[1] == length)
                bars.append({"stock": own, "pieces": [p], "pinned": p["stock"] is not None})
        for bar in bars:
            if not bar["pinned"]:
                fits = [s for s in stocks if holds(s[1], bar["pieces"])]
                bar["stock"] = min(fits, key=lambda s: (s[2], s[1]))
        cost = sum(b["stock"][2] for b in bars)
        if best is None or cost < best[0]:
            best = (cost, bars)
    return best


def laid_out(ps):
    """A factory piece at the start of the bar, the others, a second factory piece at the end."""
    f = [p for p in ps if p["factory"]]
    rest = [p for p in ps if not p["factory"]]
    out = []
    if f:
        out.append((f[0]["source"], "start"))
    out += [(p["source"], None) for p in rest]
    if len(f) > 1:
        out.append((f[1]["source"], "end"))
    return out


# --- The cut list ----------------------------------------------------------------------------

groups = []
items = sorted({(p["item"], json.dumps(p["opt"], sort_keys=True)) for p in pieces}, key=lambda k: (id_key(k[0]), k[1]))
for item, opt_text in items:
    ps = [canonical(p) for p in pieces if p["item"] == item and json.dumps(p["opt"], sort_keys=True) == opt_text]
    lines = {}
    for p in ps:
        key = json.dumps(
            [q(p["cut"]), p["ends"], sorted(physical(m, q(p["cut"])) for m in p["machining"]), rail_key(p["rail"])]
        )
        lines.setdefault(key, []).append(p)
    out_lines = []
    for members in lines.values():
        p = members[0]
        line = {"count": len(members), "cut_mm": q(p["cut"])}
        if p["angled"]:
            line["centre_mm"] = q(p["centre"])
            line["short_mm"] = q(p["short"])
        line["ends"] = {"a": p["ends"][0], "b": p["ends"][1]}
        ms = sorted(p["machining"], key=listed)
        if ms:
            line["machining"] = ms
        if p["rail"] is not None:
            line["rail"] = p["rail"]
        if item in CUT:
            ordered = math.floor(line["cut_mm"] + 0.5)  # res_mm 1, half away from zero
            line["ordered_mm"] = ordered
            line["billed_mm"] = math.ceil(ordered / 10) * 10  # step_mm 10
        line["sources"] = sorted((m["source"] for m in members), key=id_key)
        out_lines.append(line)
    out_lines.sort(
        key=lambda l: (
            -l["cut_mm"],
            [listed(m) for m in l.get("machining", [])],
            rail_key(l.get("rail")),
            end_key(l["ends"]["a"]),
            end_key(l["ends"]["b"]),
            id_key(l["sources"][0]),
        )
    )
    group = {"item": item, "opt": json.loads(opt_text)}
    if item in CUT:
        group["mode"] = "cut"
        group["offer"] = CUT[item]
    else:
        group["mode"] = "stock"
    group["lines"] = out_lines
    if item in STOCK:
        nest_in = [
            {
                "source": p["source"],
                "cut": q(p["cut"]),
                "factory": p["rail"] is not None and "factory" in p["rail"],
                "stock": None if p["rail"] is None else p["rail"].get("stock_mm"),
            }
            for p in ps
        ]
        cost, bars = nest(nest_in, STOCK[item])
        group["stock"] = []
        for b in bars:
            layout = laid_out(b["pieces"])
            entry = {
                "sku": b["stock"][0],
                "length_mm": b["stock"][1],
                "sources": [s for s, _ in layout],
                "offcut_mm": q(b["stock"][1] - used(b["pieces"])),
                "waste_mm": q(b["stock"][1] - sum(p["cut"] for p in b["pieces"])),
            }
            ends = {s: e for s, e in layout if e is not None}
            if ends:
                entry["factory_ends"] = ends
            group["stock"].append(entry)
        group["cost_minor"] = cost
    groups.append(group)

# --- The bill of materials ---------------------------------------------------------------------
# Masses (tests/fixtures/catalogs): published masses, tagged with their catalog's provenance
# (all three synthetic catalogs: est); otherwise the section's area times the material's density
# (calc), steel 7850 kg/m³: the flats 50 × 10 and 50 × 20, the tube π/4 (18² - 14²) = 32π, the
# rod's published (stress) area 58, and the RHS 100x50x4 with outer radius 6 and inner radius
# 6 - 4 = 2: 50 × 100 - (4 - π) 6² - (42 × 92 - (4 - π) 2²).
STEEL = 7850


def per_m(area_mm2):
    return area_mm2 * STEEL / 1e6


RHS_AREA = 50 * 100 - (4 - math.pi) * 36 - (42 * 92 - (4 - math.pi) * 4)
BAR_MASS = {
    "test-geo:FB-50x10": (per_m(50 * 10), "calc"),
    "test-geo:FB-50x20": (per_m(50 * 20), "calc"),
    "test-geo:RHS-100x50x4": (per_m(RHS_AREA), "calc"),
    "test-geo:TUBE-18x2": (per_m(32 * math.pi), "calc"),
    "test:M10-ROD": (per_m(58), "calc"),
    "test:RAIL20": (2.21, "est"),
    "test:TS40": (1.493, "est"),
    "test:TS4080": (2.743, "est"),
}
# Everything else counted, from the connections and parts:
# - eight hinges (c13 … c20), one end plate (c33), one splice (c9) and its stud;
# - per rod of the bolted stack (four): a nut and a washer each side, so 8 nuts and 8 washers;
# - per rail station (ten): an M5 screw and a T-nut;
# - three carriages (p1 and its two copies), and ten spare T-nuts (p2, unplaced).
UNITS = [
    ("connector", "test-geo:HNG-15", 8, 0.1, ["c13", "c14", "c15", "c16", "c17", "c18", "c19", "c20"]),
    ("connector", "test-geo:PLT-8", 1, 0.1, ["c33"]),
    ("connector", "test:SPL-40", 1, 0.05, ["c9"]),
    ("fastener", "test-gen:SCR-M5x25", len(RAIL_STATIONS), 0.006, ["c35"]),
    ("fastener", "test-gen:TNUT-M5", len(RAIL_STATIONS), 0.004, ["c35"]),
    ("fastener", "test-geo:NUT-M10", 4 * 2, 0.011, ["c23"]),
    ("fastener", "test-geo:WSH-M10", 4 * 2, 0.004, ["c23"]),
    ("fastener", "test:SPL-STUD", 1, 0.015, ["c9"]),
    ("fastener", "test:TNUT-M8", 10, 0.006, ["p2"]),
    ("carriage", "test:CAR20", 3, 0.4, ["p1", "p1@1", "p1@2"]),
    # Unplaced lines for the order: shelf brackets, their screws and a work light's supply.
    ("connector", "test:BRK-40", 12, 0.15, ["p3"]),
    ("fastener", "test:SCR-M8x16", 77, 0.012, ["p4"]),
    ("generic", "test:PSU-24V", 1, 0.5, ["p5"]),
]
UNPLACED = {
    "test:TNUT-M8": [{"part": "p2", "qty": 10, "why": "spares for light fixings"}],
    "test:BRK-40": [{"part": "p3", "qty": 12, "why": "brackets for a shelf fitted later"}],
    "test:SCR-M8x16": [{"part": "p4", "qty": 77, "why": "screws for the shelf brackets and a tool rail"}],
    "test:PSU-24V": [{"part": "p5", "qty": 1, "why": "power supply for a work light"}],
}

bom_groups = []
bar_lines = []
for item, opt_text in items:
    ps = [p for p in pieces if p["item"] == item and json.dumps(p["opt"], sort_keys=True) == opt_text]
    kg_per_m, src = BAR_MASS[item]
    bar_lines.append(
        {
            "item": item,
            "opt": json.loads(opt_text),
            "qty": len(ps),
            "length_mm": q(sum(q(p["cut"]) for p in ps)),
            "unit_mass_kg": qkg(kg_per_m),
            "mass_kg": qkg(sum(p["centre"] for p in ps) * kg_per_m / 1000),
            "mass_src": src,
            "sources": sorted({re.sub(r"\.[fs]\d+$", "", p["source"]) for p in ps}, key=id_key),
        }
    )
bom_groups.append({"kind": "bar", "lines": bar_lines})
for kind in ("connector", "fastener", "carriage", "generic"):
    lines = []
    for k, item, qty, each, sources in UNITS:
        if k != kind:
            continue
        line = {
            "item": item,
            "opt": {},
            "qty": qty,
            "unit_mass_kg": each,
            "mass_kg": qkg(qty * each),
            "mass_src": "est",
            "sources": sources,
        }
        if item in UNPLACED:
            line["unplaced"] = UNPLACED[item]
        lines.append(line)
    lines.sort(key=lambda l: id_key(l["item"]))
    bom_groups.append({"kind": kind, "lines": lines})

# --- The project's own items (§4.8) ---------------------------------------------------------------
# Densities from tests/fixtures/catalogs/test: steel S235 7850 kg/m³, aluminium 6063-T5 2700.
# A volume in mm³ times a density in kg/m³ is 1e-9 kg.


def disc(d):
    return math.pi * d * d / 4


# The motor plate (p6): 8 mm steel, a 160 x 100 rectangle with a 30 x 30 corner cut off at
# (0, 100), so 160 × 100 − 30 × 30 / 2 = 15 550 mm². Its holes, each through the 8:
# - h1, M6: tapped, drilled at 6 − 1 = 5 (the coarse pitch of M6 is 1);
# - h2, Ø6.6 with a 90° countersink to Ø12.4 on its front: the cone is (12.4 − 6.6) / 2 / tan 45°
#   = 2.9 deep, and removes its frustum less the drill's cylinder over that depth;
# - h3, Ø6.6 with a counterbore Ø11 × 4: the ring (Ø11 less Ø6.6) over 4;
# - h4, Ø8.5.
PLATE_T = 8
PLATE_OUTLINE = [(0, 0), (160, 0), (160, 100), (30, 100), (0, 70)]
PLATE_AREA = 160 * 100 - 30 * 30 / 2
CSK_DEPTH = (12.4 - 6.6) / 2 / math.tan(math.radians(45))
plate_removed = (
    disc(6 - 1) * PLATE_T
    + disc(6.6) * PLATE_T
    + math.pi * CSK_DEPTH * (12.4**2 + 12.4 * 6.6 + 6.6**2) / 12
    - disc(6.6) * CSK_DEPTH
    + disc(6.6) * PLATE_T
    + (disc(11) - disc(6.6)) * 4
    + disc(8.5) * PLATE_T
)
PLATE_MASS = (PLATE_AREA * PLATE_T - plate_removed) * 7850 / 1e9

# The sensor bracket (p7): 3 mm aluminium bent once through 90°, legs 40 (a) and 30 (b) each to
# the outside of the other, 50 long, inside radius 3, K-factor 0.4. Each flat is its leg less the
# outside setback R + T = 6; the bend's neutral fibre runs R + K T = 4.2 from its centre, a quarter
# circle of (π / 2) × 4.2. Leg a has a Ø5.5 hole, leg b an M4 tapped one (drilled 4 − 0.7 = 3.3).
ANGLE_T, ANGLE_L, ANGLE_R, ANGLE_K = 3, 50, 3, 0.4
LEG_A, LEG_B = 40, 30
BEND_ALLOWANCE = math.pi / 2 * (ANGLE_R + ANGLE_K * ANGLE_T)
DEVELOPED = (LEG_A - (ANGLE_R + ANGLE_T)) + (LEG_B - (ANGLE_R + ANGLE_T)) + BEND_ALLOWANCE
ANGLE_MASS = (DEVELOPED * ANGLE_L * ANGLE_T - disc(5.5) * ANGLE_T - disc(4 - 0.7) * ANGLE_T) * 2700 / 1e9

# The gear motor (p8): a placeholder with an estimated mass, as entered.
MOTOR_MASS = 2.8

PROJECT_ITEMS = [
    # kind, item, name, mass, its provenance, the part that uses it
    ("plate", "project:plate-a", "Motor plate", PLATE_MASS, "calc", "p6"),
    ("bent-angle", "project:angle-a", "Sensor bracket", ANGLE_MASS, "calc", "p7"),
    ("placeholder", "project:motor", "Gear motor, model to be chosen", MOTOR_MASS, "est", "p8"),
]
for kind, item, _, mass, src, part in PROJECT_ITEMS:
    line = {"item": item, "opt": {}, "qty": 1, "unit_mass_kg": qkg(mass), "mass_kg": qkg(mass), "mass_src": src, "sources": [part]}
    bom_groups.append({"kind": kind, "lines": [line]})

for g in bom_groups:
    g["mass_kg"] = qkg(sum(l["mass_kg"] for l in g["lines"]))
bom = {
    "about": "The cart's bill of materials worked by hand: see hand/cart_by_hand.py, which wrote this.",
    "groups": bom_groups,
    "mass_kg": qkg(sum(g["mass_kg"] for g in bom_groups)),
    # The custom parts' masses before the output quantum, and the angle's developed length.
    "unrounded": {
        "project:plate-a": {"mass_kg": PLATE_MASS},
        "project:angle-a": {"developed_mm": DEVELOPED, "mass_kg": ANGLE_MASS},
    },
}

# --- The order list (§5.4, §5.5) and the costs (§4.11) ------------------------------------------
# Every amount is an integer of minor units (centavos), rounded once where it is made, half away
# from zero; rounding here works on exact fractions, so no float decides a half.

AS_OF = "2026-11-26"  # the order's date, which the cart test passes too


def half_away(x):
    """An exact rational rounded to an integer, half away from zero."""
    x = Fraction(x)
    n = math.floor(abs(x) + Fraction(1, 2))
    return n if x >= 0 else -n


def per_metre(price_per_m, length_mm):
    return half_away(Fraction(price_per_m) * Fraction(length_mm) / 1000)


def band(likely, pct):
    """A price band on a line's likely minor units, rounded once (G26)."""
    return half_away(Fraction(likely) * (100 + Fraction(pct)) / 100)


# The project's price bands, in its order: the first two for the profile supplier, the third for
# the steel stockist. A line takes the most specific: supplier with kind before supplier alone.
BANDS = [("test-vendor", "bar", -5, 15), ("test-vendor", None, -8, 12), ("test-steel", None, -10, 25)]


def band_for(supplier, kind):
    hits = [(i, 2 if k is not None else 1) for i, (s, k, _, _) in enumerate(BANDS) if s == supplier and k in (None, kind)]
    if not hits:
        return None
    top = max(r for _, r in hits)
    best = [i for i, r in hits if r == top]
    assert len(best) == 1, "two equally specific bands"
    return best[0]


# Names, kinds and offers, read off tests/fixtures/catalogs/*: who sells what, in packs or kits,
# at which regular price (the cart's basis), read when, and with what provenance.
NAMES = {
    "test:TS40": "Profile 40x40 (parametric)",
    "test:TS4080": "Profile 40x80 (parametric)",
    "test:M10-ROD": "Threaded rod M10",
    "test:RAIL20": "Linear rail 20",
    "test-geo:RHS-100x50x4": "RHS 100x50x4",
    "test-geo:FB-50x10": "Flat bar 50x10",
    "test-geo:FB-50x20": "Flat bar 50x20",
    "test-geo:TUBE-18x2": "Tube 18x2",
    "test-geo:HNG-15": "Hinge 40, low",
    "test-geo:PLT-8": "End plate 8 mm",
    "test-geo:NUT-M10": "Hex nut M10",
    "test-geo:WSH-M10": "Washer M10",
    "test:SPL-40": "Splice for 40 series",
    "test:SPL-STUD": "Splice stud M8x40",
    "test:TNUT-M8": "T-nut M8, groove 8",
    "test:SCR-M8x16": "Socket head cap screw M8x16",
    "test:BRK-40": "Angle bracket 40",
    "test:CAR20": "Carriage 20, flanged",
    "test:PSU-24V": "Power supply 24 V",
    "test-gen:SCR-M5x25": "Socket head cap screw M5x25",
    "test-gen:TNUT-M5": "T-nut M5, groove 8",
}
# The steel stockist sells test-geo's bars; everything else comes from its catalog's vendor.
SUPPLIER = {"test:": "test-vendor", "test-geo:": "test-geo-vendor", "test-gen:": "test-gen-vendor"}
STEEL = {"test-geo:RHS-100x50x4", "test-geo:FB-50x10", "test-geo:FB-50x20", "test-geo:TUBE-18x2"}


def supplier_of(item):
    if item in STEEL:
        return "test-steel"
    return SUPPLIER[item[: item.index(":") + 1]]


# Unit offers: (offer, SKU, units per offer, regular price, quoted (low, high) or None, src,
# read, in stock, kit contents per kit or None).
READ = "2026-11-26"
UNIT_OFFERS = {
    "test-geo:HNG-15": [("test-geo:HNG-15", "HNG-15", 1, 3400, None, "src", READ, None, None)],
    "test-geo:PLT-8": [("test-geo:PLT-8", "PLT-8", 1, 900, None, "src", READ, None, None)],
    "test-geo:NUT-M10": [("test-geo:NUT-M10-100", "NUT-M10-100", 100, 2600, None, "src", "2026-10-01", None, None)],
    "test-geo:WSH-M10": [("test-geo:WSH-M10-100", "WSH-M10-100", 100, 1800, None, "src", READ, None, None)],
    "test-gen:SCR-M5x25": [("test-gen:SCR-M5x25-100", "SCR-M5x25-100", 100, 1500, None, "src", READ, None, None)],
    "test-gen:TNUT-M5": [("test-gen:TNUT-M5-50", "TNUT-M5-50", 50, 2500, None, "src", READ, None, None)],
    "test:SPL-40": [("test:SPL-40", "SPL-40", 1, 2400, None, "src", READ, None, None)],
    "test:SPL-STUD": [],  # the catalog sells no stud on its own
    "test:TNUT-M8": [
        ("test:TNUT-M8-10", "TNUT-M8-10", 10, 900, None, "src", READ, None, None),
        ("test:TNUT-M8-50", "TNUT-M8-50", 50, 3900, None, "src", READ, False, None),
    ],
    "test:SCR-M8x16": [
        ("test:SCR-M8x16-10", "SCR-M8x16-10", 10, 650, None, "src", READ, None, None),
        ("test:SCR-M8x16-50", "SCR-M8x16-50", 50, 2700, None, "src", READ, None, None),
    ],
    "test:BRK-40": [
        ("test:BRK-40", "BRK-40", 1, 890, None, "src", READ, None, None),
        (
            "test:BRK-40-K10",
            "BRK-40-K10",
            1,
            12900,
            None,
            "src",
            READ,
            None,
            [("test:BRK-40", 10), ("test:SCR-M8x16", 20), ("test:TNUT-M8", 20)],
        ),
    ],
    # A quoted range: R$ 102.13, from 95.00 to 110.00.
    "test:CAR20": [("test:CAR20-1", "CAR20-1", 1, 10213, (9500, 11000), "src", READ, None, None)],
    # A price by phone: an estimate, which blocks its supplier by default (call 13).
    "test:PSU-24V": [("test:PSU-24V", "PSU-24V", 1, 9900, None, "est", READ, None, None)],
}
CUT_PRICE = {"test:TS40-c7": 12650, "test:TS4080-c7": 23100}  # per metre
STOCK_SUPPLIER = {sku: supplier_of(item) for item, offers in STOCK.items() for sku, _, _ in offers}

# The project's cost lines, its choice of the bracket kit, and its one open item.
CHOSEN = {"test:BRK-40": "test:BRK-40-K10"}
COSTS = [
    {"id": "K1", "label": "assembly", "kind": "labour", "low_minor": 40000, "likely_minor": 60000, "high_minor": 90000, "src": "est"},
    {
        "id": "K2",
        "label": "taps and angled cuts at the profile supplier",
        "kind": "machining",
        "supplier": "test-vendor",
        "low_minor": 6000,
        "likely_minor": 8000,
        "high_minor": 12000,
        "src": "est",
        "covers": {"supplier": "test-vendor", "services": True},
    },
    {
        "id": "K3",
        "label": "packers cut from the fabricator's stock, and the steel stack drilled",
        "kind": "fabrication",
        "supplier": "test-fab",
        "low_minor": 15000,
        "likely_minor": 15000,
        "high_minor": 15000,
        "src": "src",
        "ref": "a written quote, synthetic",
        "covers": {"services_on": {"supplier": "test-steel"}, "items": ["test-geo:FB-50x20"]},
    },
    {
        "id": "K4",
        "label": "freight, quoted in dollars",
        "kind": "freight",
        "low_minor": 2000,
        "likely_minor": 3000,
        "high_minor": 4500,
        "currency": "USD",
        "src": "est",
    },
]
USD = Fraction("5.5")  # fx.USD, reais per dollar
CONTINGENCY_PCT = 10  # K5: 10 % of each of the low, likely and high subtotals
COVERED_ITEMS = {"test-geo:FB-50x20": "K3"}
O1 = "O1: confirm the rail screws' length against the rail's counterbore"


def service_name(m):
    """What a service does, not where: a tap in an end, a hole of a size."""
    if m["op"] == "end-tap":
        return f"tap {m['thread']} in an end" + (f", {m['depth_mm']:.2f} deep" if "depth_mm" in m else "")
    return f"hole Ø{m['d_mm']:.2f}" + (f", {m['depth_mm']:.2f} deep" if "depth_mm" in m else "")


def piece_services(line):
    names = [service_name(m) for m in line.get("machining", [])]
    names += ["angled cut" for e in (line["ends"]["a"], line["ends"]["b"]) if e != "square"]
    return names


def count_services(names, by, covered_by):
    out = []
    for what in sorted(set(names)):
        s = {"what": what, "count": names.count(what), "by": by}
        if covered_by is not None:
            s["covered_by"] = covered_by
        out.append(s)
    return out


def pieces_of(lines):
    return [{"count": l["count"], "cut_mm": l["cut_mm"], "sources": l["sources"]} for l in lines]


KIND = {"test:TS40": "bar"}
for g in bom_groups:
    for l in g["lines"]:
        KIND[l["item"]] = g["kind"]

order_lines = []  # (supplier, line, money or None, sources, missing)


def priced_line(base, supplier, offer, money, quoted, src, read, sources):
    """Fills a priced line's money: its own range, else its band, else low = likely = high."""
    low, likely, high = money
    line = dict(base)
    line["currency"] = "BRL"
    line["low_minor"], line["likely_minor"], line["high_minor"] = low, likely, high
    if quoted:
        line["range"] = "quote"
    else:
        b = band_for(supplier, base["kind"])
        if b is not None:
            _, _, lo, hi = BANDS[b]
            line["low_minor"], line["high_minor"] = band(likely, lo), band(likely, hi)
            line["range"] = "band"
            line["band"] = b
    line["price_src"] = src
    line["read"] = read
    order_lines.append({"supplier": supplier, "line": line, "offer": offer, "sources": set(sources)})


# Bars, as the cut list sells them.
for g in groups:
    item = g["item"]
    head = {"item": item, "name": NAMES[item], "kind": "bar", "opt": g["opt"]}
    if item in COVERED_ITEMS:
        k = COVERED_ITEMS[item]
        names = [n for l in g["lines"] for _ in range(l["count"]) for n in piece_services(l)]
        line = {
            **head,
            "qty": sum(l["count"] for l in g["lines"]),
            "unit": "piece",
            "covered_by": k,
            "bom": [{"item": item, "opt": g["opt"], "qty": sum(l["count"] for l in g["lines"])}],
            "pieces": pieces_of(g["lines"]),
            "services": count_services(names, "supplier", k),
        }
        order_lines.append({"supplier": "test-fab", "line": line, "offer": None, "sources": {s for l in g["lines"] for s in l["sources"]}})
        continue
    if g["mode"] == "cut":
        offer = g["offer"]
        for l in g["lines"]:
            piece = per_metre(CUT_PRICE[offer], l["billed_mm"])
            names = [n for _ in range(l["count"]) for n in piece_services(l)]
            base = {
                **head,
                "offer": offer,
                "sku": offer.split(":")[1],
                "qty": l["count"],
                "unit": "piece",
                "length_mm": l["ordered_mm"],
                "billed_mm": l["billed_mm"],
                "per": "m",
                "list_minor": CUT_PRICE[offer],
                "unit_price_minor": piece,
            }
            priced_line(base, "test-vendor", offer, (piece * l["count"],) * 3, False, "src", READ, l["sources"])
            last = order_lines[-1]["line"]
            last["bom"] = [{"item": item, "opt": g["opt"], "qty": l["count"]}]
            last["pieces"] = pieces_of([l])
            if names:
                # The supplier's taps and angled cuts, which K2 covers.
                last["services"] = count_services(names, "supplier", "K2")
        continue
    # Whole bars: one SKU each in the cart, every piece in it.
    for sku, length, price in STOCK[item]:
        bars = [b for b in g["stock"] if b["sku"] == sku]
        if not bars:
            continue
        inside = [s for b in bars for s in b["sources"]]
        names = [n for l in g["lines"] for s in l["sources"] if s in inside for n in piece_services(l)]
        base = {
            **head,
            "offer": sku,
            "sku": sku.split(":")[1],
            "qty": len(bars),
            "unit": "bar",
            "length_mm": length,
            "per": "bar",
            "list_minor": price,
            "unit_price_minor": price,
        }
        supplier = STOCK_SUPPLIER[sku]
        priced_line(base, supplier, sku, (price * len(bars),) * 3, False, "src", READ, {re.sub(r"\.[fs]\d+$", "", s) for s in inside})
        last = order_lines[-1]["line"]
        last["bom"] = [{"item": item, "opt": g["opt"], "qty": len(inside)}]
        last["pieces"] = pieces_of([l for l in g["lines"] if any(s in inside for s in l["sources"])])
        if names:
            # Holes in the stockist's whole bars, done by the fabricator: K3 covers them.
            last["services"] = count_services(names, "buyer", "K3" if supplier == "test-steel" else None)

# Everything else: what each BOM line still needs once the chosen kit has given its contents.
need = {}
sources_of = {}
for g in bom_groups:
    if g["kind"] == "bar":
        continue
    for l in g["lines"]:
        if l["item"].startswith("project:"):
            continue  # the project's own items: below
        need[l["item"]] = l["qty"]
        sources_of[l["item"]] = l["sources"]


def unit_line(item, offer, count, served, surplus, extra=None):
    key, sku, pack, price, quoted, src, read, _, _ = offer
    base = {"item": item, "name": NAMES[item], "kind": KIND[item], "opt": {}, "offer": key, "sku": sku, "qty": count}
    base["unit"] = "kit" if extra else ("pack" if pack > 1 else "unit")
    if pack > 1:
        base["pack"] = pack
    if extra:
        base["kit"] = extra
    base.update({"per": "unit", "list_minor": price, "unit_price_minor": price})
    money = (quoted[0] * count, price * count, quoted[1] * count) if quoted else (price * count,) * 3
    return base, money, quoted is not None, src, read


# The bracket kit, chosen: 12 brackets need 2 kits of 10, which also bring 40 screws and 40 T-nuts.
for item, key in CHOSEN.items():
    offer = next(o for o in UNIT_OFFERS[item] if o[0] == key)
    contents = offer[8]
    main = dict(contents)[item]
    kits = -(-need[item] // main)  # ceil
    served, surplus, sources = [], [], set()
    for it, n in contents:
        got = kits * n
        take = min(got, need.get(it, 0))
        if take:
            need[it] -= take
            served.append({"item": it, "opt": {}, "qty": take})
            sources |= set(sources_of[it])
        if got > take:
            surplus.append({"item": it, "opt": {}, "qty": got - take})
    base, money, quoted, src, read = unit_line(item, offer, kits, served, surplus, [{"item": it, "opt": {}, "qty": n} for it, n in contents])
    priced_line(base, supplier_of(item), key, money, quoted, src, read, sources)
    order_lines[-1]["line"]["bom"] = served
    if surplus:
        order_lines[-1]["line"]["surplus"] = surplus


def covers(item, n):
    """Every way to buy at least n of an item from its non-kit offers, cheapest first: a brute
    force over pack counts, ordered by cost, then surplus, then lines, then more of the first SKU."""
    offers = sorted((o for o in UNIT_OFFERS[item] if o[8] is None), key=lambda o: o[0])
    best = None
    for counts in itertools.product(*[range(0, -(-n // o[2]) + 1) for o in offers]):
        units = sum(c * o[2] for c, o in zip(counts, offers))
        if units < n:
            continue
        key = (sum(c * o[3] for c, o in zip(counts, offers)), units - n, sum(1 for c in counts if c), [-c for c in counts])
        if best is None or key < best[0]:
            best = (key, counts)
    return [(o, c) for o, c in zip(offers, best[1]) if c]


unsourced = []
for item, n in need.items():
    if n == 0 or item in CHOSEN:
        continue
    bought = covers(item, n) if UNIT_OFFERS[item] else []
    if not bought:
        line = {"item": item, "name": NAMES[item], "kind": KIND[item], "opt": {}, "qty": n, "unit": "unit", "bom": [{"item": item, "opt": {}, "qty": n}]}
        order_lines.append({"supplier": None, "line": line, "offer": None, "sources": set(sources_of[item]), "missing": True})
        continue
    left = n
    for i, (offer, count) in enumerate(bought):
        units = count * offer[2]
        take = left if i == len(bought) - 1 else min(left, units)
        left -= take
        base, money, quoted, src, read = unit_line(item, offer, count, take, units - take)
        priced_line(base, supplier_of(item), offer[0], money, quoted, src, read, sources_of[item])
        order_lines[-1]["line"]["bom"] = [{"item": item, "opt": {}, "qty": take}]
        if units > take:
            order_lines[-1]["line"]["surplus"] = [{"item": item, "opt": {}, "qty": units - take}]

# The project's own items: one line each, a unit, under its supplier, at the price entered in the
# project's currency. No price band applies: they are not catalog-priced. The plate is the
# fabricator's, quoted in writing; the bracket names no maker, so it is made locally, and has no
# price yet (O2 holds it); the motor is a placeholder with an estimated range and no supplier.
PROJECT_LINES = [
    # item, name, kind, supplier, (low, likely, high) or None, a range?, src, read, source
    ("project:plate-a", "Motor plate", "plate", "test-fab", (8500, 8500, 8500), False, "src", "2026-11-26", "p6"),
    ("project:angle-a", "Sensor bracket", "bent-angle", "local", None, False, None, None, "p7"),
    ("project:motor", "Gear motor, model to be chosen", "placeholder", None, (30000, 45000, 70000), True, "est", None, "p8"),
]
for item, name, kind, supplier, money, ranged, src, read, part in PROJECT_LINES:
    line = {"item": item, "name": name, "kind": kind, "opt": {}, "qty": 1, "unit": "unit"}
    if money is not None:
        line["unit_price_minor"] = money[1]
        line["currency"] = "BRL"
        line["low_minor"], line["likely_minor"], line["high_minor"] = money
        if ranged:
            line["range"] = "quote"
        line["price_src"] = src
        if read is not None:
            line["read"] = read
    line["bom"] = [{"item": item, "opt": {}, "qty": 1}]
    order_lines.append(
        {
            "supplier": supplier,
            "line": line,
            "offer": None,
            "sources": {part},
            "missing": money is None and kind != "placeholder",
            "project": True,
            "placeholder": kind == "placeholder",
        }
    )
O2 = "O2: price the sensor bracket with the local shop"

# Reasons, per supplier: the open item on c35 reaches the rail screws and T-nuts it buys; the
# phone quote is an estimate; the stud has no offer; the nuts' price is older than 30 days.
offers_by_key = {o[0]: o for offers in UNIT_OFFERS.values() for o in offers}
reasons = {}


def reason(supplier, rule, action, message, entities):
    r = {"rule": rule, "action": action, "message": message, "entities": entities}
    if r not in reasons.setdefault(supplier, []):
        reasons[supplier].append(r)


for e in order_lines:
    line = e["line"]
    if e.get("placeholder"):
        # A placeholder holds its own line's group, and nothing else.
        reason(e["supplier"], "placeholder", "block", f"{line['item']}: a placeholder, not a part to order", [line["item"]])
        continue
    if e.get("missing"):
        why = "no price" if e.get("project") else "no offer"
        reason(e["supplier"], "missing-price", "block", f"{line['item']}: {why}", [line["item"]])
    if "c35" in e["sources"]:
        reason(e["supplier"], "open-item", "block", O1, ["c35"])
    if line["item"] == "project:angle-a":
        reason(e["supplier"], "open-item", "block", O2, ["project:angle-a"])
    if e.get("project") and "likely_minor" in line:
        # A project item's own price: an estimate blocks, an old one warns.
        if line["price_src"] == "est":
            reason(e["supplier"], "est-price", "block", f"{line['item']}: its price is an estimate", [line["item"]])
        if "read" in line:
            age = (datetime.date.fromisoformat(AS_OF) - datetime.date.fromisoformat(line["read"])).days
            if age > 30:
                reason(e["supplier"], "stale-price", "warn", f"{line['item']}: price read {line['read']}, {age} days before {AS_OF}", [line["item"]])
    offer = offers_by_key.get(e["offer"])
    if offer is None:
        continue
    if offer[5] == "est":
        reason(e["supplier"], "est-price", "block", f"{offer[0]}: the price of {line['item']} is an estimate", [line["item"]])
    age = (datetime.date.fromisoformat(AS_OF) - datetime.date.fromisoformat(offer[6])).days
    if age > 30:
        reason(e["supplier"], "stale-price", "warn", f"{offer[0]}: price read {offer[6]}, {age} days before {AS_OF}", [line["item"]])
RULES = ["check-error", "open-item", "placeholder", "missing-price", "est-price", "out-of-stock", "option-not-sold", "stale-price"]

# Lines in a group: bars, connectors, fasteners, carriages, …, generic, then the project's own
# plates, bent angles and placeholders; by item, offer, longest.
KIND_ORDER = ["bar", "connector", "fastener", "carriage", "accessory", "panel", "generic", "plate", "bent-angle", "placeholder"]
LINE_KEYS = [
    "item", "name", "kind", "opt", "offer", "sku", "qty", "unit", "pack", "kit", "length_mm", "billed_mm",
    "line_billed_mm", "per", "list_minor", "unit_price_minor", "currency", "low_minor", "likely_minor",
    "high_minor", "range", "band", "converted", "price_src", "on_sale", "read", "covered_by", "bom",
    "surplus", "pieces", "services",
]


def ordered(line):
    return {k: line[k] for k in LINE_KEYS if k in line}


def money3(low, likely, high):
    return {"low_minor": low, "likely_minor": likely, "high_minor": high}


suppliers = sorted({e["supplier"] for e in order_lines if e["supplier"]} | {c["supplier"] for c in COSTS if "supplier" in c}, key=id_key)
cost_by = {c["id"]: c for c in COSTS}
supplier_out = []
for s in suppliers + ([None] if any(e["supplier"] is None for e in order_lines) else []):
    mine = [e for e in order_lines if e["supplier"] == s]
    mine.sort(key=lambda e: (KIND_ORDER.index(e["line"]["kind"]), id_key(e["line"]["item"]), e["line"].get("offer", ""), -e["line"].get("length_mm", 0)))
    rs = sorted(reasons.get(s, []), key=lambda r: (RULES.index(r["rule"]), r["message"]))
    # A cost line that names no supplier belongs to no supplier's order, not to the unsourced lines.
    own_costs = [c["id"] for c in COSTS if s is not None and c.get("supplier") == s]
    priced = [e["line"] for e in mine if "likely_minor" in e["line"]]
    t = [sum(l[k] for l in priced) + sum(cost_by[c][k] for c in own_costs) for k in ("low_minor", "likely_minor", "high_minor")]
    supplier_out.append(
        {
            "supplier": s,
            "status": "BLOCKED" if any(r["action"] == "block" for r in rs) else "READY",
            "reasons": rs,
            "lines": [ordered(e["line"]) for e in mine],
            "costs": own_costs,
            "totals": money3(*t),
        }
    )

# Costs and totals: the order lines, then the cost lines (K4 converted at 5.5), then 10 % of each
# of the low, likely and high subtotals.
priced = [e["line"] for e in order_lines if "likely_minor" in e["line"]]
lines_total = [sum(l[k] for l in priced) for k in ("low_minor", "likely_minor", "high_minor")]
costs_out, cost_total = [], [0, 0, 0]
for c in COSTS:
    out = {k: c[k] for k in ("id", "label", "kind", "supplier") if k in c}
    out["currency"] = c.get("currency", "BRL")
    out.update(money3(c["low_minor"], c["likely_minor"], c["high_minor"]))
    conv = [c["low_minor"], c["likely_minor"], c["high_minor"]]
    if out["currency"] == "USD":
        conv = [half_away(x * USD) for x in conv]
        out["converted"] = {"rate": 5.5, **money3(*conv)}
    cost_total = [a + b for a, b in zip(cost_total, conv)]
    out.update({k: c[k] for k in ("src", "ref") if k in c})
    if "covers" in c:
        out["covers"] = c["covers"]
    c["conv"] = conv
    costs_out.append(out)
subtotal = [a + b for a, b in zip(lines_total, cost_total)]
contingency = [half_away(Fraction(x * CONTINGENCY_PCT, 100)) for x in subtotal]
costs_out.append(
    {"id": "K5", "label": "contingency", "kind": "contingency", "pct": 10, "of": "subtotal", "currency": "BRL", **money3(*contingency), "src": "est"}
)
total = [a + b for a, b in zip(subtotal, contingency)]
# In each currency: the BRL lines and cost lines with the contingency, and the dollars as quoted.
brl = [lines_total[i] + sum(c[k] for c in COSTS if c.get("currency", "BRL") == "BRL") + contingency[i] for i, k in enumerate(("low_minor", "likely_minor", "high_minor"))]
usd = [cost_by["K4"][k] for k in ("low_minor", "likely_minor", "high_minor")]
# Provenance: every catalog price here was read (src) but the power supply's; the cost lines are
# estimates but K3, a written quote; the contingency is an estimate.
est = sum(l["likely_minor"] for l in priced if l["price_src"] == "est") + sum(c["conv"][1] for c in COSTS if c["src"] == "est") + contingency[1]
src = total[1] - est
share = [
    {"src": "src", "likely_minor": src, "pct": half_away(Fraction(src * 10000, total[1])) / 100},
    {"src": "est", "likely_minor": est, "pct": half_away(Fraction(est * 10000, total[1])) / 100},
]
order_out = {
    "schema": "alukit.order/1",
    "currency": "BRL",
    "price_basis": "regular",
    "as_of": AS_OF,
    "oldest_read": min(e["line"]["read"] for e in order_lines if "read" in e["line"]),
    "status": "BLOCKED" if any(s["status"] == "BLOCKED" for s in supplier_out) else "READY",
    "rules": {r: ("warn" if r == "stale-price" else "block") for r in RULES},
    "suppliers": supplier_out,
    "costs": costs_out,
    "totals": {
        "currency": "BRL",
        "lines": money3(*lines_total),
        "costs": money3(*cost_total),
        "subtotal": money3(*subtotal),
        "contingency": money3(*contingency),
        "total": money3(*total),
        "by_currency": [{"currency": "BRL", **money3(*brl)}, {"currency": "USD", **money3(*usd)}],
        "share": share,
        "unpriced": sum(1 for e in order_lines if e.get("missing")),
    },
    "diagnostics": SEATS,
}


def as_js(x):
    """JSON as JavaScript prints it: a float with no fraction prints as an integer."""
    if isinstance(x, float) and x.is_integer():
        return int(x)
    if isinstance(x, dict):
        return {k: as_js(v) for k, v in x.items()}
    if isinstance(x, list):
        return [as_js(v) for v in x]
    return x


# --- The machining sheet ------------------------------------------------------------------------
# Each custom part's holes from its datum, to 0.01 mm. The plate's datum is its outline's origin;
# the angle's is its heel at end 0 (y up each leg from the outside of the other), and on its flat
# blank, leg a's free edge: a hole on leg a at y from the heel is 40 − y from that edge, one on
# leg b at y is the developed length less (30 − y). The bend zone on the blank runs from leg a's
# flat, 40 − 6 = 34, for the bend allowance. Every hole is drilled from its front (the plate's
# face away from the rail, the angle's inside). The bars' machining is the cut list's: the sheet
# names the cut-list lines that carry some, and how many operations each piece has.
DATUMS = {
    "plate": "the outline's origin (0, 0); x and y as the outline is drawn",
    "bent-angle": "the heel at end 0; x along the length, y from the heel's outside face up the leg",
    "blank": "leg a's free edge at end 0; x along the length, y across the blank",
}


def sheet_hole(hid, at, kind, d, leg=None, flat=None, **extra):
    h = {"id": hid}
    if leg is not None:
        h["leg"] = leg
    h["at_mm"] = [q(at[0]), q(at[1])]
    if flat is not None:
        h["flat_mm"] = [q(flat[0]), q(flat[1])]
    h["type"] = kind
    h["d_mm"] = q(d)
    h.update(extra)
    h["face"] = "front"
    return h


angle_part = {
    "item": "project:angle-a",
    "name": "Sensor bracket",
    "kind": "bent-angle",
    "qty": 1,
    "sources": ["p7"],
    "supplier": "local",
    "material": "test:al-6063-t5",
    "thickness_mm": ANGLE_T,
    "datum": DATUMS["bent-angle"],
    "legs_mm": [LEG_A, LEG_B],
    "length_mm": ANGLE_L,
    "blank_mm": [ANGLE_L, q(DEVELOPED)],
    "blank_datum": DATUMS["blank"],
    "bend": {
        "angle_deg": 90,
        "radius_mm": ANGLE_R,
        "k_factor": ANGLE_K,
        "allowance_mm": q(BEND_ALLOWANCE),
        "from_mm": q(LEG_A - (ANGLE_R + ANGLE_T)),
        "to_mm": q(LEG_A - (ANGLE_R + ANGLE_T) + BEND_ALLOWANCE),
    },
    "holes": [
        sheet_hole("a1", (25, 22), "through", 5.5, leg="a", flat=(25, LEG_A - 22)),
        sheet_hole("b1", (25, 18), "threaded", 4 - 0.7, leg="b", flat=(25, DEVELOPED - (LEG_B - 18)), thread="M4"),
    ],
}
plate_part = {
    "item": "project:plate-a",
    "name": "Motor plate",
    "kind": "plate",
    "qty": 1,
    "sources": ["p6"],
    "supplier": "test-fab",
    "material": "test:s235",
    "thickness_mm": PLATE_T,
    "datum": DATUMS["plate"],
    "outline_mm": [list(p) for p in PLATE_OUTLINE],
    "holes": [
        sheet_hole("h1", (20, 20), "threaded", 6 - 1, thread="M6"),
        sheet_hole("h2", (140, 20), "countersunk", 6.6, csk={"d_mm": 12.4, "angle_deg": 90, "depth_mm": q(CSK_DEPTH)}),
        sheet_hole("h3", (140, 80), "counterbored", 6.6, cbore={"d_mm": 11, "depth_mm": 4}),
        sheet_hole("h4", (80, 50), "through", 8.5),
    ],
}
bar_refs = [
    {"item": g["item"], "opt": g["opt"], "cut_mm": l["cut_mm"], "count": l["count"], "ops": len(l["machining"]), "sources": l["sources"]}
    for g in groups
    for l in g["lines"]
    if l.get("machining")
]
machining = {"schema": "alukit.machining/1", "parts": [angle_part, plate_part], "bars": bar_refs, "diagnostics": SEATS}

expected = {
    "about": "The cart's cut list worked by hand: see hand/cart_by_hand.py, which wrote this.",
    "kerf_mm": KERF,
    "trim_mm": TRIM,
    "rail_stations_x_mm": RAIL_STATIONS,
    "groups": groups,
}
here = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(here, "..", "expected-cutlist.json"), "w") as f:
    f.write(json.dumps(expected, indent=2, ensure_ascii=False) + "\n")
with open(os.path.join(here, "..", "expected-bom.json"), "w") as f:
    f.write(json.dumps(bom, indent=2, ensure_ascii=False) + "\n")
# The order list is compared byte for byte with `alukit order --format json`, so it is written
# exactly as JavaScript's JSON.stringify(x, null, 2) prints it, and Biome leaves it alone.
with open(os.path.join(here, "..", "expected-order.json"), "w") as f:
    f.write(json.dumps(as_js(order_out), indent=2, ensure_ascii=False) + "\n")
# The machining sheet too: compared byte for byte with `alukit machining --format json`.
with open(os.path.join(here, "..", "expected-machining.json"), "w") as f:
    f.write(json.dumps(as_js(machining), indent=2, ensure_ascii=False) + "\n")
print(json.dumps({"cutlist": expected, "bom": bom, "order": as_js(order_out), "machining": as_js(machining)}, indent=1))
