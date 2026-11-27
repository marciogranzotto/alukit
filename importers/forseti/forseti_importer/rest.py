"""The rest of the shop (design §11, M2b): every product the profile, hardware and kit tables do not
name, so that every orderable SKU maps to an offer.

Each product is classified by the reviewed rules in `tables.KIND_RULES`: a real kind (fastener,
connector, accessory, panel) where the data supports one, and `generic` for everything else. The
item ids follow M2a's rule (the SKU, less a pack tail); one variation is one item unless it only
differs by pack (or, for sheets, by size, which is an offer option).

Nothing here models geometry: connectors, brackets and plates carry the systems they fit and no
mounting model yet (layer 2 adds that, by hand). A connector `tables.MODELLED_CONNECTORS` names is
modelled in layer 2 already: it lists the catalogue pages that draw it and does not say it has no
model.
"""

from __future__ import annotations

import re
from collections import defaultdict
from decimal import Decimal

from . import store, tables

#: The order systems are listed in.
SYSTEM_ORDER = ["s20-c6", "s30-c8", "s40-c8", "s45-c10", "s45-c8", "s50-c8"]
#: A groove type per system, for a T-nut or hammer screw that fits exactly one.
GROOVE_OF = {sys_id: gid for sys_id, gid, _ in tables.SYSTEMS.values()}


def _num(d: Decimal) -> int | float:
    return int(d) if d == d.to_integral_value() else float(d)


def mm_value(s: str) -> int | float | None:
    """A length that starts a value: "25mm" → 25, "2,5mm" → 2.5, anything else None."""
    m = re.match(r"\s*(\d+(?:[.,]\d+)?)\s*mm\b", s, re.I)
    return _num(Decimal(m.group(1).replace(",", "."))) if m else None


def classify(p: dict) -> tuple[str, str | None]:
    """(kind, subtype) of a product by the first matching rule; `generic` when none does."""
    name, sku = store.name(p), p["sku"]
    cats = [c["name"] for c in p["categories"]]
    for field, pat, kind, sub in tables.KIND_RULES:
        if field == "name":
            hit = re.match(pat, name, re.I)
        elif field == "sku":
            hit = re.fullmatch(pat, sku, re.I)
        else:
            hit = any(re.match(pat, c, re.I) for c in cats)
        if hit:
            return kind, sub
    return "generic", None


def category(p: dict) -> str:
    """The `category` of a generic item."""
    name = store.name(p)
    cats = [c["name"] for c in p["categories"]]
    for field, pat, cat in tables.CATEGORY_RULES:
        if field == "name":
            hit = re.match(pat, name, re.I)
        else:
            hit = any(re.match(pat, c, re.I) for c in cats)
        if hit:
            return cat
    return "other"


def fits_of(name: str, a: dict[str, str]) -> list[str]:
    """The T-slot systems a part fits, from what its name or its variation's profile attribute
    says: bases ("Base 30, 40 e 45"), profile sizes ("Perfil 20×20") or a slot class ("Canal 8").
    The variation's own attribute wins over the product's name. Empty when the text names none."""
    own = " ".join(a[k] for k in ("Para Perfil", "Perfil Base", "Para Canal") if a.get(k))
    text = own or name
    bases: set[int] = set()
    for m in re.finditer(r"(?i)\bbases?\b[\s,:]*((?:\d{2}(?:\s*(?:,|e|ou|–|-|/)\s*)?)+)", text):
        bases.update(int(n) for n in re.findall(r"\d{2}", m.group(1)))
    for m in re.finditer(r"(?i)\bperfi[ls]\s+(?:estrutural\s+)?(?:em\s+alum[ií]nio\s+)?(?:base\s+)?(\d{2})\s*[x×]\s*\d{2}", text):
        bases.add(int(m.group(1)))
    for m in re.finditer(r"(?i)\bperfi[ls]\s+((?:\d{2}(?:\s*(?:,|e|ou)\s*)?)+)(?!\s*[x×]\s*\d)", text):
        bases.update(int(n) for n in re.findall(r"\d{2}", m.group(1)))
    if own:
        bases.update(int(n) for n in re.findall(r"(?i)\b(\d{2})\s*x\s*\d{2}\b", own))
        bases.update(int(n) for n in re.findall(r"(?i)\bbase\s+(\d{2})\b", own))
        bases.update(int(a[k]) for k in ("Para Perfil", "Perfil Base") if re.fullmatch(r"\d{2}", a.get(k, "").strip()))
    if re.search(r"(?i)v-slot|t-slot 6|canal 6", text):
        bases.add(20)
    systems: set[str] = set()
    for b in bases:
        if b == 45:
            econ = re.search(r"(?i)parafuso|econ[oô]mico", text)
            basic = re.search(r"(?i)b[aá]sico", text) or not econ
            if basic:
                systems.add("s45-c10")
            if econ:
                systems.add("s45-c8")
        elif b in tables.BASE_SYSTEMS:
            systems.update(tables.BASE_SYSTEMS[b])
    if not systems:
        for n in re.findall(r"(?i)canal\s*(\d+)", text):
            systems.update(tables.CHANNEL_SYSTEMS.get(int(n), []))
    return [s for s in SYSTEM_ORDER if s in systems]


def pack_of(a: dict[str, str], sku: str) -> int | None:
    raw = a.get("Unidades")
    if raw is None:
        return None
    if raw in tables.PACK_WORDS:
        return tables.PACK_WORDS[raw]
    m = re.match(r"(\d+)un\b", raw)
    if not m:
        raise ValueError(f"{sku}: cannot read the pack {raw!r}")
    return int(m.group(1))


def thickness_of(p: dict, a: dict[str, str]) -> int | float | None:
    """A sheet's thickness: the variation's attribute, else the product's name."""
    for text in (a.get("Espessura da Chapa", ""), store.name(p)):
        m = re.search(r"(\d+(?:[.,]\d+)?)\s*mm", text, re.I)
        if m:
            return _num(Decimal(m.group(1).replace(",", ".")))
    return None


SKIP_ATTRIBUTES = {"Unidades", "Tamanho da Chapa"}


def size_key(a: dict[str, str]) -> tuple:
    """What makes variations different items: every attribute but the pack and a sheet's size."""
    return tuple(sorted((k, v) for k, v in a.items() if k not in SKIP_ATTRIBUTES and v != "Sem Fixadores"))


def stem_of(p: dict, x: dict, a: dict[str, str], pack: int | None, ghost: bool, panel: bool) -> str:
    """The SKU less what only differs by pack (M2a's rule) or, for sheets, by size; the parent's
    SKU for a placeholder variation of a simple product."""
    sku = x["sku"]
    if ghost:
        return p["sku"]
    iid = sku
    kit_tail = re.fullmatch(rf"(.+)-{pack}(-K[0-9A-Z]+)", sku) if pack else None
    if kit_tail:
        # A kit sold in several packs: CT38-08-4-K45B and CT38-08-24-K45B are one item.
        iid = kit_tail.group(1) + kit_tail.group(2)
    elif pack is not None and pack > 1 and sku.endswith(f"-{pack}"):
        iid = sku[: -len(f"-{pack}")]
    elif pack == 1 and sku.endswith("-1"):
        iid = sku[:-2]
    if panel:
        iid = re.sub(r"-\d+X\d+$", "", iid, flags=re.I)
    return iid


def run(b) -> None:
    """Builds items and offers for every product no other table names, into `b`."""
    for p in b.snap.products:
        if store.family_of(p) or p["sku"] in tables.FAMILY_BY_SKU:
            continue
        kind, subtype = classify(p)
        kids = b.snap.children.get(p["id"], [])
        rows = []
        for x in ([p] if p["type"] == "simple" else []) + kids:
            a = store.attrs(x, p) if x is not p else {}
            pack = pack_of(a, x["sku"])
            ghost = (x is not p and p["type"] == "simple" and store.price(x)[0] == 0
                     and x["sku"].startswith(p["sku"] + "-"))
            panel = kind == "panel" and thickness_of(p, a) is not None
            rows.append((x, a, pack, ghost, stem_of(p, x, a, pack, ghost, panel)))
        # Variations that share a stem but differ in a size attribute are different items: the
        # stem is not theirs to share, so each keeps its SKU.
        shapes: dict[str, set] = defaultdict(set)
        for x, a, pack, ghost, stem in rows:
            shapes[stem].add(size_key(a))
        for x, a, pack, ghost, stem in rows:
            iid = stem if len(shapes[stem]) == 1 else x["sku"]
            one(b, p, x, kind, subtype, a, pack, iid)


def one(b, p: dict, x: dict, kind: str, subtype: str | None, a: dict[str, str], pack: int | None,
        iid: str) -> None:
    sku = x["sku"]
    options = None
    thickness = None
    fits: list[str] = []

    if kind == "panel":
        thickness = thickness_of(p, a)
        if thickness is None:
            kind, subtype = "generic", None
    if kind == "connector":
        fits = tables.FITS_BY_PARENT.get(p["sku"], ([], ""))[0] or fits_of(store.name(p), a)
        if not fits:
            kind, subtype = "generic", None
            b.notes["connectors with no system they fit, kept as generic"].append(store.name(p)[:70])
    if kind == "generic":
        cat = category(p)
    if kind == "panel" and a.get("Tamanho da Chapa"):
        options = {"size": a["Tamanho da Chapa"].replace("X", "x")}

    sizes = list(size_key(a))
    name = store.name(p) + (f" ({', '.join(f'{k}: {v}' for k, v in sizes)})" if sizes else "")

    it: dict = {"kind": kind}
    if subtype:
        it["subtype"] = subtype
    if kind == "generic":
        it["category"] = cat
    it |= {"name": name, "code": iid}
    if b.brand(p):
        it["brand"] = b.brand(p)
    it["url"] = p["permalink"]
    modelled = kind == "connector" and iid in tables.MODELLED_CONNECTORS
    if modelled:
        it["docs"] = [{"ref": f"pdf:{tables.PDF}#p{pg}"} for pg in tables.MODELLED_CONNECTORS[iid]]
    desc = store.text(p.get("description"))

    if kind in ("connector", "accessory") or (kind == "fastener" and subtype in ("t-nut", "hammer-screw")):
        if kind != "connector":
            fits = fits_of(store.name(p), a)
        if fits:
            it["fits"] = fits
    if kind == "fastener":
        thread = a.get("Rosca") or a.get("Para Parafuso") or a.get("Rosca Interna")
        if thread is None:
            m = re.search(r"\bM(\d+)\b", store.name(p))
            thread = m and f"M{m.group(1)}"
        if thread:
            it["thread"] = thread
        ln = mm_value(a.get("Comprimento do Parafuso", ""))
        if ln is not None:
            it["length_mm"] = ln
        standard = store.standard_of(p) if subtype in ("screw", "bolt") else None
        if standard:
            it["standard"] = standard
        if subtype in ("t-nut", "hammer-screw"):
            if len(fits) == 1:
                it["groove"] = GROOVE_OF[fits[0]]
            for phrase, how in tables.INSERTION.items():
                if phrase in desc:
                    it["insertion"] = how
    if kind == "accessory":
        thread = a.get("Rosca") or a.get("Rosca Interna")
        if thread:
            it["thread"] = thread
    if kind == "panel":
        it["thickness_mm"] = thickness
    if kind in ("generic", "accessory"):
        dims = {}
        for attr, key in tables.DIM_ATTRIBUTES.items():
            v = mm_value(a.get(attr, ""))
            if v is not None:
                dims[key] = v
        if dims:
            it["dims"] = dict(sorted(dims.items()))
    it["prov"] = b.shop_prov(p)
    if kind == "connector":
        # Layer 2 gives a connector its frame, mounts and fastener sets, or its machining and its
        # own head, by hand; until then it has none, and says so where a reader of the item looks.
        fits_note = "`fits` is read from the product's name or its variation's profile attribute"
        it["prov"]["note"] = (fits_note if modelled else
                              f"no mounting model yet: no frame, mounts or fastener sets; {fits_note}")
    if options:
        it["options"] = {k: [v] for k, v in options.items()}
    b.item(iid, it)
    b.offer(sku, iid, x, "unit", options=options, pack=pack if pack and pack > 1 else None)
