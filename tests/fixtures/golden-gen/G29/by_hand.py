"""G29, a block bolted to an angle's inner leg face (gap A3), worked by hand.

This script is the hand calculation of G29's numbers, written independently of AluKit: it imports
nothing from it and works each number from the case's geometry with plain arithmetic. It prints
the numbers and checks them against expected.json beside it, so the fixture and the hand
calculation cannot drift apart.

Run: python3 -I tests/fixtures/golden-gen/G29/by_hand.py (exit 1 on any mismatch).

The case (docs/design.md §4.4 for the frames, §4.5 for face connections; the gap A3 note for the
faces a layer may bear on):
- every bar runs along +X from x = 0 to 300, so its local x is world +Y and its local y world +Z;
- b1 is an equal angle, legs a = 76.2, thickness t = 6.35, root radius r1 = 9.525 and toe radius
  r2 = 4.76, with its heel (the outside corner) on the design line: the upright leg fills
  y 0..t, z 0..a, and the horizontal one y 0..a, z 0..t. The upright leg's inner face is the plane
  y = t, flat from the end of the root fillet (z = t + r1) to the start of the toe radius
  (z = a - r2): it is not one of the angle's four bounding faces (y = 0, y = a, z = 0, z = a);
- b2 is a 40 x 40 profile centred on its design line. Its faces are its bounding planes, grooves
  and all (the T-slot decision of the gap A3 note);
- c1 bolts b2 to b1 with one M12 at 100 along b1. The station sits on b1's face toward b2, on
  that face's centre line: level with b1's box centre across it (§4.3's u, which runs along local
  +y, world +Z, on a face that faces local ±x). The bolt runs along that face's outward normal and
  passes each layer from face to face; the grip is the layers' depths plus the declared gaps, and
  the bolt's length through the layers runs from the face its head bears on to the last layer's
  far face. The clearance hole is ISO 273's medium series: 13.5 for M12.
"""

import json
import os

TOL = 0.01  # mm: coplanar faces, a point on a face (design §2)

A, T, R1, R2 = 76.2, 6.35, 9.525, 4.76
BLOCK = 40.0
CLEARANCE_M12 = 13.5


def overlap(lo1, hi1, lo2, hi2):
    return min(hi1, hi2) - max(lo1, lo2)


def leg_material_y(z):
    """Where the angle's material lies along y on a line at height z, above the root fillet."""
    assert T + R1 < z < A - R2, "the line crosses the root fillet or the toe"
    return [(0.0, T)]  # only the upright leg: the horizontal leg ends at z = t, its fillet at t + r1


def angle_case(block_y, block_z=50.0, across=0.0, gap=0.0):
    """The block centred at (y, z) = (block_y, block_z) beside the upright leg, inside or outside."""
    y0, y1 = block_y - BLOCK / 2, block_y + BLOCK / 2
    z0, z1 = block_z - BLOCK / 2, block_z + BLOCK / 2
    if y0 >= T - TOL:  # inside the angle: the leg's inner face y = t meets the block's -y face
        face_y, axis, flat = T, +1.0, (T + R1, A - R2)
        bearing = y0 - face_y  # the block's face, beyond the leg's
    else:  # outside: the leg's outer face y = 0 (a bounding face) meets the block's +y face
        face_y, axis, flat = 0.0, -1.0, (0.0, A)
        bearing = face_y - y1
    contact = abs(bearing - gap) <= TOL and overlap(flat[0], flat[1], z0, z1) > TOL
    if not contact:
        return {"contact": False}
    # The station: on the face's plane, level with the box's centre (z = a / 2), then across.
    z = A / 2 + across
    assert flat[0] - TOL <= z <= flat[1] + TOL and z0 <= z <= z1, "the station is off a face"
    point = (100.0, face_y, z)
    (m0, m1) = leg_material_y(z)[0]
    leg = m1 - m0  # the bolt passes the leg from face to face
    grip = leg + gap + BLOCK
    return {
        "contact": True,
        "point": point,
        "axis_y": axis,
        "grip": grip,
        # From the leg's far face, where the head bears, to the block's far face.
        "length": leg + gap + BLOCK,
        # The block's hole lies at the station's height, from its own face's centre line (z = 50).
        "block_hole_across": z - block_z,
    }


def channel_case():
    """The 100 x 50 channel (web 6 on -y, flanges 8, open toward +y), centred; a 40 x 40 on the
    bottom flange's inner face, centred at (y, z) = (3, -22); the bolt at 3 across."""
    flange_inner, flange_outer, top_inner, top_outer = -42.0, -50.0, 42.0, 50.0
    web_inner, toe = -19.0, 25.0
    by, bz = 3.0, -22.0
    y0, y1, z0 = by - BLOCK / 2, by + BLOCK / 2, bz - BLOCK / 2
    contact = abs(z0 - flange_inner) <= TOL and overlap(web_inner, toe, y0, y1) > TOL
    # The station: on the inner face's plane, level with the box's centre (y = 0), 3 across.
    point = (100.0, 0.0 + 3.0, flange_inner)
    # On the line y = 3 the channel's material is both flanges; the bolt passes the bottom one.
    material = [(flange_outer, flange_inner), (top_inner, top_outer)]
    flange = material[0][1] - material[0][0]
    return {
        "contact": contact,
        "point": point,
        "grip": flange + BLOCK,
        "length": flange + BLOCK,
        # Drilled from the flange's outer face; the top flange stands on the same line, so the
        # hole stops at the flange's inner face instead of going through the section.
        "flange_hole_depth": flange,
    }


def r2(x):
    return round(x + 0.0, 2)


cases = {
    "base": angle_case(26.35),
    "the outer face": angle_case(-20.0),
    "0.1 mm off the inner face": angle_case(26.45),
    "0.1 mm off, declared as a gap": angle_case(26.45, gap=0.1),
    "across 11.9: through the block's centre": angle_case(26.35, across=11.9),
    "a channel's inner flange": channel_case(),
}
# Before gap A3 the outer case's bolt counted the angle's whole bounding box along Y.
old_outer_grip = A + BLOCK

for name, c in cases.items():
    if not c["contact"]:
        print(f"{name}: not in contact (an error)")
        continue
    p = ", ".join(f"{r2(v):.2f}" for v in c["point"])
    print(f"{name}: station ({p}), grip {r2(c['grip']):.2f}, length through the layers {r2(c['length']):.2f}")
print(f"the outer face before gap A3: grip {r2(old_outer_grip):.2f} (the box, 76.20, not the leg)")
print(f"clearance hole for M12: {CLEARANCE_M12}")

here = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(here, "expected.json"), encoding="utf-8") as f:
    expected = json.load(f)
by_name = {"base": expected["expect"]}
for c in expected.get("cases", []):
    by_name[c["name"]] = c["expect"]

mismatches = []


def check(name, what, hand, want):
    if want is None or abs(r2(hand) - want) > 0.005:
        mismatches.append(f"{name} {what}: hand {r2(hand)}, expected.json {want}")


for name, c in cases.items():
    want = by_name.get(name)
    if want is None:
        mismatches.append(f"{name}: no such case in expected.json")
        continue
    if not c["contact"]:
        if [e["code"] for e in want["errors"]] != ["face"]:
            mismatches.append(f"{name}: hand finds no contact, expected.json {want['errors']}")
        continue
    f = want.get("fastenings", {}).get("c1", {})
    check(name, "grip", c["grip"], (f.get("grip_mm") or [None])[0])
    check(name, "length", c["length"], (f.get("length_mm") or [None])[0])
    for i, v in enumerate(c["point"]):
        check(name, f"point[{i}]", v, ((f.get("point_mm") or [[None] * 3])[0])[i])
    holes = want.get("holes", {})
    if holes and holes.get("d_mm") != [CLEARANCE_M12]:
        mismatches.append(f"{name} hole d: hand {CLEARANCE_M12}, expected.json {holes.get('d_mm')}")
    ops = holes.get("ops", {})
    if "block_hole_across" in c and "b2" in ops:
        check(name, "b2 hole across", c["block_hole_across"], ops["b2"][0].get("across_mm", 0))
    if "flange_hole_depth" in c:
        check(name, "b1 hole depth", c["flange_hole_depth"], ops.get("b1", [{}])[0].get("depth_mm"))

if mismatches:
    print("\nMISMATCH")
    for m in mismatches:
        print("  " + m)
    raise SystemExit(1)
print("\nexpected.json agrees with the hand calculation")
