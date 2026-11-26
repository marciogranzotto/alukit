# M2b decisions

*2026-11-26. Calls made while building M2b (the rest of Forseti's catalog) where
[`design.md`](../design.md) §12 and [`m2a-decisions.md`](m2a-decisions.md) are silent, and what the
data turned up. M2b changes no schema.*

## What M2b adds

| Count | |
|---|---|
| Orderable SKUs mapped to an offer | 1,196 of 1,196 (checked by the importer on every build, and by `src/catalog/builtin.test.ts`) |
| Offers | 1,208: the 1,196, plus 4 more stock-length offers of the two 80x80 SKUs (#2) and 8 priced products the shop also gives variations (#3) |
| Items | 1,034: generic 497, fastener 235, accessory 151, connector 100, bar 31, panel 12, carriage 8 |
| Profile stems with a section | 27 of 27: exact 8, parametric 19 (all `props_ok: false`) |

## The orderable set and its test

| # | Decision | Why |
|---|---|---|
| 1 | "Orderable" is the survey's definition: every variation, and every product that has none (198 + 998). `src/catalog/forseti-orderable-skus.json` holds the list (`import_forseti.py skus <snapshot>` prints it); the test checks it against the offers, and, when `FORSETI_SNAPSHOT` is set, against the raw dump's product and variation files | The dump is not in the repository, so the list is, and the test runs everywhere. The build refuses to write when a SKU has no offer or an offer orders a SKU the shop does not list |
| 2 | "Exactly one offer per SKU" holds except for the two 80x80 SKUs (PF40-03-c7, PF40-03B-c7), sold in 1, 2 and 3 m: one stock offer per length (m2a #8). The test requires every offer of a multi-offer SKU to be a stock offer | The M2a schema decision stands |
| 3 | Eight products the shop types `simple` also have variations (CA40-01, CA40-03, CMU02-01, CPT01-01, PF45-02-c8, PFT30-01-C4, PLU40-01-PP, PRP40-01). The shop prices and sells them, so they get offers; they are not on the orderable list, and the test names them | Not emitting a purchasable product would lose it; counting it as required would make the list depend on the shop's typing |
| 4 | Six variations are listed at a price of 0 (CA40-01-00, CA40-03-00, CMU02-01-00, CPT01-01-00, PRP40-01-00, PLU40-01-PP-K): each has an offer whose `regular_minor` is `{ v: 0, note: "listed at a price of 0 by the shop; no real price" }`. A `-00` placeholder variation of a simple product is the same item as its parent | M2a skipped PLU40-01-PP-K; every SKU now maps, and the zero says what it is. PLU40-01-K ("with fixings") is an offer of PLU40-01 with no contents, for the same reason (the shop does not state the fixings) |

## Kinds

| # | Decision | Why |
|---|---|---|
| 5 | Classification is the first matching rule of `KIND_RULES` in `forseti_importer/tables.py` (by name, SKU or shop category); `generic` is everything no rule names: electronics, tools, ball screws and nuts, bearings, linear guides (also Tecmaf's HGH and HGW blocks), pulleys, belts, gears, couplings, rollers, actuators, cable chains, flow-rack rails, finished goods, kits. Each generic item carries a `category` from `CATEGORY_RULES` | §3.4: `generic` takes whatever fits no kind. Cable chains and linear motion have no kind of their own in the schema |
| 6 | A kit the M2a table does not name (the cantoneira kits, rail-and-blocks kits, the Voron and Revolution kits) is one generic item sold as one offer, with no `kit` contents | The shop's contents lines are free text, and a kit is sold in several packs. A kit is claimed only where every line resolves to an item (M2a's five) |
| 7 | A **connector** needs the systems it fits. They are read from the name or, first, the variation's `Para Perfil` attribute: bases ("Base 30, 40 e 45"), profile sizes ("Perfil 20×20") or a slot class ("Canal 8" names every system of that class); 45 is the básico (canal 10) unless the text says parafuso or econômico; 80x80 is base 40. A connector with none (the CFF20 limit-switch plate) is kept as generic. **Every new connector says in its provenance that it has no mounting model yet**: no frame, mounts or fastener sets. A test checks it | Hand-modelled mounting is a later task. No geometry is invented |
| 8 | T-nuts and hammer screws get `fits` the same way and a `groove` only when exactly one system fits (m2a #34). Fasteners get `thread` and `length_mm` where the attributes or name give them; no head standard, class or dimensions | Not published |
| 9 | Sheets (`Chapas e Telas`) are **panels**: one item per thickness (read from the attribute, else the name), the sheet size an offer option (`options.size`); the item lists its sizes. Wire mesh is generic | §3.4: "sheet sizes are offers". The panel kind has no mass; the shop's weights are shipping weights |
| 10 | Variations that differ only by pack are one item with pack offers (m2a #15, also `…-4-K45B` and `…-24-K45B`); variations of one parent that differ in any other attribute are separate items, whatever their SKU stems | CT38-11's two variants share a stem and are different parts |
| 11 | `mass_kg` is not set on generic items. The shop's `weight` is kept as the offer's `ship_mass_kg` | The shop's weights are shipping weights and are not even stable across a size series (ball screws of 500 and 3000 mm both read 1 kg). Where a description states a mass it is not parsed: its units vary |
| 12 | Dimensions of generic and accessory items (`dims`) come only from variation attributes that start with a number of mm (diameter, length, pitch, bore, shaft diameter, width, guide size) | Published, not derived |
| 13 | Attributes in inches, with an `n°` or a W thread are kept as text in the item's name, not turned into numbers | No single unit rule |

## Profiles

| # | Decision | Why |
|---|---|---|
| 14 | All 16 remaining stems get a **parametric** T-slot envelope with `props_ok: false`: the printed size, the bore from the drawing (or the shop's text), the series' measured groove, one groove per series cell on every face. The area, I and mass are the catalogue's tables where one is usable | None of their pages draws a vector outline (survey §4). Cut lengths need only the bounding box (§3.5) |
| 15 | What each envelope leaves out is in the section's `from.note`: the C-Beam's open channel (PF20-13), the closed faces of the face and corner variants (PF30-01F, PF30-01C), the rounded corners (PF30-01R), the hollow centre of the 40x40 V-slot (PF20-15). The bores of PF20-13 are read off the drawing (four along the bottom, one in each ear) | Approximate shapes are declared, not hidden |
| 16 | PF20-21 (20x20 T-slot, shop mass 0,344) takes the table of PF20-01 on p. 10 (0,344 kg/m) | The shop's code and the catalogue's differ; the 20x20 T-slot is drawn there |
| 17 | PF20-11C, PF20-11F, PF20-15 and PF40-11 are not in the catalogue, PF50-01's table is a copy of PF45-12's (survey §7 #42). They keep no area or I. Their mass is the shop description's "Peso: x kg/m", `src` with a note, or none (PF20-11C and F state none: the build lists them) | The shop's `weight` field is not a mass per metre (m2a, survey §7 #11–12) |
| 18 | New system `s50-c8` (base 50, canal 8) for the 50x50, with the groove type of base 40, `c8-40`, said in the system's name. The shop says it uses canal 8 fixings and mixes with base 40 and 45; no source gives the groove's own dimensions. Connectors and nuts for base 50 now fit it | The 50x50 section needs a groove type; the assumption is visible and the section is approximate. M2a's families left base 50 without a system, and they still do |
| 19 | PF45-11's product page states no price step (every other cut-to-length page says "Cada 10mm de corte consome 1 unidade"): the table gives 10 mm, and the build says so | The calculator on the page is the same |
| 20 | PF45-02-PP and PFT30-01-2000 are variations of simple products. PF45-02-PP is a second SKU of the black 45x90 and sells by the parent's cut rule; PFT30-01 (T-Track) and the V-slot rail TVS01-01 are not `PF<series>` stems, have no published section dimensions and are generic | A section needs dimensions the shop does not give |

## Inconsistencies found

| # | What | Acted on |
|---|---|---|
| 21 | Catalogue p. 10: PF20-11 prints 0,425 kg/m for 1,64 cm² (0.443 at 2700 kg/m³); the shop's description says 0,409 | Accepted in `overrides.json` with the reason; the printed value stands |
| 22 | The other printed masses of the new profiles agree with area × 2700 within 1.5 % (PF30-04, PF40-04 and PF40-03B are M2a's overrides) | The build reports any that do not |
| 23 | Shop weights of profile products do not match their descriptions in several places (survey §7 #9–13): not used | — |
| 24 | PF50-01 (p. 20) carries PF45-12's table | Not used: the 50x50 has no area or I |
| 25 | The 6 zero prices and the 8 priced products with variations (#3, #4) | Each offer says so |

## Open

- The `generic` classification is by name rules; the 10 `other` items (zip ties, flow-rack end caps, DIN rail, T-Track, V-slot rail) and the 76 `kit` items are the ones a reader may want to split.
- No kit contents beyond M2a's five are modelled. The rail-and-blocks kits (HG15 to HG30) could be kits of M2a's rails and blocks once a kit line can name a rail length.
- Tecmaf's HGH and HGW blocks (`TMA-PSA-HGH-XXCA`, `TMA-PCA-HGW-XXCC`) are generic; they could be carriages `clone_of` ref-hiwin, which is layer 2 work.
- The coverage of `fits` for accessories is by name only; hinges and caps whose names give no profile have none.
