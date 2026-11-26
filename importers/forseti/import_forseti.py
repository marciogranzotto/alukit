"""The Forseti importer. Run it with the isolated interpreter of a virtual environment that has
PyMuPDF (see README.md):

    python3 -I importers/forseti/import_forseti.py fetch <raw folder>
    python3 -I importers/forseti/import_forseti.py build <raw folder> <catalogue PDF> [<out>]

`fetch` takes a fresh snapshot of the shop (GET only, at most one request per second) into a new
folder. `build` reads a snapshot and the PDF catalogue and writes catalogs/forseti/catalog.json,
offers.json and sections/ (default <out>: catalogs/forseti beside this repository's importers/).
The same inputs give byte-identical output.
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
    print(f"usage:\n{USAGE}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
