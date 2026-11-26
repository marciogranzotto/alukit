# M2a decisions

*2026-11-26. Calls made while building M2a (the Forseti importer, `std`, `ref-hiwin`) where
[`design.md`](../design.md) (draft 2.1) is silent or ambiguous, and what the data turned up. For
the coordinator to fold into the design or veto.*

## Draft 2.1 schema additions

| # | Decision | Why |
|---|---|---|
| 1 | `regular_minor` and `sale_minor` take a whole number or a valued object `{ v, low, high, src, ref, read, note }` whose numbers are whole minor units, with low ≤ v ≤ high | §3.2: "Either price may be a valued field (§2) with `low` and `high`". Minor units stay integers in the object form too |
| 2 | No `price_band` on an offer: the offer schema is strict, so one is refused (tested) | §3.2 and §4.11: bands are a project-level list |
| 3 | `factory_E_mm` lives on the stock sale, `sale.factory_E_mm`, a valued field | §3.2 puts it in the `stock` row of the sale table |
| 4 | Linking fills a missing `factory_E_mm` on a rail's stock offer with the centred layout's value, `est`, with a note naming the rule; `catalog check` refuses it on anything but a rail and warns when E (stated or filled) is outside `[E_min_mm, E_max_mm]` or leaves a fraction of a pitch between the end holes | §3.2: "Omitted, it is the centred layout's … tagged `est`"; §4.7: "A check reports E outside the rail's range". Filling at link time, as clones' ratings are filled, gives every reader one value |
| 5 | Parts (connector, fastener, accessory, generic, carriage) take `datums`, named points in the item's own frame; a carriage must declare `run` (schema error otherwise). Names follow section datums (`c` is reserved) | §3.2 *2.1* and §3.4 |
| 6 | A mount's fastener set is a list of `{ item, qty }` and sleeves `{ item, inside: "through", len_mm: "bore" \| number }`; the check requires a sleeve's item to be a bar | §3.4 *2.1*: a sleeve is "cut from bar stock" |
| 6a | **A fastener set is used once per hole of its mount**, so `qty` counts per hole (stated in the schema's description) | §3.4 is silent; a sleeve sits "on the mount hole's axis", which reads per hole. A bill that counted per mount would undercount a 4-hole leg four times |
| 7 | §3 and the coordinator's message agree on all four; nothing in §3 had to win | — |

## Further schema changes M2a needed

| # | Decision | Why |
|---|---|---|
| 8 | An offer may name the `sku` it orders when its key is not the SKU. The 80x80 profiles are sold in whole metres (1 to 3 m) under one SKU, so each length is a stock offer keyed `<SKU>.<length>` with `sku` | §3.2 keys offers by SKU and gives each stock length its own offer; one SKU in three lengths needs both |
| 9 | Fasteners take `fits` (the systems whose grooves a T-nut or hammer screw fits) and `dims` (published dimensions under the standard's letters) | A hammer screw "Canal 8 – Base 30 e 40" fits two systems, which one `groove` cannot say; washers and nuts publish their dimensions |
| 10 | A groove type may give `taper_from_mm` and `bottom_mm` (both or neither): the chamber keeps the undercut width to `taper_from_mm`, then narrows to `bottom_mm` at `depth_mm`. The tslot generator builds convex pieces (mouth, chamber, taper) and checks overlap by separating axes | The 40-series chamber is 22 mm wide: run square to its 10 mm depth it crosses the neighbouring grooves' at every corner of a 40x40, so M1's generator refused the real groove |

## The Forseti importer

| # | Decision | Why |
|---|---|---|
| 11 | Python with PyMuPDF and the standard library, run as `python3 -I`; every judgement in one reviewed file, `tables.py` | §11; the brief |
| 12 | The PDF is pinned by SHA-256 and its read date lives beside the hash; a different file is refused | The page tables hold for one file only |
| 13 | A snapshot is a folder: the API pages, the profiles' product pages and a manifest with every request and the read date. The read date of every shop fact is the manifest's | A build is a pure function of its inputs, so it is byte-for-byte repeatable (tested when the inputs are present) |
| 14 | **The catalogue's IX is about the axis along the long side (the weak axis), IY about the other, whatever the drawing's orientation.** Sections stand tall (x = first number of "AxB"), so IX goes to `Iy_mm4` and IY to `Ix_mm4` | Measured on the five rectangular vector outlines (20x60 drawn standing; 30x60, 45x90 and 45x90 econômico lying) and consistent with every rectangle on pp. 10–21. The survey's "labels swapped" reading of the 40x80 (p. 17) was wrong and is corrected in `docs/research/forseti-inventory.md` §7 |
| 15 | Item ids are the SKU stems: the pack tail `-<n>` is dropped when `Unidades` is n, and a rail's length tail when it matches `Comprimento` (the 1000 mm rails carry none). Size attributes make items, `Unidades` packs, `Comprimento` stock offers | §11 |
| 16 | `sale_minor` is null when the sale price is not below the regular one | The shop repeats the regular price as the sale price when there is no sale |
| 17 | Kits: quantities in units ("10 unidades"); a line's code is a pack SKU, resolved by the rule of #15 even when that pack is not on sale (PAM408-20-10). One line names no code and is resolved in the table (CT100-788-K4080's spring washer). The main item, listed first (§3.2), is the one the kit's SKU names (`<item>-K<base>`), wherever the description lists it | The shop lists kit contents by pack SKU, and CT100-888-K4590 lists its bracket third |
| 18 | Not emitted: PLU40-01-K (the "with fixings" variant does not say which), PLU40-01-PP-K (price 0), and 16 profile stems without a reviewed page entry; the build lists them | M2b |
| 19 | Groove types are measured on one exact outline each, along the groove's centre line, `src: calc`, and the build fails if the opening is more than 0.15 mm from the printed one. c8-40 measures 8.18 / 3.79 / 9.99 / 22.01 against 8.19 / 3.81 / 10 / 22 printed | One correction per groove type (§3.3); the drawings are the most precise source |
| 20 | The 45x90 econômico (PF45-12, "Canal Sextavado M8", 8.3 mm) is its own system, `s45-c8`, with groove type `c8-45` | Its slot takes M8 hex heads, not the 45 series' canal 10 |
| 21 | Parametric sections (PF40-02, PF40-03B, PF40-04) are T-slot envelopes from the printed size, core bore 13.7 and the series' measured groove, `props_ok: false`; one groove per series cell on each face | Their pages draw raster images (survey §4); the published A and I stay the authority |

## Overrides and accepted mismatches (`catalogs/forseti/overrides.json`)

| # | Item, field | Correction | Why |
|---|---|---|---|
| 22 | PF40-02 `Ix_mm4` | 65 500 → 655 000 | p. 17 prints IY 6,55 cm⁴, below the weak axis's 17,76: a lost digit. 65,5 gives a radius of gyration of 0.32 of the height, as the 30x60 (0.326), 45x90 (0.314) and 80x80 (0.333) have |
| 23 | PF30-04 `mass_kg_per_m` | 0.816 → 0.894 | the printed area (3,31 cm²) is confirmed by the outline (331.3 mm²); × 2700 kg/m³ |
| 24 | PF40-04 `mass_kg_per_m` | 1.625 → 1.596 | 1,625 is the 45x45 básico's mass (6,02 cm²), copied; 5,91 cm² × 2700 |
| 25 | PF40-03B `mass_kg_per_m` | 4.547 → 4.655 | 17,24 cm² × 2700; treated as #24 for consistency (the area is the authority of a parametric section), though no copied value explains it |
| 26 | ALM-3 `dims/d1_mm` | 8.4 → 3.3 | the shop gives the M3 washer the M8's bore; catalogue p. 53 gives 3,3 |
| 27 | PF20-14 area, Ix, mass; PF40-00 area, Ix, Iy, mass | accepted | the vector outlines differ from the printed tables by 2.7–3.7 %, while each table's area and mass agree with each other. Drawing and table cannot both be right and neither can be preferred |

## Families (layer 2)

| # | Decision | Why |
|---|---|---|
| 28 | Forseti's rails and blocks get their own systems, `forseti:rail-hg15` … `rail-hg30`, and `clone_of` HIWIN's parts; their geometry (section, pitch, hole, block size, bbox, datums) is HIWIN's copied as `est` | The shop sells them under HIWIN's names and publishes no dimensions. A clone fitting the original's blocks is not claimed, so the systems are not shared |
| 29 | Rails' `E_min_mm` is an estimate: the counterbore's diameter D (low D/2 + 1, high the standard Es 20). `E_max_mm` is half the pitch | HIWIN publishes no minimum; it recommends "no greater than 1/2 of the pitch" (G99TE24-2410, PDF p. 40) |
| 30 | With those, the centred estimate leaves three stock lengths outside the range (HG25 at 500 and 2000, E 40 > 30; HG30 at 500, E 50 > 40): `catalog check` warns | A 500 mm HG25 cannot be drilled centred within HIWIN's recommendation; the seller's real factory E should be asked for |
| 31 | Brackets (pp. 34–35): frame origin at the heel, x along the base leg, z up the standing leg, `mount` at the heel; holes F at 35 and 90 from the heel on each leg, one row (4x) or two A apart (8x). The frame follows the base leg; the standing leg's mount faces −x | The drawings; the 2.1 part frame (+z away from the mounting face, +x along the bar), which §3.2 states for one mounting face only |
| 32 | Each bracket's fastener set per system is one of each line of the shop's kit for that base, per hole (hammer screw, nut, plain and spring washer). The single-base brackets' systems follow the kits' names (CT100-286: base 30; CT100-388: 40 and 45), since p. 34 lists bases 30 to 50 for both | The kits are the only source; both readings are said in the family's note |
| 33 | PLU40-01: 80 x 30 x 2.5, two slots 7 wide, 40 apart, 10 long (3 of travel), lying across two base 40 bars, so the bars run along its x; no fastener set | p. 29; the shop states no fixings |
| 34 | T-nuts and hammer screws fit the systems their names give; a `groove` only where the name gives one series. Socket screws get no `head` standard, nuts no class, T-nuts no rating | Not published |
| 35 | Blocks' payload mounting holes are not modelled | The carriage schema has no `mounts`; their thread is in the block's provenance note |

## `ref-hiwin` and `std`

| # | Decision | Why |
|---|---|---|
| 36 | `ref-hiwin` cites HIWIN catalogue G99TE24-2410 by PDF page (three ahead of the printed numbers); ratings converted to N and N·m; C on the 50 km basis; seal resistance per end seal; μ 0.004 ("about"); no `preload_class` | The class is a property of the block as ordered, not of the size |
| 37 | Blocks' frame: origin at `run` on the rail's running face, z up; `bbox_mm` from H1 − HR to H − HR; a second datum `top` on the mounting face | §3.4 *2.1* |
| 38 | `std`: RHS 200x100x6.3 meets EN 10219-2's table within 0.2 % with EN radii; the 4.75 wall (a 3/16" size, not EN) carries only its computed mass; the 3"x1/4" angle's radii are estimates, so its AISC and mill values sit in a note, not in compared fields | Published values that cannot agree are not claimed |
| 39 | `std`: DIN 975 rods' tabulated mass follows the pitch-diameter area, the section the stress area, so the mass mismatch (9–10 %) is accepted | Both are right for their use |
| 40 | `std`: the M12 hex screws keep the ids `ISO4017-M12x140-8.8` and `-x230-8.8` but take the head and thread length from ISO 4014; 230 is not a preferred length | ISO 4017 is fully threaded; the lengths are what the design calls for |
| 41 | `std:anchor-M10-wedge` has thread and kind only | Its ratings come from the chosen product's European Technical Assessment |

## Found in the data, not acted on

| # | What |
|---|---|
| 42 | Catalogue p. 20 prints PF50-01's table with PF45-12's values (8,82 cm², 17,98, 74,45, 2,383) |
| 43 | Catalogue p. 53 lists PSM-12 as a W1/2" nut (3/4" across flats); the shop sells PSM-12 as M12 (s 19) |
| 44 | Shop and catalogue washers differ slightly (ALM-8: 8,4 x 17 in the shop, 8,6 x 17 on p. 53) |
| 45 | The shop's shipping masses for rails do not scale with length (HG30 at 2000 and 3000 mm both 1.16 kg) |

## Open

- The families have had one independent read against the sources (each file's `review`), which raised the kit main item (#17), the per-hole count (#6a), the single-base fits (#32) and a hammer screw's groove (#34); a reader with the physical parts would settle #31–#33.
- `std`'s table and clause numbers (e.g. "ASTM A36, Table 2", "EN 10025-2, Table 7") were written from recall, not read off the standards; the values agree with the standards as commonly tabulated, the table numbers want a check.
- `std:DIN7349-8` carries only its bore: the outer diameter and thickness could not be settled from a citable table.
- The supplier catalogs that hold only offers (steel, tube and fastener suppliers) and a project-local catalog are not part of M2a.
