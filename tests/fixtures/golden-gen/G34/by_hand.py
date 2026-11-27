"""G34, a connector's machining at positions, worked by hand.

This script is the hand calculation of G34's numbers and verdicts, written independently of
AluKit: it imports nothing from it and works each case from the geometry and the catalog data
below with plain arithmetic. It prints them and checks them against expected.json beside it.

Run: python3 -I tests/fixtures/golden-gen/G34/by_hand.py (exit 1 on any mismatch).

The rule (design §3.4, §5.3; docs/notes/acceptance-gaps-2.md, A8):
- a requirement with positions makes one op at each: `at_holes` takes the x and y of a mount's
  holes, `at_mm` gives them; they are read in the butting bar's section, from its box centre;
- an end tap stands at its position in the butting end; a hole in the through bar stands where
  the line along the butting bar's axis at that position meets the face it butts into;
- a splice taps one core per stud, at the positions its item gives, in both spliced ends; with
  none, every stud's tap is at the centre;
- ops of one kind and size at one place are one op made several times: a machining error;
- a position must fall inside the butting end's section box, else a connection error;
- an end tap must stand on one of its section's cores, its centre within 0.01 of the core's: a
  tap is cut in a core. Else a machining error on the bar, one for each place (design 2.3, §5.5).

The geometry (design §4.4): b1 runs along +X: local x = +Y, local y = +Z. The posts b2 and b3 run
upward: local x = +X, local y = +Y. All three are 80x80 with four cores at (±20, ±20), centred on
their design lines. b2 stands on b1's top face (its +y, world z = 40) at x = 300.
"""

import json
import os

HALF = 40.0  # an 80x80's half width
HALF_40 = 20.0  # a 40x40's
TOL = 0.01
# The cores, from each section's bores (test-stud's TS80 and TS40C), from the box centre.
CORES = {HALF: [(-20.0, -20.0), (20.0, -20.0), (-20.0, 20.0), (20.0, 20.0)], HALF_40: [(0.0, 0.0)]}
J4_HOLES = [(-20.0, -20.0), (20.0, -20.0), (-20.0, 20.0), (20.0, 20.0)]
SPLICE4_CORES = J4_HOLES
X_POST = 300.0


def fmt(x):
    return f"{x:.2f}"


def case(j4="positions", splice="positions", post_half=HALF):
    """ops per bar, hardware, errors and cut lengths."""
    ops = {"b1": [], "b2": [], "b3": []}
    errors = []
    # c1: J4 on b2's end a. Its requirements, in order: the end tap, then the through hole.
    at = J4_HOLES if j4 == "positions" else [None] * 4
    reqs = [("tap", p) for p in at] if j4 == "positions" else [("tap", None)] * 4
    off = []
    for _, p in reqs:
        if p is not None and (abs(p[0]) > post_half - TOL or abs(p[1]) > post_half - TOL):
            off.append(p)
            continue
        op = {"op": "end-tap", "from": "a", "thread": "M16", "by": "c1"}
        if p is not None:
            op["off"] = list(p)
        ops["b2"].append(op)
    if off:
        errors.append(("connection", "c1", ["b2"]))
    for p in at:
        # The post's position (x, y) is world (300 + x, y); on b1's top face that is s = 300 + x
        # from its end a, and across = y (u runs along b1's local +x, world +Y).
        x, y = p if p is not None else (0.0, 0.0)
        op = {"op": "hole", "face": "+y", "from": "a", "at": X_POST + x, "d": 9.0, "by": "c1"}
        if y != 0:
            op["across"] = y
        ops["b1"].append(op)
    hardware = {"test-stud:BUSH-M16-M8": 4}
    # c2: the splice's taps, one per stud, in b2's end b and b3's end a.
    if splice is not None:
        cores = SPLICE4_CORES if splice == "positions" else [None] * 4
        for bar, end in (("b2", "b"), ("b3", "a")):
            for p in cores:
                op = {"op": "end-tap", "from": end, "thread": "M16", "by": "c2"}
                if p is not None:
                    op["off"] = list(p)
                ops[bar].append(op)
        hardware["test-stud:STUD-M16x60"] = 4
    # Coincident machining, per bar: ops at one place, by the connections that made them.
    for bar in ("b1", "b2", "b3"):
        groups = {}
        for o in ops[bar]:
            groups.setdefault(key(o), []).append(o["by"])
        dup = sorted({b for by in groups.values() if len(by) > 1 for b in by})
        if dup:
            errors.append(("machining", bar, dup))
    # Taps on no core, per bar and place: b2's section is the post's, b1 and b3 stay 80x80.
    for bar in ("b1", "b2", "b3"):
        cores = CORES[post_half if bar == "b2" else HALF]
        places = {}
        for o in ops[bar]:
            if o["op"] == "end-tap":
                places.setdefault(key(o), []).append(o)
        for taps in places.values():
            x, y = taps[0].get("off", [0.0, 0.0])
            if min(((x - cx) ** 2 + (y - cy) ** 2) ** 0.5 for cx, cy in cores) > TOL:
                errors.append(("machining", bar, sorted({t["by"] for t in taps})))
    errors.sort(key=lambda e: (e[1][0], int(e[1][1:])))
    # Lengths: b2 from b1's top face (z = 40) to the splice at z = 500; b3 from 500 to 1000.
    cuts = {"b1": 600.0, "b2": 500.0 - HALF, "b3": 500.0}
    return ops, hardware, errors, cuts


def key(o):
    """Where an op is: an end tap by its end and offset, a hole by its place along and across."""
    if o["op"] == "end-tap":
        return ("tap", o["from"], tuple(o.get("off", [0.0, 0.0])))
    return ("hole", o["at"], o.get("across", 0.0))


def listed(ops, length):
    """The piece's machining as the cut list lists it, in its canonical orientation (§5.3)."""

    def physical(m):
        if m["op"] == "end-tap":
            return (0, m["from"], m["x"], m["y"])
        return (1, m["at"], m["across"])

    as_is = [
        {"op": o["op"], "from": o["from"], "x": o.get("off", [0, 0])[0], "y": o.get("off", [0, 0])[1]}
        if o["op"] == "end-tap"
        else {"op": "hole", "from": "a", "at": o["at"], "face": o["face"], "across": o.get("across", 0.0)}
        for o in ops
    ]
    # Turned end for end: the ends swap, an end tap's x changes sign, a hole on a ±y face is
    # length - at from end a and its offset across changes sign.
    turned = [
        {**m, "from": "b" if m["from"] == "a" else "a", "x": -m["x"]}
        if m["op"] == "end-tap"
        else {**m, "at": length - m["at"], "across": -m["across"]}
        for m in as_is
    ]
    pick = as_is if sorted(map(physical, as_is)) <= sorted(map(physical, turned)) else turned
    pick = sorted(pick, key=lambda m: (m["from"], 0, m["x"], m["y"]) if m["op"] == "end-tap" else (m["from"], 1, m["at"], m["across"]))
    out = []
    for m in pick:
        if m["op"] == "end-tap":
            out.append(f"tap M16 in end {m['from']}, at x {fmt(m['x'] + 0)}, y {fmt(m['y'] + 0)} from the centre")
        else:
            out.append(f"Ø9.00 hole {fmt(m['at'])} mm from end a on face {m['face']}, {fmt(m['across'])} across")
    return out


results = {
    "base": case(),
    "positions written out as offsets": case(),
    "each requirement written four times with no positions": case(j4="none"),
    "a splice with four studs and no positions for their cores": case(splice="none"),
    "J4 on 40x40 posts": case(splice=None, post_half=HALF_40),
}

for name, (ops, hardware, errors, cuts) in results.items():
    print(f"{name}: {len(ops['b1'])} holes in b1, {len(ops['b2'])} taps in b2, {len(ops['b3'])} in b3; errors {errors}")

here = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(here, "expected.json"), encoding="utf-8") as f:
    expected = json.load(f)
by_name = {"base": expected["expect"]}
for c in expected.get("cases", []):
    by_name[c["name"]] = c["expect"]

mismatches = []
for name, (ops, hardware, errors, cuts) in results.items():
    want = by_name.get(name)
    if want is None:
        mismatches.append(f"{name}: no such case in expected.json")
        continue
    got_errors = [{"code": c, "entity": e, "refs": refs} for c, e, refs in errors]
    if got_errors != want["errors"]:
        mismatches.append(f"{name} errors: hand {got_errors}, expected.json {want['errors']}")
    for bar, want_ops in want.get("ops", {}).items():
        if ops[bar] != want_ops:
            mismatches.append(f"{name} {bar} ops: hand {ops[bar]}, expected.json {want_ops}")
    for item, n in want.get("hardware", {}).items():
        if hardware.get(item, 0) != n:
            mismatches.append(f"{name} {item}: hand {hardware.get(item, 0)}, expected.json {n}")
    for item, want_lines in want.get("lines", {}).items():
        bars = ["b1", "b2", "b3"] if item == "test-stud:TS80" else ["b2", "b3"]
        got = []
        for bar in sorted(bars, key=lambda b: -cuts[b]):
            line = {"count": 1, "cut_mm": cuts[bar]}
            if any("machining" in w for w in want_lines):
                line["machining"] = listed(ops[bar], cuts[bar])
            got.append(line)
        if got != want_lines:
            mismatches.append(f"{name} {item}: hand {got}, expected.json {want_lines}")

if mismatches:
    print("\nMISMATCH")
    for m in mismatches:
        print("  " + m)
    raise SystemExit(1)
print("\nexpected.json agrees with the hand calculation")
