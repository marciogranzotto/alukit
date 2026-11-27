"""G30, a connector's fit by role, worked by hand.

This script is the hand calculation of G30's numbers and verdicts, written independently of
AluKit: it imports nothing from it and works each case from the geometry and the catalog data
below with plain arithmetic. It prints them and checks them against expected.json beside it.

Run: python3 -I tests/fixtures/golden-gen/G30/by_hand.py (exit 1 on any mismatch).

The rule (design §3.4, fit by role; docs/notes/acceptance-gaps.md, A1):
- a butting bar is held by its system: the connector's `fits` must name it;
- the through bar is held by its system, or by its bore: a mount's fastener set, chosen by the
  system of a joined bar the connector fits, puts a sleeve `inside: "through"` in it, and the
  through bar is hollow (an RHS or a tube);
- a bar that is held neither way is a fit error naming it. The through bar is judged only when
  some joined bar has a system the connector fits; with none, the butting bar's error is the one
  to fix. A connector with no mounts at all puts no sleeve anywhere, so it holds a through bar of
  no system in no way.

The geometry: b1 runs along +X with its centre line on the X axis. A horizontal bar's section
has local y up (+Z) and local x = y × t = +Y. The RHS 100x50x4 is 100 tall (local y) and 50 wide
(local x); a 40x40 T-slot bar is 40 x 40. b2 runs from (500, 0, 0) toward +Y and butts with its
end a; b3 (one variation) runs toward the X axis from -Y and butts with its end b.
"""

import json
import os

# Catalog data the case reads (tests/fixtures/catalogs/test, test-geo, test-joint).
BARS = {
    "test-geo:RHS-100x50x4": {"system": None, "hollow": True, "width": 50.0, "height": 100.0, "t": 4.0},
    "test:TS40": {"system": "test:s40-c8", "hollow": False, "width": 40.0, "height": 40.0},
    "test-geo:FB-50x10": {"system": None, "hollow": False, "width": 50.0, "height": 10.0},
}
CONNECTORS = {
    # fits, and the sets of its one mount: system -> (fasteners, sleeve length or "bore" or None)
    "test-joint:BUSH-END": {"fits": ["test:s40-c8"], "sets": {"test:s40-c8": (["test-joint:BUSH-M8"], "bore")}},
    "test-joint:BUSH-END-L": {"fits": ["test:s40-c8"], "sets": {"test:s40-c8": (["test-joint:BUSH-M8"], 40.0)}},
    "test-joint:BRK-T": {"fits": ["test:s40-c8"], "sets": {"test:s40-c8": (["test:SCR-M8x16", "test:TNUT-M8"], None)}},
    # No mounts: it only requires a hole in the through bar.
    "test-joint:END-AX": {"fits": ["test:s40-c8"], "sets": {}},
    # A joint recipe (acceptance gap A2): the same bush and sleeve, and no body of its own.
    "test-joint:BUSH-JOINT": {
        "fits": ["test:s40-c8"],
        "sets": {"test:s40-c8": (["test-joint:BUSH-M8"], "bore")},
        "recipe": True,
    },
}
DESIGN_LEN = 600.0  # each butting bar, from the X axis to its far end


def case(through_item, butting_items, connector):
    """Lengths, pieces, counts and fit errors for a butt of `butting_items` into `through_item`."""
    t = BARS[through_item]
    c = CONNECTORS[connector]
    joined = [("b1", through_item)] + butting_items
    # The fastener set: keyed by a joined bar's system that the connector fits, the through bar's first.
    systems = [BARS[item]["system"] for _, item in joined if BARS[item]["system"] in c["fits"]]
    chosen = next((c["sets"][s] for s in systems if s in c["sets"]), None)
    errors = []
    for bar, item in butting_items:
        if BARS[item]["system"] not in c["fits"]:
            errors.append(("fit", "c1", [bar]))
    sleeve = None
    sleeved = chosen is not None and chosen[1] is not None
    if t["system"] not in c["fits"]:
        if not systems:
            pass  # no joined bar has a fitted system: the butting bar's error stands alone
        elif not sleeved:
            errors.insert(0, ("fit", "c1", ["b1"]))
    if chosen is not None and chosen[1] is not None:
        if not t["hollow"]:
            errors.insert(0, ("fit", "c1", ["b1"]))
        else:
            # Along the joint's normal (±Y, the RHS's local x): the inside across its 50.
            sleeve = t["width"] - 2 * t["t"] if chosen[1] == "bore" else chosen[1]
    # Each butting end stops on the through bar's near face: half its width from the axis.
    cut = DESIGN_LEN - t["width"] / 2
    units = len(butting_items)
    # One connector per butting end; a recipe is not bought, so it is listed apart.
    recipe = c.get("recipe", False)
    hardware = {connector: 0 if recipe else units}
    for f in chosen[0] if chosen else []:
        hardware[f] = hardware.get(f, 0) + units
    return {
        "cut": cut,
        "sleeves": [sleeve] * units if sleeve is not None else [],
        "hardware": hardware,
        "recipes": {connector: units} if recipe else {},
        "errors": errors,
    }


def lines(lengths):
    """Cut-list lines of one item: identical lengths grouped, longest first."""
    out = {}
    for x in lengths:
        out[round(x, 2)] = out.get(round(x, 2), 0) + 1
    return [{"count": n, "cut_mm": x} for x, n in sorted(out.items(), reverse=True)]


RHS, TS, FB = "test-geo:RHS-100x50x4", "test:TS40", "test-geo:FB-50x10"
results = {}

r = case(RHS, [("b2", TS)], "test-joint:BUSH-END")
results["base"] = (r, {TS: lines([r["cut"]]), "test-geo:TUBE-18x2": lines(r["sleeves"])})

r = case(RHS, [("b2", TS), ("b3", TS)], "test-joint:BUSH-END")
results["two butting ends, one from each side"] = (
    r,
    {TS: lines([r["cut"]] * 2), "test-geo:TUBE-18x2": lines(r["sleeves"])},
)

r = case(TS, [("b2", TS)], "test-joint:BUSH-END")
results["through a T-slot bar"] = (r, {TS: lines([1000.0, r["cut"]])})

r = case(RHS, [("b2", TS)], "test-joint:BRK-T")
results["a T-slot bracket with no sleeve on the RHS"] = (r, {TS: lines([r["cut"]])})

r = case(RHS, [("b2", TS)], "test-joint:END-AX")
results["an end connector with no mounts on the RHS"] = (r, {TS: lines([r["cut"]])})

r = case(RHS, [("b2", FB)], "test-joint:BUSH-END")
results["the bush end on a flat bar of no system"] = (r, {FB: lines([r["cut"]])})

r = case(RHS, [("b2", TS)], "test-joint:BUSH-END-L")
results["a sleeve of a fixed length"] = (r, {"test-geo:TUBE-18x2": lines(r["sleeves"])})

r = case(RHS, [("b2", TS)], "test-joint:BUSH-JOINT")
results["a joint recipe: the same bush and sleeve, and no body of its own"] = (
    r,
    {"test-geo:TUBE-18x2": lines(r["sleeves"])},
)

r = case(TS, [("b2", TS)], "test-joint:BUSH-END-L")
results["a sleeve of a fixed length, through a T-slot bar"] = (r, {TS: lines([1000.0, r["cut"]])})

for name, (r, ls) in results.items():
    print(f"{name}: cut {r['cut']:.2f}, sleeves {r['sleeves']}, {r['hardware']}, errors {r['errors']}")

here = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(here, "expected.json"), encoding="utf-8") as f:
    expected = json.load(f)
by_name = {"base": expected["expect"]}
for c in expected.get("cases", []):
    by_name[c["name"]] = c["expect"]

mismatches = []
for name, (r, ls) in results.items():
    want = by_name.get(name)
    if want is None:
        mismatches.append(f"{name}: no such case in expected.json")
        continue
    got_errors = [{"code": c, "entity": e, "refs": refs} for c, e, refs in r["errors"]]
    if got_errors != want["errors"]:
        mismatches.append(f"{name} errors: hand {got_errors}, expected.json {want['errors']}")
    for item, want_lines in want.get("lines", {}).items():
        if ls.get(item) != want_lines:
            mismatches.append(f"{name} {item}: hand {ls.get(item)}, expected.json {want_lines}")
    for item, n in want.get("hardware", {}).items():
        if r["hardware"].get(item, 0) != n:
            mismatches.append(f"{name} {item}: hand {r['hardware'].get(item, 0)}, expected.json {n}")
    if r["recipes"] != want.get("recipes", {}):
        mismatches.append(f"{name} recipes: hand {r['recipes']}, expected.json {want.get('recipes', {})}")

if mismatches:
    print("\nMISMATCH")
    for m in mismatches:
        print("  " + m)
    raise SystemExit(1)
print("\nexpected.json agrees with the hand calculation")
