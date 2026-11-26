"""The cart's cut list, worked by hand.

This script is the hand calculation of tests/fixtures/cart/alukit.json's cut list, written
independently of AluKit: it imports nothing from it and works each length from the cart's
geometry with plain arithmetic, the way a person would on paper. It writes
tests/fixtures/cart/expected-cutlist.json, which the cart test compares AluKit's cut list with.

Run: python3 -I tests/fixtures/cart/hand/cutlist_by_hand.py, then
pnpm exec biome format --write tests/fixtures/cart (the repository's JSON style).

Rules used, from docs/design.md: cut lengths come from the placed bounding boxes (§4.5); a butt
stops a bar at the first face of the through bar it meets, or at the end face it names, moved by
the connector's spacer along that face's normal; a through bar's end covers a corner; a pivot
cuts its bar square at the hinge's end distance from the pivot point; the cut list groups
identical pieces, a piece and its end-for-end flip being the same, and nests stock items
first-fit decreasing, then each bar into the cheapest stock length that holds it, cheapest
result winning (§5.3).

Not yet in the cart, because their rules are M3b's (generation): a rail run with factory ends,
carriages, rods and sleeves cut from stock as fasteners (the bolted stack names them already),
rail-hole selections, price bands and cost lines; and M6's plate and placeholder.
"""

import json
import math
import os

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

pieces = []  # (item, opt, source, cut, ends, centre, short)


def piece(item, source, cut, ends=("square", "square"), centre=None, short=None):
    pieces.append((item[0], item[1], source, cut, ends, centre, short))


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
# rail's inner face: x = 40 and x = W - 40.
piece(TS40, "b11", 700 - T40)
piece(TS40, "b12", (W - T40) - 700)

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
# The beam (RHS 100x50x4) runs across at x = 600 between the base rails' inner faces, y = 40 and
# y = 560.
piece(RHS, "b18", D - 2 * T40)
# A cover strip on its top, its ends flush with the beam's cut ends: the same length.
piece(FB10, "b19", D - 2 * T40)
# The bolted stack: straps y 150..450 and packers y 200..400, free square ends.
piece(FB10, "b20", 450 - 150)
piece(FB20, "b21", 400 - 200)
piece(FB20, "b22", 400 - 200)
piece(FB10, "b23", 450 - 150)
# Kick strips on the top rails' tops, from x = 40 to x = W - 40.
piece(FB10, "b24", (W - 40) - 40)
piece(FB10, "b25", (W - 40) - 40)

# --- Slats -----------------------------------------------------------------------------------
# A pattern every 150 from x = 150, seven stations, skipping the fourth (x = 600, the beam):
# copies 1, 2, 4, 5 and 6. Each slat butts between the base rails' inner faces.
for b in ("b26", "b26@1", "b26@2", "b26@4", "b26@5", "b26@6"):
    piece(TS40, b, D - 2 * T40)

# --- Angled ends: the bar's frame and the canonical orientation --------------------------------


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


def canonical(ends):
    """§5.3: of the piece and its end-for-end flip (t and x reverse, y stays, so a mitre changes
    sign and a bevel does not), the one whose ends compare first: square before angled, then
    by mitre, bevel and angle."""

    def key(e):
        return (0,) if e == "square" else (1, e["mitre_deg"], e["bevel_deg"], e["angle_deg"])

    def flip(e):
        return e if e == "square" else {**e, "mitre_deg": r2(-e["mitre_deg"])}

    flipped = (flip(ends[1]), flip(ends[0]))
    return min(ends, flipped, key=lambda pair: (key(pair[0]), key(pair[1])))


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
    piece(TS40, b, centre + 2 * half, canonical(ends), centre, centre - 2 * half)

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
piece(TS40, "b32", centre + half, canonical(ends), centre, centre - half)

# --- Grouping, ordering and nesting -----------------------------------------------------------
q = lambda v: round(v + 0.0, 2)  # noqa: E731  (the 0.01 mm quantum)

# Offers (tests/fixtures/catalogs): TS40 and TS4080 are cut by the supplier (res 1, step 10);
# the steel is sold in stock lengths, priced per bar on the regular basis.
CUT = {"test:TS40": "test:TS40-c7", "test:TS4080": "test:TS4080-c7"}
STOCK = {
    "test-geo:RHS-100x50x4": [("test-geo:RHS-100x50x4-6000", 6000, 28900)],
    "test-geo:FB-50x10": [("test-geo:FB-50x10-3000", 3000, 4000), ("test-geo:FB-50x10-6000", 6000, 7000)],
    "test-geo:FB-50x20": [("test-geo:FB-50x20-6000", 6000, 13500)],
}


def nest(ps, stocks):
    """First-fit decreasing per stock length, each bar then into the cheapest length that holds
    it; the cheapest result wins. A bar holds pieces when 2·trim + Σ + (n − 1)·kerf ≤ its length."""
    order = sorted(ps, key=lambda p: (-p[1], int(p[0][1:].split("@")[0]), p[0]))
    best = None
    for _, length, _ in sorted(stocks, key=lambda s: s[1]):
        bars = []
        for src, cut in order:
            for bar in bars:
                if bar["used"] + KERF + cut <= length:
                    bar["pieces"].append((src, cut))
                    bar["used"] += KERF + cut
                    break
            else:
                bars.append({"pieces": [(src, cut)], "used": 2 * TRIM + cut})
        for bar in bars:
            fits = [s for s in stocks if s[1] >= bar["used"]]
            bar["stock"] = min(fits, key=lambda s: (s[2], s[1]))
        cost = sum(b["stock"][2] for b in bars)
        if best is None or cost < best[0]:
            best = (cost, bars)
    return best


groups = []
items = sorted({(p[0], json.dumps(p[1], sort_keys=True)) for p in pieces})
for item, opt_text in items:
    ps = [p for p in pieces if p[0] == item and json.dumps(p[1], sort_keys=True) == opt_text]
    lines = {}
    for _, _, src, cut, ends, centre_mm, short_mm in ps:
        key = (q(cut), json.dumps(ends))
        lines.setdefault(key, []).append((src, centre_mm, short_mm, ends))
    out_lines = []
    for (cut, _), members in sorted(lines.items(), key=lambda kv: -kv[0][0]):
        src0, centre_mm, short_mm, ends = members[0]
        line = {"count": len(members), "cut_mm": cut}
        if centre_mm is not None:
            line["centre_mm"] = q(centre_mm)
            line["short_mm"] = q(short_mm)
        line["ends"] = {"a": ends[0], "b": ends[1]}
        if item in CUT:
            ordered = math.floor(cut + 0.5)  # res_mm 1, half away from zero
            line["ordered_mm"] = ordered
            line["billed_mm"] = math.ceil(ordered / 10) * 10  # step_mm 10
        line["sources"] = sorted(
            (m[0] for m in members), key=lambda s: (int(s[1:].split("@")[0]), s)
        )
        out_lines.append(line)
    group = {"item": item, "opt": json.loads(opt_text)}
    if item in CUT:
        group["mode"] = "cut"
        group["offer"] = CUT[item]
    else:
        group["mode"] = "stock"
    group["lines"] = out_lines
    if item in STOCK:
        cost, bars = nest([(p[2], q(p[3])) for p in ps], STOCK[item])
        group["stock"] = [
            {
                "sku": b["stock"][0],
                "length_mm": b["stock"][1],
                "sources": [s for s, _ in b["pieces"]],
                "offcut_mm": q(b["stock"][1] - b["used"]),
                "waste_mm": q(b["stock"][1] - sum(c for _, c in b["pieces"])),
            }
            for b in bars
        ]
        group["cost_minor"] = cost
    groups.append(group)

expected = {
    "about": "The cart's cut list worked by hand: see hand/cutlist_by_hand.py, which wrote this.",
    "kerf_mm": KERF,
    "trim_mm": TRIM,
    "groups": groups,
}
here = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(here, "..", "expected-cutlist.json"), "w") as f:
    f.write(json.dumps(expected, indent=2, ensure_ascii=False) + "\n")
print(json.dumps(expected, indent=1))
