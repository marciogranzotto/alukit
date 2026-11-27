# Design versus built

*2026-11-26. Where [`../design.md`](../design.md) (draft 2.2) says something the implementation
does differently, or does not do yet, as the decision notes and the code have it. For the
coordinator to fold into the design; the design is not edited here. Each entry gives the design's
section, what it says, what was built and the deciding note. "Per the code" marks an entry read
from the sources rather than from a note. An entry marked **Closed** names the commit that built
the missing feature; what it leaves as built stays recorded as a deviation.*

**Folded into draft 2.3 (2026-11-26).** Every entry is now in the design: the last column says
how. *Design changed* means the build's choice is now the design's rule; *v1 limit* means the
design states the missing feature as a limit of v1, with the version that takes it up; *closed*
means the design already said what was built. The build was not changed. The file is kept as the
record of what draft 2.2 said and what was built against it.

| # | Design | The design says | Built | Decided in | In draft 2.3 |
|---|---|---|---|---|---|
| 1 | §4.5, §16 | An end's plane comes from a point and a normal or a face; a strut bearing on a shoe mitred square to it keeps its length as a design input | `ends.<a\|b>.plane: { point, normal: "<bar>" }` takes its normal from another bar's axis: a placement provider that resolves in sweep 1, so the strut's length is derived. The bar reference is handled by remove, cascade, copy and mirror like `face.bar` | [g-a-end-bearing](g-a-end-bearing.md); [m4a](m4a-decisions.md) 1-4 | Closed: draft 2.2 already has the rule (§4.5, §16, G27); 2.3 adds that a cascade counts the reference (§6) |
| 2 | §8 Tools | The work plane defaults to the plane through the start point facing the view's dominant axis; `W` sets it to a picked face | The work plane is the ground (world XY) by default; `W` then a click on a bar picks that face's plane, `W` again returns to the ground; Shift frees the line in the plane moved to the start. `W` takes a bar's face only, not a part's | [m4b](m4b-decisions.md) 13, 39 | Design changed (§8, Tools), marked open for review (call 32); a part's face as the work plane is a v1 limit |
| 3 | §8 Layout | The bottom drawer holds Cut list, BOM, Order, Costs, Checks, Open items, Params, Decisions, Log | **Closed in `077e4ec`**: Open items, Params and Decisions are drawer tabs, each edit one command batch. Left as built: the extra Machining tab (M6) | [m4a](m4a-decisions.md) 42; [m6](m6-decisions.md) 28; [m4c](m4c-decisions.md) 13-15 | Closed; the Machining tab is added to the design (§8, Layout) |
| 4 | §8 Layout | The top bar holds project, variant, undo and redo, revision, the banner and export; the viewport has a section clipping plane | **Closed in `cdd720e` and `077e4ec`**: a variant switch every view follows, Export GLB, the revision with save and verify through the server, and a section plane square to X, Y or Z moved with a slider. Left as built: the read-only banner is its own bar under the top bar | [m4c](m4c-decisions.md) 1-12 | Closed; the banner's bar, the switch, the revision and the section plane as built are in §8, Layout |
| 5 | §8 Tools | Connect handles `butt`, `miter`, `splice`, `pivot` and `face` | **Closed in `077e4ec`**: Connect also builds pivots and fastened face joints (bolt, screw, T-nut; layers, stations, gaps), showing what is missing, the command's refusal and derive's diagnostics. Left as built: editing an existing connection is not in the properties panel | [m4b](m4b-decisions.md) 15; [m4c](m4c-decisions.md) 16-19 | Closed (§8, Tools); editing an existing connection is a v1 limit (v1.1) |
| 6 | §8 Targets, Rendering | Snap targets are nodes, bar ends, stations on face and groove centre lines, face centres and the grid. Placeholders render translucent and hatched | Snap targets add each bar's design line and every placed part's datums and face centres. Placeholders are translucent without hatching (it waits for a texture) | [m4b](m4b-decisions.md) 7, 38; [m4a](m4a-decisions.md) 34 | Design changed for the snap targets (§8, Tools); hatching is a v1 limit (§8, Rendering) |
| 7 | §8 Targets | Snapping is analytic, "not a raycast against meshes" | Snapping is analytic. Picking a bar, a bar end or a part (select, connect, pattern, `W`) does raycast the drawn bodies | [m4b](m4b-decisions.md) 14 | Design changed (§8, Tools): picking raycasts, snapping stays analytic |
| 8 | §7.1 | An invalid project goes read-only, with "restore last good" | That holds for an invalid direct edit while the server runs. `alukit serve` refuses to start on invalid files and lists the problems, since there is no last good state to restore | [m4a](m4a-decisions.md) 6, 8 | Design changed (§7.1) |
| 9 | §2, §7.1 | Files are canonicalised on the next write; a direct edit is one `file` step | A valid direct edit is taken in as written, not rewritten into canonical form (an editor would reload it); an edit equal to the canonical state is no step | [m4a](m4a-decisions.md) 9 | Design changed (§2, §7.1) |
| 10 | §7.1, §7.3 | Undo, redo and the log are the server's; `source` tags are `ui`, `cli:<name>`, `agent:<name>`, `file` | `source` must be `ui`, `cli`, `cli:<name>` or `agent:<name>`; `file` is the watcher's alone. `undo`, `redo` and `log` need a running server and say so without one | [m4a](m4a-decisions.md) 16, 27 | Design changed (§7.1, §7.3) |
| 11 | §7.2 | Every `/api` request carries the token | `GET /api/health` is the one `/api` path without it (it answers `{ ok: true }`). `Host` and `Origin` are checked on static files too. The server also sends a CSP, `X-Frame-Options`, `nosniff` and `Referrer-Policy`, and checks `Sec-Fetch-Site` | [m4a](m4a-decisions.md) 18-22 | Design changed (§7.2) |
| 12 | §7.3 | `alukit derive <dir> --json [--select <paths>]`; `alukit catalog search\|show\|check\|import` | **Closed in `cc81bd0`**: `derive --select` (dotted paths, `*`), `catalog search` (ranked as the app's browser, bounded) and `catalog import forseti` (runs the Python importer on its inputs, or says what is missing). Left as built: `catalog schema` besides; the importer itself stays a Python script | [m4c](m4c-decisions.md) 20-25 | Closed; `catalog schema` and the `--select` syntax are added (§7.3) |
| 13 | §4.9, §5.5 | A check may read `cost("high")` | The language has no strings: `cost(low)`, `cost(likely)`, `cost(high)` take a bound name. `mass()` is the BOM total in kg and `cost()` is in the currency's major unit | [m3b-doc](m3b-doc-decisions.md) 39 | Design changed (§4.9) |
| 14 | §3.1 | `catalogs/<id>/services.json` holds machining services and their prices | Not built: the design gives no schema and the lock would need to pin it. Services are priced only through a covering cost line (`covers`) | [m3b-order](m3b-order-decisions.md) 13 | v1 limit, v1.1 or later (§3.1, §4.11, §5.4, §11) |
| 15 | §4.10 | A swap replaces an item | A swap replaces an item in entities and `defaults`; `order`, `costs` and `price_bands` keep naming what they name. A swapped bar keeps only the options its new item has (each dropped one is an info) | [m5](m5-decisions.md) 5, 6 | Design changed (§4.10) |
| 16 | §5.5 | `placeholder` blocks "its own line, under unsourced" | It holds only the group that holds the placeholder's line (the unsourced group, or the supplier it names); an unpriced placeholder gives no `missing-price` besides | [m6](m6-decisions.md) 16 | Design changed (§5.5, §4.8) |
| 17 | §4.8 | Project items are described alongside catalog items | They hold numbers, not expressions (a parametric plate is a catalog item). Plates and bent angles default to supplier `local`; placeholders and generic items with no supplier go to the unsourced group | [m6](m6-decisions.md) 3, 4 | Design changed (§4.8) |
| 18 | §3.4 | A connector fits the joined bars' systems | Fit is judged by role: a butting bar by its system; the through bar by its system, or by its bore when a chosen fastener set sets a sleeve in it. A connector may be a joint recipe (`recipe: true`): no body, not bought, listed apart in the BOM | [acceptance-gaps](acceptance-gaps.md) A1, A2 | Design changed (§3.4, §4.5, §5.4, §5.5; G30) |
| 19 | §3.4, §4.5 | A connector's hole in the through bar goes where the butting bar meets it | For a butt through the through bar's end, into that end face along its axis: an `end-hole` op with its offset from the section's centre | [acceptance-gaps](acceptance-gaps.md) A4 | Design changed (§3.4, §4.5, §5.1, §5.3; G31) |
| 20 | §4.5 | Where a sleeve passes a wall, the wall's hole takes the sleeve's outside diameter | The hole clears the sleeve: ISO 273 medium for a shank of its outside diameter, or the diameter plus the sleeve's `clearance_mm` | [acceptance-gaps](acceptance-gaps.md) A7 | Design changed (§4.5; G32), the default marked open for review (call 31) |
| 21 | §4.10, §4.11 | Entities take `only_in` and `not_in`; `covers.services_on` names one supplier | Cost lines take `only_in` and `not_in` too; `services_on` takes one supplier or a list | [acceptance-gaps](acceptance-gaps.md) A5, A6 | Design changed (§4.10, §4.11) |

**Tally for 2.3.** Closed, the design already matching: entries 1, 3, 4, 5 and 12 (their
left-as-built remainders folded as below). Design changed to the build: entries 2, 6, 7, 8, 9, 10,
11, 13, 15, 16, 17, 18, 19, 20 and 21, plus the remainders of 3, 4 and 12. Left as v1 limits:
entry 14, and the remainders of 2 (a part's face as the work plane), 5 (editing an existing
connection) and 6 (hatching).

**Also folded into 2.3**, from the milestone notes rather than this table (each now a v1 limit or a
correction in the design):

- §3.5: no `channel` or `beam` generator, and no `wall` parameter on `tslot` ([m1](m1-decisions.md)
  34, 35; [a3-face-contact](a3-face-contact.md)).
- §4.5: a butt's connector is counted, not placed or drawn, so a mount sleeve drills no wall
  ([m4a](m4a-decisions.md) 35; [acceptance-gaps](acceptance-gaps.md) A4 decision 12, A7 decision
  22); `faces` names bounding faces only ([a3-face-contact](a3-face-contact.md) 7).
- §4.9: `bbox()` holds the bars, not the parts ([m3b-doc](m3b-doc-decisions.md) 34).
- §5.2: CI runs on Linux only; macOS runs in the merge gate (per the repository's CI configuration).
- §5.4, §9: the cut list, the BOM and the machining sheet do not state the lock's hash
  ([m3b-order](m3b-order-decisions.md), "Not built"; per the code).
- §8: dragging an existing node or bar end is not built ([m4b](m4b-decisions.md), "Not done").
- §10: `alukit serve` does not rebuild `dist/` ([m4a](m4a-decisions.md), "Not done"; per the code).
- §11: 27 profile stems, not 25 ([m2b](m2b-decisions.md)).
- §12: M5's done-when asked for a recorded manual run of an agent rebuilding the cart; none is in
  the repository, and the skill's worked example runs as a test instead ([m5](m5-decisions.md)
  30–32).

## The three that matter most

*As written for draft 2.2; all three are folded into 2.3.*

1. **Entry 1 (§4.5, §16)**: the end-plane rule gained `plane.normal` as a bar reference. It
   changes the document format and the reference handling of the commands, and the claim in §16
   that the strut's length stays a design input no longer holds.
2. **Entry 2 (§8)**: the work plane defaults to the ground, not to a plane that follows the view,
   because a plane that changes as the camera moves made the drawn point unpredictable.
3. **Entries 6-7 (§8)**: snapping adds targets the design does not list, and picking raycasts
   the drawn bodies, though snapping stays analytic.

Entries 3-5 (the app did less than §8 lists) and 12 (§7.3's CLI) were closed in M4c; what each
still leaves as built is in its row.
