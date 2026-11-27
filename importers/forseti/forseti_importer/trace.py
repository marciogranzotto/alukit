"""Tracing a profile drawn as a raster image into an outline with holes (fidelity `traced`, design
§3.5; docs/notes/forseti-traced-sections.md), in the standard library and PyMuPDF only.

The steps, each a standard method:

1. **The layer.** The image's soft mask where it has one (the drawing's silhouette, at a higher
   resolution than its colour samples), else its grey levels over white. Either becomes material
   coverage in [0, 1]: the mask's alpha, or (255 - grey) / (255 - fill) clamped, where fill is the
   median grey of the dark pixels (the profile's fill).
2. **Contours** by marching squares at coverage 0.5 (the 50 % edge criterion), the crossing on
   each cell edge placed by linear interpolation, saddles resolved by the cell's mean
   (Lorensen and Cline 1987, in two dimensions; the method of scikit-image's `find_contours`).
3. **Rings.** The largest ring is the outline; rings inside it are holes; anything else (a speck,
   a fragment of a centre line) and any ring under `min_area` is dropped and counted.
4. **Simplification** by Douglas-Peucker (Ramer 1972; Douglas and Peucker 1973) at a tolerance in
   pixels, a fraction of the image's own resolution.
5. **The edge offset.** An image of an outlined profile draws each edge as a stroke centred on it,
   so its silhouette is the section dilated by a margin `delta` (half the stroke, plus the
   threshold's own bias). `delta` and the scale come from the dimensions the page prints, as an
   imaging measuring machine's probing offset does (ISO 10360-7): a length across material reads
   2 delta long, a gap 2 delta short, a pitch or a depth to a floor unchanged. `calibrate` fits
   both by least squares and reports the residuals.
6. **Erosion.** The silhouette less a disc of radius `delta` (its inner parallel at that
   distance), taken as the contour at `-delta` of the exact signed distance to the silhouette's
   rings, sampled in a narrow band (exact point-to-segment distances, the sign by scan-line
   parity), then simplified again.

Coordinates here are the image's pixels (x right, y down, a pixel's centre at +0.5) until
`trace_profile` turns them into the section frame (`axes`) and scales them to mm.
"""

from __future__ import annotations

import bisect
import math
from dataclasses import dataclass, field

import pymupdf

from . import geometry as g
from . import pdfcat

#: Coverage level of an edge (the 50 % criterion).
LEVEL = 0.5


# --- The layer -------------------------------------------------------------------------------------

@dataclass
class Layer:
    """Material coverage per pixel, row-major, 0 (white) to 1 (the profile)."""

    w: int
    h: int
    rows: list[list[float]]
    source: str
    #: The image's own size, when the layer is its soft mask at another resolution.
    image_px: tuple[int, int]


def _samples(pix: pymupdf.Pixmap) -> list[list[float]]:
    """A pixmap's grey per pixel (the mean of its colour components)."""
    if pix.alpha:
        pix = pymupdf.Pixmap(pix, 0)
    if pix.colorspace is not None and pix.colorspace.n not in (1, 3):
        pix = pymupdf.Pixmap(pymupdf.csRGB, pix)
    n, w, h, data = pix.n, pix.width, pix.height, pix.samples
    if n == 1:
        return [[float(data[y * w + x]) for x in range(w)] for y in range(h)]
    return [[(data[(y * w + x) * n] + data[(y * w + x) * n + 1] + data[(y * w + x) * n + 2]) / 3
             for x in range(w)] for y in range(h)]


def _filter(rows: list[list[float]], pick) -> list[list[float]]:
    """A 3x3 grey-level filter (min or max), the border treated as empty."""
    h, w = len(rows), len(rows[0])
    get = lambda x, y: rows[y][x] if 0 <= x < w and 0 <= y < h else 0.0  # noqa: E731
    return [[pick(get(x + i, y + j) for i in (-1, 0, 1) for j in (-1, 0, 1)) for x in range(w)]
            for y in range(h)]


def opening(rows: list[list[float]], n: int) -> list[list[float]]:
    """Grey-level morphological opening by a (2n+1)-pixel square: n erosions (3x3 minimum), then n
    dilations (3x3 maximum). It removes material thinner than about 2n+1 pixels (dimension and
    centre lines drawn into an image) and restores straight edges where they were; a convex corner
    comes back rounded by about n pixels (Serra 1982; Gonzalez and Woods, ch. 9)."""
    for _ in range(n):
        rows = _filter(rows, min)
    for _ in range(n):
        rows = _filter(rows, max)
    return rows


def layer(doc: pymupdf.Document, xref: int, use: str = "auto",
          crop: tuple[int, int, int, int] | None = None, open_px: int = 0) -> Layer:
    """The coverage layer of image `xref`: its soft mask (`use` "mask", or "auto" when it has one)
    or its grey levels ("image"). `crop` (x0, y0, x1, y1, inclusive, in the layer's pixels) blanks
    everything outside it, and `open_px` opens it (`opening`): dimensions drawn into the image."""
    base = pymupdf.Pixmap(doc, xref)
    smask = doc.xref_get_key(xref, "SMask")
    has_mask = smask[0] == "xref"
    if use == "mask" or (use == "auto" and has_mask):
        if not has_mask:
            raise ValueError(f"image {xref} has no soft mask")
        m = pymupdf.Pixmap(doc, int(smask[1].split()[0]))
        rows = [[v / 255 for v in r] for r in _samples(m)]
        source = f"soft mask {m.width}x{m.height} px of image {xref}"
        w, h = m.width, m.height
    else:
        grey = _samples(base)
        w, h = base.width, base.height
        dark = sorted(v for r in grey for v in r if v < 200)
        if not dark:
            raise ValueError(f"image {xref}: no dark pixels")
        fill = dark[len(dark) // 2]
        rows = [[min(1.0, max(0.0, (255 - v) / (255 - fill))) for v in r] for r in grey]
        source = f"grey levels {w}x{h} px of image {xref} (fill grey {fill:.0f})"
    if crop:
        x0, y0, x1, y1 = crop
        rows = [[(v if x0 <= x <= x1 and y0 <= y <= y1 else 0.0) for x, v in enumerate(r)]
                for y, r in enumerate(rows)]
        source += f", cropped to x {x0}..{x1}, y {y0}..{y1}"
    if open_px:
        rows = opening(rows, open_px)
        source += f", opened by {2 * open_px + 1} px"
    return Layer(w, h, rows, source, (base.width, base.height))


# --- Marching squares -------------------------------------------------------------------------------

def march(value, pos, cells, level: float) -> list[g.Ring]:
    """Marching squares: the closed iso-lines at `level` of a field sampled on a grid of nodes
    (i, j), over the given cells (each named by its top-left node). `value(i, j)` is a node's
    value and `pos(i, j)` its coordinates (x right, y down). A node above `level` is material; the
    crossing on a cell edge is placed by linear interpolation. Every iso-line must close inside
    the cells given. Material lies on the left of every ring's direction (in y-down coordinates),
    so an outline and its holes turn opposite ways."""

    def cross(p: tuple[int, int], q: tuple[int, int]) -> g.Pt:
        vp, vq = value(*p), value(*q)
        t = (level - vp) / (vq - vp)
        (x0, y0), (x1, y1) = pos(*p), pos(*q)
        return (x0 + t * (x1 - x0), y0 + t * (y1 - y0))

    nxt: dict[tuple, tuple] = {}
    point: dict[tuple, g.Pt] = {}
    for i, j in cells:
        a, b, c, d = (i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1)
        vs = [value(*q) for q in (a, b, c, d)]
        ins = [v > level for v in vs]
        if all(ins) or not any(ins):
            continue
        # The cell's edges in clockwise order (y down): top a-b, right b-c, bottom c-d, left d-a.
        # Walking them, an edge leaves the material (in → out) or enters it (out → in). Every
        # segment runs from a leaving edge to an entering one, so the material lies on its left
        # whatever the crossings' positions: orientation is topological, and a crossing on a
        # corner (a zero-length segment) cannot flip it.
        edges = {"t": (a, b, ("h", i, j)), "r": (b, c, ("v", i + 1, j)),
                 "b": (c, d, ("h", i, j + 1)), "l": (d, a, ("v", i, j))}
        inside = {a: ins[0], b: ins[1], c: ins[2], d: ins[3]}
        leaving = [e for e, (p, q, _) in edges.items() if inside[p] and not inside[q]]
        entering = [e for e, (p, q, _) in edges.items() if inside[q] and not inside[p]]
        if len(leaving) == 1:
            pairs = [(leaving[0], entering[0])]
        else:
            # A saddle: with the mean inside, the inside corners join and the outside ones are cut
            # off; otherwise the inside corners are cut off. Cutting off a corner pairs its two
            # edges.
            cut_b_d = (not ins[1]) if sum(vs) / 4 > level else (not ins[0])
            pairs = [("t", "r"), ("b", "l")] if cut_b_d else [("l", "t"), ("r", "b")]
            pairs = [(e1, e2) if e1 in leaving else (e2, e1) for e1, e2 in pairs]
        for e1, e2 in pairs:
            k1, k2 = edges[e1][2], edges[e2][2]
            point.setdefault(k1, cross(edges[e1][0], edges[e1][1]))
            point.setdefault(k2, cross(edges[e2][0], edges[e2][1]))
            if k1 in nxt:
                raise ValueError(f"marching squares: edge {k1} starts two segments")
            nxt[k1] = k2
    rings: list[g.Ring] = []
    seen: set[tuple] = set()
    for start in sorted(nxt):
        if start in seen:
            continue
        ring, k = [], start
        while k not in seen:
            seen.add(k)
            ring.append(point[k])
            k = nxt.get(k)
            if k is None:
                raise ValueError(f"marching squares: an iso-line leaves the cells given at {ring[-1]}")
        if k != start:
            raise ValueError("marching squares: an open chain")
        rings.append(ring)
    return rings


def contours(ly: Layer, level: float = LEVEL) -> list[g.Ring]:
    """The closed iso-lines of the layer at `level` on its pixel centres, with a border of zero
    coverage so that every ring closes."""
    w, h = ly.w + 2, ly.h + 2
    val = [[0.0] * w for _ in range(h)]
    for y, r in enumerate(ly.rows):
        val[y + 1][1:ly.w + 1] = r
    return march(lambda i, j: val[j][i], lambda i, j: (i - 0.5, j - 0.5),
                 ((i, j) for j in range(h - 1) for i in range(w - 1)), level)


# --- Douglas-Peucker -----------------------------------------------------------------------------

def _dp(pts: list[g.Pt], eps: float) -> list[g.Pt]:
    """Douglas-Peucker on an open chain, iteratively; keeps both ends."""
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        i, j = stack.pop()
        (x0, y0), (x1, y1) = pts[i], pts[j]
        dx, dy = x1 - x0, y1 - y0
        ln = math.hypot(dx, dy)
        best, at = -1.0, -1
        for k in range(i + 1, j):
            x, y = pts[k]
            dist = (abs(dy * (x - x0) - dx * (y - y0)) / ln) if ln > 0 else math.hypot(x - x0, y - y0)
            if dist > best:
                best, at = dist, k
        if at >= 0 and best > eps:
            keep[at] = True
            stack.append((i, at))
            stack.append((at, j))
    return [p for p, k in zip(pts, keep) if k]


def simplify(ring: g.Ring, eps: float) -> g.Ring:
    """Douglas-Peucker on a closed ring: split at its lowest-leftmost point and the point farthest
    from it, each half simplified to `eps`."""
    n = len(ring)
    i0 = min(range(n), key=lambda i: (ring[i][0], ring[i][1]))
    r = ring[i0:] + ring[:i0]
    far = max(range(n), key=lambda i: (r[i][0] - r[0][0]) ** 2 + (r[i][1] - r[0][1]) ** 2)
    a = _dp(r[:far + 1], eps)
    b = _dp(r[far:] + [r[0]], eps)
    out = a[:-1] + b[:-1]
    return out if len(out) >= 3 else r[:3]


# --- Rings -------------------------------------------------------------------------------------

@dataclass
class Rings:
    outline: g.Ring
    holes: list[g.Ring]
    #: Rings left out: (where, area) in the rings' units.
    dropped: list[tuple[g.Pt, float]] = field(default_factory=list)


def select(rings: list[g.Ring], min_area: float) -> Rings:
    """The largest ring is the outline, the rings inside it of at least `min_area` its holes, unless
    they lie inside another such hole; everything else is dropped."""
    order = sorted(rings, key=lambda r: (-abs(g.signed_area(r)), r[0]))
    outline, rest = order[0], order[1:]
    holes: list[g.Ring] = []
    dropped: list[tuple[g.Pt, float]] = []
    for r in rest:
        a = abs(g.signed_area(r))
        if a >= min_area and g.inside(r[0], outline) and not any(g.inside(r[0], hh) for hh in holes):
            holes.append(r)
        else:
            dropped.append((r[0], a))
    return Rings(outline, holes, dropped)


# --- Erosion -------------------------------------------------------------------------------------

def _seg_dist(x: float, y: float, p: g.Pt, q: g.Pt) -> float:
    dx, dy = q[0] - p[0], q[1] - p[1]
    len2 = dx * dx + dy * dy
    t = 0.0 if len2 == 0 else max(0.0, min(1.0, ((x - p[0]) * dx + (y - p[1]) * dy) / len2))
    return math.hypot(p[0] + t * dx - x, p[1] + t * dy - y)


def offset(r: Rings, delta: float, step: float, min_area: float) -> Rings:
    """The region less a disc of radius `delta` (its inner parallel; a negative `delta` grows it):
    the iso-line at `delta` of the signed distance to its rings (positive in material), sampled
    on a grid of spacing `step` only within `|delta| + 3 step` of a ring, the distances exact
    (point to segment), the sign by the parity of the rings' crossings along each grid row."""
    rings = [r.outline, *r.holes]
    segs = [(ring[k], ring[(k + 1) % len(ring)]) for ring in rings for k in range(len(ring))
            if ring[k] != ring[(k + 1) % len(ring)]]
    band = abs(delta) + 3 * step
    x0 = min(p[0] for ring in rings for p in ring) - band - step
    y0 = min(p[1] for ring in rings for p in ring) - band - step
    dist: dict[tuple[int, int], float] = {}
    for p, q in segs:
        i0 = math.floor((min(p[0], q[0]) - band - x0) / step)
        i1 = math.ceil((max(p[0], q[0]) + band - x0) / step)
        j0 = math.floor((min(p[1], q[1]) - band - y0) / step)
        j1 = math.ceil((max(p[1], q[1]) + band - y0) / step)
        for j in range(j0, j1 + 1):
            y = y0 + j * step
            for i in range(i0, i1 + 1):
                dd = _seg_dist(x0 + i * step, y, p, q)
                if dd <= band and dd < dist.get((i, j), math.inf):
                    dist[(i, j)] = dd
    rows: dict[int, list[float]] = {}
    for (xa, ya), (xb, yb) in segs:
        if ya == yb:
            continue
        lo, hi = min(ya, yb), max(ya, yb)
        # The range is one row wider each way; the half-open test, on the same row heights as the
        # nodes, decides (a division and a product can round to different sides of a vertex).
        for j in range(math.floor((lo - y0) / step), math.ceil((hi - y0) / step) + 1):
            y = y0 + j * step
            if lo <= y < hi:
                rows.setdefault(j, []).append(xa + (y - ya) * (xb - xa) / (yb - ya))
    for xs in rows.values():
        xs.sort()
    signed: dict[tuple[int, int], float] = {}
    for (i, j), dd in dist.items():
        inside = bisect.bisect_left(rows.get(j, []), x0 + i * step) % 2 == 1
        signed[(i, j)] = dd if inside else -dd
    cells = sorted((i, j) for (i, j) in signed
                   if (i + 1, j) in signed and (i, j + 1) in signed and (i + 1, j + 1) in signed)
    out = march(lambda i, j: signed[(i, j)], lambda i, j: (x0 + i * step, y0 + j * step), cells, delta)
    return select(out, min_area)


# --- Calibration ---------------------------------------------------------------------------------

@dataclass
class Measure:
    """One dimension the page prints, read off the silhouette in pixels along one axis of the
    section frame."""

    what: str
    axis: str  # "x" or "y"
    printed_mm: float
    #: How the silhouette's margin enters the reading: +2 across material, -2 across a gap, 0 for
    #: a pitch or a depth to a floor (ISO 10360-7's bidirectional and unidirectional lengths).
    k: int
    read_px: float


@dataclass
class Calibration:
    #: Pixels per mm along the section's x and y (an image's pixels need not be square).
    sx: float
    sy: float
    delta_px: float
    #: Standard error of delta (zero when the fit is exactly determined).
    se_delta_px: float
    residuals_mm: list[tuple[str, float]]

    @property
    def s(self) -> float:
        return (self.sx + self.sy) / 2

    @property
    def delta_mm(self) -> float:
        return self.delta_px / self.s

    @property
    def se_delta_mm(self) -> float:
        return self.se_delta_px / self.s


def _solve(a: list[list[float]], b: list[float]) -> list[float]:
    """Gaussian elimination with partial pivoting."""
    n = len(b)
    m = [row[:] + [b[i]] for i, row in enumerate(a)]
    for c in range(n):
        p = max(range(c, n), key=lambda r: abs(m[r][c]))
        if abs(m[p][c]) < 1e-12:
            raise ValueError("calibration: the readings do not determine the scale and the margin")
        m[c], m[p] = m[p], m[c]
        for r in range(n):
            if r != c:
                f = m[r][c] / m[c][c]
                m[r] = [v - f * w for v, w in zip(m[r], m[c])]
    return [m[i][n] / m[i][i] for i in range(n)]


def calibrate(ms: list[Measure]) -> Calibration:
    """Least squares for the scales sx, sy (px/mm) and the margin delta (px) in
    read = s_axis printed + k delta."""
    rows = [([m.printed_mm if m.axis == "x" else 0.0, m.printed_mm if m.axis == "y" else 0.0,
              float(m.k)], m.read_px) for m in ms]
    ata = [[sum(r[0][i] * r[0][j] for r in rows) for j in range(3)] for i in range(3)]
    atb = [sum(r[0][i] * r[1] for r in rows) for i in range(3)]
    sx, sy, dl = _solve(ata, atb)
    res = [(m.what, (m.read_px - (sx if m.axis == "x" else sy) * m.printed_mm - m.k * dl)
            / (sx if m.axis == "x" else sy)) for m in ms]
    dof = len(ms) - 3
    if dof > 0:
        var = sum((m.read_px - (sx if m.axis == "x" else sy) * m.printed_mm - m.k * dl) ** 2
                  for m in ms) / dof
        # The variance of delta: var times the (3, 3) entry of the inverse normal matrix.
        e = _solve(ata, [0.0, 0.0, 1.0])
        se = math.sqrt(var * e[2])
    else:
        se = 0.0
    return Calibration(sx, sy, dl, se, res)


# --- A profile, traced --------------------------------------------------------------------------

#: Douglas-Peucker tolerance on the silhouette, in the layer's pixels: well under the trace's
#: noise (0.2-0.3 px), so it drops the marching squares' redundant points and moves the area by
#: under 0.06 % (measured on the vector-checked images).
EPS_PX = 0.1
#: Rings under this area (layer pixels) are specks, not holes.
MIN_AREA_PX = 4.0
#: The erosion's grid step and the final simplification tolerance (mm).
ERODE_STEP_MM = 0.04
EPS_MM = 0.01
#: Groove dimensions by how the silhouette's margin enters them (Measure.k), and whether they run
#: across the face (the opening, the undercut) or into it (the lip, the depth).
GROOVE_K = {"opening_mm": (-2, "across"), "undercut_mm": (-2, "across"), "lip_mm": (2, "into"),
            "depth_mm": (0, "into")}


#: The arc step when a hole's boundary is pressed onto a bore's circle (degrees), as the
#: generators flatten arcs (design §3.5).
ARC_STEP_DEG = 0.5


def bore(hole: g.Ring, centre: g.Pt) -> float:
    """The diameter of the largest circle about `centre` inside the hole: its bore there."""
    x, y = centre
    return 2 * min(_seg_dist(x, y, hole[k], hole[(k + 1) % len(hole)]) for k in range(len(hole)))


def snap_bore(hole: g.Ring, centre: g.Pt, d: float) -> g.Ring:
    """The hole with its boundary pressed out onto the circle of diameter `d` about `centre`
    wherever it lies inside it (snapping a traced bore to its printed diameter): an edge that
    crosses the circle is split there, and every run of the boundary inside it becomes the arc
    between the run's ends (the shorter way round), flattened at ARC_STEP_DEG."""
    cx, cy = centre
    r = d / 2

    def ang(p: g.Pt) -> float:
        return math.atan2(p[1] - cy, p[0] - cx)

    def on(a: float) -> g.Pt:
        return (cx + r * math.cos(a), cy + r * math.sin(a))

    # The boundary with its crossings of the circle, each point marked inside or on the circle.
    pts: list[tuple[g.Pt, bool]] = []
    n = len(hole)
    for i in range(n):
        p, q = hole[i], hole[(i + 1) % n]
        pts.append((p, math.hypot(p[0] - cx, p[1] - cy) < r))
        dx, dy = q[0] - p[0], q[1] - p[1]
        a, b, c = dx * dx + dy * dy, 2 * ((p[0] - cx) * dx + (p[1] - cy) * dy), \
            (p[0] - cx) ** 2 + (p[1] - cy) ** 2 - r * r
        disc = b * b - 4 * a * c
        if a == 0 or disc <= 0:
            continue
        for t in sorted(((-b - math.sqrt(disc)) / (2 * a), (-b + math.sqrt(disc)) / (2 * a))):
            if 0 < t < 1:
                pts.append(((p[0] + t * dx, p[1] + t * dy), True))
    if all(inside for _, inside in pts):
        raise ValueError(f"the hole lies inside the bore Ø{d} at {centre}")
    # Start outside the circle; replace each run of inside or crossing points by its arc.
    k = next(i for i, (p, inside) in enumerate(pts) if not inside)
    pts = pts[k:] + pts[:k]
    out: list[g.Pt] = []
    i = 0
    while i < len(pts):
        p, inside = pts[i]
        if not inside:
            out.append(p)
            i += 1
            continue
        j = i
        while j < len(pts) and pts[j][1]:
            j += 1
        a0, a1 = ang(pts[i][0]), ang(pts[j - 1][0])
        span = (a1 - a0 + math.pi) % (2 * math.pi) - math.pi
        steps = max(1, math.ceil(abs(math.degrees(span)) / ARC_STEP_DEG))
        out.extend(on(a0 + span * s / steps) for s in range(steps + 1))
        i = j
    return out


#: A face is where the outline's edges parallel to it run over at least this share of the side,
#: within FACE_TOL_PX of one position, no farther in than FACE_BAND_PX from the outline's extreme.
FACE_SHARE = 0.1
FACE_TOL_PX = 0.75
FACE_BAND_PX = 4.0
#: Grooves are sampled from this far inside the face (mm): a traced face is only as straight as
#: its pixels.
GROOVE_START_MM = 0.4


def faces(r: g.Ring) -> tuple[float, float, float, float]:
    """The outline's faces (x min, x max, y min, y max): on each side, the outermost position that
    its edges parallel to that side occupy over at least FACE_SHARE of the side's length, so a
    leader line's end or a pixel's bump past the face does not move it."""
    xs, ys = [p[0] for p in r], [p[1] for p in r]
    box = (min(xs), max(xs), min(ys), max(ys))
    out = []
    for k, (axis, sign) in enumerate([(0, -1), (0, 1), (1, -1), (1, 1)]):
        extreme = box[k]
        need = FACE_SHARE * ((box[3] - box[2]) if axis == 0 else (box[1] - box[0]))
        segs = []
        for i in range(len(r)):
            p, q = r[i], r[(i + 1) % len(r)]
            along, across = abs(q[1 - axis] - p[1 - axis]), abs(q[axis] - p[axis])
            pos = (p[axis] + q[axis]) / 2
            if along > 3 * across and (extreme - pos) * sign < FACE_BAND_PX:
                segs.append((pos, along))
        segs.sort(key=lambda s: -s[0] * sign)
        for pos, _ in segs:
            near = [(p, ln) for p, ln in segs if abs(p - pos) <= FACE_TOL_PX]
            total = sum(ln for _, ln in near)
            if total >= need:
                out.append(sum(p * ln for p, ln in near) / total)
                break
        else:
            raise ValueError(f"no face on side {k} of the outline")
    return out[0], out[1], out[2], out[3]


def scan(outline: g.Ring, holes: list[g.Ring], along: str, at: g.Pt) -> tuple[float, bool]:
    """The run (of material or of empty space) through point `at` on the line through it along x
    or y: its length, and whether it is material."""
    rings = [outline, *holes]
    if along == "x":
        xs, u = g.crossings(rings, at[1]), at[0]
    else:
        xs, u = g.crossings([[(y, x) for x, y in r] for r in rings], at[0]), at[1]
    left = [x for x in xs if x <= u]
    right = [x for x in xs if x > u]
    if not left or not right:
        raise ValueError(f"scan along {along} through {at}: the run is not bounded")
    material = g.inside(at, outline) and not any(g.inside(at, h) for h in holes)
    return right[0] - left[-1], material


def axes(doc: pymupdf.Document, page: int, xref: int, turned: bool) -> tuple[g.Pt, g.Pt]:
    """The section-frame directions (x right, y up) of the image's pixel axes (x right, y down): the
    image as the page places it, flipped to y up, and turned 90° counter-clockwise when the page
    draws the profile lying (as `pdfcat.extract_outline` turns a vector outline)."""
    m = doc[page - 1].get_image_rects(xref, transform=True)[0][1]

    def unit(vx: float, vy: float) -> g.Pt:
        if abs(abs(vx) - abs(vy)) < 0.5 * max(abs(vx), abs(vy)):
            raise ValueError(f"image {xref} is placed at an angle that is not a multiple of 90°")
        return (math.copysign(1, vx), 0.0) if abs(vx) > abs(vy) else (0.0, math.copysign(1, vy))

    out = []
    for v in (unit(m.a, m.b), unit(m.c, m.d)):
        v = (v[0], -v[1])
        out.append((-v[1], v[0]) if turned else v)
    return out[0], out[1]


@dataclass
class Traced:
    outline: g.Ring
    holes: list[g.Ring]
    cal: Calibration
    source: str
    #: How far the eroded box was off the printed size before it was snapped to it (mm, x and y).
    snap_mm: tuple[float, float]
    dropped: int
    #: The silhouette's rings before erosion, in mm (for the record and the checks).
    silhouette: Rings


def trace_profile(doc: pymupdf.Document, spec: dict, size: tuple[float, float],
                  grooves: list[dict]) -> Traced:
    """A profile drawn as a raster image, traced (the steps in this module's docstring). `spec` is
    its `tables.TRACES` entry; `grooves` the faces and positions of its grooves; `size` its width
    and height. Fails rather than guess when the image does not give one solid with holes."""
    ly = layer(doc, spec["xref"], spec.get("use", "auto"), spec.get("crop"), spec.get("open_px", 0))
    sel = select(contours(ly), MIN_AREA_PX)
    ex, ey = axes(doc, spec["page"], spec["xref"], tuple(spec["drawn"]) != tuple(size))

    def frame(r: g.Ring) -> g.Ring:
        return [(x * ex[0] + y * ey[0], x * ex[1] + y * ey[1]) for x, y in simplify(r, EPS_PX)]

    o, hs = frame(sel.outline), [frame(h) for h in sel.holes]
    # The faces, robustly; anything past them (a leader line's end touching the profile) is
    # pressed onto them.
    x0, x1, y0, y1 = faces(o)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2

    def clamp(r: g.Ring) -> g.Ring:
        return [(min(max(x, x0), x1) - cx, min(max(y, y0), y1) - cy) for x, y in r]

    o, hs = clamp(o), [clamp(r) for r in hs]
    w, h = size
    bw, bh = x1 - x0, y1 - y0
    ms = [Measure("overall width", "x", w, 2, bw), Measure("overall height", "y", h, 2, bh)]
    # Grooves, read in a provisional frame scaled by the box (pdfcat.measure_groove's definitions).
    s0x, s0y = bw / w, bh / h
    om = [(x / s0x, y / s0y) for x, y in o]
    hm = [[(x / s0x, y / s0y) for x, y in r] for r in hs]
    for gr in spec.get("calibrate", grooves):
        d = pdfcat.measure_groove(om, hm, bw / s0x, bh / s0y, gr["face"], gr["at_mm"], GROOVE_START_MM)
        for name, printed in spec["printed"].items():
            k, way = GROOVE_K[name]
            across_x = gr["face"] in ("+y", "-y")
            axis = ("x" if across_x else "y") if way == "across" else ("y" if across_x else "x")
            ms.append(Measure(f"{name[:-3]} of the groove on {gr['face']} at {gr['at_mm']}", axis,
                              printed, k, getattr(d, name) * (s0x if axis == "x" else s0y)))
    for sc in spec.get("scans", []):
        length, material = scan(om, hm, sc["along"], sc["at"])
        axis = sc["along"]
        ms.append(Measure(sc["what"], axis, sc["printed"], 2 if material else -2,
                          length * (s0x if axis == "x" else s0y)))
    cal = calibrate(ms)
    to_mm = lambda r: [(x / cal.sx, y / cal.sy) for x, y in r]  # noqa: E731
    sil = Rings(to_mm(o), [to_mm(r) for r in hs], [])
    er = offset(sil, cal.delta_mm, ERODE_STEP_MM, MIN_AREA_PX / (cal.sx * cal.sy))
    if er.dropped:
        raise ValueError(f"image {spec['xref']}: the eroded silhouette is not one solid with holes "
                         f"({len(er.dropped)} rings left out)")
    xs, ys = [p[0] for p in er.outline], [p[1] for p in er.outline]
    ex0, ey0 = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    kx, ky = w / (max(xs) - min(xs)), h / (max(ys) - min(ys))

    def snap(r: g.Ring) -> g.Ring:
        return simplify([((x - ex0) * kx, (y - ey0) * ky) for x, y in r], EPS_MM)

    return Traced(snap(er.outline), [snap(r) for r in er.holes], cal, ly.source,
                  ((max(xs) - min(xs)) - w, (max(ys) - min(ys)) - h), len(sel.dropped), sil)
