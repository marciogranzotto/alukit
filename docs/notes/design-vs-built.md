# Design versus built

*2026-11-26. Where [`../design.md`](../design.md) (draft 2.2) says something the implementation
does differently, or does not do yet, as the decision notes and the code have it. For the
coordinator to fold into the design; the design is not edited here. Each entry gives the design's
section, what it says, what was built and the deciding note. "Per the code" marks an entry read
from the sources rather than from a note.*

| # | Design | The design says | Built | Decided in |
|---|---|---|---|---|
| 1 | §4.5, §16 | An end's plane comes from a point and a normal or a face; a strut bearing on a shoe mitred square to it keeps its length as a design input | `ends.<a\|b>.plane: { point, normal: "<bar>" }` takes its normal from another bar's axis: a placement provider that resolves in sweep 1, so the strut's length is derived. The bar reference is handled by remove, cascade, copy and mirror like `face.bar` | [g-a-end-bearing](g-a-end-bearing.md); [m4a](m4a-decisions.md) 1-4 |
| 2 | §8 Tools | The work plane defaults to the plane through the start point facing the view's dominant axis; `W` sets it to a picked face | The work plane is the ground (world XY) by default; `W` then a click on a bar picks that face's plane, `W` again returns to the ground; Shift frees the line in the plane moved to the start. `W` takes a bar's face only, not a part's | [m4b](m4b-decisions.md) 13, 39 |
| 3 | §8 Layout | The bottom drawer holds Cut list, BOM, Order, Costs, Checks, Open items, Params, Decisions, Log | Cut list, Machining, BOM, Order, Costs, Checks, Log. Open items, params and decisions are not drawer tabs (they are in the document and in `alukit check`); Machining is new (M6) | [m4a](m4a-decisions.md) 42; [m6](m6-decisions.md) 28; the drawer's own comment |
| 4 | §8 Layout | The top bar holds project, variant, undo and redo, revision, the banner and export; the viewport has a section clipping plane | Per the code: the top bar has the project, undo and redo naming the step, and the revision, with the read-only banner as its own bar. There is no variant switcher, no export button and no clipping plane in the app; variants and exports are CLI-only | per the code (`src/ui/TopBar.tsx`; no clipping code in `src/viewer`) |
| 5 | §8 Tools | Connect handles `butt`, `miter`, `splice`, `pivot` and `face` | Connect builds a butt, a miter, a splice or a resting `face` connection. Pivots and fastened face joints (bolt, screw, T-nut) are written with `alukit do`; editing an existing connection is not in the properties panel | [m4b](m4b-decisions.md) 15 |
| 6 | §8 Targets, Rendering | Snap targets are nodes, bar ends, stations on face and groove centre lines, face centres and the grid. Placeholders render translucent and hatched | Snap targets add each bar's design line and every placed part's datums and face centres. Placeholders are translucent without hatching (it waits for a texture) | [m4b](m4b-decisions.md) 7, 38; [m4a](m4a-decisions.md) 34 |
| 7 | §8 Targets | Snapping is analytic, "not a raycast against meshes" | Snapping is analytic. Picking a bar, a bar end or a part (select, connect, pattern, `W`) does raycast the drawn bodies | [m4b](m4b-decisions.md) 14 |
| 8 | §7.1 | An invalid project goes read-only, with "restore last good" | That holds for an invalid direct edit while the server runs. `alukit serve` refuses to start on invalid files and lists the problems, since there is no last good state to restore | [m4a](m4a-decisions.md) 6, 8 |
| 9 | §2, §7.1 | Files are canonicalised on the next write; a direct edit is one `file` step | A valid direct edit is taken in as written, not rewritten into canonical form (an editor would reload it); an edit equal to the canonical state is no step | [m4a](m4a-decisions.md) 9 |
| 10 | §7.1, §7.3 | Undo, redo and the log are the server's; `source` tags are `ui`, `cli:<name>`, `agent:<name>`, `file` | `source` must be `ui`, `cli`, `cli:<name>` or `agent:<name>`; `file` is the watcher's alone. `undo`, `redo` and `log` need a running server and say so without one | [m4a](m4a-decisions.md) 16, 27 |
| 11 | §7.2 | Every `/api` request carries the token | `GET /api/health` is the one `/api` path without it (it answers `{ ok: true }`). `Host` and `Origin` are checked on static files too. The server also sends a CSP, `X-Frame-Options`, `nosniff` and `Referrer-Policy`, and checks `Sec-Fetch-Site` | [m4a](m4a-decisions.md) 18-22 |
| 12 | §7.3 | `alukit derive <dir> --json [--select <paths>]`; `alukit catalog search\|show\|check\|import` | Per the code: `derive` has no `--select`. `catalog` has `check`, `show` and `schema`; `search` and `import` answer "not implemented yet" (the Forseti importer is a separate Python script) | per the code (`alukit --help`) |
| 13 | §4.9, §5.5 | A check may read `cost("high")` | The language has no strings: `cost(low)`, `cost(likely)`, `cost(high)` take a bound name. `mass()` is the BOM total in kg and `cost()` is in the currency's major unit | [m3b-doc](m3b-doc-decisions.md) 39 |
| 14 | §3.1 | `catalogs/<id>/services.json` holds machining services and their prices | Not built: the design gives no schema and the lock would need to pin it. Services are priced only through a covering cost line (`covers`) | [m3b-order](m3b-order-decisions.md) 13 |
| 15 | §4.10 | A swap replaces an item | A swap replaces an item in entities and `defaults`; `order`, `costs` and `price_bands` keep naming what they name. A swapped bar keeps only the options its new item has (each dropped one is an info) | [m5](m5-decisions.md) 5, 6 |
| 16 | §5.5 | `placeholder` blocks "its own line, under unsourced" | It holds only the group that holds the placeholder's line (the unsourced group, or the supplier it names); an unpriced placeholder gives no `missing-price` besides | [m6](m6-decisions.md) 16 |
| 17 | §4.8 | Project items are described alongside catalog items | They hold numbers, not expressions (a parametric plate is a catalog item). Plates and bent angles default to supplier `local`; placeholders and generic items with no supplier go to the unsourced group | [m6](m6-decisions.md) 3, 4 |
| 18 | §3.4 | A connector fits the joined bars' systems | Fit is judged by role: a butting bar by its system; the through bar by its system, or by its bore when a chosen fastener set sets a sleeve in it. A connector may be a joint recipe (`recipe: true`): no body, not bought, listed apart in the BOM | [acceptance-gaps](acceptance-gaps.md) A1, A2 |
| 19 | §3.4, §4.5 | A connector's hole in the through bar goes where the butting bar meets it | For a butt through the through bar's end, into that end face along its axis: an `end-hole` op with its offset from the section's centre | [acceptance-gaps](acceptance-gaps.md) A4 |
| 20 | §4.5 | Where a sleeve passes a wall, the wall's hole takes the sleeve's outside diameter | The hole clears the sleeve: ISO 273 medium for a shank of its outside diameter, or the diameter plus the sleeve's `clearance_mm` | [acceptance-gaps](acceptance-gaps.md) A7 |
| 21 | §4.10, §4.11 | Entities take `only_in` and `not_in`; `covers.services_on` names one supplier | Cost lines take `only_in` and `not_in` too; `services_on` takes one supplier or a list | [acceptance-gaps](acceptance-gaps.md) A5, A6 |

## The three that matter most

1. **Entry 1 (§4.5, §16)**: the end-plane rule gained `plane.normal` as a bar reference. It
   changes the document format and the reference handling of the commands, and the claim in §16
   that the strut's length stays a design input no longer holds.
2. **Entries 3-5 (§8)**: the app does less than §8 lists. Variants, exports, the clipping plane,
   the open-items, params and decisions panels, and Connect for pivots and fastened joints are
   reached through the CLI or the document today.
3. **Entry 2 (§8)**: the work plane defaults to the ground, not to a plane that follows the view,
   because a plane that changes as the camera moves made the drawn point unpredictable.
