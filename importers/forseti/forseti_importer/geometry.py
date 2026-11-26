"""Plane geometry for section outlines, in the standard library only: chaining line segments into
rings, nesting rings into one solid with holes, section properties by the polygon formulas, and
scan lines for measuring grooves."""

from __future__ import annotations

from collections import defaultdict

Pt = tuple[float, float]
Ring = list[Pt]


def chain(segments: list[tuple[Pt, Pt]], tol: float) -> list[tuple[Ring, bool]]:
    """Joins segments whose ends meet (within `tol`, on a grid) into rings, in segment order.
    Returns each chain with whether it closed. The closing point is not repeated."""

    def key(p: Pt) -> tuple[int, int]:
        return (round(p[0] / tol), round(p[1] / tol))

    adj: dict[tuple[int, int], list[tuple[int, Pt, tuple[int, int]]]] = defaultdict(list)
    for i, (a, b) in enumerate(segments):
        adj[key(a)].append((i, b, key(b)))
        adj[key(b)].append((i, a, key(a)))
    used: set[int] = set()
    out: list[tuple[Ring, bool]] = []
    for i, (a, b) in enumerate(segments):
        if i in used:
            continue
        used.add(i)
        pts: Ring = [a, b]
        start = key(a)
        cur = key(b)
        while cur != start:
            nxt = [t for t in adj[cur] if t[0] not in used]
            if not nxt:
                break
            j, p, k = nxt[0]
            used.add(j)
            pts.append(p)
            cur = k
        closed = cur == start
        if closed:
            pts.pop()
        out.append((pts, closed))
    return out


def signed_area(r: Ring) -> float:
    s = 0.0
    n = len(r)
    for i in range(n):
        x0, y0 = r[i]
        x1, y1 = r[(i + 1) % n]
        s += x0 * y1 - x1 * y0
    return s / 2


def inside(p: Pt, r: Ring) -> bool:
    """Even-odd point in polygon."""
    x, y = p
    c = False
    n = len(r)
    for i in range(n):
        x0, y0 = r[i]
        x1, y1 = r[(i + 1) % n]
        if (y0 > y) != (y1 > y) and x < (x1 - x0) * (y - y0) / (y1 - y0) + x0:
            c = not c
    return c


def nest(rings: list[Ring]) -> tuple[Ring, list[Ring]]:
    """One solid with holes from non-crossing rings: the largest ring is the outline, rings inside
    it at depth 1 are holes. Anything else (a second solid, an island in a hole) is an error."""
    order = sorted(range(len(rings)), key=lambda i: (-abs(signed_area(rings[i])), i))
    depth = {}
    for i in order:
        p = rings[i][0]
        depth[i] = sum(1 for j in order if j != i and abs(signed_area(rings[j])) > abs(signed_area(rings[i])) and inside(p, rings[j]))
    outers = [i for i in order if depth[i] == 0]
    if len(outers) != 1 or any(d > 1 for d in depth.values()):
        raise ValueError(f"expected one solid with holes, got depths {sorted(depth.values())}")
    return rings[outers[0]], [rings[i] for i in order if depth[i] == 1]


def props(outline: Ring, holes: list[Ring]) -> dict[str, float]:
    """Area, centroid, and Ix, Iy about the centroid (Green's theorem per ring)."""
    a = sx = sy = sxx = syy = 0.0
    for k, r in enumerate([outline, *holes]):
        sign = 1 if k == 0 else -1
        ra = signed_area(r)
        orient = 1 if ra > 0 else -1
        ca = cx = cy = cxx = cyy = 0.0
        n = len(r)
        for i in range(n):
            x0, y0 = r[i]
            x1, y1 = r[(i + 1) % n]
            c = x0 * y1 - x1 * y0
            ca += c
            cx += (x0 + x1) * c
            cy += (y0 + y1) * c
            cxx += (x0 * x0 + x0 * x1 + x1 * x1) * c
            cyy += (y0 * y0 + y0 * y1 + y1 * y1) * c
        f = sign * orient
        a += f * ca / 2
        sx += f * cx / 6
        sy += f * cy / 6
        sxx += f * cxx / 12
        syy += f * cyy / 12
    gx, gy = sx / a, sy / a
    return {"A": a, "cx": gx, "cy": gy, "Ix": syy - a * gy * gy, "Iy": sxx - a * gx * gx}


def crossings(rings: list[Ring], v: float) -> list[float]:
    """Where the line y = v crosses the rings' edges, sorted (half-open rule at vertices)."""
    xs: list[float] = []
    for r in rings:
        n = len(r)
        for i in range(n):
            x0, y0 = r[i]
            x1, y1 = r[(i + 1) % n]
            if (y0 > v) != (y1 > v):
                xs.append(x0 + (v - y0) * (x1 - x0) / (y1 - y0))
    return sorted(xs)


def gap_at(rings: list[Ring], v: float, u: float) -> float | None:
    """The width of the empty interval on the line y = v that contains x = u, or None when u is
    in material. Outside every ring counts as empty, bounded by the nearest crossings."""
    xs = crossings(rings, v)
    left = [x for x in xs if x <= u]
    right = [x for x in xs if x > u]
    if len(left) % 2 == 1:
        return None
    lo = left[-1] if left else float("-inf")
    hi = right[0] if right else float("inf")
    return hi - lo
