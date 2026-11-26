"""The cart's cut list and bill of materials, worked by hand.

This script is the hand calculation of tests/fixtures/cart/alukit.json's cut list and BOM,
written independently of AluKit: it imports nothing from it and works each number from the
cart's geometry and the synthetic catalogs with plain arithmetic, the way a person would on
paper. It writes tests/fixtures/cart/expected-cutlist.json and expected-bom.json, which the cart
test compares AluKit's outputs with.

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
  published value, else area × density; a bar's mass by its centre-line length (§3.5, §5.4).

Not in the cart: price bands and cost lines (M3b's offers and costs), and M6's plate and
placeholder.
"""

import functools
import json
import math
import os
import re

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
]
UNPLACED = {"test:TNUT-M8": [{"part": "p2", "qty": 10, "why": "spares for light fixings"}]}

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
for kind in ("connector", "fastener", "carriage"):
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
for g in bom_groups:
    g["mass_kg"] = qkg(sum(l["mass_kg"] for l in g["lines"]))
bom = {
    "about": "The cart's bill of materials worked by hand: see hand/cart_by_hand.py, which wrote this.",
    "groups": bom_groups,
    "mass_kg": qkg(sum(g["mass_kg"] for g in bom_groups)),
}

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
print(json.dumps({"cutlist": expected, "bom": bom}, indent=1))
