"""The Forseti importer. Run it with the isolated interpreter of a virtual environment that has
PyMuPDF (see README.md):

    python3 -I importers/forseti/import_forseti.py fetch <raw folder>
    python3 -I importers/forseti/import_forseti.py build <raw folder> <catalogue PDF> [<out>]
    python3 -I importers/forseti/import_forseti.py skus <raw folder>
    python3 -I importers/forseti/import_forseti.py read-groove <catalogue PDF> <page> <xref> <w> <h> <face> <at> [<crop>]

`fetch` takes a fresh snapshot of the shop (GET only, at most one request per second) into a new
folder. `skus` prints the orderable SKUs of a snapshot (the variations, and the products without
any), as one JSON array: the list the catalog's coverage test holds. `build` reads a snapshot and
the PDF catalogue and writes catalogs/forseti/catalog.json, offers.json and sections/ (default
<out>: catalogs/forseti beside this repository's importers/). The same inputs give byte-identical
output. `read-groove` prints the raw edges of a groove read off a profile drawn as a raster image,
which the reviewed readings in tables.GROOVE_READ come from (forseti_importer/raster.py).
"""

from __future__ import annotations

import os
import sys

# `-I` keeps the script's folder off sys.path; the importer's own package is the one exception.
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

USAGE = __doc__.split("\n\n")[1]


def main(argv: list[str]) -> int:
    if len(argv) >= 2 and argv[0] == "fetch" and len(argv) == 2:
        from forseti_importer.fetch import fetch

        return fetch(argv[1])
    if len(argv) in (3, 4) and argv[0] == "build":
        from forseti_importer.build import build

        out = argv[3] if len(argv) == 4 else os.path.join(HERE, "..", "..", "catalogs", "forseti")
        return build(argv[1], argv[2], os.path.normpath(out))
    if len(argv) == 2 and argv[0] == "skus":
        import json

        from forseti_importer import store

        print(json.dumps(store.orderable(store.load(argv[1])), indent=2, ensure_ascii=False))
        return 0
    if len(argv) in (8, 9) and argv[0] == "read-groove":
        from forseti_importer import pdfcat, raster

        doc = pdfcat.open_pdf(argv[1])
        crop = tuple(int(v) for v in argv[8].split(",")) if len(argv) == 9 else None
        for line in raster.read_groove(doc, int(argv[3]), (float(argv[4]), float(argv[5])), argv[6],
                                       float(argv[7]), crop):
            print(line)
        return 0
    print(f"usage:\n{USAGE}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
