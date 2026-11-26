"""Fetching the shop's public data: GET only, at most one request per second.

What it fetches, into a raw folder:

- ``store/categories.json``: the product categories;
- ``store/products_p<N>.json``: every product, 100 per page;
- ``store/variations_p<N>.json``: every variation, from ``products?type=variation`` (the parents'
  ``variations`` lists undercount them). That endpoint paginates unstably, so if one pass returns
  fewer unique ids than its ``X-WP-Total``, the pages are read again (``variations_r<k>_p<N>.json``)
  until the union is complete or three passes are spent;
- ``pages/<product id>.html``: the product page of every profile, the only place that states its
  cut rule (minimum and maximum length, tolerance, price step);
- ``manifest.json``: the read date, the user agent, and every request with its status and totals.

The read date in the manifest is the provenance date of everything the build emits from this
folder, so a build is a pure function of the folder.
"""

from __future__ import annotations

import datetime
import json
import os
import time
import urllib.error
import urllib.request

from . import store

SHOP = "https://loja.forsetisolucoes.com.br"
API = SHOP + "/wp-json/wc/store/v1/"
USER_AGENT = "alukit-importer/0.1 (catalog import; GET only, at most 1 request/s)"
PAUSE_S = 1.1
MAX_VARIATION_PASSES = 3


class Fetcher:
    def __init__(self, raw: str) -> None:
        self.raw = raw
        self.requests: list[dict] = []
        self.last = 0.0

    def get(self, url: str, rel: str) -> tuple[bytes, dict[str, str]]:
        wait = self.last + PAUSE_S - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                body = r.read()
                status = r.status
                headers = {k.lower(): v for k, v in r.headers.items()}
        finally:
            self.last = time.monotonic()
        path = os.path.join(self.raw, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as f:
            f.write(body)
        entry = {"url": url, "file": rel, "status": status, "bytes": len(body)}
        for h in ("x-wp-total", "x-wp-totalpages"):
            if h in headers:
                entry[h] = int(headers[h])
        self.requests.append(entry)
        print(f"GET {url} -> {status} {len(body)} B", flush=True)
        return body, headers

    def paged(self, query: str, prefix: str) -> tuple[list[dict], int]:
        """All pages of a Store API listing; returns the items and X-WP-Total."""
        items: list[dict] = []
        page = 1
        total = 0
        while True:
            sep = "&" if "?" in query else "?"
            body, h = self.get(f"{API}{query}{sep}per_page=100&page={page}", f"store/{prefix}{page}.json")
            items += json.loads(body)
            total = int(h.get("x-wp-total", len(items)))
            if page >= int(h.get("x-wp-totalpages", 1)):
                return items, total
            page += 1


def fetch(raw: str) -> int:
    """Fetches everything into `raw`, which must not exist yet (a fresh snapshot)."""
    if os.path.exists(raw):
        print(f"refusing to write into {raw}: it exists; give a new folder")
        return 2
    os.makedirs(raw)
    read = datetime.datetime.now(datetime.UTC).date().isoformat()
    f = Fetcher(raw)
    f.get(f"{API}products/categories?per_page=100", "store/categories.json")
    products, product_total = f.paged("products", "products_p")

    seen: dict[int, dict] = {}
    var_total = 0
    for k in range(1, MAX_VARIATION_PASSES + 1):
        prefix = "variations_p" if k == 1 else f"variations_r{k}_p"
        got, var_total = f.paged("products?type=variation", prefix)
        for v in got:
            seen.setdefault(v["id"], v)
        if len(seen) >= var_total:
            break

    profiles = sorted(
        (p for p in products if store.family_of(p) == "profile"), key=lambda p: p["id"]
    )
    for p in profiles:
        f.get(p["permalink"], f"pages/{p['id']}.html")

    manifest = {
        "read": read,
        "shop": SHOP,
        "user_agent": USER_AGENT,
        "products": {"total": product_total, "unique": len({p["id"] for p in products})},
        "variations": {"total": var_total, "unique": len(seen)},
        "requests": f.requests,
    }
    with open(os.path.join(raw, "manifest.json"), "w", encoding="utf-8") as out:
        json.dump(manifest, out, indent=2, ensure_ascii=False)
        out.write("\n")
    short = var_total - len(seen)
    print(f"products {len(products)}/{product_total}, variations {len(seen)}/{var_total}")
    if short > 0:
        print(f"warning: {short} variations missing after {MAX_VARIATION_PASSES} passes")
        return 1
    return 0
