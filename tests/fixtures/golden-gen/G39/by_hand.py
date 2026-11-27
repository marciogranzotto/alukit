"""G39, a blind fastener through a plate into an RHS's top wall, worked by hand.

This script is the hand calculation of G39's numbers, written independently of AluKit: it imports
nothing from it and works each number from the case's geometry with plain arithmetic. It prints
them and checks them against expected.json beside it.

Run: python3 -I tests/fixtures/golden-gen/G39/by_hand.py (exit 1 on any mismatch).

The rule (design §4.5, a blind fastening; docs/notes/x1-x3-f2ab.md, X1): a blind fastener is set
from one side. Its hole is the one its maker states (here Ø14), not an ISO 273 clearance, and it is
drilled in every layer the fastener passes. In a hollow last layer (an RHS, a tube) the fastener
passes the near wall alone and grips inside the bore, so only that wall is drilled; behind a solid
last layer it grips on the far face, so that layer is drilled through. Its grip is the depth of the
material it passes: every layer but a hollow last one whole, and of a hollow last one its near
wall. A grip outside the range its maker states (here 3 to 22) is a `fit` error.

The geometry: b1, a 200 x 100 x 4.75 RHS (b 100 across, h 200 tall), along +X from x = 0, its
top wall's outer face at z = 100. b2, a 120 x 12 flat, along +X from x = 100, on that face (its
centre at z = 106). Two stations, 50 and 200 along b2: x = 150 and 300, so 150 and 300 along b1.
The head (a bearing face of Ø20) bears on b2's top face, 120 wide: whole, so 100 %.
"""

import json
import os


def r2(x):
    """To 0.01, with no negative zero."""
    return round(x, 2) + 0.0


HOLE = 14.0
GRIP = (3.0, 22.0)
STATIONS = [50.0, 200.0]
B2_START = 100.0
RHS_T = 4.75


def hole(at, depth=None):
    out = {"op": "hole", "face": "+y", "from": "a", "at": r2(at), "d": HOLE}
    if depth is not None:
        out["depth"] = r2(depth)
    out["by"] = "c1"
    return out


def case(plate_t, last):
    """The ops on b1 and b2, and the grip, for a plate of plate_t on b1 (hollow or solid)."""
    b2 = [hole(s) for s in STATIONS]
    if last == "rhs":
        b1 = [hole(B2_START + s, RHS_T) for s in STATIONS]
        grip = plate_t + RHS_T  # the plate whole, and the top wall alone
    else:
        b1 = [hole(B2_START + s) for s in STATIONS]  # a solid 8 mm flat, drilled through
        grip = plate_t + last
    return {"b1": b1, "b2": b2}, r2(grip)


def head_seat(k):
    # The annulus Ø14..Ø20 lies wholly on the plate's 120-wide top face, away from its edges.
    return {
        "k": k,
        "side": "head",
        "item": "test-x:BLIND-M8",
        "on": "b2 +y",
        "d_in_mm": HOLE,
        "d_out_mm": 20.0,
        "bearing_pct": 100.0,
    }


FIT = {"code": "fit", "entity": "c1", "refs": ["b1"]}
rows = {}
ops, grip = case(12.0, "rhs")
rows["base"] = {
    "ops": ops,
    "grip": grip,
    "errors": [] if GRIP[0] <= grip <= GRIP[1] else [FIT],
    "seats": [head_seat(1), head_seat(2)],
}
ops, grip = case(25.0, "rhs")
rows["a 25 mm plate"] = {"ops": ops, "grip": grip, "errors": [FIT] if grip > GRIP[1] else []}
ops, grip = case(12.0, 8.0)
rows["on a solid flat"] = {"ops": ops, "grip": grip, "errors": [] if grip <= GRIP[1] else [FIT]}
# A fastener that states no hole: nothing to drill; the connection's face error says so.
rows["no hole stated"] = {"ops": {"b1": [], "b2": []}, "errors": [{"code": "face", "entity": "c1"}]}

here = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(here, "expected.json"), encoding="utf-8") as f:
    expected = json.load(f)
by_name = {"base": expected["expect"]}
for c in expected.get("cases", []):
    by_name[c["name"]] = c["expect"]

mismatches = []
for name, row in rows.items():
    want = by_name.get(name)
    print(f"{name}: grip {row.get('grip', '-')}, errors {[e['code'] for e in row['errors']]}")
    if want is None:
        mismatches.append(f"{name}: no such case in expected.json")
        continue
    if want["ops"] != row["ops"]:
        mismatches.append(f"{name} ops: hand {row['ops']}, expected.json {want['ops']}")
    if "grip" in row and want["fastenings"]["c1"]["grip_mm"] != [row["grip"]]:
        mismatches.append(f"{name} grip: hand {row['grip']}, expected.json {want['fastenings']}")
    if want["errors"] != row["errors"]:
        mismatches.append(f"{name} errors: hand {row['errors']}, expected.json {want['errors']}")
    if "seats" in row and want["seats"]["c1"] != row["seats"]:
        mismatches.append(f"{name} seats: hand {row['seats']}, expected.json {want['seats']['c1']}")

if mismatches:
    print("\nMISMATCH")
    for m in mismatches:
        print("  " + m)
    raise SystemExit(1)
print("\nexpected.json agrees with the hand calculation")
