# Forseti importer

Builds `catalogs/forseti/catalog.json`, `offers.json` and `sections/` (layer 1, design §3.1, §11)
from two inputs: a snapshot of the Forseti shop and the Forseti technical catalogue (PDF).
`families/` and `overrides.json` are hand-written and the importer never touches them.

## Running it

Python 3.11 or later, with [PyMuPDF](https://pypi.org/project/PyMuPDF/) for the PDF; everything
else is the standard library. Run it with the isolated interpreter (`-I`) of a virtual environment:

```sh
python3 -m venv .cache/forseti/venv
.cache/forseti/venv/bin/pip install pymupdf
.cache/forseti/venv/bin/python -I importers/forseti/import_forseti.py fetch .cache/forseti/snapshots/<date>
.cache/forseti/venv/bin/python -I importers/forseti/import_forseti.py build .cache/forseti/snapshots/<date> <catalogo_forsetiA4.pdf>
```

`python3 -I importers/forseti/import_forseti.py skus <snapshot>` prints the snapshot's orderable SKUs
(the variations, and the products without any: 1,196 of them); `src/catalog/forseti-orderable-skus.json`
is that list, and `build` refuses to write unless every one of them has an offer.

`fetch` refuses a folder that exists, so each snapshot is new and whole. `build` writes into
`catalogs/forseti` (or a third argument), prints what it emitted and what it left out, and fails
rather than guess when the data is not where the tables say. `.cache/` is not committed.

`alukit catalog import forseti` runs the same `build` and finds its inputs for you: each from its
flag, else its environment variable, else `.cache/forseti/`. It says which is missing, and how to
get it, rather than run; it reads the network only with `--fetch`, which first takes a new snapshot
(into `--snapshot`, else `.cache/forseti/snapshots/<today>`).

| Input | Flag | Variable | In `.cache/forseti/` |
|---|---|---|---|
| Python with PyMuPDF | `--python` | `FORSETI_PYTHON` | `venv/bin/python` |
| the shop's snapshot | `--snapshot` | `FORSETI_SNAPSHOT` | the newest `snapshots/<date>` with a `manifest.json` |
| the catalogue | `--pdf` | `FORSETI_PDF` | `catalogo_forsetiA4.pdf` |

`--out <dir>` writes somewhere other than `catalogs/forseti`.

The same snapshot and PDF give byte-identical files. `src/catalog/builtin.test.ts` runs the build
twice and compares both runs with the committed files when `FORSETI_SNAPSHOT`, `FORSETI_PDF` and
`FORSETI_PYTHON` (an interpreter with PyMuPDF) are set; otherwise it skips.

## What it reads

**The shop**, through the WooCommerce Store API (`/wp-json/wc/store/v1/`): categories, every
product, every variation (from `products?type=variation`, read again when a pass misses ids), and
the product page of each profile, which alone states the cut rule (minimum and maximum length,
resolution, tolerance, price step). GET only, at most one request per second, under the user agent
in `forseti_importer/fetch.py`. `manifest.json` in the snapshot records every request and the read
date, which becomes the `read` of every shop fact the build emits.

From it come items (name, code, finish options, thread, length, insertion, the dimensions a
description tabulates), offers (regular and sale price in minor units, pack, kit contents, stock
length, cut rule, stock and shipping mass) and the material's identity.

**The catalogue**, `catalogo_forsetiA4.pdf` ("Catálogo técnico 2020", 96 pages). The build checks
its SHA-256 against `forseti_importer/tables.py`: page numbers in the tables hold for that file
only. From it come the profiles' printed area, IX, IY and mass (pp. 11–21), the alloy (p. 6), and,
where a page draws the section as vector paths, the exact outline: line segments chained into
rings, scaled by the printed width, centred, and turned into the section frame. Groove types are
measured on those outlines and checked against the printed opening.

## Where the judgement lives

`forseti_importer/tables.py` holds every mapping the build does not derive: which product families
are emitted, how attributes classify, which pages hold which profile, which kit lines name no
code, the catalogue's IX/IY convention (IX is about the axis along the long side). A review reads
that file, not the code. A product no rule names becomes a `generic` item, so every orderable SKU has an offer; every profile
stem has a section (exact where the page draws a vector outline, otherwise a parametric T-slot envelope).
Choices of M2b are in `docs/notes/m2b-decisions.md`.

| Module | Does |
|---|---|
| `fetch.py` | the snapshot |
| `store.py` | reads a snapshot: products, variations, prices, cut rules |
| `pdfcat.py` | the catalogue's tables, vector outlines and groove measurements |
| `geometry.py` | rings, nesting and section properties (standard library) |
| `build.py` | profiles, the M2a hardware families, kits, and the coverage check |
| `rest.py` | the rest of the shop (M2b): every other product, classified by the rules in `tables.py` into fastener, connector, accessory, panel or `generic` |
| `emit.py` | canonical JSON: key order kept, ids in the catalog's order, 100 columns |
