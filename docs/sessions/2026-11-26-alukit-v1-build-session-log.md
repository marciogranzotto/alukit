# 2026-11-26: AluKit v1 build, session log

*Autonomous mode, started 2026-11-26 14:15 -03 at Marcio's request ("keep all and start building
with subagents on /auto-mode"). This log is public. Internal specifics of the reference project go
in the gitignored `internal/session-notes.md`.*

**Plan:** the milestones of [`docs/design.md` §12](../design.md#12-v1-milestones-review-m9), in order:

1. M0 scaffold;
2. M1 catalog core;
3. M1.5 paper model, alongside M0 and M1;
4. M2a the reference project's catalog items;
5. M3a geometry and cut list;
6. M3b generation, BOM, order, commands and CLI;
7. the early acceptance slice;
8. M4a and M4b viewer (M2b the rest of Forseti alongside);
9. M5 variants, revisions and GLB;
10. M6 custom parts;
11. acceptance.

**Working rules:**

| Area | Rule |
|---|---|
| Models | Subagents run on Opus where several invariants must hold at once (catalog core, solver, server) and on Sonnet for implementation and review elsewhere. No Fable. |
| Parallel work | In separate worktrees when files overlap. |
| Reviews | A small task's review folds into the next task. |
| Commits | Personal repo: no AI co-author trailers. Agents commit locally; the coordinator reviews, then pushes `main`. |
| Public hygiene | The reference project is "the reference project" only. Every push is scanned for internal names and paths. |

## Final report (2026-11-27 00:20)

**AluKit v1 is built and passed its acceptance.** `main` holds every milestone of
[design §12](../design.md#12-v1-milestones-review-m9) (M0–M6, plus M4c), and the design (draft
2.3) describes the system as built. The gate (lint, typecheck, 717 unit tests, build, Playwright,
catalog checks) passes, and CI is green.

**What you can do with it** (quickstart in the [README](../../README.md), details in the
[guide](../guide.md)):

- **Catalogs:**
  - all of Forseti (1,034 items, 1,208 offers, 27 profile sections) plus `std` and `ref-hiwin`;
  - `alukit catalog check | show | search | import | schema`;
  - your own catalogs by path.
- **Projects:** a folder with `alukit.json` and its lock.
  - bars on points and stations, end planes and the connection types (butt, miter, splice,
    pivot, face);
  - patterns, parts, plates and bent angles with holes, placeholders;
  - params, variants, costs and open items.
- **Outputs:** derive, cut list, BOM, order (with blocking rules), costs (price bands),
  machining sheet, GLB export and `snapshot`. Every output states its lock hash.
- **Agents:** the CLI (`new`, `do`, `add`, `query`, `check`, `fmt`, `lock update`, `diff`,
  `revision`) and the skill (`alukit skill install`).
- **The browser app** (`alukit serve` or `pnpm dev`):
  - a live view shared with the CLI;
  - drawing with snapping, connect and pattern tools;
  - the catalog browser, variants, revisions, a section plane;
  - a drawer with cut list, BOM, order, costs, machining, open items, params, decisions, checks
    and log.

**The evidence:**

- **34 golden cases** (G1–G34), each with a hand script that imports nothing from AluKit.
- **The cart fixture:** its cut list, BOM, order and machining sheet match hand-worked goldens
  byte for byte.
- **Acceptance on the reference project's whole frame** (§13; full report internal): it took
  three runs.
  - **Runs 1 and 2** passed every numeric test but failed on gaps in AluKit's model. Those gaps
    (A1–A9) were fixed at the root, with new golden cases G29–G34.
  - **Run 3 passed:**
    - all 214 pieces within 0.05 mm of the drawing;
    - mass within 0.03 %;
    - every vendor line to the cent on a frozen lock;
    - the counts.
- **Findings on the reference project itself:** AluKit found six errors in that project's
  record (missing screws and bolts, two masses, rail end distances, and a joint whose screws miss
  their block) plus one open question (which core takes a single end screw). The project's own
  session confirmed four of the first five, the bolt count in part (18 where AluKit had said 20),
  and fixed all five. The joint and the question are with it.

**What v1 leaves for later** (each a *v1 limit* in the design):

- editing an existing connection in the properties panel; dragging a node or an end;
- `channel` and `beam` section generators;
- `services.json` (machining prices other than by cost lines);
- placeholder hatching;
- `serve` rebuilding `dist/`.

Loads and simulation are v2 (D5).

**Your calls:** see [For Marcio to review later](#for-marcio-to-review-later) below. None blocks
anything, and each has a default in place.

## Status

| Milestone | State | Notes |
|---|---|---|
| M0 scaffold | **done** (14:16), pushed `81a8a8e` | Every done-when check passed in a fresh clone on Node 26.13.1 / pnpm 12.23.0 (agent), and again on the coordinator's own run. First CI run on GitHub: **success** (run 45866365568). |
| M1.5 paper model | **done** (14:48) | 254 of 254 bodies in the document: 88 clean, 166 awkward, 0 missing. 20 schema gaps (P1–P20) with fixes. The end-plane rules reproduce every drawn bar length within 0.05 mm. Public summary: [`docs/reviews/m1.5-paper-model-findings.md`](../reviews/m1.5-paper-model-findings.md). |
| Design draft 2.1 | **done** (15:08), pushed `9093d70` | P1–P20 resolved (two v1 exclusions); new golden cases G17–G26; §16 resolution table; four additive catalog-schema changes, handed to M2a. |
| M3a geometry core | **done** (16:08), merged `9ab4355`, pushed | G1–G21 and the §4.4 frame table pass to 0.01 mm; no design golden value was wrong. The cart's 37 bars equal an independent hand table. `derive --json` is byte-identical across runs and processes. 198 tests on its branch, 211 after merge. 39 calls in [`docs/notes/m3a-decisions.md`](../notes/m3a-decisions.md). |
| std / ref-hiwin verification | **done** (16:09), merged, pushed | 40 rows: 33 verified, 5 corrected, 3 partly unverifiable. Table: [`docs/notes/std-hiwin-verification.md`](../notes/std-hiwin-verification.md). |
| M3b part 1: generation + BOM | **done** (17:03), merged, pushed `a9bfc3c` | G22–G25 pass with the design's values; the cart's cut list and BOM equal the hand tables; `alukit bom`; 240 tests after merge. Calls in [`docs/notes/m3b-gen-decisions.md`](../notes/m3b-gen-decisions.md). |
| M3b part 3: offers, order list, costs | **done**, merged `a2dda75` (18:11), pushed | The cart's order list and totals match the hand golden byte for byte. G26 passes. Pack cover is an exact DP checked against brute force for needs 1–60. 7 blocking rules + 1 warning, each tested both ways. Calls: `docs/notes/m3b-order-decisions.md`. |
| M5 core: variants, diff, revisions, GLB, skill | **done**, merged `80c05d0` (19:29), pushed | Variants (applied first in derive); `alukit diff` across files, revisions, git refs and variants, each side on its own lock; `revision save/list/show/verify` with stored outputs (zero drift); a deterministic GLB writer with no three.js (`GLTFLoader` loads it); the skill, generated from help and schemas, with `skill install`. Calls: `docs/notes/m5-decisions.md`. |
| M6 custom parts, placeholders | **done**, merged `2ded043` (19:08), pushed | Plates and bent angles with threaded, countersunk and counterbored holes; `alukit machining` (byte-exact against the hand golden); a placeholder holds only its own order group; gap G-B resolved without a new rule (golden G28). Calls: `docs/notes/m6-decisions.md`. |
| M4b draw tool + catalog browser + `snapshot` | **done**, merged `a25d275` (19:52), pushed | Analytic snapping, work plane, draw/connect/place/pattern/measure tools, orthographic views, catalog browser, `alukit snapshot`. A Playwright mouse run draws the cart's base frame; its cut list and BOM are byte-identical to the CLI fixture's. Calls: `docs/notes/m4b-decisions.md`. |
| Docs: README, guide, notes index, design-vs-built | **done**, merged `f242435` (20:04), pushed | Real screenshot made by `alukit snapshot` (`docs/images/cart-iso.png`). 17 design-vs-built entries. |
| M4c: close the design-vs-built feature gaps | **done**, merged (20:53), pushed | variant switcher, export button, clipping plane, Open items / Params / Decisions tabs, pivot and face in the connect tool, `catalog search` / `import` |
| Full acceptance (§13), internal | **ran** (20:40): the four numeric tests pass; overall **fail** on two model gaps | Cut list: 214 pieces, largest difference 0.05 mm. Mass: within 0.09 % once the record's own errors are set aside. Cost: every vendor line to the cent on a frozen lock. Counts: pass. Every exception is an error in the record. Fails on A1 and A3, below. |
| Gap A3: face contact on real section faces | **done**, merged (21:40), pushed | Golden G29. Note: `docs/notes/a3-face-contact.md`. |
| Design draft 2.3: the design describes v1 as built | **done**, merged (22:07), pushed | 31 changelog bullets; all gap rules plus G28–G32; 15 design-vs-built entries changed to match the build, the rest stated as v1 limits; open calls left open. |
| Acceptance run 2, internal | **ran** (22:09): tests 1–4 pass with **no exceptions**; overall fails narrowly on gap A9 | The record fixed its five errors (its Rev 3.5). Mass +0.03 %; cost to the cent, the heavier-wall variant included. A1–A7 all work in the frame. |
| Gaps A9 (one through-fastener shared by two butting ends) and A8 (positions for a connector's machining) | **done**, merged (22:52), pushed | Goldens G33, G34. Note: `docs/notes/acceptance-gaps-2.md`; design 2.3, "After acceptance run 2". |
| Acceptance run 3, internal | **PASS** (23:09) | Tests 1–4 pass with no exceptions; no AluKit failures. Design §13 records the verdict. |
| v1 limits: the stamp on every output, `bbox()` over parts, end taps on cores | **done**, merged (00:17), pushed | Note: `docs/notes/v1-limits-closed.md`. |
| Forseti sections: secondary cores, and the tap's thread against the core | **done**, merged (01:56), pushed | Note: `docs/notes/section-cores.md`. |
| Acceptance re-runs on the reference project's new heads (internal) | **ran** (01:26, 01:53) | Decided frame, run 4: **pass**. Alternative frame, first run: **fail** on AluKit gaps X1–X4, though one variant passes every numeric test. |
| X4: stock length of parallel-cut bars | **done**, merged (02:42), pushed | Golden G38. Note: `docs/notes/x4-stock-length.md`. |
| UX redesign, phase 1: three designer reviews | **done** (02:52–02:59), merged | `docs/ux/flows-and-ia.md`, `heuristics-and-first-run.md`, `visual-design.md` |
| UX redesign, phase 2: one plan | **done** (03:27); decisions taken (03:31) | `docs/ux/plan.md`: 68 problems (14 plain bugs), 26 decisions, six streams |
| UX redesign, phase 3, S0: shared contracts | **done**, merged (04:33), pushed | `docs/ux/contracts.md`; no visible change (32 app states pixel-compared) |
| UX S4: visual system and sheets | **done**, merged (05:27), pushed | Tokens at WCAG 2.2 AA in both themes, IBM Plex bundled (OFL), one table system, the order's verdict strip with an action per blocker, Problems grouped by consequence. `docs/ux/s4-decisions.md` |
| UX S1: core, server, CLI | **done**, merged (06:11), pushed | The problem model (`/api/problems`, `alukit problems`), dry run, `addFrame`, the corner rule (call 6 decided), `setProject`, steps in words, restore keeping what it overwrites, and the plain bugs. No golden value moved. `docs/ux/s1-decisions.md` |
| UX S3: 3D view | **done**, merged (07:36), pushed. The live-update regression was fixed at its cause (shader programs relinked on each revision, which also made `main`'s `live.spec` flaky); the update now takes 4–19 ms | `docs/ux/s3-decisions.md` |
| UX S2: app shell and IA | **done**, merged (07:36), pushed | `docs/ux/s2-decisions.md` |
| X7 / X8 / F7: quick connectors | **done**, merged (06:59), pushed | G46–G48, calls 52–56; `docs/notes/x7-x8-f7.md` |
| UX S5: tools, inspector, command bar | **done**, merged (09:18), pushed | `docs/ux/s5-decisions.md` |
| UX integration pass (bundle split, one call for corner rules, built-in catalogs, README and guide, design §8) | **done**, merged (11:20), pushed | `docs/ux/integration-decisions.md` |
| UX phase 4: designer review of the running app | **done**, merged (09:46), pushed | `docs/ux/review-phase4.md`: 1 blocker, 8 major, plus minor items |
| UX polish pass on the review's findings | **done**, merged (11:35), pushed | `docs/ux/polish-decisions.md`; the blocker and M1–M8 fixed; m7, m9, m10 partly done, with reasons |
| X9 / F8 / F9: cross-hole faces, bearing on the hook, per-profile grooves | **done**, merged (10:24), pushed | G49, calls 57–62; `docs/notes/x9-f8-f9.md` | task flows and IA; heuristics and first run; visual design and 3D readability |
| F2: end-hole axis, butt end-face coverage, head seats | **done**, merged (03:30), pushed | Goldens G35–G37. Note: `docs/notes/f2-joint-geometry.md`. |
| X1–X3, X5, X6 plus F2a/F2b: blind fasteners, a butt's stack of bodies, plain bars held by a drilled-hole screw, taps over groove openings, sleeves through both walls, head sizes from standards, butt screws seat-checked | **done**, merged (05:00), pushed | Goldens G39–G45; calls 45–51. Note: `docs/notes/x1-x3-f2ab.md`. |
| Gaps A1, A2, A4–A7: connectors, recipes, end holes, cost lines per variant, multi-supplier covers, sleeve clearance | **done**, merged (21:31), pushed | Goldens G30–G32. Note: `docs/notes/acceptance-gaps.md`. |
| Gap G-A: end bearing on a square-mitred shoe | **done** (17:15), merged, pushed `1d827cf` | Draft 2.1's claim was short. New rule: `ends.<x>.plane.normal` may name a bar (square to its axis). Golden case G27 is hand-checked. The design wording is still to fold in (see [`docs/notes/g-a-end-bearing.md`](../notes/g-a-end-bearing.md)). |
| M4a viewer + server | **done**, merged `634fbf1` (18:30), pushed | All three Playwright done-when items pass: a CLI edit shows live in two tabs within 4–31 ms of the CLI exiting; an invalid direct edit makes both read-only; every 403 case, including browser cross-origin and DNS-rebinding attacks. The cart renders 39 bodies, matching derive. 362 tests on its branch. Calls: `docs/notes/m4a-decisions.md`. |
| M2b rest of Forseti | **done** (17:43), merged, pushed | All 1,196 orderable SKUs map to offers (1,208 offers, 1,034 items: 497 generic, 235 fasteners, 151 accessories, 100 connectors, 31 bars, 12 panels, 8 carriages). All 27 profile stems have sections (8 exact, 19 parametric). New connectors are marked as having no mounting model yet. Gate: 322 tests. Calls: [`docs/notes/m2b-decisions.md`](../notes/m2b-decisions.md). |
| M3b part 2: commands, canonical form, lock | **done** (17:15), merged `7a1e18d`, pushed | All 36 §6 commands, pure, with undo/redo restoring document and lock byte for byte; atomic batches; canonical form + `fmt`; the lock pins catalog data and derive reads only the lock; `new/do/add/query/check/lock update`. Calls: [`docs/notes/m3b-doc-decisions.md`](../notes/m3b-doc-decisions.md). |
| Early acceptance slice | **passed** (16:14) | All 75 T-slot pieces of the reference frame are within 0.5 mm of the record's drawn length; the largest difference is 0.04 mm. No AluKit bugs. Two pieces needed stand-ins (gaps G-A and G-B below). Details are internal. |
| M1 catalog core | **done** (14:56), pushed `54ff321` | 94 tests. The 40x40 básico computes 553.53 mm², Ix 9.1287 and Iy 9.1307 cm⁴. 8 generators, worst 0.0025% from closed form. 43 schema calls in [`docs/notes/m1-decisions.md`](../notes/m1-decisions.md). Re-verified by the coordinator. |
| M2a first catalogs | **done** (15:51), fast-forwarded and pushed | forseti: 103 items, 159 offers, 8 exact + 3 parametric sections. std: 19 items. ref-hiwin: 12. `catalog check` passes on all three. The importer is byte-deterministic. 107 tests (+1 skipped without the importer inputs). |

## Decisions taken autonomously

| # | When | Decision | Why |
|---|---|---|---|
| A1 | 14:15 | The paper model (M1.5) and its converter live in the gitignored `internal/paper-model/`, not in the reference project's repo | Another session is actively working on the reference project's branches. Writing there could collide with it. Move it later, once things settle. |
| A2 | 14:15 | Profiles without a vector outline get parametric sections from published dimensions; GrabCAD CAD is optional | GrabCAD needs a logged-in browser. The design already allows parametric sections with a declared fidelity (§3.5). |
| A3 | 14:15 | Add GitHub Actions CI at M0 (lint, typecheck, unit tests, build) | The repo is public, so Actions minutes are free, and CI gives the history an independent check. |

## For Marcio to review later

- **pnpm's release-age policy.** pnpm 12 refused vite 8.4.0 (published 2026-11-26) under its
  minimum-release-age rule, so `pnpm-workspace.yaml` carries `minimumReleaseAgeExclude:
  [vite@8.4.0]`. Drop the exclusion once 8.4.0 is old enough.
- **HIWIN MP/MY editions disagree.** The cited G99TE24-2410 prints 140/280/490/700 N·m. HIWIN
  GmbH's 2013 and 2024 catalogues print 100/200/330/530. The catalog keeps the cited values, with a
  note that the lower ones are conservative. Pick one before loads (v2).
- **std and ref-hiwin values from recall.** The `std` catalog's standard table and clause numbers
  (DIN/ISO) were written by an agent from recall. The values match common tables, but the
  citations needed a check; done 2026-11-26, see `docs/notes/std-hiwin-verification.md`. The
  rail minimum end distance, first an estimate, is published by HIWIN GmbH's catalogue.
- **Bend K-factor is required (M6, `docs/notes/m6-decisions.md`).** A bent angle must state its
  K-factor (0 < K ≤ 0.5); there is no default, because published values run 0.3–0.5 and DIN 6935
  couldn't be checked against its text. A per-material default could be added if you have a shop's
  value.
- **M4b UX calls (decisions #6, #13, #29 in `docs/notes/m4b-decisions.md`).**
  - **#6:** §4.5's default connection makes posts butt *into* top rails, so drawing top rails uses
    auto-connect off plus the connect tool.
  - **#13:** the work plane defaults to ground XY, where §8 suggests a view-facing plane.
  - **#29:** `snapshot` always renders in a fresh headless page, never the open tab.
- **Sleeve clearance default (A7).** Holes a sleeve passes take ISO 273 medium for its OD: Ø17.5 for
  16 mm. The reference shop cut Ø18, which `clearance_mm: 2` reproduces. Between table sizes the
  next size up is used, an inferred rule.
- **A9/A8 calls (open calls 36–38 in the design).**
  - A shared stud is written as two butts, the second `held_by` the first; the alternative was one
    butt whose fastener set counts once.
  - Machining positions are read in the butting bar's section, not turned to suit the end.
  - Coincident ops are an error that blocks the supplier, not a warning.
- **v1-limits calls (`docs/notes/v1-limits-closed.md`).**
  - Tapped end holes count as end taps for the core check.
  - A placed part whose item gives no box makes `bbox()` an error, as `mass()` does.
  - A section with `bores: []` has no cores, so every end tap on it errors.
- **Core thread labels (`docs/notes/section-cores.md`; call 39 in the design).**
  - **PF20-11 and PF20-12:** the drawings print Ø5 (M6), the shop says M5. The drawing's label is
    kept, so an M5 tap there is judged as a cut thread and errors.
  - **PF20-21's Ø6 core:** it accepts M5 and M6 only because the shop text says so; a cut M6 in Ø6
    has no thread.
  - **The drill-up limit** for unlabelled cores: one pitch, a judgement, not a source.
- **X4 calls (`docs/notes/x4-stock-length.md`).**
  - The span is measured over the section's bounding box, as §4.5 sets cuts; it differs from the
    outline only on compound cuts in rounded sections, where it errs long.
  - The BOM's total length adds spans.
  - Two parallel pieces sharing one saw cut when nested is a v1 limit.
- **F2 calls (calls 40–44 in the design).**
  - The overhang limit defaults to 0 (projects can raise it per connector or in defaults).
  - The 50 % head-seat limit is fixed.
  - Holes are matched to screws by tap position, with no new field.
  - G17's brace overhangs 5.00 per side and now warns, correctly.
- **The UX decisions D-UX-1 to D-UX-26 (`docs/ux/plan.md` §3).** All taken as the plan recommends.
  The weightiest:
  - the left column becomes a parts bin plus outline, with a wide catalog overlay;
  - six resizable sheets replace the ten drawer tabs;
  - an order-readiness pill in the top bar; one command bar on the canvas;
  - a start card on empty projects (catalogs and currency, box frame, guided first bar, the
    skill's example);
  - an `addFrame` core command;
  - a `defaults.corner` rule defaulting to today's behaviour;
  - a server dry run for previews; a problem model in core (`/api/problems`, `alukit problems`);
  - Delete with a cascade list;
  - undo naming whose step it is;
  - restore keeps the rejected file;
  - the theme follows the OS, with tests pinned dark;
  - IBM Plex bundled locally;
  - GLB colours unchanged.
- **X-batch calls 45–51 (`docs/notes/x1-x3-f2ab.md`).**
  - A blind fastener's hole is its maker's `hole_mm`, never a clearance table's.
  - A drilled-hole screw holds a plain bar when any headed fastener in the chosen sets is thinner
    than the hole.
  - A butt's stack holds bars only.
  - Vendor screws take head sizes from the standard they cite, as estimates.
  - Head placement in butts is read from the connector's `requires`.
  - A face tap errors only when over half its drill circle is in a groove opening.
  - "Both walls" must be stated for a sleeve.
- **S1's output changes (`docs/ux/s1-decisions.md`).**
  - `option-not-sold` says what is sold.
  - `alukit log` prints steps in words.
  - Catalog search ranks a matching size first.
  - Catalog entries carry a `from` price.
  - Restore keeps what it overwrites in `.alukit/rejected/`.
- **Polish decisions that went against the review (`docs/ux/polish-decisions.md`).**
  - The `butt-no-connector` warning has no 3D badge: on the cart it covered 18 butts and hid a bar.
  - Only blocks and errors outline bars in red.
  - "Nothing" is offered as a joint only while the project has no default connector.
  - Open for later: specific problem titles in core (m7, which would change the CLI's `problems` output), ghost bars for a pattern (m9).
- **3D editing audit, the two owner calls (`docs/ux/editing-audit.md` §11)**, both on their defaults after no answer:
  - variant scope (`only_in` / `not_in`) stays CLI-only this round;
  - butt connectors are not drawn in 3D until v1.1, so joint markers stay the sign of a joint.

  Also the audit's decisions E-UX-1 to E-UX-24.
- **The local pre-push hook** (`.git/hooks/pre-push`, not committed) blocks pushes that contain
  internal markers. Since 05:29 it exempts the licence texts shipped with bundled assets
  (`**/OFL.txt`, `**/LICENSE.txt`, `**/LICENSE.md`), since IBM Plex's licence must ship with the
  fonts. It lives only in this clone; a fresh clone doesn't have it.

## Log

- **14:15**: D17 recorded (all four of draft 2's calls kept). Autonomous mode started. M0 and
  M1.5 launched in parallel.
- **14:16**: M0 done in 6 commits (`6df83fe` … `81a8a8e`).
  - Exact pins as §10, plus `@types/three` and `@types/node`.
  - No install scripts needed.
  - Biome excludes Markdown: its first run reformatted the docs, which the agent reverted.
  - The renderer keeps its drawing buffer so tests can read pixels; e2e uses SwiftShader WebGL.
  - Re-verified by the coordinator, then pushed.
- **14:17**: M1 (catalog core) launched on Opus, with the M0 review folded in: subpath imports,
  the server path guard, CI action versions.
- **14:17**: First CI run green. Working rule added: while an agent commits on `main` in the
  shared working tree, the coordinator doesn't push. Later milestones run on their own branches,
  in worktrees.
- **14:48**: M1.5 done.
  - The biggest gaps: end planes taken from another bar's end (27 bodies), bolts through three or
    more bodies, fasteners and sleeves cut from bar stock, rail holes measured from the factory
    end, loose bill items, and a price band for low/likely/high totals.
  - The paper derive also found three lines where the reference project's own bill disagrees with
    its drawing. That went to the reference project's session as an FYI; details are internal.
- **14:50**: Design draft 2.1 launched on Opus to fold in P1–P20. Its catalog-schema changes will
  reach M1's code as a follow-up.
- **14:56**: M1 done (7 commits).
  - The M0 review it folded in fixed two real server bugs: a malformed URL escape crashed the
    process, and a symlink inside `dist/` could serve files outside it.
  - It also fixed paths with spaces and EPIPE on `| head`, and adopted subpath imports (`#core/*`).
  - Non-obvious calls:
    - a stale override is an error and is not applied;
    - duplicate JSON keys are errors;
    - arcs are flattened at a fixed 0.5° step (a chord tolerance failed 0.1% on small rods);
    - fixtures live in `tests/fixtures/catalogs/`, since `catalogs/` is for shipped catalogs.
- **14:57**: M1 pushed. M2a launched in its own worktree; it merges after review.
- **15:08**: Draft 2.1 done. The coordinator spot-checked G17 (36.87° = atan 3/4; long − short
  = 40 × 0.75 = 30), G25 (an M10 medium clearance hole is Ø11 per ISO 273) and G26 (half away from
  zero: 10.05 × 0.9 = 9.045 → 9.05).
- **15:10**: 2.1 pushed. M2a told the exact catalog additions (offer price ranges,
  `factory_E_mm`, part datums, mount sleeves). M3a launched in its own worktree, in parallel.
- **15:51**: M2a done (10 commits), fast-forwarded onto `main`.
  - **Correction:** the 40x80's printed IX/IY are *not* swapped; only a digit is lost (65.5 printed
    as 6.55). M2a checked the catalogue's axis convention on five drawings. Fixed in the survey,
    `BRAINSTORM.md` and `design.md`.
  - A second agent checked the families against the sources and caught an importer bug (a kit's
    main item was a nut).
  - Lint failed after the merge, though M2a had reported it passing: Biome was scanning the
    agents' worktrees in `.claude/worktrees/` and their nested `biome.json`. Fixed with Biome's
    force-ignore `!!.claude`.
- **16:08**: M3a done (11 commits). Merged with `--no-ff`; the only conflict was the README
  status line.
  - Non-obvious calls: a `miter` declares the angle cut on both ends; pattern `count` includes the
    template; a point never reads a cut (keeps placement iteration-free); `end-far` is measured
    along the face normal.
  - The merged tree is green: 211 tests, build, e2e, and all three catalog checks.
- **16:09**: std / ref-hiwin verification merged.
  - Corrected: HIWIN's minimum rail end distance (6/7/8/9 mm from HIWIN GmbH's catalogue, not
    estimates); the steel-density citation (EN 1991-1-1, not 1993-1-1); the RHS citation.
  - Flagged: HIWIN editions disagree on MP/MY (140–700 against 100–530 N·m).
- **16:10**: Pushed `737b549`. M3b split in two parallel tracks (generation + BOM; commands,
  canonical form and lock). Part 3 (offers, order list, costs) follows part 1. The early acceptance
  slice runs alongside, internal only.
- **16:14**: Early acceptance slice passed (75/75, max 0.04 mm). Two gaps it relied on stand-ins
  for:
  - **G-A:** a strut end bearing on a shoe that is mitred square to the strut can't be derived yet.
    The slice typed the trim as `extend_mm`. Draft 2.1 (§16) claims the end-bearing butt with
    `spacer_mm` covers this case, so either the claim or the implementation is short. Queued for
    M3b part 3's review: prove it with a golden case or fix the rule.
  - **G-B:** a placeholder body needs project items (M6). The slice placed a catalog bracket by
    hand.
- **17:03**: M3b part 1 done (7 commits) and merged; the merged tree is green (240 tests).
  - Non-obvious calls: a rail's holes are one record on the bar (count, pitch, E at each end);
    `stock_mm` must be named when stock lengths give different factory E; a sleeve sits against the
    nut-side inner wall; cut-list identity compares machining by physical position.
  - Process fix: a merge-and-push command chained after a check group whose exit status came from
    its last command, so a failure wouldn't have stopped the push. Nothing broke (every check
    passed), but merges now go through a fail-fast gate script before pushing.
- **17:05**: M3b part 3 (offers, order, costs) and the G-A investigation launched in parallel.
- **17:15**: M3b part 2 done (4 commits).
  - Its merge with part 1 conflicted in six files (CLI and the cart fixture). An Opus agent resolved
    it, keeping both sides: the cart is part 1's extended content in part 2's canonical form.
  - The lock was updated for part 1's items, and a permanent test now checks that every fixture
    derives the same from its lock as from the live catalogs.
  - One real conflict fixed: `splitBar` located holes by position in a list that part 1 extended.
  - No golden, cut-list or BOM value changed. Gate: 313 tests.
- **17:15**: Gap G-A done.
  - Answer (b): the end-bearing butt couldn't derive a strut bearing on a shoe mitred square to it
    without a typed value that goes stale when the strut is redrawn.
  - New rule: a plane's `normal` may name a bar. G27's numbers were re-derived by the coordinator
    (strut 900 mm, end moved −100; shoe cut at 36.87°, ±15 mm). Merged after creating G27's lock and
    canonical form; gate 319 tests.
- **17:27**: Pushed `1d827cf`. Launched M4a (viewer and server, with the G-A command follow-up
  folded in) and M2b (the rest of Forseti), both in worktrees. M3b part 3 is still running; it
  predates part 2's locks, so its merge will need lock updates.
- **17:43**: M2b done and merged (3 commits, no conflicts).
  - The importer refuses to write unless every orderable SKU has an offer; a committed SKU list
    keeps the test runnable without the raw dump.
  - New inconsistencies: PF20-11's printed mass doesn't match its area (accepted mismatch); PF50-01
    is printed with another profile's table (no A or I taken); four profiles have no table or
    drawing; six variations are listed at price 0.
  - A new system `s50-c8` assumes base 40's groove (stated in its name).
  - Shop weights are shipping weights, kept as `ship_mass_kg`, not as item mass.
- **17:48**: M3b part 3 done (6 commits, based before part 2).
  - Calls worth a look:
    - `stale-price` needs an order date, which defaults to today;
    - machining is priced only by covering cost lines, since `services.json` has no schema yet;
    - out-of-stock offers aren't silently swapped for dearer ones: the rule blocks instead.
  - The cart's order is BLOCKED by design: an open item, a phone-priced part and a missing offer
    exercise the rules.
  - Its merge (conflicts expected in the CLI, schema and fixtures, plus locks for the new fixtures)
    went to an Opus agent. It also wires part 2's pending `mass()`/`cost()` check accessors and
    puts the lock hash in the order/costs outputs.
- **17:46**: Design draft 2.2 folds in G-A's wording (`01fb357`).
- **18:06**: M4a built (9 commits).
  - The server owns the document and history in one queue; files are written (lock, then document)
    before a step commits.
  - The watcher is `fs.watch` plus a 1 s stat poll. It recognises the server's own writes by hash.
  - Security: Host and Origin on every request; the token in constant time; `Sec-Fetch-Site`;
    JSON-only bodies; no CORS; CSP and frame denial.
  - The agent's self-review caught two races and fixed them: a command could overwrite an unseen
    edit during settling, and macOS starts file events late.
- **18:11**: M3b part 3 merged by an Opus agent; gate 376 tests, re-run by the coordinator.
  - Tie-ins: `mass()` and `cost()` in checks read the BOM and order totals, and a partial total is
    an error, not a pass. `order` and `costs` run the checks first, and state the lock's sha256.
  - Extra fix: open-item scopes (`supplier:<id>`, bar ends, pieces) now share one parser between
    commands and order rules.
  - Still open: the cut list and BOM don't carry the lock hash yet; `bbox()` ignores parts.
- **18:14**: M5 core and M6 launched in worktrees, in parallel with the M4a merge; both run their
  tests with `nice`.
- **18:30**: M4a merged by an Opus agent. The coordinator re-ran the gate: PASS, 425 tests.
  - The drawer gained Order and Costs tabs (`GET /api/order` and `/api/costs`, through the lock,
    stamped with its hash). Order reasons link to entities in the scene.
  - The API is mounted in the Vite dev server (`ALUKIT_PROJECT=<dir> pnpm dev`) with the same
    security; Vite's default CORS is turned off.
  - A merge-caused bug was fixed: server-side checks didn't use the `mass()`/`cost()` accessors. A
    test now compares `/api/check` with `alukit check --json`.
- **18:32**: M4b launched in a worktree, with M5's `snapshot` folded in.
- **18:50**: M6 built (4 commits).
  - Bend allowance BA = A·(π/180)·(R + K·T), with K required (0 < K ≤ 0.5): published K values vary
    and DIN 6935's text wasn't checkable. Tap drill = major − pitch; a hole may name its own drill.
  - Golden diff: the cut list is unchanged; in the BOM and order, only totals fed by the new lines
    changed, and every other line is an addition.
  - The merge went to an Opus agent, with fold-ins: the viewer draws plates, angles and
    placeholders; `/api/machining` and a Machining drawer tab.
- **19:08**: M6 merged by an Opus agent; the coordinator re-ran the gate (PASS, 455 tests).
  - The viewer now draws plates (holes as rods), bent angles (legs plus bend) and placeholders
    (translucent boxes). `/api/machining` and a Machining tab come from the same function as the
    CLI.
  - A grid-layout bug from M4a was fixed: on small projects the viewport collapsed to the tree's
    height.
  - The only test expectations changed are the cart's drawn part count (3 → 6) and the
    box-selection count (42 → 45), from M6's three new parts.
- **18:55**: M5 core built (6 commits; it merged `main` with M4a mid-way). Its merge is next.
- **19:19**: M4b built (11 commits). Two layout and key-handling bugs were found by its tests and
  fixed. `autoConnect` gained an `optional` flag.
- **19:29**: M5 merged by an Opus agent; the coordinator re-ran the gate (PASS, 493 tests).
  - M6's item meshes moved into `src/mesh/items.ts`, shared by the viewer and the GLB writer. The
    GLB now carries plates, angles and placeholders, with hole rods as child nodes.
  - A bug was found and fixed: a variant swapping a part for a project item crashed derive.
  - Revisions now also store the machining sheet.
- **19:52**: M4b merged by an Opus agent; the coordinator re-ran the gate (PASS, 531 tests).
  **All v1 milestones (M0–M6) are on `main`.**
  - The two layout fixes became one.
  - M4b's interaction layer now runs over M5's shared meshes and M6's parts: parts offer their
    datums and face centres as snap targets, and the catalog browser shows the project's own items,
    read-only.
  - The skill's worked example ends with a snapshot.
  - No golden or existing expectation changed.
- **19:32**: Full acceptance (§13) launched on Opus in a worktree; its outputs are internal.
- **19:56**: CI green on `8f88691`, the merge of all v1 milestones.
- **20:04**: The documentation pass merged (Sonnet; the coordinator re-ran the gate: PASS, 531).
  - A user README with a quickstart, CLI table, catalogs, agents and development.
  - `docs/guide.md`, `docs/notes/README.md` (index of the 13 notes).
  - `docs/notes/design-vs-built.md`: 17 entries. The biggest: G-A's bar-named normal (already in
    draft 2.2); the viewer lacks parts of §8; the work plane defaults to the ground.
  - The coordinator looked at the screenshot: the frame, rails with carriages, braces, plate and
    placeholder all render. One lower diagonal seems to reach outside the footprint. M4c checks
    whether the fixture means that, without touching goldens. **Corrected at 20:53:** it is the
    cart's push-handle grip (`b32`), outside the frame on purpose; the braces are all inside.
- **20:05**: M4c launched to close the design-vs-built entries that are missing features rather
  than deliberate deviations.
- **20:40**: Full acceptance done. Results are internal; this is a sanitized summary.
  - **Tests 1–4 pass:**
    - the cut list, every piece within 0.05 mm of the drawing;
    - mass within 1 %;
    - every vendor line to the cent on a lock frozen at the record's price date (drift to live
      prices is reported separately);
    - pack and kit counts.
  - **Overall fails on AluKit's model:**
    - **A1:** a connector whose mount carries a sleeve can't satisfy the fit rule on any bar.
    - **A3:** face-connection layers meet only on a section's bounding faces, so a block on an
      angle's inner leg can't join a stack.
  - Smaller findings:
    - A2: joints with no body are billed as items;
    - A4: no hole when a bar butts onto another bar's end;
    - A5: a cost line can't belong to a variant;
    - A6: `covers.services_on` takes one supplier only.
    - Also queued as A7: holes for sleeves take the sleeve's OD exactly, with no clearance.
  - Every numeric exception is an error in the reference record, not in AluKit. They were sent to
    that project's session as an FYI. Checked against the record's history: its bill was rebuilt
    from its drawing since the paper model, so the paper model's three bill-against-drawing
    differences no longer hold (internal notes corrected).
- **20:50**: Two Opus agents launched on the gaps, in worktrees: A3 alone (geometry), and A1, A2,
  A4–A7 together. After both merge, the acceptance converter is re-run using the new constructs;
  the target is an overall pass.
- **20:53**: M4c merged, without conflicts; the coordinator re-ran the gate (PASS, 555 tests).
  - The top bar has a variant switcher (`?variant=` on every `/api/*`), Export GLB (byte-identical
    to the CLI's), and the revision with save and verify.
  - A section plane, which only clips the picture.
  - Open items, Params and Decisions tabs, one undoable batch per edit.
  - The connect tool now makes pivots and fastened face joints, with errors in its panel.
  - CLI: `catalog search`, `catalog import forseti` (no network without `--fetch`; reproduces
    `catalogs/forseti` byte for byte), and `derive --select`.
  - Design-vs-built entries 3, 4, 5 and 12 are closed; the rest stay as recorded deviations.
  - Calls in `docs/notes/m4c-decisions.md`. Notably, edits made while viewing a variant go to the
    base document.
- **21:27**: Gaps A1, A2, A4–A7 fixed (8 commits; each failing test written first).
  - **A1:** fit is judged by role. The butting bar by its system; the through bar by its system,
    or by its bore when the fastener set puts a sleeve in it. G30.
  - **A2:** connectors may be `recipe: true`, with no body, mass or offer; only what they bring is
    bought.
  - **A4:** a new `end-hole` op, into a through bar's end face along its axis. G31.
  - **A5:** cost lines take `only_in` / `not_in`, and `diff` shows the change.
  - **A6:** `services_on` takes a list.
  - **A7:** sleeve holes get ISO 273 medium clearance, with a `clearance_mm` override. G32. One unit
    test's values moved, 18 → 20 mm; no golden did.
- **21:31**: Merged, without conflicts. The first gate run failed on two lock tests timing out at
  5 s, with the machine's load average at 50.
  - Measured alone they take 1.3–1.7 s, so the code was not slower.
  - The cause was structural: each test derived every fixture project inside one test, so its time
    grew with the fixture set, and G30–G32 pushed it over under load.
  - Fixed by splitting them into one test per fixture (separate commit), not by raising the
    timeout. Gate PASS, 651 tests.
- **21:37**: Gap A3 fixed (6 commits, failing tests first).
  - **Root cause:** a layer was only its bounding box. Contact, the fastener's walk (each layer's
    depth) and hole placement all used the box's four sides.
  - Inner faces (straight runs of the outline's outer ring off its sides) now count; holes don't,
    and T-slot grooved sides stay their bounding plane.
  - **A hidden second bug, now fixed:** the grip through an angle used its 76.2 box, not its
    6.35 leg (116.20 instead of 46.35). No fixture had an angle layer, so nothing caught it.
  - G29 pins the inner leg, the outer face, a 0.1 mm gap (an error, and fine with `gaps_mm`), an
    across offset, and a channel's inner flange.
  - Derive cost: +0.5 ms on a 42-connection angle frame; the cart is unchanged.
- **21:40**: Merged. Three conflicts, all keep-both: the notes index, the golden list (G29 + G30–G32)
  and `fastenings.ts` imports. The gate passed with 674 tests; every golden holds on the merged
  code.
- **22:05**: Design draft 2.3 (Opus, worktree; 3 commits).
  - It folds the milestone notes, `acceptance-gaps.md`, `a3-face-contact.md` and the design-vs-built
    list (now 21 entries) into `docs/design.md`.
  - Contradictions it settled: m6's "a placeholder holds its own group" over m3b-order's older
    wording (the build follows m6); A1/A7 over the decisions they replace. §11's stem count is now
    27, and §5.2 now says CI runs on Ubuntu only, with macOS in the local merge gate.
  - §12 records honestly that M5's "recorded manual agent run" isn't in the repo; the skill's
    worked example runs as a test instead.
- **22:07**: Merged without conflicts; gate PASS (674 tests).
- **22:09**: Acceptance run 2 (internal; sanitized here).
  - The reference record had fixed all five errors AluKit found. Re-checked against the record's
    new revision: all four tests pass with **no exceptions**.
    - Cut list: max difference 0.05 mm.
    - Mass: +0.03 %.
    - Cost: every vendor line to the cent; totals off only by cent rounding.
    - Counts: pass.
  - Every gap fix A1–A7 works in the real frame (for example, the block on the angle's inner leg is
    now a fourth layer of its stack).
  - **Overall still fails, narrowly**, on A9: one stud and one sleeve through a steel beam, shared by
    two bars butting from opposite sides, can't be written. One butt with both ends doubles the stud
    and sleeve; two butts leave the bush-only side with a fit error that blocks the order.
  - A8 (machining only, no test moves): a connector's required ops have no position, so four taps
    land on one point.
  - The agent's worktree was auto-cleaned (no tracked changes); the results were restored from its
    backup into `internal/acceptance/`.
- **22:15**: An Opus agent launched on A9 (G33) and A8 (G34). It also applies the wording to draft
  2.3 under "After acceptance run 2". Then acceptance run 3.
- **22:15**: The reference record's owner confirmed 4 of the 5 findings, and 1 partly: the bolt
  count was 18, not the 20 sent. The internal notes and the first run's report carry the
  correction.
- **22:50**: A9 and A8 fixed (4 commits, failing tests first).
  - **A9:** a butt can name `held_by` another butt through the same bar's side whose connector
    passes a through-fastener. The ends must be coaxial and on the far side, otherwise a clear
    `connection` error. The fit rule is not loosened. G33: one stud, one sleeve 90.50, one Ø9 hole.
  - **A8:** a connector's required ops take `at_mm` or `at_holes`; splices tap one core per stud;
    two ops at one place on a bar are a `machining` error. G34.
  - Left open: two ends that each set a sleeve on one axis with no hole aren't flagged (flagging
    them would change G30).
- **22:52**: Merged without conflicts; gate PASS (699 tests).
- **23:09**: **Acceptance run 3: PASS.** (Internal; sanitized here.)
  - Tests 1–4 pass with no exceptions, every number identical to run 2's.
  - `held_by` cleared run 2's `fit` errors. Positioned machining took coincident ops from 16 to 0 and
    the splice taps to the record's count (20).
  - `check` raised one error, a fault in the reference record: two screws of a diagonal's foot joint
    cross the block's face plane 4.86 mm below the block. It was confirmed by hand, re-checked by the
    coordinator (20 / cos 22.83° = 21.70 off a centre at z 104.84 → 83.14 against the block's
    bottom at 88), and sent to that project's session.
  - One minor AluKit finding, no test moved: an end tap isn't checked against the section's cores.
    Listed as a v1 limit in §5.5 for now.
  - Design §13 and the §12 row now record the pass.
- **00:14**: Three v1 limits closed (3 commits, failing tests first).
  - The lock hash on every output; the price basis and oldest read date where an output has
    prices. `/api/*` matches the CLI byte for byte, and `revision verify` still shows zero drift.
  - `bbox()` over bars, parts and fasteners, from the viewer's and GLB's geometry
    (`src/mesh/extent.ts`). A new test keeps three.js out of the core.
  - End taps are checked against the section's cores. G31's and G34's fault cases gained the new
    error, and their hand scripts agree. No golden value moved.
- **00:17**: Merged without conflicts; gate PASS (717 tests).
  - The core check turns acceptance run 3's open item into 18 `machining` errors on the reference
    document. The record's single-screw end joints say "the profile's tapped core", but those
    sections have no centre core.
  - This is the record's question, not an AluKit gap. Nothing numeric moves, and the verdict
    stands. Design §13 and the internal report have a dated addendum, and the question went to
    the project's session.
- **00:20**: Final report written (top of this log).
- **00:25**: The reference project's session asked where AluKit's core positions come from.
  - The coordinator checked the primary source: Forseti's catalogue drawings (pp. 17 and 20).
  - They confirm the 80x80's four Ø13.7 (M16) cores at (±20, ±20) around an open centre channel,
    and the 40x80's two around a central chamber. So the 18 errors stand as the record's question.
  - They also show four Ø5 (M6) corner holes on both, which AluKit's parametric sections lack.
    Their bores were set by the importer from the printed size, since the pages draw these
    profiles as raster images.
  - The answer went back to that session; the drawings also explain the "M16" (Ø13.7 is the M16
    tap drill).
- **00:30**: An Opus agent launched to complete every Forseti section's cores from the drawings
  (through the importer, not by hand). It also makes the core check match a tap's thread to the
  core's diameter: an M16 in a Ø5 hole is an error, M6 there is fine.
- **01:07**: Forseti sections completed from the catalogue drawings (11 commits).
  - Ø5 (M6) corner holes on PF40-02, PF40-03B and PF40-04.
  - Exact sections derive their cores from the outline, checked against the printed diameters.
  - Two data errors fixed: PF20-12's cores are Ø5, and PF50-01 has a Ø13.7 centre core.
  - Every core carries the vendor's thread labels (`threads`), from the drawing or the shop text,
    and the build fails if the label isn't in the source.
  - `tapFit`: a labelled thread always fits; any other thread is judged as a cut thread (ISO 965-3
    6H minor diameter, at most one pitch of drill-up).
  - No golden moved; the importer still reproduces the catalog byte for byte.
- **01:05**: The reference project's owner session sent its fixed commits (its J1 joints now in the
  M16 cores, R1 still open as options) and asked for re-acceptance.
  - Two Opus agents read the record only via `git show` at the exact heads, into snapshots: run 4 on
    the decided frame, and a first acceptance of the alternative frame (two variants).
  - The sections merge waits so the code under them doesn't change.
- **01:26**: Acceptance run 4 on the decided frame's new head: **pass**, with no exceptions.
  - Cut list identical; mass +0.05 %; cost within rounding.
  - The owner's claims were checked: the new core positions and screw counts are verified, its
    "bush lines added" only partly.
  - Two more record inconsistencies were reported to that session.
  - The owner says those heads will be replaced after its own review; this run is the baseline.
  - **F2, an AluKit finding:** of the 13 end-joint faults the record's own new check lists, AluKit
    catches 2. The others are end-face overhangs and overlaps, and screw heads seated on slot lips,
    which v1 doesn't check. And A4's end holes follow the receiving bar's axis, while the screw
    follows the core it threads into: on an angled joint they drift about 21 mm apart.
- **01:30**: An Opus agent launched on F2 in a worktree.
  - The end-hole axis follows the fastener (G35).
  - New checks for end-face overhang and overlap (G36) and head seats on material (G37).
  - Geometric only: no load ratings, which are v2.
- **01:53**: First acceptance of the reference project's alternative frame (two variants; internal).
  - Every owner claim verified.
  - Variant B1 passes all four numeric tests; B2 passes cut list and mass but fails cost and counts
    on X4.
  - Both fail on AluKit model gaps:
    - **X1:** a blind fastener (a hole in a tube's near wall only);
    - **X2:** a butt's screw through two bodies (an end plate plus a block);
    - **X3:** a plain bar held by a screw in a drilled hole;
    - **X4:** a bar cut on two parallel angled planes is ordered at its edge length, though a
      single piece uses its full span along the axis. The record's 4960 is right, AluKit's 4926
      wrong.
  - Five record findings went to that project's session; it took them into its fix round.
- **01:56**: The sections branch merged (gate PASS, 737 tests). X4 launched alone, since it doesn't
  touch fastenings; X1–X3 wait for F2 to merge, which works in the same code.
- **02:25**: Marcio, back briefly: "continue your work, but have some designer agents rethink the
  UI/UX so it's more user friendly. I'll be afk."
- **02:27**: A UX redesign track, in four phases.
  1. Three designer agents (Opus, worktrees), each using the running app on a copy of the fixtures
     through Playwright, and on an empty project for the first run:
     - **A**, task flows and information architecture (walk the core jobs; compare Fusion,
       SketchUp, Onshape, item MXen, configurators);
     - **B**, usability heuristics, first run and feedback (Nielsen, WCAG 2.2, onboarding research);
     - **C**, visual design and 3D readability (tokens, rendering specs, tables; the
       frontend-design skill).

     Each commits a proposal under `docs/ux/` and no product code.
  2. The coordinator merges the three into one plan and decides, logging each call for Marcio.
  3. Implementation in parallel streams.
  4. A designer review of the result.
- **02:32**: X4 fixed (6 commits, G38 first).
  - A piece is ordered, billed (`step_mm`), checked against offer limits and nested at its
    **span**: along its axis, from one end cut's farthest point to the other's.
  - It equals the long point unless both cuts lean the same way; parallel cuts add w·tan θ.
  - Source: Autodesk Inventor's Frame Generator help (members are extruded between planes square
    to the axis, then cut); the parallel case is inferred from it.
  - No earlier golden moved: no fixture had two cuts leaning the same way. The cart's hand script
    now works the span out itself.
- **02:35–02:42**: The merge's first gate failed in e2e; all 28 passed run alone. The second failed
  on `skill.test.ts`, timing out at 5 s with the load average at 50 (three designer agents running
  browsers).
  - **The cause:** that test's probes, which only read results, spawned three more CLI processes
    inside the default 5 s budget. They now run in-process: 1.4 s → 0.17 s, its own commit.
  - The example's commands still run as processes, as written.
  - Which e2e test failed in the first run is unknown: the gate script threw its output away. It
    now keeps every step's full log in a fresh folder and prints the failing lines and the load.
  - Gate PASS (744 tests).
- **02:52–02:56**: UX reviews A (task flows and IA) and B (heuristics and first run) merged; both
  touched only `docs/ux/`. They agree on the worst problems, found independently:
  - nothing drawn can be edited or deleted in the app;
  - auto-connect silently changes drawn lengths, and corners are invisible;
  - the README's first frame starts blocked (a finish default that isn't sold);
  - the order's blocked state hides in its tab;
  - problems aren't shown in 3D;
  - agent edits arrive unattributed;
  - catalog search ranks a caster plate first for "40x40".
- **02:57**: The reference project's fix round arrived (new heads for both frames). Acceptance run 5
  on the decided frame and run 2 on the alternative launched in the main checkout; F2's merge is
  held so the code doesn't change under them.
- **02:59**: UX review C (visual design) merged. Its direction:
  - the model is the brightest thing; one meaning per colour;
  - status as shape + word + colour;
  - IBM Plex, bundled; tables like a fabricator's cut sheet;
  - a selection that can't hide; hover labels; camera-following light; edges legible on black
    profiles.
- **03:01**: An Opus agent merges the three reviews into one plan (`docs/ux/plan.md`): a deduplicated
  problem list, the plain bugs, the disputed decisions (D-UX-n), backend and CLI additions with
  parity, parallel implementation streams with file ownership and interfaces, and sequencing.
- **03:05**: F2 built (4 commits; G35–G37; gate PASS, 758 tests).
  - End holes follow the screw's axis; a screw leaving the block by a side is an error.
  - End-face overhang (warning) and overlap (error); on the reference frame they reproduce the
    record's own figures.
  - Heads seat on material: the annulus fraction off groove openings; below 50 % a warning.
  - New warnings on earlier fixtures are all real overhangs.
  - Merge held until the acceptance re-runs finish.
- **03:08**: X1–X3 launched with F2a (head sizes from the standard a vendor screw cites, so Forseti's
  screws get seat-checked) and F2b (butt connectors' screws seat-checked), on top of F2's branch.
- **03:24**: Acceptance run 5 on the decided frame's fix-round head: **pass**, with no exceptions.
  - The owner's totals verified to the cent.
  - Two new record findings went to that session: a fit problem with its new screw seats, and
    screws too short in its bill.
  - Two new AluKit gaps, neither moving a test, queued after X1–X3:
    - **F3:** taps and screw heads aren't checked against a slot's geometry;
    - **F4:** no way to ask a vendor to machine a bought part (e.g. a T-nut drilled out).
- **03:27**: The UX plan is in (`docs/ux/plan.md`).
  - 68 unified problems, 14 of them plain bugs; seven bugs' root causes were read in the code (a
    phantom finish option, Connect showing only the new connection's diagnostics, an empty "not
    sold with" list, an item id taken for a pattern copy, search ranking by name length, …).
  - 26 decisions; 13 backend and CLI additions with parity.
  - **Six streams with file ownership:** S0 contracts first, alone; S1 core and server; S2 app shell;
    S3 the 3D view; S4 the visual system and sheets; S5 tools and the inspector.
- **03:30**: F2 merged. Seven hunks in the design plus the notes index and golden lists.
  - Both branches had added an open call 39: the sections' call keeps 39, and F2's become 40–44
    (§14, its notes, the changelog).
  - My merge-and-gate chain ran the gate on the conflicted tree once; nothing was committed.
    Conflicts are now checked before gating.
  - Gate PASS, 785 tests: G35–G38 hold together.
- **03:31**: Every D-UX recommendation accepted and recorded in the plan's §9 and the review list.
- **04:30**: S0 done (9 commits).
  - Styles split into token, base, shell, viewport, tools, inspector and table sheets; theme
    modules; focus, targets, corners, palette, keys and format seams.
  - Client stubs for problems, dry run and answers; the problem model's types.
  - The drawer became a sheet registry; `draw.spec` reads a machine-readable `snap` field.
  - 32 app states match today's build to the pixel.
  - One `live.spec` timing flake at load 35–46, passing on re-run. It's a wall-clock latency
    requirement, so the streams are staggered to limit load rather than loosening it.
- **04:33**: S0 merged, gate PASS (810 tests).
- **04:35**: The first wave of streams launched in worktrees: S1 (core, server, CLI: the plain bugs,
  `addFrame`, the corner rule, dry run, the problem model, settings), S3 (the 3D view per review C,
  joint markers, show-in-3D) and S4 (tokens, bundled IBM Plex, sheets, the order's verdict strip,
  problems). Each runs the full gate once, at the end.
- **04:57**: The X batch finished (7 commits, failing tests first, G39–G45).
  - **X1:** `fastening: "blind"` with the maker's hole and grip range.
  - **X3:** a plain solid bar held by a screw through a drilled hole at a tap.
  - **X2:** a butt's `stack` (end plates, packers) lifts the end and drills each on the screw's axis.
  - **F2a:** `standards` tables (ISO 4762, ISO 7380-1, DIN 7984, ISO 4017) fill head sizes; Forseti's
    89 screws cite them, so their seats are now checked.
  - **F2b:** butt connector screws seat-checked: on the far face, or under groove lips on the lip or
    a T-nut, checked for depth and chamber.
  - **X5:** a face tap over a groove opening is an error.
  - **X6:** `walls: "both"` sleeves.
  - No earlier diagnostics moved.
- **05:00**: Merged. Three conflicted files, every hunk the branch's side being a superset or a
  re-wrap; no duplicate sections or call numbers. Gate PASS (891 tests).
- **05:03**: The reference project's round-3 heads arrived. Acceptance run 6 (decided frame) and run 3
  (alternative frame) launched, using the new constructs. They run the CLI from a frozen detached
  worktree at `eb14da6`, so `main` can take the UX streams' merges meanwhile without changing the
  code under them.
- **05:14**: S4 done (3 commits).
  - Tokens at WCAG 2.2 AA in dark and light, held by a unit test and an e2e test.
  - IBM Plex WOFF2 bundled with its OFL, served by Vite as hashed files under the unchanged CSP.
  - Six sheets on one table system; the old checks, open items, costs, decisions and history sheets
    folded in.
  - Order & costs leads with a verdict strip, blocked suppliers first, and Show and Resolve on each
    blocker.
- **05:18**: The S4 merge's first gate failed only `live.spec` (a CLI edit visible in two tabs within
  1 s) at load 44–52. Measured rather than assumed, with three runs each at load 30–42:
  - with S4: 101 / 552 / 489 ms;
  - before S4: 321 / 317 / 118 ms;
  - unloaded, M4a measured 4–31 ms.

  No large regression; the machine's load dominates. The test is a product requirement and stays
  as is. The gate re-run passed (906 tests).
- **05:29**: The push was refused by the local pre-push hook's word check, a false positive on
  IBM Plex's licence text. The hook now exempts licence texts shipped with bundled assets.
  Pushed `eab4f38`.
- **05:30**: S2 (app shell and IA) launched; S5 (tools and inspector) waits for S3.
- **05:31**: The alternative frame's acceptance run 3 (internal; CLI at `eb14da6`).
  - All four numeric tests pass on both variants.
  - Gaps X1–X3, X5 and X6 work on the real frame: blind fasteners grip one wall, the butt's stack
    is drilled, the drilled-hole fit holds, and the sleeved walls clear.
  - It fails on one new gap, **X7**: an access hole cannot be placed across its face. The schema
    refuses a position and the code always drills the face's centre line, so on a two-core
    profile two connectors' cross holes land in one place.
  - A check gap, **X8**: F2b finds a butt connector's head only through an end tap. A connector
    whose pin sits untapped in a core is not seat-checked, and with a tap its head is modelled as a
    plain cylinder and wrongly rejected.
  - The X7/X8 fix waits for the decided frame's run 6, to batch whatever it finds.
- **05:50**: The decided frame's acceptance run 6 (internal; CLI at `eb14da6`).
  - **Pass**: all four tests, with no exception.
  - `check` now reports more: 23 errors and 32 warnings against run 5's 1 and 3. As a control, run 5's document on today's AluKit gives the same, so the new diagnostics come from the new checks (taps over grooves, end-face overhang, head seats), not from the project's changes. Each has a stated cause.
  - It found the same two gaps as the alternative frame (here F5 = X7, F6 = X8).
  - It also found **F7**: F2b seats a far-face head along the butting end's normal rather than along the screw, and seats heads for holes F2 refuses.
  - The frozen worktree is removed.
- **05:52**: Gap batch X7 / X8 / F7 launched (worktree):
  - a quick connector (a pin in the core, its head under the groove's lips, a cross access hole) written as sold;
  - access holes positioned across their face;
  - the connector's own head seat-checked;
  - F7 confirmed with a failing test before any change.
- **06:07**: S1 finished (S1.1–S1.14, two drops).
  - New endpoints: `GET /api/problems`, `dryRun`, and `prefer` on catalog search.
  - New commands: `setProject` and `addFrame`, plus the `defaults.corner` rule.
  - New CLI: `alukit problems`, `do --dry-run`, `add frame`, `catalog search --prefer`, `snapshot --theme`, and `--as agent:<name>`.
  - On a 1,008-bar project, problems take 23 ms (2–3 ms cached), and a dry run of one bar and joint 144–167 ms. So S5's previews should dry-run on snap or after a pause, not on every pointer move.
  - A top-ring-only frame gives the skill's worked example byte for byte.
- **06:11**: S1 merged. Two conflicts, both sections each side had added (the design changelog and `contracts.md`), so both were kept. The regenerated skill docs matched. Gate PASS, 946 tests.
- **06:29**: S3 finished (S3.1–S3.13).
  - Sky/ground and camera lights, fog, outline and detail edges, a selection that shows through what covers it, hover labels.
  - Joint markers from corners computed in the browser, Show in 3D with a stepping callout, and a gizmo.
  - The GLB export is byte-identical.
  - The bundle grew to 1,001 kB and now trips Vite's size warning: code splitting is queued for the integration pass.
- **06:36**: The merge's gate failed `live.spec` (a CLI edit shown in two tabs within 1 s).
  - Third time, so measured rather than re-run. Interleaved A/B runs at the same load (34–42): before S3, 78 / 92 / 138 ms; with S3, 905 / 989 ms when passing, and 5 of 7 runs failing.
  - S3's view draws on demand (no idle render loop), so the cost is in the update path.
  - A real regression against design §12's 1 s requirement. The unpushed merge was taken back out of `main`, and S3's agent is finding and fixing the cause. The test stays as it is.
- **06:59**: Gap batch X7 / X8 / F7 merged and pushed (`bc6a9c7`, gate PASS, 988 tests).
  - A connector in a recipe's fastener set is placed at each hole of its mount, and brings its own access hole, drilled over each core from the nearest face.
  - A connector's own head is seat-checked, with domes computed exactly; derive reports the room to the floor and to each side.
  - A head is seated only on a hole F2 makes.
  - Golden cases G46–G48 and calls 52–56; no diagnostic moved across 149 cases.
- **07:00**: S2 finished (S2.1–S2.17). Its decisions are in `docs/ux/s2-decisions.md`.
  - Layout: the parts bin over the outline, a wide catalog overlay, and six sheets that collapse, split and maximise.
  - Top bar: an undo that names whose step it is (asking before undoing someone else's), a readiness pill, "Saved as / Not saved", and a variant strip.
  - A start card: two clicks and a list choice to an armed, sold profile, or the skill's example in one step.
- **07:01–07:12**: `live.spec` timing, measured again.
  - S2 against `main` at load 21–35: no material change, 8 of 8 passing.
  - Load then climbed to 40–120, from other sessions on the same machine, and `live.spec` failed alone as well as in the suite.
  - CI, on an unloaded runner, passed all 43 e2e tests on every head today.
- **07:14**: S3's agent found the cause of the live-update regression, and of `live.spec`'s flakiness on `main` too.
  - Every revision disposed the old model's materials before drawing the new one, so three.js relinked six shader programs, each link waiting on the GPU process: 112 ms of `main`'s 137 ms update, and 1.1 s with S3's heavier frames.
  - Fixed: the old model is disposed after the frame that draws the new one, and marker layers keep their materials.
  - The update now takes 4–19 ms at load 31–51 (`main` before: 125–324). A new test counts shader links across a revision and expects none.
- **07:20**: S2 and then S3 merged locally. `live.spec` now passes under load. Two tests fail only in combination (selecting a problem's connection in the outline, and a revision drawn under the new layout), so they went back to S3's agent to fix at the cause. Nothing is pushed until the gate passes.
- **07:30**: The integration fixes came back.
  - The outline had been built against the corners placeholder. With real corners, connections sit in closed corner groups, so Show now opens every selected target's group. That is a product fix.
  - The shader-link test now answers the decided "undo another source's step?" question.
- **07:36**: Both merged with the integration fixes; gate PASS (1,049 tests), and `live.spec` passes under load. Pushed `c9dc0c5`; the S2, S3 and baseline worktrees are removed.
- **07:38**: S5 launched: the command bar, place on click, keys, inspector editing with Delete and its cascade, the joint preview (a dry run on snap or after a pause), and the box-frame tool on `addFrame`.
- **08:02**: The reference project's next heads arrived. The decided frame's run 7 and the alternative frame's run 4 launched, with the quick connector written natively. The CLI runs from a frozen worktree at `5b9c70b`.
- **08:31**: The alternative frame's acceptance run 4 (internal; CLI at `5b9c70b`).
  - All four numeric tests pass on both variants, and gaps X7 and X8 are confirmed closed on the real frame.
  - It fails on a new gap, **X9**: the quick connector's cross hole is drilled from the face nearest its core even when another member covers that face (8 of 36), though each core has a clear face. `check` is silent, and a requirement cannot name the face.
  - **X10**, a check gap: the bearing under the lips is measured on the outer face rather than on the lips' underside, so AluKit misses its own 50 % warning.
- **08:37**: The decided frame's run 7 (internal): **pass**, all four tests, with the quick connector written natively for the first time. It found the same face gap (6 of 36) and the bearing gap.
  - It also found **F9**: two profiles carry another profile's groove in the catalog, where the vendor's drawings differ.
- **08:39**: Gap batch X9 / F8 / F9 launched (worktree):
  - a clear face chosen for each cross hole, a face that can be named, and covered faces reported;
  - bearing clipped to the lips' underside;
  - each profile's own groove from its own drawing, printed dimensions first, else a stated estimate.
- **09:08**: S5 finished (S5.1–S5.11).
  - A command bar with typed expressions and params, place on click, and keys (axis lock, chaining, `X` Pattern, `G` box frame).
  - Inspector editing in place, where a param-driven length points at its param.
  - Delete lists its cascade first.
  - A joint preview that dry-runs 60 ms after a snap or 250 ms after a pause (2–8 dry runs per 61 pointer moves) and says what will butt and which cuts change.
  - A box-frame tool whose cut list matches `alukit add frame` byte for byte.
- **09:18**: S5 merged; gate PASS (1,075 tests). All six streams are on `main` (`f264ea5`).
  - From the screenshots, for the designer review: the box-frame form shows in two places, the command bar covers part of the model, the status line repeats the prompt, one label is cut off, and warning outlines look close to the selection's amber.
- **09:20**: The integration pass and the phase-4 designer review were launched in parallel. The review is read-only, and its findings feed a final polish pass.
- **09:44**: The phase-4 designer review is in (`docs/ux/review-phase4.md`).
  - **Verdict:** much friendlier than the app the first three reviews walked.
  - **First bar:** 3 clicks, 4 keys, about 22 s (target 30; before, 5 clicks, 7 keys and a dead end).
  - **Box frame:** 5 clicks, 17 keys, about 43 s (target 60; before, 16 clicks and 35 keys).
  - **One blocker:** a box frame reads "Ready to order" with nothing to join it, because a butt with no connector buys nothing and no rule says so.
  - **Eight major findings:**
    - the start card's frame can't choose its profile;
    - a typed length with no direction is silently ignored;
    - the Problems badge counts the order's warnings rather than the sheet's;
    - overlays collide at the top of the view;
    - the command bar covers the model and Fit ignores it;
    - the frame has two forms that disagree;
    - outline rows hide the cut length;
    - a size chip preselects the wrong profile family.
  - Four of the coordinator's five screenshot items were confirmed. "Anchor c" is a code for centre, not a cut-off word.
- **09:47**: The polish pass was launched on every finding, failing tests first for each behaviour bug.
  - For the blocker: a fit-filtered "Joined with" choice in the frame template, a `butt-no-connector` problem, and an order rule (warn by default, which can be made to block).
  - The coordinator added one rule: the readiness pill never shows plain green READY while such a problem stands.
- **10:15**: The decided frame's run 8 (internal): **pass**, and byte-identical to run 7.
  - A per-hole comparison of drilling faces showed that the project counts a face as covered when anything stands within a 30 mm tool zone in front of it, not only on contact. Members standing 2 mm off a face are covers. That shaped X9's model.
- **10:18**: Gap batch X9 / F8 / F9 finished, failing tests first.
  - **X9:** a member (a bar's body or a placed part's box) covers a hole's mouth if it stands in front of it within the tool's room, 30 mm by default and `access_mm` per requirement. Derive takes the nearest clear face, and a named face is checked. The machining sheet names the face.
  - **F8:** bearing is read on the lips' underside, out to the hooks. A quick connector's head on a 40 mm groove now bears on about 37–42 %, and warns.
  - **F9:** each section can state its own groove, printed dimensions first, else read off the drawing at about ±0.3 mm. What can't be read is marked unread and reported, not borrowed.
  - Golden case G49; no golden value or fixture diagnostic moved across 167 cases.
  - It also corrected an earlier reading: a printed "4,5" beside a profile's opening is a corner hole's inset, not its lip.
- **10:24**: Merged; gate PASS (1,098 tests). The alternative frame's run 5 launched on the same project head.
- **10:38**: Mutation check of X9 / F8 / F9 on `main` (each fix's core reverted alone in a scratch worktree; the derive, X7/X8 and golden test files run).
  - Control: 162 of 162 pass.
  - **X9 mutant** (the cover test always clear): G49's covered-face cases and the cover unit tests fail.
  - **F8 mutant** (bearing on the face, not the lips' underside): G49's bearing cases and the quick connector's end-to-end test fail.
  - **F9 mutant** (each profile's own groove ignored): 6 fail, among them the per-profile Forseti grooves and the unread-lip case.
  - Each fix is held by tests on today's code, not only by the failing-first tests written on the base commit.
- **10:41**: **The alternative frame passes acceptance on both variants** (run 5, internal; same project head, AluKit `6de7329`).
  - All four tests are unchanged from run 4.
  - All 36 cross holes per variant are on clear faces: the 8 that moved went to the one clear face the project's own rule finds for each core.
  - The 36 new head warnings are exactly the bearings below half.
  - No new AluKit gap. Both reference frames now pass, and design §13 says so.
- **11:18**: The integration pass finished.
  - **Bundle:** the 1,185 kB entry split into an app chunk plus two three.js chunks (930 kB at start, none over 500 kB), with sheets, settings and the corner inspector loaded on first use. The cart's first draw went from 1,593 to 1,351 ms. The size-warning limit was removed, not raised.
  - **Corner rules:** `GET /api/arrangements` and `alukit arrangements` answer every corner rule in one derive. The corner inspector went from 670 to 244 ms on 1,018 bars.
  - **Joint preview:** it no longer dry-runs while the stroke's ends touch nothing.
  - **Built-in catalogs:** listed in Project settings, each with Add.
  - **Docs:** the README and guide were run command by command, which fixed two broken examples; design §8 now states the redesigned app.
  - **A real S5 bug:** the tools' model subscription ran before their handlers existed, so a second tab on a warm server lost its step notices. Fixed, with a test.
- **11:20**: Integration merged; gate PASS (1,108 tests).
- **11:26**: The polish pass finished.
  - **The blocker:** the box frame asks how it is joined (fitting connectors first, or "Nothing"), and the choice becomes the project's default butt connector in the same step. A `butt-no-connector` problem with its Fix, and an order rule `no-connector` (warn by default). The pill reads "Ready, N warnings", never plain READY over such a warning.
  - **M1–M8:** a profile step in the start card, "Which way?" for a length with no direction, the Problems badge counting its own list, one message lane, the command bar as a row under the view, the frame's options in one place, a length column in the outline, size chips without linear guides.
- **11:35**: Polish merged; gate PASS (1,127 tests).
  - Code conflicts with the integration pass: the badges had moved to their own file for lazy loading, so the polish changes were ported there. The start card's imports and the tools' imports were reconciled, and two imports left unused were dropped.
- **11:36**: The decided frame's run 9 launched on the project's wall-fix head, with the new constructs written natively (walls as placeholder parts, named cross-hole faces).
- **11:54**: The designer re-check of the polish is in (`docs/ux/review-phase4.md` §9).
  - The blocker and M1–M8 are all confirmed fixed on the running app.
  - The box frame now takes 4 clicks, 12 keys and about 27 s (before: 5, 17, about 43 s). The template path reaches READY with its brackets ordered.
  - One new major finding: the inspector's problem row lays out one word per line and its buttons overlap the text. Plus six minor items. A fix pass was launched.
- **12:06**: The decided frame's run 9 (internal): **pass**, on the project's wall-fix head, with walls as placeholder parts and named faces written natively.
  - AluKit judges exactly the project's five wall-side faces covered, and finds no clear face for them either.
  - Two gaps: a cover that arrives after assembly (a wall the frame is later set against) can't be said (**F11**), and a face can be named only in the catalog, not on a project connection (**F12**). A gap batch was launched.
  - A stale figure fixed in `docs/notes/x9-f8-f9.md`: X9 moves ten holes in the decided frame, not six.
- **12:15–12:27**: Marcio is back and using the app.
  - Two agents he stopped by accident were relaunched.
  - **Traced sections:** at his request, Forseti's 19 generated profiles get traced cross-sections, from the catalogue's vector drawings where they exist and its raster drawings otherwise, each validated against the published kg/m and inertia before it is marked real.
  - **Ends and lengths:** he asked to drag a bar's end to extend it, auto-attaching to the bars it meets, and to click a bar's length label to type a new length. This lifts the v1 limit on dragging ends. An agent is building it on the draw tool's joint preview.
- **12:31–12:34**: Marcio found the app has no way to move an item, and asked that the 3D view get **all the UI/UX needed to design and edit everything**.
  - A Move tool joined the end-handle work, sharing its drag machinery.
  - An editing audit was launched, the same method as the redesign: inventory what the model can do against what the app offers, research CAD tools and extrusion-frame configurators, a gap matrix, buildable streams, then a designer review on real editing tasks (build a table, widen it, move a shelf, change the legs' profile, add a brace, undo it all).
- **12:46–13:02**: The re-check fixes N1–N7 merged (`66c6f7b`, gate PASS 1,135).
  - Mutants of N2, N5, N6 and N7, whose tests were written after their code, are all caught (N6's thumbnail by its e2e test).
  - `CLAUDE.md` added for the project.
- **13:10**: Gap batch F11 / F12 merged (`cf91d0a`, gate PASS 1,160; failing tests first, 12 of 13 failing on the base).
  - **F11:** a bar or part may arrive `after_assembly`; a face only such members cover is a warning (the connector can't be re-tightened once they're in place), not an error.
  - **F12:** a connection names its cross holes' faces (`hole_faces`), overriding the recipe.
  - G50, calls 63–64; nothing moved across 175 cases.
- **13:11**: The 3D editing audit merged (`docs/ux/editing-audit.md`).
  - Of the model's 38 commands, 13 are fully reachable in the app, 8 partly, 17 only from the CLI. In the view, dragging only orbits the camera, and right-click, double-click, copy and paste do nothing.
  - **62 missing capabilities:** 12 must, 29 should, 21 could. 33 of the 41 must and should items are UI work over commands the core already has.
  - **Four defects.**
  - **Streams:** E0 contracts (an action registry and context menu, face picking, gizmo pieces, view state, splitting the tools' wiring), E1 core and CLI, E2 selection, visibility and menus, E3 transform and copy tools, E4 bars and ends, E5 joints, patterns and parts.
  - 15 timed acceptance scenarios for the designer review.
- **13:12**: The audit's `transform` command (move and rotate) went to the agent building the Move tool, so one command exists, not two. E1's other core tasks started. E0 waits for the end handles and Move tool to merge, since all three rework the tools' wiring and gizmos.
- **13:46**: The traced sections finished.
  - Forseti now has **18 real outlines of 27**: 9 exact, among them the 20x20 V-slot, whose drawing proved to be vector, and 8 traced from raster drawings.
  - Each trace was validated against the published area (within 2 %) and inertias (within 4 %, justified by four profiles that have both kinds of drawing). The method and sources are in `docs/notes/forseti-traced-sections.md`.
  - 10 stay generated, each for a stated reason: 5 traces fell outside tolerance (for example, a bore that traces Ø3.8 where Ø5 is printed), 1 drawing is only lines, and 4 profiles have no drawing at all.
  - `catalog check` holds traced sections to the same tolerances.
  - No mass, golden or acceptance result moved. Four groove disagreements are recorded, and the printed value wins.
- **13:55**: Merged; gate PASS (1,162 tests). The tracing's open calls were renumbered 65–67 in the merge, since the F11/F12 batch had taken 63–64. The reference project published its decided frame's next revision, which AluKit's last run and byte-compares had passed.
- **14:09**: End handles, the cut label edited in place, and the Move tool merged (gate PASS, 1,204 tests). Decisions are in `docs/ux/drag-ends-decisions.md`.
  - A selected bar shows a handle at each end. Dragging one moves that end along the bar's axis and joins what it meets.
  - Clicking the label's cut number lets you type a new cut. A typed `=L - 40` stays driven by `L`.
  - **Move (`D`)** works by dragging, or by clicking a base point and then where it goes. Arrow keys lock an axis, and you can type an offset. Joined ends follow by default, and Alt frees them.
  - **Core:** new commands `moveEnd` and `transform` (move and rotate; `alukit move` and `alukit rotate`) with CLI parity.
  - The preview reuses the joint preview with one shared material, and `view.spec` still shows zero shader links.
  - The open calls were renumbered 68–71 in the merge.
- **14:12**: E0, the editing contracts, started. It splits the tools' wiring and adds the action registry and context menu, picks with face and station, the hidden and isolated view state, gizmo pieces built once and the batch builders. It changes nothing visible; the streams E2–E5 build on it.
- **14:31**: E1, the 3D editing core, merged (gate PASS, 1,288 tests). Decisions are in `docs/ux/e1-decisions.md`, and the open calls are numbered 72–77.
  - **Query:** `alukit query` takes `like:<id>` and `connected:<ids>` (`connected*` follows joints transitively).
  - **Braces:** a brace drawn into a joined corner butts the corner's through bar, and an angled end `autoConnect` makes declares its angle cut.
  - **Problems:** every diagnostic has words, and an angled end has two fixes.
  - **Arrangements:** a corner of two ends offers a miter and a splice.
  - **Dry runs:** the effects list the parts a step adds.
  - **Mass:** a traced section's computed mass is tagged `est`.
  - **What moved:** G10 and G11 lose a false `unconnected` warning and its broken Join fix, and four golden cases' problem titles changed. No golden value or cut list moved.
- **15:15**: E0's merge gate failed on E0's own new shader-link test with the gizmo shown (10 expected, 12 linked).
  - Measured: alone it passes 4/4. A diagnostic run, 16 runs on 8 workers, showed the count normally settles before the revision.
  - **Cause:** the test sampled before the handles' first render, since three compiles programs lazily. That is a race in the test, and also a shader-compile stall on the first selection.
  - The merge was taken off main before any push. E0 was sent back to precompile the gizmo and assert that a selection links nothing, proven on 8 workers.
- **15:27**: The reference project's alternative frame passed acceptance run 6 on its next revision, both variants, with tests 1–4 identical to run 5.
  - With the room's walls and floor as covers, 29 of 36 cross holes take the record's face. The other 7 are ties between equally good faces, broken in a different order. Named on the connections (F12), all 36 are accepted.
  - The new traced PF40-02 outline moves the bearing under its lips from 41.69 % to 40.79 / 42.26 % by side.
  - **New gap X11:** a modelling aid (the room's walls and floor) entered the BOM, the order and the bounding box. An agent is closing it, with G51.
- **15:47**: E0 merged (gate PASS, 1,301 tests).
  - The viewer precompiles every lasting material at startup: the gizmo, and also the selection's x-ray, which had linked on the first selection. A selection now links nothing, and the test asserts it.
  - A second race was found: "two frames drawn" does not mean the model has drawn. `RenderStats.modelFrame` replaces that wait in both shader tests. Under load they passed 32/32 and 48/48.
  - **Visible changes:** right-click opens the menu in Select, and keys match their modifiers exactly (calls 78–79).
- **15:48**: The editing streams E2 (selection, visibility, menus), E3 (rotate, mirror, duplicate, arrays, copy and paste, align), E4 (editable ends, offsets, split, holes, several bars at once, nodes) and E5 (joints, patterns, parts) started in parallel.
  - Each has its own block of §14 call numbers, so merges don't renumber.
  - Gap X11 runs alongside them in the core.
- **16:30**: The alternative frame's fix head passed a byte-compare against run 6: all 41 outputs are identical.
  - The converter now passes the record's drawing explicitly, since the record's code stopped reading it by default.
  - AluKit's own bar for a rail block agrees to under 0.001 mm with the record's new open item: the block sits 1.6 past its wall limit.
- **16:52**: Gap X11 merged (gate PASS, 1,331 tests).
  - A bar, a placed part or a butt's through body may be marked `context`. It still counts for covers and clearance, but stays out of the cut list, BOM totals, order, costs, mass and `bbox()`. The view draws it translucent with one material pair, and the GLB keeps it, flagged.
  - G51 is added, and nothing moved across 187 cases.
  - Its conflicts with E0 were resolved by keeping both sides.
- **17:04**: E3 merged (gate PASS, 1,346 tests).
  - Rotate (Q) with ring drags in 15° steps, mirror, duplicate with `4x` / `/4` arrays, copy and paste, point-to-point, align to a face, and a part sliding along its bar.
  - Each matches the CLI's result (`alukit diff` empty, or byte-identical cut lists), and almost every test failed first.
  - The calls (90–94) are put in numeric order in §14.
  - **Known limits:** the slide arrow shows only for bars along a world axis, and the length label can cover part of a ring.
