# Forseti inventory: what they publish, and in what form

Surveyed 2026-11-26. Labels: *measured* = I ran it and have the output; *read* = taken from a page, document or file; *inferred* = my reasoning, not checked against a source.
Raw dumps and scripts (gitignored) are in `.cache/forseti/`: `raw/store/` (Store API JSON), `raw/site/` (PDFs, HTML, robots), `scripts/`, `out/inventory.csv` (1,493 rows: 495 products + 998 variations, with my kind and family), `out/pf40-01_section.json` (the extracted outline).
Method: GET only, about 1 request per 1.1 s, about 45 requests in all, no cart or checkout endpoints, no image downloads.

## 1. Inventory

### Completeness (measured)

| Item | Result |
|---|---|
| Products | 495 returned by `products?per_page=100&page=1..5` (100+100+100+100+95); X-WP-Total = 495; 495 unique ids; 495 unique SKUs |
| Categories | 34 (`products/categories`) |
| Variations | The product objects list only variation ids and attributes (no SKU, price or stock). `products?type=variation&per_page=100` (10 pages) returns full variation items: 998 unique ids; X-WP-Total = 998 |
| Variable products | 289 `variable`, 206 `simple`. 297 products actually have variations: 8 products typed `simple` have some, and 8 variation ids are missing from the parents' `variations` arrays, so the parents' lists undercount (990 listed, 998 real) |
| Orderable SKUs | 198 products without variations + 998 variations = 1,196 |
| Duplicates | None by id or SKU. "Promoções", "Promo Perfis", "Saldos", "Kits" only re-tag the same ids: 331 products carry 2 or more categories, 107 sit in a promo or sale category. 5 pairs share a name but not a SKU (kit variants, T and L shoes) |
| Brand | `Marca` attribute: Forseti 424, TECMAF 44, Atividade Maker 7 (the Voron and Revolution kits and the CNC and plasma table) |
| Gotcha | The variation endpoint paginates unstably: my first probe page repeated 100 ids that also appear in page 1 of the full run. Dedupe by id; the totals reconcile (998) |
| Not in the API | Menu items "Cockpits" and "Inspire-se" (a gallery of 786 customer projects, photos only). Neither is in the 34 categories |

### Counts by kind (measured counts; kind assignment is mine: category first, then name keywords for the generic categories)

| Kind | Products | Variations | Families (products) |
|---|---|---|---|
| Profile (linear stock) | 46 | 2 | see profile table below |
| Connector or bracket | 84 | 134 | cantoneiras 39, placas (L/T/X/união/ângulo/regulagem) 23, conectores (pino, universal, fresado, articulado) 20, junta articulada and fecho 2 |
| Fastener | 65 | 272 | parafusos 29, porcas 20, placa roscada 6, arruelas 5, rebites and chumbador 5 |
| Linear motion | 130 | 343 | fuso and castanha and mancal 34+, correia/polia/pinhão/engrenagem/redutor/acoplamento 25+, roldana and chapa guia V-slot 21, eixo linear and rolamento and bucha and suporte 20, guia linear HGR/MGN with patins HGH/HGW/MGN-H 12, atuador and flow-rack and deslizante 9 (the sub-family split is approximate; the 34 Tecmaf linear-motion items are included) |
| Accessory | 75 | 155 | dobradiça 27, acabamento (capas, tampas, tiras, batentes, ponteiras) 15, rodízio 8, sapata and suporte 7, pé nivelador 5, manípulo and fecho 4, bucha 4, other 5 |
| Electronics | 34 | 10 | motor de passo, driver, shield, Arduino, inversor WEG, fonte, relé, módulos, cabos |
| Cable chain (esteira porta cabos) | 13 | 6 | nylon chains by internal size (18x50, 18x37, 35x50, 15x40, 25x57) |
| Panel (chapas e telas) | 10 | 54 | policarbonato, ACM, MDF, chapa inox, xadrez, tela soldada |
| Tools | 11 | 20 | machos, brocas, fresas, chaves Allen, desandador, alavanca |
| Kit | 12 | 2 | Voron Trident and Legacy frames, Revolution 3D and CNC kits, DIN rail |
| Special project | 15 | 0 | bancadas, estantes, flow-rack, suporte TV, mesa de tupia, router CNC frame. Finished goods priced R$ 887 to 4,990 |
| **Total** | **495** | **998** | |

Cantoneira kits and dobradiça kits (the "Kits" category) are counted under connector and accessory, not under Kit.

**Tecmaf** (measured): 44 products, a separate brand line. SKU pattern `TMA-…-XXXX` (parametric, one parent with many variations) or `TEC-nnn` (simple). Contents: ball screws and nuts, BK/BF bearing pairs, pillow blocks, linear bearings, HGH/HGW carriages ("patins"), spur and helical gears (modules 1 to 4), planetary reducers, jaw couplings (all linear motion or drivetrain, 34) and WEG CFW300/500 inverters (10). None of it overlaps the profile or hardware SKU scheme. Its descriptions are the only ones that give load ratings (ball nut dynamic 583 and 765 kgf, static 1,129 and 1,240 kgf; read).

### Profile families (measured from names and SKUs; 46 products = 25 SKU stems x finish; anodizado fosco 29, pintura preta 17)

| Series | SKU stems and what they are | Slot (name) |
|---|---|---|
| 20 | PF20-11 20x20 V-slot (plus PF20-11F "de face" and PF20-11C "de canto"), PF20-21 20x20 T-slot, PF20-12 20x40 V, PF20-14 20x60 V, PF20-15 40x40 V, PF20-13 40x80 C-Beam V | Canal 6 |
| 30 | PF30-01 30x30 básico (plus 01F face, 01C canto, 01R abaulado), PF30-11 centro M8, PF30-04 fechado destacável, PF30-02 30x60 | Canal 8 (the "Especial 8" is the face and canto variants) |
| 40 | PF40-00 40x40 leve, PF40-01 básico, PF40-11 centro M8, PF40-04 fechado destacável, PF40-02 40x80, PF40-03 80x80 reforçado, PF40-03B 80x80 básico | Canal 8 |
| 45 | PF45-01 45x45 básico, PF45-02 45x90, PF45-11 45x45 "parafuso" (catalogue: econômico), PF45-12 45x90 "parafuso" | Canal 10; the 11 and 12 parafuso profiles: "Canal 8" and "Canal Sextavado M8" |
| 50 | PF50-01 50x50 básico | Canal 8 |
| other | TVS01-01 V-slot rail for W roller, PFT30-01 T-Track base 30 | Canal 4 |

Slot names in the shop (6/8/10) are the slot opening class. The catalogue drawing for the 40x40 gives 8.19 mm (read), consistent with "Canal 8". The "-c7", "-c10" and "-C9" tail of the SKU is not a slot number (40x40 is Canal 8 with c7, 30x30 Canal 8 with c10), so do not parse it. `-pp` marks pintura preta.
Products listed in the catalogue but absent from the shop: 15x15 (p. 10); 80x80 shows as 1 m "reforçado" and "básico" in the shop.

## 2. Data per kind in the shop (measured)

Common to every product: `sku`, `name` (HTML-escaped; the `×` is a real U+00D7), `prices` (minor units, BRL), `categories`, `images`, `short_description`, `description` (HTML), `weight`, `dimensions`, `is_in_stock`. `attributes` almost always holds only `Marca`.

| Field | Coverage | Reliability |
|---|---|---|
| `weight` (kg) | 393 of 495 products (79%); 99.7% of variations | Reliable as a shipping or unit weight for hardware. Unreliable for profiles (see below) |
| `dimensions` (cm) | 469 of 495 | Packaging, not geometry. A 1,550 mm ball screw reads 1 x 5 x 15; a 40x40 profile reads 1 x 4 x 4 |
| Variation attributes | 297 products | In the parent's `variations[].attributes` as {name, value} (e.g. "Para Eixos: 12mm, Unidades: 2un"). Clean but names are free text per product |
| Description | 100% over 80 chars | Free text; the parseable parts are listed per kind below |

| Kind | Technical fields in description or attributes | Parseability | Examples (real) |
|---|---|---|---|
| Profile | `Peso: 1,482kg/m` (36 of 46), `Comprimento máximo da barra: 3 metros` (11), `Utiliza porca especial: Canal 8` (35), `Centro permite rosca: M16` (41). Size, series, slot and finish in the name. Price per metre | Regex on the template: good. Three weight field/text mismatches (see section 7) | PF40-01-c7 40x40 Básico, R$ 126.50/m, 1.482 kg/m, M16 tap. PF30-02-c10 30x60 R$ 145.50/m, 1.36 kg/m, M14. PF40-03-c7 80x80 reforçado, 5.753 kg/m, R$ 569/m |
| Connector | Kit contents as "Item (code): n unidades", `Para Perfil` attribute (22), `Largura da Cantoneira`, variations Direita/Esquerda. Bracket dimensions are not given, only in the catalogue | Contents lists parse well. Geometry does not | CT75-06-K40-50 "Kit cantoneiras 90° M8 base 40 e 50": 1 bracket + 10 each of PSM-8, PAM408-20, ALM-8, APM-8, 0.4 kg. CN30-01R quick connector: "1 Pino, 1 Bucha, 1 Parafuso e 1 Mola", Allen 6 mm. CBF40-XX-K40 (Direita/Esquerda) |
| Fastener | `Comprimento do Parafuso` (28), `Rosca` (22), `Unidades` (57) as variation attributes; thread and head in the name | Good: variations carry length and pack size | PCI6-XX-XX Allen cilíndrica M6 galv.; PAM408-XX-XX parafuso martelo T canal 8 M8; PSI8 sextavado inox M8 |
| Linear motion | `Tamanho Guia Linear`, `Para Eixos`, `Diâmetro`, `Comprimento`; ball nut loads and C-grade on Tecmaf only; roller and bearing loads on a few (688ZZ: 1,220 N dynamic, 450 N static; axial F8-16M: 2,500 and 3,000 N). HGH and MGN carriages: no load ratings | Variation attributes parse. Ratings are present in only about 5 products | HGHXX-01CA carriage 15/20/25/30 mm (variations HGH25-01CA-1 R$ 102.13). FES1610-01 ball screw 1,550 mm, Ø16 pitch 10, R$ 387.19. TMA-CF-SFUXXXX-3 ball nut |
| Accessory | Compatible profiles as a text list, dobradiça dimensions, `Tamanho do Rodízio`; caster capacity "Capacidade de carga: 50 kg" and "70 kg" in only 2 caster products; no foot or shoe ratings | Compatibility list parses by regex ("30×30 Básico 30×30 Fechado…"); ratings do not exist | DBP40-01-KS nylon hinge 61x50, centres 40 mm, for 40x40, 40x80, 80x80. RGE0x-03 PVC caster, 50 kg and 70 kg options |
| Cable chain | Internal size in the name ("18X50MM INTERNO"), length 1 m | Name regex | EPC1850-03 semi-closed nylon, 0.53 kg |
| Panel | Variation attributes `Tamanho da Chapa` and `Espessura da Chapa` | Good | CHAPA DE POLICARBONATO COMPACTO CRISTAL: 15 variations (3 to 6 mm; 50x50 to 122x122 cm) |
| Electronics, tools, kit, special | Name and short description only; tools carry `Tamanho` | Name only | DRV8825 driver; Voron Trident frame kit VRNTD-300-KFAF |

**SKU patterns** (measured). Parent SKUs are templates with `X` wildcards (HGHXX-01CA, PCI6-XX-XX, SPTXX-01-XXXX); the real SKUs are on the variations (HGH25-01CA-1), and variation SKUs are unique. 198 simple products have concrete SKUs. Profiles: `PF{series}-{type}[F|C|R|B][-pp]-{c#}`. Catalogue codes use the same stems with `X` placeholders.
**Price unit**: the Store API price for a profile (12650) is per metre. The product page (read) sells it cut to length: min 40 mm, max 3000 mm, tolerance +/- 1 mm, 10 mm of cut consumes 1 stock unit, with a services form (hole for connector, thread, mitre cut, parallel hole at X mm). Those service prices and rules are not in the Store API.

## 3. The PDF catalogue

`catalogo_forsetiA4.pdf`: 96 A4 pages, 9.9 MB, InDesign, created 2022-12-12 (measured). The cover reads "CATÁLOGO TÉCNICO 2020", so the title and the file date disagree.

| Pages | Family (read) | What the tables give |
|---|---|---|
| 5 to 8 | About, alloy data, deflection worked examples | 6063 T5, density 2700 kg/m3, E 69,000 N/mm2, hardness 73 HB, anodising 13 to 16 um (p. 6); formulas for cantilever and beam deflection (p. 7 and 8) |
| 10 to 22 | Profiles: 15x15 and 20x20 V-slot (10), 20x40 and 20x60 V (11), 30x30 and 30x60 families (12 to 15), 40x40 leve and básico (16), 40x80 and 40x40 fechado (17), 45x45 and 45x90 (18), 45x45 and 45x90 econômico (19), 80x80 básico (20), 80x80 reforçado (21), manípulo puxador (22) | Per profile: dimensioned section (overall, slot opening, slot depth, centre bore, tap size in brackets e.g. "(M16)"), Ix and Iy in cm4, area in cm2, mass in kg/m. No Wx, Wy, torsion J, radius of gyration, yield or tensile strength |
| 24 to 26 | Connectors: universal, articulated head and body, short pin, pin with thread, countersunk | Dimensional tables A to E, screw sizes |
| 27 to 32 | Plates: L (simple, cut), T, angled 45/60, union 40x40, internal 90 and 135, 3-way, cantoneira interna | Dimension tables; no loads |
| 33 to 35 | Cantoneiras: 20x20x17, 38x38, 75x75x28 (CT75), 100x100 base simples (CT100-286, -388) and dupla (-788, -888) | Dimension tables (A, B, C, F, L, hole size) |
| 38 to 52 | Accessories: caps, channel strips, sliding profile (UHMW), flow-rack track, hinges, tools, plate blocks, levelling feet, angle-adjust plates | Dimension tables; no load ratings |
| 53 to 62 | Fasteners: washers, nuts (hex, flanged, square, half-moon, T-nut slider, spring-ball), hammer screws per slot, Allen screws, rivet nuts, spacers | Dimension tables: thread, length, head sizes. No torque or strength class |
| 63 to 73 | Casters, shoes (T, L, double, corner), parabolt anchor, ball latch | Dimension tables only; no capacity (p. 64: "cargas leves") |
| 74 to 83 | V-slot rollers (W, V, mini), guide plates (CGV02-xx), roller plates, TR8 screw nuts and collars | Dimensions, bearing type (625ZZ) |
| 85 to 91 | Solar: PV profile, clamps, stainless fixings | Dimensions |
| 93 to 95 | Panels: polycarbonate, ACM, checker plate, mesh | Sizes |

Not in the catalogue (measured by text search of all 96 pages): torque, strength class, kgf or N connector load (only "mais de 1000 kg" on p. 20 for the 80x80 as a frame), slip load, or any section modulus, torsion constant, yield or tensile strength. No linear guides, carriages, ball screws, cable chains, electronics or Tecmaf content either. The catalogue covers the profile-and-hardware range only. The user's page guess was slightly off: profiles start p. 10 (not 16), plates are p. 27 to 32, cantoneiras p. 31 to 35.

**SKU match (measured).** Catalogue codes extracted from "COD:" lines: 172. Using the first two hyphen groups, `X` as a wildcard: 100 of 172 have a shop SKU with the same stem. The profile codes match exactly: PF40-01, PF40-00, PF40-02, PF40-04, PF45-01, PF45-02, PF45-11, PF30-02, PF30-04, PF20-11, PF20-12 (shop adds -pp and -c# tails). The 72 misses are mostly catalogue-only items (rollers, casters, solar, mortised connectors) or codes written differently in the shop (CNXX-01-XX versus CNX0-01). In the other direction, 319 of 495 shop products have no catalogue code (linear motion, electronics, kits, cable chains, Tecmaf, and newer connectors and profiles: PF20-15, PF20-13, PF20-21, PF40-11, PF30-11, PF30-01, PF50-01, PF40-03).

## 4. Section geometry: the proof

**Prior work** (read; an internal project, details in the gitignored `internal/reference-project.md`): its section polygons are not extracted from the PDF. They are a parametric T-slot drawing (a box less rectangular slot tools), kept as the record's drawn section. For the 40x40 it records a drawn area of 776 against the datasheet 553 mm2. I recomputed it (measured): A = 776.3 mm2, Ix = Iy = 12.65 cm4, 39 to 40% above the datasheet. Intersection over union with the PDF outline below: 0.35. So the prior polygons are good enough for an envelope, not for section properties.

**Result: the section drawings on these pages are vector paths** (measured, PyMuPDF 1.28 `page.get_drawings()`). On p. 16 the 40x40 básico figure is one black-stroked path of 856 straight line segments (arcs are already flattened), 0.71 pt line width, no curve items. Chaining the segments gives 6 closed loops: the outer contour (slots included), the large centre cell, and 4 corner cells. Nesting by containment gives 1 solid with 5 holes. Calibration: the path's bounding box width is 113.2 pt; set to the known overall size (40 mm) the scale is 0.35334 mm/pt and the height comes out at 40.0004 mm, so the aspect ratio confirms the calibration with no dimension text needed.

| 40x40 básico (PF40-01) | Area mm2 | Ix cm4 | Iy cm4 | kg/m at 2.70 g/cm3 |
|---|---|---|---|---|
| Extracted from PDF p. 16 (measured) | 553.52 | 9.129 | 9.131 | 1.4945 |
| Catalogue p. 16 (read) | 553 | 9.12 | 9.12 | 1.493 |
| Difference | +0.09% | +0.10% | +0.12% | +0.10% |
| Prior work polygon (measured by me from its JSON) | 776.3 | 12.65 | 12.65 | n/a |
| Shop text | n/a | n/a | n/a | 1.482 (0.7% below the catalogue) |

The outline is stroke centreline (about 0.25 mm line width), so the sub-0.2% agreement means the drawing is the section the catalogue values were computed from. Centroid lands at (0.002, -0.007) mm.
Script: `scripts/section_extract.py PDF PAGE auto|INDEX WIDTH_MM [out.json]` (shapely and numpy in the venv). The area and inertia use the shoelace formulas with parallel-axis transfer.

**Does it generalise?** Run on every vector figure I could find (measured, width set to the known overall size):

| Page and profile | Extracted A mm2 | Catalogue A | Extracted Ix, Iy cm4 | Catalogue |
|---|---|---|---|---|
| p. 16 40x40 básico | 553.5 | 553 | 9.129, 9.131 | 9.12 |
| p. 18 45x90 básico | 1,067.5 | 1,067 | 22.99, 85.16 | 23.09, 85.00 |
| p. 19 45x90 econômico | 886.6 | 882 | 18.10, 74.86 | 17.98, 74.45 |
| p. 21 80x80 reforçado | 2,132.3 | 2,131 | 151.65, 151.72 | 151.55 |
| p. 15 30x60 | 503.9 | 504 | 5.167, 19.24 | 5.17, 19.25 |
| p. 14 30x30 fechado | 331.3 | 331 | 3.364, 3.365 | 3.35 |
| p. 16 40x40 leve | 401.8 | 413 | 6.845, 6.847 | 7.08 |
| p. 11 20x60 V-slot | 421.7 | 407 | 14.61, 1.723 | 14.23, 1.71 |

Six of eight agree within about 1%. The 40x40 leve is 2.7% and 3.3% low and the 20x60 is 3.6% and 2.7% high, so either the drawing or the printed values for those two are slightly off. Check those two by hand before relying on them.
Coverage: vector section outlines were found on p. 11, 14, 15, 16 (both), 18, 19 and 21, which is 8 of the roughly 20 profiles in the catalogue. The 40x80 and 40x40 fechado (p. 17) and the 80x80 básico (p. 20) have no outline path: the pages hold only dimension-line strokes plus flate-compressed raster images (inferred from `get_images` and the lack of any large path). p. 10, 12 and 13 hold only small circle and callout paths in my test (inferred raster sections). p. 22 (the round handle) has none. Those need raster tracing, or the IGES route below.
Method issues: it needs a per-figure choice of path (auto-pick works when one black stroke path dominates; p. 14 and p. 18 are filled paths of different colour, so auto-pick must also accept fills); the overall size is taken from the part name rather than parsed from dimension text; loops must be closed (all were).

**Section properties beyond the catalogue.** The polygon gives Wx and Wy and the radius of gyration directly. Torsion J is not printed anywhere, but it can be computed from the same polygon (Saint-Venant solved by a finite-element Poisson solve; not done here, *inferred* as feasible).

## 5. Other sources

| Source | Finding |
|---|---|
| robots.txt, shop (read) | `Disallow` only `/wp-content/uploads/wc-logs/`, `woocommerce_transient_files/`, `woocommerce_uploads/`, `?add-to-cart=`, `/wp-admin/` (allow admin-ajax); Yoast block with `Disallow:` empty; sitemap index at `/sitemap_index.xml` (page, product, product_cat). The Store API path is not disallowed |
| robots.txt, www (read) | `User-agent: *`, `Disallow: /cgi-bin/`, `/wusage`. Redirects to the apex domain `forsetisolucoes.com.br` (307) |
| Terms of use (read, `/termos-de-uso/`) | About purchases for "uso e consumo" versus industrialization (tax treatment) and custom-made products (no cancellation). |
| CAD on the shops | The WordPress media library (public `wp-json/wp/v2/media`) lists three ZIPs. One is `PF30-02zip.zip` (2026-04-23): a 2.5 MB SolidWorks IGES of the 30x60 profile, `PF30-02.IGS`, with an internal path "Biblioteca Servidor PDI\Componentes para perfil\Perfis\PF30-02\4. IGS" (read from the file header; contents not analysed). The other two ("Cockpit-Modificado-SEM-cantoneiras", "Suporte-volante-JP") are project assets, not catalogue parts. No product page or description links to the IGES (grep of all 495 descriptions and two product pages): it is findable only through the media API. It suggests Forseti holds per-profile IGS files internally and has published one |
| CAD on the main site | The home page links to a GrabCAD profile, `grabcad.com/forseti.solucoes-3`. An automated GET returned HTTP 403 from the CDN (measured); I did not try to get around it. Open it by hand to see what models exist and under what licence |
| Other PDFs | `guia-de-servicos.pdf` (56 pages, Canva): machining services (mitre cut from 1 to 60 degrees, thread, holes for connectors, Allen access holes, parallel holes) with drawings, relevant to the planner's machining model. `PPB05-06-001-001-004.pdf`: a one-page SolidWorks 2019 part drawing (low-profile M5 Allen screw), an example of Forseti's per-part drawing format. No linear-motion, Tecmaf or price-list PDF found |
| Not found | No DXF or STEP in the media library (the DXF mime query returned images, so the filter does nothing useful; zip count: 3). Tecmaf has no separate site in what I fetched |

## 6. Gaps for simulation

| Needed | Forseti publishes | Plausible public source |
|---|---|---|
| Torsion constant J, Wx, Wy, radii | No (only A, Ix, Iy, mass) | Compute from the extracted polygon (J by FE Saint-Venant, inferred feasible). Cross-check against a comparable maker, such as the item24 or Bosch Rexroth tables, only where the sections are known to be the same (the 40x40 "padrão Bosch" claim is in the shop text, read) |
| Yield and tensile strength, elongation, Poisson, G, thermal data | Alloy 6063-T5, E 69,000 N/mm2, density 2,700 (p. 6) only | EN 755-2 for 6063 T5 (Rp0.2 110 MPa and Rm 150 MPa minimum for thin sections, quoted from memory: verify against the standard); EN 573-3 for composition. Note the catalogue's own examples use E = 70,000 (see below) |
| Connector, plate and cantoneira load capacity and slip | No | No Forseti source. Compare with items that look like the same design from established makers (Bosch Rexroth, item, Misumi) only where the geometry is demonstrably the same, otherwise test. Ask Forseti engineering |
| T-nut and hammer-screw pull-out and slot-wall strength | No | Same as above; the 80x80 "suporta mais de 1000 kg" is a marketing line (read), not a rating |
| Tightening torques | No | ISO 898-1 property classes and VDI 2230 for the screws; the T-nut or slot limit is a vendor figure to request |
| Joint stiffness (bolted corner, plate, cantoneira, slider) | No | Published research and vendor-independent test data; otherwise test on the bench. Nothing from Forseti |
| Linear guide ratings and preload | No for HGR/HGH and MGN (carriage C and C0 absent); Tecmaf ball nuts yes (C and C0 in kgf) | Forseti names no manufacturer for its HGR/HGH, but the series names match HIWIN's HG family, and "SBR", "LM" and "KFL" are generic. Prior internal work already uses HIWIN's own tables for HGR25 and HGR30 (read); treat Forseti parts as clones whose ratings are not guaranteed to match the original (*inferred*). Rebadged parts: use the original maker's catalogue |
| Caster rating | Only 50 kg and 70 kg on 2 listings; none on the catalogue pages 63 to 67 | Ask Forseti; most are generic Chinese or Brazilian casters (Colson-type). Use the stated figure as the cap |
| Levelling foot and shoe ratings | No | Request; parabolt anchor 3/8 x 2 3/4 loads from the Hilti or Ciser equivalent data sheets only if the part is demonstrably the same (inferred) |
| Cable chain bend radius, step | Internal size only | Request, or the maker (the chain looks like an igus E-chain clone, inferred) |
| Per-profile length rules, machining services and prices | On the product page and the services guide, not in the API | A one-off scrape of the order form's logic, or ask Forseti |

## 7. Inconsistencies found

| # | Where | What | Label |
|---|---|---|---|
| 1 | Catalogue p. 17, 40x80 básico | Prints IX = 17.76 cm4, IY = 6.55 cm4. The strong axis cannot be the smaller value: 65.5 is printed as 6.55, a lost digit. **Corrected 2026-11-26 (M2a):** the labels are *not* swapped. Throughout pp. 10–21 the catalogue gives IX about the axis along the long side (the weak axis) and IY about the other, whichever way the drawing lies; the five rectangular vector outlines confirm it (the 20x60 drawn standing, the 30x60, 45x90 and 45x90 econômico lying). So IX 17.76 is the weak axis as printed, and only IY needs the fix, to 65.5 (radius of gyration 0.32 of the height, as the other rectangles have). Fixed in `catalogs/forseti/overrides.json`; see `docs/notes/m2a-decisions.md` | read the page; the convention *measured* on the outlines; 65.5 *inferred* |
| 2 | Catalogue p. 17, 40x40 fechado | Area 5.91 cm2 with 1.625 kg/m. At 2.70 g/cm3 5.91 cm2 is 1.596 kg/m (1.625 matches the 45x45 básico, area 6.02). Shop PF40-04 says 1.6 | measured arithmetic |
| 3 | Catalogue p. 14, 30x30 fechado | 3.31 cm2 with 0.816 kg/m: 3.31 x 2.70 = 0.894. My extracted area is 331.3 mm2, so the area is right and the mass is off. The shop PF30-04 says 1.2 kg/m (neither) | measured |
| 4 | Catalogue p. 10 | 0.425 kg/m is listed against area 1.64 cm2 (expected 0.443) | measured arithmetic |
| 5 | Catalogue p. 20, 80x80 básico | 4.547 kg/m with 17.24 cm2: 4.655 expected (2.3%); the shop repeats 4.547 | measured arithmetic |
| 6 | Catalogue p. 7 vs p. 16 | The worked example uses I = 9.35 cm4 for the 40x40 básico while p. 16 prints 9.12 (and the extracted outline gives 9.13) | read |
| 7 | Catalogue p. 6 vs p. 7 and 8 | E = 69,000 N/mm2 on p. 6; the example formulas use constants that imply E = 70,000 (0.476 = 1e5/(3 x 70,000), cantilever) | inferred from the constants |
| 8 | Catalogue cover | Title says 2020, PDF creation date is 2022-12-12, and it is called "edition Dec 2022" in the brief | measured |
| 9 | Shop PF40-01 | Description 1.482 kg/m versus catalogue 1.493 (0.7%); the weight field matches the description. PF40-00: 1.120 vs 1.116 | read |
| 10 | Shop PF45-12-PP-C9 | Description and weight field say 2.743 kg/m, the 40x80's mass; its anodised twin PF45-12-C9 has weight field 2.380 (catalogue 2.383) | read |
| 11 | Shop PF45-11-C6 | Weight field 1.625 (the 45x45 básico's) while the catalogue gives 1.458 for the econômico | read |
| 12 | Shop PFT30-01-C4 and TVS01-01-C4 | Description gives 0.530 kg/m but the `weight` field is 0.006 and 0.001 | read |
| 13 | Shop PF20-12-PP | Description 0.809 kg/m, weight field 0.818 | read |
| 14 | Catalogue vs drawing | 40x40 leve and 20x60 V-slot: printed area and Ix differ from the figure by 3 to 4% (see section 4) | measured |
| 15 | Shop structure | Parents' `variations` arrays undercount the variation endpoint (990 vs 998); 8 `simple` products have variations; the shop's category count for Acessórios (226) does not equal the number of products tagged with it (188), likely because the count includes child categories (inferred) | measured |
| 16 | Shop dimensions | The Store API dimensions are packaging, not part geometry (ball screw 1,550 mm reads 1 x 5 x 15) | measured |

## Notes for the importer design (short)

- Profile sections: extract from the PDF vectors where they exist (8 profiles tested, 6 within 1%); fall back to the IGES or a raster trace for the rest. The PF30-02 IGES is a free cross-check.
- Treat catalogue values and my extracted values as the technical truth and the shop's text weights as a hint (items 9 to 13).
- Variations come from `products?type=variation`, deduped by id, not from the parents' arrays.
- Profile price is per metre with min 40 mm, max 3,000 mm, 10 mm steps; machining services are a separate price source not in the API.
