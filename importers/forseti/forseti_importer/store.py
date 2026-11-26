"""Reading a raw Store API snapshot: products, variations (deduplicated by id), the manifest, and
the small text parsers for names, descriptions and product pages."""

from __future__ import annotations

import glob
import html
import json
import os
import re
from dataclasses import dataclass, field

from . import tables


@dataclass
class Snapshot:
    raw: str
    read: str
    products: list[dict]
    variations: list[dict]
    #: Variations by parent id, each list sorted by id.
    children: dict[int, list[dict]] = field(default_factory=dict)
    #: Unique counts against the API's totals, as the manifest recorded them.
    totals: dict = field(default_factory=dict)

    def page(self, product_id: int) -> str | None:
        path = os.path.join(self.raw, "pages", f"{product_id}.html")
        if not os.path.exists(path):
            return None
        with open(path, encoding="utf-8") as f:
            return f.read()


def _files(raw: str, pattern: str) -> list[str]:
    def page_no(path: str) -> tuple[int, int]:
        m = re.search(r"(?:_r(\d+))?_p(\d+)\.json$", path)
        return (int(m.group(1) or 1), int(m.group(2))) if m else (0, 0)

    return sorted(glob.glob(os.path.join(raw, "store", pattern)), key=page_no)


def load(raw: str) -> Snapshot:
    with open(os.path.join(raw, "manifest.json"), encoding="utf-8") as f:
        manifest = json.load(f)
    products: dict[int, dict] = {}
    for path in _files(raw, "products_p*.json"):
        with open(path, encoding="utf-8") as f:
            for p in json.load(f):
                products.setdefault(p["id"], p)
    variations: dict[int, dict] = {}
    for path in _files(raw, "variations_*p*.json"):
        with open(path, encoding="utf-8") as f:
            for v in json.load(f):
                variations.setdefault(v["id"], v)
    snap = Snapshot(
        raw=raw,
        read=manifest["read"],
        products=[products[k] for k in sorted(products)],
        variations=[variations[k] for k in sorted(variations)],
        totals={"products": manifest["products"], "variations": manifest["variations"]},
    )
    for v in snap.variations:
        snap.children.setdefault(v["parent"], []).append(v)
    return snap


def name(x: dict) -> str:
    """The product's name as published, HTML entities decoded."""
    return html.unescape(x["name"]).strip()


def text(fragment: str | None) -> str:
    """Plain text of an HTML fragment: tags dropped, entities decoded, whitespace collapsed."""
    t = re.sub(r"<[^>]+>", " ", fragment or "")
    t = html.unescape(t).replace(" ", " ").replace("​", "")
    return re.sub(r"\s+", " ", t).strip()


def family_of(p: dict) -> str | None:
    """The family of a product (not a variation), or None when the tables do not name it."""
    if p.get("type") == "simple" and tables.PROFILE_SKU.match(p["sku"]):
        return "profile"
    entry = tables.FAMILY_BY_SKU.get(p["sku"])
    return entry[0] if entry else None


def attrs(v: dict, parent: dict) -> dict[str, str]:
    """A variation's attributes, {name: value}: from the parent's `variations` list, which holds
    them structured, or else from the variation's own `variation` text ("Rosca: M8, Unidades:
    10un"), split at the attribute names the tables know (the parents' lists miss a few)."""
    for entry in parent.get("variations") or []:
        if entry["id"] == v["id"]:
            return {a["name"]: a["value"] for a in entry["attributes"]}
    s = html.unescape(v.get("variation") or "")
    names = "|".join(re.escape(n) for n in sorted(tables.ATTRIBUTE_CLASS, key=len, reverse=True))
    parts = re.split(rf"(?:^|,\s*)({names}):\s*", s)
    if parts[0].strip():
        raise ValueError(f"{v['sku']}: cannot read its attributes from {s!r}")
    return {parts[i]: parts[i + 1].strip() for i in range(1, len(parts), 2)}


def number(s: str) -> float:
    """A Brazilian decimal: "1,493" → 1.493."""
    return float(s.replace(".", "").replace(",", ".")) if "," in s else float(s)


def minor(s: str | None) -> int | None:
    return None if s in (None, "") else int(s)


def price(x: dict) -> tuple[int, int | None]:
    """(regular, sale) in minor units. The shop reports a sale price equal to the regular one
    when there is no sale; that is no sale."""
    pr = x["prices"]
    if pr.get("currency_minor_unit") != 2 or pr.get("currency_code") != "BRL":
        raise ValueError(f"{x['sku']}: unexpected currency {pr.get('currency_code')}")
    regular = minor(pr.get("regular_price"))
    sale = minor(pr.get("sale_price"))
    if regular is None:
        raise ValueError(f"{x['sku']}: no regular price")
    return regular, (sale if sale is not None and sale < regular else None)


def weight(x: dict) -> float | None:
    w = (x.get("weight") or "").strip()
    try:
        v = float(w)
    except ValueError:
        return None
    return v if v > 0 else None


# --- Product pages -------------------------------------------------------------------------------

_INPUT = re.compile(r"<input\b[^>]*>", re.I)


@dataclass
class CutRule:
    """The shop cuts each piece: lengths in mm, billed in steps."""

    min_mm: int
    max_mm: int
    res_mm: int
    tol_mm: int
    step_mm: int


@dataclass
class MetreRule:
    """The shop sells whole metres per line and cuts a list of pieces from them, sending the
    offcuts too: stock bars of 1, 2, … `max_m` metres."""

    lengths_mm: list[int]
    tol_mm: int


def _length_input(page: str) -> dict[str, str] | None:
    """The order form's length input (class `input-mm`): its min, max and step."""
    for tag in _INPUT.findall(page):
        a = dict(re.findall(r'(\w[\w-]*)="([^"]*)"', tag))
        if a.get("type") == "number" and "input-mm" in a.get("class", "") and "max" in a:
            return a
    return None


def cut_rule(page: str) -> CutRule | MetreRule | None:
    """A profile's sale rule from its product page. Two forms are in use:

    - lengths in mm (`min="40" max="3000" step="1"`), "Tolerância de +/- 1mm", and "Cada 10mm de
      corte consome 1 unidade" (the price step): a cut rule;
    - lengths in whole metres (`min="1" max="3"`), with a "Lista de Cortes" field ("Peças enviadas
      com o comprimento informado + sobras"): whole bars of 1 to 3 m, cut to the list.
    """
    length = _length_input(page)
    tol = re.search(r"Toler[âa]ncia de \+/- ?(\d+) ?mm", page)
    if not (length and tol):
        return None
    lo = int(float(length["min"]))
    hi = int(float(length["max"]))
    step_in = int(float(length.get("step", "1")))
    if hi <= 10 and 'data-key="lista-de-cortes"' in page:
        return MetreRule(lengths_mm=[m * 1000 for m in range(lo, hi + 1, step_in)], tol_mm=int(tol.group(1)))
    step = re.search(r"Cada (\d+) ?mm de corte consome 1 unidade", page)
    if not step:
        return None
    return CutRule(min_mm=lo, max_mm=hi, res_mm=step_in, tol_mm=int(tol.group(1)), step_mm=int(step.group(1)))
