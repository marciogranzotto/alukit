"""G51, members marked context (a bench beside the frame, the floor and a wall), worked by hand.

This script is the hand calculation of G51's cut list, bill of materials, order, bbox() and the
machining made in place, written independently of AluKit: it imports nothing from it, reads the
case's document and the test catalog's numbers as data, and works each value with plain
arithmetic. It prints them and checks them against expected.json beside it.

Run: python3 -I tests/fixtures/golden-gen/G51/by_hand.py (exit 1 on any mismatch).

The rules (docs/notes/x11.md):

- A member is context when it says `context: true` (a bar or a placed part). It is drawn and the
  checks read it, but it is not cut, counted, bought or weighed, and it is not in bbox().
- A connection is context when every member it joins is context (here the splice c1, of b4 and b5):
  what it brings (the splice and its stud) is not counted, and its machining (a tap in each end it
  joins) is the context's own, listed nowhere. A connection with a built member is built.
- Machining on a context member that the build makes (a hole a person writes on it, or one a built
  connection makes in it) is listed in place, from the member's own ends.
- A part on a context bar's station is built unless it says otherwise.

The numbers: test:TS40 is a 40 x 40 section centred on its line, 1.493 kg/m, cut to length by its
supplier at 126.50 a metre, ordered to the millimetre and billed in 10 mm steps. test:BRK-40 is a
bracket, 0.15 kg, 8.90, its box [0, -20, 0]..[40, 20, 40] in its own frame. test:SPL-40 is a
splice, 0.05 kg, 24.00, with one stud test:SPL-STUD (0.015 kg, no offer) and an M8 tap 20 deep in
each end it joins. The placeholders give no mass and no price.
"""

import json
import os
from decimal import ROUND_HALF_UP, Decimal

HERE = os.path.dirname(os.path.abspath(__file__))
TS40_KG_M, TS40_MINOR_M, HALF = 1.493, 12650, 20.0
MASS = {"test:TS40": None, "test:BRK-40": 0.15, "test:SPL-40": 0.05, "test:SPL-STUD": 0.015}
PRICE = {"test:BRK-40": 890, "test:SPL-40": 2400}  # per unit; the stud has no offer
KINDS = ["bar", "connector", "fastener", "placeholder"]
KIND = {"test:TS40": "bar", "test:BRK-40": "connector", "test:SPL-40": "connector",
        "test:SPL-STUD": "fastener", "project:FLOOR": "placeholder", "project:WALL": "placeholder"}


def r3(x):
    return float(Decimal(repr(x)).quantize(Decimal("0.001"), rounding=ROUND_HALF_UP))


def merge(target, patch):
    if not isinstance(patch, dict):
        return patch
    out = dict(target) if isinstance(target, dict) else {}
    for k, v in patch.items():
        if v is None:
            out.pop(k, None)
        else:
            out[k] = merge(out.get(k), v)
    return out


def length(bar):
    return sum((b - a) ** 2 for a, b in zip(bar["a"], bar["b"])) ** 0.5


def bar_box(bar):
    """The 40 x 40 section swept between square ends: the axis's extent, 20 either side across."""
    lo = [min(a, b) for a, b in zip(bar["a"], bar["b"])]
    hi = [max(a, b) for a, b in zip(bar["a"], bar["b"])]
    for i in range(3):
        if bar["a"][i] == bar["b"][i]:
            lo[i] -= HALF
            hi[i] += HALF
    return lo, hi


def bracket_box(doc, part):
    """BRK-40 on a vertical post's +x face: its +z along world +X from the face (x = 20 off the
    line), its +x along the post (world +Z), its +y = z x x = world -Y; its box [0,-20,0]..[40,20,40]."""
    on = part["on"]
    post = doc["bars"][on["bar"]]
    x0, y0, z0 = post["a"][0] + HALF, post["a"][1], post["a"][2] + on["at_mm"]
    return [x0, y0 - 20, z0], [x0 + 40, y0 + 20, z0 + 40]


def placeholder_box(doc, part):
    item = doc["items"][part["item"].split(":")[1]]
    (a, b), p = item["bbox_mm"], part["at"]["pos"]
    return [p[i] + a[i] for i in range(3)], [p[i] + b[i] for i in range(3)]


def machining(doc, ctx_conns):
    """Per bar, its machining as (from, words): the holes written on it, then the splice's taps."""
    out = {bid: [] for bid in doc["bars"]}
    for bid, bar in doc["bars"].items():
        for op in bar.get("ops", []):
            out[bid].append(("a", op["at_mm"], f"Ø{op['d_mm']:.2f} hole {op['at_mm']:.2f} mm from end a on face {op['face']}", None))
    for cid, c in doc["connections"].items():
        for end in c["ends"]:
            bid, e = end.split(".")
            out[bid].append((e, 0, "tap M8 in end {}, 20.00 deep", cid))
    return out


def piece_words(ops, flip):
    """A piece's machining as the cut list lists it, from end a first; flipped end for end."""
    words = []
    for frm, at, text, _ in ops:
        e = {"a": "b", "b": "a"}[frm] if flip else frm
        words.append((e, text.format(e)))
    return [w for _, w in sorted(words)]


def work(doc):
    bars, parts, conns = doc["bars"], doc["parts"], doc["connections"]
    ctx = {k for k, v in {**bars, **parts}.items() if v.get("context")}
    ctx_conns = {cid for cid, c in conns.items()
                 if all(e.split(".")[0] in ctx for e in c["ends"])}
    ops = machining(doc, ctx_conns)

    # The cut list: the built bars' pieces, each in the orientation whose machining lists first.
    pieces = []
    for bid, bar in bars.items():
        if bid in ctx:
            continue
        mine = [o for o in ops[bid] if o[3] is None or o[3] not in ctx_conns]
        words = min(piece_words(mine, False), piece_words(mine, True))
        pieces.append((round(length(bar), 2), tuple(words)))
    groups = {}
    for p in pieces:
        groups[p] = groups.get(p, 0) + 1
    lines = [{"count": n, "cut_mm": cut, "machining": list(w)}
             for (cut, w), n in sorted(groups.items(), key=lambda kv: -kv[0][0])]

    # The BOM: the built bars, parts and the built connections' splice and stud.
    count = {}
    centre = {}
    for bid, bar in bars.items():
        if bid not in ctx:
            count["test:TS40"] = count.get("test:TS40", 0) + 1
            centre["test:TS40"] = centre.get("test:TS40", 0) + length(bar)
    for pid, part in parts.items():
        if pid not in ctx:
            count[part["item"]] = count.get(part["item"], 0) + 1
    for cid, c in conns.items():
        if cid not in ctx_conns:
            for item in ("test:SPL-40", "test:SPL-STUD"):
                count[item] = count.get(item, 0) + 1
    bom = []
    for kind in KINDS:
        for item in sorted(i for i in count if KIND[i] == kind):
            line = {"item": item, "qty": count[item]}
            if item == "test:TS40":
                line["length_mm"] = round(centre[item], 2)
                line["mass_kg"] = r3(centre[item] * TS40_KG_M / 1000)
            elif MASS.get(item) is not None:
                line["mass_kg"] = r3(count[item] * MASS[item])
            bom.append(line)
    listed_apart = [{"id": k, "item": (bars.get(k) or parts.get(k))["item"]}
                    for k in sorted(ctx, key=lambda s: (s[0], int(s[1:])))]
    mass = r3(sum(l.get("mass_kg", 0) for l in bom))

    # bbox(): the built bodies only.
    boxes = [bar_box(bar) for bid, bar in bars.items() if bid not in ctx]
    for pid, part in parts.items():
        if pid in ctx:
            continue
        boxes.append(bracket_box(doc, part) if "on" in part else placeholder_box(doc, part))
    lo = [min(b[0][i] for b in boxes) for i in range(3)]
    hi = [max(b[1][i] for b in boxes) for i in range(3)]
    bbox = [round(hi[i] - lo[i], 2) for i in range(3)]

    # Made in place: a context bar's machining that no context connection made, from its own ends.
    in_place = []
    for bid in sorted(bars, key=lambda s: int(s[1:])):
        if bid not in ctx:
            continue
        mine = [o for o in ops[bid] if o[3] is None or o[3] not in ctx_conns]
        if mine:
            in_place.append({"bar": bid, "machining": piece_words(mine, False)})

    # The order: blocked by a placeholder line, a line with no offer (the stud) or a supplier-cut
    # piece's machining, which no cost line prices here.
    blocked = (any(KIND[i] == "placeholder" for i in count) or "test:SPL-STUD" in count
               or any(l["machining"] for l in lines))
    order = {"status": "BLOCKED" if blocked else "READY"}
    if not blocked:
        money = {"test:TS40": sum(l["count"] * TS40_MINOR_M * (-(-l["cut_mm"] // 10) * 10) // 1000
                                  for l in lines)}
        money.update({i: count[i] * PRICE[i] for i in count if i in PRICE})
        m = lambda v: {"low_minor": v, "likely_minor": v, "high_minor": v}
        order["lines"] = {i: m(v) for i, v in money.items()}
        order["total"] = m(sum(money.values()))
    return {"lines": lines, "bom_lines": bom, "bom_context": listed_apart, "mass_kg": mass,
            "bbox_mm": bbox, "in_place": in_place, "order": order}


with open(os.path.join(HERE, "alukit.json"), encoding="utf-8") as f:
    base = json.load(f)
with open(os.path.join(HERE, "expected.json"), encoding="utf-8") as f:
    expected = json.load(f)

cases = [("base", base, expected["expect"])]
for c in expected["cases"]:
    cases.append((c["name"], merge(base, c["patch"]), c["expect"]))

mismatches = []
for name, doc, want in cases:
    got = work(doc)
    print(f"{name}: cut {[(l['count'], l['cut_mm']) for l in got['lines']]}, "
          f"BOM {[(l['item'], l['qty']) for l in got['bom_lines']]} {got['mass_kg']} kg, "
          f"bbox {got['bbox_mm']}, in place {got['in_place']}, order {got['order']['status']}")
    want_lines = [{k: l[k] for k in ("count", "cut_mm", "machining")} for l in want["lines"]["test:TS40"]]
    checks = [("cut list", want_lines, got["lines"])]
    for key in ("bom_lines", "bom_context", "mass_kg", "bbox_mm", "in_place"):
        checks.append((key, want[key], got[key]))
    checks.append(("order", want["order"], got["order"]))
    for what, w, g in checks:
        if w != g:
            mismatches.append(f"{name} {what}: hand {g}, expected.json {w}")

if mismatches:
    print("\nMISMATCH")
    for m in mismatches:
        print("  " + m)
    raise SystemExit(1)
print("\nexpected.json agrees with the hand calculation")
