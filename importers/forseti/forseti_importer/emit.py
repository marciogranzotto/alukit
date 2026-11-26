"""Canonical JSON for importer output: UTF-8, LF, two-space indent, a final newline; a value is
written on one line when it fits in LINE_WIDTH columns, otherwise one entry per line; numbers in
ECMAScript's shortest round-trip form (design §2), never -0. Keys keep the order the importer
builds them in; entity maps are sorted by id order (`id_key`)."""

from __future__ import annotations

import functools
import json
import math
import os
import re
from decimal import Decimal

LINE_WIDTH = 100


def js_number(x: int | float) -> str:
    """ECMAScript Number::toString for a finite number."""
    if isinstance(x, bool):
        raise TypeError("a boolean is not a number")
    if isinstance(x, int):
        return str(x)
    if not math.isfinite(x):
        raise ValueError(f"non-finite number {x}")
    if x == 0:
        return "0"
    if x == int(x) and abs(x) < 1e21:
        return str(int(x))
    sign = "-" if x < 0 else ""
    d = Decimal(repr(abs(x))).normalize()
    t = d.as_tuple()
    digits = "".join(map(str, t.digits))
    k = len(digits)
    n = k + int(t.exponent)
    if k <= n <= 21:
        return sign + digits + "0" * (n - k)
    if 0 < n <= 21:
        return sign + digits[:n] + "." + digits[n:]
    if -6 < n <= 0:
        return sign + "0." + "0" * (-n) + digits
    e = n - 1
    es = ("+" if e >= 0 else "-") + str(abs(e))
    return sign + digits[0] + ("." + digits[1:] if k > 1 else "") + "e" + es


def _inline(v) -> str:
    if isinstance(v, dict):
        if not v:
            return "{}"
        return "{ " + ", ".join(f"{json.dumps(k, ensure_ascii=False)}: {_inline(x)}" for k, x in v.items()) + " }"
    if isinstance(v, list):
        return "[" + ", ".join(_inline(x) for x in v) + "]"
    if isinstance(v, str):
        return json.dumps(v, ensure_ascii=False)
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    return js_number(v)


def _render(v, indent: int, col: int) -> str:
    inline = _inline(v)
    if not isinstance(v, (dict, list)) or not v or col + len(inline) + 1 <= LINE_WIDTH:
        return inline
    pad = "  " * (indent + 1)
    lines = []
    items = list(v.items()) if isinstance(v, dict) else [(None, x) for x in v]
    for i, (k, x) in enumerate(items):
        head = pad + (f"{json.dumps(k, ensure_ascii=False)}: " if k is not None else "")
        comma = "," if i < len(items) - 1 else ""
        lines.append(head + _render(x, indent + 1, len(head)) + comma)
    open_, close = ("{", "}") if isinstance(v, dict) else ("[", "]")
    return open_ + "\n" + "\n".join(lines) + "\n" + "  " * indent + close


def dumps(v) -> str:
    return _render(v, 0, 0) + "\n"


def write(path: str, v) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(dumps(v))


_CHUNK = re.compile(r"[0-9]+|[^0-9]+")


def _cmp(a: str, b: str) -> int:
    return (a > b) - (a < b)


def compare_ids(a: str, b: str) -> int:
    """Id order, a port of src/core/ids.ts compareIds: runs of digits compare by value,
    everything else by code point; ids equal by that rule fall back to code-point order."""
    ca, cb = _CHUNK.findall(a), _CHUNK.findall(b)
    for x, y in zip(ca, cb):
        if x[0].isdigit() and y[0].isdigit():
            xs, ys = x.lstrip("0") or "0", y.lstrip("0") or "0"
            c = len(xs) - len(ys) or _cmp(xs, ys)
        else:
            c = _cmp(x, y)
        if c:
            return c
    return len(ca) - len(cb) or _cmp(a, b)


def sorted_ids(ids) -> list[str]:
    return sorted(ids, key=functools.cmp_to_key(compare_ids))


def sorted_map(d: dict) -> dict:
    return {k: d[k] for k in sorted_ids(d)}
