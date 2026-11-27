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

`read-groove <catalogo_forsetiA4.pdf> <page> <xref> <w> <h> <face> <at> [<x0,y0,x1,y1>]` prints the
raw readings of one groove of a profile drawn as a raster image (the image `xref` on `page`, the
profile `w` by `h`, the groove on `face` at `at`, optionally cropped to leave dimensions out). The
build does not run it: its readings, calibrated against the dimensions the page prints, are the
reviewed values of `OWN_GROOVES` in `tables.py`, each with its range (`docs/notes/x9-f8-f9.md`).

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
description tabulates, and the standard a screw is made to where its type fixes it, from
`STANDARDS` in `tables.py`, as an estimate: the shop names none), offers (regular and sale price in minor units, pack, kit contents, stock
length, cut rule, stock and shipping mass) and the material's identity.

**The catalogue**, `catalogo_forsetiA4.pdf` ("Catálogo técnico 2020", 96 pages). The build checks
its SHA-256 against `forseti_importer/tables.py`: page numbers in the tables hold for that file
only. From it come the profiles' printed area, IX, IY and mass (pp. 11–21), the alloy (p. 6), and,
where a page draws the section as vector paths, the exact outline: line segments chained into
rings, scaled by the printed width, centred, and turned into the section frame. Groove types are
measured on those outlines and checked against the printed opening. A section's cores, where an
end tap is cut, are the bores its page prints: on an exact outline, the holes whose inscribed
circle is a printed diameter, each count checked; on a parametric envelope, `bores` at the printed
positions, with the base-40 corner holes measured on the exact outlines that have them. Where a
page draws the section as a raster image, the build traces it (`TRACES` in `tables.py`, `trace.py`):
the image's 50 % coverage contour, its scale and its outline stroke's margin fitted to the
dimensions the page prints, the margin taken off by an exact inner offset. A trace becomes the
section (fidelity `traced`) only within 2 % of the published area and 4 % of the published
inertias; otherwise the section stays the envelope and its note gives the trace's errors
([`docs/notes/forseti-traced-sections.md`](../../docs/notes/forseti-traced-sections.md)). Each core
carries the threads the vendor labels it with, from `CORE_THREADS` in `tables.py`: the drawing's
label where it prints one, else the shop description's, checked to be in it
([`docs/notes/section-cores.md`](../../docs/notes/section-cores.md)).

## Where the judgement lives

`forseti_importer/tables.py` holds every mapping the build does not derive: which product families
are emitted, how attributes classify, which pages hold which profile, which kit lines name no
code, the catalogue's IX/IY convention (IX is about the axis along the long side). A review reads
that file, not the code. A product no rule names becomes a `generic` item, so every orderable SKU has an offer; every profile
stem has a section (exact where the page draws a vector outline, traced where its raster drawing
passes the check, otherwise a parametric T-slot envelope).
Choices of M2b are in `docs/notes/m2b-decisions.md`.

| Module | Does |
|---|---|
| `fetch.py` | the snapshot |
| `store.py` | reads a snapshot: products, variations, prices, cut rules |
| `pdfcat.py` | the catalogue's tables, vector outlines and groove measurements |
| `trace.py` | raster drawings traced into outlines: coverage contours, the stroke's margin calibrated and taken off, bores snapped |
| `raster.py` | `read-groove`'s raw readings of one groove off a raster image |
| `geometry.py` | rings, nesting and section properties (standard library) |
| `build.py` | profiles, the M2a hardware families, kits, and the coverage check |
| `rest.py` | the rest of the shop (M2b): every other product, classified by the rules in `tables.py` into fastener, connector, accessory, panel or `generic` |
| `emit.py` | canonical JSON: key order kept, ids in the catalog's order, 100 columns |
