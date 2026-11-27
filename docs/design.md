# AluKit: design (v1)

*Draft 2.3, 2026-11-26. Built from the decisions D1–D16 in [`BRAINSTORM.md`](../BRAINSTORM.md),
the Forseti survey [`research/forseti-inventory.md`](research/forseti-inventory.md), review 1
[`reviews/design-review-1.md`](reviews/design-review-1.md), the lessons and wishlist from the
reference project (an internal lab rack), and the M1.5 paper model of that project's frame
([`reviews/m1.5-paper-model-findings.md`](reviews/m1.5-paper-model-findings.md)). v1 is built
(§12), and this draft describes it as built, from the decision notes in
[`notes/`](notes/README.md). Everything here is open to veto: section 14 lists the calls made
without asking, section 15 maps every review finding to where it is resolved, and section 16 does
the same for the paper model's gaps.*

*Provenance labels: **verified** (run or checked against a source, with how), **read** (from the
named document), **inferred** (reasoning, not checked).*

## Draft 2.3 — what changed (2026-11-26)

v1 is built: M0–M6, then M4c and the gaps the acceptance found (§12). Draft 2.3 folds in the
decision notes and the 21 entries of [`notes/design-vs-built.md`](notes/design-vs-built.md) (cited
below as dvb), so that the design again describes the system as built. A recorded deviation that
proved the better choice is now the rule; a feature v1 does not have is stated as a **v1 limit**,
with the version that takes it up. Calls left for the owner's review are marked *open* (§14, call 6
and calls 31–34; after the second acceptance run, 36–38; after the third, 39; after the fourth,
40–44). Changed text is marked *2.3*. The build was not changed for this draft, except as "After
acceptance run 2", "After acceptance run 3", "After acceptance run 4" and "After the alternative
frame's acceptance" below record. Notes are cited by
name and decision number ("m4a 13" is decision 13 of
[`notes/m4a-decisions.md`](notes/m4a-decisions.md)).

**§2 Conventions**

- Four unit suffixes for the stiffness, straightness and twist fields §3.4 names; canonical
  numbers snap to their grid only within `tol.snap`; every file is strict JSON with a `schema`; a
  direct edit is taken in as written (m1 3, 6, 7; m3b-doc 3; m4a 9; dvb 9).

**§3 Catalogs**

- §3.1: a stale override is an error and is not applied; a project's item reference always names
  its catalog. `services.json` is a v1 limit (m1 16, 19; m3a 6; m3b-order 13; dvb 14).
- §3.2: `clone_of` on any kind; one SKU in several stock lengths is one offer per length, keyed
  `<SKU>.<length>`, naming its `sku` (m1 22; m2a 8).
- §3.3: a groove chamber that narrows toward its floor, `taper_from_mm` and `bottom_mm` (m2a 10).
- §3.4: **fit by role** (gap A1) and **joint recipes**, `recipe: true` (A2); where `requires`
  machines, with the **end hole** into a through bar's end (A4); a fastener set counts per mount
  hole; fasteners gain `subtype`, `fits` and `dims`; a panel's mass follows from its thickness
  (acceptance-gaps A1, A2, A4; m1 26, 27; m2a 6a, 9; m3b-gen 28, 29; dvb 18, 19).
- §3.5: the `tslot` generator as built; no `channel` or `beam` generator yet, a v1 limit; arcs
  flattened at 0.5° (m1 34–36; a3-face-contact).

**§4 Projects**

- §4.3: a station with no face takes `off_mm` in local x and y (m3a 13).
- §4.5: **the faces of a layer**, bounding and inner, with stations, the fastener's walk through
  the material, the grip and the holes on them (gap A3; G29); a hole a sleeve passes **clears**
  it, by ISO 273 medium for its outside diameter or by `clearance_mm` (A7; G32); a butt's
  connector, counted per end and not placed, a v1 limit; a placeholder as a through body (gap
  G-B; G28); a miter declares its own angled cut; "end far from its face" is measured along the
  face's normal; the holes of `screw`, `tnut` and rail layers; the draw tool's auto-connect
  (a3-face-contact; acceptance-gaps A1, A4, A7; m3a 19, 23; m3b-gen 21–27; m4a 35; m4b 5, 6; m6,
  gap G-B; dvb 20).
- §4.6: golden cases G28 (M6) and G29–G32 (the acceptance gaps), their values copied from each
  fixture's `expected.json` (m6; a3-face-contact; acceptance-gaps).
- §4.8: a bent angle's legs, inside radius and required K-factor (open, call 33), one 90° bend in
  v1; project items hold numbers, default to supplier `local`, and take the hole and price rules
  as built (m6 1–15; dvb 17).
- §4.9: `cost(high)`, not `cost("high")`, since the language has no strings; accessors are for
  checks only; `bbox()` holds bars only, a v1 limit, *closed after acceptance run 3*; margins per
  operator (m3a 7, 8; m3b-doc 34, 37, 39; dvb 13).
- §4.10: cost lines take `only_in` and `not_in` (A5); `only_in` leaves an entity out of the
  document derived with no variant; what a swap replaces and what it leaves (acceptance-gaps A5;
  m5 3–6; dvb 15, 21).
- §4.11: a cost line's fields as built, its provenance `est` by default; `services_on` takes a
  list (A6); machining in v1 is priced only by a covering cost line (acceptance-gaps A5, A6;
  m3b-order 13–15, 17, 25, 32; dvb 14, 21).
- §4.13: when the lock is created and what `lock update` keeps; a revision holds every variant and
  its `as_of`, and is saved through the server when one runs; diff sides (m3b-doc 9–11; m4c 5, 6;
  m5 9–17).

**§5 The derived model**

- §5.1: stage 4 adds inner-face contact, end holes and sleeve clearances; stage 5 the machining
  sheet (acceptance-gaps; a3-face-contact; m6 18).
- §5.2: CI runs on Linux; the macOS run is the merge gate's (the repository's CI configuration).
- §5.3: kerf and trim defaults; end holes listed from their end; identity by where machining
  physically is; a rail's holes as one record (m3a 33; m3b-gen 5, 6, 32; acceptance-gaps A4).
- §5.4: a bar's mass from its centre-line length; joint recipes listed apart; the **machining
  sheet**; a v1 limit: only the order and the costs state the lock's hash, *closed after
  acceptance run 3* (m3b-gen 35, 36; acceptance-gaps A2; m6 18–22; m3b-doc 40; m3b-order).
- §5.5: fit by role; the order's date, `as_of`; a placeholder holds its own group; the cover does
  not avoid an out-of-stock offer (m3b-doc 41; m3b-order 5, 10; m6 16; dvb 16).

**§6 Commands**

- Merge patches for `set*`; what a cascade removes and what it refuses; `autoConnect`'s `optional`;
  the shape of a refusal (m3b-doc 12–14, 17; m4a 1; m4b 5).

**§7 Agent interface**

- §7.1: what "valid" means; `serve` refuses invalid files and holds the edit lock while it runs;
  the order of a step; the source tags; `undo`, `redo` and `log` need a server; `?variant=` and
  `?as_of=` on the API (m4a 5–17, 25, 41; m4c 1–6; dvb 8–10).
- §7.2: `Host` and `Origin` on static files too; `Sec-Fetch-Site`, the security headers and the
  one token-free path, `/api/health` (m4a 18–22; dvb 11).
- §7.3: `machining`, `redo`, `revision list` and `show`, `catalog schema`; the syntax of
  `derive --select`; `catalog search` and `import` (m4c 20–25; m6 18; dvb 12). `snapshot` in a
  fresh page stays the rule (open, call 34; m4b 29).
- §7.5: the skill's worked example runs as a test (m5 30–32).

**§8 Viewer and UI**

- The work plane defaults to the ground (open, call 32); snap targets add each bar's design line
  and the parts' datums and face centres; picking raycasts the bodies, snapping stays analytic; a
  Machining tab; the read-only banner is its own bar; the variant switch, the revision, export,
  the section plane, the catalog browser and the tabs as built; Connect builds pivots and fastened
  joints. v1 limits: editing an existing connection, dragging a node or an end, placeholder
  hatching, `W` on a part's face (m4a 34–38, 42; m4b 7–19, 25–28, 38–40; m4c 7–19; m6 28, 32;
  dvb 2–7).

**§9 Exports, §10 Stack, §11 Forseti**

- §9: the GLB's root node, its hole children and extras; the machining sheet; which outputs carry
  the lock's hash, every one *after acceptance run 3* (m5 22–27, 40; m6 18).
- §10: `serve` does not rebuild `dist/`, a v1 limit; the API in Vite's dev server; the pins as M0
  kept them, with vite's release-age exclusion still open (m4a 43, 44; the
  [build session log](sessions/2026-11-26-alukit-v1-build-session-log.md)).
- §11: 27 profile stems, not 25; connectors beyond the first families have no mounting model yet;
  two HIWIN editions disagree on MP and MY, open until loads (m2b 7, 14; std-hiwin-verification;
  the build session log).

**§12–§14**

- §12: every milestone is done; M4c and the gaps' work are rows of their own; M5's recorded manual
  run is not in the repository, its worked example runs as a test instead; the fixture list
  (every note).
- §13: the acceptance run of 2026-11-26 (tests 1–4 passed; failed overall on A1 and A3, with A2
  and A4–A7; all fixed); the re-run is under "After acceptance run 2" below (the build session
  log; acceptance-gaps; a3-face-contact).
- §14: calls 31–35, four of them open, and call 6 marked open.

### After acceptance run 2

The second run passed tests 1–4 with no exception and failed on gap A9; it found gap A8 too. Both
are fixed at their root, and the design follows the build
([`notes/acceptance-gaps-2.md`](notes/acceptance-gaps-2.md), cited as "acceptance-gaps-2"). No
value of G1–G32 moved.

- §3.4: fit by role gains a third way, a butt `held_by` another (A9); a requirement takes
  positions, `at_mm` or `at_holes`, read in the butting bar's section (A8); a splice taps one core
  per stud, at its `at_mm` (A8); `catalog check`'s `splice-taps` (acceptance-gaps-2 1, 3,
  9–14).
- §4.5: the butt's `held_by`, and **a through-fastener for two ends**: the holder, coaxial ends
  from the far side, one stud, one sleeve and one hole; the v1 limit on a connector's frame now
  says where positions are read (acceptance-gaps-2 1–8, 10).
- §4.6: golden cases G33 and G34, and the `test-stud` catalog (acceptance-gaps-2).
- §5.1: stage 4 adds machining at positions, splice taps per stud, `held_by`, and the check for
  one op made twice (acceptance-gaps-2 1–5, 9–16).
- §5.3: an end tap at a position, worded from the centre and turned with the piece
  (acceptance-gaps-2 9, 10).
- §5.5: a **Machining** check, two ops at one place (error); `held_by` and positions under ends
  and connections (acceptance-gaps-2 13, 15, 16).
- §12–§14: the second run's gaps row and fixtures; §13's second run (tests 1–4 passed with no
  exception; failed on A9; both gaps fixed); calls 36–38, all open.

### After acceptance run 3

The third run passed. Three v1 limits the design named are closed in the build, each with tests
written first, and the design no longer calls them limits
([`notes/v1-limits-closed.md`](notes/v1-limits-closed.md), cited as "v1-limits"). No golden value
moved; two of G34's fault cases and G31's tapped case gain an error (below).

- §4.11, §5.4, §9, §4.13: **every output states the stamp**. The cut list, the BOM, the machining
  sheet and `derive --json` state the lock's hash as the order and the costs did; the cut list
  and the costs state the oldest price read date beside the basis, and the order's and the costs'
  CSV the basis and the date as `stamp` rows; the server answers as the CLI, byte for byte;
  `revision verify` does not count a stamp a stored output lacks as drift (v1-limits 1–9).
- §4.9: **`bbox()` covers every body** the viewer draws and the GLB holds: bars, placed parts
  (project shapes, placeholders and catalog boxes) and face fasteners, from the same shapes and
  placement in `src/mesh/`; a placed part whose item gives no box makes the check that reads it an
  error (v1-limits 10–15).
- §3.4, §3.5, §5.1, §5.5, §13: **a tap into a bar's end is checked against its section's
  cores**: an end tap, a connector's in a butting or a through bar's end or a splice's, and a
  tapped end hole. On none of them, a `machining` error naming the bar, the end and the nearest
  cores; a section that gives no core positions (only a `tslot`'s `bores` do) an info. Two of
  G34's fault cases, their taps at the centre, gain that error beside the coincidence error, and
  G31's tapped case gains it, its M8 10.00 off the block's core; no value moves (v1-limits 16–21).
- §3.5, §5.5, §14: **every core a section's drawing shows, and the tap's fit to it**
  ([`notes/section-cores.md`](notes/section-cores.md)). Forseti's sections list all their cores:
  the base-40 profiles' Ø5 (M6) corner holes 4.5 mm in from both faces (on the 40x80, both
  80x80s, the 40x40 básico and enclausurado), the eight drawn sections' cores as a new `cores`
  list, each checked to be one of the outline's holes, the 20x40 V-slot's Ø5 and the 50x50's Ø13.7
  centre core as their pages print them. Each core carries `threads`, the vendor's labels for it
  (the drawing's "(M16)", else the shop's "Centro permite rosca"). A tap on a core must fit it: a
  labelled thread does (an M5 in the 20-series' Ø4.6, a forming tap's pre-hole); any other is
  judged as a cut thread, the core no wider than its largest 6H minor diameter and its tap drill
  at most one pitch over the core, so an M6 in an 80x80's corner hole passes and an M16 there is
  an error; an unlabelled thread AluKit has no tap drill or 6H tolerance for is an info. Call 39
  (open) is the one-pitch limit. No golden value moves; the envelopes' computed areas shrink by
  their new bores, and every bar keeps its published mass.

### After the alternative frame's acceptance

The first acceptance run on the reference project's second frame found gap X4, fixed at its root
with the failing tests written first ([`notes/x4-stock-length.md`](notes/x4-stock-length.md),
cited as "x4").

- §4.5, §4.6, §5.1, §5.3, §5.4, §12: **a piece is ordered at its span**, the length of straight
  stock it takes: its extent along the axis from one end cut's long point to the other's, over the
  box's corners. Two cuts that lean the same way, as parallel cuts do, put the long points on
  opposite edges, so the span is longer than the long-point length `cut_mm` (by w · tan θ for
  parallel cuts at θ); a trapezoid's span is its long point. Draft 2.3 ordered `cut_mm`, so a
  brace cut on two parallel faces was ordered 20 mm short (1118.03 for 1138.03 of bar). Derive,
  the cut list and its stock bars state `span_mm` with an angled end; ordering, billing, the
  choice of cut offer, `min_mm`/`max_mm`, nesting and the BOM's length use it. Golden case G38
  and its catalog `test-span`. A cut line two parallel pieces share in nesting is a **v1 limit**
  (x4). No golden value moved: no fixture had two cuts leaning the same way; the cart's angled
  lines state their span, equal to their long point (x4 1–10).

### After acceptance run 4

The fourth run passed, and found (F2) that `check` saw 2 of the 13 faults the reference frame's
own joint check lists at its screwed end joints, and that one derived result was wrong: an end hole
ran along the block's axis while its screw runs along the butting bar's. The three gaps are fixed
at their root, each with failing tests written first and a golden case worked by an independent
hand script ([`notes/f2-joint-geometry.md`](notes/f2-joint-geometry.md), cited as "f2"). No golden
value moved; the new checks flag earlier fixtures where their geometry really does what they
catch (below).

- §3.4, §4.5, §5.3, §5.5: **an end hole follows its fastener's axis**. A hole a connector requires
  in the through bar where it also taps the butting end is the clearance for a screw into that
  tap: it runs along the butting bar's axis through the position, from where that line meets the
  end face to the other end face (or its depth), and reports its exit and its angle to the face.
  A screw that would leave the block by a side first has no hole, a `connection` error; a hole
  whose wall breaks out of a side, at an angle or along the axis, is one too; a screw into the
  butting end that meets a side face at an angle is refused, a side hole being drilled square to
  its face; a tapped end hole at an angle is a `machining` error. The cut list and the order word
  the angle ("7.59° off square, exiting end b at …") (f2 1–8; G35). G31's spacer case gains the
  breakout error: its Ø9 hole, 16.00 off centre, stands 0.50 past the 40 block's side.
- §3.4, §4.5, §5.1, §5.5: **a butt's end face must sit on its face**. On the trimmed bars,
  each butting end face (its outline, grooves closed) is seen along the normal of the face it bears
  on (a side of the through bar's box whole across, its end face's outline, or a body's box face):
  past it by more than the connector's `overhang_mm`, else `defaults.butt.overhang_mm`, else 0,
  a `connection` warning that says how far and how much; a butting bar that goes into the body it
  bears on beyond the face, a `connection` error. `derive --json` gives each seat under `butts`
  (f2 9–17; G36). The warning appears on G2 (its through end stops at the node, half the post's end
  past it), G17 (the brace's 50 mm end on the 40 mm end, 5.00 past each side), G27 with n1 at
  z = 100, G31 and G35, and on the cart's beam (100 tall on 40 rails) and grip (45° on an end
  plate the arm's size), whose hand script now works the three.
- §4.5, §5.5: **a head seats on material**. At each station of a face connection the fastener's
  head, the stack's nut for a bolt, or a washer under either bears on the annulus from the hole
  out to its bearing diameter (`dw_mm`, `dk_mm`, `s_mm`; a washer's `d2_mm`), on the face's
  material: a bar's side less its grooves' openings. Below half of it on material, a `fit`
  warning with the fraction; on none, a `fit` error; a part that gives no diameter is not
  checked, an info naming its connections. `derive --json` gives each station's `seats`
  (f2 18–26; G37).
- §4.6, §12–§14: golden cases G35–G37 and the `test-seat` catalog; the fourth run's gaps row;
  calls 40–44, all open.

### UX redesign, S1

Stream S1 of the [UX plan](ux/plan.md) (§4, §5.5) adds what the redesigned app needs from the
core, the server and the CLI, each with its CLI form, and fixes the plain bugs the plan found
(§2.2). No golden value moved; its decisions, and every output that changed with its old and new
text, are in [`ux/s1-decisions.md`](ux/s1-decisions.md) (cited as "s1").

- §5.5: **option wording**. With no option chosen, `option-not-sold` says what is sold, "sold only
  with finish anodised or black; choose one", where it said "not sold with" and nothing; the cut
  list's `no-offer` names the options in words, and what is sold when none matches (U10, BE-7;
  s1 1).
- §5.5: **the problem list**, `alukit.problems/1`: the check's diagnostics, the order's reasons
  and the open items as one list grouped by consequence, each in words with its targets and its
  fixes, never judged again (BE-3; s1 8–13).
- §6: **`setProject`**, a merge patch over the project's settings, catalogs confined to built-in
  ids and folders inside the project (BE-1; s1 4–6); **every command describes itself**, and a
  step reads in words (BE-4; s1 7); **a dry run** (BE-2; s1 14–16).
- §7.1: `GET /api/problems`; `dryRun` on `POST /api/commands`; the log's and the events' `text`;
  `--as agent:<name>` reaches the log as that agent (U57, BE-10; s1 2).
- §7.3: `alukit problems`; `alukit do --dry-run`; `alukit catalog search --prefer`, and a bar of
  the size a query writes ranks above an item that only mentions it (U14, BE-8; s1 3).

## Draft 2.2 — what changed (2026-11-26)

- **A shoe mitred square to a strut (gap G-A; §4.5, §16).** A plane's `normal` may name a bar:
  square to its axis, still a placement provider. The strut's end butts through the shoe's
  end, so both derive. Draft 2.1's construction, the shoe through the strut's end, left the
  strut's length typed. Golden case G27.
- Implementation decisions taken while building M0–M3b are recorded per milestone in
  `docs/notes/` (m1, m2a, m2b, m3a, m3b-gen, m3b-doc, std-hiwin verification); where a note and
  this design disagree on a detail, the note records what was built and why.

## Draft 2.1 — what changed (2026-11-26)

M1.5 wrote the reference frame as a project document against draft 2: 254 bodies, 88 expressed
cleanly, 166 only awkwardly, none missing. Its 20 gaps (P1–P20) and its notes on draft 2 are
closed here; §16 maps each one to its section or to a v1 exclusion.

- **End planes from another bar (P1, P12; §4.5).** A `butt` may bear on another bar's **end**
  (`"through": "b7.b"`). `ends.<x>.plane` gains `{ "of": "<bar>.<end>" }` (a flush end) and
  `{ "face": { "bar", "face" } }` (a face the centre line misses). A free end may count its length
  from the cut. Stage 3 now runs in **two sweeps**, placement providers then end providers, still
  with no iteration; a chain is an error. `spacer_mm` is defined along the through face's normal.
  Golden cases G17–G21 (§4.6).
- **Bolted joints (P2, P3, P4, P6, P17; §4.5).** A `face` connection takes any number of layers,
  head to nut, with `gaps_mm`. A fastener may be cut from bar stock (`{ "bar", "len_mm" }`), a
  stack may hold a sleeve cut to a hollow layer's bore (`inside`, `bore`), and
  `stations.across_mm` makes pairs and grids. A `bolt` generates a clearance hole in each layer,
  a `screw` its tapped hole. The grip is now the layers and gaps (call 25). Golden case G25.
- **Rails (P5, P7, P8; §4.7).** Holes follow how the rail is sold: from a factory end for a stock
  rail, centred only when drilled to order. **Draft 2's centred default was wrong** for a stock
  rail cut at one end. `runs` name collinear spliced bars, so stations, patterns and face layers
  span a joint; `rail_holes` selects every n-th hole plus the first, the last and those beside a
  joint. Nesting keeps a factory end on every piece. Golden cases G22–G24.
- **Parts (P10, P11, P14; §4.5, §4.7).** A part's frame on a station is defined. A butt passes
  through any item with a bounding box, at a pose. `parts` may hold unplaced lines: counted and
  priced, not drawn.
- **Expressions (P9; §4.9, §4.10).** `sec(<bar>)` reads the bar's section after swaps, so a
  variant that swaps a section moves the lengths written from it.
- **Costs (P13, P15; §4.11, §5.4).** `price_bands` give catalog-priced lines their low and high;
  `covers` takes items and the machining on another supplier's bars. Golden case G26.
- **Small rules (P16, P19; §4.3, §4.4).** The sign of a station's offset across a face; `ops`
  holes go through or to a depth.
- **v1 exclusions (P18, P20).** Project items stay plate, bent angle, generic and placeholder: a
  project-local catalog holds a project's own bars and connectors. A part's own mounting hardware
  enters as unplaced lines.
- **Corrections.** §13's cut-list test names the record's **drawn** length as the oracle and
  compares `centre_mm` for an angled end; its cost test uses price bands. The paper model and its
  converter live in this repo's gitignored `internal/` folder, not in the reference project's
  repo (decision A1 of the [build session log](sessions/2026-11-26-alukit-v1-build-session-log.md)):
  §12, §15. Equivalent rolls of a symmetric section are not normalised (§4.4).
- **Catalog schema changes (§3), a follow-up to M1**, which is being built from draft 2's §3. All
  are additions; nothing in draft 2's §3 changes meaning:
  1. **Offers:** `regular_minor` and `sale_minor` may be valued fields with `low` and `high` (a
     quoted range); such a range beats a price band (§3.2, §4.11).
  2. **Rail stock offers:** `factory_E_mm`, the end distance at both ends of the stock length
     (§3.2, §4.7).
  3. **Part items:** `datums` in the item's own frame, whose axes are now defined (§3.2); a
     carriage declares `run` (§3.4).
  4. **Connector `mounts`:** a fastener set may list a sleeve,
     `{ "item", "inside": "through", "len_mm": "bore" | <number> }` (§3.4).

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
  `_km`, `_minor`, and (*2.3*) `_N_per_mm`, `_Nmm_per_rad`, `_mm_per_m`, `_deg_per_m` for the
  stiffness, straightness and twist fields §3.4 names. The loader converts to base units (mm, N,
  N·mm, MPa, kg, degrees), so a value is stored as its source prints it (a torque in N·m stays
  `torque_Nm`). An unknown suffix is a schema error (review m7).
- **Money** is an integer in minor units (`_minor`, review n6) plus a currency code: on the
  catalog for offers, on the project for totals (§4.11).
- **World frame.** Right-handed and Z up, like the Fusion design frame. Conversion to three.js
  (Y up) happens only in the scene's root transform; GLB export converts to glTF's Y-up metres
  ([glTF 2.0 §3.4](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#coordinate-system-and-units)).
- **Ids.**
  - Catalog items are `<catalog>:<code>`, e.g. `forseti:PF40-01`. Offers are keyed by SKU.
  - Project entities have a letter prefix and a number (`n12` node, `b7` bar, `r1` run,
    `c3` connection, `p4` part, `pt1` pattern, `K2` cost, `C1` check, `O1` open item,
    `D1` decision). The
    document's `ids` map holds the last number used per prefix, so **ids are never reused**, even
    after a delete (review m1). Pattern copies are
    `<template id>@<k>`. An id never looks like an integer, so a JS engine never reorders it as
    an object key (review M4).
  - **Id order**: split into a letter prefix, a number and a rest; compare the prefix by code
    point, the number by value, the rest by id order. `b2 < b10 < b10@1 < b10@2 < c1` (M4).
- **Canonical form** (review m13, M4). UTF-8, LF, two-space indent, final newline. Keys in schema
  order; entity maps sorted by id order, one entity per line; numbers as ECMAScript's shortest
  round-trip form ([Number::toString](https://tc39.es/ecma262/#sec-numeric-types-number-tostring)),
  never `-0`, never non-finite. Numbers on `_mm` and `_deg` fields and point coordinates snap to
  0.01, and `_kg` to 0.001, only when they lie within `tol.snap` of that grid (*2.3*):
  `1199.9999999999998` is written `1200`, `12.345` stays. The server and the CLI always write
  canonical form; `alukit fmt` rewrites a file into it. A hand edit in any form is accepted, taken
  in as written (*2.3*: rewriting a file just saved would make the editor reload it), and
  canonicalised by the next step that writes the file (§7.1).
- **Strict JSON** (*2.3*). Every file AluKit reads is parsed strictly: a duplicate key is an error
  naming its line, since `JSON.parse` keeps the last of two keys silently. Every file carries a
  `schema` (`alukit.project/1`, `alukit.catalog/1`, …), which migrations read.
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
catalogs/<id>/services.json     machining services and prices, by hand with page refs (not in v1)
catalogs/<id>/overrides.json    corrections and accepted mismatches, each with provenance
importers/<id>/                 the importer that regenerates catalog.json, offers.json and sections/
```

Items and offers are separate files because prices change at every read and items rarely do;
diffs then stay readable.

**v1 limit** (*2.3*): `services.json` is not built. It needs a schema and a place in the lock
(§4.13), which v1 does not define, so in v1 machining is priced only by a cost line that covers it
(§4.11). v1.1 or later.

**Merge order** (review M10). An item is assembled field by field, by item id, from three layers:

| Layer | Written by | May |
|---|---|---|
| 1. `catalog.json`, `offers.json`, `sections/` | the importer, regenerated; never edited by hand | set any fact it can read from a source |
| 2. `families/*.json` | agents, then an independent review | add fields and items; **not** change a field layer 1 set (a collision is an error naming both files) |
| 3. `overrides.json` | a person or an agent, with provenance | replace a field: `{ "item", "field", "expect", "value", "why", provenance }`, or accept a mismatch: `{ "item", "field", "accept": true, "why" }` |

`expect` is the value the override replaces. `alukit catalog check` reports an override whose
`expect` no longer matches layer 1 or 2 (the vendor fixed it, or the importer changed). Such a
stale override is an error and is not applied (*2.3*), so a stale correction never overrides
silently: a person decides. The loaded item carries a `corrected` history computed from the
overrides; nobody writes it by hand.

**Catalog ids** (review m13). A catalog declares its id in `catalog.json`. A project names its
catalogs by built-in id or by path; two catalogs claiming one id is an error naming both paths.
An offer may offer an item from another catalog by its full id, so a local steel supplier's
quotes can point at shared items. Inside a catalog a bare id resolves in that catalog; a project's
item reference always names its catalog, `forseti:PF40-01`, since a project reads several (*2.3*).

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
| `datums` | for parts (*2.1*): named points in the item's own frame. `mount` is the point that lands on a station (§4.7); a carriage adds `run` (§3.4) |
| `mesh` | optional GLB for drawing; otherwise a parametric mesh from the kind |
| `options` | named by meaning: `{ "finish": ["anodised", "black"], "hand": ["left", "right"] }` |
| `ratings` | the typed ratings bag (§3.4) |
| `clone_of` | an item in a reference catalog that this one rebadges (review m8), on any kind (*2.3*: rails are rebadged too, not only carriages); one level only |
| `prov` | the item's default provenance |

**A part item's own frame** (*2.1*): +z points away from the face the part mounts on, and +x runs
along the bar it mounts on. Its `bbox_mm`, `datums` and mesh are given in that frame, which §4.7
lands on a station.

**Every offer:**

| Field | Notes |
|---|---|
| `item`, `sku`, `supplier` | `supplier` defaults to the catalog's vendor. An offer is keyed by its SKU; when one SKU is sold in several stock lengths, each length is an offer keyed `<SKU>.<length>` that names the SKU it orders in `sku` (*2.3*) |
| `options` | the option values this SKU sells: `{ "finish": "black" }` |
| `pack` | units of the item per offer (default 1), or |
| `kit` | contents: `[{ "item", "qty", "options" }]`; the first entry is the kit's main item |
| `sale` | bars only: `cut` or `stock` (below) |
| `price` | `{ "regular_minor", "sale_minor", "per": "unit" \| "m" \| "bar", "read", "src" }`; `sale_minor` is null when there is no sale. Either price may be a valued field (§2) with `low` and `high`, a quoted range (*2.1*): it gives the order line its low and high, and no price band applies (§4.11) |
| `in_stock` | as read |
| `url`, `ship_mass_kg` | the shop's weight is a shipping fact, never the BOM's mass (§3.5) |

**Sale rules for bars:**

| Mode | Fields | Example |
|---|---|---|
| `cut` (the supplier cuts) | `min_mm`, `max_mm`, `tol_mm`, `res_mm` (order resolution), `step_mm` (price step), optional `min_bill_mm` with `bill: "piece" \| "line"` | Forseti profiles: 40–3000 mm, ±1 mm, 10 mm price steps (*read: survey §2*) |
| `stock` (whole bars) | `length_mm`, one offer per stock length, each with its own price per bar. A rail's stock offer adds `factory_E_mm` (*2.1*): the end distance at both ends of the stock length as the maker drills it (§4.7). Omitted, it is the centred layout's, ((`length_mm` − 2 `E_min_mm`) mod `pitch_mm`) / 2 + `E_min_mm`, tagged `est` | steel in 6 m bars; a rail sold in 500–3000 mm lengths, each its own SKU (*read: review B3*) |

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
  `light`). item rates its T-nuts in standard grooves only. A chamber that narrows toward its
  floor gives `taper_from_mm` and `bottom_mm`, both or neither (*2.3*): it keeps the undercut's
  width to `taper_from_mm`, then narrows to `bottom_mm` at `depth_mm` (a 40-series chamber run
  square to its full depth would cross its neighbours' at a 40x40's corners).
- **System**: an interface family that decides what fits. A T-slot system is a series plus a
  groove type (`forseti:s40-c8`); a rail system is a rail size family (`forseti:rail-hg20`).

### 3.4 Kinds

Fields marked † are needed only by later phases (D5), but the schema has them from day one.

| Kind | Fields beyond the envelope |
|---|---|
| **bar** | `shape`: `tslot`, `tube`, `rhs`, `rod`, `threaded-rod`, `flat`, `angle`, `channel`, `beam` or `rail`. `section` (a section id, §3.5); `system` (T-slot and rail bars); published `area_mm2`, `Ix_mm4`, `Iy_mm4`, `J_mm4`†, `Wx_mm3`†, `Wy_mm3`†; `core` (bore, tap size); tolerances† (straightness, twist; DIN EN 12020-2 / ABNT NBR 8116); `thread` (threaded rod); `rail` { `pitch_mm`, `E_min_mm`, `E_max_mm`, hole spec } (rails) |
| **connector** | `subtype` (bracket, plate, end-connector, cube, gusset, hinge, splice); `fits` [systems]; `frame` (the connector's own axes, which give the rating directions their meaning; review m7); `mounts` [{ plane, holes, `fasteners` keyed by system: `{ "forseti:s40-c8": [{ item, qty }], "forseti:s45-c10": [ … ] }` }] (review B3); a fastener set may list a sleeve cut from bar stock, `{ "item", "inside": "through", "len_mm": "bore" \| <number> }`, set in the through bar's bore on the mount hole's axis (*2.1*, §4.5); a fastener set is used once per hole of its mount, so its `qty` counts per hole (*2.3*); `requires` [machining on the joined bars, e.g. an end tap M8 plus an access hole: `{ op, on, thread?, d_mm?, depth_mm?, from_end_mm?, at_mm?, at_holes? }`, `on` naming the butting bar, the through bar or each; `at_mm` or `at_holes` its positions (*2.3*, below)]; `spacer_mm`; `overhang_mm`, how far a butting end face may reach past the face it bears on before a warning (*2.3*, §4.5); `body` (a cube's box); `pivot` { `height_mm`, `end_mm`, `range_deg` } (hinges); `splice` { the stud or plates, the tap it needs, `at_mm`: each stud's core (*2.3*) }; `recipe: true` for a joint recipe (*2.3*, below) |
| **fastener** | `subtype` (screw, bolt, nut, washer, t-nut, hammer-screw, insert, stud, …; *2.3*), `thread`, `length_mm`, `head` (DIN/ISO), `class`, `material`, `torque_Nm`, `dims` (published dimensions under the standard's letters; *2.3*); T-nuts and hammer screws add `fits` (the systems whose grooves they fit; *2.3*), `groove` and `insertion` (`drop-in` or `slide-in`) |
| **carriage** | `rail_system`; `dims`; the datum `run` (*2.1*): the point that sits on the rail's running-face centre line (§4.7); usually `clone_of` an item in a reference catalog (§3.2) |
| **accessory** | feet, casters, handles: a free-text `subtype`, `thread`, `fits`, `dims` |
| **panel** | sheet stock: `thickness_mm`, `material`; sheet sizes are offers. No mass field: its mass follows from its thickness and its material (*2.3*) |
| **generic** | name, a `category`, mass, bounding box, `dims`, offers, an optional mesh. Orderable. Everything that fits no other kind: electronics, tools, finished goods, cable chain, ball screws, bearings, pulleys, belts, couplings (about 200 of Forseti's 495 products; *read: review B3*) |

**Fit is judged by role** (*2.3*; acceptance gap A1). A butting bar is held at its end by its
system, which the connector's `fits` must name. The through bar is held by its system, or **by its
bore**: the fastener set chosen for a mount sets a sleeve in it (`inside: "through"`), and the
sleeve then needs the through bar hollow (`tube` or `rhs`). Each mount's set is the one keyed by a
system of a joined bar that `fits` names, the through bar's first. A butt `held_by` another holds
its through bar a third way, by that butt's through-fastener (*2.3*; gap A9; §4.5). A bar held no
way is a `fit` error naming it. `fits` stays the one authority on systems: a set keyed by a system
outside it is not a way to fit (`catalog check` warns on it), and a `requires` hole in the through
bar does not hold it (a T-slot bracket that drills its through bar still holds it by its groove).
Draft 2.1's rule, that every joined bar carry a system `fits` names, let no connector with a mount
sleeve derive cleanly, since a tube or an RHS has no system (G30).

**Joint recipes** (*2.3*; gap A2). A connector with `"recipe": true` is a joint with no body of
its own: studs in tapped cores, a screw into a core, a bush and a sleeve. It has no `mass_kg`,
`bbox_mm`, `datums`, `body` or `mesh` (the schema refuses them), and no offer or kit sells it
(`catalog check` refuses one). It keeps `fits`, `mounts`, `requires` and `splice`: its fastener
sets, sleeves, splice parts and machining are generated and billed as any connector's; the recipe
itself is not bought (§5.4). It cannot be a part or a butt's through body, having no box.

**Where `requires` machines** (*2.3*). Once per butting end. An end tap goes in the butting end, an
access hole on the butting bar's `+y` face `from_end_mm` in from that end. A hole on the through
bar goes where the butting bar's centre line, moved by the spacer, meets the face it butts into;
for a butt through the through bar's **end** (§4.5), into that end face at that point: an **end
hole**, listed with its offset from the section's centre (gap A4; G31). A hole with no
`depth_mm` goes through. A hole that falls off the end face is a `connection` error. An end tap a
connector asks of the through bar's end stays at its centre.

**An end hole follows its fastener's axis** (*2.3*, after acceptance run 4; G35). Where the
connector also taps the butting end at the hole's place (an `end-tap` `on` the butting bar or
each, at the same position), the hole is the clearance for a screw into that tap, and the screw
runs along the butting bar's axis through the position. The hole enters the end face where that
line meets it and runs to the other end face, or to its `depth_mm`; it reports where it comes out
(its exit, from the section's centre at that end) and its angle to the end face's normal. Any
other end hole runs along the through bar's axis, as A4 made it. Either must stay in the block:
a screw whose axis leaves the section's box by a side before it gets there has no hole, and a hole
whose wall (r·√(1 + tan²) across the tilt) breaks out of a side is made and reported, each a
`connection` error that says where. A hole in the through bar's **side** is drilled square to its
face, so a screw into the butting end that meets the side at an angle is a `connection` error and
makes no hole (v1 drills no angled side holes). A tapped end hole at an angle runs across the
cores, a `machining` error.

**Positions** (*2.3*; gap A8, G34). A requirement may give `at_mm`, a list of `[x, y]`, or
`at_holes`, the index of a mount whose holes' x and y are its positions (the mount's plane square to
the connector's z). It makes one op at each; with none, one op where the paragraph above puts it. v1
does not place a connector (§4.5), so positions are read in the **butting bar's section**, from its
box centre, at either end: the frame the cut list states an end tap's or an end hole's place in
(§5.3); a connector is not turned to suit the end. Positions lie in the joint's plane: an end tap
stands at its position, in the butting end or in the through bar's end; a hole in the through bar
stands where the line along the butting bar's axis at that position, carried by the spacer, meets
the face it butts into, or the end face. A hole in the butting bar's side takes none (it stands
`from_end_mm` in from the end), nor does a pivot's base. A position off the butting end's section,
or whose hole misses the face, makes no op and is a `connection` error. A **splice** taps one core
per stud in both spliced ends: at the positions of its `at_mm`, else each at the centre, where
several coincide (§5.5). `catalog check` warns about a splice whose studs have no positions and
refuses one whose positions do not number them. Every tap into a bar's end, a requirement's end
tap or tapped end hole or a splice's tap, is then checked against the cores of its bar's section
(§3.5): one on none of them is a `machining` error naming the nearest, and so is one on a core its
thread does not fit (*2.3*, §5.5).

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

**Generators**: `tslot` (overall size, the groove from its groove type, one groove centred per
face by default, a list of core `bores`, each with its diameter, which are the section's cores
where an end tap is cut, §5.5, *2.3*), `rhs` (with corner radii), `tube` (round), `rod`,
`threaded-rod` (nominal for drawing, stress area for properties), `flat`, `angle` (rolled, with
root and toe radii), `rail` (envelope from published dimensions). A local steel catalog then needs
no outline files. Arcs are flattened at a fixed 0.5° step, which keeps the error relative: 0.0025 %
of a circle's I at any radius, where a fixed chord tolerance grows as the radius shrinks (*2.3*;
*measured by M1*).

**v1 limit** (*2.3*): the `tslot` envelope is its box less its slots, with no `wall` parameter,
and there is no `channel` or `beam` generator yet: such a section is `exact`, `traced` or `box`
until one is added (v1.1 or later).

**Cut lengths use only the bounding box** (§4.5), which a T-slot's published overall size gives
exactly. So every profile can join the cut list as soon as it has a `parametric` section; fidelity
affects only drawing and computed properties.

**Datums** are named points a section may declare: a rail's mounting face centre, an angle's
heel. An anchor may name a datum (§4.4).

**Cores** (*2.3*) are the bores an end tap is cut in (§5.5), each a centre, the diameter the
vendor prints and, optionally, `threads`, the threads the vendor labels it with: a `tslot`'s
`bores`, or a drawn section's `cores`,
`[{ "at_mm": [x, y], "d_mm": 13.7, "threads": ["M16"] }, …]`, which must each be a hole of its
outline, the hole's inscribed circle about that centre its diameter within 0.1 mm on the radius.
A label is the drawing's ("Ø13,7 (M16)") where it prints one, else the vendor's product text
("Centro permite rosca: M5 / M6"), so a core may have several. A section lists every
core its drawing shows: the module cores and, on Forseti's base-40 profiles, the Ø5 (M6) corner
holes 4.5 mm in from both faces (the 80x80 básico's four Ø13.7 at (±20, ±20) and four Ø5 at
(±35.5, ±35.5), and no core at its open centre). A drawn section's holes alone do not say which
is a core, a keyed bore and a square pocket look alike to geometry, so the Forseti importer takes
the holes whose inscribed circle is a printed diameter and checks their count against the page
([notes](notes/section-cores.md)). A box section, or one that lists none, has no known cores.

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
relates bars and decides end planes or contact. An *end plane* is where a bar is cut. A *run* is a
line of bars joined end to end by splices (§4.3). A *layer* is a body a fastener passes (§4.5).

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
in `nodes`, `bars`, `runs`, `connections`, `parts` and `patterns` take `label`, `tags` and
`only_in` (§4.10). Draft 2.1 adds two top-level keys, in schema order: `runs` after `bars` (§4.3)
and `price_bands` after `costs` (§4.11).

### 4.3 Points and stations

A **point** appears wherever a position is needed (a node, a bar end, a plane):

| Form | Meaning |
|---|---|
| `"n4"` | a node: a named point that several entities share |
| `[x, y, z]` | an inline point; numbers or expressions. A bar end with no node |
| `{ "on": <station> }` | a point on a bar (below); it follows the bar |
| `{ "pivot": "c4" }` | the pivot point of a `pivot` connection (§4.5) |
| `{ "len_mm": 300, "dir": "+x" }` | end `b` only: a free end at a length along a world axis or a vector, from end `a`'s design point. With `"from": "a.cut"` (*2.1*), from the point where end `a`'s plane crosses the design line, so a square-ended bar's cut is `len_mm` (G21). Nothing may depend on such an end's design point (no node, no station measured from `b`); it is an end provider (§4.5) |

A **station** is `{ "bar", "at_mm", "from", "face" | "groove", "off_mm" }`:

- `bar` may name a run (below).
- `at_mm` from the bar's design point `a` (default) or `b`. Points that other bars depend on may
  only use design points, so geometry never depends on a cut (no cycles). Parts, which nothing
  depends on, may also measure from a cut end: `"from": "a.cut"` (§4.7). The only other places a
  cut feeds geometry are a free end counted from the cut (above) and the end providers of §4.5,
  which are bounded so that stage 3 never iterates.
- `face` (`+x`, `-x`, `+y`, `-y`, section-local) moves the point to the centre line of that face
  of the placed section; `groove` (`+y.1`, `+y.2`, numbered by increasing section coordinate) to
  the groove's centre line; `off_mm` [u, v] then moves it across the face and along its normal.
- **The signs of `off_mm`** (*2.1*): u runs along local +x on the `±y` faces and along local +y
  on the `±x` faces; v runs along the face's outward normal. A groove takes its face's u and v.
  `stations.across_mm` (§4.5) uses the same u. A station with no face or groove is on the design
  line, and its `off_mm` is [local x, local y] (*2.3*).

**Runs** (*2.1*). `"runs": { "r1": ["b6", "b7", "b8"] }` names collinear bars joined end to end by
`splice` connections, listed in order and all pointing the same way (each `a → b` along the run),
so a face name means the same on every piece. A station on a run measures `at_mm` from the first
bar's design point `a` (or, with `"from": "b"`, from the last bar's design point `b`) and resolves
onto the piece whose design segment holds it; its face, groove and offset are that piece's. A
station on a joint, within `tol.len`, is an error: name the piece instead. A pattern's `along`, a
`rail_holes` selection and a `face` connection's layer may also name a run (§4.5, §4.7). A run
whose bars are not spliced in order, or point different ways, is an error.

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

**Equivalent rolls** (*2.1*). On a section symmetric about both axes, rolls 180° apart (and 90°
apart on a square one) place the same body but name its faces differently, and anchors, stations
and `ops` use those names. So canonical form never normalises a roll: changing it is an edit that
rewrites those references, as `reverseBar` does. Writers (the draw tool, importers, converters)
use the smallest roll in [0°, 360°) that places the body with the faces they mean. Two documents
that differ only this way derive the same outputs.

**Machining** a person adds goes in `ops`
(`{ "op": "hole", "face": "+y", "at_mm": 20, "from": "a", "d_mm": 7 }`); connections, rails and
connectors generate more (§5.1). A hole goes through the whole section along the face's normal
unless it gives `depth_mm`, and takes §4.8's hole fields: `d_mm` or `thread`, `csk`, `cbore`
(*2.1*).

### 4.5 Ends and connections (review B1, D14)

**The rule.** Every bar end resolves to **exactly one end plane** (a point and an outward normal)
from **exactly one provider**:

| Provider | Plane |
|---|---|
| a connection that claims the end (`butt`, `miter`, `splice`, `pivot`) | per type, below |
| `ends.<a\|b>.plane`: `{ "point": <point>, "normal": [x, y, z] }`, or `"normal": "<bar>"` (*2.2*) | as given; with a bar, square to that bar's axis: a shoe mitred square to a strut (G27) |
| `ends.<a\|b>.plane`: `{ "face": { "bar": "b2", "face": "+x" } }` (*2.1*) | the unbounded plane of that face of `b2`'s placed bounding box: an end stopped by, or aligned with, a face its centre line misses (G19) |
| `ends.<a\|b>.plane`: `{ "of": "b2.a" }` (*2.1*) | the plane of `b2.a`'s end face (below): a flush end (G18) |
| neither (the default) | through the design point, square to the axis |

For `face` and `of`, the end's outward normal is the plane's normal signed to point away from the
bar; a plane parallel to the axis within `tol.ang` is an error. Two providers on one end are an
error naming both. The end then falls back to the default, so the bar still draws.

Two **modifiers** apply after the provider, with any of them:

- `cut`: `angle` (cut on the plane) or `square` (cut square at the plane's nearest point, so no
  part of the bar crosses it). Required when the plane is not square to the axis within
  `tol.ang`; an undeclared angled end is an error, and the end falls back to the default.
- `extend_mm`: moves the end along the axis; positive is outward (longer).

An end's **end face** is the plane the bar is finally cut on: the provider's plane after both
modifiers (a `square` cut makes it square to the axis), with the end's outward normal.

**What planes are built from.** A bar's **infinite prism** is its placed section's bounding box
swept along the bar's axis line, **unbounded in both directions**. It has side faces only, with no
end caps, so a point at the very end of a design line is still inside it. A bar's **centre line**
is the axis through its placed bounding box's centre, not its design line: an eccentrically
anchored bar's centre line is offset from the design line (G3). It is the **bounding box**, not
the outline: an RHS's corner radius or a T-slot's groove never moves a cut. (Contact between a
`face` connection's layers reads the outline's inner faces as well: *2.3*, below.)

**Placement and end providers** (*2.1*). Most planes depend only on placements, never on another
bar's cut. A bar bearing on another bar's end, or flush with it, needs one bounded exception:

- **Placement providers** depend only on placed sections and points: the default,
  `ends.<x>.plane` as `point` and `normal` or as `face`, a `butt` through a bar's side faces or
  through a body, `miter`, `splice`, `pivot`, and a through bar's own end (`cover`, `node`). A
  `normal` that names a bar reads only that bar's axis, which its design points fix (§4.3), so
  it stays a placement provider (*2.2*).
- **End providers** read an end face: a `butt` whose `through` names an end, `ends.<x>.plane` as
  `of`, and a free end counted from the cut (§4.3), which reads its own end `a`.

Stage 3 resolves every placement provider, with its modifiers, first; then every end provider,
from those results. That is two sweeps and still no iteration. An end provider that reads an end
resolved by another end provider (a chain) is an error naming both, and its end falls back to the
default (G20).

| Type | Takes | End planes | Valid when (otherwise an error) |
|---|---|---|---|
| `butt` | `through`: a bar; a bar's end, `"b7.b"` (*2.1*); or `{ "body": <item>, "at": <point or pose> }`; `ends`: the butting ends; `connector`, `qty`, `spacer_mm`; `held_by` (*2.3*, below) | each butting end: the first face of the through prism that the butting bar's centre line crosses, travelling from the bar's other end toward this one. Through an end: that end's end face, its normal reversed (G17). Then moved by `spacer_mm` (from the connector, or given) along the through face's outward normal, toward the butting bar: a spacer is a layer of that thickness between the faces (*2.1*). A butt needs no node: the plane follows the through bar | the centre line crosses a face, not within `tol.len` of an edge. Through an end: it crosses the end face inside that bar's infinite prism, not within `tol.len` of a side face, and that end's provider is a placement provider |
| ↳ the through bar's own end | `through_end`: `cover` (default), `node`, `none`; claimed automatically when a through end's design point coincides with a butting end's (a corner), or named: `{ "end": "b", "mode": "cover" }`. Not with an end as `through` | `cover`: the farthest face, along the through bar's axis, of the butting bars' prisms that its centre line crosses (flush outer corner). `node`: square at its design point | `cover` that crosses no prism falls back to `node` with a warning |
| `miter` | two ends | both on the bisector plane through the crossing point of the two centre lines; a miter is itself the declaration of `cut: "angle"` on both (*2.3*) | the centre lines cross within `tol.len`; same section, and the two placed sections mirror each other across the plane within `tol.len` |
| `splice` | two ends, end to end; `connector` (a stud in tapped cores, or union plates), `gap_mm` (default 0) | square planes at the shared design point, `gap_mm` apart | collinear within `tol.ang` and `tol.len`; same item and placement |
| `pivot` | `base`: a station on a face; `axis`: `along` or `across` the base bar; `connector` (with `pivot`); `ends`: the bars it carries | pivot point P = base point + `pivot.height_mm` along the face normal. Each carried end is cut square at `pivot.end_mm` from P. **Static**: the angle follows from the geometry; nothing moves (motion is v3) | each carried end's design point is `{ "pivot": <this connection> }`; the angle is inside `pivot.range_deg` (a check) |
| `face` | `bars`: two or more layers, ordered head to nut: bars, runs, or parts holding a plate (*2.1*); `gaps_mm` (one per adjacent pair, default 0); `faces` (optional: the facing pairs are found); `fastening`: `none` (resting), `bolt` (through every layer), `tnut`, `screw` (tapped into the last layer); `fastener`; `stack`; `stations`; `tap_depth_mm` | **none**: a face connection never changes a cut | each adjacent pair has faces (bounding or inner, below; *2.3*) that are antiparallel within `tol.ang` and coplanar within `tol.len`, or apart by that pair's `gaps_mm`, and that overlap |

`tee` and `cube` from draft 1 are both `butt` (review n5): a tee is a butt onto a span, a cube a
butt into a body. A **lap** is a `face` connection. A bar **resting on** another is a `face` with
`fastening: none`, placed by a station on the lower bar's face (§4.3) with the upper bar anchored
on its `-y` face. Face connections check contact; they do not move bars, since v1 has no
constraint solver.

**A butt's connector** (*2.3*). A butt counts its `connector` once per butting end, times `qty`;
`defaults.butt` supplies it when the connection names none, and may give `overhang_mm`, the
overhang a butt whose connector gives none allows (below). Its fastener sets, sleeves and
`requires` machining are generated with it, and it must fit the joined bars by role (§3.4).
**v1 limit**: a butt's connector is counted, not placed, so it is not drawn, its mount's frame is
read in the butting bar's section and not turned to suit the end (§3.4, positions; *2.3*), and a
mount sleeve has no position along the joint's axis: it is cut to its length and drills no wall
(v1.1 or later, with a rule that places it).

**A through-fastener for two ends** (*2.3*; gap A9, G33). One stud through a bar, in one sleeve,
into a bush in a butting bar on each side is two butts, a connector each: the holder, whose
connector passes a **through-fastener** (a sleeve in the bore, or a `through-hole` it requires
through the bar with no depth), and a butt that names it in `held_by`. The holder butts through the
side of the same bar and is held by nothing itself. Each held end is **coaxial** with one of the
holder's ends (centre lines parallel within `tol.ang`, within `tol.len` of each other) and bears on
the bar from the far side; each holder end holds one end; the held butt's own connector passes
nothing through the bar. The held butt's through bar is then held (§3.4), and each butt still counts
its own connector per end, so the stud, the sleeve (`bore` long) and the hole through both walls
come once, with the holder, and each end brings its bush and tap. Anything else (not a butt, a
chain, another bar, ends not coaxial or on one side, a holder end holding twice, the held butt's own
through-fastener) is a `connection` error on the held butt, which then holds its through bar in no
way of its own. `held_by` is a whole reference (§6). Derive does not size the shared stud: it counts
the catalog's, and the stud's length check is v1.1 with the others (call 25); the span it crosses is
the distance between the two butting end faces. One butt with two coaxial ends and a stud end on
each is what it says: two studs and two sleeves, and the hole through the bar made twice, a
`machining` error (§5.5).

**A butt through a body** (*2.1*): the body is any item with a bounding box (a connector, a
placeholder, a generic or a plate), at a point or at a pose `{ "pos", "rot_deg" }` as parts take
(§4.7). Its box's faces act as the through prism's (G5). The body is drawn and counted with the
connection; it is not also a part. A project placeholder serves (*2.3*; gap G-B): its `bbox_mm`
is read as a catalog cube's, from its `mount` datum when it has one, so bars bearing on a motor
not yet chosen follow its box (G28). An item with no box is an `item` error, and the ends stay at
their design points.

**Bearing on an end** (*2.1*). A strut that bears at an angle on a block's end face names that end
as `through` (G17). A connector's hole in the through bar is then an end hole, into that end face
along its fastener's axis (*2.3*; §3.4, G31, G35). A **shoe mitred square to a strut** (*2.2*) is cut on
`ends.<x>.plane: { "point": <point>, "normal": "<strut>" }` with `cut: "angle"`, and the strut's
end butts through the shoe's end, with an end plate as `spacer_mm`: the shoe's cut follows the
strut's angle and the strut's length follows the shoe (G27). The reverse, the shoe's end
butting through the strut's end, suits a strut whose length is the input. A flat bar whose ends
are flush with a beam's cut ends takes `ends.<x>.plane: { "of": … }` (G18), so it follows when
the beam's cut changes.

**An end face on its face** (*2.3*, after acceptance run 4; G36). A butt places each butting end
on the first face its centre line meets, and checks that line; the end face must then sit on that
face. On the trimmed bars, the butting **end face** is its section's outline with its grooves
closed (A3), on its end's plane; the **face** it bears on is a side of the through bar's box,
whole across (a grooved side is its bounding plane, A3) and trimmed by its end faces, or the
through bar's end face, its outline with its grooves closed, or a side of a through body's box.
Both are seen along the face's normal.

- The **overhang** is how far the end face reaches past the face: the greatest distance of one of
  its vertices from the face's outline, with the area of it past the face. Past the connector's
  `overhang_mm`, else the project's `defaults.butt.overhang_mm`, else 0, by more than `tol.len`, a
  `connection` warning naming how far, how much and the limit. A spacer is taken to be no larger
  than the face; an end plate that is says so with its `overhang_mm`.
- The **overlap** is how far the butting bar's body (its outline, grooves closed, between its end
  faces) goes into the receiving body (the through bar's box between its end faces, or the body's
  box) beyond the face's plane: a linear programme over the convex pieces of both. More than
  `tol.len`, a `connection` error. Only the joined pair is checked: two members that cross
  elsewhere are a clash check v1 does not make.

`derive --json` gives every seat under `butts`, per connection and butting end: the face, the end
face's area, the overhang and its area, and the overlap.

**The faces of a layer** (*2.3*; gap A3). A bar's faces are its four **bounding faces**, the sides
of its placed bounding box, which §4.3 names, and its **inner faces**: the straight runs of its
section's outline (the outer ring) that lie off the outline's own sides, such as an angle's
inside leg faces or a channel's inner flange and web faces. On a side where the section declares a
groove, the outline's excursions from that side and back (the grooves, any marks rolled into it)
are part of that face, so a T-slot's grooved face is its bounding plane; an excursion from an
ungrooved side (a channel's open side) stays open. "On a side" uses the outline's own extremes,
within `tol.len`, since an outline drawn on a stroke's centre line sits a little inside its
nominal box. Holes are not faces: a tube's bore and a T-slot's core are nothing a layer bears on.
A part's faces are its box's six. Contact is tried on the bounding faces first, in a fixed order,
then on pairs with an inner face, so every pair that met before 2.3 meets on the same faces. Draft
2.2 never said which faces; the build had read only the box's sides, so a block on an angle's
inner leg could not be a layer, and a bolt through the leg's outer face ran through the angle's
whole box (G29). `faces` names bounding faces only; derive reports an inner face by the side it
faces and its plane's section coordinate (`+x@-31.75`), or an oblique one by its normal.

**A multi-layer joint** (*2.1*) is one `face` connection. A bolt through strap, packer, beam,
packer, strap lists all five in `bars`, so a packer cut to length is both a bar on the cut list and
a layer. One fastener per station passes every layer, and each adjacent pair is checked for
contact, or for its declared gap (G25).

**Stations of a face connection** are on the first layer: `at_mm`; a `rail_holes` selection
(§4.7), each selected hole's position projected onto the first layer's design line, which must be
parallel to the rail within `tol.ang`; or a pattern (§4.7). `across_mm: [u…]` (*2.1*) adds
offsets across the first layer's face, in §4.3's u, and puts one fastener at every pair of an
`at_mm` and an `across_mm`: `{ "at_mm": [100, 300], "across_mm": [-15, 15] }` is four fasteners.
When a layer is a run, each station's layer is the piece that holds it. A station sits on the
first layer's face toward the second (*2.3*). On an inner face it lies on the face's plane level
with the box's centre (the foot of the perpendicular from the box's centre line), and
`across_mm` moves it along §4.3's u as on the bounding faces parallel to it; it must lie on the
face, within `tol.len`. Level with the box, not the face's own middle, because the middle depends
on root and toe radii that are often estimated, and a leg's two faces then share one hole line.
A station that misses a layer is an error.

**Fasteners and stacks.** At each station sits one `fastener`: a catalog fastener, or a piece cut
from bar stock (*2.1*), `{ "bar": "std:DIN975-M10", "len_mm": <expr> }`. A cut piece goes on the
cut list and is nested in its item's stock like any bar (§5.3); it is drawn on the station's axis,
centred on the layers, and needs no bar of its own. `stack` lists the loose hardware from head to
nut (washers, nuts); for a rod, the head side is the first layer's. A stack entry may also be a
**sleeve** cut from bar stock and set in a hollow layer's bore (*2.1*):

```json
{ "item": "std:TUBE-18x2", "inside": "b4", "len_mm": "bore + sec(b4).t_mm + 2.5" }
```

It sits on the fastener's axis, from the inner face of the hollow layer's wall on the nut side.
In `len_mm`, `bore` is that layer's inside depth along the fastener's axis, after swaps, so this
sleeve crosses the bore and the head-side wall and stands 2.5 mm proud of it. The sleeve goes on
the cut list. `inside` must name one of the connection's hollow layers (`tube` or `rhs`). A
stack sleeve may add `clearance_mm` (*2.3*), an expression, for the holes it passes (below). A
connector's `mounts` may list sleeves the same way (§3.4). The stack's items count once per
station; a fastener and each sleeve cut from stock are pieces `<connection>.f<k>` and
`<connection>.s<n>`, numbered in station order (*2.3*).

**The fastener's walk** (*2.3*; gap A3). The fastener enters each layer by its contact face with
the layer before and leaves by its contact face with the layer after. The first layer's head side
and the last layer's nut side are the nearest face **across the layer's material** that faces out
along the axis and holds it: the far side of an angle's leg or a channel's flange, and, for a
box-like section, its opposite side. Every face the axis passes must hold it. So a bolt
through an angle's leg passes the leg, not the angle's box.

**Generated holes** (*2.1*, §5.1). A `bolt` gets a clearance hole (ISO 273, medium series) in
every layer it passes, both walls of a hollow one. A `screw` gets the same clearance in every
layer but the last (*2.3*), and a tapped hole of its thread in the last layer at each station:
through that layer (its near wall, if hollow), or to `tap_depth_mm`. A `tnut` drills nothing in
the last layer; its station must land on a groove of the facing face, and its T-nut must fit that
groove by `fits` or by groove type (*2.3*). Grooves lie on bounding faces only, so a `tnut` whose
last layer meets the stack at an inner face is a `fit` error. A rail layer is not drilled where
the station is one of its own holes (*2.3*). A solid layer's hole is listed from a bounding face
(§4.4 names four): the face the fastener enters by, else the face it leaves by, else a bounding
face parallel to either across open air (an I-beam's web); it takes `depth_mm` when more of the
section stands on its axis than the layer the fastener passes, as a channel's other flange does
(*2.3*, G29). A counterbore needs its own end's face; when none fits, a `face` error.

**A hole a sleeve passes** clears the sleeve (*2.3*; gap A7): ISO 273 medium for a shank of the
sleeve's outside diameter, the series the bolts of the joint take; between two of the table's
diameters, the next one up (17.2 → 20; *inferred*: the next row never clears less than the
standard does for the smaller shank); past its 150 mm, no default, and an error asks for
`clearance_mm`. With `clearance_mm` the hole is the outside diameter plus that; 0 restores the
line-to-line hole, and a negative one is an error. A layer the sleeve enters part way is
counterbored to the same diameter, as deep as it enters. Draft 2.1 drilled the outside diameter
exactly, a line-to-line fit no shop drills (G32). The default is call 31; a shop that drills its
own allowance (2 mm on 16, Ø18, where ISO 273 medium gives 17.5) writes `clearance_mm: 2`.

Derive reports the **grip** at each station: the depth of every layer along the fastener's axis,
between the faces of its walk (a hollow layer counts its whole outside depth), plus the declared
gaps. For a `tnut` the last layer counts only to the lip of the groove its T-nut enters; for a
`screw` the tapped last layer does not count. It also reports the fastener's **length through the
layers** (*2.3*), from the face its head bears on to the last layer's far face, which for a bolt
equals the grip and is where a length check would start. The stack is listed beside the grip.
Adding the washers and checking the fastener's length are v1.1 (review m15, call 25).

**Seats** (*2.3*, after acceptance run 4; G37). The head bears on the first layer's face of the
walk, and a bolt's nut on the last layer's. At the head bears the fastener's head, or, for a
fastener with none of its own there (a rod cut from stock, a hammer screw, whose head is in the
groove), the stack's first nut; at the nut, the stack's next nut. The stack's first washer goes
under the head and the next under the nut, its outside diameter replacing what it is under. Each
bears on the **annulus** from the hole (ISO 273 medium for the thread, or the washer's bore if
wider) out to its bearing diameter: the item's `dw_mm`, else a round head's `dk_mm` (ISO 4762),
else a hex head's or a nut's `s_mm` across flats (ISO 4017, ISO 4032); a washer's `d2_mm`. The
face's **material** is a bar's side less every opening in it: where the section's outline, read
0.1 mm below the face, is not there (a T-slot's groove between its lips), and each groove's
opening from its groove type; an inner face or a part's face is whole, and a face ends at the
bar's end faces. The fraction of the annulus on material is reported per station; below half,
a `fit` warning with the fraction; on none, a `fit` error (a head wholly over an opening or off the
face). The threshold is geometric (loads are v2). A part that gives no bearing diameter is not
checked: one info per item, naming its connections. **v1 limit**: a butt connector's screws are
not checked, since its fastener sets do not say which part bears on which face.

**Reported per bar:** `cut_mm` (the long-point length: the longest of the box's four edges between
the end faces), `centre_mm` (along the bounding-box centre line), `short_mm` (the shortest edge),
with an angled end `span_mm` (*2.3*: the span, from one end's long point to the other's along the
axis, what is ordered and nested, §5.3), and per end the move from its design point, the angle
between the plane's normal and the axis, and for a compound cut its mitre and bevel components.
An end that moved further than the through prism's depth plus the spacer warns "end far from its
face", which catches a node left behind by an edit. The distance is the design point's from the
plane along the face's normal (*2.3*), since an angled brace moves a long way along its own axis
without being far from its face.

**Default connection.** When the draw tool closes on a point, `autoConnect` adds a `butt` with the
project's default connector. The through bar is the one that passes through the point; else a
vertical; else the lowest id. Its end, if any, covers. Ends some connection already claims are
left alone. All of it can be changed. In the draw tool it is a check box, on by default, and it
does nothing where nothing butts (*2.3*). Because a vertical wins, a rail drawn onto a post's top
butts into the post; a frame whose posts stand under its rails is drawn with it off and joined
with Connect. Whether the rule should change for that case is open (call 6).

### 4.6 Golden cases (review B1)

Each row is a small document in `tests/fixtures/golden-ends/` with its expected outputs. M3a is
done when all pass to 0.01 mm (§12). 40x40 sections, centre anchors, square cuts and lengths in mm
unless stated. Values were worked by hand and re-computed with a script (verified 2026-11-26;
G17–G26 for draft 2.1 the same way, with G6 recomputed by the same script as a control; G27 for
draft 2.2 by `golden-ends/G27/by_hand.py`). G28–G34 (*2.3*) came with the build (M6 and the
gaps the acceptance's two runs found); each fixture's `by_hand.py` works every number with plain
arithmetic and imports nothing from AluKit, and the values below are copied from each fixture's
`expected.json`. No value of G1–G27 changed in the build, nor of G28–G32 after the second run
(*verified*: the golden tests). G35–G37 (*2.3*) came with the fourth run's gaps
([f2](notes/f2-joint-geometry.md)), with hand scripts as above, and no earlier value moved
(*verified*): G31's spacer case gains a `connection` error (its hole breaks out of the block's
side), and the overhang warning appears where the end faces really reach past their faces: G2,
G17 and its two cases, G27 with n1 at z = 100, G31's three cases and G35's. A row's expected
diagnostics are its errors; warnings are listed where they are the case. G38 (*2.3*) came with gap X4 the same way, and no value of G1–G37
moved with it (*verified*: the golden tests, and a scan of every fixture's spans, x4).

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
| G12 | a line (0,0,0)→(5000,0,0) split at 2500 by a `splice` | splice planes | 2500.00 + 2500.00; with `gap_mm: 2`, 2499.00 + 2499.00 |
| G13 | rail (0,0,H)→(1200,0,H), H = 900; post (640,0,0)→`{on: {bar: rail, at_mm: 640}}`; butt through the rail; then H = 1000 | a point on a span follows its bar | post 880.00, then 980.00 |
| G14 | post (0,0,0)→(0,0,2000); horizontal (0,0,0)→(2000,0,0); a brace between two `pivot`s: base 1 on the post's `+x` face at 1500, base 2 on the horizontal's `+y` face at 1000; pivot height 15, end distance 25 | cut square between pivots | 1704.27; with `extend_mm: -2` at both ends, 1700.27 |
| G15 | a butting bar whose centre line misses the through bar | validation | error |
| G16 | RHS 100x50 (outer radius 6), along +X, 100 tall; one 40x40 butting from +Y and one from below, both with their design point on the RHS's centre line | the bounding box, not the radius | trims 25.00 and 50.00 |
| G17 | block b1 (0,0,0)→(1000,0,0), default ends; brace b2 (2600,1200,0)→(1000,0,0); `butt` through `b1.b`, brace `cut: "angle"` | an end bearing on another bar's end face, at an angle | b1 1000.00; b2 long point 2015.00, centre line 2000.00, short point 1985.00; 36.87°. With b1.b `extend_mm: 20`: b2 centre line 1975.00 (the end face after its modifiers). With `spacer_mm: 8`: 1990.00, along the face's normal (along the brace's axis it would be 1992.00) |
| G18 | b1 (0,0,0)→(1000,0,0), `extend_mm: -30` at both ends; b2 from `{on: {bar: b1, at_mm: 0, face: "+y"}}` to `{on: {bar: b1, at_mm: 1000, face: "+y"}}`, anchor `-y`, ends `plane: {of: "b1.a"}` and `{of: "b1.b"}` | a flush end follows the other bar's cut | b1 940.00, b2 940.00; with b1's `extend_mm: -50`, 900.00 and 900.00 |
| G19 | c (0,−500,0)→(0,500,0); beam (0,0,100)→(1000,0,100), end a `plane: {face: {bar: c, face: "-x"}}` | a face the centre line misses (along +Y, local x is −X, so c's `-x` face is world X = +20) | beam 980.00. The same end as a `butt` through c: error (G15) |
| G20 | G18 plus b3 (1500,0,40)→(1000,0,40), `butt` through `b2.b` | a chain of end providers | error naming the butt and b2.b's `of`; b3 500.00, at its design point (it would be 530.00) |
| G21 | b2 a = `{on: {bar: b1, at_mm: 500}}` on b1 (0,0,0)→(1000,0,0), b = `{len_mm: 80, dir: "+z", from: "a.cut"}`; `butt` through b1 | a free end counted from the cut | b2 80.00; without `from`, 60.00 |
| G27 | beam b1 (0,0,0)→(1000,0,0); shoe b2 from `{on: {bar: b1, at_mm: 540, face: "+y"}}` to n1 = (540,0,80), `butt` through b1, end b `plane: {point: n1, normal: "b3"}`, `cut: "angle"`; strut b3 (0,0,800)→(600,0,0), `butt` through `b2.b` | a strut bearing on a shoe mitred square to it (*2.2*) | shoe long point 75.00, centre line 60.00, short point 45.00; 36.87°. Strut 900.00, square. With `spacer_mm: 8`: 892.00. With n1 at z = 100: shoe 95.00, 80.00, 65.00; strut 884.00. Strut redrawn (140,0,380)→(620,0,20): shoe 86.67, 60.00, 33.33; 53.13°; strut 500.00. With the normal typed as (3, 0, −4), that redraw is an `angled-end` error on b3.b (16.26°) and the strut is 600.00 |
| G28 | placeholder `motor`, box (−100,0,0)–(100,120,80); `butt` through `{body: "project:motor", at: {pos: (600,0,0), rot_deg: (0,0,90)}}`, ends b1.b, b2.b, b3.b; b1 (0,30,40)→(600,30,40), b2 (540,400,40)→(540,0,40), b3 (560,30,300)→(560,30,0) | bars bearing on a placeholder's box, at a pose (gap G-B, *2.3*) | b1 480.00, b2 300.00, b3 220.00. At the point (600,0,0), unturned: 500.00, 280.00, 220.00. With a `mount` datum at (0,40,0): 520.00, 300.00, 220.00. Moved to (600,0,−20): b3 240.00. A project item with no box: an `item` error on c1, each end at its design point (600.00, 400.00, 300.00) |

The frame table in §4.4 is the golden set for orientation.

**Generation and cost cases** (*2.1*). M3b's oracle (§12), in `tests/fixtures/golden-gen/`. The
synthetic rail has pitch 60, E 20–50 and one stock length, 1500, whose `factory_E_mm` is 30 (its
centred layout); kerf 3, no end trim. G29–G34 (*2.3*) use their own synthetic catalogs
(`test-open`: the `std` angle's generator parameters, a sharp-cornered channel and an M12 bolt;
`test-joint`: bush ends, a joint recipe, end connectors; `test-stud`: an RHS 200x100x4.75, 40x40
and 80x80 bars with M16 cores, a stud end, a bush end, four-core joints and splices), so they do
not move with the built-in catalogs; so does G38 (*2.3*, `test-span`: a 40 x 40 square bar cut to
length at R$ 126.50/m in 10 mm steps, 40–3000 mm, and in stock bars of 3000 and 6000).

| # | Setup | Rule exercised | Expected |
|---|---|---|---|
| G22 | the rail cut to 1210 from the 1500 stock | holes from a factory end (§4.7) | `factory: "a"`: 20 holes, E_a 30.00, E_b 40.00. `factory: "b"`: 20 holes, E_a 40.00, E_b 30.00. `drilled: true`: 20 holes, E 35.00 at both ends |
| G23 | three pieces of the rail, 470 each, `factory: "a"` | nesting keeps a factory end (§5.3) | two stock bars, two pieces in one and one in the other; each piece 8 holes, E 30.00 at its factory end and 20.00 at its cut end. A plain bar of the same lengths nests into one (3 × 470 + 2 × 3 = 1416) |
| G24 | run r1 = [rail1 (0,0,0)→(470,0,0) `factory: "b"`, rail2 (470,0,0)→(940,0,0) `factory: "a"`], spliced; `rail_holes: {along: r1, every: 2, plus: ["first", "last", "joint"]}`; a part at `{bar: r1, at_mm: 480}` | stations from a selection of holes across a joint; a station on a run (§4.3, §4.7) | 10 stations, at x = 20, 140, 260, 380, 440, 500, 620, 740, 860, 920; the part on rail2, 10 from its a. At `at_mm: 470`: error (on the joint) |
| G25 | a `bolt` through five layers, head to nut: flat 50x10, flat 50x20, RHS 100x50x4 across its 50, flat 50x20, flat 50x10, `gaps_mm: [0, 0, 0, 0.5]`; fastener `{bar: <M10 threaded rod>, len_mm: 140}`; stack: washer, nut, washer, nut; sleeve `{item: <tube 18x2>, inside: <the RHS>, len_mm: "bore"}`; stations `{at_mm: [100, 300], across_mm: [-15, 15]}` | a multi-layer joint; a fastener and a sleeve cut from bar stock; stations across a face (§4.5) | 4 fasteners; grip 110.50; cut list 4 × 140.00 rod and 4 × 42.00 sleeve; 8 washers and 8 nuts; 24 holes of Ø11 (4 in each of the four solid layers, 8 in the RHS's two walls) |
| G26 | `price_bands: [{supplier: S, low_pct: -10, high_pct: 25}]`; two lines of S at likely R$ 156.86 and R$ 10.05; a third line of S, 2 units of an offer priced `regular_minor: {v: 5000, low: 4500, high: 6000}` (R$ 50.00, 45.00 to 60.00) | a band on minor units, rounded once, half away from zero; an offer's own range wins (§4.11) | 156.86: low 141.17, high 196.08 (19,607.5 minor units rounds up). 10.05: low 9.05 (904.5 rounds up; round-half-even would give 9.04), high 12.56. Third line: low 90.00, likely 100.00, high 120.00 |
| G29 | angle L76.2x6.35 (root 9.525, toe 4.76) b1 (0,0,0)→(300,0,0), anchor `heel`; a 40x40 b2 (0,26.35,50)→(300,26.35,50) on the upright leg's inner face; `face` [b1, b2], `bolt` M12, `at_mm: [100]` | a layer on an inner face; the walk through the material (gap A3, *2.3*) | in contact on the leg's inner face (`+x@-31.75`); station (100, 6.35, 38.10); grip 46.35, and 46.35 through the layers; one Ø13.5 hole in each, the leg's from its outer face. On the outer face (b2 at y = −20): grip 46.35, where the angle's box gave 116.20. 0.1 mm off the inner face: a `face` error; with `gaps_mm: [0.1]`, 46.45. `across_mm: [11.9]`: station (100, 6.35, 50.00). On a channel 100x50x6x8's bottom flange, the block at (3, −22), `across_mm: [3]`: station (100, 3, −42), grip 48.00, the flange's hole 8 deep |
| G30 | RHS 100x50x4 (no system) b1 (0,0,0)→(1000,0,0); 40x40 b2 (500,0,0)→(500,600,0); `butt` through b1 with a bush end whose mount's set, for the 40x40's system, is a bush and a sleeve `{item: tube 18x2, inside: "through", len_mm: "bore"}` | fit by role; a joint recipe (gaps A1, A2, *2.3*) | no error; b2 575.00; one sleeve 42.00; one bush and one bush end. Two butting ends, one from −Y: two of each. Through a T-slot bar: a `fit` error on the through bar, b2 580.00. A T-slot bracket with no sleeve, or an end connector with no mounts, on the RHS: a `fit` error on b1. The bush end on a flat bar of no system: a `fit` error on the flat bar only, and no bush and no sleeve. A sleeve of a fixed length: cut as given (40.00); through a T-slot bar, a `fit` error on it. A recipe with the same mount: the same bush and sleeve, no connector counted, the recipe listed once |
| G31 | block b1 (0,0,0)→(120,0,0); brace b2 (1720,1210,0)→(120,10,0), `cut: "angle"` at b, 10 off the block's centre line; `butt` through `b1.b` with a connector that `requires` a Ø9 hole `on: "through"` | a hole into the end a butt bears on (gap A4, *2.3*) | b1 120.00 with an `end-hole` Ø9 at end b, 10.00 off its centre in x, through, listed "Ø9.00 hole in end a along the axis, at x -10.00, y 0.00 from the centre, through"; b2 long point 2015.00. With `spacer_mm: 8`: the hole 16.00 off centre; b2 2005.00 (centre line 1990.00); its Ø9 wall stands 0.50 past b1's side +x, a `connection` error (*2.3*, after acceptance run 4). A tapped M8 20 deep: the same place, "tap M8 in end a along the axis, … 20.00 deep", and a `machining` error on b1: 10.00 off the 40x40's one core, at its centre, the tap has no core to be cut in (*2.3*, §5.5) |
| G32 | G25's joint with the sleeve's `len_mm: "bore + sec(b3).t_mm"`, so it passes the RHS's head-side wall | a hole a sleeve passes clears it (gap A7, *2.3*) | 4 × 46.00 sleeve; the head-side wall's 4 holes Ø20 (ISO 273 medium for 18), the other 20 Ø11. With `clearance_mm: 1`: Ø19; with 0: Ø18. A 50 mm sleeve also enters the flat below the RHS 4 mm: its 4 holes there Ø11 with a counterbore Ø20 × 4 |
| G33 | RHS 200x100x4.75 (no system) b1 (0,0,0)→(1000,0,0); 40x40 b2 (500,0,0)→(500,600,0) and b3 (500,−600,0)→(500,0,0); c1 `butt` through b1, ends [b2.a], a stud end (a stud, a bush, a sleeve `{inside: "through", len_mm: "bore"}`, an M16 end tap, a Ø9 hole through the through bar); c2 `butt` through b1, ends [b3.b], a bush end (a bush, the tap), `held_by: "c1"` | one through-fastener for two coaxial ends (gap A9, *2.3*) | no error; b2 and b3 550.00; one stud, two bushes; one sleeve 90.50; one Ø9 hole in b1 at 500.00 on face +x; an M16 tap in each butting end; the stud crosses 100.00 between the butting end faces. One butt with both ends and the stud end on each: two studs, two sleeves, the hole made twice (a `machining` error on b1). No `held_by`: a `fit` error on c2. b3 at x = 520: a `connection` error on c2 (20.00 off). A holder whose connector passes nothing through b1: a `connection` error on c2, and c1's `fit` error. The held butt's connector passing its own stud: a `connection` error on c2 (and the hole made twice) |
| G34 | 80x80 bars, four cores at (±20, ±20): b1 (0,0,0)→(600,0,0); post b2 (300,0,0)→(300,0,500), `butt` through b1 with J4 (an M16 end tap and a Ø9 `through-hole` `at_holes: 0`, a mount of four holes at (±20, ±20) with a bush each); post b3 (300,0,500)→(300,0,1000) spliced to b2 with four M16 studs at `at_mm` (±20, ±20) | machining at positions; one splice tap per stud; coincident machining (gap A8, *2.3*) | b1 600.00, four Ø9 holes on face +y at 280.00 and 320.00 from end a, −20.00 and 20.00 across; b2 460.00, four M16 taps in each end at x, y ±20.00 from the centre; b3 500.00, four in end a; four bushes and four studs; no error. Positions as `at_mm`: the same. Each requirement written four times with no position: a `machining` error on b1 and on b2, and a second on b2, its taps at the centre, which is no core (*2.3*). Four studs and no positions: four taps at each end's centre, a `machining` error on b2 and on b3, and a second on each for the same reason (*2.3*). On 40x40 posts: a `connection` error on c1 (the taps fall off the end); b1's four holes stand |
| G38 | 40 x 40 square bars: beams b1 (0,0,0)→(2000,0,0) and b2 (0,0,1040)→(2000,0,1040), their faces 1000 apart; brace b3 from `{on: {bar: b1, at_mm: 500}}` to `{on: {bar: b2, at_mm: 1020}}`, `cut: "angle"` at both ends; post b4 from b1 at 1600 to b2 at 1600; knee brace b5 from b1 at 1200 to `{on: {bar: b4, at_mm: 400}}`, both ends angled; `butt`s through b1, b2 and b4; cut to length, kerf 3 | a piece is ordered, billed and nested at its span (gap X4, *2.3*) | b3 long point, centre line and short point 1118.03 (parallel cuts at 26.57°), span 1138.03 = 1118.03 + 40 · tan 26.57°, ordered 1138, billed 1140, R$ 144.21; b5 549.12, 509.12, 469.12, span 549.12 (a trapezoid), billed 550; b1, b2 2000.00 and b4 1000.00, square; total R$ 846.29, BOM 6687.15. b3's end b on the plane through (1010,0,1020) with normal (1,0,3), leaning as end a does but not parallel: long point 1125.18, span 1130.89. b2 at z = 2720 (b3 to 1860 along it): long point 2996.33, inside the offer's 3000, span 3016.33, a `length` error. From stock bars: 2000 + 2000 + 1138.03 + 549.12 + 3 × 3 = 5696.15 in a 6000, the post in a 3000, R$ 930.00 |

| G35 | 80x80 block b1 (0,0,0)→(160,0,0); 40x80 b2 (1660,−190,0)→(160,10,0), rolled 90°, `cut: "angle"` at b, at tan θ = 2/15 (7.59°) to the block's axis; `butt` through `b1.b` with J2: an M8 `end-tap` on the butting bar and a Ø9 `through-hole` on the through bar, both `at_mm` (0, ±20) | an end hole follows its fastener's axis (*2.3*, after acceptance run 4) | the screw at (0, −20) enters b1's end b at x −10.18 and exits end a at 11.16, 7.59° off square: "Ø9.00 hole in end a at x 10.18, y 0.00 from the centre, 7.59° off square, exiting end b at x -11.16, y 0.00, through"; the one at (0, 20) enters at 30.18 and leaves b1 by its face +x 73.67 mm in (its wall from 39.62): a `connection` error, no hole; b2 1518.61. 20 lower: both holes, at −30.18 → −8.84 and 10.18 → 31.51, no error. With no tap in the 40x80 (J2-H): A4's holes along the axis, at −10.18 and 30.18. `spacer_mm: 8`: the same holes and error, b2 1510.54 |
| G36 | 40x40 b1 (0,0,0)→(600,0,0); post b2 (300,0,0)→(300,0,500); `butt` through b1 | an end face on its face (*2.3*, after acceptance run 4) | flush: 1600.00 mm², no overhang, no overlap. b2 10 across: 10.00 past the face, 400.00 mm² (25.0 %), a `connection` warning; at b1's end with `through_end: "node"`: 20.00, 800.00. With `defaults.butt.overhang_mm: 10` the 10 passes; a connector's `overhang_mm: 5` warns again. A 45° brace to (800,0,500), `cut: "angle"`: 2262.74 mm² on the face; with `extend_mm: 2` it goes 1.41 into b1, a `connection` error |
| G37 | 40x40 b1 (0,0,0)→(400,0,0), its top on the c8 groove (opening 8.2); flat 50x10 b2 under it; `face` [b1, b2], `screw` M8 (head dk 13), `at_mm: [200]` | a head seats on material (*2.3*, after acceptance run 4) | the head on the lips over its Ø9 hole: 45.87 %, a `fit` warning. A washer (d2 16) under it: 53.74 %. An M4 head (dk 7): on nothing, a `fit` error. On the flat bar's face: 100 %. Bolted through two 40x40s with a hex head and a nut (s 13): each 45.87 %, two warnings; with two washers, one under each, 53.74 % |

### 4.7 Parts, rails and patterns (D14)

**Parts** are catalog or project items placed `on` a station (`{ "bar", "at_mm", "from", "face" |
"groove", "off_mm" }`, with `roll_deg` about the face normal), or at a world pose
`{ "at": { "pos": [x, y, z], "rot_deg": [rx, ry, rz] } }` (about world X, then Y, then Z; exact at
multiples of 90°). An item's `mount` datum lands on the station. A part on a bar follows it. A
T-nut is a part in a groove; a carriage is a part on a rail's running face.

**A part's frame on a station** (*2.1*). The item's own frame (§3.2) is laid on the station: its
+z along the face's outward normal (a groove's face, for a groove), its +x along the bar's axis t,
and +y = z × x. `roll_deg` then turns the item about z, and its `mount` datum lands on the station;
a carriage lands its `run` datum instead. At a world pose, the frame is turned by `rot_deg` and the
same datum lands at `pos`. An item with no such datum lands its frame's origin.

| Station on a bar along +X | Item x | Item y | Item z |
|---|---|---|---|
| face `+y` | +X | +Y | +Z |
| face `+x` | +X | −Z | +Y |

**Unplaced lines** (*2.1*). A `parts` entry may be `{ "item", "qty", "unplaced": true, "why" }`:
consumables, sets and kits the model does not place (a set of shims, a threadlocker, spare T-nuts
for light fixings). It is counted and priced, never drawn. `qty` may be an expression; `only_in`
applies. A part's own mounting hardware, such as a carriage's screws into a payload plate, enters
this way in v1.

**Rails** are bars, and their holes come from the cut. The layout follows how the rail is sold
(*2.1*):

| `holes` | Layout |
|---|---|
| `{ "factory": "a" \| "b" }` | a rail sold in stock lengths and cut at the other end. The named end keeps the stock offer's `factory_E_mm` (§3.2); holes follow at the pitch toward the cut end while E there stays ≥ `E_min_mm`. When the item's stock offers differ in `factory_E_mm`, `"stock_mm": 1500` names the length the piece comes from, and nesting keeps it to that length (§5.3), so nesting never moves a hole. A factory end must be square |
| `{ "drilled": true }` | a rail drilled to order: the largest hole count that keeps both E ≥ `E_min_mm`, centred |
| `{ "E_a_mm": 20 }` or `{ "E_b_mm": 20 }` | an override, for a rail already in hand: that end's E, and the layout phased from it |
| absent | `factory: "a"` when the rail's offer sells `stock`, with a warning to name the factory end; `drilled` when it sells `cut` |

Draft 2 centred the holes by default. That is right only for a rail drilled to order: a stock rail
cut at one end keeps its factory layout. A check reports E outside the rail's range at either end.
G22–G24 (§4.6) are the worked cases.

**Patterns** repeat entities and stay live: change the pitch and every copy moves.

```json
"pt2": { "template": ["n20", "b30", "c12", "p40"], "along": "b1", "pitch_mm": 150, "count": 8, "skip": [3] }
```

- The template is real entities at the first station. Copies k = 1 … count − 1 are translated by
  k × `pitch_mm` along the `along` bar's or run's axis (or `{ "dir": [x, y, z] }`), or by the list
  `offsets_mm`. Copies get ids `b30@1`, `b30@2`, …. A part copy on a run lands on the piece that
  holds it (§4.3), so carriages at fixed stops may cross a rail joint.
- References inside the template are remapped in each copy; references outside it are kept.
- `skip` drops stations. `explodePattern` turns copies into ordinary entities when one needs an
  edit of its own.
- `rail_holes` (part templates, and a `face` connection's `stations`, §4.5) puts stations at the
  holes of a rail or a run. `true` takes every hole of the pattern's `along`.
  `{ "along": "r1", "every": 2, "plus": ["first", "last", "joint"] }` (*2.1*) numbers the holes
  along the rail or run from its start and takes every n-th from the first, plus the first and
  last holes and, at each joint of a run, the last hole before it and the first after it (G24).
  The stations follow the rail's layout when it changes. Rail bolts and other hardware at a pitch
  are written once.
- Patterns are translations only in v1. `mirror` and `array` are commands that create ordinary
  entities (§6); a mirrored asymmetric section takes the item's other `hand`, or is an error.

### 4.8 Project items

`items` defines items that exist only in this project, referenced as `project:<id>`:

| Kind | Fields |
|---|---|
| `plate` | `material` (a catalog material), `thickness_mm`, `outline`, `holes` |
| `bent-angle` | two legs, `legs_mm`, each measured to the outside of the other; thickness; the inside `bend_radius_mm`; `k_factor`, required, 0 < K ≤ 0.5 (*2.3*); holes per leg. One 90° bend in v1 |
| `generic` | as the catalog kind, with a price and a supplier (*2.3*: packs and offers belong in a project-local catalog) |
| `placeholder` | name, mass, bounding box, an estimated price. Drawn translucent (hatching is a v1 limit, §8); holds its own order group (§5.5) |

A project item holds **numbers, not expressions** (*2.3*): it is item data, resolved before derive
like a catalog item's, so a parametric plate is a catalog item. Plates and bent angles default to
supplier `local` (made in house), a group of its own in the order; placeholders and generic items
with no supplier go to the unsourced group (*2.3*). A material is a catalog material
(`<catalog>:<id>`), which the lock pins. Each item is validated alone, and a bad one hides no other.

A bent angle's developed length is (a − (R + T)) + (b − (R + T)) + BA, with legs a and b, thickness
T, inside radius R and the bend allowance of its 90° bend, BA = (π / 2) · (R + K · T)
([bending](https://en.wikipedia.org/wiki/Bending_(metalworking)), "Calculations").
The K-factor has no default because published values run 0.3–0.5 by material, radius and tooling,
and the shop that bends the part knows its own; whether to add a per-material default is open
(call 33).

Holes have `d_mm` (through, or blind with `depth_mm`), or `thread` (tapped at its tap drill,
major diameter less the pitch, ISO 261 coarse unless the thread writes it, or at `d_mm` when given;
a thread with no known pitch must give `d_mm`), plus optional `csk` { `d_mm`, `angle_deg` } or
`cbore` { `d_mm`, `depth_mm` } (review B2), never both and neither on a threaded hole (*2.3*).
`face` is `front` (default: a plate's face away from its mounting face, a leg's inside face) or
`back`. A hole a shop could not make is an error: its widest radius outside the outline, two holes
overlapping, a countersink or counterbore no wider than its drill, a counterbore or blind hole too
deep, a hole on a leg off its flat or in the bend zone. A project item's price, `price_minor`, is
a valued field in the project's currency, one order line of units under its supplier with no
price band; a bare number is an estimate (`est-price` applies), no price is a `missing-price`,
and an open item may hold it until it is priced (*2.3*). A rolled steel angle is not a bent
angle: it is a `bar` from `std`.

Bars and connectors that exist in one project only (a pad strip, a fastening recipe) go in a
**project-local catalog** named by path (§3.1), not in `items`: they need sections, systems and
mounts, which a catalog already holds. Project items of kind bar or connector are a v1 exclusion
(*2.1*), and the skill says where such items go (§7.5).

### 4.9 Expressions and checks (review m6)

A small, safe language; no JS `eval`.

- Numbers, params, `+ - * / ^`, unary minus, parentheses; `< <= > >= == !=`, `and`, `or`,
  `not`, `if(c, a, b)`; `pi`.
- Functions: `min max abs round floor ceil sqrt hypot`; `sin cos tan asin acos atan atan2` **in
  degrees**, the file convention.
- Accessors read the derived model: `len(b3)` (design length), `cut(b3)`, `pos(n3).z`,
  `dist(n1, n2)`, `bbox().z`, `mass()`, `cost()`, `count(tag:leg)`. `.x`, `.y`, `.z` read a
  vector's component. They are for checks only (*2.3*): a param, a coordinate or a length that
  used one would need derive to iterate, so it is an `expr` error.
- `mass()` is the BOM's total in kg. `cost()` is the order's likely total in the project
  currency's major unit (minor units / 100, as the outputs print it), and `cost(low)`,
  `cost(likely)`, `cost(high)` its bounds (*2.3*: the language has no strings, so a bound is a bare
  name, not draft 2's `cost("high")`). A total that leaves something out (an item with no mass, a
  line with no price, a cost line with no rate) makes the check one that cannot be evaluated, an
  error naming what is missing, never a pass on a partial sum.
- `bbox()` is the extent of every body the viewer draws and the GLB holds (*2.3*): the bars, each
  its section's box swept between its end planes; the placed parts, a project plate or bent
  angle by its shape, a placeholder and any other part by its item's box, each in its frame on its
  station; and the face connections' fasteners, as the rods drawn through their layers. It reads
  the same shapes and the same placement as the viewer and the GLB (`src/mesh/`), so the three
  agree: to the output quantum for a bar, which they place from `derive --json`, and exactly for
  the rest. A part's hole markers stand proud of it to show and are not bodies. A placed part
  whose item gives no box is drawn as a marker, which is not its extent, so a check that reads
  `bbox()` then cannot be evaluated, an error naming the part, never a pass on a partial box.
- `^` is right-associative and binds tighter than unary minus (`-2^2` is −4); comparisons do not
  chain; `if` evaluates one branch (*2.3*).
- `sec(b3)` reads the bar's section, after swaps (*2.1*): `sec(b3).t_mm` and the other parameters
  of its generator by name (`h_mm`, `b_mm`, `d_mm`, …), and `width_mm` and `height_mm` of its
  bounding box for any section. An unknown name is an error naming the section. It reads item data,
  not geometry, so params may use it.
- Params may be valued fields: a measured wall width keeps its `meas` tag and its date.
- The determinism rules of §5.2 apply (exact trig at special angles, snapping before `floor`,
  `ceil` and `round`, comparison within `tol.snap`).

A **check** is `{ "value", "op", "limit", "text", "severity" }`. It reports its **margin**
(`limit − value` for `<` and `<=`, `value − limit` for `>` and `>=`, −|value − limit| for `==`;
none for `!=`), as the reference project's asserts with floors do. A plain boolean `expr` is
allowed too, without a margin. `severity` is `error` (the default), `warn` or `info`. A check that
cannot be evaluated is an error; a failing one reports at its own severity.

### 4.10 Variants (review m9)

A variant overrides params, swaps items (`"swap": { "forseti:PF45-02": "std:RHS-100x50x3" }`) and
includes entities **and cost lines** (*2.3*; gap A5) by `only_in: ["steel"]` or `not_in`.
`variants.default` names the variant opened by default, so the base document never has to be a
frame nobody builds: entities that exist only in one option are scoped to it. `only_in` puts an
entity in the variants it lists and in no other, so not in the document derived with no variant
(*2.3*); a name not in `variants.list` is an error. A variant is applied first, in stage 1 (§5.1),
so every output and check reads the same variant. `alukit diff --variant a --variant b` compares
any two.

- A connection naming a bar its variant omits drops that end, with an info diagnostic; with no
  ends left, or with its through bar or pivot base out, it is dropped.
- A point, a part or a pattern on an omitted bar is an error in that variant: scope it too.
- A cost line left out of a variant leaves that variant's order, costs, totals and contingency;
  an open item's scope that named it loses it, with an info (*2.3*). Open items, checks and price
  bands take no scope.
- A swap replaces an item wherever the frame names one, in the entities and in `defaults`
  (*2.3*). `order`, `costs` (and their `covers.items`) and `price_bands` keep naming what they
  name: a buying choice is about a specific item, and one made for the old item would be wrong
  for the new. A swapped bar or part keeps only the options its new item has, with an info for
  each option dropped; a swap whose source item nothing names warns.
- A swap that changes a section's size moves nothing: placements re-derive from anchors (flush
  faces stay flush), and cut lengths follow.
- A swap also changes what `sec()` reads (§4.9), so lengths written from a section (a sleeve cut
  to a wall, a rod through a beam) follow it. A variant then needs no param edited in step with its
  swap (*2.1*).

### 4.11 Costs, currency and price basis (review M7)

- **`currency`**: the project's. Offers keep their catalog's currency. `fx` holds dated rates as
  valued fields (`"fx": { "EUR": { "v": 6.2, "src": "src", "ref": "…", "read": "…" } }`). Lines are
  converted per line; a line with no rate is a missing price (§5.5).
- **`price_basis`**: `regular` (default), `sale` or `lowest`. Every output that carries prices
  (the cut list, the order list, the costs) states the basis and the oldest read date of a price
  it uses (§5.4; *2.3*).
- **`costs`**: lines that are not parts: `{ "id", "label", "kind", "supplier"?, "low_minor",
  "likely_minor", "high_minor", "currency"?, provenance, "blocks"?, "covers"?, "only_in"?,
  "not_in"? }`, with `kind` one of `machining`, `fabrication`, `labour`, `freight`, `lifting`,
  `contingency`, `other`. Provenance defaults to `est`: an amount nobody sourced is an estimate
  (*2.3*). `only_in` and `not_in` scope a line to variants as they scope an entity (§4.10;
  *2.3*). A contingency may be `{ "pct": 10, "of": "subtotal" }`; its `pct` applies to each of the
  low, likely and high subtotals. A line with `blocks: "order"` holds its supplier's order, or
  all of it, as an open item does (§5.5).
- **`covers`**: a cost line may price generated work or BOM lines as a whole. Covered lines keep
  their quantities, move to the cost line's supplier, show the cost line instead of a price, and
  leave the `missing-price` rule (§5.5). A line or a service covered by two cost lines is an error
  naming both.
  - `{ "supplier": "forseti", "services": true }`: the machining that supplier sells, generated
    on its bars.
  - `{ "services_on": { "supplier": "<id>" } }` (*2.1*), or a list of such, each supplier once
    (*2.3*; gap A6): the machining generated on bars bought from those suppliers, whoever does it
    (a fabricator drilling a stockist's steel, or one job on two suppliers' bars). The order words
    it "machining on a's and b's bars"; the single form stays valid.
  - `{ "items": ["<item id>", …] }` (*2.1*): those items' BOM lines (pad strips cut from a bar and
    priced as one job).
- **Machining in v1** (*2.3*): with no `services.json` (§3.1), a service a supplier does on its own
  cut pieces (taps, holes, angled cuts) that no cost line covers is a `missing-price` on that
  supplier. Machining on whole stock bars is listed as the buyer's (you or a shop do it) and blocks
  nothing; a `services_on` cover names who does it.
- **`price_bands`** (*2.1*) give catalog-priced lines their low and high:

  ```json
  "price_bands": [
    { "supplier": "forseti", "kind": "bar", "low_pct": -10, "high_pct": 25, "src": "est", "why": "cut lengths quoted at order time; freight" },
    { "supplier": "forseti", "low_pct": -8, "high_pct": 12, "src": "est", "why": "list prices move" }
  ]
  ```

  - A line's low and high are its likely price times (1 + `low_pct` / 100) and
    (1 + `high_pct` / 100), computed on its minor units and rounded once, half away from zero
    (§5.2; G26). `low_pct` ≤ 0 ≤ `high_pct`.
  - A band selects by `item`, `supplier` and `kind` (the item's kind, §3.4). A line takes the most
    specific band that matches: `item`; then `supplier` with `kind`; then `supplier` or `kind`
    alone. Two equally specific matches are an error naming both.
  - An offer whose price is a valued field with `low` and `high` (a quote, §3.2) uses that range,
    and no band applies. A line with neither has low = likely = high.
- **Totals** carry low, likely and high (the lines', then the cost lines'), per currency and
  converted, plus the **share of the likely total by provenance tag** (how much rests on prices
  actually read).

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
  changes an entry already there. A missing lock is created by the first command that derives,
  and a missing entry added, each with a notice (*2.3*). A new project's lock holds only what its
  document uses, never whole catalogs.
- `alukit lock update [--item <id>]` refreshes entries from the live catalogs and prints a
  semantic diff: which fields and prices changed, and how the totals move. A catalog correction
  reaches a project this way, visibly (principle 2). It keeps, and reports, an entry the live
  catalogs no longer have, so a catalog deletion never silently changes what derives, and refuses
  to write while the catalogs have errors (*2.3*). `alukit check` reports, as info, how many
  items differ from the live catalogs. `--frozen` makes a missing entry an error (for CI), and
  opens no catalog.

**Revisions.** `alukit revision save "Rev 1.2"` writes `revisions/rev-1.2.json` holding the
document, its lock, the **stored outputs** (cut list, BOM, machining sheet, order list, totals,
check results) and a stamp: AluKit version, Node version, schema version, the content hash of
document + lock + tool version, and the project's git commit and dirty flag as a hint. The dirty
flag looks at `alukit.json` and `alukit.lock.json` only, so a revision or an export written into
the folder never changes the next stamp (*2.3*).

- One file holds the outputs of **every** variant in the list (*2.3*): a revision is what was
  published, and a variant is part of it.
- The order's date, `as_of` (§5.5), is stored, and every replay uses it, so a replay months later
  does not drift because prices went stale (*2.3*).
- A revision is never overwritten. With a server running, the save goes through its queue (§7.1),
  after any direct edit it has not yet taken in (*2.3*).
- Opening a revision shows the stored outputs: what was published, whatever the tool does now.
- `alukit revision verify <name>` re-derives with the current tool, from the stored document and
  lock and no catalog, and reports any drift, a broken hash, and a tool-version difference as a
  note. Each stored output carries its stamp (§5.4); a stamp field the stored output does not
  have, saved before that output was stamped, is not drift (*2.3*).
- Old schema versions are read through migrations kept forever; stored outputs are never
  migrated.

**Diffs** between git refs (`alukit diff git:<ref>:<path> git:<ref>:<path>`) derive each side
with the lock from its own commit. A price that changed between them shows up as a lock change
and as its effect on the outputs. A side may also be a folder, a revision file or `rev:<name>`,
which gives its stored outputs (*2.3*).

## 5. The derived model

`derive(doc, lock, variant) → Derived` is a pure function in `src/core/`.

### 5.1 Pipeline

1. **Resolve.** Apply the variant (`only_in`, `swap`, params). Resolve item references from the
   lock. Evaluate params in dependency order; they may read sections (`sec()`, §4.9).
2. **Place.** Resolve points, bar frames and placed sections, runs, pivot points and pattern
   copies of structural entities, in dependency order (§4.3, §4.4).
3. **Ends.** One plane per end in two sweeps, placement providers then end providers (§4.5); the
   modifiers, cut lengths and angles; each end's long point and the bar's span between them
   (*2.3*, §5.3); last, each butting end's seat on its face, its overhang and its overlap, on
   the trimmed bars (*2.3*).
4. **Attach.** Parts and part patterns (which may use cut ends and rail holes); face contacts on
   the trimmed bars, on bounding and inner faces (*2.3*); stations from rail-hole selections and
   across offsets; fastener and sleeve pieces cut from bar stock; generated machining (connector
   `requires`, access holes, end holes into a through bar's end along their fastener's axis
   (*2.3*), rail holes, splice taps,
   and, new in 2.1, clearance holes for `bolt` layers and tapped holes for `screw` fastenings,
   with a sleeve's holes clearing it (*2.3*), §4.5) and hardware sets keyed by system, with fit
   judged by role (§3.4); a connector's machining at its positions, a splice's taps one per stud,
   and a butt held by another's through-fastener (*2.3*, §3.4, §4.5); fastening stacks, their walk,
   their grip and their heads' seats (*2.3*). Last, ops of one bar of the same kind and size at one place, one op made twice,
   are a `machining` error (*2.3*, §5.5), and so is a tap into a bar's end on none of its
   section's cores, or on one its thread does not fit (*2.3*, §5.5).
5. **Collect.** Cut list (each piece ordered and nested at its span, *2.3*), BOM (joint recipes
   apart), machining sheet, order list (offers, packs, kits), costs and totals (§5.3, §5.4).
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

CI runs the fixtures on Linux and compares bytes against the golden files; the merge gate runs the
same suite on macOS (*2.3*: one CI platform in v1, where draft 2 named two).

### 5.3 Cut list (review M7, m14)

Pieces come from bars and, since 2.1, from fasteners and sleeves cut from bar stock (§4.5). They
are listed per bar item and option, in one of two modes from the chosen offer's `sale`
(overridable per project):

- **`cut`** (the supplier cuts). Each piece is ordered at its span (below; *2.3*: earlier text said
  its cut length) rounded to `res_mm`; the rounding is shown. It is billed in `step_mm` steps,
  rounded up, with `min_bill_mm` where set. Worked example (review M7): a 1,234 mm piece at R$ 126.50/m costs R$ 156.10 by the millimetre,
  and R$ 156.86 in 10 mm steps (124 steps). Pieces whose span is outside `min_mm`–`max_mm` fail a
  check that suggests a `splice`.
- **`stock`** (whole bars, cut by you or a shop). Pieces are nested, each at its span (*2.3*),
  into the item's stock lengths, allowing `kerf_mm` per cut and `trim_mm` at each bar end (from
  `order.<item>`, else
  `defaults.cutting`, else a kerf of 3 and no trim; lengths in whole hundredths of a millimetre,
  so a fit never drifts; *2.3*):
  [first-fit decreasing](https://en.wikipedia.org/wiki/First-fit-decreasing_bin_packing) for each
  stock length, then each bar is moved down to the cheapest stock length that still holds its
  pieces, and the cheapest result wins (ties: fewer bars, then the longer offcut). The result
  minimises cost, not waste, which matters when lengths have different prices. Waste is reported
  per bar. The exact [cutting-stock](https://en.wikipedia.org/wiki/Cutting_stock_problem) search
  is out of v1 (review m16).
  A **factory-drilled rail** (§4.7) keeps a factory end on every piece (*2.1*): each stock bar
  holds at most two of its pieces, one at each end, with no `trim_mm` at a factory end, and a piece
  that names `stock_mm` goes only into that length (G23).
  **v1 limit** (*2.3*, x4): each piece takes its whole span. Two parallel-cut pieces sawn one after
  the other could share an angled cut, the second taking only its long-point length; that makes a
  piece's length depend on its neighbour and on how each is turned, and an angled kerf
  kerf / cos θ, which first-fit decreasing over independent lengths cannot express. Common-line
  cutting is v1.1 or later.

**A piece's span** (*2.3*; gap X4, G38) is the length of straight stock it is cut from: its extent
along the axis, from end a's long point to end b's, each the farthest its end face reaches outward
over the box's corners (§4.5's box, as for `cut_mm`). It is what a piece is **ordered, billed and
nested at**, in both modes above, what chooses the cheapest cut offer, and what `min_mm`–`max_mm`
bound; the BOM's length adds it (§5.4). When the two cuts lean opposite ways (a trapezoid) or one
is square, both long points lie on one edge, and the span is the long-point length `cut_mm`. When
they lean the same way, the long points lie on opposite edges and the span is longer: for parallel
cuts at θ across a section w deep, by w · tan θ, so G38's brace, 1118.03 at its long point, takes
1138.03 of bar. A weldment cut list measures a member the same way, as the blank between two
planes square to its axis that holds both cuts (x4, its sources). A line with an angled end states
`span_mm` beside `centre_mm` and `short_mm`; a square-cut piece spans its `cut_mm`.

Identical pieces group into one line with a count: same item and option, same cut length and span
(*2.3*) to the quantum, same end cuts and the same machining. A piece and its end-for-end flip are
the same piece; the canonical orientation is the one whose sorted machining list compares first.

Every piece lists its machining **from a named end**, measured along the axis from that end's long
point, so a hole's distances from the two ends add up to the span, not to `cut_mm` where they
differ (*2.3*): "tap M8 at end a; Ø7 access hole 20 mm from end a on face +y; Ø9 hole in end b along the
axis, 10 off its centre" (an end hole, *2.3*, whose x turns over when the piece is turned end for
end); "Ø9.00 hole in end a at x 10.18, y 0.00 from the centre, 7.59° off square, exiting end b at
x -11.16, y 0.00, through" (one following a screw at an angle, *2.3*, its exit turning over with
it; the order names the service "hole Ø9.00 into an end, 7.59° off square, through"); "tap M16 in end a, at x −20.00, y −20.00 from the centre" (an end tap at a position, *2.3*,
whose x turns over the same way; an end's taps are listed by place). Identity compares machining by
where it physically is, whichever end or side it is named from (*2.3*). Rails also list E at each
end: a rail's holes are one record on the piece, its hole count, pitch and E at each end, E measured
along the box's centre line from each end face (*2.3*).

### 5.4 BOM and order list (review B3, M7)

- **BOM**: every item and option with its quantity (bars: count and total length, each piece's
  span, the bar it takes, §5.3; *2.3*), grouped by
  kind, with mass (§3.5's authority rule; a bar's is its centre-line length times its mass per
  metre, each line rounded once; *2.3*) and price. Unplaced lines (§4.7) show their `why`; a line
  covered by a cost line (§4.11) names it instead of a price. An item with no mass is a `mass`
  warning, listed and left out of the totals.
- **Joint recipes** (§3.4; *2.3*) are listed apart, with their uses and connections, in no group
  and no total, with no mass; the order buys only what they bring.
- **Machining sheet** (*2.3*; M6): `alukit machining` lists every plate and bent angle the BOM
  counts, with its supplier, material, thickness, datum, outline or legs, blank and bend, and each
  hole from the datum and on the blank; bars are cross-referenced by their cut-list lines, whose
  machining the cut list already gives. Markdown or JSON; a flat CSV would repeat the part on
  every row.
- **Order list**, per supplier. Offers are chosen in this order:
  1. an explicit choice in the project's `order` map;
  2. otherwise the **cheapest cover**: for packs, the combination of pack sizes with the lowest
     cost that covers the quantity (an exact search bounded by the quantity; ties: less surplus,
     then fewer lines, then SKU order). 37 hammer screws sold in packs of 10 and 50 become the
     cheaper of 4 × 10 or 1 × 50;
  3. **kits only when chosen**, or when the item has no other offer. A chosen kit's contents are
     credited against the other needs, and any surplus is reported.
- Each line: SKU, name, options, quantity and unit (packs, bars, pieces), unit price on the
  project's basis, low/likely/high total (low and high from the offer's own range, else from a
  price band, §4.11), cut pieces and machining services. Services are priced
  from the supplier's `services.json`, or by a cost line that covers them; in v1 only by a cost
  line (§3.1, §4.11).
- Every output states the lock hash, the price basis and the oldest price read date: **the
  stamp** (*2.3*). Each output derived from a lock (the cut list, the BOM, the machining sheet,
  the order list, the costs and `derive --json`) states the lock's sha256, taken of its canonical
  text, so `shasum -a 256 alukit.lock.json` gives it: `lock` in JSON, a line "Derived from the
  lock …" in Markdown, a first `stamp` row in CSV. An output that carries prices also states the
  basis and the oldest read date of the prices it uses: the cut list, those of the offers it chose
  (each cut-to-length group's, each stock bar's); the order list, those of its priced lines; the
  costs, the order's. In JSON these are `price_basis`, `oldest_read` and `lock`, in that order; in
  CSV, `stamp` rows after the lock's, where the CSV has prices (the order list and the costs; the
  cut list's CSV gives none). The BOM, the machining sheet and the derived model carry no prices,
  so they state the lock alone, and `derive --select` keeps it as it keeps `schema`. The server's
  `/api/*` answers are the CLI's, byte for byte; the GLB carries the full stamp (§9). Called from
  code without a lock, an output states no lock, which keeps the hand goldens statements about the
  values: a test compares an output with its golden plus the stamp's lines. A revision stores each
  output with its stamp; `revision verify` compares a stored stamp field, and one the store does
  not have (an output saved before it was stamped) is not drift, since the revision's own stamp
  already covers the lock (§4.13).
- Output as Markdown, CSV or JSON.

### 5.5 Checks and what blocks the order (review M8)

| Check | What it catches | Default severity |
|---|---|---|
| Schema and references | invalid documents, missing items, cycles; two equally specific price bands; a line covered twice (§4.11) | error |
| Ends and connections | the validation column of §4.5, two providers, an undeclared angled cut, a chain of end providers, a station on a run's joint, a run not spliced in order; a `held_by` that does not hold, a connector position that falls off its end or face (*2.3*); an end hole whose screw leaves the block by a side, or whose wall breaks out of one; a screw into a butting end that meets a side face at an angle; a butting bar that goes into the body it bears on beyond the face (*2.3*, after acceptance run 4) | error |
| Ends and connections (*2.3*) | a butting end face that reaches past the face it bears on by more than the connector's `overhang_mm`, else `defaults.butt.overhang_mm`, else 0 (§4.5) | warn |
| Unconnected ends | a point shared by two or more bar ends with no connection | warn |
| Fit | a connector that holds a joined bar in no way it may (§3.4, by role; *2.3*); a T-nut that does not fit its groove; a carriage on another rail system; a `face` with no contact; a head, nut or washer that bears on none of its face's material (*2.3*) | error |
| Fit (*2.3*) | a head, nut or washer that bears on less than half of its annulus (§4.5, its seat) | warn |
| Fit (*2.3*) | a head, nut or washer whose item gives no bearing diameter, so its seats are not checked | info |
| Machining (*2.3*) | two ops of one bar of the same kind and size at one place, one op made twice (§5.1): a requirement written once per screw, a splice whose studs have no positions, two ends that each pass a hole through one axis. Places compare as the cut list's identity does, a through hole by its axis. A tap into a bar's end on none of its section's cores (its centre more than `tol.len` from every core's): an end tap, a connector's in a butting or a through bar's end or a splice's, or a tapped end hole (a drilled one is not checked); the error names the bar, the end, the place and the nearest cores (*2.3*). A tap on a core its thread does not fit (the tap rule below): an M16 in an 80x80's Ø5 corner hole (*2.3*); a tapped end hole at an angle to the bar's axis, which runs across its cores (*2.3*) | error |
| Machining (*2.3*) | a tap into the end of a bar whose section gives no core positions, so it is not checked: a `tslot`'s `bores` and a drawn section's `cores` give them (§3.5), a box section or one that lists none does not; a tap on a core whose thread is none of its labels and has no tap drill or 6H tolerance in AluKit (not metric, or a pitch over 2.5 mm), its place checked and its fit not | info |
| Lengths | cut length ≤ 0, outside the offer's range, a cut angle outside the supplier's service range | error |
| Rails | end distance E outside the rail's range; a factory end that is not square | error |
| Rails | a stock rail with no factory end named (§4.7) | warn |
| Frames | near-vertical bar without `up`; an end far from its face | warn |
| Project checks | `checks` | per check |
| Open items, placeholders | §4.12, §4.8 | handled by the order rules below |

**The tap rule** (*2.3*). Whether a tap fits the core it stands on is decided in this order
([notes](notes/section-cores.md) 7, 9):

1. **A thread among the core's `threads` fits it**: the vendor labels the core with it (§3.5), so
   it is sanctioned, formed or cut. A label matches a tap of the same metric diameter and pitch
   (`M5` is `M5x0.8`). So an M5 fits Forseti's 20-series Ø4.6 cores, which the vendor labels M5:
   4.6 is a forming tap's pre-hole, wider than a cut M5 allows.
2. **Any other thread is judged as a cut thread**, and fits when both hold:
   - **the core is no wider than the thread's largest minor diameter** in tolerance class 6H,
     the medium class for general-purpose tapped holes: ISO 724's basic minor diameter,
     D − 1.082532 P, plus ISO 965-3's T_D1 for the pitch. A wider core leaves a shallow thread.
     This is "the tap drill no smaller than the core" read with the thread's own tolerance: the
     tap drill AluKit uses (`tapDrill`, major minus pitch, the rule behind every tapped hole,
     §4.8) lies inside that tolerance, and shops round it to the drills they stock, so an M8's
     6.75 is drilled 6.8, the core of every 40x40 with an M8 centre, inside M8's 6.647 to 6.912;
   - **its tap drill is at most one pitch over the core**: a core may be drilled up to the tap
     drill, taking off half a pitch of wall on each side at most, a little under the thread's own
     depth. No section states the wall around its cores, so a tap that needs more was not made
     for that core (*inferred*; call 39).
3. **A thread that is no label and has no tap drill or 6H tolerance here** is not judged: an
   info, its place checked.

So an M16 fits a Ø13.7 core labelled M16 and also as a cut thread (drilled up 0.30 to 14.00); not
a Ø5 corner hole labelled M6 (as a cut thread, 14.00 is 9.00 over the core, its pitch 2); an M6
fits the Ø5; an M8 fits a Ø6.8 core with no label (the cart's), and does not fit a Ø13.7 (wider
than 6.912). An M5 in the 20x40 V-slot's Ø5, labelled M6 by its drawing, is a cut thread and an
error.

**Order rules.** Each has a name, can be set to `block`, `warn` or `off` in the project's
`order_rules`, and blocks only the suppliers it concerns:

| Rule | Default | Scope |
|---|---|---|
| `check-error` | block | the suppliers of the entities the check names; all suppliers for a check that names none |
| `open-item` | block | its `scope`, or all |
| `placeholder` | block | the group that holds its line: "unsourced", or the supplier it names (*2.3*) |
| `missing-price` (incl. no exchange rate) | block | that supplier |
| `est-price` | block | that supplier |
| `out-of-stock` (as read) | block | that supplier |
| `option-not-sold` ("not sold with finish red"; with none chosen, "sold only with finish anodised or black; choose one", *2.3*) | block | that supplier |
| `stale-price` (older than 30 days before the order's date) | warn | that supplier |

The order list reports **READY** or **BLOCKED** per supplier, with every reason. `alukit order`
exits non-zero when any supplier is blocked, so an agent cannot hand over a blocked list by
skipping `alukit check`; `order` and `costs` run `alukit check`'s model checks before the rules,
so a failing check holds the order through `check-error`.

- **The order's date** (*2.3*): `as_of` (`--as-of`, default today) is what `stale-price` measures
  from, so the same project gives the same order on any day it is replayed with that date.
- **A placeholder** (*2.3*) holds only its own group, not every supplier, and an unpriced one adds
  no `missing-price` besides: draft 2's "its own line, under unsourced" missed a placeholder
  bought from a named supplier.
- **The cover does not avoid an out-of-stock offer**: the cheapest wins, and `out-of-stock` blocks
  until the project chooses another offer or switches the rule, since silently buying a dearer
  one would hide the cost (*2.3*).

**The problem list** (*2.3*; [s1](ux/s1-decisions.md) 8–13). `alukit problems` and
`GET /api/problems` give one list, `alukit.problems/1`, of what stands between the project and a
sound build and a sendable order, grouped by consequence: what blocks the order, then errors,
warnings and notes. It is made from the check's diagnostics and the order after the checks, at the
order's date, and judges nothing again: a diagnostic is one problem in its severity's group, an
order reason one problem over every supplier it holds, a `check-error` the error it repeats
(which then blocks), an open item the `open-item` reason it causes or a note. Each problem has a
title and a detail in plain words, keyed by its code or rule, the CLI's message as `raw`, its
targets, and its fixes, the likeliest first: a batch of commands applied as one step ("Set
anodised" on every bar that asks; "Join with the default butt"; "Release K1") or a form the app
opens (resolve an open item, set a price, update the lock, edit a param). The answer carries the
order's summary: `READY`, `BLOCKED` or `EMPTY`, and how many problems block it.

## 6. Commands (the one edit path)

Every edit is a JSON command, `{ "cmd": "addBar", "args": {…} }`: a pure function from document
to document. Batches apply atomically. The UI, the CLI and agents use the same commands.

**Undo keeps the previous document** (review m1): documents are immutable and share structure, so
each step costs little and undo cannot be wrong. No command needs an inverse.

| Group | Commands |
|---|---|
| Structure | `addNode` `moveNode` `addBar` `setBar` `reverseBar` `splitBar` (optionally adding a `splice`, and the run) `addRun` `setRun` `removeEntity` |
| Connections | `addConnection` `setConnection` `autoConnect` |
| Parts and patterns | `addPart` `setPart` `addPattern` `setPattern` `explodePattern` `mirror` `array` |
| Items | `addItem` `setItem` (project items) |
| Params and costs | `setParam` `addCost` `setCost` `setPriceBands` `chooseOffer` |
| Organising | `tag` `label` |
| Records | `addVariant` `setVariant` `addCheck` `addOpen` `resolveOpen` `addDecision` |
| Views | `saveView` |
| Lock | `lockUpdate` (a step in the log like any other) |
| Project (*2.3*) | `setProject` |

- `removeEntity` **refuses** when anything refers to the entity and lists the referrers;
  `cascade: true` removes them too and returns what it removed (review m10). A cascade removes a
  referrer, or drops the entity from a list that can lose a member down to its minimum (a run
  keeps two bars, a butt one end, a face two layers); it never rewrites a param, a default or an
  `order` choice, and refuses a pattern copy (skip or explode it instead) (*2.3*). Every
  reference counts, a plane's `normal` naming a bar included (*2.2*).
- The `set*` commands take an [RFC 7396](https://www.rfc-editor.org/rfc/rfc7396) merge patch:
  `null` removes a field (*2.3*). A command validates what it creates or changes, not the rest of
  the document, so an error elsewhere never blocks the edit that fixes it; `alukit check` judges
  the whole.
- `autoConnect` takes `optional: true`, doing nothing where nothing butts, so the draw tool sends
  one per end without repeating §4.5's rule (*2.3*).
- **`setProject`** (*2.3*) takes a merge patch over `name`, `catalogs`, `currency`,
  `price_basis`, `fx`, `defaults` and `order_rules`, and answers the fields it changed. A catalog
  it adds must be a built-in id or a folder that resolves, symbolic links followed, inside the
  project (§7.2): a folder elsewhere stays a hand edit. One command may add a catalog and name its
  items, the default bar say: the new catalogs open before it runs ([s1](ux/s1-decisions.md) 4–6).
- **Every command describes what it did** (*2.3*), so a step reads in words: "add bar b12, joined
  at 1 end", "add bars b1, b2 and b3", "undo add point n2". The log keeps the command names as
  `what` beside the words, `text` ([s1](ux/s1-decisions.md) 7).
- **A dry run** (*2.3*) applies a batch and derives it, and writes, logs and broadcasts nothing.
  It answers as the step would, with what it would do to what is derived: the bars whose cut
  moves (`cuts`, before and after), the bars it adds with their cuts, what it removes, and the ends
  it claims. The server runs it in its queue, against the revision after every step before it
  ([s1](ux/s1-decisions.md) 14–16).
- Every answer returns the new revision, the ids each command created, and diagnostics that name
  entities (review m2). A refusal is `{ code, message, entity?, field?, refs? }`; a command never
  throws.

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
  `cli:<name>`, `agent:<name>`, `file`). A client may send `ui`, `cli`, `cli:<name>` or
  `agent:<name>`; `file` is the watcher's alone (*2.3*). The CLI's `--as <name>` is
  `cli:<name>`, and `--as agent:<name>` that agent (*2.3*). Each step in the log and in its event
  carries its words, `text`, beside its commands' names, `what` (*2.3*, §6). Undo pops the latest step, whoever made
  it, and names it; redo applies again the last one taken back; `alukit log` shows what happened
  and what was undone. The log lives as long as the server process; git keeps the rest, so
  `undo`, `redo` and `log` need a running server and say so without one (*2.3*).
- **A step** is applied, its files written (lock, then document, only those whose canonical text
  changed), then committed to the history and broadcast (*2.3*). A failed write leaves no step
  and makes the project read-only with the error. Every change in the queue first reads the files
  itself, so a direct edit the watcher has not reported yet becomes a step before it and is never
  written over.
- **A direct file edit** is read by the watcher (`fs.watch` plus a 1 s stat poll; the server's own
  writes are recognised by hash). If valid, it enters the log as one `file` step, taken in as
  written (§2); an edit equal to the current state's canonical text is no step (*2.3*). If not, the
  project goes **read-only**: every client shows why, commands are refused, until the file is
  valid again or someone chooses "restore last good". **Valid** means strict JSON (§2) that
  validates against the document's schema, and a lock, if present, against the lock's (*2.3*); a
  dangling reference or a bar that does not derive is a diagnostic, not invalidity (principle 8).
- **`alukit serve` refuses to start on invalid files** and lists the problems, since there is no
  last good state to restore (*2.3*). While it runs, the server holds `.alukit/edit.lock`, so no
  headless process can write between its read and its write.
- **With no server running**, the CLI runs the same core in-process under `.alukit/edit.lock`,
  created exclusively and holding a pid and a start time, so a crashed holder is detected. A held
  lock refuses at once, naming its holder (*2.3*).
- The CLI finds a server through `.alukit/owner.json` (port, pid, start time, token), and trusts
  it only when its process is alive and the server answers for this folder with that token
  (*2.3*).
- **Every derived answer takes `?variant=<name>`** as the CLI takes `--variant` (*2.3*): the
  model, the outputs, the checks and the GLB export, so the same variant gives the same bytes from
  either. `GET /api/order` and `/api/costs` take `?as_of=` as the CLI takes `--as-of`, and answer
  what `alukit order` and `alukit costs --format json` print, byte for byte. Revisions are listed,
  saved and verified through the server (§4.13). `GET /api/problems` takes both and answers what
  `alukit problems --json` prints (*2.3*, §5.5).
- **A dry run** (*2.3*, §6) is `dryRun: true` on `POST /api/commands`: it is queued like a step
  and answers `alukit.do/1` with `dry: true`, but nothing is written, logged or broadcast, and no
  `id` is remembered.

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
  be the server's own. Both are checked on every request, static files included, so a rebinding
  page gets nothing, not even the app (*2.3*). Bodies must be `application/json`. No CORS headers
  are sent.
- **Defence in depth** (*2.3*). The token is compared in constant time. `Sec-Fetch-Site`, when
  present on `/api`, must be `same-origin` or `none` (a `no-cors` request carries no `Origin`).
  Every answer carries a CSP (own scripts and connections only, `frame-ancestors 'none'`),
  `X-Frame-Options: DENY`, `nosniff` and `Referrer-Policy: no-referrer`; API answers are
  `no-store`. `GET /api/health` is the one `/api` path without the token: a liveness probe, it
  answers `{ "ok": true }` and nothing about the project.
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
| `alukit problems <dir> [--variant v] [--as-of d] [--json]` (*2.3*) | the problem list (§5.5); non-zero exit when one blocks the order or is an error |
| `alukit cutlist` / `bom` / `machining` / `order` / `costs <dir> [--variant v] [--format md\|csv\|json]` | the outputs; `machining` (*2.3*) has no CSV; `order` and `costs` take `--as-of YYYY-MM-DD` (*2.3*); `order` exits non-zero when blocked |
| `alukit derive <dir> --json [--select <paths>]` | the derived model, for report builders (`alukit.derived/1`, with its own JSON Schema). `--select` (*2.3*) takes dotted paths, `*` for every member, commas to merge (`bars.*.cut_mm,params`), and keeps the model's shape; a path the model lacks is an error |
| `alukit query <dir> <selector> [--fields a,b] [--limit n] [--summary]` | e.g. `tag:leg`, `b7`, `connections of b2`; bounded output for an agent's context |
| `alukit do <dir> -f batch.json` (or `-f -` for stdin) | edits from a file or stdin, one process per batch; inline JSON also works. `--dry-run` (*2.3*) says what the batch would do and writes nothing (§6) |
| `alukit add bar --item … --a n1 --b 0,0,900`, … | sugar over `do` |
| `alukit log` / `alukit undo` / `alukit redo` | the server's log; undo the latest step; redo the last one undone (*2.3*: all three need a running server) |
| `alukit lock update <dir> [--item id] [--dry-run]` | §4.13 |
| `alukit fmt <dir> [--check]` | canonical form |
| `alukit diff <a> <b>` | files, `git:<ref>:<path>`, revisions (`rev:<name>`) or variants; each side with its own lock |
| `alukit revision save "<name>"` / `list` / `show <name>` / `verify <name>` | §4.13 |
| `alukit snapshot <dir> --view iso [--size 1600x1000] -o shot.png` | lets an agent see what it built |
| `alukit export glb <dir> -o x.glb` | §9 |
| `alukit catalog search\|show\|check\|schema\|import <…>` | catalog work. `search` (*2.3*) ranks as the app's browser does and prints 20 items unless `--limit` (200 at most): an exact id or code, a code prefix, then a bar whose own section is the size the query writes (`40x40`, either way round), then whole words; `--prefer <kind>` ranks that kind first within each; `schema` prints a catalog file's JSON Schema; `import forseti` runs the Python importer on a shop snapshot and the catalogue PDF, says what is missing instead of half-running, and reads the network only with `--fetch` |
| `alukit skill install` | links the skill into `~/.claude/skills/` |

**Snapshots** always render in headless Chromium through Playwright, from a fresh page on the
project's server (an ephemeral one if none runs), at a named view. One code path, and it never
depends on the user's camera, selection or a hidden tab. (The build follows this; rendering in an
open tab instead was considered and is an open call, call 34.)

### 7.4 Schemas (review m3)

`alukit.json` validates against a JSON Schema generated from the Zod schemas with
`z.toJSONSchema(schema, { io: "input" })` ([Zod](https://zod.dev/json-schema)), so fields with
defaults are optional for a writer. Zod drops refinements from the export and throws on
transforms (*verified by review 1, Zod 4.6.7*), so cross-reference rules live in `alukit check`,
and the skill says so. `derive --json` has its own schema field and JSON Schema; it is a contract
for report builders.

### 7.5 Skill

`skills/alukit/SKILL.md` documents the format, the commands and the conventions. Its command
reference is **generated from the command schemas**, so it cannot go stale, and its worked example
(a work table from the `forseti` catalog, ending with a snapshot) runs as a test, every command as
written (*2.3*). It says that a
project's own bars and connectors (a pad strip, a fastening recipe) go in a project-local catalog
by path (§3.1, §4.8). `alukit skill install`
links it into `~/.claude/skills/`, so it works from any repo, including the ones where projects
live. An MCP server comes only if the CLI proves insufficient (review m2).

## 8. Viewer and UI

### Layout

| Area | Holds |
|---|---|
| Top bar | project, variant, undo and redo (naming the step), revision, export. The read-only banner is a bar of its own under it (*2.3*) |
| Left | catalog browser (vendor › kind › family, search, item cards with a section thumbnail, fidelity and key data; options and offers) and the project tree (bars, connections, parts, patterns; by tag or kind) |
| Centre | the 3D viewport: perspective or orthographic, standard views (iso, top, front, side, left, back, bottom), a section clipping plane, grid |
| Right | properties of the selection. Every number has a provenance popover; derived values (cut length, end angles, mass, price) are read-only |
| Bottom drawer | Cut list · Machining (*2.3*) · BOM · Order (status per supplier) · Costs · Checks · Open items · Params · Decisions · Log |

As built (*2.3*):

- **The variant switch** shows only when the document has variants, its first entry the default
  (or "as written"). Every view derives the variant shown: the model, the drawer's outputs, the
  export. Edits still go to the document as written, since a variant is a derivation of it (§4.10);
  a point drawn on a variant's geometry is stored as the numbers it snapped to.
- **The revision** reads its name when a saved revision's content hash equals the current state's,
  else "unsaved"; its panel saves one and verifies any (§4.13). **Export** writes the GLB of the
  variant shown, the CLI's bytes.
- **The section plane** is square to X, Y or Z, moved by a slider across the model's extent, and
  hides one side. It is a view setting, like the camera: no step, and picks and snaps ignore what
  it hides.
- **The catalog browser** shows the catalogs the document names (and items the lock pins that no
  named catalog holds), and the project's own items under the vendor `project`, read only. A
  family is a bar's system or shape, a part's subtype, a carriage's rail system, a generic item's
  category.
- **The drawer's tabs** settle on the revision the scene shows; Order, Costs and Machining fetch
  when shown, keeping an older answer dimmed until the new one arrives, and say what the CLI says.
  Open items, Params and Decisions edit through one command batch each, so undo takes an edit back
  as one step.
- **v1 limits** (v1.1): the properties panel does not edit an existing connection, and dragging an
  existing node or bar end is not built (gestures are clicks; §7.1's rule for a drag stands).

### Tools

- **Select**: click or box select, or by tag.
- **Draw bar** (any bar item: profile, tube, rod, rail):
  1. Click a snap point.
  2. The line follows the axis, inferred X, Y or Z: the world axis through the start whose screen
     image passes nearest the pointer. Shift frees it within the **work plane** (review m11).
     *2.3*: the work plane is the ground (world XY) by default, moved to the start point; `W`
     then a click on a bar sets it to that face's plane, and `W` again returns to the ground.
     Draft 2's default, the plane through the start point facing the view's dominant axis,
     changes as the camera turns, which made the drawn point unpredictable. Which default to keep
     is open (call 32). `W` takes a bar's face only in v1, not a part's (v1.1).
  3. Type a length and press Enter. Once digits are typed nothing pulls the line toward a snap
     (*2.3*).
  4. R rolls the section; A cycles the anchor. The item comes from the palette.
  5. The gesture commits as one batch (*2.3*): `addBar`, then, with auto-connect on, an
     `autoConnect` with `optional: true` at each end (§4.5, §6). Points are written as the document would: a node by id, another bar's end as it
     is written (params kept), a point on a line as a station, anything else as coordinates.
- **Connect**: pick a through bar and butting ends (`butt`), two ends (`miter`, `splice`), a
  face and the ends it carries (`pivot`), or two or more layers, head to nut (`face`, resting or
  fastened, with every field §4.5 gives it; *2.3*). A pivot is one batch with the `setBar` of
  each carried end. The panel shows a missing field before anything is sent, the command's
  refusal, and derive's new diagnostics on the new connection.
- **Place part**: on a face or groove, at a distance typed from either end, with a roll in
  quarter turns. A part at a world pose is placed by command in v1.
- **Pattern**: select the template, pick the bar (or type a bar or run), type pitch and count. A
  pattern by a direction or by offsets is written by command in v1.
- **Measure**: two snapped points, the distance and its components.

Snap targets are nodes, bar ends, stations on face and groove centre lines and on each bar's
**design line** (*2.3*: a station with no face lies on it, §4.3), face centres, every placed
part's datums and face centres (*2.3*), and the grid (10 mm by default). A point wins over a line
within a few pixels; targets drawn over each other go to the one nearer the eye. Snapping is
analytic, from the derived model, not a raycast against meshes. **Picking** an entity (select,
Connect's ends, a pattern's `along`, `W`'s face) does raycast the drawn bodies (*2.3*): it names
an entity, it does not place a point. The camera is
[camera-controls](https://github.com/yomotsu/camera-controls), with orthographic views and fit to
selection; fitting keeps the view's direction, since `fitToBox` turns it to the nearest axis.

### Rendering

- One unit-length extruded geometry per section and finish, from the simplified display outline
  (§3.5), as an `InstancedMesh` scaled along the axis, for bars with square ends.
- A bar with an angled end gets its own geometry: each outline vertex of the prism moves along
  the axis to the end plane, which is exact and cheap.
- Edges are one merged line buffer for all bars, rebuilt per derive; `EdgesGeometry` cannot be
  instanced (review m11).
- Holes are markers, not booleans, in v1: a rod of the drill's diameter through the material,
  with a wider one for a countersink or counterbore. Hardware uses simple parametric meshes, or a
  GLB per item where one exists. A face connection's fasteners are drawn on their axes; a butt's
  connectors are not, since derive counts them without placing them (§4.5).
- Placeholders render translucent and hatched; `parametric` and `box` sections show their
  fidelity on hover. **v1 limit** (*2.3*): placeholders are translucent and outlined, without
  hatching, which waits for a texture (v1.1).
- The scene renders on demand (a camera move, a model, a selection, a resize), and fits the
  camera to the first model only (*2.3*).
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
  - Z-up mm converts to Y-up m at the root: one root node, named after the project, turns −90°
    about X and scales by 0.001, so every node under it reads in the model's millimetres (*2.3*).
    The export scene has one node per bar, part or fastener, named `<id> <label|item>`, sharing
    one mesh per distinct geometry; a project plate's or bent angle's holes are its node's
    children, `<part>.<hole> <rod>` (*2.3*). It is not the render scene. What does not derive is
    not in the file.
  - `extras`: kind, id, item, SKU, options, cut length; a fastener's connection (*2.3*).
  - `asset.extras` stamp: AluKit version, the content hash of document + lock + tool version,
    revision, variant, and the git commit and dirty flag as a second field (review M5). This
    answers the "published page traced to no commit" lesson.
- **Cut list, BOM, machining sheet (*2.3*), order list and costs** as Markdown, CSV or JSON (the
  machining sheet without CSV), each stating the lock's hash, and where it prices the basis and
  the oldest read date (§5.4; *2.3*).
- **`derive --json`**, the full derived model for external report builders, stating the lock's
  hash (*2.3*).

STEP, DXF flats and a self-contained report come in v2 (D6).

## 10. Repository layout and stack

```
src/core/      schema (Zod), expressions, commands, derive, frames, ends, connections, patterns,
               cut list, nesting, BOM, offers, costs, checks, diff, canonical form, section properties
               (2.3: also the lock, revisions, project items and the machining sheet)
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
tests/fixtures/ catalogs/test*/, golden-ends/, golden-gen/, cart/ (12), order/, base-frame/
tests/e2e/     Playwright (unit tests sit next to the code)
docs/
```

`src/core/` and `src/catalog/` import no three.js and nothing from `src/ui/`; the CLI imports
nothing that reaches `.tsx`. The checks' `bbox()` reads the bodies from `src/mesh/`'s three-free
modules (`extent.ts` and what it imports), so it measures what is drawn (*2.3*); a test walks
the imports of `src/core/` and `src/catalog/` and fails on any that reaches three.js.

**`alukit serve`** serves the built app (`dist/`, rebuilt by the CLI when its source hash
changes) from `node:http`. **v1 limit** (*2.3*): `serve` does not rebuild `dist/`; it refuses to
start without a build and says to run `pnpm build` (v1.1). The same server module mounts in Vite's
dev server while AluKit itself is developed (`ALUKIT_PROJECT=<dir> pnpm dev`, *2.3*), with the
same session, token and checks in front of every request, Vite's own included, and Vite's CORS
middleware off. Review 1 suggested Vite in middleware mode as the only server; that would put
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
  test decides, and a package that fails drops to its previous release. *2.3*: M0 kept every pin
  on Node 26.13.1 and pnpm 12.23.0. pnpm 12's minimum-release-age rule refused vite 8.4.0, so
  `pnpm-workspace.yaml` excludes it from that rule, an exclusion to drop once 8.4.0 is old enough
  (open).
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
3. **Sections**, for every profile stem (review M6): 27, 8 `exact` and 19 `parametric`, where
   draft 2 counted 25 (*2.3*; M2b). The **reference project's profiles go first** (M2a), the rest
   in M2b.
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
   - **v1 state** (*2.3*): the first families are modelled and reviewed once. The other
     connectors carry the systems they fit, read from their names, and say in their provenance
     that they have no mounting model yet: no frame, mounts or fastener sets. The rest is later
     layer-2 work.
5. **Services.** The machining services guide (56 pages, outside the API: mitre 1–60°, threads,
   connector holes, access holes, parallel holes) goes into `services.json` by hand, with page
   references. Not in v1 (*2.3*; §3.1): v1 prices machining by covering cost lines.
6. **Overrides** with `expect`: the 40x80's strong-axis inertia (printed 6.55 for 65.5 cm⁴, a
   lost digit; *corrected 2026-11-26 by M2a: the labels are not swapped*) and the 40x40 fechado's mass; other inconsistencies as accepted mismatches with notes
   (*read: survey §7*).
7. **Clone ratings.** HIWIN HG values for the HGR/HGH rails and carriages go once into
   `catalogs/ref-hiwin/`; Forseti's items point at them with `clone_of` (review m8). Two HIWIN
   editions print different moment ratings (MP, MY); the catalog keeps the cited edition's, with a
   note that the other's are lower. Which to use is open until loads are checked (v2).
8. **`alukit catalog check forseti`** produces the computed-vs-published report.

## 12. v1 milestones (review M9)

Every "done when" is a test or a measurement that can fail. Synthetic fixtures in
`tests/fixtures/` keep D2 (no projects in this repo) and still exercise what the reference project
needs:

- `catalogs/test/`: a small synthetic catalog (two T-slot bars with parametric sections, an RHS,
  a threaded rod and a tube sold in stock lengths, a rail sold in stock lengths with
  `factory_E_mm` and its carriage with a `run` datum, a bracket with per-system fastener sets and
  a sleeve, a hinge with pivot geometry, a splice stud, fasteners sold in packs and in a kit,
  regular and sale prices, and an offer priced as a quoted range). *2.3*: beside it, one small
  synthetic catalog per milestone that needed items `test/` does not hold, so no milestone moved
  another's oracle: `ref-test/` (clone ratings), `test-geo/` (M3a), `test-gen/` (M3b),
  `test-order/` and `test-order-eu/` (the order rules), `test-joint/` and `test-open/` (the
  acceptance gaps), `test-stud/` (the second run's), `test-span/` (gap X4).
- `golden-ends/`: the end cases of §4.6 (G1–G21; G27 and G28 since 2.2 and 2.3).
- `golden-gen/`: the generation and cost cases of §4.6 (G22–G26; G29–G34 and G38 since 2.3).
- `order/` (*2.3*): two suppliers, both READY as written, for the order rules: each test patches
  one condition in, so each rule has a case that blocks and one that does not.
- `base-frame/` (*2.3*): the cart's base frame built by the CLI from an empty project, the oracle
  M4b's mouse script draws against.
- `cart/`: a small synthetic cart with the reference project's classes of construction, and none
  of its specifics: T-slot bars with eccentric anchors and a rolled 40x80, a steel beam, a strut
  bearing on another bar's end, a flat bar flush with a beam's cut ends, a rail run from stock
  lengths with its factory ends at the joint, a pattern of carriages crossing the joint, threaded
  rods cut from stock as the fasteners of a face joint, in sleeves inside a hollow section, at a
  selection of the rail's holes, braces between pivots, a bolted stack of five layers with
  packers, a plate with threaded and countersunk holes, a placeholder, unplaced lines, a price
  band, and cost lines. Its expected outputs are worked by hand.

**State** (*2.3*): every milestone below is done, all on 2026-11-26. Each milestone's calls are in
its note in [`notes/`](notes/README.md); where the build differs from what a row asked for, the row
says so.

| M | Delivers | Done when |
|---|---|---|
| M0 | Scaffold: Vite + TS + Preact + three, Biome, Vitest, Playwright; the CLI entry; the server skeleton; Node 26 and pnpm verified | from a clean clone on Node 26: `pnpm install --frozen-lockfile`, `pnpm test` and `pnpm build` pass; `node src/cli/main.ts --version` runs without a flag or a warning; Playwright sees a non-blank canvas. A failure on 26 is recorded and the pin moves to 24 LTS. **Done**: every check passed from a fresh clone on Node 26.13.1 and pnpm 12.23.0; the pin stays on 26 |
| M1 | Catalog schema (envelope, items and offers, kinds, ratings vocabulary), merge layers, sections with fidelity, generators, section properties, `catalog check`. Draft 2.1's four catalog additions (offer ranges, `factory_E_mm`, part `datums`, sleeves in `mounts`; see the changelog) follow as a small follow-up | the 40x40 básico's exact outline gives 553.5 ± 0.1 mm² and Ix, Iy 9.13 ± 0.01 cm⁴; each generator matches its closed-form A and I within 0.1 %; a test override with a stale `expect` is reported; a family file that changes an importer field fails. **Done**: 553.53 mm², Ix 9.1287 and Iy 9.1307 cm⁴; the worst generator 0.0025 % from its closed form; the four 2.1 additions followed in M2a ([m1](notes/m1-decisions.md), [m2a](notes/m2a-decisions.md)) |
| **M1.5** | **Paper model**: the reference frame's document written against the draft schema, by a throwaway converter from its existing model. Both are kept in this repo's gitignored `internal/` folder, not in the reference project's repo (decision A1 of the build session log; they may move there later) | every body of the reference frame is in the converted document or on a written gap list, and each gap is closed by a schema change in this design or an explicit v1 exclusion. One or two days. **Done 2026-11-26**: every body is in the document; the 20 gaps are closed by draft 2.1 (§16; [findings](reviews/m1.5-paper-model-findings.md)) |
| M2a | Forseti items the reference project uses, the `std` steel and fastener items it needs, `ref-hiwin/` | each item has a section with a declared fidelity and offers with regular and sale prices and read dates; the 8 exact outlines pass `catalog check` within 1 % or are accepted mismatches. **Done**, with `catalog check` passing on all three catalogs; every `std` and `ref-hiwin` number then compared with a public source ([verification](notes/std-hiwin-verification.md)) |
| M3a | Points, frames, placement, end planes in two sweeps and connections, runs, cut list | the end cases G1–G21 (§4.6) and the frame table (§4.4) pass to 0.01 mm; the cart's cut list equals its hand-worked table. **Done**: no golden value was wrong ([m3a](notes/m3a-decisions.md)) |
| M3b | Generation (machining, hardware by system, rail holes and their selections, fasteners and sleeves cut from stock, patterns), BOM, offers and the order list with its rules, costs, price bands and totals, checks, commands with undo, CLI, lock file, canonical form | G22–G26 (§4.6) pass; the cart's order list and totals equal golden files byte for byte, on Linux and macOS; 37 screws pick the cheapest pack cover; each order rule has a test that blocks and one that does not. **Done**, in three parts ([generation](notes/m3b-gen-decisions.md), [the edit path](notes/m3b-doc-decisions.md), [the order](notes/m3b-order-decisions.md)); Linux in CI, macOS in the merge gate (§5.2) |
| Slice | **Early acceptance**: the reference frame's T-slot cut list (run in its own repo) | every T-slot piece within 0.5 mm of the record's drawn length, compared as §13 test 1 says, or on a written exceptions list with its reason. **Passed**: the largest difference 0.04 mm. Two pieces needed stand-ins, for gaps G-A and G-B, since closed by G27 (draft 2.2) and G28 |
| M4a | Viewer: rendering, selection, properties, the server owning the document, event stream, watcher, security | in Playwright: a CLI command appears in two open tabs within 1 s at the same revision; an invalid direct edit makes both read-only with the error; requests without the token, or with a foreign `Origin` or `Host`, get 403. **Done**: the edit showed 4 to 31 ms after the CLI exited ([m4a](notes/m4a-decisions.md)) |
| M4b | Draw tool with snapping and work plane, connect, place part, pattern, catalog browser | a Playwright script draws the cart's base frame with the mouse, and its derived cut list and BOM equal those of the CLI-built fixture. **Done**: byte for byte; `snapshot` came with it ([m4b](notes/m4b-decisions.md)) |
| M2b | The rest of Forseti's catalog, beside M4 | every one of the 1,196 orderable SKUs maps to an offer (a test against the importer's raw dump); every profile stem has a section with a declared fidelity. **Done**: 1,196 of 1,196, checked against a committed SKU list everywhere and against the raw dump when it is present; 27 stems ([m2b](notes/m2b-decisions.md)) |
| M5 | Variants with `only_in`, diff, revisions with stored outputs, the GLB writer, `snapshot`, the skill | a diff across two commits with a lock price change reports it; `revision verify` shows zero drift on an untouched revision; two GLB exports are byte-identical and load in three's `GLTFLoader` with the expected node names and `extras`; an agent with only the skill rebuilds the cart's frame from a text description and `alukit check` passes (a recorded manual run). **Done**, with one difference: the skill's worked example, a work table from the `forseti` catalog, runs as a test, every command as written; a recorded manual run of an agent rebuilding the cart is not in the repository ([m5](notes/m5-decisions.md)) |
| M6 | Custom plates and bent angles with hole features; generic items and placeholders | the cart plate's threaded, countersunk and counterbored holes appear on its machining sheet; the placeholder blocks only its own line in the golden order file. **Done**; the placeholder holds its own group (§5.5, *2.3*), and G28 closes gap G-B ([m6](notes/m6-decisions.md)) |
| M4c (*2.3*) | The v1 gaps between this design and the build: the variant switch, export and revisions in the top bar, the section plane, the Open items, Params and Decisions tabs, pivots and fastened face joints in Connect, `catalog search` and `catalog import`, `derive --select` | each missing feature of the design-vs-built record ([`notes/design-vs-built.md`](notes/design-vs-built.md), entries 3, 4, 5, 12) is built and tested, and no golden value moves. **Done** ([m4c](notes/m4c-decisions.md)) |
| Gaps (*2.3*) | The model gaps the acceptance found (§13): fit by role (A1), joint recipes (A2), face contact on a section's inner faces (A3), end holes (A4), cost lines in variants (A5), `services_on` lists (A6), a sleeve's hole clearance (A7) | each is closed at its root, with a failing test written first; G29–G32 (§4.6) pass against independent hand scripts; G1–G28 and the cart's outputs do not move. **Done** ([acceptance gaps](notes/acceptance-gaps.md), [A3](notes/a3-face-contact.md)) |
| Gaps, run 2 (*2.3*) | The gaps the acceptance's second run found (§13): a through-fastener for two ends (A9), a connector's machining at positions (A8) | each is closed at its root, with failing tests written first; G33–G34 (§4.6) pass against independent hand scripts; G1–G32, the cart's and the base frame's outputs do not move. **Done** ([acceptance gaps, second run](notes/acceptance-gaps-2.md)) |
| Gaps, run 4 (*2.3*) | The joint geometry the acceptance's fourth run found (§13, F2): an end hole along its fastener's axis, a butt's end face on its face, a head on material | each is closed at its root, with failing tests written first; G35–G37 (§4.6) pass against independent hand scripts; no earlier value moves, and the new checks' diagnostics on earlier fixtures are listed in §4.6 and the cart's hand script. **Done** ([f2](notes/f2-joint-geometry.md)) |
| **Acceptance** | §13 | §13. **Passed on run 3.** Runs 1 and 2 passed tests 1–4 and failed on model gaps, which were fixed at their root (G29–G34) |

## 13. Acceptance (review B2, M9)

**Scope, in writing.** Acceptance is the reference project's **frame structure** (an internal lab
rack), modelled in its own repo:

| In | Out |
|---|---|
| Every structural body: T-slot bars, steel sections (the main beam, rolled angles, flat bar), threaded rods cut from stock as fasteners with their sleeves inside hollow sections (§4.5), linear rails as bars with their carriages placed on them, plates, connectors and fasteners, packers and pads | **The drive and the dampers** (v3 mechanisms), and all motion |
| Splices and runs, braces cut between pivots, ends bearing on other bars' ends, bolted stacks of several layers, patterns of repeated stations and selections of rail holes, unplaced lines | Loads and utilisation (v2); a part's own mounting hardware beyond unplaced lines (§4.7) |
| The record's cost lines that are not parts (machining, steel work, assembly, freight, contingency), as `costs` | The record's unused alternatives: they live in their own variant |

**Oracle.** The record's files disagree on revision, price basis and lengths (*read: review 1
M9*), so the reference project's repo names the files, the revision and the tolerances before
acceptance starts. The tests then are:

1. **Cut list**: every bar within 0.5 mm of the record's **drawn** length for it, or on a written
   exceptions list with the reason. The drawing is the oracle, not the bill: the paper model found
   the bill ordering spliced members node to node and some members by estimate, while the drawn
   geometry matched the end-plane rules every time (*measured by M1.5*). A bar is compared by
   `cut_mm` when both its ends are square, and by `centre_mm` when either end is angled, because
   the record draws an angled end as a square prism from its centre-line point. A member the
   record draws as one body and AluKit splits at a splice compares the sum of its pieces and
   gaps. A bill line that differs from a drawing AluKit matches is an error in the record, so an
   allowed exception.
2. **Mass**: the frame within 1 % of the record, with the difference split per line.
3. **Cost**: the vendor's lines to the cent on a frozen price snapshot (the lock), on regular
   prices. With the cost lines entered and the record's spread of catalog prices entered as
   `price_bands` (§4.11), the totals match the record's raw low, likely and high.
4. **Counts**: pack and kit quantities equal the record's, unplaced lines included (§4.7), or the
   difference is explained.

Acceptance **fails** if any exception is caused by a gap in AluKit's model. An exception may only
be an error in the record or a deliberate scope exclusion from the table above.

**Run, 2026-11-26** (*2.3*; the details stay with the reference project). Tests 1–4 **passed**:
every bar within 0.05 mm of the record's drawn length; the mass within 1 %; every vendor line to
the cent on a lock frozen at the record's price date; pack and kit counts equal. Every exception
was an error in the record. Acceptance still **failed** by the rule above, on gaps in AluKit's
model: A1 (a connector whose mount holds a sleeve could fit no bar) and A3 (a block on an angle's
inner leg could not be a layer), with smaller gaps A2 and A4–A7. All seven are fixed at their
root (§3.4, §4.5, §4.10, §4.11), with golden cases G29–G32 (§4.6).

**Second run, 2026-11-26** (*2.3*). With A1–A7's constructs in place of the first run's workarounds,
tests 1–4 **passed with no exception at all**: every exception of the first run had been an error in
the record, which its owner fixed. Acceptance still **failed**, on one gap in AluKit's model, A9:
one stud through a tube in one sleeve into a bush on each side could be written only with two of
everything, or with a `fit` error on the second end. A second gap, A8, moved no test but put a
connector's several taps and holes, and a splice's several studs' taps, at one point without a
diagnostic. Both are fixed at their root (§3.4, §4.5, §5.5), with golden cases G33 and G34 (§4.6;
[notes](notes/acceptance-gaps-2.md)).

**Third run, 2026-11-26** (*2.3*): **acceptance passed.** With A8's and A9's constructs in the
document, tests 1–4 passed with no exception, and every compared number equals the second run's.
`held_by` removed the second run's two `fit` errors, and the positioned machining took the coincident
ops from 16 to none and the splice taps to the record's count. AluKit's `check` raised one error, a
fault in the record itself (two screws of a joint leave the block they fix), confirmed by hand.
One minor finding moved no test: an end tap is not checked against the section's cores, so a tap
written with no position on a section with no centre core passes silently (a v1 limit, §5.5).
*Closed after the run* (*2.3*): a tap into a bar's end on none of its section's cores is a
`machining` error, and a section that gives no core positions an info
([notes](notes/v1-limits-closed.md) 16–21). With it, the reference document's single-screw end joints, where the
record says only "the profile's tapped core" on sections with no centre core (an open item in the
third run), are `machining` errors that hold the order until the record names the core. No
compared number moves: the check is right, and the question is the record's.

## 14. Calls made without asking (veto any)

1. Z-up mm world (the Fusion frame); conversion only in the scene and GLB.
2. The UI is in English; vendor names stay as published (Portuguese).
3. Desktop, mouse and keyboard only, for editing in v1. The Quest sees the GLB.
4. A project is `alukit.json`, `alukit.lock.json` and `revisions/`; `.alukit/` holds per-machine
   state and is gitignored.
5. A small safe expression language, not JavaScript; trig in degrees.
6. The default connection is a butt with an angle bracket (no machining). The through bar is the
   one passing through the point, else a vertical, else the lowest id; its end covers. *2.3,
   open*: drawing a rail onto a post's top then butts the rail into the post, so a frame whose
   posts stand under its rails is drawn with auto-connect off (§4.5).
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
25. *New in 2.1.* The grip is the layers and declared gaps; the stack is listed beside it. Washers
    join the grip with the fastener-length check in v1.1 (§4.5).
26. *New in 2.1.* A rail's hole layout follows how it is sold: from a factory end for a stock
    rail, centred only when drilled to order; with no `holes`, a stock rail warns and lays out
    from end `a` (§4.7).
27. *New in 2.1.* A `bolt` through layers generates an ISO 273 medium-series clearance hole in
    each (§4.5).
28. *New in 2.1.* `spacer_mm` is measured along the through face's normal, not along the butting
    bar's axis (§4.5, G17).
29. *New in 2.1.* Price bands live on the project, selected by supplier, kind or item, not by
    tag: a BOM line is per item, and a tag would split it. An offer's own quoted range wins
    (§4.11).
30. *New in 2.1.* Equivalent rolls are never normalised by canonical form; writers pick the
    smallest (§4.4).
31. *New in 2.3, open.* A hole a sleeve passes takes ISO 273 medium for the sleeve's outside
    diameter, the next row up between rows (an inferred rule); `clearance_mm` overrides it (§4.5).
32. *New in 2.3, open.* The draw tool's work plane defaults to the ground, not to a plane that
    faces the view (§8).
33. *New in 2.3, open.* A bent angle's K-factor is required, with no default (§4.8).
34. *New in 2.3, open.* `alukit snapshot` always renders in a fresh headless page, never in an open
    tab (§7.3).
35. *New in 2.3.* Edits made while a variant is shown go to the document as written (§8).
36. *New in 2.3, after acceptance run 2, open.* A shared through-fastener is written as two butts,
    a connector each, the second `held_by` the first, not as one butt whose fastener set counts
    once per connection (§4.5).
37. *New in 2.3, after acceptance run 2, open.* A connector's positions are read in the butting
    bar's section at either end, not turned to suit the end, so an asymmetric pattern is placed as
    written (§3.4).
38. *New in 2.3, after acceptance run 2, open.* One op made twice at one place is an error, which
    blocks the bar's supplier, not a warning (§5.5).
39. *New in 2.3, after acceptance run 3, open.* A thread the vendor does not label a core with is
    judged as a cut thread, and fits when its tap drill is at most one pitch over the core (and the
    core no wider than its largest 6H minor diameter, §5.5). The one-pitch limit on drilling up is
    inferred, not read: no section states the wall around its cores. The vendor's own labels fit
    regardless (§5.5, step 1), so the limit judges only unlabelled cores and other threads.
40. *New in 2.3, after acceptance run 4, open.* An end hole is a screw's clearance when the
    connector also taps the butting end at its position; the pairing is read from the connector's
    own `requires`, not from a field naming the fastener (§3.4).
41. *New in 2.3, after acceptance run 4, open.* A screw into a butting end that meets a side face
    at an angle is an error with no hole, not an angled side hole (§3.4).
42. *New in 2.3, after acceptance run 4, open.* Any overhang past `tol.len` warns unless the
    connector or `defaults.butt` allows more; the overhang is the farthest end-face vertex from
    the face, so a corner past two sides counts its diagonal (§4.5).
43. *New in 2.3, after acceptance run 4, open.* A seat on less than half its annulus warns; the
    half is fixed, not set by the project (§4.5, §5.5).
44. *New in 2.3, after acceptance run 4, open.* The stack's first washer is under the head and the
    next under the nut; a part with no bearing diameter in its item is not checked (an info), with
    no fallback to the ISO tables, since derive reads only the lock (§4.5).

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
| M9 Milestones find the biggest risk last | Adopted. Paper model M1.5, M2/M3 split, early slice, fixtures, failing "done when" lines: §12. Acceptance with numbers and a written scope: §13. The paper model and its converter live in this repo's gitignored `internal/` folder, not in the reference project's repo (decision A1 of the build session log; corrected in draft 2.1) |
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

## 16. M1.5 paper-model resolution

Every gap of the [M1.5 paper model](reviews/m1.5-paper-model-findings.md) and where draft 2.1
resolves it. Major gaps are P1–P5, P8, P14 and P15; the rest are minor. Catalog (§3) changes are
listed in the changelog at the top.

| Gap | Resolution |
|---|---|
| P1 An end plane taken from another bar | Adopted. `butt.through` may name an end; `ends.<x>.plane` takes `of` (flush) and `face` (a face the centre line misses); placement and end providers, resolved in two sweeps, with a chain an error: §4.5. Golden cases G17–G20. The findings left a shoe mitred square to a strut as a v1 exclusion. Draft 2.1 wrote it as the shoe's end butting through the strut's end, which leaves the strut's length typed (`extend_mm`); the early acceptance slice had to type it (gap G-A). *2.2*: a plane's `normal` may name a bar, so the shoe is cut square to the strut's axis and the strut's end butts through the shoe's end. Both derive, in the same two sweeps (§4.5, G27; [`notes/g-a-end-bearing.md`](notes/g-a-end-bearing.md)) |
| P2 Bolted joints through more than two bodies | Adopted. `face` takes two or more layers head to nut, with `gaps_mm`; one fastener per station passes every layer; the grip sums the layers and gaps; a packer cut to length is both a bar and a layer: §4.5. G25. Clearance holes per layer: §4.5, §5.1, call 27 |
| P3 Fasteners cut from bar stock | Adopted. `fastener: { "bar", "len_mm" }`: a piece per station, on the cut list and nested like any bar: §4.5, §5.3. G25 |
| P4 Sleeves inside a hollow section | Adopted. A stack sleeve `{ "item", "inside", "len_mm" }` with `bore` in its expression: §4.5. A connector's `mounts` may list one: §3.4. G25 |
| P5 A stock rail's holes are phased from its factory end | Adopted. `holes`: `factory`, `drilled`, or an `E_a_mm` / `E_b_mm` override, with the default following the sale: §4.7. `factory_E_mm` on rail stock offers: §3.2. Nesting keeps a factory end on every piece: §5.3. G22, G23. One addition: `stock_mm` names the stock length when lengths differ in `factory_E_mm`, so nesting can never move a hole |
| P6 Fastener patterns across a face | Adopted. `stations.across_mm`, in §4.3's u: §4.5. G25 |
| P7 Stations and patterns along a run of spliced bars | Adopted. `runs`; a station on a run lands on its piece, and one on a joint is an error: §4.3. Patterns, `rail_holes` and face layers may name a run: §4.5, §4.7. G24 |
| P8 Stations from a selection of rail holes | Adopted. `rail_holes: { "along", "every", "plus" }`, for part patterns and as a face connection's stations: §4.5, §4.7. G24 |
| P9 Expressions cannot read an item's section | Adopted. `sec(<bar>)`, after swaps: §4.9, §4.10 |
| P10 A butt through a body | Adopted. Any item with a bounding box, at a point or a pose: §4.5 |
| P11 A part's orientation on a station | Adopted. The item's frame on a station, with a table: §4.7. Part items' own frame and `datums`: §3.2. A carriage's `run` datum: §3.4 |
| P12 A free end's length counts from the design point | Adopted. `"from": "a.cut"` on a free end: §4.3; it is an end provider: §4.5. G21 |
| P13 A lump price over bars, or over another supplier's bars | Adopted. `covers` by `items` and by `services_on`: §4.11. Covering by tags is not adopted: `items` covers the case, and a tag would split a BOM line |
| P14 Loose BOM lines | Adopted. Unplaced `parts` entries, counted and priced, not drawn: §4.7, §5.4. Acceptance test 4 counts them: §13 |
| P15 Price bands on catalog prices | Adopted, as a list of bands selected by supplier, kind or item, rounded once per line; an offer's quoted range wins: §4.11, §3.2. G26. Acceptance test 3 uses them: §13. Call 29 |
| P16 The direction of a station's offset | Adopted. u along local +x on the `±y` faces and local +y on the `±x` faces; v along the outward normal: §4.3 |
| P17 Taps for `screw` fastenings | Adopted. A tapped hole in the last layer at each station, through it or to `tap_depth_mm`: §4.5, §5.1 |
| P18 Project items of kind bar or connector | **v1 exclusion.** A project-local catalog by path (§3.1) holds a project's own bars and connectors; no schema change. §4.8 and the skill (§7.5) say so |
| P19 A hole operation's depth | Adopted. `ops` holes go through by default or to `depth_mm`, and take §4.8's hole fields: §4.4 |
| P20 A part's own mounting hardware | **v1 exclusion.** The payload is outside the frame's scope; its screws enter as unplaced lines (§4.7). Carriages may carry `mounts`, as connectors do, in a later version |

**The findings' notes on draft 2** (section 4 of the findings):

| Note | Resolution |
|---|---|
| 1. The centred rail-hole default is wrong for a stock rail cut at one end | Fixed: P5, §4.7 |
| 2. Acceptance test 1 does not say which record length | Fixed: the drawn length is the oracle, compared by `centre_mm` for an angled end and summed over a splice: §13 |
| 3. Acceptance test 3 cannot pass without price bands | Fixed: P15, §13 |
| 4. "Planes depend only on placements" fails for P1 | Fixed: placement and end providers, two sweeps: §4.5 |
| 5. Symmetric sections admit several equivalent rolls | Resolved differently from the note: canonical form does not normalise a roll, since that would rename the faces stations refer to; writers pick the smallest: §4.4, call 30 |
| 6. The converter's location | Fixed: this repo's gitignored `internal/` folder (decision A1): §12, §15 |
