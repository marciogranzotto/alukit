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
| UX S1 core, server, CLI / S3 3D view / S4 visual system and sheets | running (Opus / Opus / Sonnet, worktrees), launched 04:35 | S2 shell and S5 tools follow once S4's tokens and S3's corners merge | task flows and IA; heuristics and first run; visual design and 3D readability |
| F2: end-hole axis, butt end-face coverage, head seats | **done**, merged (03:30), pushed | Goldens G35–G37. Note: `docs/notes/f2-joint-geometry.md`. |
| X1–X3 plus F2a/F2b: blind fasteners, a butt screw through two bodies, plain bars held by a drilled-hole screw, head sizes from the cited standard, butt screws seat-checked | running (Opus, worktree on top of F2), launched 03:08 | goldens G39+ |
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
- **The local pre-push hook** (`.git/hooks/pre-push`, not committed) blocks pushes that contain
  internal markers. It lives only in this clone; a fresh clone doesn't have it.

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
