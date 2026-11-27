"""G38, a piece's span: the length of straight stock it is cut from, worked by hand.

This script is the hand calculation of G38's numbers, written independently of AluKit: it imports
nothing from it and works each number from the case's geometry with plain arithmetic. It prints
them and checks them against expected.json beside it.

Run: python3 -I tests/fixtures/golden-gen/G38/by_hand.py (exit 1 on any mismatch).

The rule (design 2.3, §5.3; docs/notes/x4-stock-length.md): a piece's **span** is its extent along
the bar's axis, from the farthest point of its end a's cut to the farthest point of its end b's,
over the corners of its section's box. A straight piece of stock must reach both, so the piece is
ordered, billed and nested at its span. Its long-point length (`cut_mm`, the longest of the four
edges between the cuts) is the span when the two cuts lean opposite ways, as a trapezoid's do.
When they lean the same way, as parallel cuts do, the farthest points are on opposite edges and
the span is longer: by w · tan θ for two parallel cuts at θ across a section w deep in the plane
of the cut.

The geometry: a 40 x 40 square bar (a flat 40 x 40, so its outline is its box), centred on its
design line. Beams b1 (0,0,0)→(2000,0,0) and b2 (0,0,1040)→(2000,0,1040), square cut: b1's upper
face is z = 20, b2's lower face z = 1020, 1000 apart. A bar's frame (§4.4), for a bar that is not
vertical: t along it, y = +Z made perpendicular to t, x = y × t. Each butting end is cut on the
face of the through bar its centre line crosses first, coming from its other end (§4.5).

- b3, the brace: from (500,0,0) on b1 to (1020,0,1040) on b2, t = (1,0,2)/√5; both ends on the
  horizontal faces, so its cuts are parallel, each at atan(1/2) = 26.57° to the axis.
- b4, the post: (1600,0,0)→(1600,0,1040), square cut on the same faces: 1000.
- b5, the knee brace: from (1200,0,0) on b1 to (1600,0,400) on the post, t = (1,0,1)/√2; end a on
  b1's upper face z = 20, end b on the post's side x = 1580: two 45° cuts closing toward the
  corner, a trapezoid.

The cases: the brace's end b cut instead on the plane through (1010,0,1020) with normal (1,0,3),
which leans the same way as end a's but is not parallel to it; b2 raised to z = 2720 (b3's b at
1860 along it), so the brace's long point is inside the offer's 3000 mm and its span is not; and
the bar nested from stock bars (order `sale: "stock"`).

The offers (tests/fixtures/catalogs/test-span): cut to length at R$ 126.50/m, `res_mm` 1,
`step_mm` 10, 40 to 3000 mm; stock bars of 3000 (R$ 330.00) and 6000 (R$ 600.00); kerf 3, no
trim. A supplier-cut piece is ordered at its span rounded to the millimetre, half away from zero,
billed in 10 mm steps, rounded up, and priced per metre on the billed length, rounded once.
"""

import json
import math
import os

HALF = 20.0  # half the 40 x 40 section
KERF = 3.0
TRIM = 0.0
PRICE_PER_M = 12650  # minor units
RES, STEP, MAX_MM = 1, 10, 3000
STOCK = [("test-span:SQ40-3000", 3000, 33000), ("test-span:SQ40-6000", 6000, 60000)]
ITEM = "test-span:SQ40"


def dot(u, v):
    return sum(a * b for a, b in zip(u, v))


def sub(u, v):
    return tuple(a - b for a, b in zip(u, v))


def add(u, v):
    return tuple(a + b for a, b in zip(u, v))


def scale(u, k):
    return tuple(a * k for a in u)


def unit(v):
    n = math.sqrt(dot(v, v))
    return tuple(a / n for a in v)


def cross(u, v):
    return (u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0])


def q(v):
    """The 0.01 mm quantum, half away from zero."""
    return math.floor(abs(v) * 100 + 0.5) / 100 * (1 if v >= 0 else -1) + 0.0


def half_away(x):
    return math.floor(abs(x) + 0.5) * (1 if x >= 0 else -1)


def frame(a, b):
    t = unit(sub(b, a))
    if abs(t[2]) > 1 - 1e-12:  # vertical: any section axes do for a square cut on a level face
        return t, (1.0, 0.0, 0.0), (0.0, 1.0, 0.0)
    z = (0.0, 0.0, 1.0)
    y = unit(sub(z, scale(t, dot(z, t))))
    return t, cross(y, t), y


def corners(x, y):
    return [add(scale(x, cx), scale(y, cy)) for cx, cy in ((-HALF, -HALF), (HALF, -HALF), (HALF, HALF), (-HALF, HALF))]


def s_on(a, t, o, plane):
    """Where the line a + o + s t meets a plane (a point and a normal), as s."""
    p, n = plane
    return dot(sub(p, add(a, o)), n) / dot(t, n)


def bar(a, b, plane_a=None, plane_b=None):
    """A bar's lengths from its end planes (square at its design points when none is given)."""
    t, x, y = frame(a, b)
    plane_a = plane_a or (a, t)
    plane_b = plane_b or (b, t)
    cs = corners(x, y)
    sa = [s_on(a, t, o, plane_a) for o in cs]
    sb = [s_on(a, t, o, plane_b) for o in cs]
    edges = [e - s for s, e in zip(sa, sb)]
    centre = s_on(a, t, (0, 0, 0), plane_b) - s_on(a, t, (0, 0, 0), plane_a)
    angled = any(abs(dot(unit(pl[1]), t)) < 1 - 1e-12 for pl in (plane_a, plane_b))
    return {
        "cut": max(edges),
        "centre": centre,
        "short": min(edges),
        # From end a's farthest point to end b's, along the axis.
        "span": max(sb) - min(sa),
        "angled": angled,
    }


UP = (0.0, 0.0, 1.0)
B1_TOP = ((0.0, 0.0, 20.0), UP)  # b1's upper face


def geometry(upper_z=1040.0, b3_b_plane=None):
    b2_bottom = ((0.0, 0.0, upper_z - HALF), UP)
    b3_b = (500.0 + upper_z / 2, 0.0, upper_z)  # 1 across for 2 up from (500, 0, 0)
    post_side = ((1580.0, 0.0, 0.0), (1.0, 0.0, 0.0))  # the post's face toward b5, x = 1580
    return {
        "b1": bar((0.0, 0.0, 0.0), (2000.0, 0.0, 0.0)),
        "b2": bar((0.0, 0.0, upper_z), (2000.0, 0.0, upper_z)),
        "b3": bar((500.0, 0.0, 0.0), b3_b, B1_TOP, b3_b_plane or b2_bottom),
        "b4": bar((1600.0, 0.0, 0.0), (1600.0, 0.0, upper_z), B1_TOP, b2_bottom),
        "b5": bar((1200.0, 0.0, 0.0), (1600.0, 0.0, 400.0), B1_TOP, post_side),
    }


def bars_out(g):
    return {
        k: {"cut_mm": q(v["cut"]), "centre_mm": q(v["centre"]), "short_mm": q(v["short"]), "span_mm": q(v["span"])}
        for k, v in g.items()
    }


def cut_lines(g):
    """Supplier-cut lines: identical pieces (b1, b2) as one; longest cut first. A line with an
    angled end gives its span; each is ordered at its span and billed in steps."""
    groups = {}
    for k, v in g.items():
        groups.setdefault((q(v["cut"]), q(v["span"]), v["angled"]), []).append(k)
    out = []
    for (cut, span, angled), sources in sorted(groups.items(), key=lambda kv: -kv[0][0]):
        ordered = half_away(span / RES) * RES
        billed = math.ceil(ordered / STEP) * STEP
        line = {"count": len(sources), "cut_mm": cut}
        if angled:
            line["span_mm"] = span
        line["ordered_mm"] = ordered
        line["billed_mm"] = billed
        out.append((line, sources))
    return out


def piece_price(billed):
    return half_away(PRICE_PER_M * billed / 1000)


def used(ps):
    return 2 * TRIM + sum(ps) + (len(ps) - 1) * KERF


def nest(pieces):
    """First-fit decreasing for each stock length, each bar then moved down to the cheapest
    length that holds it; the cheapest result wins. Lengths in whole hundredths (no drift)."""
    h = lambda mm: half_away(mm * 100)  # noqa: E731
    order = sorted(pieces, key=lambda p: (-h(p[1]), p[0]))
    best = None
    for _, base, _ in STOCK:
        if any(h(used([p[1]])) > h(base) for p in pieces):
            continue
        bars = []
        for p in order:
            for b in bars:
                if h(used(b + [p[1]])) <= h(base):
                    b.append(p[1])
                    break
            else:
                bars.append([p[1]])
        placed = []
        for b in bars:
            fits = [s for s in STOCK if h(used(b)) <= h(s[1])]
            placed.append((min(fits, key=lambda s: (s[2], s[1])), b))
        cost = sum(s[2] for s, _ in placed)
        if best is None or cost < best[0] or (cost == best[0] and len(placed) < len(best[1])):
            best = (cost, placed)
    return best


results = {}

# The base case: the parallel brace, the trapezoid knee brace and the square bars, cut to length.
g = geometry()
lines = cut_lines(g)
order_lines = [
    {"low_minor": piece_price(l["billed_mm"]) * l["count"], "likely_minor": piece_price(l["billed_mm"]) * l["count"], "high_minor": piece_price(l["billed_mm"]) * l["count"]}
    for l, _ in lines
]
total = sum(o["likely_minor"] for o in order_lines)
results["base"] = {
    "bars": bars_out(g),
    "lines": {ITEM: [l for l, _ in lines]},
    "order": {"lines": {ITEM: order_lines}, "total": {"low_minor": total, "likely_minor": total, "high_minor": total}},
    "bom": {ITEM: {"length_mm": q(sum(q(v["span"]) for v in g.values()))}},
    "cut_errors": [],
    "errors": [],
}
b3 = g["b3"]
print(
    f"base: b3 cut {q(b3['cut']):.2f}, centre {q(b3['centre']):.2f}, short {q(b3['short']):.2f}, "
    f"span {q(b3['span']):.2f} (= {q(b3['cut']):.2f} + 40 · tan {math.degrees(math.atan(0.5)):.2f}° = + "
    f"{q(40 * 0.5):.2f}); b5 cut {q(g['b5']['cut']):.2f}, span {q(g['b5']['span']):.2f}"
)
for l, sources in lines:
    print(f"  {', '.join(sources)}: {l}, R$ {piece_price(l['billed_mm']) / 100:.2f} each")
print(f"  total R$ {total / 100:.2f}")

# Ends leaning the same way, not parallel: end b on the plane through (1010, 0, 1020), normal (1, 0, 3).
g = geometry(b3_b_plane=((1010.0, 0.0, 1020.0), (1.0, 0.0, 3.0)))
results["ends leaning the same way, not parallel"] = {"bars": {"b3": bars_out(g)["b3"]}, "errors": []}
b3 = g["b3"]
print(
    f"leaning the same way: b3 cut {q(b3['cut']):.2f}, centre {q(b3['centre']):.2f}, "
    f"short {q(b3['short']):.2f}, span {q(b3['span']):.2f}"
)

# The span past the offer's maximum: b2 at z = 2720; the brace's long point is inside 3000 mm.
g = geometry(upper_z=2720.0)
b3 = g["b3"]
results["the span past the offer's maximum"] = {
    "bars": {"b3": bars_out(g)["b3"]},
    "cut_errors": [{"code": "length", "entity": "b3"}] if q(b3["span"]) > MAX_MM else [],
    "errors": [],
}
print(f"past the maximum: b3 cut {q(b3['cut']):.2f}, span {q(b3['span']):.2f} (maximum {MAX_MM})")

# Nested from stock bars: each piece takes its span of the bar.
g = geometry()
cost, placed = nest([(k, q(v["span"])) for k, v in g.items()])
# The order buys the stock bars: one line per stock SKU, in SKU order, its bars times its price.
per_sku = {}
for s, _ in placed:
    per_sku[s[0]] = per_sku.get(s[0], 0) + s[2]
results["nested from stock bars"] = {
    "stock": {ITEM: {"pieces": [len(b) for _, b in placed], "used_mm": [q(used(b)) for _, b in placed], "lengths_mm": [b for _, b in placed]}},
    "order": {
        "lines": {ITEM: [{"low_minor": m, "likely_minor": m, "high_minor": m} for _, m in sorted(per_sku.items())]},
        "total": {"low_minor": cost, "likely_minor": cost, "high_minor": cost},
    },
    "errors": [],
}
for s, b in placed:
    print(f"nested: {s[0]}: {b}, used {q(used(b)):.2f}, offcut {q(s[1] - used(b)):.2f}")
print(f"  cost R$ {cost / 100:.2f}")

here = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(here, "expected.json"), encoding="utf-8") as f:
    expected = json.load(f)
by_name = {"base": expected["expect"]}
for c in expected.get("cases", []):
    by_name[c["name"]] = c["expect"]

mismatches = []
for name, want_by_hand in results.items():
    want = by_name.get(name)
    if want is None:
        mismatches.append(f"{name}: no such case in expected.json")
        continue
    for key, value in want_by_hand.items():
        if want.get(key) != value:
            mismatches.append(f"{name} {key}: hand {value}, expected.json {want.get(key)}")

if mismatches:
    print("\nMISMATCH")
    for m in mismatches:
        print("  " + m)
    raise SystemExit(1)
print("\nexpected.json agrees with the hand calculation")
