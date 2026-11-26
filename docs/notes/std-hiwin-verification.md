# Verification of the `std` and `ref-hiwin` catalogs

*2026-11-26. Every number and citation in `catalogs/std/` and `catalogs/ref-hiwin/` was compared with a
public source. Status: **verified** (value agrees with a source), **corrected** (value or citation
changed), **unverifiable** (no source reachable; value kept, citation or value flagged in the catalog).
The standards themselves (ISO, EN, DIN, ASTM, AISC) are paywalled and were not read; for them the
sources are manufacturers' and distributors' tables that reproduce the standard, so "verified" there
means "agrees with a table that cites the standard".*

## Sources

- **HIWIN-TW**: HIWIN catalogue G99TE24-2410, HG series section, printed pp. 22-43 (PDF pp. 25-46 in the
  catalogue the items cite): <https://s3.amazonaws.com/www.motionusa.com/hiwin/2025/HG%20Series_2025.pdf>
- **HIWIN-DE**: HIWIN GmbH, GW-11-7-EN-2401-K (HG/QH series, 2024), printed pp. 36-43, as reproduced in
  <https://www.albeco.com.pl/pl/katalog/preview/hiwin-linear-guideways-accessories.pdf>
- **HIWIN-13**: HIWIN G99TE17-1303 (2013), <https://www.hellopro.fr//documentation/pdf_prod/2/5/9/473293_446e09869253aa3816c86a183a0c5cc6_4062952.pdf>
- **TATA**: S275J0H data sheet, <https://products.tatasteelnederland.com/sites/producttsn/files/ts-ds-forcon-275-en.pdf>
- **RHS**: cold-formed RHS tables, <https://crosssections.app/en/rhs_cf/rhs-200x100-6_3>, <https://civilaxis.com/steel-catalogue/reference/continental-rhs-cf>
- **DIN-TOC**: table of contents of DIN EN 10219-2:2006-07, <https://www.din.de/de/mitwirken/normenausschuesse/fes/veroeffentlichungen/wdc-beuth:din21:85652367/toc-9770150/download>
- **ASPEN**: distributor data sheets for DIN 975, 912, 985, 127, 7349 (<https://www.aspenfasteners.com/content/pdf/Metric_DIN_975_spec.pdf> and the same path with `Metric_DIN_912_spec.pdf` etc.)
- **WESTFIELD**: <https://westfieldfasteners.co.uk/Standards/Washer-FormA-M.html> (DIN 125 A = ISO 7089 dimensions)
- **FASTEN.IT**: <https://fasten.it/norms/norm/din_en_iso_4762>, <https://fasten.it/norms/norm/din_en_iso_4032>
- **BOELLHOFF/WESTFIELD** ISO 4014 tables (via search); **OPTIMAS** and **Engineering ToolBox** ISO 898-1 stress-area tables; **FASTENAL** ISO 898-1 summary
  <https://crafter.fastenal.com/static-assets/pdfs/Mechanical_Properties_of_Metric_Fasteners.pdf>
- **ASTM A36/A36M-12, -14** sample pages (iTeh); **EN 1991-1-1 Table A.4** via Steel Buildings in Europe and a design-properties page.

## `ref-hiwin`

All four sizes (15, 20, 25, 30) agree, for HGH-CA and HGW-CC blocks and HGR-R rails, with HIWIN-TW and
HIWIN-DE unless a row says otherwise. The catalogue's own page numbers (p. 38 seal, p. 40 rail lengths,
p. 41 and p. 45 tables) match the printed page + 3 rule and were re-derived from the extract.

| Item | Field | Old | New | Source | Status |
|---|---|---|---|---|---|
| HGH15/20/25/30CA | H, H1, N, W, B, B1, C, L1, L, K1, K2, G, T, H2, H3, thread | as listed | unchanged | HIWIN-TW p. 41; HIWIN-DE Table 3.6 | verified |
| HGW15/20/25/30CC | same fields plus T1, T2 | as listed | unchanged | HIWIN-TW p. 45; HIWIN-DE Table 3.8 | verified (T2 of HGW15CC is 6.95 in HIWIN-TW, 7.0 in HIWIN-DE; kept 6.95, the cited edition) |
| all blocks | mass_kg | 0.18/0.30/0.51/0.88 (HGH), 0.17/0.40/0.59/1.09 (HGW) | unchanged | both | verified |
| all blocks | C_N, C0_N | 14 700/27 100/34 900/48 500; 23 470/36 680/52 820/71 870 | unchanged | HIWIN-TW, HIWIN-DE | verified |
| all blocks | C_basis_km 50 | 50 | unchanged | HIWIN-DE Table 3.4, "50,000 m" | verified (the cited p. 6 itself was not in the extract) |
| all blocks | MR_Nm | 120/270/420/660 | unchanged | HIWIN-TW, HIWIN-DE | verified |
| all blocks | MP_Nm, MY_Nm | 140/280/490/700 | unchanged, now with a note | HIWIN-TW p. 41 prints 0.14/0.28/0.49/0.70 kN m; HIWIN-DE Table 3.4 (and HIWIN-13) print 100/200/330/530 N m | verified against the cited edition; **the editions disagree** (lower value is conservative) |
| all blocks | seal_N | 2.35/2.75/3.14/3.53 | unchanged | HIWIN-TW Table 2-1-21 (printed p. 35, cited p. 38). HIWIN-13 Table 2-1-20 prints 1.18/1.57/1.96/2.65 | verified; older edition differs |
| all blocks | mu 0.004 | 0.004 | unchanged | HIWIN-DE 2.6.1 "about 0.004" | verified |
| HGR15/20/25/30R | WR, HR, D, h, d, P, mass | as listed | unchanged | HIWIN-TW, HIWIN-DE Table 3.9 | verified |
| HGR15/20/25/30R | E_max_mm 30/30/30/40 | half the pitch | unchanged | HIWIN-TW p. 37 (cited p. 40), "no greater than 1/2 of the pitch" | verified |
| HGR15/20/25/30R | standard end distance Es 20 | 20 | unchanged | HIWIN-TW Table 2-1-27 | verified |
| HGR15/20/25/30R | E_min_mm | 7.5/9.5/11/14, `est` | 6/7/8/9, `src` | HIWIN-DE Table 3.9, "E1/2 min" | **corrected** (HIWIN publishes it) |
| sections HGR15-30 | w_mm, h_mm | 15x15, 20x17.5, 23x22, 28x26 | unchanged | Table 3.9 | verified |

Not checked against a primary page: the HIWIN-TW pages for C_basis (p. 6) and mu (p. 12) are outside the
extract; their values agree with HIWIN-DE.

## `std` materials

| Item | Field | Old | New | Source | Status |
|---|---|---|---|---|---|
| A36 | Rp02 250, Rm 400-550 | Table 2 | Table 2 in the -12 and -14 editions (Table 3 in older ones) | ASTM A36/A36M-12, -14 | verified |
| A36 | E 200 000, density 7850 | AISC 360; A6/A6M | citations kept, flagged | not reachable | unverifiable (citation); values are the customary ones |
| S275 | E, G, nu, alpha | EN 1993-1-1, 3.2.6 | unchanged (G = 80 769 rounded to 81 000, noted) | design-properties pages | verified |
| S275, E235, 8.8, 12.9 | density 7850 | "EN 1993-1-1, Annex A / EN 1991-1-1, Table A.4" | "EN 1991-1-1, Annex A, Table A.4 (77.0-78.5 kN/m3)"; EN 1993-1-1 has no density | secondary pages | **corrected** (citation) |
| S275 | Rp02 275, Rm 410-560 | EN 10025-2 Tables 7, 8; EN 10219-1 Table A.3 | unchanged; 10219-1 range stated (3-40 mm; 430-580 below 3 mm) | TATA | verified |
| steel-8.8 | Rp02 640, Rm 800 | ISO 898-1 Table 3 | unchanged | FASTENAL, ISO 898-1 snippets | verified |
| steel-12.9 | Rp02 1100, Rm 1220 | ISO 898-1 Table 3 | unchanged | FASTENAL | verified |
| E235 | E 210 000 | EN 1993-1-1 | unchanged | | verified |
| EPDM | density 1240 (1130-1350) | `est` | unchanged | | stays `est` |

## `std` items

| Item | Field | Old | New | Source | Status |
|---|---|---|---|---|---|
| RHS-200x100x6.3 | mass 27.4, A 3480, Ix 1739 cm4, Iy 591 cm4, radii 2.5 T / 1.5 T | "EN 10219-2:2006, Table C.3" | values unchanged; citation "Annex C, RHS table, number not confirmed" | RHS, DIN-TOC (Annex C is the normative table annex) | verified values; **corrected** citation. The hot-finished EN 10210 values differ (28.1 kg/m, Ix 1829) |
| RHS-200x100x4.75 | mass 21.21 (calc) | | unchanged; area 2701.6 mm2 recomputed | arithmetic | verified |
| TUBE-16x3 | mass 0.9618 | EN 10305-1 | unchanged | pi t (D-t) rho; 0.96 kg/m in supplier lists | verified |
| FB-101.6x12.7, FB-50.8x9.52 | mass 10.13, 3.796 | calc | unchanged (3/8 in is 9.525, name keeps 9.52) | arithmetic | verified |
| L-76.2x6.35 | A 929, 7.29 kg/m | AISC Table 1-7 | note extended | distributor table of AISC shapes | verified for A, mass; Ix is 1.24 in4 there (note says 1.23), k, table number and the mill's Ix 50.00 cm4 **unverifiable** |
| DIN975-M8/M10/M12 | As 36.6/58.0/84.3 | "ISO 898-1, Table (stress area As)" | clause reworded, table number not confirmed | OPTIMAS, Engineering ToolBox | verified values; citation unverifiable |
| DIN975-M8, M12 | mass 0.319, 0.725 | "DIN 975, mass table" | ref names the data sheet; DIN 975 is withdrawn (DIN 976-1) | ASPEN | verified |
| ISO4762-M8x25 | dk 13, k 8, s 6 | ISO 4762:2004, Table 1 | unchanged | FASTEN.IT (06-2004 edition), distributors | verified (table number unverifiable) |
| ISO4762-M8x25 | mass 0.015 | `est` | `src` (DIN 912: 15.0 kg per 1000) | ASPEN | **corrected** (provenance) |
| ISO4017-M12x140/230 | s 18, k 7.5, b 36 / 49 | ISO 4014:2011, Table 1 | unchanged | ISO 4014 tables (b = 30/36/49 by length) | verified (table number unverifiable) |
| ISO4032-M8 | s 13, m 6.8 | ISO 4032:2012 | unchanged | FASTEN.IT | verified |
| DIN985-M8 | s 13, h 8 | DIN 985 | unchanged | ASPEN | verified |
| ISO7089-8, -12 | d1, d2, h | ISO 7089:2000 | unchanged | WESTFIELD (DIN 125 A, same dimensions) | verified. ASPEN prints 17 for size 8 and 12.5 for size 6; the other tables print 16 and 12 |
| DIN7349-8 | d1 8.4 | d2, s not entered | d2 21, s 4 added | ASPEN (single source) | verified for d1; d2, s from one source |
| DIN127B-8 | d1 8.1-8.5, d2 14.8, s 2 | DIN 127:1987 | unchanged | ASPEN | verified |
| anchor-M10-wedge | thread only | | unchanged | | n/a |

ISO 273 clearance holes appear in the design (`docs/design.md`) but in no catalog item. From a search,
the medium series gives 9 mm for M8 and 13.5 mm for M12; the standard's table was not read (not
verified).

## Counts

By table row (40 data rows; a row can cover several fields or items): 33 start with "verified", 5 carry a
correction (HIWIN `E_min_mm`, the RHS citation, the density citations, ISO 4762 mass provenance, the
DIN 975 and ISO 898-1 clause wording), 3 are unverifiable in part (A36 citations, the angle's k and mill
Ix, standards' table numbers). ISO 273 is in no catalog item.
