"""G35, a screw through a block's end into a butting bar's core, worked by hand.

This script is the hand calculation of G35's numbers, written independently of AluKit: it imports
nothing from it and works each number from the case's geometry with plain arithmetic. It prints
them and checks them against expected.json beside it.

Run: python3 -I tests/fixtures/golden-gen/G35/by_hand.py (exit 1 on any mismatch).

The rule (design §3.4 `requires`, §4.5 bearing on an end; docs/notes/f2-joint-geometry.md, part 1):
a hole a connector requires in the through bar is the clearance for a fastener, and it follows
that fastener's axis. When the connector also taps the butting end at the hole's position, the
fastener is a screw through the through bar into that tap, so its axis is the line along the
butting bar's axis through the position. Where the through bar is a block the butt bears on the
end of, the hole enters that end face where the line meets it and leaves by the block's other end
face; it is reported by its entry and exit points, in the block's section from its box centre,
and its angle to the end face's normal. A hole whose axis leaves the block through a side before
it reaches the other end face has no place: a connection error, and no hole. Where the connector
does not tap the butting end, the hole runs along the block's axis, as before (acceptance gap A4).

The geometry. The block b1 is an 80 x 80 (cores at (±20, ±20)) from (0, 0, 0) to (160, 0, 0),
centred; along +X its local x is +Y and its local y is +Z (design §4.4: y is up, x = y × t). The
40 x 80 b2 runs from (1660, -190, 0) to (160, 10, 0), rolled 90°, centred, its end b cut on the
block's end face b (x = 160). Its two cores are at (0, ±20) in its section. The connector taps M8
at both cores and asks for a Ø9 hole through the block at each.
"""

import json
import math
import os

A1, B1 = (0.0, 0.0, 0.0), (160.0, 0.0, 0.0)
HALF1 = 40.0  # half the 80 x 80
R_HOLE = 4.5  # the Ø9 hole
POSITIONS = [(0.0, -20.0), (0.0, 20.0)]  # b2's cores, in its section from its box centre
TOL = 0.01


def sub(u, v):
    return tuple(a - b for a, b in zip(u, v))


def add(u, v):
    return tuple(a + b for a, b in zip(u, v))


def scale(u, k):
    return tuple(a * k for a in u)


def dot(u, v):
    return sum(a * b for a, b in zip(u, v))


def cross(u, v):
    return (u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0])


def unit(u):
    n = math.sqrt(dot(u, u))
    return scale(u, 1 / n)


def r2(x):
    """To 0.01, with no negative zero (the cut list prints 0.00)."""
    return round(x, 2) + 0.0


def frame(a, b, roll_deg):
    """§4.4: t along the bar, y up (+Z) less its t part, x = y × t, then the roll, counter-
    clockwise seen from b looking toward a: x' = x cos + y sin, y' = y cos - x sin."""
    t = unit(sub(b, a))
    up = (0.0, 0.0, 1.0)
    y0 = unit(sub(up, scale(t, dot(up, t))))
    x0 = cross(y0, t)
    c, s = math.cos(math.radians(roll_deg)), math.sin(math.radians(roll_deg))
    x = add(scale(x0, c), scale(y0, s))
    y = sub(scale(y0, c), scale(x0, s))
    return t, x, y


def case(b2a, b2b, spacer, taps):
    t1, x1, y1 = frame(A1, B1, 0)
    t2, x2, y2 = frame(b2a, b2b, 90)
    # The butt: b2's end b on b1's end face b (x = 160), moved by the spacer along its normal (+X).
    plane_x = B1[0] + spacer
    # Where b2's centre line meets its end plane, along its axis from its end a.
    s_end = (plane_x - b2a[0]) / t2[0]
    holes, errors = [], []
    for p in POSITIONS:
        O = add(add(b2a, scale(x2, p[0])), scale(y2, p[1]))
        if taps:
            # A screw into b2's tap at p: along b2's axis (into the block: +t2, b2's end b).
            u = t2
            entry = add(O, scale(u, (B1[0] - O[0]) / u[0]))
        else:
            # No tap: the hole runs along the block's axis, where the line at p meets b2's end
            # plane, carried back along the face's normal by the spacer (acceptance gap A4).
            u = scale(t1, -1.0)
            on_plane = add(O, scale(t2, (plane_x - O[0]) / t2[0]))
            entry = (on_plane[0] - spacer, on_plane[1], on_plane[2])
        exit_ = add(entry, scale(u, (A1[0] - entry[0]) / u[0]))  # b1's end face a, x = 0
        local = lambda P: (dot(sub(P, A1), x1), dot(sub(P, A1), y1))  # noqa: E731
        e_in, e_out = local(entry), local(exit_)
        # The angle between the hole's axis and the end face's inward normal (-X).
        angle = math.degrees(math.acos(dot(u, (-1.0, 0.0, 0.0))))
        # The hole's wall, in the block's cross-section: r √(1 + (u·x / u·t)²) across x.
        ut = dot(u, t1)
        rx = R_HOLE * math.sqrt(1 + (dot(u, x1) / ut) ** 2)
        leaves = abs(e_out[0]) > HALF1 + TOL
        if leaves:
            # Where the axis crosses the side x = ±40, along the block's axis from its end b.
            side = HALF1 if e_out[0] > 0 else -HALF1
            drift = abs(dot(u, x1) / ut)  # across per mm along the block
            at = abs(side - e_in[0]) / drift
            wall = (abs(side) - rx - abs(e_in[0])) / drift  # its wall gets there first
            errors.append({"code": "connection", "entity": "c1", "refs": ["b1"]})
            print(
                f"  core {p}: enters x {e_in[0]:.3f}, would leave x {e_out[0]:.3f}: through the side "
                f"{at:.2f} mm in, its wall from {wall:.2f} mm in"
            )
            continue
        assert abs(e_in[0]) + rx <= HALF1 and abs(e_out[0]) + rx <= HALF1, "the wall breaks out"
        holes.append((e_in, e_out, angle, taps))
        print(f"  core {p}: enters x {e_in[0]:.3f}, leaves x {e_out[0]:.3f}, {angle:.4f}° off square")
    # b2's lengths: the centre line to its end plane; the long point 40 tan θ further (its 80 lies
    # in plan, across the tilt).
    tan = abs(t2[1] / t2[0])
    centre = s_end
    long_point = centre + 40.0 * tan
    return {"holes": holes, "errors": errors, "b2_cut": long_point}


def end_hole_op(h):
    e_in, e_out, angle, taps = h
    op = {"op": "end-hole", "from": "b"}
    if r2(e_in[0]) != 0 or r2(e_in[1]) != 0:
        op["off"] = [r2(e_in[0]), r2(e_in[1])]
    if taps:
        op["exit"] = [r2(e_out[0]), r2(e_out[1])]
        op["angle"] = r2(angle)
    op["d"] = 9
    op["by"] = "c1"
    return op


def hole_text(h):
    """The cut list's words, for the block turned end for end (its canonical orientation: the
    machining named from end a sorts first). Turning about local y reverses x and keeps y."""
    e_in, e_out, angle, taps = h
    x, y = r2(0 - e_in[0]), r2(e_in[1])
    if not taps:
        return f"Ø9.00 hole in end a along the axis, at x {x:.2f}, y {y:.2f} from the centre, through"
    xo, yo = r2(0 - e_out[0]), r2(e_out[1])
    return (
        f"Ø9.00 hole in end a at x {x:.2f}, y {y:.2f} from the centre, {r2(angle):.2f}° off square, "
        f"exiting end b at x {xo:.2f}, y {yo:.2f}, through"
    )


def tap_ops(taps):
    if not taps:
        return []
    return [
        {"op": "end-tap", "from": "b", "off": [0, -20], "thread": "M8", "by": "c1"},
        {"op": "end-tap", "from": "b", "off": [0, 20], "thread": "M8", "by": "c1"},
    ]


CASES = [
    ("base", (1660.0, -190.0, 0.0), (160.0, 10.0, 0.0), 0.0, True),
    ("20 lower", (1660.0, -210.0, 0.0), (160.0, -10.0, 0.0), 0.0, True),
    ("no tap in the 40x80", (1660.0, -190.0, 0.0), (160.0, 10.0, 0.0), 0.0, False),
    ("spacer_mm 8", (1660.0, -190.0, 0.0), (160.0, 10.0, 0.0), 8.0, True),
]

here = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(here, "expected.json"), encoding="utf-8") as f:
    expected = json.load(f)
by_name = {"base": expected["expect"]}
for c in expected.get("cases", []):
    by_name[c["name"]] = c["expect"]

mismatches = []
for name, b2a, b2b, spacer, taps in CASES:
    print(f"{name}:")
    r = case(b2a, b2b, spacer, taps)
    want = by_name.get(name)
    if want is None:
        mismatches.append(f"{name}: no such case in expected.json")
        continue
    ops = [end_hole_op(h) for h in r["holes"]]
    if want["ops"]["b1"] != ops:
        mismatches.append(f"{name} b1 ops: hand {ops}, expected.json {want['ops']['b1']}")
    if want["ops"].get("b2", []) != tap_ops(taps):
        mismatches.append(f"{name} b2 ops: hand {tap_ops(taps)}, expected.json {want['ops'].get('b2')}")
    if want["errors"] != r["errors"]:
        mismatches.append(f"{name} errors: hand {r['errors']}, expected.json {want['errors']}")
    words = sorted(hole_text(h) for h in r["holes"])
    lines = {"test-stud:TS80": [{"count": 1, "cut_mm": 160.0, "machining": words}]}
    if taps:
        lines["test:TS4080"] = [
            {
                "count": 1,
                "cut_mm": r2(r["b2_cut"]),
                "machining": [
                    "tap M8 in end a, at x 0.00, y -20.00 from the centre",
                    "tap M8 in end a, at x 0.00, y 20.00 from the centre",
                ],
            }
        ]
    else:
        lines["test:TS4080"] = [{"count": 1, "cut_mm": r2(r["b2_cut"])}]
    for item, want_lines in want["lines"].items():
        got = [dict(x) for x in lines[item]]
        for g, w in zip(got, want_lines):
            if "machining" in g and "machining" not in w:
                del g["machining"]
            if "machining" in g:
                g["machining"] = sorted(g["machining"])
                w = dict(w, machining=sorted(w["machining"]))
            if g != w:
                mismatches.append(f"{name} {item} line: hand {g}, expected.json {w}")
    print(f"  b2 long point {r2(r['b2_cut']):.2f}")

if mismatches:
    print("\nMISMATCH")
    for m in mismatches:
        print("  " + m)
    raise SystemExit(1)
print("\nexpected.json agrees with the hand calculation")
