# M1 decisions

*2026-11-26. Calls made while building M1 (the catalog core) where [`design.md`](../design.md)
is silent or ambiguous. For the coordinator to fold into the design or veto.*

## Layout and files

| # | Decision | Why |
|---|---|---|
| 1 | The synthetic catalog lives in `tests/fixtures/catalogs/test/`, with a small `ref-test/` beside it for clone ratings | §10 and §12 put fixtures under `tests/fixtures/`; `catalogs/` holds the built-ins users get |
| 2 | The 40x40 básico's exact outline is `tests/fixtures/catalogs/test/sections/PF40-01.json`, centred on its box, coordinates rounded to 0.0001 mm | `catalogs/forseti/` does not exist yet; M2a's importer writes the same outline there |
| 3 | Every file carries `schema`: `alukit.catalog/1`, `alukit.offers/1`, `alukit.section/1`, `alukit.family/1`, `alukit.overrides/1` | The project already does (§4.2); migrations need it |
| 4 | A section's file name must be its id (`sections/<id>.json`), or a warning | One file per section (§3.5), findable by id |
| 5 | Biome skips `catalogs/` | Importer output is regenerated; a formatter rewriting it would make every import a diff |
| 6 | JSON files are read strictly: a duplicate key is an error with its line | `JSON.parse` silently keeps the last of two keys, so a family naming one item twice would lose half of it |

## Units and values (§2)

| # | Decision | Why |
|---|---|---|
| 7 | Four suffixes added: `_N_per_mm`, `_Nmm_per_rad`, `_mm_per_m`, `_deg_per_m` | §3.4 names joint stiffness per degree of freedom, straightness and twist; the fixed list had no unit for them |
| 8 | Loaded items keep values as printed; `toBase(field, value)` converts when a calculation needs it | §14 call 14: "values stay as their source prints them" |
| 9 | Open maps of quantities (`dims`, `anchor.eta`) take only keys with a known suffix | §2: an unknown suffix is a schema error. A test also walks the exported item schema and holds every valued field to a known suffix, or to the dimensionless list (`nu`, `mu`, `K`, `safety_factor`) |

## The merge (§3.1)

| # | Decision | Why |
|---|---|---|
| 10 | A *field* is a path of object keys. Arrays and valued objects (`{ "v": … }`) are leaves, replaced whole; plain objects (`ratings`, `core`, `options`) merge key by key | Lets a family add `ratings.F_N.x` beside the importer's `ratings.load_N` |
| 11 | A family may restate a field unchanged. A bare number restated as a valued object is a change | "May not change a field layer 1 set": equal is not a change; new provenance is |
| 12 | `catalog.json` and family files hold item *fragments*; only the merged item is checked against its kind | A family supplies fields the importer cannot read (`fits`, `mounts`); the JSON Schema export adds an `item` schema for the merged form |
| 13 | A family file's `prov` is required and is the provenance of the bare numbers it sets; a fragment's `prov` narrows it, and becomes the item's `prov` only when the family creates the item | Per-field provenance without rewriting values: every field records the file (and provenance) that set it |
| 14 | A layer-1 item without `prov` takes the catalog's `prov` | An importer states one provenance for a whole import |
| 15 | `expect` is compared by number for valued fields, deeply otherwise; `null` means the field is absent | A re-import that only refreshes a read date must not make every correction stale |
| 16 | A stale override is an error and is **not applied** | It must not override silently; a person decides |
| 17 | A numeric override value is stored as a valued field: `src`, `ref`, `read` from the override, `why` as its note | The corrected value carries its own provenance |
| 18 | Overrides correct only their own catalog's items, by object path; an `accept` must name a field the item has | One correction, one place; catches typos |

## Ids and catalogs (§3.1)

| # | Decision | Why |
|---|---|---|
| 19 | A reference is `<catalog>:<id>`, or a bare id resolved in the referring catalog. Loaded items keep references as written; `CatalogSet.get(kind, ref, from)` resolves them | Items, sections, materials, groove types, systems and offers are separate namespaces, so an item and its section may share an id (`TS40`) |
| 20 | Local ids: letters, digits and `. _ + -`; never integer-like, never `:`, `/` or spaces. Catalog id `project` is reserved | §2 (key order); `project:` is for project items (§4.8) |
| 21 | Referenced catalogs are found among folders given with `--catalog`, then beside the target folder, then in the built-in `catalogs/`; a folder found by id must declare that id | Catalogs sit side by side (§3.1); a test catalog finds its reference catalog |
| 22 | `clone_of` is on the envelope (any kind), one level only. Copied ratings are `est`, carry the original's `ref` and `read`, and a note naming it | Rails are rebadged too, not only carriages; a chain of clones hides the original |

## Kinds and ratings (§3.4)

| # | Decision | Why |
|---|---|---|
| 23 | Ratings keys are flat, dotted names: `F_N.x`, `damper.energy_J` | One table of keys, one unit per key; the axis qualifier is ignored for the unit |
| 24 | `C_N` and `C0_N` also apply to `generic` items; `damper.*` to `generic` and `accessory`; `drive.*` and `gearbox.radial_N` to `generic`; `anchor.eta` to `fastener`, as suffix-keyed values | Ball nuts and bearings are generic and the vendor publishes C and C0 for some; §3.4 has no damper, drive or anchor kind |
| 25 | Shapes the design names without spelling out: connector `frame` = `{ x, y }` unit vectors (z = x × y); `mounts[].plane` = `{ point_mm, normal }`; holes `{ at_mm, d_mm, slot_mm?, thread? }`; `requires[]` = `{ op, on, thread?, d_mm?, depth_mm?, from_end_mm? }` | Exact enough for M3b to generate machining and hardware from |
| 26 | Fasteners have a `subtype` (screw, bolt, nut, washer, t-nut, hammer-screw, rivet-nut, rivet, insert, pin, stud, anchor, other); accessories a free-text `subtype`; generics a `category`; carriages, accessories and generics an open `dims` map | A T-nut must be told from a screw; §12's splice stud needs `stud` |
| 27 | A panel has no mass field: its mass follows from `thickness_mm` and its material | Sheet sizes are offers (§3.4) |

## Offers (§3.2)

| # | Decision | Why |
|---|---|---|
| 28 | No `pack` means 1; `pack` and `kit` exclude each other; a kit's first entry must be the offer's item | §3.2 |
| 29 | A bar's offer needs a sale rule; only bars have one. `price.per` follows it: `cut` → `m`, `stock` → `bar`, anything else → `unit` | The cut list and the order list read these |
| 30 | `supplier` defaults to the catalog's `vendor`; a catalog with offers must name a `currency` | §3.2, §4.11 |
| 31 | Every option value of an item that has offers must have an offer; otherwise a warning | §3.6. A warning, since a vendor may list a finish it does not sell; the order rule `option-not-sold` blocks later |

## Sections and generators (§3.5)

| # | Decision | Why |
|---|---|---|
| 32 | `exact` and `traced` sections declare their nominal `bbox_mm`; the outline's own box may differ by 0.1 mm before a warning | Cut lengths use the nominal box; a stroke-centreline outline is 40.0004 mm tall |
| 33 | Datum name `c` is refused | It is the bounding-box anchor (§4.4) |
| 34 | `tslot` takes its groove dimensions from the groove type (`groove`, or `type` per groove), one groove centred per face by default, and a list of `bores` | One correction to a groove reaches every profile; a 40x80 has two bores. The `wall` parameter §3.5 lists is not modelled: the envelope is a box less its slots |
| 35 | Generators so far: `tslot`, `rhs`, `tube`, `rod`, `threaded-rod`, `flat`, `angle`, `rail`. `channel` and `beam` come when `std` needs them (M2a); until then such bars use `exact`, `traced` or `box` sections | M1's done-when names the first five kinds |
| 36 | Arcs are flattened at a fixed 0.5° step | The error is then relative: 0.0013 % of a circle's area and 0.0025 % of its I at any radius (measured). A fixed 0.001 mm chord tolerance, tried first, gave 0.053 % on I at r = 5 mm (measured), and its error grows as 1/r, past 0.1 % below about r = 2.7 mm (inferred from the formula) |
| 37 | A threaded rod's properties use the circle of the ISO 898-1 stress area, d − 0.938194 P; RHS inner radius defaults to ro − t | §3.5 "stress area for properties"; EN 10219's usual radii |
| 38 | Each generator's closed form is composed from rectangles, discs and fillet spandrels, with no polygon integration | An independent oracle for the generator test |

## Properties and the check (§3.6)

| # | Decision | Why |
|---|---|---|
| 39 | Properties are about the centroid; the principal angle is in (−90°, 90°], 0 for an isotropic section; W is to the extreme outline vertex | One definition everywhere |
| 40 | Outlines are not tested for self-intersection or holes outside them | They are importer output; the area and the published values catch bad ones |
| 41 | Output quanta: §2's for lengths, angles and mass; areas, moduli and second moments to 0.01 in their unit; differences to 0.01 % | §2 sets none for those |
| 42 | Severities: a mismatch beyond 1 % without an `accept` is an error; a traced outline beyond 2 % of the published area is an error that no `accept` lifts; an `accept` no longer needed is a note | §3.5, §3.6 |
| 43 | Mass is compared only when the item's material has a density; bars whose section has `props_ok: false` are listed as not computed | §3.5's authority rule |

## Not in M1

- `catalog search` and `catalog import`; `services.json` (no schema yet); the canonical writer
  (`alukit fmt`).
- M1.5's P5 (`factory_E_mm` on a stock offer) changes the offer schema once adopted; it is a small
  addition to the `stock` sale rule.
