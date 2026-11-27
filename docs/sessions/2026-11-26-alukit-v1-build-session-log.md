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
| Gaps A9 (one through-fastener shared by two butting ends) and A8 (positions for a connector's machining) | running (Opus, worktree), launched 22:15 | goldens G33, G34 |
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
