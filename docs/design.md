# AluKit: design (v1)

*Draft 2, 2026-11-26. Built from the decisions D1–D16 in [`BRAINSTORM.md`](../BRAINSTORM.md),
the Forseti survey [`research/forseti-inventory.md`](research/forseti-inventory.md), review 1
[`reviews/design-review-1.md`](reviews/design-review-1.md), and the lessons and wishlist from the
reference project (an internal lab rack). No code exists yet. Everything here is open to veto:
section 14 lists the calls made without asking, and section 15 maps every review finding to where
it is resolved.*

*Provenance labels: **verified** (run or checked against a source, with how), **read** (from the
named document), **inferred** (reasoning, not checked).*

## Draft 2 — what changed (2026-11-26)

- **Bars, not members (D14, B2).** Anything sold by length is a *bar*: T-slot profile, steel tube
  or RHS, plain or threaded rod, flat bar or angle, linear rail. Every bar has a section, a sale
  rule and a cut length, and appears on the cut list (§3.4, §4.4).
- **End planes (B1).** Every bar end resolves to exactly one cut plane from one provider; planes
  come from placed bounding boxes; a golden table of 16 worked cases is M3a's oracle (§4.5, §4.6).
- **Connections replace joints (D14, n5).** `butt` (which absorbs `tee` and `cube`), `miter`,
  `splice`, a static `pivot`, and `face` for lap, bolted face-to-face and resting contact (§4.5).
- **Stations, free ends and patterns (D14).** Points and parts at "x mm from end A, on face or
  groove G"; bar ends with no node; linear patterns that stay live (§4.3, §4.7).
- **Bar frames defined exactly (M3).** Tolerances, an optional `up`, exact roll at multiples of
  90°, section-local anchor names and a two-axis offset (§2, §4.4).
- **Catalog: items and offers (B3, M10, M6).** Packs, kits, options, regular and sale prices; a
  `generic` kind; hardware keyed by system; one merge order with overrides that state what they
  replace; section fidelity and parametric generators (§3).
- **Cost model (M7).** Price steps, per-bar prices, ranges, cost lines that are not parts, a
  project currency, and the share of the total by provenance (§4.11, §5.3, §5.4).
- **The order list blocks on rules, per supplier (M8)** (§5.5).
- **The server owns the document (M1)**, behind a per-start token and a Host and Origin check
  (M2) (§7).
- **Determinism rules (M4)**, a lock file and revisions with stored outputs (M5) (§4.13, §5.2).
- **Exports and stack.** An own GLB writer, since three's exporter fails in Node; headless
  snapshots only (m5); Node 26 (D15); exact pins with a lockfile (§9, §10).
- **Milestones reordered (M9).** A paper model of the reference frame before the core,
  synthetic fixtures, and "done when" lines that can fail. Acceptance is the reference project's
  frame structure, without the drive and dampers, stated in writing (§12, §13).

## 1. Principles

1. **One model.** The project document is the only place a design lives. Everything else is
   derived from it: cut list, BOM, order list, costs, checks, 3D view, GLB, and data for reports.
   The reference project wrote its geometry 4–5 times.
2. **One catalog source of truth, referenced by id.** A correction is made once, in one file. It
   reaches a project at the project's next lock update, which shows what the correction changes
   (§4.13).
3. **Every number carries its provenance**: the source, the date it was read, a tag, and a
   low/design/high range for estimates.
4. **Agents are first-class.** The format is documented, every edit is a command, and there is a
   headless CLI and a way for an agent to see the result.
5. **Deterministic.** The same document, lock file, AluKit version and Node major give
   byte-identical output files on any machine. Snapshots (PNG) are excluded (§5.2).
6. **Explicit units.** A field's unit is the suffix of its name (`Ix_mm4`, `torque_Nm`,
   `price_minor`).
7. **The server owns the document.** Tabs and the CLI are clients of one command queue (§7.1).
8. **`derive` never throws on document content.** A half-edited document still draws; problems
   are diagnostics tied to entities.

## 2. Conventions

- **Units.** The suffix names the unit, from a fixed list: `_mm`, `_m`, `_mm2`, `_mm3`, `_mm4`,
  `_N`, `_kN`, `_Nmm`, `_Nm`, `_MPa`, `_kg`, `_kg_per_m`, `_kg_per_m3`, `_deg`, `_per_K`, `_J`,
  `_km`, `_minor`. The loader converts to base units (mm, N, N·mm, MPa, kg, degrees), so a value
  is stored as its source prints it (a torque in N·m stays `torque_Nm`). An unknown suffix is a
  schema error (review m7).
- **Money** is an integer in minor units (`_minor`, review n6) plus a currency code: on the
  catalog for offers, on the project for totals (§4.11).
- **World frame.** Right-handed and Z up, like the Fusion design frame. Conversion to three.js
  (Y up) happens only in the scene's root transform; GLB export converts to glTF's Y-up metres
  ([glTF 2.0 §3.4](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#coordinate-system-and-units)).
- **Ids.**
  - Catalog items are `<catalog>:<code>`, e.g. `forseti:PF40-01`. Offers are keyed by SKU.
  - Project entities have a letter prefix and a number (`n12` node, `b7` bar, `c3` connection,
    `p4` part, `pt1` pattern, `K2` cost, `C1` check, `O1` open item, `D1` decision). The
    document's `ids` map holds the last number used per prefix, so **ids are never reused**, even
    after a delete (review m1). Pattern copies are
    `<template id>@<k>`. An id never looks like an integer, so a JS engine never reorders it as
    an object key (review M4).
  - **Id order**: split into a letter prefix, a number and a rest; compare the prefix by code
    point, the number by value, the rest by id order. `b2 < b10 < b10@1 < b10@2 < c1` (M4).
- **Canonical form** (review m13, M4). UTF-8, LF, two-space indent, final newline. Keys in schema
  order; entity maps sorted by id order, one entity per line; numbers as ECMAScript's shortest
  round-trip form ([Number::toString](https://tc39.es/ecma262/#sec-numeric-types-number-tostring)),
  never `-0`, never non-finite. The server and the CLI always write canonical form; `alukit fmt`
  rewrites a file into it. A hand edit in any form is accepted and canonicalised on the next
  write.
- **Valued fields.** A bare number inherits its item's default provenance. An object adds
  per-field provenance:

  ```json
  "Ix_mm4": 91200
  "Ix_mm4": { "v": 91200, "src": "src", "ref": "pdf:catalogo_forsetiA4.pdf#p16", "read": "2026-11-26" }
  "J_mm4":  { "v": 120000, "low": 90000, "high": 150000, "src": "est", "note": "…" }
  ```

  `src` is one of `src` (read from a source), `meas` (measured), `est` (estimated) or `calc`
  (computed). Corrections are never written in place: they live in `overrides.json`, and the
  loaded item shows the resulting `corrected` history (§3.1, review M10).
- **Tolerances** (review M3, M4). Fixed in code, the same everywhere:

  | Name | Value | Used for |
  |---|---|---|
  | `tol.len` | 0.01 mm | coincident points, a point on a line, coplanar faces, a line crossing an edge |
  | `tol.ang` | 0.001° | parallel, perpendicular (a square cut), collinear |
  | `tol.vert` | 1e-6 of the bar's length | a bar is vertical when its horizontal run is below this |
  | `tol.near_vert` | 1e-2 of the length | warn: near-vertical bar without an explicit `up` |
  | `tol.snap` | 1e-9, relative | snap before `floor`, `ceil`, `round`, output quantising, and check comparisons |

- **Output quantum.** Lengths 0.01 mm, angles 0.01°, mass 0.001 kg, money one minor unit; ties
  round half away from zero after snapping (§5.2).

## 3. Catalogs

### 3.1 Layout, merge order and ids

```
catalogs/<id>/catalog.json      id, vendor, currency, materials, groove types, systems, items (importer output)
catalogs/<id>/offers.json       offers: SKU, packs, kits, options, prices with read dates (importer output)
catalogs/<id>/sections/*.json   section definitions, one file per section (3.5)
catalogs/<id>/families/*.json   per-family modelling written by agents (mounting, fastener sets, ratings)
catalogs/<id>/services.json     machining services and their prices, entered by hand with page refs
catalogs/<id>/overrides.json    corrections and accepted mismatches, each with provenance
importers/<id>/                 the importer that regenerates catalog.json, offers.json and sections/
```

Items and offers are separate files because prices change at every read and items rarely do;
diffs then stay readable.

**Merge order** (review M10). An item is assembled field by field, by item id, from three layers:

| Layer | Written by | May |
|---|---|---|
| 1. `catalog.json`, `offers.json`, `sections/` | the importer, regenerated; never edited by hand | set any fact it can read from a source |
| 2. `families/*.json` | agents, then an independent review | add fields and items; **not** change a field layer 1 set (a collision is an error naming both files) |
| 3. `overrides.json` | a person or an agent, with provenance | replace a field: `{ "item", "field", "expect", "value", "why", provenance }`, or accept a mismatch: `{ "item", "field", "accept": true, "why" }` |

`expect` is the value the override replaces. `alukit catalog check` reports an override whose
`expect` no longer matches layer 1 or 2 (the vendor fixed it, or the importer changed), so a stale
correction never overrides silently. The loaded item carries a `corrected` history computed from
the overrides; nobody writes it by hand.

**Catalog ids** (review m13). A catalog declares its id in `catalog.json`. A project names its
catalogs by built-in id or by path; two catalogs claiming one id is an error naming both paths.
An offer may offer an item from another catalog by its full id, so a local steel supplier's
quotes can point at shared items.

**Built-in catalogs in this repo:**

| Catalog | Holds |
|---|---|
| `forseti/` | the first vendor, all of it (D4, §11) |
| `std/` | standard shapes and parts with no vendor: steel RHS, tube, flat bar, rolled angle, round bar, threaded rod, ISO screws, nuts and washers, and common materials. Items only, with published section values from standard tables; offers come from supplier catalogs or quotes |
| `ref-<maker>/` | **reference catalogs** for original makers whose parts others rebadge (e.g. `ref-hiwin/` for the HG family). Items with ratings and no offers. A clone points at them with `clone_of` (review m8), so a correction lands in one place |

The hand-written generic T-slot catalog of draft 1 is dropped (review m16): a variant's `swap`
retargets a design to another vendor.

### 3.2 Items and offers (review B3)

The **item** is the physical part: geometry, mass and technical data. The **offer** is how it is
sold. The BOM counts items; the order list chooses offers (§5.4).

**Every item** carries this envelope, whatever its kind:

| Field | Notes |
|---|---|
| `kind` | §3.4 |
| `name`, `code`, `brand` | the vendor's name and catalogue code as published (Portuguese stays Portuguese) |
| `url`, `docs` | source pages: `[{ "ref": "pdf:…#p16" }]` |
| `material` | a material id (§3.3) |
| `mass_kg` or `mass_kg_per_m` | per unit, or per metre for bars |
| `bbox_mm` | for parts: the bounding box in the item's own frame |
| `mesh` | optional GLB for drawing; otherwise a parametric mesh from the kind |
| `options` | named by meaning: `{ "finish": ["anodised", "black"], "hand": ["left", "right"] }` |
| `ratings` | the typed ratings bag (§3.4) |
| `prov` | the item's default provenance |

**Every offer:**

| Field | Notes |
|---|---|
| `item`, `sku`, `supplier` | `supplier` defaults to the catalog's vendor |
| `options` | the option values this SKU sells: `{ "finish": "black" }` |
| `pack` | units of the item per offer (default 1), or |
| `kit` | contents: `[{ "item", "qty", "options" }]`; the first entry is the kit's main item |
| `sale` | bars only: `cut` or `stock` (below) |
| `price` | `{ "regular_minor", "sale_minor", "per": "unit" \| "m" \| "bar", "read", "src" }`; `sale_minor` is null when there is no sale |
| `in_stock` | as read |
| `url`, `ship_mass_kg` | the shop's weight is a shipping fact, never the BOM's mass (§3.5) |

**Sale rules for bars:**

| Mode | Fields | Example |
|---|---|---|
| `cut` (the supplier cuts) | `min_mm`, `max_mm`, `tol_mm`, `res_mm` (order resolution), `step_mm` (price step), optional `min_bill_mm` with `bill: "piece" \| "line"` | Forseti profiles: 40–3000 mm, ±1 mm, 10 mm price steps (*read: survey §2*) |
| `stock` (whole bars) | `length_mm`, one offer per stock length, each with its own price per bar | steel in 6 m bars; a rail sold in 500–3000 mm lengths, each its own SKU (*read: review B3*) |

Example, from the survey's data (read; prices illustrative):

```json
{ "item": "forseti:PF40-01", "sku": "PF40-01-c7", "options": { "finish": "anodised" },
  "sale": { "mode": "cut", "min_mm": 40, "max_mm": 3000, "tol_mm": 1, "res_mm": 1, "step_mm": 10 },
  "price": { "regular_minor": …, "sale_minor": …, "per": "m", "read": "2026-11-26", "src": "src" } }
{ "item": "forseti:PF40-01", "sku": "PF40-01-pp-c7", "options": { "finish": "black" }, … }
{ "item": "forseti:PAM408-25", "sku": "PAM408-25-10", "pack": 10, "price": { … } }
{ "item": "forseti:PAM408-25", "sku": "PAM408-25-50", "pack": 50, "price": { … } }
{ "item": "forseti:CT75-06", "sku": "CT75-06-K40-50",
  "kit": [ { "item": "forseti:CT75-06", "qty": 1 }, { "item": "forseti:PSM-8", "qty": 10 },
           { "item": "forseti:PAM408-20", "qty": 10 }, … ], "price": { … } }
```

The `-c7` tail of a Forseti SKU is not a finish; `-pp` is (*read: survey §1*).

### 3.3 Shared definitions

- **Material**: `E_MPa`, `G_MPa`, `nu`, `density_kg_per_m3`, `Rp02_MPa`, `Rm_MPa`, `alpha_per_K`
  (thermal expansion, for aluminium bolted to steel; review m7), alloy and temper.
- **Groove type**: `opening_mm`, `lip_mm`, `depth_mm`, `undercut_mm`, and `class` (`standard` or
  `light`). item rates its T-nuts in standard grooves only.
- **System**: an interface family that decides what fits. A T-slot system is a series plus a
  groove type (`forseti:s40-c8`); a rail system is a rail size family (`forseti:rail-hg20`).

### 3.4 Kinds

Fields marked † are needed only by later phases (D5), but the schema has them from day one.

| Kind | Fields beyond the envelope |
|---|---|
| **bar** | `shape`: `tslot`, `tube`, `rhs`, `rod`, `threaded-rod`, `flat`, `angle`, `channel`, `beam` or `rail`. `section` (a section id, §3.5); `system` (T-slot and rail bars); published `area_mm2`, `Ix_mm4`, `Iy_mm4`, `J_mm4`†, `Wx_mm3`†, `Wy_mm3`†; `core` (bore, tap size); tolerances† (straightness, twist; DIN EN 12020-2 / ABNT NBR 8116); `thread` (threaded rod); `rail` { `pitch_mm`, `E_min_mm`, `E_max_mm`, hole spec } (rails) |
| **connector** | `subtype` (bracket, plate, end-connector, cube, gusset, hinge, splice); `fits` [systems]; `frame` (the connector's own axes, which give the rating directions their meaning; review m7); `mounts` [{ plane, holes, `fasteners` keyed by system: `{ "forseti:s40-c8": [{ item, qty }], "forseti:s45-c10": [ … ] }` }] (review B3); `requires` [machining on the joined bars, e.g. an end tap M8 plus an access hole]; `spacer_mm`; `body` (a cube's box); `pivot` { `height_mm`, `end_mm`, `range_deg` } (hinges); `splice` { the stud or plates, the tap it needs } |
| **fastener** | `thread`, `length_mm`, `head` (DIN/ISO), `class`, `material`, `torque_Nm`; T-nuts add `groove` and `insertion` (`drop-in` or `slide-in`) |
| **carriage** | `rail_system`; dimensions; `clone_of` { item in a reference catalog } when the vendor rebadges |
| **accessory** | feet, casters, handles: `thread`, dimensions |
| **panel** | sheet stock: `thickness_mm`, `material`; sheet sizes are offers |
| **generic** | name, mass, bounding box, offers, an optional mesh. Orderable. Everything that fits no other kind: electronics, tools, finished goods, cable chain, ball screws, bearings, pulleys, belts, couplings (about 200 of Forseti's 495 products; *read: review B3*) |

**The ratings bag** (review m7, m16). Instead of fixed schemas for drive, damper and anchor, which
nothing reads in v1, every item has `ratings`: a map whose keys come from one vocabulary file in
`src/catalog/ratings.ts`, each key with its unit, meaning and the kinds it applies to. Unknown
keys are schema errors, so the data stays typed. The vocabulary covers everything BRAINSTORM's
list names:

| Keys | Unit | For |
|---|---|---|
| `F_N.x/y/z`, `M_Nmm.x/y/z`, `safety_factor` | in the connector's `frame` | connectors, T-nuts† |
| `preload_N` or `K`, `slip_N` | | connectors, fasteners† |
| `stiffness`: [{ `pair`: [system, system], `k`: per degree of freedom }] | N/mm, N·mm/rad | connectors† (it depends on the pair of profiles joined) |
| `C_N`, `C0_N`, `C_basis_km` (50 or 100; makers differ), `MR_Nm`, `MP_Nm`, `MY_Nm`, `seal_N` (a maximum), `mu`, `preload_class` | | carriages† |
| `load_N`, or `"not published"` explicitly | | feet, casters, accessories |
| `damper.energy_J`, `damper.force_max_N`, `damper.stroke_mm`, `damper.curve` | | dampers† |
| `drive.pulley_F_N`, `drive.skip_F_N`, `gearbox.radial_N` | | drives† |
| `anchor.eta` | | anchors† |

A clone's ratings resolve from its `clone_of` item and are tagged `est` with a note naming the
original, because a clone is not guaranteed to match (inferred).

### 3.5 Sections (review M6)

A section file holds one section, in mm, about its nominal centre (local x = width, y = height):

```json
{ "id": "PF40-01", "fidelity": "exact", "props_ok": true,
  "from": { "ref": "pdf:catalogo_forsetiA4.pdf#p16", "method": "vector", "scale": "width 40 mm" },
  "outline": [[…]], "holes": [[[…]]], "bbox_mm": [[-20, -20], [20, 20]],
  "grooves": [ { "face": "+y", "at_mm": 0, "type": "c8" }, … ], "datums": {} }

{ "id": "RHS-100x50x3", "fidelity": "parametric", "props_ok": true,
  "generator": "rhs", "params": { "h_mm": 100, "b_mm": 50, "t_mm": 3, "ro_mm": 6 } }
```

| `fidelity` | What it is | Drawn | Computed properties stand in for missing published ones |
|---|---|---|---|
| `exact` | vector outline from the vendor's drawing or CAD | yes | yes, tagged `calc` |
| `traced` | traced from a raster image, accepted only within 2 % of the published area | yes | yes, tagged `est` |
| `parametric` | built by a generator from published dimensions | yes | steel shapes: yes (`props_ok: true`); a T-slot envelope: **no** (`props_ok: false`) |
| `box` | the bounding box only | as a box | no |

**Generators**: `tslot` (overall size, groove opening, depth and lip, core bore, wall), `rhs`
(with corner radii), `tube` (round), `rod`, `threaded-rod` (nominal for drawing, stress area for
properties), `flat`, `angle` (rolled, with root and toe radii), `channel`, `rail` (envelope from
published dimensions). A local steel catalog then needs no outline files.

**Cut lengths use only the bounding box** (§4.5), which a T-slot's published overall size gives
exactly. So every profile can join the cut list as soon as it has a `parametric` section; fidelity
affects only drawing and computed properties.

**Datums** are named points a section may declare: a rail's mounting face centre, an angle's
heel. An anchor may name a datum (§4.4).

**Authority rule** (review M6, M10). For mass and section properties the published value wins,
after overrides. A computed value is used only when nothing is published and the section's
`props_ok` is true. The shop's weight is never the BOM's mass. For the 40x40 básico that means
1.493 kg/m (catalogue), not 1.482 (shop) or 1.4945 (computed) (*read: survey §4, §7*).

For display, an outline is simplified with
[Ramer–Douglas–Peucker](https://en.wikipedia.org/wiki/Ramer%E2%80%93Douglas%E2%80%93Peucker_algorithm)
at 0.05 mm; properties always use the exact outline (review m11).

### 3.6 Computed against published

`alukit catalog check <id>` computes area, centroid, Ix, Iy and Ixy from each outline
([polygon formulas](https://en.wikipedia.org/wiki/Second_moment_of_area#Any_polygon)) and mass
from the density. It flags any mismatch beyond 1 % unless an override accepts it, reports stale
overrides and family collisions, and checks that every option of an item has an offer. The
survey found 16 inconsistencies in Forseti's data (*read*); this makes such errors visible. J is
computed in v2 by a Saint-Venant [torsion](https://en.wikipedia.org/wiki/Torsion_constant) solve
on the polygon, which is FEM work.

## 4. Projects

**Terms.** A *bar* runs along its *design line* from end `a` to end `b`. Its *placed section* is
the section after anchor, offset and roll. A *station* is a position along a bar. A *connection*
relates bars and decides end planes or contact. An *end plane* is where a bar is cut.

### 4.1 Layout

A project is a folder, wherever its owner keeps it (D2, D9):

```
<project>/alukit.json            the document
<project>/alukit.lock.json       the resolved catalog data the document uses (4.13)
<project>/revisions/<name>.json  named revisions: document, lock and stored outputs (4.13)
<project>/exports/               derived outputs (the project's own repo decides whether to ignore it)
<project>/.alukit/               per-machine state: server discovery, edit lock (gitignored by `alukit new`)
```

### 4.2 The document

```json
{
  "schema": "alukit.project/1",
  "name": "Cart 1200",
  "catalogs": ["std", "forseti", "../my-parts"],
  "currency": "BRL",
  "price_basis": "regular",
  "ids": { "n": 4, "b": 5, "c": 2, "p": 1, "pt": 1, "K": 1, "C": 1, "O": 1, "D": 1 },
  "defaults": { "bar": { "item": "forseti:PF40-01", "opt": { "finish": "anodised" } },
                "butt": { "connector": "forseti:CT75-06", "qty": 2 } },
  "params": { "W": "1200", "D": "600", "H": { "v": 900, "src": "meas", "note": "under the shelf" } },
  "nodes": {
    "n1": [0, 0, 0],
    "n2": [0, 0, "H"],
    "n3": ["W", 0, "H"],
    "n4": { "on": { "bar": "b2", "at_mm": "W / 2" } }
  },
  "bars": {
    "b1": { "item": "forseti:PF40-01", "a": "n1", "b": "n2", "anchor": "-x-y", "tags": ["leg"] },
    "b2": { "item": "forseti:PF40-01", "a": "n2", "b": "n3", "anchor": "-x+y", "tags": ["rail"] },
    "b3": { "item": "std:DIN975-M8", "a": "n4", "b": { "len_mm": 300, "dir": "-z" } },
    "b4": { "item": "forseti:HGR20", "a": [0, 300, "H"], "b": ["W", 300, "H"], "anchor": "mount" },
    "b5": { "item": "std:FB-50x6", "a": { "on": { "bar": "b2", "at_mm": 0, "face": "+y" } },
            "b": { "on": { "bar": "b2", "at_mm": "W", "face": "+y" } }, "anchor": "-y" }
  },
  "connections": {
    "c1": { "type": "butt", "through": "b1", "ends": ["b2.a"] },
    "c2": { "type": "face", "bars": ["b2", "b5"], "fastening": "tnut", "fastener": "forseti:PAM408-20",
            "stack": ["forseti:ALM-8"], "stations": { "at_mm": [100, 1100] } }
  },
  "parts":    { "p1": { "item": "forseti:HGH20CA", "on": { "bar": "b4", "at_mm": 200, "face": "+y" } } },
  "patterns": { "pt1": { "template": ["p1"], "along": "b4", "pitch_mm": 600, "count": 2 } },
  "items":    { "plate-a": { "kind": "plate", "material": "std:S235", "thickness_mm": 4,
                             "outline": [[0,0],[120,0],[120,80],[0,80]],
                             "holes": [ { "at": [20,20], "d_mm": 8.5 }, { "at": [100,20], "thread": "M8" } ] } },
  "costs":    [ { "id": "K1", "label": "assembly", "kind": "labour",
                  "low_minor": 50000, "likely_minor": 80000, "high_minor": 120000, "src": "est" } ],
  "order":    { "forseti:PAM408-25": { "offer": "PAM408-25-50" } },
  "variants": { "default": "base", "list": { "base": {}, "tall": { "params": { "H": "1100" } } } },
  "checks":   [ { "id": "C1", "value": "bbox().z", "op": "<=", "limit": "950", "text": "fits under the shelf" } ],
  "open":     [ { "id": "O1", "text": "carriage rating not published; ask the vendor", "blocks": "order", "scope": ["p1"] } ],
  "decisions": [ { "id": "D1", "date": "2026-11-26", "text": "40-series, not 30", "why": "…" } ],
  "views":    { "iso": { "pos": [2500, -2000, 1800], "target": [600, 300, 450] } }
}
```

Item ids in examples are illustrative, and examples are wrapped for reading; canonical form puts
one entity per line (§2). `b5` is a flat bar resting on `b2`'s top face, held by T-nuts. Entities
in `nodes`, `bars`, `connections`, `parts` and `patterns` take `label`, `tags` and `only_in`
(§4.10).

### 4.3 Points and stations

A **point** appears wherever a position is needed (a node, a bar end, a plane):

| Form | Meaning |
|---|---|
| `"n4"` | a node: a named point that several entities share |
| `[x, y, z]` | an inline point; numbers or expressions. A bar end with no node |
| `{ "on": <station> }` | a point on a bar (below); it follows the bar |
| `{ "pivot": "c4" }` | the pivot point of a `pivot` connection (§4.5) |
| `{ "len_mm": 300, "dir": "+x" }` | end `b` only: a free end at a length along a world axis or a vector, from end `a` |

A **station** is `{ "bar", "at_mm", "from", "face" | "groove", "off_mm" }`:

- `at_mm` from the bar's design point `a` (default) or `b`. Points that other bars depend on may
  only use design points, so geometry never depends on a cut (no cycles). Parts, which nothing
  depends on, may also measure from a cut end: `"from": "a.cut"` (§4.7).
- `face` (`+x`, `-x`, `+y`, `-y`, section-local) moves the point to the centre line of that face
  of the placed section; `groove` (`+y.1`, `+y.2`, numbered by increasing section coordinate) to
  the groove's centre line; `off_mm` [u, v] then moves it across the face and along its normal.

Points resolve in dependency order. A cycle is an error on every entity in it.

### 4.4 Bars and their frames (review M3)

A bar is `{ "item", "opt", "a", "b", "anchor", "off_mm", "roll_deg", "up", "ends", "ops" }`.
`item` is any `bar` item (§3.4); `opt` picks its options.

**Frame.** With design points A and B (`B − A` shorter than `tol.len` is an error):

1. `t = (B − A) / |B − A|` is local z.
2. `u` = the bar's `up` if given (an error if parallel to `t` within `tol.ang`); otherwise world
   +Z, or world +Y when the bar is vertical (horizontal run below `tol.vert` of its length).
3. Local y = `u` with its `t` component removed, normalised. Local x = y × t.
4. `roll_deg` turns x and y about t, right-handed: counter-clockwise seen from B looking toward A.
   Roll is reduced modulo 360; at multiples of 90° (within `tol.snap`) its sine and cosine come
   from a table, so a rolled 40x80 has corners at exactly ±20 and ±40.

| Bar | Local x | Local y | Note |
|---|---|---|---|
| along +X | +Y | +Z | |
| along −X | −Y | +Z | reversing a bar mirrors local x |
| along +Y | −X | +Z | |
| vertical, upward | +X | +Y | |
| vertical, downward | −X | +Y | |
| top node at x = `0.1 + 0.2 − 0.3` (5.6e-17 mm) | +X | +Y | vertical within `tol.vert`: no flip (review M3's case) |
| 900 mm, leaning 0.01 mm toward +Y | −X | −Y | not vertical; warns "near-vertical bar without `up`" (`tol.near_vert`) |

**Anchor and offset.** `anchor` names a point of the section in section terms: `c` (bounding-box
centre), a face midpoint (`+x`, `-x`, `+y`, `-y`), a corner (`+x+y`, `-x-y`, …), or a section
datum (`mount`, `heel`). That point sits on the design line; then `off_mm` [dx, dy] moves the
section along its own x and y. Section point `s` lands at `P(w) + (s − anchor + off)` in the
local x, y frame. Anchors, faces and roll follow `a → b`: they are section-local, so "top" never
depends on how a bar was drawn. `reverseBar` swaps the ends and rewrites anchor, offset and roll
so the body stays where it was.

**Machining** a person adds goes in `ops`
(`{ "op": "hole", "face": "+y", "at_mm": 20, "from": "a", "d_mm": 7 }`); connections, rails and
connectors generate more (§5.1).

### 4.5 Ends and connections (review B1, D14)

**The rule.** Every bar end resolves to **exactly one end plane** (a point and an outward normal)
from **exactly one provider**:

| Provider | Plane |
|---|---|
| a connection that claims the end (`butt`, `miter`, `splice`, `pivot`) | per type, below |
| `ends.<a\|b>.plane`: `{ "point": <point>, "normal": [x, y, z] }` | as given |
| neither (the default) | through the design point, square to the axis |

Two providers on one end are an error naming both. The end then falls back to the default, so the
bar still draws.

Two **modifiers** apply after the provider, with any of them:

- `cut`: `angle` (cut on the plane) or `square` (cut square at the plane's nearest point, so no
  part of the bar crosses it). Required when the plane is not square to the axis within
  `tol.ang`; an undeclared angled end is an error, and the end falls back to the default.
- `extend_mm`: moves the end along the axis; positive is outward (longer).

**What planes are built from.** A bar's **infinite prism** is its placed section's bounding box
swept along the bar's axis line, **unbounded in both directions**. It has side faces only, with no
end caps, so a point at the very end of a design line is still inside it. A bar's **centre line**
is the axis through its placed bounding box's centre, not its design line: an eccentrically
anchored bar's centre line is offset from the design line (G3). Planes depend only on placements, never on another
bar's cut, so stage 3 runs once with no iteration. It is the **bounding box**, not the outline:
an RHS's corner radius or a T-slot's groove never moves a cut.

| Type | Takes | End planes | Valid when (otherwise an error) |
|---|---|---|---|
| `butt` | `through`: a bar, or `{ "body": <connector>, "at": <point> }` for a cube or other body; `ends`: the butting ends; `connector`, `qty`, `spacer_mm` | each butting end: the first face of the through prism that the butting bar's centre line crosses, travelling from the bar's other end toward this one; moved toward the butting bar by `spacer_mm` (from the connector, or given). A butt needs no node: the plane follows the through bar | the centre line crosses a face, not within `tol.len` of an edge |
| ↳ the through bar's own end | `through_end`: `cover` (default), `node`, `none`; claimed automatically when a through end's design point coincides with a butting end's (a corner), or named: `{ "end": "b", "mode": "cover" }` | `cover`: the farthest face, along the through bar's axis, of the butting bars' prisms that its centre line crosses (flush outer corner). `node`: square at its design point | `cover` that crosses no prism falls back to `node` with a warning |
| `miter` | two ends | both on the bisector plane through the crossing point of the two centre lines | the centre lines cross within `tol.len`; same section, and the two placed sections mirror each other across the plane within `tol.len` |
| `splice` | two ends, end to end; `connector` (a stud in tapped cores, or union plates), `gap_mm` (default 0) | square planes at the shared design point, `gap_mm` apart | collinear within `tol.ang` and `tol.len`; same item and placement |
| `pivot` | `base`: a station on a face; `axis`: `along` or `across` the base bar; `connector` (with `pivot`); `ends`: the bars it carries | pivot point P = base point + `pivot.height_mm` along the face normal. Each carried end is cut square at `pivot.end_mm` from P. **Static**: the angle follows from the geometry; nothing moves (motion is v3) | each carried end's design point is `{ "pivot": <this connection> }`; the angle is inside `pivot.range_deg` (a check) |
| `face` | `bars` [two] (or a bar and a plate); `faces` (optional: the facing pair is found); `fastening`: `none` (resting), `bolt` (through both), `tnut`, `screw` (tapped); `fastener`; `stack`; `stations` | **none**: a face connection never changes a cut | the faces are antiparallel within `tol.ang` and coplanar within `tol.len` (or a declared `gap_mm` the stack fills), and they overlap |

`tee` and `cube` from draft 1 are both `butt` (review n5): a tee is a butt onto a span, a cube a
butt into a body. A **lap** is a `face` connection. A bar **resting on** another is a `face` with
`fastening: none`, placed by a station on the lower bar's face (§4.3) with the upper bar anchored
on its `-y` face. Face connections check contact; they do not move bars, since v1 has no
constraint solver.

**Stations of a face connection** are `at_mm` on the first bar, or a pattern (§4.7). At each
station sits one `fastener`; `stack` lists the extra layers from head to nut (washers, packers).
Derive reports the **grip**: the stack plus the depth of each bar the fastener passes, or the lip
of the groove it enters. Checking the fastener's length against the grip is v1.1 (review m15).

**Reported per bar:** `cut_mm` (the long-point length: what is ordered and sawn), `centre_mm`
(along the bounding-box centre line), and per end the move from its design point, the angle
between the plane's normal and the axis, and for a compound cut its mitre and bevel components.
An end that moved further than the through prism's depth plus the spacer warns "end far from its
face", which catches a node left behind by an edit.

**Default connection.** When the draw tool closes on a point, `autoConnect` adds a `butt` with the
project's default connector. The through bar is the one that passes through the point; else a
vertical; else the lowest id. Its end, if any, covers. All of it can be changed.

### 4.6 Golden cases (review B1)

Each row is a small document in `tests/fixtures/golden-ends/` with its expected outputs. M3a is
done when all pass to 0.01 mm (§12). 40x40 sections, centre anchors, square cuts and lengths in mm
unless stated. Values were worked by hand and re-computed with a script (verified 2026-11-26).

| # | Setup | Rule exercised | Expected |
|---|---|---|---|
| G1 | b1 (0,0,0)→(1000,0,0); b2 (1000,0,0)→(1000,600,0); `butt` through b1, ends [b2.a] | near face; through end covers | b1 1020.00, b2 580.00 |
| G2 | G1 with `through_end: "node"` | through end stops at the node | b1 1000.00, b2 580.00 |
| G3 | post (0,0,0)→(0,0,900) anchor `-x-y`; rail (0,0,900)→(1000,0,900) anchor `-x+y`; butt through the post | eccentric anchors: the face is 40 from the line, not 20 | post 900.00, rail 960.00 |
| G4 | 40x80 b1 (0,0,0)→(1200,0,0); b2 a = `{on: {bar: b1, at_mm: 500}}`, b = (500,600,0); roll of b1 0, then 90 | the placed section, not the item | b2 580.00, then 560.00 |
| G5 | three bars from (0,0,0) to (500,0,0), (0,500,0), (0,0,500); butt through `{body: 40 mm cube, at: (0,0,0)}` | a body as the through member | each 480.00 |
| G6 | brace a = `{on: {bar: b1, at_mm: 500}}` on b1 (0,0,0)→(1000,0,0), b = (1000,0,500); butt through b1, brace `cut: "angle"` | angled cut | long point 698.82, centre line 678.82, short point 658.82; 45.00° |
| G7 | G6 with no `cut` | an angled end must declare its cut | error on brace.a; drawn square at its design point |
| G8 | G6 with `cut: "square"` | square end touching at the nearest point | 658.82 |
| G9 | G1's bars with a `miter` | bisector plane; long points | b1 1020.00, b2 620.00; 45.00° each |
| G10 | `miter` of a 40x40 and a 40x80 | compatible sections | error |
| G11 | G1 plus a second butt claiming b2.a | one provider per end | error naming both; b2.a at its design point |
| G12 | run (0,0,0)→(5000,0,0) split at 2500 by a `splice` | splice planes | 2500.00 + 2500.00; with `gap_mm: 2`, 2499.00 + 2499.00 |
| G13 | rail (0,0,H)→(1200,0,H), H = 900; post (640,0,0)→`{on: {bar: rail, at_mm: 640}}`; butt through the rail; then H = 1000 | a point on a span follows its bar | post 880.00, then 980.00 |
| G14 | post (0,0,0)→(0,0,2000); horizontal (0,0,0)→(2000,0,0); a brace between two `pivot`s: base 1 on the post's `+x` face at 1500, base 2 on the horizontal's `+y` face at 1000; pivot height 15, end distance 25 | cut square between pivots | 1704.27; with `extend_mm: -2` at both ends, 1700.27 |
| G15 | a butting bar whose centre line misses the through bar | validation | error |
| G16 | RHS 100x50 (outer radius 6), along +X, 100 tall; one 40x40 butting from +Y and one from below, both with their design point on the RHS's centre line | the bounding box, not the radius | trims 25.00 and 50.00 |

The frame table in §4.4 is the golden set for orientation.

### 4.7 Parts, rails and patterns (D14)

**Parts** are catalog or project items placed `on` a station (`{ "bar", "at_mm", "from", "face" |
"groove", "off_mm" }`, with `roll_deg` about the face normal), or at a world pose
`{ "at": { "pos": [x, y, z], "rot_deg": [rx, ry, rz] } }` (about world X, then Y, then Z; exact at
multiples of 90°). An item's `mount` datum lands on the station. A part on a bar follows it. A
T-nut is a part in a groove; a carriage is a part on a rail's running face.

**Rails** are bars. Their holes come from the cut: by default the hole count is the largest that
keeps both end distances E ≥ `E_min_mm`, centred so both ends are equal; `"holes": { "E_a_mm": 20 }`
on the bar fixes one end instead. A check reports E outside the rail's range at either end.

**Patterns** repeat entities and stay live: change the pitch and every copy moves.

```json
"pt2": { "template": ["n20", "b30", "c12", "p40"], "along": "b1", "pitch_mm": 150, "count": 8, "skip": [3] }
```

- The template is real entities at the first station. Copies k = 1 … count − 1 are translated by
  k × `pitch_mm` along the `along` bar's axis (or `{ "dir": [x, y, z] }`), or by the list
  `offsets_mm`. Copies get ids `b30@1`, `b30@2`, ….
- References inside the template are remapped in each copy; references outside it are kept.
- `skip` drops stations. `explodePattern` turns copies into ordinary entities when one needs an
  edit of its own.
- `rail_holes: true` (part templates only) puts a station at every hole of the rail (`along`).
  Rail bolts and other hardware at a pitch are written once.
- Patterns are translations only in v1. `mirror` and `array` are commands that create ordinary
  entities (§6); a mirrored asymmetric section takes the item's other `hand`, or is an error.

### 4.8 Project items

`items` defines items that exist only in this project, referenced as `project:<id>`:

| Kind | Fields |
|---|---|
| `plate` | `material` (a catalog material), `thickness_mm`, `outline`, `holes` |
| `bent-angle` | two legs, thickness, bend radius, holes per leg |
| `generic` | as the catalog kind, with its own `offers` or a price |
| `placeholder` | name, mass, bounding box, an estimated price. Drawn translucent and hatched; blocks its own order line (§5.5) |

Holes have `d_mm`, or `thread` and `depth_mm`, plus optional `csk` { `d_mm`, `angle_deg` } or
`cbore` { `d_mm`, `depth_mm` } (review B2). A plate's price is a valued field or an open item. A
rolled steel angle is not a bent angle: it is a `bar` from `std`.

### 4.9 Expressions and checks (review m6)

A small, safe language; no JS `eval`.

- Numbers, params, `+ - * / ^`, unary minus, parentheses; `< <= > >= == !=`, `and`, `or`,
  `not`, `if(c, a, b)`; `pi`.
- Functions: `min max abs round floor ceil sqrt hypot`; `sin cos tan asin acos atan atan2` **in
  degrees**, the file convention.
- Accessors read the derived model: `len(b3)` (design length), `cut(b3)`, `pos(n3).z`,
  `dist(n1, n2)`, `bbox().z`, `mass()`, `cost()` and `cost("high")`, `count(tag:leg)`. `.x`, `.y`,
  `.z` read a vector's component.
- Params may be valued fields: a measured wall width keeps its `meas` tag and its date.
- The determinism rules of §5.2 apply (exact trig at special angles, snapping before `floor`,
  `ceil` and `round`, comparison within `tol.snap`).

A **check** is `{ "value", "op", "limit", "text", "severity" }`. It reports its **margin**
(`limit − value` for `<=`), as the reference project's asserts with floors do. A plain boolean
`expr` is allowed too, without a margin. `severity` is `error` (the default), `warn` or `info`.

### 4.10 Variants (review m9)

A variant overrides params, swaps items (`"swap": { "forseti:PF45-02": "std:RHS-100x50x3" }`) and
includes entities by `only_in: ["steel"]` or `not_in`. `variants.default` names the variant
opened by default, so the base document never has to be a frame nobody builds: entities that
exist only in one option are scoped to it. `alukit diff --variant a --variant b` compares any two.

- A connection naming a bar its variant omits drops that end, with an info diagnostic; with no
  ends left it is dropped.
- A point on an omitted bar is an error in that variant: scope it too.
- A swap that changes a section's size moves nothing: placements re-derive from anchors (flush
  faces stay flush), and cut lengths follow.

### 4.11 Costs, currency and price basis (review M7)

- **`currency`**: the project's. Offers keep their catalog's currency. `fx` holds dated rates as
  valued fields (`"fx": { "EUR": { "v": 6.2, "src": "src", "ref": "…", "read": "…" } }`). Lines are
  converted per line; a line with no rate is a missing price (§5.5).
- **`price_basis`**: `regular` (default), `sale` or `lowest`. The order list states the basis and
  the oldest read date.
- **`costs`**: lines that are not parts: `{ "id", "label", "kind", "supplier"?, "low_minor",
  "likely_minor", "high_minor", "currency"?, provenance, "blocks"? }`, with `kind` one of
  `machining`, `fabrication`, `labour`, `freight`, `lifting`, `contingency`, `other`. A
  contingency may be `{ "pct": 10, "of": "subtotal" }`. A line with `covers: { "supplier":
  "forseti", "services": true }` prices that supplier's generated machining as a whole.
- **Totals** carry low, likely and high, per currency and converted, plus the **share of the
  likely total by provenance tag** (how much rests on prices actually read).

### 4.12 Open items and decisions (wishlist 8, 11)

`open` entries are `{ "id", "text", "blocks": "order" | null, "scope": [entity ids or
"supplier:<id>"] }`. A block with no scope holds the whole order; with a scope, only the suppliers
of those entities (review M8). `decisions` records each choice with its date and reason. Both
appear in the UI and the CLI.

### 4.13 Lock file and revisions (review M5)

**The lock file.** `alukit.lock.json` sits beside the document and holds, in canonical form,
every catalog item any variant resolves: the merged item, its offers and its section, each with
a content hash, plus each catalog's id and hash.

- **Derive reads the lock, never the live catalogs.** The same commit then derives the same
  numbers on any machine with the same AluKit version.
- A save adds items the document newly references, taken from the live catalogs; it never
  changes an entry already there.
- `alukit lock update [--item <id>]` refreshes entries from the live catalogs and prints a
  semantic diff: which fields and prices changed, and how the totals move. A catalog correction
  reaches a project this way, visibly (principle 2). `alukit check` reports, as info, how many
  items differ from the live catalogs. `--frozen` makes a missing entry an error (for CI).

**Revisions.** `alukit revision save "Rev 1.2"` writes `revisions/rev-1.2.json` holding the
document, its lock, the **stored outputs** (cut list, BOM, order list, totals, check results) and
a stamp: AluKit version, Node version, schema version, the content hash of document + lock +
tool version, and the project's git commit and dirty flag as a hint.

- Opening a revision shows the stored outputs: what was published, whatever the tool does now.
- `alukit revision verify <name>` re-derives with the current tool and reports any drift.
- Old schema versions are read through migrations kept forever; stored outputs are never
  migrated.

**Diffs** between git refs (`alukit diff git:<ref>:<path> git:<ref>:<path>`) derive each side
with the lock from its own commit. A price that changed between them shows up as a lock change
and as its effect on the outputs.

## 5. The derived model

`derive(doc, lock, variant) → Derived` is a pure function in `src/core/`.

### 5.1 Pipeline

1. **Resolve.** Apply the variant (`only_in`, `swap`, params). Evaluate params in dependency
   order. Resolve item references from the lock.
2. **Place.** Resolve points, bar frames and placed sections, pivot points and pattern copies of
   structural entities, in dependency order (§4.3, §4.4).
3. **Ends.** One plane per end, the modifiers, cut lengths and angles (§4.5).
4. **Attach.** Parts and part patterns (which may use cut ends and rail holes); face contacts on
   the trimmed bars; generated machining (connector `requires`, access holes, rail holes,
   splice taps) and hardware sets keyed by system; fastening stacks and their grip.
5. **Collect.** Cut list, BOM, order list (offers, packs, kits), costs and totals (§5.3, §5.4).
6. **Check.** Built-in and project checks, then the order rules (§5.5).

**Nothing throws on content** (review m10). An unknown reference, a cycle, an invalid connection
or a zero-length bar becomes a diagnostic `{ severity, code, entity, message }`; the entity is
skipped or drawn at its default, and the rest derives.

### 5.2 Numbers and determinism (review M4)

The claim: **the same document, lock, AluKit version and Node major give byte-identical output
files** (JSON, CSV, Markdown, GLB) on any machine. Snapshots are excluded.

| Source of difference | Rule |
|---|---|
| Two engines (Node, the browser) | Files are written only by Node (the server or the CLI). The tab derives for display only |
| `sin`, `cos`, `atan2` precision ([MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Math)) | Degrees are reduced exactly (`%` is exact in IEEE). `sin` and `cos` return exactly 0, ±½ or ±1 at the angles where that is the true value, and roll is exact at multiples of 90°. Other angles use `Math`, stable within one Node major |
| A last-bit difference at a threshold | Snap to the nearest integer within `tol.snap` before `floor`, `ceil`, `round`; compare within `tol.snap` in checks |
| A tie at the output quantum (`(250.125).toFixed(2)` against its neighbour one bit down) | Divide by the quantum, snap to the nearest half within `tol.snap`, round half away from zero |
| Sort order | Id order (§2), never `localeCompare` |
| JSON key order | Canonical form (§2); ids are never integer-like |
| Sums | Plain summation in a fixed order. Neumaier summation is dropped (review m16): the past 0.2 % move came from a threshold or a step downstream of a sum (*inferred by review 1*), and the snapping rules address that |
| Money | Integer minor units: each line rounded once, then integers added |
| Searches | No time limits anywhere. Nesting is a heuristic with fixed tie-breaks; the pack cover is exact and bounded by the quantity (§5.4) |

CI runs the fixtures on Linux and macOS and compares bytes against the golden files.

### 5.3 Cut list (review M7, m14)

Per bar item and option, in one of two modes from the chosen offer's `sale` (overridable per
project):

- **`cut`** (the supplier cuts). Each piece is ordered at its cut length rounded to `res_mm`; the
  rounding is shown. It is billed in `step_mm` steps, rounded up, with `min_bill_mm` where set.
  Worked example (review M7): a 1,234 mm piece at R$ 126.50/m costs R$ 156.10 by the millimetre,
  and R$ 156.86 in 10 mm steps (124 steps). Pieces outside `min_mm`–`max_mm` fail a check that
  suggests a `splice`.
- **`stock`** (whole bars, cut by you or a shop). Pieces are nested into the item's stock
  lengths, allowing `kerf_mm` per cut and `trim_mm` at each bar end:
  [first-fit decreasing](https://en.wikipedia.org/wiki/First-fit-decreasing_bin_packing) for each
  stock length, then each bar is moved down to the cheapest stock length that still holds its
  pieces, and the cheapest result wins (ties: fewer bars, then the longer offcut). The result
  minimises cost, not waste, which matters when lengths have different prices. Waste is reported
  per bar. The exact [cutting-stock](https://en.wikipedia.org/wiki/Cutting_stock_problem) search
  is out of v1 (review m16).

Identical pieces group into one line with a count: same item and option, same cut length to the
quantum, same end cuts and the same machining. A piece and its end-for-end flip are the same
piece; the canonical orientation is the one whose sorted machining list compares first.

Every piece lists its machining **from a named end**, measured along the axis from that end's long
point: "tap M8 at end a; Ø7 access hole 20 mm from end a on face +y". Rails also list E at each
end.

### 5.4 BOM and order list (review B3, M7)

- **BOM**: every item and option with its quantity (bars: count and total length), grouped by
  kind, with mass (§3.5's authority rule) and price.
- **Order list**, per supplier. Offers are chosen in this order:
  1. an explicit choice in the project's `order` map;
  2. otherwise the **cheapest cover**: for packs, the combination of pack sizes with the lowest
     cost that covers the quantity (an exact search bounded by the quantity; ties: less surplus,
     then fewer lines, then SKU order). 37 hammer screws sold in packs of 10 and 50 become the
     cheaper of 4 × 10 or 1 × 50;
  3. **kits only when chosen**, or when the item has no other offer. A chosen kit's contents are
     credited against the other needs, and any surplus is reported.
- Each line: SKU, name, options, quantity and unit (packs, bars, pieces), unit price on the
  project's basis, low/likely/high total, cut pieces and machining services. Services are priced
  from the supplier's `services.json`, or by a cost line that covers them.
- Every output states the lock hash, the price basis and the oldest price read date.
- Output as Markdown, CSV or JSON.

### 5.5 Checks and what blocks the order (review M8)

| Check | What it catches | Default severity |
|---|---|---|
| Schema and references | invalid documents, missing items, cycles | error |
| Ends and connections | the validation column of §4.5, two providers, an undeclared angled cut | error |
| Unconnected ends | a point shared by two or more bar ends with no connection | warn |
| Fit | a connector or T-nut that does not fit the bar's system; a `face` with no contact | error |
| Lengths | cut length ≤ 0, outside the offer's range, a cut angle outside the supplier's service range | error |
| Rails | end distance E outside the rail's range | error |
| Frames | near-vertical bar without `up`; an end far from its face | warn |
| Project checks | `checks` | per check |
| Open items, placeholders | §4.12, §4.8 | handled by the order rules below |

**Order rules.** Each has a name, can be set to `block`, `warn` or `off` in the project's
`order_rules`, and blocks only the suppliers it concerns:

| Rule | Default | Scope |
|---|---|---|
| `check-error` | block | the suppliers of the entities the check names; all suppliers for a check that names none |
| `open-item` | block | its `scope`, or all |
| `placeholder` | block | its own line, under "unsourced" |
| `missing-price` (incl. no exchange rate) | block | that supplier |
| `est-price` | block | that supplier |
| `out-of-stock` (as read) | block | that supplier |
| `option-not-sold` ("not sold in this finish") | block | that supplier |
| `stale-price` (older than 30 days) | warn | that supplier |

The order list reports **READY** or **BLOCKED** per supplier, with every reason. `alukit order`
exits non-zero when any supplier is blocked, so an agent cannot hand over a blocked list by
skipping `alukit check`.

## 6. Commands (the one edit path)

Every edit is a JSON command, `{ "cmd": "addBar", "args": {…} }`: a pure function from document
to document. Batches apply atomically. The UI, the CLI and agents use the same commands.

**Undo keeps the previous document** (review m1): documents are immutable and share structure, so
each step costs little and undo cannot be wrong. No command needs an inverse.

| Group | Commands |
|---|---|
| Structure | `addNode` `moveNode` `addBar` `setBar` `reverseBar` `splitBar` (optionally adding a `splice`) `removeEntity` |
| Connections | `addConnection` `setConnection` `autoConnect` |
| Parts and patterns | `addPart` `setPart` `addPattern` `setPattern` `explodePattern` `mirror` `array` |
| Items | `addItem` `setItem` (project items) |
| Params and costs | `setParam` `addCost` `setCost` `chooseOffer` |
| Organising | `tag` `label` |
| Records | `addVariant` `setVariant` `addCheck` `addOpen` `resolveOpen` `addDecision` |
| Views | `saveView` |
| Lock | `lockUpdate` (a step in the log like any other) |

- `removeEntity` **refuses** when anything refers to the entity and lists the referrers;
  `cascade: true` removes them too and returns what it removed (review m10).
- Every answer returns the new revision, the ids each command created, and diagnostics that name
  entities (review m2).

Agents work at this level of meaning, so they never compute cut lengths by hand.

## 7. Agent interface

### 7.1 The server owns the document (review M1)

`alukit serve <dir>` runs one server per project (`node:http`, bound to `127.0.0.1`).

- It holds the document and its lock in memory with **one command queue**. Each step writes the
  lock, then the document, each atomically (temporary file, fsync, rename), and increments a
  revision counter.
- **Tabs and the CLI are both clients**: `POST /api/commands { baseRev, commands, source, id }`.
  `id` makes a retry harmless (the server remembers recent ids and their answers). `baseRev` is
  advisory: commands are semantic and apply to the current revision, and the answer lists the
  revisions in between and their sources; `--strict` turns a stale `baseRev` into an error.
- The server broadcasts each revision over an event stream; a client that misses one refetches.
- **A tab holds no unsaved state.** A drag is a local preview, committed as one command on
  release.
- **The undo log is the server's**: one line for all sources, each step tagged (`ui`,
  `cli:<name>`, `agent:<name>`, `file`). Undo pops the latest step, whoever made it, and names it;
  `alukit log` shows what happened and what was undone. The log lives as long as the server
  process; git keeps the rest.
- **A direct file edit** is read by the watcher (the server's own writes are recognised by hash).
  If valid, it enters the log as one `file` step. If not, the project goes **read-only**: every
  client shows why, commands are refused, until the file is valid again or someone chooses
  "restore last good".
- **With no server running**, the CLI runs the same core in-process under `.alukit/edit.lock`,
  created exclusively and holding a pid and a start time, so a crashed holder is detected.
- The CLI finds a server through `.alukit/owner.json` (port, pid, start time, token).

Two paths keep a tab and the file in step, the event stream and the watcher; draft 1 had four
(review m16).

### 7.2 Protecting the local server (review M2, n4)

A page in the same browser can send requests to `127.0.0.1`, or reach it by DNS rebinding; Vite
had this class of bug ([GHSA-vg6x-rcgg-rjx6](https://github.com/vitejs/vite/security/advisories/GHSA-vg6x-rcgg-rjx6)).

- **A random 256-bit token per server start**, written to `.alukit/owner.json` (mode 0600).
  `serve` opens `http://127.0.0.1:<port>/#t=<token>`: a fragment never reaches a server or a
  `Referer`. The app moves it to `sessionStorage`, clears it from the address bar, and sends it as
  an `Authorization` header on every `/api` request.
- **The event stream is read with `fetch`** ([streams](https://developer.mozilla.org/en-US/docs/Web/API/Streams_API/Using_readable_streams)),
  not `EventSource`, so it carries the header too. It keeps the
  [SSE](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events)
  wire format. Browsers allow 6 HTTP/1.1 connections per host; one server and port per project
  keeps that harmless.
- **`Host`** must be `127.0.0.1:<port>` or `localhost:<port>`. **`Origin`**, when present, must
  be the server's own. Bodies must be `application/json`. No CORS headers are sent.
- **Paths**: every path in a request resolves (with symlinks) inside the project folder, or is
  refused. The server writes only inside the project; for an output elsewhere, the CLI receives
  the bytes and writes them itself.

### 7.3 CLI (review m2, m5)

`alukit`, Node, the same core library. `--json` gives machine output; `--as <name>` tags the
source in the log.

| Command | Does |
|---|---|
| `alukit new <dir>` | creates a project, its lock, and a `.gitignore` line for `.alukit/` |
| `alukit serve <dir>` | runs the project's server and opens the tab |
| `alukit check <dir> [--frozen]` | validates, derives and runs the checks; non-zero exit on an error |
| `alukit cutlist` / `bom` / `order` / `costs <dir> [--variant v] [--format md\|csv\|json]` | the outputs; `order` exits non-zero when blocked |
| `alukit derive <dir> --json [--select <paths>]` | the derived model, for report builders (`alukit.derived/1`, with its own JSON Schema) |
| `alukit query <dir> <selector> [--fields a,b] [--limit n] [--summary]` | e.g. `tag:leg`, `b7`, `connections of b2`; bounded output for an agent's context |
| `alukit do <dir> -f batch.json` (or `-f -` for stdin) | edits from a file or stdin, one process per batch; inline JSON also works |
| `alukit add bar --item … --a n1 --b 0,0,900`, … | sugar over `do` |
| `alukit log` / `alukit undo` | the server's log; undo the latest step |
| `alukit lock update <dir> [--item id]` | §4.13 |
| `alukit fmt <dir>` | canonical form |
| `alukit diff <a> <b>` | files, `git:<ref>:<path>`, revisions or variants; each side with its own lock |
| `alukit revision save "<name>"` / `revision verify <name>` | §4.13 |
| `alukit snapshot <dir> --view iso [--size 1600x1000] -o shot.png` | lets an agent see what it built |
| `alukit export glb <dir> -o x.glb` | §9 |
| `alukit catalog search\|show\|check\|import <…>` | catalog work |
| `alukit skill install` | links the skill into `~/.claude/skills/` |

**Snapshots** always render in headless Chromium through Playwright, from a fresh page on the
project's server (an ephemeral one if none runs), at a named view. One code path, and it never
depends on the user's camera, selection or a hidden tab.

### 7.4 Schemas (review m3)

`alukit.json` validates against a JSON Schema generated from the Zod schemas with
`z.toJSONSchema(schema, { io: "input" })` ([Zod](https://zod.dev/json-schema)), so fields with
defaults are optional for a writer. Zod drops refinements from the export and throws on
transforms (*verified by review 1, Zod 4.6.7*), so cross-reference rules live in `alukit check`,
and the skill says so. `derive --json` has its own schema field and JSON Schema; it is a contract
for report builders.

### 7.5 Skill

`skills/alukit/SKILL.md` documents the format, the commands and the conventions. Its command
reference is **generated from the command schemas**, so it cannot go stale. `alukit skill install`
links it into `~/.claude/skills/`, so it works from any repo, including the ones where projects
live. An MCP server comes only if the CLI proves insufficient (review m2).

## 8. Viewer and UI

### Layout

| Area | Holds |
|---|---|
| Top bar | project, variant, undo and redo (naming the step), revision, the read-only banner, export |
| Left | catalog browser (vendor › kind › family, search, item cards with a section thumbnail, fidelity and key data; options and offers) and the project tree (bars, connections, parts, patterns; by tag or kind) |
| Centre | the 3D viewport: perspective or orthographic, standard views (top, front, side, iso), a section clipping plane, grid |
| Right | properties of the selection. Every number has a provenance popover; derived values (cut length, end angles, mass, price) are read-only |
| Bottom drawer | Cut list · BOM · Order (status per supplier) · Costs · Checks · Open items · Params · Decisions · Log |

### Tools

- **Select**: click or box select, or by tag.
- **Draw bar** (any bar item: profile, tube, rod, rail):
  1. Click a snap point.
  2. The line follows the axis, inferred X, Y or Z. Shift frees it within the **work plane**:
     by default the plane through the start point facing the view's dominant axis; `W` sets it to
     a picked face (review m11).
  3. Type a length and press Enter.
  4. R rolls the section; A cycles the anchor. The item comes from the palette.
- **Connect**: pick a through bar and butting ends (`butt`), two ends (`miter`, `splice`), a
  face and the ends it carries (`pivot`), or two faces (`face`).
- **Place part**: on a face or groove, at a distance typed from a named end.
- **Pattern**: select the template, pick the bar, type pitch and count.
- **Measure**.

Snap targets are nodes, bar ends, stations on face and groove centre lines, face centres and the
grid (10 mm by default). Snapping is analytic, from the derived model, not a raycast against
meshes. The camera is [camera-controls](https://github.com/yomotsu/camera-controls), with
orthographic views and fit to selection.

### Rendering

- One unit-length extruded geometry per section and finish, from the simplified display outline
  (§3.5), as an `InstancedMesh` scaled along the axis, for bars with square ends.
- A bar with an angled end gets its own geometry: each outline vertex of the prism moves along
  the axis to the end plane, which is exact and cheap.
- Edges are one merged line buffer for all bars, rebuilt per derive; `EdgesGeometry` cannot be
  instanced (review m11).
- Holes are markers, not booleans, in v1. Hardware uses simple parametric meshes, or a GLB per
  item where one exists.
- Placeholders render translucent and hatched; `parametric` and `box` sections show their
  fidelity on hover.
- Meshes are built by `src/mesh/`, which the viewer and the GLB writer share (§9).

### Targets

1,000 bars and 5,000 hardware items at 60 fps on an M-series Mac. A full derive under 50 ms for
1,000 bars; incremental derive comes later if needed. *Not verified* (review 1 §9).

## 9. Exports

- **GLB, by AluKit's own writer** (review m5). three's `GLTFExporter` fails in Node with
  "FileReader is not defined" (*verified by review 1, three 0.187.0*), and `ExtrudeGeometry`
  runs in Node. So `src/mesh/` builds the meshes with three's geometry classes (no renderer), and
  `src/export/glb.ts` writes the
  [binary glTF](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#binary-gltf-layout)
  directly: positions, normals, indices and flat materials, no textures. It is small, runs in the
  CLI, and its bytes are deterministic, so GLB joins the determinism claim.
  - Z-up mm converts to Y-up m at the root. The export scene has one node per bar or part, named
    `<id> <label|item>`, sharing one mesh per distinct geometry. It is not the render scene.
  - `extras`: id, item, SKU, options, cut length.
  - `asset.extras` stamp: AluKit version, the content hash of document + lock + tool version,
    revision, variant, and the git commit and dirty flag as a second field (review M5). This
    answers the "published page traced to no commit" lesson.
- **Cut list, BOM, order list and costs** as Markdown, CSV or JSON, with the same stamp.
- **`derive --json`**, the full derived model for external report builders.

STEP, DXF flats and a self-contained report come in v2 (D6).

## 10. Repository layout and stack

```
src/core/      schema (Zod), expressions, commands, derive, frames, ends, connections, patterns,
               cut list, nesting, BOM, offers, costs, checks, diff, canonical form, section properties
src/catalog/   loading, the merge, the ratings vocabulary, section generators, computed-vs-published, search
src/mesh/      meshes from the derived model (three geometry classes only; Node-safe)
src/export/    the GLB writer, Markdown and CSV
src/viewer/    three.js scene sync, tools, snapping, picking
src/ui/        Preact panels
src/server/    node:http, the event stream, the watcher, security checks (also mounted in the Vite dev server)
src/cli/       the alukit CLI
catalogs/      forseti/, std/, ref-hiwin/
importers/     forseti/ (Python + PyMuPDF; the PDF vector extraction proven in the survey)
skills/alukit/ SKILL.md (command reference generated)
tests/fixtures/ catalogs/test/, golden-ends/, cart/ (12)
tests/e2e/     Playwright (unit tests sit next to the code)
docs/
```

`src/core/` and `src/catalog/` import no three.js and nothing from `src/ui/`; the CLI imports
nothing that reaches `.tsx`.

**`alukit serve`** serves the built app (`dist/`, rebuilt by the CLI when its source hash
changes) from `node:http`. The same server module mounts in Vite's dev server while AluKit itself
is developed. Review 1 suggested Vite in middleware mode as the only server; that would put
Vite's HMR socket into every user's runtime, a second surface to secure, so it is not adopted
(call 17).

**Versions** (as of 2026-11-26; each is the registry's `latest`, *verified by review 1* with
`npm view`):

| Package | Version | Note |
|---|---|---|
| [three](https://www.npmjs.com/package/three/v/0.187.0) | 0.187.0 | `GLTFExporter` not used (§9) |
| [vite](https://www.npmjs.com/package/vite/v/8.4.0) | 8.4.0 | published 2026-11-26, the day it was pinned |
| [preact](https://www.npmjs.com/package/preact/v/11.2.0) | 11.2.0 | 11.0.0 is eight weeks old |
| [@preact/signals](https://www.npmjs.com/package/@preact/signals/v/2.11.4) | 2.11.4 | |
| [zod](https://www.npmjs.com/package/zod/v/4.6.7) | 4.6.7 | JSON Schema with `io: "input"` (§7.4) |
| [camera-controls](https://www.npmjs.com/package/camera-controls/v/3.1.2) | 3.1.2 | its v3 API not yet verified |
| [vitest](https://www.npmjs.com/package/vitest/v/5.1.2) | 5.1.2 | |
| [@playwright/test](https://www.npmjs.com/package/@playwright/test/v/1.65.1) | 1.65.1 | also runs `snapshot` |
| [@biomejs/biome](https://www.npmjs.com/package/@biomejs/biome/v/2.6.9) | 2.6.9 | lint and format: one fast binary instead of ESLint + Prettier |
| [typescript](https://www.npmjs.com/package/typescript/v/7.0.2) | 7.0.2 | type-check only; Vite transpiles. Its package exposes no compiler API at `.` (review n3); nothing here imports it |
| [pnpm](https://www.npmjs.com/package/pnpm/v/12.23.0) | 12.23.0 | the registry's `latest` (review n1) |

- **Exact pins and a lockfile** (review n2, §9 of review 1). `save-exact=true`, `pnpm-lock.yaml`
  committed, installs with `--frozen-lockfile`. vite 8.4.0 is one day old at pinning; M0's smoke
  test decides, and a package that fails drops to its previous release.
- **Node 26 LTS** (D15), pinned in `.nvmrc` and switched with [nvm](https://github.com/nvm-sh/nvm);
  `engines.node` is set to match at M0. On Node 26.13.1 (`process.release.lts` is set), a `.ts`
  file runs without a flag or a warning (*verified 2026-11-26*). Vite 8.4.0
  (`^20.19.0 || >=22.12.0`), Vitest 5.1.2 (`^22.12.0 || ^24.0.0 || >=26.0.0`) and camera-controls
  (`>=22`) all accept it (*read: review 1 §9*). If M0 finds a problem, the fallback is Node 24 LTS
  (type stripping stable from 24.12.0, per [Node's docs](https://nodejs.org/api/typescript.html)).
- **pnpm without Corepack.** Node 26's distribution ships no `corepack` binary (*verified on
  26.13.1*; 24.18.0 still has one). `npm install -g pnpm@12.23.0` inside the nvm Node works
  (*verified: pnpm 12.23.0 runs on 26.13.1*;
  [pnpm installation](https://pnpm.io/installation)). `package.json` records it in
  `packageManager`. M0 writes the exact steps into the README.
- **Type stripping rules** (review m4, [Node docs](https://nodejs.org/api/typescript.html)):
  erasable syntax only (`erasableSyntaxOnly`: no enums or parameter properties); imports carry the
  `.ts` extension and use `import type` (`allowImportingTsExtensions`, `verbatimModuleSyntax`);
  no `.tsx` in anything the CLI imports; no `.ts` under `node_modules`, so the CLI runs from a
  checkout or a link and a future npm package needs a build. `tsconfig` paths do not work at run
  time; internal aliases use `package.json`
  [subpath imports](https://nodejs.org/api/packages.html#subpath-imports) (`#core/*`), which Node
  resolves natively (*inferred; verify at M0*).

## 11. The Forseti catalog (D4)

1. **Bulk import** (a script, deterministic).
   - Fetch the Store API products and variations; variations come only from
     `products?type=variation`, deduplicated by id (*read: survey §1*).
   - Classify each product by the survey's rules. Anything that fits no kind becomes `generic`,
     so every orderable SKU lands somewhere (review B3).
   - Classify each variation attribute, from a reviewed table in the importer: a **size** makes
     separate items (carriage 15/20/25/30), an **option** becomes an item option (finish, hand,
     material; `-pp` is black), `Unidades` is a **pack**, a **length** is a stock offer (rails).
   - Parse kit contents from descriptions ("Item (code): n unidades"), and kg/m, maximum length,
     groove and tap from profile descriptions.
   - Emit items and offers with regular and sale price, `in_stock`, the shop's weight as
     `ship_mass_kg`, URL and read date.
   - Profiles get `sale: cut` (40–3000 mm, ±1 mm, 10 mm steps). The 80x80 is named "1 metro" in
     the shop, so its rule is confirmed at import (*read: survey §1*).
2. **PDF tables.** Map pages to families and parse A, Ix, Iy and kg/m per profile; material
   6063-T5, E 69,000 MPa (p. 6).
3. **Sections**, for all 25 profile stems (review M6). The **reference project's profiles go
   first** (M2a), the rest in M2b.
   - **`exact`** from the PDF's vector paths: 8 of about 20 catalogue profiles (p. 11, 14, 15, 16
     ×2, 18, 19, 21; *verified by review 1*). Six agree within 1 %; the 40x40 leve and the 20x60
     are 3–4 % off and enter as accepted mismatches until checked by hand (*read: survey §4*).
   - **`parametric`** T-slot for every other stem, from the published overall size, groove and
     core dimensions, with `props_ok: false`. This puts every profile on the cut list at once
     (§3.5). The catalogue's other 10 or more profiles and the shop-only stems (PF20-15, PF20-13,
     PF20-21, PF40-11, PF30-11, PF50-01) start here.
   - Upgrades, as each becomes available: **`traced`** from the page's raster image (accepted
     within 2 % of the published area), or **`exact`** from vendor CAD (the one IGES on the
     shop's media library, PF30-02; GrabCAD models downloaded by Marcio, because GrabCAD blocks
     automated access).
4. **Family modelling by agents.**
   - For connectors, fasteners, linear parts and accessories, one agent per family reads the
     catalogue and shop pages and writes `families/*.json` (mounting, fastener sets per system,
     `requires`, pivot and splice geometry, fits, ratings) with provenance.
   - A second agent reviews it independently (a lesson from the reference project).
   - The parts the reference project uses go first, then the rest.
5. **Services.** The machining services guide (56 pages, outside the API: mitre 1–60°, threads,
   connector holes, access holes, parallel holes) goes into `services.json` by hand, with page
   references.
6. **Overrides** with `expect`: the 40x80's Ix and Iy (very likely swapped labels and a lost
   digit) and the 40x40 fechado's mass; other inconsistencies as accepted mismatches with notes
   (*read: survey §7*).
7. **Clone ratings.** HIWIN HG values for the HGR/HGH rails and carriages go once into
   `catalogs/ref-hiwin/`; Forseti's items point at them with `clone_of` (review m8).
8. **`alukit catalog check forseti`** produces the computed-vs-published report.

## 12. v1 milestones (review M9)

Every "done when" is a test or a measurement that can fail. Synthetic fixtures in
`tests/fixtures/` keep D2 (no projects in this repo) and still exercise what the reference project
needs:

- `catalogs/test/`: a small synthetic catalog (two T-slot bars with parametric sections, an RHS,
  a threaded rod, a rail with a hole pitch and its carriage, a bracket with per-system fastener
  sets, a hinge with pivot geometry, a splice stud, fasteners sold in packs and in a kit, regular
  and sale prices).
- `golden-ends/`: the cases of §4.6.
- `cart/`: a small synthetic cart with the reference project's classes of construction, and none
  of its specifics: T-slot bars with eccentric anchors and a rolled 40x80, a steel beam, a rail
  with a pattern of carriages, threaded rods in tube sleeves at a pattern of stations, a spliced
  run, braces between pivots, a bolted face-to-face stack, a plate with threaded and countersunk
  holes, a placeholder, and cost lines. Its expected outputs are worked by hand.

| M | Delivers | Done when |
|---|---|---|
| M0 | Scaffold: Vite + TS + Preact + three, Biome, Vitest, Playwright; the CLI entry; the server skeleton; Node 26 and pnpm verified | from a clean clone on Node 26: `pnpm install --frozen-lockfile`, `pnpm test` and `pnpm build` pass; `node src/cli/main.ts --version` runs without a flag or a warning; Playwright sees a non-blank canvas. A failure on 26 is recorded and the pin moves to 24 LTS |
| M1 | Catalog schema (envelope, items and offers, kinds, ratings vocabulary), merge layers, sections with fidelity, generators, section properties, `catalog check` | the 40x40 básico's exact outline gives 553.5 ± 0.1 mm² and Ix, Iy 9.13 ± 0.01 cm⁴; each generator matches its closed-form A and I within 0.1 %; a test override with a stale `expect` is reported; a family file that changes an importer field fails |
| **M1.5** | **Paper model**: the reference frame's document written against the draft schema, by a throwaway converter from its existing model, kept in the reference project's own repo | every body of the reference frame is in the converted document or on a written gap list, and each gap is closed by a schema change in this design or an explicit v1 exclusion. One or two days |
| M2a | Forseti items the reference project uses, the `std` steel and fastener items it needs, `ref-hiwin/` | each item has a section with a declared fidelity and offers with regular and sale prices and read dates; the 8 exact outlines pass `catalog check` within 1 % or are accepted mismatches |
| M3a | Points, frames, placement, end planes and connections, cut list | every golden case (§4.6) and the frame table (§4.4) pass to 0.01 mm; the cart's cut list equals its hand-worked table |
| M3b | Generation (machining, hardware by system, rail holes, patterns), BOM, offers and the order list with its rules, costs and totals, checks, commands with undo, CLI, lock file, canonical form | the cart's order list and totals equal golden files byte for byte, on Linux and macOS; 37 screws pick the cheapest pack cover; each order rule has a test that blocks and one that does not |
| Slice | **Early acceptance**: the reference frame's T-slot cut list (run in its own repo) | every T-slot piece within 0.5 mm of the record's length, or on a written exceptions list with its reason |
| M4a | Viewer: rendering, selection, properties, the server owning the document, event stream, watcher, security | in Playwright: a CLI command appears in two open tabs within 1 s at the same revision; an invalid direct edit makes both read-only with the error; requests without the token, or with a foreign `Origin` or `Host`, get 403 |
| M4b | Draw tool with snapping and work plane, connect, place part, pattern, catalog browser | a Playwright script draws the cart's base frame with the mouse, and its derived cut list and BOM equal those of the CLI-built fixture |
| M2b | The rest of Forseti's catalog, beside M4 | every one of the 1,196 orderable SKUs maps to an offer (a test against the importer's raw dump); every profile stem has a section with a declared fidelity |
| M5 | Variants with `only_in`, diff, revisions with stored outputs, the GLB writer, `snapshot`, the skill | a diff across two commits with a lock price change reports it; `revision verify` shows zero drift on an untouched revision; two GLB exports are byte-identical and load in three's `GLTFLoader` with the expected node names and `extras`; an agent with only the skill rebuilds the cart's frame from a text description and `alukit check` passes (a recorded manual run) |
| M6 | Custom plates and bent angles with hole features; generic items and placeholders | the cart plate's threaded, countersunk and counterbored holes appear on its machining sheet; the placeholder blocks only its own line in the golden order file |
| **Acceptance** | §13 | §13 |

## 13. Acceptance (review B2, M9)

**Scope, in writing.** Acceptance is the reference project's **frame structure** (an internal lab
rack), modelled in its own repo:

| In | Out |
|---|---|
| Every structural body: T-slot bars, steel sections (the main beam, rolled angles, flat bar), tube sleeves and threaded rods as bars, linear rails as bars with their carriages placed on them, plates, connectors and fasteners, packers and pads | **The drive and the dampers** (v3 mechanisms), and all motion |
| Splices, braces cut between pivots, bolted face-to-face stacks, patterns of repeated stations | Loads and utilisation (v2) |
| The record's cost lines that are not parts (machining, steel work, assembly, freight, contingency), as `costs` | The record's unused alternatives: they live in their own variant |

**Oracle.** The record's files disagree on revision, price basis and lengths (*read: review 1
M9*), so the reference project's repo names the files, the revision and the tolerances before
acceptance starts. The tests then are:

1. **Cut list**: every bar within 0.5 mm of the record's length for it, or on a written
   exceptions list with the reason.
2. **Mass**: the frame within 1 % of the record, with the difference split per line.
3. **Cost**: the vendor's lines to the cent on a frozen price snapshot (the lock), on regular
   prices; with the cost lines entered, the totals match the record's raw low, likely and high.
4. **Counts**: pack and kit quantities equal the record's, or the difference is explained.

Acceptance **fails** if any exception is caused by a gap in AluKit's model. An exception may only
be an error in the record or a deliberate scope exclusion from the table above.

## 14. Calls made without asking (veto any)

1. Z-up mm world (the Fusion frame); conversion only in the scene and GLB.
2. The UI is in English; vendor names stay as published (Portuguese).
3. Desktop, mouse and keyboard only, for editing in v1. The Quest sees the GLB.
4. A project is `alukit.json`, `alukit.lock.json` and `revisions/`; `.alukit/` holds per-machine
   state and is gitignored.
5. A small safe expression language, not JavaScript; trig in degrees.
6. The default connection is a butt with an angle bracket (no machining). The through bar is the
   one passing through the point, else a vertical, else the lowest id; its end covers.
7. Importers may be Python (PyMuPDF is the right tool for PDF vectors); the tool itself is
   TypeScript.
8. The SSE wire format read with `fetch`, not websockets; localhost only. The token is
   delivered once in the URL fragment, then sent as an `Authorization` header (§7.2).
9. Biome instead of ESLint + Prettier; TypeScript 7 for type-checking.
10. *New.* "Member" is renamed **bar** (D14) and "joint" **connection**.
11. *New.* **The lock file pins catalog data.** A correction reaches a project only through
    `alukit lock update`, which shows its effect; `check` says when the lock is behind.
12. *New.* Prices default to the **regular** price; a sale price is used only when the project
    says so.
13. *New.* An **estimated price blocks** the order by default (the rule can be switched to warn).
14. *New.* Units come from the field name's suffix, from a fixed list, and the loader converts;
    values stay as their source prints them.
15. *New.* A `std` catalog of standard steel shapes and fasteners; the generic T-slot catalog is
    dropped.
16. *New.* AluKit writes GLB itself instead of using three's exporter.
17. *New.* `alukit serve` serves the built app; Vite runs only while developing AluKit (review 1
    §7's alternative declined, §10).
18. *New.* Undo is linear and server-side, and does not survive a server restart.
19. *New.* `removeEntity` refuses when the entity is referenced, unless `cascade`.
20. *New.* Face connections check contact and never move bars: v1 has no constraint solver.
21. *New.* Patterns are translations only; mirror and array create ordinary entities.
22. *New.* Nesting is a heuristic (first-fit decreasing, then cheapest stock per bar); no exact
    search in v1.
23. *New.* Fastening stacks report their grip; the fastener-length check is v1.1.
24. *New.* Outputs quantise lengths to 0.01 mm, angles to 0.01°, mass to 1 g.

## 15. Review 1 resolution

Every finding of [review 1](reviews/design-review-1.md) and where draft 2 resolves it.

| Finding | Resolution |
|---|---|
| B1 Cut lengths not well-defined | Adopted. End planes with one provider per end, bounding-box faces, `cover`/`node`, declared angled cuts, validation, points on a bar: §4.3, §4.5. Golden table: §4.6. M3a's oracle: §12. One change: the proposed check "a span node within 0.01 mm of the through member's line" is replaced, because a butt now needs no node (its plane follows the through bar) and an end that moved far from its face warns |
| B2 The model cannot express the acceptance project | Adopted as **widen** (D14): bars of any linear stock (§3.4, §4.4), `face`, `splice` and `pivot` connections (§4.5), stations and free ends (§4.3), patterns (§4.7), hole features (§4.8). The review's `between` joint became `face`, and explicit ends became `ends.<x>.plane` plus `extend_mm`. Acceptance scope: §13 |
| B3 The catalog cannot hold Forseti as sold | Adopted. Items and offers, packs, kits, options, two prices: §3.2. `generic` kind and hardware keyed by system: §3.4. Common envelope: §3.2. Importer rules: §11. One addition: a kit is also used when the item is sold in no other way (§5.4) |
| M1 The tab owns the document | Adopted. §7.1 |
| M2 Unprotected local server | Adopted, with the stream read by `fetch` so it carries the token in a header instead of the URL. §7.2 |
| M3 Local frame discontinuous; anchors ambiguous | Adopted. Tolerances §2; frame, `up`, exact roll, section-local anchors, two-axis offset, frame table §4.4 |
| M4 Determinism not met | Adopted. §5.2, §2 (id order, canonical form, quantum). "Bound the exact search by node count" became "no exact search in v1" (m16), so no search has a limit that could differ by machine |
| M5 Revisions and diffs between refs | Adopted, and taken one step further: the working copy also derives from the lock, not the live catalogs, so a commit derives the same numbers on any machine (call 11). Lock file, stored outputs, `revision verify`, diffs with each side's lock, schema migrations: §4.13. Stamps: §9 |
| M6 Only 8 extractable outlines | Adopted. Fidelity, generators, authority rule: §3.5. Outline plan with the reference project's profiles first: §11 step 3. Restated M2a and M2b: §12 |
| M7 Cost model | Adopted. Price steps and `min_bill_mm` §3.2, §5.3; per-bar prices and cheapest stock §5.3; ranges, cost lines, currency, provenance share §4.11 |
| M8 The order list blocks on too little | Adopted. Named, switchable rules scoped per supplier; `alukit order` exits non-zero when blocked: §5.5 |
| M9 Milestones find the biggest risk last | Adopted. Paper model M1.5, M2/M3 split, early slice, fixtures, failing "done when" lines: §12. Acceptance with numbers and a written scope: §13. The converter lives in the reference project's repo |
| M10 Three files, no merge rule | Adopted. Merge layers, `expect`, computed `corrected` history: §3.1. Authority rule: §3.5 |
| m1 Inverse commands; id reuse | Adopted. Snapshots for undo and a counter in the document: §6, §2 |
| m2 CLI and skill conditions | Adopted. `-f` and stdin, one process per batch, structured answers, bounded `query`, generated reference: §6, §7.3, §7.5 |
| m3 JSON Schema needs `io: "input"` | Adopted. §7.4 |
| m4 Node limits | Adopted, on Node 26 per D15: §10 |
| m5 GLB not headless | Adopted. Own GLB writer, shared `src/mesh/`, export scene apart from the render scene: §9. Headless snapshots only: §7.3 |
| m6 Expression language underspecified | Adopted. §4.9 |
| m7 Simulation fields only named | Adopted. Connector frame, stiffness per pair and degree of freedom, rating basis, thermal expansion, damper stroke, gearbox radial load: §3.3, §3.4. Units by suffix: §2 |
| m8 Clone ratings copied | Adopted. Reference catalogs and `clone_of`: §3.1, §3.4 |
| m9 Variants by omission | Adopted. `only_in`, `not_in`, a default variant, omitted references, swaps: §4.10 |
| m10 `derive` throws | Adopted. Diagnostics §5.1; `removeEntity` refuses unless `cascade` §6 |
| m11 Rendering and the draw tool | Adopted. Simplified display outlines §3.5; merged edges, work plane §8; M4 split into M4a and M4b §12 |
| m12 `panel` has no document entity | **Deferred to v1.1**: a panel sized from its opening needs openings, which v1 does not model. In v1 a panel is a project `plate` of the panel's material (§3.4, §4.8) |
| m13 File format form | Adopted. Canonical form and `alukit fmt` §2; catalog ids §3.1 |
| m14 Cut-list details | Adopted. Grouping with a canonical orientation, kerf and end trim: §5.3 |
| m15 Fastener length by hand | **Partly; the check is deferred to v1.1.** v1 records the stack and reports the grip (§4.5). The length check needs thread-engagement rules per nut and tapped hole, which belong with v1.1's space checks |
| m16 Over-built for v1 | Adopted item by item: no Neumaier (§5.2), no inverses (§6), no exact cutting-stock search (§5.3), no generic T-slot catalog (§3.1), a ratings vocabulary instead of fixed drive, damper and anchor schemas (§3.4), headless snapshots only (§7.3), two sync paths (§7.1). The `std` catalog is kept because D14 needs standard steel and fasteners |
| n1 pnpm version | Adopted. 12.23.0: §10 |
| n2 Pin exact versions | Adopted. §10 |
| n3 TypeScript 7 API | Noted. Nothing imports the compiler API: §10 |
| n4 SSE connection limit | Noted. One server and port per project: §7.2 |
| n5 Three joint types would do | Adopted. `tee` and `cube` are `butt`: §4.5 |
| n6 `_minor` | Adopted. §2 |
