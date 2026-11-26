"""Reading the PDF catalogue: the profile tables (IX, IY, area, mass, by "COD:" block) and the
vector outlines of the profiles drawn as paths (survey §4)."""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from decimal import Decimal

import pymupdf

from . import geometry as g
from . import tables

#: Points per page height: an A4 page is 841.89 pt tall; its upper and lower halves hold one
#: profile each on the profile pages.
HALF_SPLIT_PT = 841.89 / 2
#: Segment ends closer than this (pt) are the same point when chaining.
CHAIN_TOL_PT = 0.02
#: Coordinates in a section file are rounded to this (mm); M1 decision 2.
ROUND_MM = 4
#: The drawn aspect ratio must match the nominal one within this, or the outline is refused.
ASPECT_TOL = 0.002


def open_pdf(path: str) -> pymupdf.Document:
    with open(path, "rb") as f:
        digest = hashlib.sha256(f.read()).hexdigest()
    if digest != tables.PDF_SHA256:
        raise SystemExit(
            f"{path}: SHA-256 {digest} is not the catalogue the page tables were reviewed against "
            f"({tables.PDF_SHA256}); review the pages, then update tables.py"
        )
    return pymupdf.open(path)


# --- Tables ----------------------------------------------------------------------------------------

@dataclass
class Printed:
    """One profile's printed table, values as printed (Decimal), in the drawing's axes."""

    code: str
    page: int
    IX_cm4: Decimal | None = None
    IY_cm4: Decimal | None = None
    A_cm2: Decimal | None = None
    kg_per_m: Decimal | None = None


_VALUE = re.compile(r"^(\d+(?:[.,]\d+)?)\s*(cm|kg/m)$")
_LABELS = {"IX": ("IX_cm4",), "IY": ("IY_cm4",), "IX, IY": ("IX_cm4", "IY_cm4"),
           "ÁREA TRANSVERSAL": ("A_cm2",), "PESO": ("kg_per_m",)}


def _dec(s: str) -> Decimal:
    return Decimal(s.replace(",", "."))


def profile_tables(doc: pymupdf.Document, pages: list[int]) -> dict[str, Printed]:
    """The table rows on each page, each assigned to the nearest "COD:" heading above it."""
    out: dict[str, Printed] = {}
    for pno in pages:
        spans = []
        for b in doc[pno - 1].get_text("dict")["blocks"]:
            for line in b.get("lines", []):
                for s in line["spans"]:
                    t = s["text"].strip()
                    if t and s["size"] > 7:  # drops the superscript "4" and "2" of cm⁴, cm²
                        spans.append((t, s["bbox"]))
        codes = sorted(
            (bbox[1], m.group(1))
            for t, bbox in spans
            if (m := re.match(r"^COD:\s*([A-Z0-9][A-Z0-9-]*)$", t))
        )
        for t, bbox in spans:
            fields = _LABELS.get(t)
            if not fields:
                continue
            y_mid = (bbox[1] + bbox[3]) / 2
            vals = [
                (vb[0], m)
                for vt, vb in spans
                if vb[0] > bbox[2] and vb[1] < y_mid < vb[3] and (m := _VALUE.match(vt))
            ]
            above = [c for y, c in codes if y < bbox[1]]
            if not vals or not above:
                continue
            m = min(vals, key=lambda v: v[0])[1]
            p = out.setdefault(above[-1], Printed(code=above[-1], page=pno))
            for f in fields:
                setattr(p, f, _dec(m.group(1)))
    return out


# --- Outlines -------------------------------------------------------------------------------------

@dataclass
class Outline:
    outline: g.Ring
    holes: list[g.Ring]
    page: int
    segments: int
    scale_mm_per_pt: float


def _rot90(r: g.Ring) -> g.Ring:
    """Turns a ring 90° counter-clockwise about the origin: (x, y) → (−y, x)."""
    return [(-y, x) for x, y in r]


def extract_outline(doc: pymupdf.Document, page: int, half: str, drawn: tuple[float, float],
                    size: tuple[float, float]) -> Outline:
    """The profile drawn as one path in the given half of the page: the path with the most line
    segments among those whose box lies in that half (ties: the lower index; stroke and fill
    copies of one path are the same geometry). Chained into rings, scaled so the drawing's width
    is the drawn width in mm, checked against the drawn height, flipped to y up, centred on its
    box, and turned into the section frame when the drawing is turned against it."""
    dr = doc[page - 1].get_drawings()
    cands = []
    for i, d in enumerate(dr):
        r = d["rect"]
        mid = (r.y0 + r.y1) / 2
        if (half == "top") != (mid < HALF_SPLIT_PT):
            continue
        n = sum(1 for it in d["items"] if it[0] == "l")
        if n and all(it[0] == "l" for it in d["items"]):
            cands.append((-n, i))
    if not cands:
        raise ValueError(f"p. {page} {half}: no line path")
    _, idx = min(cands)
    d = dr[idx]
    segs = [((it[1].x, it[1].y), (it[2].x, it[2].y)) for it in d["items"]]
    r = d["rect"]
    w_pt, h_pt = r.x1 - r.x0, r.y1 - r.y0
    dw, dh = drawn
    if abs((h_pt / w_pt) / (dh / dw) - 1) > ASPECT_TOL:
        raise ValueError(f"p. {page}: drawn aspect {h_pt / w_pt:.5f}, expected {dh / dw:.5f}")
    sc = dw / w_pt
    cx, cy = (r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2
    rings = []
    for pts, closed in g.chain(segs, CHAIN_TOL_PT):
        if not closed:
            raise ValueError(f"p. {page}: an open chain of {len(pts)} points")
        rings.append([((x - cx) * sc, (cy - y) * sc) for x, y in pts])
    outline, holes = g.nest(rings)
    if (dw, dh) != tuple(size):
        if (dh, dw) != tuple(size):
            raise ValueError(f"p. {page}: drawn {drawn} cannot be turned into {size}")
        outline, holes = _rot90(outline), [_rot90(h) for h in holes]
    rnd = lambda ring: [(_r(x), _r(y)) for x, y in ring]  # noqa: E731
    return Outline(rnd(outline), [rnd(h) for h in holes], page, len(segs), sc)


def _r(x: float) -> float:
    v = round(x, ROUND_MM)
    return 0.0 if v == 0 else v


# --- Grooves -------------------------------------------------------------------------------------

#: Depth sampling step (mm) when measuring a groove.
STEP_MM = 0.02


def _face_frame(face: str, w: float, h: float):
    """Maps section (x, y) to face-local (u along the face, v depth inward)."""
    return {
        "+y": lambda x, y: (x, h / 2 - y),
        "-y": lambda x, y: (x, y + h / 2),
        "+x": lambda x, y: (y, w / 2 - x),
        "-x": lambda x, y: (y, x + w / 2),
    }[face]


#: Widths within this of the widest count as the full-width chamber (mm).
CHAMBER_TOL_MM = 0.5


@dataclass
class GrooveDims:
    opening_mm: float
    lip_mm: float
    depth_mm: float
    undercut_mm: float
    taper_from_mm: float | None
    bottom_mm: float | None


def measure_groove(outline: g.Ring, holes: list[g.Ring], w: float, h: float, face: str,
                   at_mm: float) -> GrooveDims:
    """A T-slot groove's envelope, measured on an exact outline along the groove's centre line:
    the empty width at each depth from the face inward, sampled every STEP_MM until the centre
    line meets material (the depth). The chamber is the run of widths within CHAMBER_TOL_MM of the
    widest (the undercut); the lip ends where it starts; the opening is the narrowest width above
    it (a chamfered mouth is wider at the face); when the chamber narrows before the bottom, the
    taper runs from where it ends to the last width sampled (the bottom)."""
    f = _face_frame(face, w, h)
    rings = [[f(x, y) for x, y in r] for r in [outline, *holes]]
    widths: list[tuple[float, float]] = []
    v = STEP_MM
    while True:
        gap = g.gap_at(rings, v, at_mm)
        if gap is None or gap == float("inf"):
            break
        widths.append((v, gap))
        v = round(v + STEP_MM, 6)
        if v > max(w, h):
            raise ValueError(f"groove on {face} at {at_mm}: no bottom found")
    if len(widths) < 10:
        raise ValueError(f"groove on {face} at {at_mm}: no groove there")
    half = STEP_MM / 2
    depth = widths[-1][0] + half
    undercut = max(wd for _, wd in widths)
    chamber = [d for d, wd in widths if wd >= undercut - CHAMBER_TOL_MM]
    lip = chamber[0] - half
    opening = min(wd for d, wd in widths if d < lip)
    end = chamber[-1] + half
    bottom = widths[-1][1]
    tapered = depth - end > 0.2 and bottom < undercut - CHAMBER_TOL_MM
    r2 = lambda x: round(x, 2)  # noqa: E731
    return GrooveDims(
        r2(opening), r2(lip), r2(depth), r2(undercut),
        r2(end) if tapered else None, r2(bottom) if tapered else None,
    )
