"""The cart's cut list, worked by hand.

This script is the hand calculation of tests/fixtures/cart/alukit.json's cut list, written
independently of AluKit: it imports nothing from it and works each length from the cart's
geometry with plain arithmetic, the way a person would on paper. It writes
tests/fixtures/cart/expected-cutlist.json, which the cart test compares AluKit's cut list with.

Run: python3 -I tests/fixtures/cart/hand/cutlist_by_hand.py

Rules used, from docs/design.md: cut lengths come from the placed bounding boxes (§4.5); a butt
stops a bar at the first face of the through bar it meets; a through bar's end covers a corner;
a pivot cuts its bar square at the hinge's end distance from the pivot point; the cut list groups
identical pieces and nests stock items first-fit decreasing, then each bar into the cheapest
stock length that holds it, cheapest result winning (§5.3).
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

# --- Knee braces at the top corners -----------------------------------------------------------
# Front-left: from 200 along the front rail to 200 along the left rail, in plan the line
# x + y = 200, its top flush with the rails (z 860..900). It meets the front rail's inner face
# y = 80 at x = 120, and the left rail's inner face x = 40 at y = 160.
centre = math.hypot(120 - 40, 160 - 80)  # 80·√2 = 113.137…
# Both faces are at 45° to the brace, and the cuts close toward the corner (a trapezoid in plan):
# each long point is 20·tan 45° beyond the centre line, each short point 20·tan 45° short of it.
half = T40 / 2 * math.tan(math.radians(45))
long_point = centre + 2 * half
short_point = centre - 2 * half


def knee_ends(a, b, face_a, face_b):
    """End cuts in the brace's own frame (§4.4: t along the bar, y = up for a level bar,
    x = y × t), then the canonical orientation (§5.3): of the piece and its end-for-end flip
    (x → −x, so mitres change sign), the one whose ends compare first, by mitre value."""
    t = (b[0] - a[0], b[1] - a[1])
    n = math.hypot(*t)
    t = (t[0] / n, t[1] / n)
    x = (-t[1], t[0])  # y × t with y = +Z: (0, 0, 1) × (tx, ty, 0) = (−ty, tx, 0)

    def mitre(normal, outward):  # atan2(n · x, n · e), e the end's outward axis
        nx = normal[0] * x[0] + normal[1] * x[1]
        nz = normal[0] * outward[0] + normal[1] * outward[1]
        return round(math.degrees(math.atan2(nx, nz)), 2)

    ma = mitre(face_a, (-t[0], -t[1]))
    mb = mitre(face_b, t)
    as_drawn = (ma, mb)
    flipped = (-mb, -ma)
    return min(as_drawn, flipped)


# Outward normals of each end: away from the brace, into the rail it butts.
corners = {
    "b27": ((200, 0), (0, 200), (0, -1), (-1, 0)),  # front rail y = 80, left rail x = 40
    "b28": ((W - 200, 0), (W, 200), (0, -1), (1, 0)),  # front rail, right rail x = W - 40
    "b29": ((200, D), (0, D - 200), (0, 1), (-1, 0)),  # back rail y = D - 80, left rail
    "b30": ((W - 200, D), (W, D - 200), (0, 1), (1, 0)),  # back rail, right rail
}
knees = {b: knee_ends(*v) for b, v in corners.items()}
assert len(set(knees.values())) == 1, knees  # all four are the same piece
m_a, m_b = knees["b27"]
for b in corners:
    piece(
        TS40,
        b,
        long_point,
        ends=(
            {"angle_deg": 45.0, "mitre_deg": m_a, "bevel_deg": 0.0},
            {"angle_deg": 45.0, "mitre_deg": m_b, "bevel_deg": 0.0},
        ),
        centre=centre,
        short=short_point,
    )

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
