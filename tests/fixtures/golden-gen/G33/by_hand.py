"""G33, a butting end held by another butt's through-fastener, worked by hand.

This script is the hand calculation of G33's numbers and verdicts, written independently of
AluKit: it imports nothing from it and works each case from the geometry and the catalog data
below with plain arithmetic. It prints them and checks them against expected.json beside it.

Run: python3 -I tests/fixtures/golden-gen/G33/by_hand.py (exit 1 on any mismatch).

The joint (design §3.4, §4.5; docs/notes/acceptance-gaps-2.md, A9): one M8 stud through an RHS,
in one 16x3 sleeve cut to the bore, into a bush in the core of a 40x40 bar on each side.
- c1 holds b2's end with a stud end: the stud, a bush and the sleeve, an M16 tap in b2's end and
  a Ø9 hole through the RHS where b2's centre line meets its face;
- c2 holds b3's end with a bush end (a bush and the M16 tap) and is held_by c1: b3's centre line
  must continue b2's (coaxial), from the far side, and c2's own connector passes nothing through.
- A hole with no depth goes through the whole section along the face's normal (§4.4), so a hole
  from each face at one place is one hole made twice: a machining error on the bar.

The geometry: b1 runs along +X with its centre line on the X axis. A horizontal bar's section has
local y up (+Z) and local x = y × t = +Y. The RHS 200x100x4.75 is 200 tall (local y) and 100 wide
(local x, world Y). b2 runs from (500, 0, 0) toward +Y and butts with its end a; b3 runs from
(x3, -600, 0) to (x3, 0, 0) and butts with its end b.
"""

import json
import os

RHS_WIDTH = 100.0  # across world Y, the butting bars' axis
RHS_WALL = 4.75
DESIGN_LEN = 600.0  # each butting bar, from the X axis to its far end
STUD_LEN = 140.0  # the stud end's stud, M8x140

CONNECTORS = {
    # what each brings per butting end: hardware, a sleeve of the bore, its requirements
    "test-stud:STUD-END": {
        "hardware": ["test-stud:STUD-M8x140", "test-stud:BUSH-M16-M8"],
        "sleeve": True,
        "tap": "M16",
        "through_hole": 9.0,
    },
    "test-stud:BUSH-END": {
        "hardware": ["test-stud:BUSH-M16-M8"],
        "sleeve": False,
        "tap": "M16",
        "through_hole": None,
    },
}


def passes_through(c):
    """A connector passes a through-fastener: a sleeve in the bore, or a hole through the bar."""
    return c["sleeve"] or c["through_hole"] is not None


def case(butts, x3=500.0):
    """butts: id -> (end, connector, held_by). Ends: "b2.a" from +Y at x 500, "b3.b" from -Y at x3."""
    where = {"b2.a": (500.0, +1), "b3.b": (x3, -1)}  # (x of the centre line, the side it comes from)
    errors, hardware, recipes, sleeves = [], {}, {}, []
    ops = {"b1": [], "b2": [], "b3": []}
    for cid in sorted(butts):
        ends, conn, held_by = butts[cid]
        c = CONNECTORS[conn]
        if held_by is not None:
            h_ends, h_conn, _ = butts[held_by]
            h = CONNECTORS[h_conn]
            if not passes_through(h):
                errors.append(("connection", cid, [held_by]))
            elif passes_through(c):
                errors.append(("connection", cid, [held_by]))
            else:
                ok = True
                for e in ends:
                    x, side = where[e]
                    if not any(where[k][0] == x and where[k][1] == -side for k in h_ends):
                        ok = False
                if not ok:
                    errors.append(("connection", cid, [held_by]))
        # Fit by role: the 40x40 bars fit; the RHS has no system, so it is held by the bore
        # (a sleeve), by the holder's through-fastener, or not at all. A failed held_by has its
        # own error, so the RHS is not judged again.
        if not c["sleeve"] and held_by is None:
            errors.append(("fit", cid, ["b1"]))
        for e in ends:
            bar, end = e.split(".")
            for item in c["hardware"]:
                hardware[item] = hardware.get(item, 0) + 1
            recipes[conn] = recipes.get(conn, 0) + 1
            if c["sleeve"]:
                sleeves.append(RHS_WIDTH - 2 * RHS_WALL)
            ops[bar].append({"op": "end-tap", "from": end, "thread": c["tap"], "by": cid})
            if c["through_hole"] is not None:
                x, side = where[e]
                # Coming from +Y, the end meets the RHS's world +Y face, its local +x; from -Y, -x.
                face = "+x" if side > 0 else "-x"
                ops["b1"].append(
                    {"op": "hole", "face": face, "from": "a", "at": x, "d": c["through_hole"], "by": cid}
                )
    # Coincident machining: through holes on one axis (the same s, either face of one pair).
    seen = {}
    for o in ops["b1"]:
        seen.setdefault((o["at"], o["face"][1], o["d"]), []).append(o["by"])
    for by in seen.values():
        if len(by) > 1:
            errors.append(("machining", "b1", sorted(set(by))))
    # Each butting end stops on the RHS's near face: half its width from the axis.
    cut = DESIGN_LEN - RHS_WIDTH / 2
    rank = {"b": 0, "c": 1}
    errors.sort(key=lambda e: (rank[e[1][0]], int(e[1][1:]), e[0]))
    return {"cut": cut, "sleeves": sleeves, "hardware": hardware, "recipes": recipes, "ops": ops, "errors": errors}


def lines(lengths):
    out = {}
    for x in lengths:
        out[round(x, 2)] = out.get(round(x, 2), 0) + 1
    return [{"count": n, "cut_mm": x} for x, n in sorted(out.items(), reverse=True)]


S, B = "test-stud:STUD-END", "test-stud:BUSH-END"
results = {}
r = case({"c1": (["b2.a"], S, None), "c2": (["b3.b"], B, "c1")})
results["base"] = r
r = case({"c1": (["b2.a", "b3.b"], S, None)})
results["one butt with both ends, the stud end on each"] = r
r = case({"c1": (["b2.a"], S, None), "c2": (["b3.b"], B, None)})
results["two butts, the bush end not held"] = r
r = case({"c1": (["b2.a"], S, None), "c2": (["b3.b"], B, "c1")}, x3=520.0)
results["the held end 20 off the stud's centre line"] = r
r = case({"c1": (["b2.a"], B, None), "c2": (["b3.b"], B, "c1")})
results["held by a butt that passes nothing through the RHS"] = r
r = case({"c1": (["b2.a"], S, None), "c2": (["b3.b"], S, "c1")})
results["the held end's connector passing its own stud"] = r

# The stud of the base case crosses the RHS between the two butting end faces, and reaches into
# each bush by what is left (derive does not size a connector's stud in v1: it is the catalog's).
span = RHS_WIDTH
print(f"base: the stud crosses {span:.2f} between the butting ends; {STUD_LEN:.0f} leaves {(STUD_LEN - span) / 2:.2f} in each bush")
for name, r in results.items():
    print(f"{name}: cut {r['cut']:.2f}, sleeves {r['sleeves']}, {r['hardware']}, errors {r['errors']}")

here = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(here, "expected.json"), encoding="utf-8") as f:
    expected = json.load(f)
by_name = {"base": expected["expect"]}
for c in expected.get("cases", []):
    by_name[c["name"]] = c["expect"]

mismatches = []
for name, r in results.items():
    want = by_name.get(name)
    if want is None:
        mismatches.append(f"{name}: no such case in expected.json")
        continue
    got_errors = [{"code": c, "entity": e, "refs": refs} for c, e, refs in r["errors"]]
    if got_errors != want["errors"]:
        mismatches.append(f"{name} errors: hand {got_errors}, expected.json {want['errors']}")
    ls = {
        "test-stud:TS40C": lines([r["cut"]] * 2),
        "test-stud:RHS-200x100x4.75": lines([1000.0]),
        "test-stud:TUBE-16x3": lines(r["sleeves"]),
    }
    for item, want_lines in want.get("lines", {}).items():
        if ls.get(item) != want_lines:
            mismatches.append(f"{name} {item}: hand {ls.get(item)}, expected.json {want_lines}")
    for item, n in want.get("hardware", {}).items():
        if r["hardware"].get(item, 0) != n:
            mismatches.append(f"{name} {item}: hand {r['hardware'].get(item, 0)}, expected.json {n}")
    if r["recipes"] != want.get("recipes", {}):
        mismatches.append(f"{name} recipes: hand {r['recipes']}, expected.json {want.get('recipes', {})}")
    for bar, want_ops in want.get("ops", {}).items():
        if r["ops"][bar] != want_ops:
            mismatches.append(f"{name} {bar} ops: hand {r['ops'][bar]}, expected.json {want_ops}")

if mismatches:
    print("\nMISMATCH")
    for m in mismatches:
        print("  " + m)
    raise SystemExit(1)
print("\nexpected.json agrees with the hand calculation")
