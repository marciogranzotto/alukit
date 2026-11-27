# Section cores: every Forseti T-slot section's cores, and a tap's fit

*2026-11-27. After the end-tap check closed a v1 limit
([`v1-limits-closed.md`](v1-limits-closed.md) 16–21), its data turned out incomplete: the parametric
sections listed only their module bores, and the 8 exact ones no core at all. And the check
compared places only, so an M16 at a Ø5 hole passed. The design text follows (§3.5, §5.5, marked
*2.3*; listed in its changelog under "After acceptance run 3"). Labels: **verified** (run, with
how), **read** (from the catalogue's drawings or a document), **inferred**.*

**Golden values.** None moved: every fixture's tap is on a core its thread fits (M8 in TS40's and
TS4080's Ø6.8, M16 in TS80's and TS40C's Ø13.7), no fixture's lock pins a Forseti section, and
the unit suite passes unchanged beside the new tests (**verified**: the suite, and a grep of every
`alukit.lock.json`). So `lock update` and `fmt` had no fixture to run on.

## 1. What each drawing shows

Read from the catalogue's pages 10–21, rendered at 110 and 250 dpi (**read**). Positions are in the
section frame, from the box centre, sections standing tall (a 40x80 is 40 wide); a drawing drawn
lying is turned as the importer turns it. "Exact" sections take their cores from the vector
outline's holes (decision 1); "parametric" ones from the printed dimensions.

| Section | Page | Fidelity | Cores | Source |
|---|---|---|---|---|
| PF20-11 20x20 V | 10 | parametric | (0, 0) Ø5 | "Ø5 (M6)" |
| PF20-11C, PF20-11F | — | parametric | (0, 0) Ø4.6 | not in the catalogue; the shop's "furo central 4,6 mm" |
| PF20-12 20x40 V | 11 | parametric | (0, ±10) Ø5 | "Ø5 (M6)", 20 apart. **Was Ø4.6** (decision 4) |
| PF20-13 40x80C V | 12 | parametric | (10, ±10), (10, ±30), (−10, ±30) Ø4.6 | "Ø4.60" and the 10/30/50/70 grid; unchanged |
| PF20-14 20x60 V | 11 | exact | (0, 0), (0, ±20) Ø4.6 | "Ø4,6 (M5)"; the holes are 16-gons, 4.50 inscribed |
| PF20-15 40x40 V | — | parametric | (0, 0) Ø4.6 | not in the catalogue; the shop; unchanged |
| PF20-21 20x20 | 10 | parametric | (0, 0) Ø6 | PF20-01's drawing, "Ø6"; unchanged |
| PF30-01, -01C, -01F, -01R | 13, 14, 15 | parametric | (0, 0) Ø12.1 | "Ø12,10", "(M14)" on pp. 13 and 15; unchanged |
| PF30-02 30x60 | 15 | exact | (0, ±15) Ø12.1 | "Ø12,1 (M14)". Its four 3 × 3 mm corner cells are square, with no diameter: not cores |
| PF30-04 30x30 enclausurado | 14 | exact | (0, 0) Ø12.1 | "Ø12,10". Four square corner cells and four side pockets: not cores |
| PF30-11 30x30 econômico | 12 | parametric | (0, 0) Ø6.8 | "Ø6,8 M8"; unchanged |
| PF40-00 40x40 leve | 16 | exact | (0, 0) Ø13.7 | "Ø13,70". Its four corner cells are 6.4 mm chamfered squares: not cores |
| PF40-01 40x40 básico | 16 | exact | (0, 0) Ø13.7; (±15.5, ±15.5) Ø5 | "Ø13,70", "Ø5", 31 between the corner holes |
| PF40-02 40x80 básico | 17 | parametric | (0, ±20) Ø13.7; (±15.5, ±35.5) Ø5 | "Ø13,7", "Ø5", 31 across the 40, 4,5 from the long faces. Along the 80 the drawing gives no dimension: the series' 4.5 (decision 3); the raster measures 4.5–4.7 |
| PF40-03 80x80 reforçado | 21 | exact | (±20, ±20) Ø13.7; (±35.5, ±35.5) Ø5 | "Ø13,7", "Ø5". The centre is a cross-shaped channel: no core |
| PF40-03B 80x80 básico | 20 | parametric | (±20, ±20) Ø13.7; (±35.5, ±35.5) Ø5 | "Ø13,7(M16)", "Ø5 (M6)", 4,5 both ways; an open channel at the centre: no core |
| PF40-04 40x40 enclausurado | 17 | parametric | (0, 0) Ø13.7; (±15.5, ±15.5) Ø5 | "Ø13,7", "Ø5", 4,5 both ways |
| PF40-11 40x40 centro M8 | — | parametric | (0, 0) Ø6.8 | not in the catalogue; corner holes not known; unchanged |
| PF45-01 45x45 básico | 18 | parametric | (0, 0) Ø13.7 | "Ø13,7". Corner chambers: not cores; unchanged |
| PF45-02 45x90 básico | 18 | exact | (0, ±22.5) Ø13.7 | "Ø13,7 (M16)". The central chamber and four corner chambers (7.6 inscribed): not cores |
| PF45-11 45x45 econômico | 19 | parametric | (0, 0) Ø6.5 | "Ø6,50"; unchanged |
| PF45-12 45x90 econômico | 19 | exact | (0, ±22.5) Ø6.5 | its drawing prints no diameter: the 45x45 econômico's Ø6,50 above it, the same series; the holes are 19-gons, 6.38–6.40 inscribed |
| PF50-01 50x50 básico | 20 | parametric | (0, 0) Ø13.7 | "Ø13,70 / M16", dimensioned at the centre. **Was none** (decision 5) |

## 2. Decisions

| # | Decision | Why |
|---|---|---|
| 1 | An exact section's cores are the holes of its outline whose inscribed circle, about the hole's centroid, is a bore its page prints, within 0.15 mm; the importer's table gives each printed diameter with the number of holes that have it, and the build fails unless each count is met. The core takes the printed diameter | Geometry alone cannot tell a core from a pocket: a core is a bore with keyways cut into it, and a square cell lies as close to its inscribed circle. Measured (**verified**, a script over the committed outlines): within 5 % of the inscribed radius, PF30-02's 3 × 3 mm cells cover 38–39 % of directions, PF40-01's keyed Ø13.7 core 30 %. The drawing's printed Ø is the vendor saying which holes are cores; the counts make a stray match fail the build. 0.15 mm: the outlines are stroke centre lines and draw round bores as polygons; the farthest, PF45-12's 19-gons, measure 6.378 for Ø6.5 |
| 2 | A core's centre is written on a 0.1 mm grid, and the build fails if a measured centroid is more than 0.03 mm from it | A tap's place is matched to a core within `tol.len`, 0.01 mm, and the centroids lie up to 0.015 mm off the printed positions (PF40-03's corner holes at 35.485 to 35.504): a tap written at the printed (35.5, 35.5) would miss. The drawings dimension positions to 0.1 mm at best |
| 3 | The base-40 corner holes are one table value, `CORNER_HOLES`: Ø5, centred 4.5 mm in from both faces. The build checks it on PF40-01's and PF40-03's outlines (four Ø5 cores at (±15.5, ±15.5) and (±35.5, ±35.5)), as it checks groove types, and gives it to the 40x80, the 80x80 básico and the 40x40 enclausurado, whose pages draw them | Printed: Ø5 on pp. 16, 17, 20, 21, "(M6)" on p. 20, the 4,5 inset on pp. 17 and 20, and 31 = 40 − 2 × 4.5 on p. 16 (**read**). One value with a measured check keeps the three raster sections consistent with the two vector ones. The 40x80's position along its 80 is not dimensioned; the series' inset is the only source, and the raster agrees within its resolution |
| 4 | PF20-12's cores are Ø5, as its drawing prints them, not the table's 4.6. The section's note says the shop's description says M5 | The table's own rule: `bore` is the diameter printed on the drawing, as PF20-11 already had. Where the 4.6 came from is not recorded; the shop says 4,6 mm for the 20x20 V-slot (PF20-11) and only "M5" for this one. The item's `core.bore_mm` follows (5) |
| 5 | PF50-01 has a Ø13.7 core at its centre, and its item a `core` of 13.7 | p. 20 dimensions "Ø13,70 / M16" across the 50x50's centre core (**read** at 250 dpi). The note "the core is not drawn" was wrong; decision 19 of v1-limits-closed repeated it, and now says so |
| 6 | A drawn section may name `cores` (`at_mm`, `d_mm`); `buildSection` refuses one whose centre is in no hole, or whose hole's inscribed circle about that centre is not its diameter within 0.1 mm on the radius | The check reads a drawn section's cores as it reads a `tslot`'s `bores`; the data must say a core is a hole of that size, so a hand-written core in metal or in a cavity fails `catalog check` |
| 7 | A tap on a core must fit it: the core no wider than the thread's largest minor diameter in tolerance class 6H, and its tap drill (`tapDrill`, major minus pitch, `src/core/threads.ts`) at most one pitch over the core. Otherwise a `machining` error naming the core and the bound | The brief's rule is the tap drill no smaller than the core (drill up) and no larger than a stated limit. Read literally it rejects an M8 in a Ø6.8 core, every 40x40 with an M8 centre (tap drill 6.75): shops drill 6.8, and 6.8 is inside M8's 6H minor diameter, 6.647 to 6.912. So "no smaller" is read with the thread's own tolerance: ISO 965-3:1998 Table 1's T_D1 for 6H by pitch (0.3 to 2.5 mm, **read** from the standard's public preview) on ISO 724's basic minor diameter. The limit above, one pitch on the diameter, is half a pitch of wall on each side, a little under the thread's depth (0.54 P) (**inferred**: no section states its core's wall, so drilling past the core's own thread size is not judged safe) |
| 8 | A thread with no tap drill or 6H tolerance here (not metric, or a pitch over 2.5 mm, M24 and up) on a core is an info: its place is checked, its fit is not | The rule needs both numbers; an error would block an order for a check AluKit cannot make, and silence would hide that it did not run (as v1-limits 19) |

**What the rule says of the vendor's own pairings** (**verified**, `tapFit` on each): M16 in Ø13.7,
M14 or M16 in Ø12.1, M8 in Ø6.8 and Ø6.5, and M6 in Ø5 fit. M5 in Ø4.6 (the 20-series V-slot, as
the shop and the 20x60's drawing pair them) does not: 4.6 is wider than M5's 4.334, a cut thread
there has under half its depth. 4.6 is the usual pre-hole for a *forming* tap M5, which v1 does
not model. PF20-21's Ø6, for which the shop says "M5 / M6", fits neither; an M8 fits it. *Open* for
the owner: whether a core should carry the vendor's stated thread as an accepted fit.

## 3. Areas

The envelopes' computed areas (**verified**: `sectionProperties` on each built section, before and
after). Every bar keeps its published mass: a `tslot` envelope's `props_ok` is false, so its area
is never used for mass, and `catalog check forseti` prints the same report before and after.

| Section | Before, mm² | After, mm² | Printed, mm² |
|---|---|---|---|
| PF20-12 (Ø4.6 → Ø5) | 490.7 | 484.7 | 299 |
| PF40-02 (+ four Ø5) | 1987.2 | 1908.6 | 1006 |
| PF40-03B (+ four Ø5) | 4586.3 | 4507.8 | 1724 |
| PF40-04 (+ four Ø5) | 840.6 | 762.0 | 591 |
| PF50-01 (+ Ø13.7) | 1888.0 | 1740.6 | — (its table is PF45-12's) |

The exact sections' areas do not move: their holes were always in their outlines; only `cores`
names them.

## 4. Tests

- `src/core/threads.test.ts`: the 6H minor diameter worked by hand for M5, M6, M8, M16 and a fine
  pitch; fits and misfits on each bound; the info case.
- `src/core/derive/joints.test.ts`: on TS80, an M8 on a Ø13.7 core (too wide), an M20 (drilled up
  3.80, over its 2.50 pitch), a UNC thread (info), the M16 (fits). On Forseti's PF40-03B and
  PF40-03: M6 in a corner hole passes; M16 there is an error; M16 on a module core passes; M6 or
  M16 at the centre is an error, no core there.
- `src/catalog/catalog.test.ts`: a drawn section's cores, the 40x40 básico's, load; one in metal
  and one its hole is not the size of are refused.
- `alukit catalog import forseti` reproduces `catalogs/forseti` byte for byte, and
  `builtin.test.ts`'s two-build comparison passes with the inputs set (**verified**).
