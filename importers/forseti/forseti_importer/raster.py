"""Reading a T-slot groove off a profile drawn as a raster image (after the round-4 acceptance, F9).

The build does not run this: a raster reading needs judgement (which printed dimension calibrates
the image's line weight, how far to trust an edge), so its results are reviewed values in
`tables.GROOVE_READ`, each with its range. This prints the raw readings those values come from, so
a review can repeat them:

    python3 -I importers/forseti/import_forseti.py read-groove <catalogue PDF> <page> <xref> \\
        <w_mm> <h_mm> <face> <at_mm> [<x0,y0,x1,y1 crop in pixels>]

The profile is the image's dark region; its box is taken from the rows and columns whose dark run
covers more than half the darkest one (so thin dimension lines and text inside the crop do not
widen it), and gives the scale (the profile's printed width and height). Lines are sampled
bilinearly, and an edge is where the grey crosses the midpoint between the profile's fill and
white; a dark run shorter than THIN_MM (a centre line or a dimension line drawn over the profile)
is not material. In the groove's frame, s runs across the face from the groove's centre line and d
into the bar from the face's edge in the image.

The readings follow `pdfcat.measure_groove`'s definitions on an exact outline (the empty width
down the centre line: the undercut is the widest run, the opening the narrowest width above the
lip, a taper runs from where the undercut ends to the width just above the floor), except that the
lip ends where the width is half way from the opening to the undercut (a raster's chamber walls
are not straight enough to say where the undercut starts), and add the hook (the width over the material beside the opening just above the lip's
underside, where the chamber rises toward the face beyond it) and the wall (where that rise ends,
down the middle of the rise). They are raw: the image's outline stroke widens the dark region by
some fraction of a millimetre, which the review measures against the dimensions the page prints
and takes out.
"""

from __future__ import annotations

import pymupdf

#: Pixels darker than this are the profile: its fill and its outline.
DARK = 200
#: A dark run shorter than this is a line drawn over the profile, not material.
THIN_MM = 0.45
#: Sampling step along a line.
STEP = 0.01
#: Widths within this of the widest are the undercut (the raster's edge noise).
CHAMBER_TOL_MM = 0.15


def _grey(doc: pymupdf.Document, xref: int) -> tuple[int, int, list[list[float]]]:
    pix = pymupdf.Pixmap(doc, xref)
    if pix.n - pix.alpha >= 4 or pix.alpha:
        pix = pymupdf.Pixmap(pymupdf.csRGB, pix)
    n, w, h, data = pix.n, pix.width, pix.height, pix.samples
    k = min(3, n)
    rows = [[sum(data[(y * w + x) * n + c] for c in range(k)) / k for x in range(w)] for y in range(h)]
    return w, h, rows


class Image:
    """A profile's raster image, in the section frame of a profile `size` wide and tall."""

    def __init__(self, doc: pymupdf.Document, xref: int, size: tuple[float, float],
                 crop: tuple[int, int, int, int] | None = None) -> None:
        w, h, g = _grey(doc, xref)
        if crop:
            x0c, y0c, x1c, y1c = crop
            g = [[(g[y][x] if x0c <= x <= x1c and y0c <= y <= y1c else 255.0) for x in range(w)]
                 for y in range(h)]
        colc = [sum(1 for y in range(h) if g[y][x] < DARK) for x in range(w)]
        rowc = [sum(1 for x in range(w) if g[y][x] < DARK) for y in range(h)]
        cols = [x for x in range(w) if colc[x] > 0.5 * max(colc)]
        rows = [y for y in range(h) if rowc[y] > 0.5 * max(rowc)]
        self.px, self.box = (w, h), (min(cols), max(cols), min(rows), max(rows))
        x0, x1, y0, y1 = self.box
        self.W, self.H = size
        self.sx, self.sy = (x1 - x0 + 1) / self.W, (y1 - y0 + 1) / self.H
        dark = sorted(g[y][x] for y in range(y0, y1 + 1) for x in range(x0, x1 + 1) if g[y][x] < DARK)
        self.mid = (255.0 + dark[len(dark) // 2]) / 2
        self.g = g

    def grey(self, x_mm: float, y_mm: float) -> float:
        x0, _, y0, _ = self.box
        px = x0 - 0.5 + (x_mm + self.W / 2) * self.sx
        py = y0 - 0.5 + (self.H / 2 - y_mm) * self.sy
        ix, iy = int(px), int(py)
        fx, fy = px - ix, py - iy
        w, h = self.px

        def v(a: int, b: int) -> float:
            return self.g[b][a] if 0 <= a < w and 0 <= b < h else 255.0
        return (v(ix, iy) * (1 - fx) * (1 - fy) + v(ix + 1, iy) * fx * (1 - fy)
                + v(ix, iy + 1) * (1 - fx) * fy + v(ix + 1, iy + 1) * fx * fy)


class Groove:
    """One groove of an Image: material along lines in its (s across, d inward) frame."""

    def __init__(self, img: Image, face: str, at_mm: float) -> None:
        self.img, self.face, self.at = img, face, at_mm

    def material(self, s: float, d: float) -> bool:
        W, H, a = self.img.W, self.img.H, self.at
        x, y = {"+y": (a + s, H / 2 - d), "-y": (a - s, -H / 2 + d),
                "+x": (W / 2 - d, a + s), "-x": (-W / 2 + d, a - s)}[self.face]
        return self.img.grey(x, y) < self.img.mid

    def runs(self, fn, lo: float, hi: float) -> list[tuple[float, float]]:
        """The material runs of fn over [lo, hi], each at least THIN_MM long."""
        out, start, t = [], None, lo
        n = round((hi - lo) / STEP)
        for i in range(n + 1):
            t = lo + i * STEP
            m = fn(t)
            if m and start is None:
                start = t
            elif not m and start is not None:
                out.append((start - STEP / 2, t - STEP / 2))
                start = None
        if start is not None:
            out.append((start - STEP / 2, hi))
        return [(a, b) for a, b in out if b - a >= THIN_MM]

    def gap(self, d: float, reach: float = 13.5) -> tuple[float, float] | None:
        """The empty interval across the centre line at depth d, or None on material."""
        runs = self.runs(lambda s: self.material(s, d), -reach, reach)
        left = max((b for a, b in runs if b <= 0), default=None)
        right = min((a for a, b in runs if a >= 0), default=None)
        if any(a < 0 < b for a, b in runs) or left is None or right is None:
            return None
        return left, right

    def read(self) -> dict:
        widths: list[tuple[float, float, float]] = []
        d = 0.05
        while d < 20:
            gp = self.gap(d)
            if gp is None:
                break
            widths.append((d, gp[0], gp[1]))
            d = round(d + 0.05, 4)
        floor = self.runs(lambda t: self.material(0.0, t), 0.3, 20)
        depth = floor[0][0] if floor else None
        undercut = max(r - le for _, le, r in widths)
        chamber = [x for x, le, r in widths if r - le >= undercut - CHAMBER_TOL_MM]
        # The lip's underside: where the width leaves the opening for the chamber (half way). On
        # an exact outline it is where the undercut starts; a raster's chamber walls are not
        # straight enough to tell that within CHAMBER_TOL_MM.
        narrow = min(r - le for x, le, r in widths if x < chamber[0])
        lip = next(x for x, le, r in widths if r - le > (narrow + undercut) / 2) - 0.025
        above = [(x, le, r) for x, le, r in widths if x < lip]
        opening = min(r - le for _, le, r in above)
        end = chamber[-1] + 0.025
        last = widths[-1]
        out = {"opening": opening, "lip": lip, "depth": depth, "undercut": undercut,
               "taper_from": end, "bottom": last[2] - last[1], "bottom_at": last[0]}
        # The hook: just above the lip's underside, the material beside the opening ends where the
        # chamber rises toward the face.
        at = lip - 0.3
        runs = self.runs(lambda s: self.material(s, at), -13.5, 13.5)
        o = [r for r in runs if r[1] <= 0]
        p = [r for r in runs if r[0] >= 0]
        lo, hi = (o[-1] if o else None), (p[0] if p else None)
        if lo and hi and lo[0] > -undercut / 2 + 0.3 and hi[1] < undercut / 2 - 0.3:
            out["hook"] = hi[1] - lo[0]
            out["hook_sides"] = (lo[0], hi[1])
            walls = []
            for s in ((lo[0] - undercut / 2) / 2, (hi[1] + undercut / 2) / 2):
                rs = self.runs(lambda t, s=s: self.material(s, t), -1.0, lip)
                walls.append(rs[0][1] if rs else None)
            out["wall_sides"] = tuple(walls)
            if all(x is not None for x in walls):
                out["wall"] = sum(walls) / 2
        return out


def read_groove(doc: pymupdf.Document, xref: int, size: tuple[float, float], face: str, at_mm: float,
                crop: tuple[int, int, int, int] | None = None) -> list[str]:
    img = Image(doc, xref, size, crop)
    r = Groove(img, face, at_mm).read()
    x0, x1, y0, y1 = img.box
    out = [f"image {img.px[0]}x{img.px[1]} px; profile box x {x0}..{x1}, y {y0}..{y1} px; "
           f"{img.sx:.3f} x {img.sy:.3f} px/mm; edge grey {img.mid:.0f}",
           f"raw, in mm from the face's edge in the image (the outline stroke not taken out):"]
    for k in ("opening", "lip", "depth", "undercut", "taper_from", "bottom", "hook", "wall"):
        if k in r and r[k] is not None:
            out.append(f"  {k}: {r[k]:.2f}")
    if "hook_sides" in r:
        out.append(f"  hook sides at s {r['hook_sides'][0]:.2f} and {r['hook_sides'][1]:.2f}; "
                   f"wall {' and '.join(f'{w:.2f}' for w in r['wall_sides'] if w is not None)}")
    out.append(f"  bottom measured at d {r['bottom_at']:.2f}")
    return out
