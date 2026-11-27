"""Building catalogs/forseti from a shop snapshot and the PDF catalogue (design §11 steps 1–3).

Facts only: every item and offer field comes from the snapshot or the PDF, through the parsers
and the reviewed tables, with the source and read date in its provenance. Modelling that no
source states (mounting geometry, fits, clone references) is layer 2, in families/.
"""

from __future__ import annotations

import json
import os
import re
import statistics
from collections import defaultdict
from decimal import Decimal

from . import emit, geometry, pdfcat, rest, store, tables, trace

#: The catalog's hand-written overrides (design §3.1), which correct printed values: a trace is
#: checked against the published values after them (§3.5's authority rule).
OVERRIDES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "catalogs",
                         "forseti", "overrides.json")

API = "https://loja.forsetisolucoes.com.br/wp-json/wc/store/v1/products"
WALK = ("-y", "+x", "+y", "-x")
#: A groove's dimensions, in the order a groove type lists them (src/catalog/schema/groove.ts).
GROOVE_DIMS = ("opening_mm", "lip_mm", "depth_mm", "undercut_mm", "taper_from_mm", "bottom_mm",
               "hook_mm", "wall_mm")


def num(d: Decimal) -> int | float:
    return int(d) if d == d.to_integral_value() else float(d)


def pdf_ref(page: int) -> str:
    return f"pdf:{tables.PDF}#p{page}"


class Build:
    def __init__(self, snap: store.Snapshot, doc) -> None:
        self.snap = snap
        self.doc = doc
        self.items: dict[str, dict] = {}
        self.offers: dict[str, dict] = {}
        self.sections: dict[str, dict] = {}
        self.grooves: dict[str, dict] = {}
        self.systems: dict[str, dict] = {}
        self.materials: dict[str, dict] = {}
        self.notes: dict[str, list[str]] = defaultdict(list)
        self.outlines: dict[str, pdfcat.Outline] = {}
        with open(OVERRIDES, encoding="utf-8") as f:
            self.overrides: list[dict] = json.load(f)["overrides"]

    # --- provenance and common fields ----------------------------------------------------------

    def shop_prov(self, p: dict) -> dict:
        return {"src": "src", "ref": f"url:{p['permalink']}", "read": self.snap.read}

    def pdf_prov(self, page: int) -> dict:
        return {"src": "src", "ref": pdf_ref(page), "read": tables.PDF_READ}

    def price(self, x: dict, per: str, times: int = 1) -> dict:
        regular, sale = store.price(x)
        ref = f"url:{API}/{x['id']}"
        if times == 1 and regular == 0:
            # The shop lists some variants at 0 (placeholders). The price says so, in its own field.
            return {"regular_minor": {"v": 0, "src": "src", "note": "listed at a price of 0 by the shop; no real price"},
                    "sale_minor": sale, "per": per, "read": self.snap.read, "src": "src", "ref": ref}
        if times == 1:
            return {"regular_minor": regular, "sale_minor": sale, "per": per,
                    "read": self.snap.read, "src": "src", "ref": ref}
        note = f"{times} × the shop's price per metre"
        return {
            "regular_minor": {"v": regular * times, "src": "calc", "note": f"{note}, {regular}"},
            "sale_minor": None if sale is None else {"v": sale * times, "src": "calc", "note": f"{note}, {sale}"},
            "per": per, "read": self.snap.read, "src": "calc", "ref": ref,
        }

    @staticmethod
    def brand(p: dict) -> str | None:
        for a in p.get("attributes") or []:
            if a["name"] == "Marca" and a.get("terms"):
                return a["terms"][0]["name"]
        return None

    def offer(self, key: str, item: str, x: dict, per: str, **extra) -> None:
        if key in self.offers:
            raise ValueError(f"offer {key} twice")
        o: dict = {"item": item}
        for k in ("sku", "options", "pack", "kit", "sale"):
            if extra.get(k) is not None:
                o[k] = extra[k]
        o["price"] = self.price(x, per, extra.get("times", 1))
        o["in_stock"] = bool(x.get("is_in_stock"))
        o["url"] = x["permalink"]
        w = store.weight(x)
        if w is not None:
            o["ship_mass_kg"] = w
        self.offers[key] = o

    def item(self, iid: str, fields: dict) -> None:
        """Adds an item, or checks that a second product describing it agrees."""
        prev = self.items.get(iid)
        if prev is None:
            self.items[iid] = fields
            return
        for name, values in (fields.get("options") or {}).items():
            have = prev.setdefault("options", {}).setdefault(name, [])
            have.extend(v for v in values if v not in have)
        if {k: v for k, v in prev.items() if k not in ("url", "prov", "options")} != {
            k: v for k, v in fields.items() if k not in ("url", "prov", "options")
        }:
            diff = {k: (prev.get(k), fields.get(k)) for k in set(prev) | set(fields)
                    if k not in ("url", "prov", "options") and prev.get(k) != fields.get(k)}
            raise ValueError(f"item {iid}: two products describe it differently: {diff}")

    # --- material, grooves, systems -------------------------------------------------------------

    def material(self) -> None:
        page = tables.MATERIAL_PAGE
        t = self.doc[page - 1].get_text()
        alloy = re.search(r"LIGA:\s*(\d{4})", t)
        temper = re.search(r"TRATAMENTO TÉRMICO:\s*(T\d)", t)
        dens = re.search(r"DENSIDADE:\s*(\d+)\s*Kg/m3", t)
        e = re.search(r"ESLASTICIDADE:\s*(\d+)\s*N/mm2", t)
        if not (alloy and temper and dens and e):
            raise ValueError(f"p. {page}: the alloy data is not where it was")
        self.materials[f"al-{alloy.group(1)}-{temper.group(1).lower()}"] = {
            "name": f"Alumínio {alloy.group(1)} {temper.group(1)}",
            "alloy": alloy.group(1),
            "temper": temper.group(1),
            "E_MPa": int(e.group(1)),
            "density_kg_per_m3": int(dens.group(1)),
            "prov": self.pdf_prov(page),
        }

    def groove_types(self) -> None:
        for gid, src in tables.GROOVE_SOURCE.items():
            spec = tables.PROFILES[src["profile"]]
            o = self.outlines[src["profile"]]
            d = pdfcat.measure_groove(o.outline, o.holes, spec["w"], spec["h"], src["face"], src["at_mm"])
            if abs(d.opening_mm - src["printed_opening_mm"]) > 0.15:
                raise ValueError(f"{gid}: measured opening {d.opening_mm}, printed {src['printed_opening_mm']}")
            gt: dict = {"opening_mm": d.opening_mm, "lip_mm": d.lip_mm, "depth_mm": d.depth_mm,
                        "undercut_mm": d.undercut_mm}
            if d.taper_from_mm is not None:
                gt["taper_from_mm"] = d.taper_from_mm
                gt["bottom_mm"] = d.bottom_mm
            if d.hook_mm is not None:
                gt["hook_mm"] = d.hook_mm
                gt["wall_mm"] = d.wall_mm
            gt["class"] = "standard"
            gt["prov"] = {
                "src": "calc",
                "ref": pdf_ref(src["page"]),
                "read": tables.PDF_READ,
                "note": (
                    f"measured along the centre line of the groove on face {src['face']} at "
                    f"{src['at_mm']} mm of the vector outline of {src['profile']}; printed opening "
                    f"{src['printed_opening_mm']} mm"
                ),
            }
            self.grooves[gid] = gt

    def corner_holes(self) -> None:
        """Checks CORNER_HOLES against the exact outlines it names, as groove types are checked:
        each must have a core of that diameter at each corner, `inset` in from both faces. The
        parametric sections marked `corners` take the table's values."""
        c = tables.CORNER_HOLES
        for stem in c["measured_on"]:
            spec = tables.PROFILES[stem]
            x, y = spec["w"] / 2 - c["inset"], spec["h"] / 2 - c["inset"]
            want = sorted((sx * x, sy * y) for sx in (-1, 1) for sy in (-1, 1))
            have = sorted(tuple(k["at_mm"]) for k in self.sections[stem]["cores"] if k["d_mm"] == c["d"])
            if len(have) != 4 or any(abs(a - b) > 1e-9 for p, q in zip(have, want) for a, b in zip(p, q)):
                raise ValueError(f"corner holes: {stem}'s outline has Ø{c['d']} cores at {have}, "
                                 f"not {c['inset']} mm in from both faces at {want}")

    # --- profiles ---------------------------------------------------------------------------------

    def profiles(self) -> None:
        printed = pdfcat.profile_tables(self.doc, list(range(10, 22)))
        stems: dict[str, list[tuple[str, dict]]] = defaultdict(list)
        for p in self.snap.products:
            if store.family_of(p) != "profile":
                continue
            m = tables.PROFILE_SKU.match(p["sku"])
            finish = "black" if m.group(2) else "anodised"
            cats = {c["name"] for c in p["categories"]}
            if ("Pintura preta" in cats) != (finish == "black"):
                raise ValueError(f"{p['sku']}: the SKU and the categories disagree on the finish")
            stems[m.group(1)].append((finish, p))
        for stem in emit.sorted_ids(stems):
            if stem not in tables.PROFILES:
                raise ValueError(f"{stem}: a profile stem the tables do not name")
            key = tables.PROFILES[stem].get("printed", stem)
            if key is not None and key not in printed:
                raise ValueError(f"{stem}: no table for {key} in the catalogue")
            self.profile(stem, sorted(stems[stem], key=lambda fp: (fp[0] != "anodised", fp[1]["id"])),
                         printed[key] if key else None)
        missing = sorted(set(tables.PROFILES) - set(stems))
        if missing:
            raise ValueError(f"profile stems in the tables but not in the shop: {missing}")

    def profile(self, stem: str, products: list[tuple[str, dict]], pr: pdfcat.Printed | None) -> None:
        spec = tables.PROFILES[stem]
        w, h, page = spec["w"], spec["h"], spec["page"]
        main = products[0][1]
        prov = self.pdf_prov(page) if page else self.shop_prov(main)
        name = re.sub(r"\s*[–-]\s*(Anodizado Fosco|Pintura Preta)\s*$", "", store.name(main), flags=re.I)
        desc = store.text(main.get("description"))
        m = re.search(r"Canal (\d+)", store.name(main))
        slot = tables.SLOT_BY_STEM.get(stem) or (int(m.group(1)) if m else None)
        tap = re.search(r"Centro permite rosca:\s*(M\d+)", desc)
        if spec["bore"] is not None:
            # Every core's thread labels come from the table; one said to be the shop's must be in
            # the description.
            if stem not in tables.CORE_THREADS:
                raise ValueError(f"{stem}: a bore with no CORE_THREADS entry")
            labels, said = tables.CORE_THREADS[stem]
            missing = [t for t in labels if said == "shop" and not re.search(rf"\b{re.escape(t)}\b", desc)]
            if missing:
                raise ValueError(f"{stem}: the shop's description does not name {missing}")
        series = int(stem[2:4])
        if (series, slot) not in tables.SYSTEMS:
            raise ValueError(f"{stem}: no system for series {series}, slot {slot}")
        sys_id, gid, sys_name = tables.SYSTEMS[(series, slot)]
        self.systems[sys_id] = {"type": "tslot", "series_mm": series, "groove": gid, "name": sys_name}
        if pr is not None:
            if pr.A_cm2 is None or pr.IX_cm4 is None or pr.IY_cm4 is None or pr.kg_per_m is None:
                raise ValueError(f"{stem}: incomplete table on p. {pr.page}")
            # Every other printed mass is its area times the alloy's density (survey §7): a table
            # that is not gets reported, and the printed values stay the authority.
            expect = float(pr.A_cm2) * 0.27
            if abs(float(pr.kg_per_m) - expect) > 0.015 * expect:
                self.notes["printed mass differs from area x density by more than 1.5 %"].append(
                    f"{stem}: p. {pr.page} prints {pr.kg_per_m} kg/m for {pr.A_cm2} cm2 ({expect:.3f})")
        # No usable table: the mass is the one the shop's description states, if it does.
        shop_mass = re.search(r"Peso[^0-9]{0,25}(\d+,\d+)\s*kg\s*/\s*m", desc) if pr is None else None
        grooves = []
        for face in WALK:
            length = w if face in ("-y", "+y") else h
            n = round(length / series)
            grooves.extend({"face": face, "at_mm": num(Decimal(str((i - (n - 1) / 2) * series)))}
                           for i in range(n))
        if "outline" in spec:
            self.exact_section(stem, spec, grooves, gid)
        else:
            refused = None
            if stem in tables.TRACES:
                mass = Decimal(shop_mass.group(1).replace(",", ".")) if shop_mass else None
                refused = self.traced_section(stem, spec, grooves, gid, pr, mass)
            if stem not in self.sections:
                self.parametric_section(stem, spec, grooves, gid, main["permalink"], refused)
        if pr is not None:
            ix, iy = self.printed_axes(stem, w, h, pr)
        core: dict = {"bore_mm": spec["bore"]} if spec["bore"] is not None else {}
        if tap:
            core["tap"] = tap.group(1)
        finishes = [f for f, _ in products]
        if len(set(finishes)) != len(finishes):
            raise ValueError(f"{stem}: two products in one finish")
        it = {"kind": "bar", "name": name, "code": stem}
        if self.brand(main):
            it["brand"] = self.brand(main)
        it |= {"url": main["permalink"]}
        docs = [{"ref": pdf_ref(n)} for n in dict.fromkeys(n for n in (page, pr.page if pr else None) if n)]
        if docs:
            it["docs"] = docs
        it |= {"material": next(iter(self.materials)), "shape": "tslot", "section": stem, "system": sys_id}
        if pr is not None:
            it |= {
                "mass_kg_per_m": num(pr.kg_per_m),
                "area_mm2": num(pr.A_cm2 * 100),
                "Ix_mm4": num(ix * 10000),
                "Iy_mm4": num(iy * 10000),
            }
        else:
            m = shop_mass
            if m:
                it["mass_kg_per_m"] = {
                    "v": num(Decimal(m.group(1).replace(",", "."))), "src": "src",
                    "ref": f"url:{main['permalink']}", "read": self.snap.read,
                    "note": "the shop's description; the catalogue has no table for this profile",
                }
            else:
                self.notes["profiles with no published mass"].append(stem)
        if core:
            it["core"] = core
        it |= {"options": {"finish": finishes}, "prov": prov}
        self.item(stem, it)
        for finish, p in products:
            page_html = self.snap.page(p["id"])
            fix = tables.CUT_STEP_FIX.get(p["sku"])
            rule = store.cut_rule(page_html, fix[0] if fix else None) if page_html else None
            if fix and isinstance(rule, store.CutRule):
                self.notes["price steps taken from the table"].append(f"{p['sku']}: {fix[1]}")
            if rule is None:
                raise ValueError(f"{p['sku']}: no cut rule on its product page")
            if isinstance(rule, store.CutRule):
                sale = {"mode": "cut", "min_mm": rule.min_mm, "max_mm": rule.max_mm, "tol_mm": rule.tol_mm,
                        "res_mm": rule.res_mm, "step_mm": rule.step_mm}
                self.offer(p["sku"], stem, p, "m", options={"finish": finish}, sale=sale)
                # A simple product the shop gives variations (its black twin, say) sells by the
                # same rule, under the variation's SKU.
                for c in self.snap.children.get(p["id"], []):
                    cf = "black" if "-PP" in c["sku"].upper() else None
                    if cf is None:
                        raise ValueError(f"{c['sku']}: a variation of a profile the tables do not handle")
                    self.offer(c["sku"], stem, c, "m", options={"finish": cf}, sale=sale)
            else:
                for length in rule.lengths_mm:
                    self.offer(f"{p['sku']}.{length}", stem, p, "bar", sku=p["sku"],
                               options={"finish": finish}, sale={"mode": "stock", "length_mm": length},
                               times=length // 1000)

    def exact_section(self, stem: str, spec: dict, grooves: list[dict], gid: str) -> None:
        o = pdfcat.extract_outline(self.doc, spec["page"], spec["outline"], spec["drawn"], (spec["w"], spec["h"]))
        self.outlines[stem] = o
        turned = spec["drawn"] != (spec["w"], spec["h"])
        note = (
            f"vector path of {o.segments} segments; the outline is the stroke centreline. "
            + (f"Drawn {spec['drawn'][0]}x{spec['drawn'][1]}, turned 90° counter-clockwise into "
               f"the section frame. " if turned else "")
            + "Centred on its box, coordinates rounded to 0.0001 mm."
        )
        w2, h2 = spec["w"] / 2, spec["h"] / 2
        cores = self.drawn_cores(stem, spec, o)
        printed = ", ".join(f"Ø{num(Decimal(str(d)))} ×{n}" for d, n in spec["cores"].items())
        note += (f" Cores: the holes whose inscribed circle is a bore the page prints ({printed}, "
                 f"each within {tables.CORE_MATCH_MM} mm), centred on the hole to "
                 f"{tables.CORE_GRID_MM} mm. "
                 + self.labels_note(stem, stem in tables.CORNER_HOLES["measured_on"]) + ".")
        self.sections[stem] = {
            "schema": "alukit.section/1",
            "id": stem,
            "fidelity": "exact",
            "props_ok": True,
            "from": {"ref": pdf_ref(spec["page"]), "method": "vector",
                     "scale": f"width {spec['drawn'][0]} mm", "read": tables.PDF_READ, "note": note},
            "bbox_mm": [[num(Decimal(str(-w2))), num(Decimal(str(-h2)))],
                        [num(Decimal(str(w2))), num(Decimal(str(h2)))]],
            "grooves": [{**gr, "type": gid} for gr in grooves],
            "cores": cores,
            "outline": [list(pt) for pt in o.outline],
            "holes": [[list(pt) for pt in hole] for hole in o.holes],
        }
        own = self.own_groove(stem, spec, grooves, o)
        if own:
            self.sections[stem]["groove_dims"] = own

    def own_groove(self, stem: str, spec: dict, grooves: list[dict], o: pdfcat.Outline | None) -> dict | None:
        """The section's own groove dimensions (after the round-4 acceptance, F9): the reviewed
        OWN_GROOVES entry, else, on an exact outline, the median over its grooves of what
        `measure_groove` measures. None for a section a groove type is measured on (the type is
        its own groove) and for a parametric one the tables do not read."""
        t = tables.OWN_GROOVES.get(stem)
        if t is not None:
            out: dict = {}
            for k, v in t.get("printed", {}).items():
                out[k] = {"v": v, "src": "src", "ref": pdf_ref(t["page"])}
            for k, (v, lo, hi) in t.get("read", {}).items():
                out[k] = {"v": v, "src": "est", "ref": pdf_ref(t["page"]), "low": lo, "high": hi}
            out = {k: out[k] for k in GROOVE_DIMS if k in out}
            if t.get("unread"):
                out["unread"] = [k for k in GROOVE_DIMS if k in t["unread"]]
            out["note"] = t["note"]
            return out
        if o is None or any(src["profile"] == stem for src in tables.GROOVE_SOURCE.values()):
            return None
        dims = [pdfcat.measure_groove(o.outline, o.holes, spec["w"], spec["h"], gr["face"], gr["at_mm"])
                for gr in grooves]
        out = {}
        for k in GROOVE_DIMS:
            vs = [getattr(d, k) for d in dims if getattr(d, k) is not None]
            if 2 * len(vs) > len(dims):
                out[k] = round(statistics.median(vs), 2)
        spread = max(max(getattr(d, k) for d in dims) - min(getattr(d, k) for d in dims)
                     for k in ("opening_mm", "lip_mm", "depth_mm", "undercut_mm"))
        out["note"] = (f"measured on this section's vector outline as its groove type is on its "
                       f"source profile's: the median over its {len(dims)} grooves, whose openings, "
                       f"lips, depths and undercuts differ by at most {spread:.2f} mm")
        return out

    @staticmethod
    def drawn_cores(stem: str, spec: dict, o: pdfcat.Outline) -> list[dict]:
        """The cores of an exact outline: each hole whose inscribed circle about its centroid is a
        bore the page prints (within CORE_MATCH_MM), at its centroid on the drawings' 0.1 mm grid,
        with the printed diameter. Fails unless the count of each printed diameter is met, or when
        a centre is off the grid by more than CORE_GRID_SLACK_MM."""
        grid = Decimal(str(tables.CORE_GRID_MM))
        found: list[tuple[float, Decimal, Decimal]] = []
        for hole in o.holes:
            cx, cy, d_in = geometry.inscribed(hole)
            match = [d for d in spec["cores"] if abs(d_in - d) <= tables.CORE_MATCH_MM]
            if not match:
                continue
            at = [(Decimal(repr(v)) / grid).quantize(Decimal(1)) * grid for v in (cx, cy)]
            off = max(abs(float(a) - v) for a, v in zip(at, (cx, cy)))
            if off > tables.CORE_GRID_SLACK_MM:
                raise ValueError(f"{stem}: a Ø{match[0]} core at ({cx:.4f}, {cy:.4f}) is {off:.3f} mm off "
                                 f"the {tables.CORE_GRID_MM} mm grid")
            found.append((match[0], at[0], at[1]))
        counts = {d: sum(1 for f in found if f[0] == d) for d in spec["cores"]}
        if counts != spec["cores"]:
            raise ValueError(f"{stem}: the outline's holes give cores {counts}; the page prints {spec['cores']}")
        found.sort(key=lambda f: (-f[0], f[2], f[1]))
        # The module cores take the profile's labels, the base-40 corner holes (on the outlines
        # CORNER_HOLES names) the series'. A bore of the corner holes' size is a module core
        # elsewhere: the 20x20 V-slot's Ø5.
        labels = {spec["bore"]: tables.CORE_THREADS[stem][0]}
        if stem in tables.CORNER_HOLES["measured_on"]:
            if spec["bore"] == tables.CORNER_HOLES["d"]:
                raise ValueError(f"{stem}: its module bore is the corner holes' size; the cores need telling apart")
            labels[tables.CORNER_HOLES["d"]] = tables.CORNER_HOLES["threads"]
        if set(spec["cores"]) - set(labels):
            raise ValueError(f"{stem}: no thread label for the cores {sorted(set(spec['cores']) - set(labels))}")
        return [{"at_mm": [num(x) + 0, num(y) + 0], "d_mm": num(Decimal(str(d))), "threads": labels[d]}
                for d, x, y in found]

    @staticmethod
    def labels_note(stem: str, corners: bool) -> str:
        """Where a section's core thread labels come from, for its note."""
        labels, said = tables.CORE_THREADS[stem]
        where = "the shop's description" if said == "shop" else f"the drawing on {said}"
        out = f"The {'module ' if corners else ''}cores are labelled {' and '.join(labels)} by {where}"
        if corners:
            out += (f", the corner holes {' and '.join(tables.CORNER_HOLES['threads'])} by the "
                    f"drawing on p. 20")
        return out

    # --- traced sections (fidelity `traced`, design §3.5) ----------------------------------------

    def printed_axes(self, stem: str, w: float, h: float, pr: pdfcat.Printed) -> tuple[Decimal, Decimal]:
        """The printed IX and IY as the section's Ix and Iy (about its x and y axes). For every
        rectangular profile the catalogue gives IX about the axis along the long side (sections
        stand tall, so IX is Iy). A square profile prints one value, or two when a face differs
        (the face-plate variants): the smaller then goes to the weaker axis of the section's
        outline, and stays in the drawing's order when the section has none to tell."""
        if w != h:
            return pr.IY_cm4, pr.IX_cm4
        if pr.IX_cm4 == pr.IY_cm4:
            return pr.IX_cm4, pr.IY_cm4
        s = self.sections[stem]
        if "outline" not in s:
            self.notes["square profiles printing two inertias, kept in the drawing's order (no outline "
                       "tells their weak axis)"].append(stem)
            return pr.IX_cm4, pr.IY_cm4
        p = geometry.props(s["outline"], s["holes"])
        lo, hi = sorted((pr.IX_cm4, pr.IY_cm4))
        ix, iy = (lo, hi) if p["Ix"] < p["Iy"] else (hi, lo)
        self.notes["square profiles printing two inertias, the smaller given to the outline's weaker "
                   "axis"].append(f"{stem}: Ix {ix}, Iy {iy} cm4 (IX {pr.IX_cm4}, IY {pr.IY_cm4} printed)")
        return ix, iy

    def published(self, stem: str, w: float, h: float, pr: pdfcat.Printed | None,
                  mass: Decimal | None, props: dict) -> dict[str, float]:
        """The published area and inertias a trace is checked against (after the catalog's
        overrides, which correct printed values): the printed table's, else the area of the shop's
        mass at the alloy's density."""
        out: dict[str, float] = {}
        density = next(iter(self.materials.values()))["density_kg_per_m3"]
        if pr is not None:
            out["area"] = float(pr.A_cm2) * 100
            if w != h:
                ix, iy = pr.IY_cm4, pr.IX_cm4
            else:
                lo, hi = sorted((pr.IX_cm4, pr.IY_cm4))
                ix, iy = (lo, hi) if props["Ix"] < props["Iy"] else (hi, lo)
            out["Ix"], out["Iy"] = float(ix) * 1e4, float(iy) * 1e4
        elif mass is not None:
            out["area"] = float(mass) / density * 1e6
        for o in self.overrides:
            if o["item"] == stem and "value" in o and o["field"] in ("area_mm2", "Ix_mm4", "Iy_mm4"):
                out[{"area_mm2": "area", "Ix_mm4": "Ix", "Iy_mm4": "Iy"}[o["field"]]] = float(o["value"])
        return out

    def traced_section(self, stem: str, spec: dict, grooves: list[dict], gid: str,
                       pr: pdfcat.Printed | None, mass: Decimal | None) -> str | None:
        """Traces the profile's raster image (`tables.TRACES`, forseti_importer/trace.py) and makes
        it the section when it agrees with the published area and inertias within
        TRACE_TOLERANCE; otherwise returns why it does not, for the parametric section's note."""
        t = tables.TRACES[stem]
        w, h = spec["w"], spec["h"]
        faces = t.get("faces", WALK)
        grooves = [gr for gr in grooves if gr["face"] in faces]
        tr = trace.trace_profile(self.doc, t, (w, h), grooves)
        cal = tr.cal
        u_sys = (cal.se_delta_mm ** 2 + tables.TRACE_METHOD_MM ** 2) ** 0.5
        u_px = 0.5 / cal.s
        # Cores: each a traced hole at its printed centre, its bore snapped to the printed diameter.
        holes = list(tr.holes)
        cores, worst, problems = [], 0.0, []
        for x, y, d, labels in self.printed_cores(stem, spec):
            at = [i for i, hole in enumerate(holes) if geometry.inside((x, y), hole)]
            if not at:
                problems.append(f"it has no hole at the core ({x}, {y}) the page prints")
                continue
            hole = holes[at[0]]
            d_tr = trace.bore(hole, (x, y))
            if abs(d_tr - d) > tables.TRACE_CORE_MM:
                problems.append(f"its bore about ({x}, {y}) is Ø{d_tr:.2f}, not the printed Ø{d} "
                                f"(within {tables.TRACE_CORE_MM} mm)")
                continue
            worst = max(worst, abs(d_tr - d))
            holes[at[0]] = trace.snap_bore(hole, (x, y), d)
            cores.append({"at_mm": [num(Decimal(str(x))) + 0, num(Decimal(str(y))) + 0],
                          "d_mm": num(Decimal(str(d))), "threads": labels})
        rnd = lambda ring: [[pdfcat._r(px), pdfcat._r(py)] for px, py in ring]  # noqa: E731
        outline, holes = rnd(tr.outline), [rnd(hole) for hole in holes]
        props = geometry.props(outline, holes)
        pub = self.published(stem, w, h, pr, mass, props)
        if "area" not in pub:
            return "no published area or mass to check its trace against"
        err = {k: props["A" if k == "area" else k] / v - 1 for k, v in pub.items()}
        tol = tables.TRACE_TOLERANCE
        said = ", ".join(f"{'the area' if k == 'area' else k} {e * 100:+.2f} %" for k, e in err.items())
        if not all(abs(e) <= tol["area" if k == "area" else "inertia"] for k, e in err.items()):
            problems.append(f"against the published values {said}, beyond the {tol['area'] * 100:g} % "
                            f"(area) and {tol['inertia'] * 100:g} % (inertia) a trace is held to")
        self.notes["traces left out" if problems else
                   "traced sections (area and inertias against the published)"].append(
            f"{stem}: {'; '.join(problems) if problems else said}")
        if problems:
            return "a trace of the page's raster image was left out: " + "; ".join(problems)
        res = max(abs(r) for _, r in cal.residuals_mm)
        printed = t["printed"]
        note = (
            f"traced from the page's raster image ({tr.source}): its edge at 50 % coverage by marching "
            f"squares, simplified by Douglas-Peucker at {trace.EPS_PX} px; the scale "
            f"({cal.sx:.3f} x {cal.sy:.3f} px/mm) and the outline stroke's margin "
            f"({cal.delta_mm:.3f} ± {cal.se_delta_mm:.3f} mm) fitted by least squares to the printed size"
            + (f" and the printed groove dimensions ({', '.join(f'{k[:-3]} {num(Decimal(str(v)))}' for k, v in printed.items())})"
               if printed else "")
            + (f" and {len(t['scans'])} dimensions printed behind the covers" if t.get("scans") else "")
            + f", residuals at most {res:.2f} mm; the margin taken off by an exact inner offset, the box "
            f"snapped to {w} x {h} (it was {tr.snap_mm[0]:+.3f}, {tr.snap_mm[1]:+.3f} mm off)"
            + (f", the cores' bores snapped to their printed diameters (at most {worst:.2f} mm off)"
               if cores else "")
            + f". Edges ±{u_sys:.3f} mm overall (the margin's standard error with "
            f"{tables.TRACE_METHOD_MM} mm, the method's largest error on the rasters drawn under vector "
            f"outlines) and ±{u_px:.2f} mm locally (half a pixel). Against the published values {said}"
            + (". Grooves on " + ", ".join(faces) + " only: the other faces are closed" if len(faces) < 4 else "")
            + ". " + self.labels_note(stem, bool(spec.get("corners"))) + "."
        )
        w2, h2 = w / 2, h / 2
        self.sections[stem] = {
            "schema": "alukit.section/1",
            "id": stem,
            "fidelity": "traced",
            "props_ok": True,
            "from": {"ref": pdf_ref(t["page"]), "method": "raster",
                     "scale": f"the printed size, {w} x {h} mm, and the dimensions the page prints",
                     "read": tables.PDF_READ, "note": note},
            "bbox_mm": [[num(Decimal(str(-w2))), num(Decimal(str(-h2)))],
                        [num(Decimal(str(w2))), num(Decimal(str(h2)))]],
            "grooves": [{**gr, "type": gid} for gr in grooves],
            "cores": sorted(cores, key=lambda c: (-c["d_mm"], c["at_mm"][1], c["at_mm"][0])),
            "outline": outline,
            "holes": holes,
        }
        own = self.traced_groove(stem, t, outline, holes, grooves, u_sys + u_px)
        if own:
            self.sections[stem]["groove_dims"] = own
        return None

    @staticmethod
    def printed_cores(stem: str, spec: dict) -> list[tuple[float, float, float, list[str]]]:
        """The cores a profile's page prints: its bores (`bores`, else one at the centre) and, on
        the base-40 profiles marked `corners`, the corner holes."""
        if spec["bore"] is None:
            return []
        labels = tables.CORE_THREADS[stem][0]
        out = [(x, y, spec["bore"], labels) for x, y in (spec.get("bores") or [(0, 0)])]
        if spec.get("corners"):
            c = tables.CORNER_HOLES
            x, y = spec["w"] / 2 - c["inset"], spec["h"] / 2 - c["inset"]
            out += [(sx * x, sy * y, c["d"], c["threads"]) for sy in (-1, 1) for sx in (-1, 1)]
        return out

    def traced_groove(self, stem: str, t: dict, outline: list, holes: list, grooves: list[dict],
                      u: float) -> dict | None:
        """A traced section's own groove: the dimensions its page prints, and the rest measured on
        the trace as on an exact outline (the median over its grooves), estimates within the
        trace's uncertainty and the grooves' spread."""
        w, h = tables.PROFILES[stem]["w"], tables.PROFILES[stem]["h"]
        dims = [pdfcat.measure_groove(outline, holes, w, h, gr["face"], gr["at_mm"], trace.GROOVE_START_MM)
                for gr in grooves]
        ref = pdf_ref(t["page"])
        apart = t.get("printed_only", {})
        printed = {**t["printed"], **{k: v for k, (v, _) in apart.items()}}
        out: dict = {}
        said = []
        for k in GROOVE_DIMS:
            vs = [getattr(d, k) for d in dims if getattr(d, k) is not None]
            if k in printed:
                out[k] = {"v": num(Decimal(str(printed[k]))), "src": "src", "ref": ref}
                if k in apart and vs:
                    said.append(f"the {k[:-3]} as printed, {num(Decimal(str(printed[k])))}, which the trace "
                                f"measures {statistics.median(vs):.2f}: {apart[k][1]}")
                continue
            if 2 * len(vs) <= len(dims):
                continue
            v = round(statistics.median(vs), 2)
            half = round(u + (max(vs) - min(vs)) / 2, 2)
            out[k] = {"v": v, "src": "est", "ref": ref, "low": round(v - half, 2), "high": round(v + half, 2)}
        out["note"] = (f"{'the dimensions p. ' + str(t['page']) + ' prints; the rest' if printed else 'all'} "
                       f"measured on the traced outline as on an exact one, the median over its "
                       f"{len(dims)} grooves, each range the trace's uncertainty and the grooves' spread"
                       + "".join(f"; {s}" for s in said))
        return out

    def parametric_section(self, stem: str, spec: dict, grooves: list[dict], gid: str, url: str,
                           refused: str | None = None) -> None:
        w, h = spec["w"], spec["h"]
        default = [{"face": f, "at_mm": 0} for f in WALK]
        params: dict = {"w_mm": w, "h_mm": h, "groove": gid}
        if grooves != default:
            params["grooves"] = grooves
        bores = spec.get("bores") or ([(0, 0)] if spec["bore"] is not None else [])
        if bores:
            labels = tables.CORE_THREADS[stem][0]
            params["bores"] = [{"at_mm": [x, y], "d_mm": spec["bore"], "threads": labels} for x, y in bores]
        own = self.own_groove(stem, spec, grooves, None)
        if own:
            params["groove_dims"] = own
            note = ("a T-slot envelope from the printed overall size and core bore, with its own groove "
                    "dimensions (groove_dims) over the groove type measured on the series' vector outline")
        else:
            note = ("a T-slot envelope from the printed overall size and core bore, with the groove type "
                    "measured on the series' vector outline")
        note += ("; the page draws this profile as a raster image" if spec["page"]
                 else "; the catalogue does not draw this profile")
        if spec.get("corners"):
            c = tables.CORNER_HOLES
            d, inset = num(Decimal(str(c["d"]))), Decimal(str(c["inset"]))
            x, y = Decimal(str(w)) / 2 - inset, Decimal(str(h)) / 2 - inset
            params.setdefault("bores", []).extend(
                {"at_mm": [num(sx * x), num(sy * y)], "d_mm": d, "threads": c["threads"]}
                for sy in (-1, 1) for sx in (-1, 1))
            note += (f". The Ø{d} corner holes the page draws are {num(inset)} mm in from both faces, "
                     f"as printed and as the vector outlines of {' and '.join(c['measured_on'])} "
                     f"measure them")
        if bores:
            note += ". " + self.labels_note(stem, bool(spec.get("corners")))
        if spec.get("approx"):
            note += ". " + spec["approx"][0].upper() + spec["approx"][1:]
        if refused:
            note += ". " + refused[0].upper() + refused[1:]
        self.sections[stem] = {
            "schema": "alukit.section/1",
            "id": stem,
            "fidelity": "parametric",
            "props_ok": False,
            "from": {"ref": pdf_ref(spec["page"]) if spec["page"] else f"url:{url}",
                     "method": "generator", "read": tables.PDF_READ if spec["page"] else self.snap.read,
                     "note": note},
            "generator": "tslot",
            "params": params,
        }

    # --- hardware -----------------------------------------------------------------------------------

    def hardware(self) -> None:
        for p in self.snap.products:
            entry = tables.FAMILY_BY_SKU.get(p["sku"])
            if entry is None or entry[1] == "kit":
                continue
            family, kind, subtype = entry
            sources = ([p] if p["type"] == "simple" else []) + self.snap.children.get(p["id"], [])
            for x in sources:
                if x["sku"] in tables.NOTE_SKU:
                    self.notes["offers with no contents modelled"].append(f"{x['sku']}: {tables.NOTE_SKU[x['sku']]}")
                self.hardware_offer(p, x, family, kind, subtype)

    def hardware_offer(self, parent: dict, x: dict, family: str, kind: str, subtype: str | None) -> None:
        a = store.attrs(x, parent) if x is not parent else {}
        unknown = [k for k in a if k not in tables.ATTRIBUTE_CLASS]
        if unknown:
            raise ValueError(f"{x['sku']}: attributes not in the table: {unknown}")
        sku = x["sku"]
        pack = None
        iid = sku
        if "Unidades" in a:
            pack = int(re.fullmatch(r"(\d+)un", a["Unidades"]).group(1))
            if not iid.endswith(f"-{pack}"):
                raise ValueError(f"{sku}: pack of {pack} but no -{pack} tail")
            iid = iid[: -len(f"-{pack}")]
        length = None
        if "Comprimento" in a:
            length = int(re.fullmatch(r"(\d+)mm", a["Comprimento"]).group(1))
            if iid.endswith(f"-{length}"):
                iid = iid[: -len(f"-{length}")]
        options = None
        describes = True
        if sku in tables.FINISH_BY_SKU:
            iid, finish, describes = tables.FINISH_BY_SKU[sku]
            options = {"finish": finish}
        if a.get("Opção de Fixação") not in (None, "Sem Fixadores") and sku not in tables.NOTE_SKU:
            raise ValueError(f"{sku}: a fixings option the tables do not handle")
        sizes = [(k, v) for k, v in a.items() if tables.ATTRIBUTE_CLASS[k] == "size"]
        name = store.name(parent) + (f" ({', '.join(f'{k}: {v}' for k, v in sizes)})" if sizes else "")
        it: dict = {"kind": kind}
        if subtype:
            it["subtype"] = subtype
        it |= {"name": name, "code": iid}
        if self.brand(parent):
            it["brand"] = self.brand(parent)
        it["url"] = parent["permalink"]
        pages = tables.ITEM_PAGES.get(iid) or tables.FAMILY_PAGES.get(family)
        if pages:
            it["docs"] = [{"ref": pdf_ref(pg)} for pg in pages]
        desc = store.text(parent.get("description"))
        if kind == "bar":
            it["shape"] = "rail"
        if kind == "fastener":
            thread = a.get("Rosca") or a.get("Para Parafuso") or a.get("Rosca Interna")
            if thread is None:
                m = re.search(r"\bM(\d+)\b", store.name(parent))
                thread = m and f"M{m.group(1)}"
            if thread:
                it["thread"] = thread
            if "Comprimento do Parafuso" in a:
                it["length_mm"] = int(re.fullmatch(r"(\d+)mm", a["Comprimento do Parafuso"]).group(1))
            standard = store.standard_of(parent) if subtype in ("screw", "bolt") else None
            if standard:
                it["standard"] = standard
            for phrase, how in tables.INSERTION.items():
                if phrase in desc:
                    it["insertion"] = how
            dims = self.desc_dims(family, desc, iid)
            if dims:
                it["dims"] = dims
        it["prov"] = self.shop_prov(parent)
        if options:
            # Every finish in the table's order; check_options confirms each has an offer.
            it["options"] = {"finish": list(dict.fromkeys(
                f for i, f, _ in tables.FINISH_BY_SKU.values() if i == iid))}
        if describes:
            self.item(iid, it)
        if length is not None:
            self.offer(sku, iid, x, "bar", sale={"mode": "stock", "length_mm": length})
        else:
            self.offer(sku, iid, x, "unit", options=options, pack=pack if pack and pack > 1 else None)

    @staticmethod
    def desc_dims(family: str, desc: str, iid: str) -> dict | None:
        keys = tables.DIMS.get(family)
        if not keys:
            return None
        blocks = re.split(r"(?i)\b(?:cod|c[óo]digo):\s*", desc)[1:]
        for b in blocks:
            code = b.split()[0]
            if code != iid:
                continue
            out = {}
            for label, key in keys.items():
                m = re.search(re.escape(label) + r":\s*(\d+(?:,\d+)?)", b)
                if m:
                    out[key] = num(Decimal(m.group(1).replace(",", ".")))
            return dict(sorted(out.items())) or None
        return None

    # --- kits -----------------------------------------------------------------------------------

    def kits(self) -> None:
        by_sku = self.offers
        for p in self.snap.products:
            entry = tables.FAMILY_BY_SKU.get(p["sku"])
            if entry is None or entry[1] != "kit":
                continue
            desc = store.text(p.get("description"))
            body = re.split(r"(?i)Itens do KIT:?", desc, maxsplit=1)
            if len(body) != 2:
                raise ValueError(f"{p['sku']}: no 'Itens do KIT' list")
            lines = re.findall(
                r"([^:()]+?)\s*(?:\(\s*([A-Z0-9][A-Z0-9-]*)\s*\))?\s*:\s*(\d+)\s*unidades?", body[1]
            )
            kit, unresolved = [], []
            for label, code, qty in lines:
                label = label.strip()
                target = None
                fix = tables.KIT_LINE_FIXES.get((p["sku"], code or label))
                if fix:
                    target = fix[0]
                    self.notes["kit lines resolved by the table"].append(f"{p['sku']}: '{code or label}' → {target}")
                elif code in self.items:
                    target = code
                elif code in by_sku:
                    target = by_sku[code]["item"]
                elif code and (m := re.fullmatch(r"(.+)-\d+", code)) and m.group(1) in self.items:
                    # A pack SKU, <item>-<units>, though not one on sale (PAM408-20-10 is sold
                    # only as -50): the same rule that gives item ids.
                    target = m.group(1)
                if target is None or target not in self.items:
                    unresolved.append(code or label)
                    continue
                kit.append({"item": target, "qty": int(qty)})
            if unresolved:
                self.notes["kits not emitted (contents not all emitted yet)"].append(
                    f"{p['sku']}: {', '.join(unresolved)}")
                continue
            # The main item comes first (§3.2): the one the kit's SKU names, <item>-K<base>,
            # wherever the description lists it (CT100-888-K4590 lists its bracket third).
            m = re.fullmatch(r"(.+)-K[0-9A-Z]+", p["sku"])
            main = m.group(1) if m else None
            if main not in {line["item"] for line in kit}:
                raise ValueError(f"{p['sku']}: the kit does not list the item its SKU names")
            kit.sort(key=lambda line: line["item"] != main)
            self.offer(p["sku"], main, p, "unit", kit=kit)

    # --- coverage -------------------------------------------------------------------------------

    def check_coverage(self) -> None:
        """Every orderable SKU has exactly one offer, and no offer orders a SKU the shop does not
        list (design §12, M2b). An offer orders its `sku`, or its key when it names none."""
        ordered: dict[str, list[str]] = defaultdict(list)
        for key, o in self.offers.items():
            ordered[o.get("sku", key)].append(key)
        orderable = store.orderable(self.snap)
        missing = [s for s in orderable if s not in ordered]
        listed = {p["sku"] for p in self.snap.products} | {v["sku"] for v in self.snap.variations}
        unknown = sorted(set(ordered) - listed)
        twice = sorted(s for s in orderable if len(ordered.get(s, [])) > 1)
        if missing or unknown or len(set(orderable)) != len(orderable):
            raise SystemExit(f"coverage: SKUs with no offer {missing[:10]} ({len(missing)}), offers for SKUs "
                             f"the shop does not list {unknown[:10]}")
        # A SKU sold in several stock lengths has several offers (the 80x80 profiles, §3.2).
        for s in twice:
            if any(self.offers[k].get("sale", {}).get("mode") != "stock" for k in ordered[s]):
                raise SystemExit(f"coverage: {s} has {len(ordered[s])} offers that are not stock lengths")
        self.notes["orderable SKUs with several offers (one per stock length)"] = twice
        extra = sorted(s for s in ordered if s not in set(orderable))
        self.notes["offers for products the shop gives variations (not orderable themselves)"] = extra

    # --- output ---------------------------------------------------------------------------------

    def catalog(self) -> dict:
        return {
            "schema": "alukit.catalog/1",
            "id": "forseti",
            "name": "Forseti",
            "vendor": "forseti",
            "currency": "BRL",
            "url": "https://loja.forsetisolucoes.com.br",
            "prov": {"src": "src", "ref": f"url:{API}", "read": self.snap.read},
            "materials": emit.sorted_map(self.materials),
            "grooves": emit.sorted_map(self.grooves),
            "systems": emit.sorted_map(self.systems),
            "items": emit.sorted_map(self.items),
        }


def build(raw: str, pdf: str, out: str) -> int:
    snap = store.load(raw)
    for what in ("products", "variations"):
        t = snap.totals[what]
        if t["unique"] != t["total"]:
            raise SystemExit(f"the snapshot is incomplete: {what} {t['unique']}/{t['total']}")
    b = Build(snap, pdfcat.open_pdf(pdf))
    b.material()
    b.profiles()
    b.groove_types()
    b.corner_holes()
    b.hardware()
    b.kits()
    rest.run(b)
    b.check_coverage()

    emit.write(os.path.join(out, "catalog.json"), b.catalog())
    emit.write(os.path.join(out, "offers.json"), {"schema": "alukit.offers/1", "offers": emit.sorted_map(b.offers)})
    sec_dir = os.path.join(out, "sections")
    for sid, s in b.sections.items():
        emit.write(os.path.join(sec_dir, f"{sid}.json"), s)
    for name in sorted(os.listdir(sec_dir)):
        if name.endswith(".json") and name[:-5] not in b.sections:
            os.remove(os.path.join(sec_dir, name))
            print(f"removed stale sections/{name}")

    kinds = defaultdict(int)
    for it in b.items.values():
        kinds[it["kind"]] += 1
    fid = defaultdict(int)
    for s in b.sections.values():
        fid[s["fidelity"]] += 1
    print(f"read {snap.read}: {len(snap.products)} products, {len(snap.variations)} variations")
    print(f"items {len(b.items)} ({', '.join(f'{k} {n}' for k, n in sorted(kinds.items()))}), "
          f"offers {len(b.offers)}, sections {len(b.sections)} "
          f"({', '.join(f'{k} {n}' for k, n in sorted(fid.items()))})")
    for k, vs in b.notes.items():
        print(f"{k}: {len(vs)}")
        for v in vs:
            print(f"  {v}")
    return 0
