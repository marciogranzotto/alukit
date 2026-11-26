# Design versus built

*2026-11-26. Where [`../design.md`](../design.md) (draft 2.2) says something the implementation
does differently, or does not do yet, as the decision notes and the code have it. For the
coordinator to fold into the design; the design is not edited here. Each entry gives the design's
section, what it says, what was built and the deciding note. "Per the code" marks an entry read
from the sources rather than from a note. An entry marked **Closed** names the commit that built
the missing feature; what it leaves as built stays recorded as a deviation.*

| # | Design | The design says | Built | Decided in |
|---|---|---|---|---|
| 1 | §4.5, §16 | An end's plane comes from a point and a normal or a face; a strut bearing on a shoe mitred square to it keeps its length as a design input | `ends.<a\|b>.plane: { point, normal: "<bar>" }` takes its normal from another bar's axis: a placement provider that resolves in sweep 1, so the strut's length is derived. The bar reference is handled by remove, cascade, copy and mirror like `face.bar` | [g-a-end-bearing](g-a-end-bearing.md); [m4a](m4a-decisions.md) 1-4 |
| 2 | §8 Tools | The work plane defaults to the plane through the start point facing the view's dominant axis; `W` sets it to a picked face | The work plane is the ground (world XY) by default; `W` then a click on a bar picks that face's plane, `W` again returns to the ground; Shift frees the line in the plane moved to the start. `W` takes a bar's face only, not a part's | [m4b](m4b-decisions.md) 13, 39 |
| 3 | §8 Layout | The bottom drawer holds Cut list, BOM, Order, Costs, Checks, Open items, Params, Decisions, Log | **Closed in `077e4ec`**: Open items, Params and Decisions are drawer tabs, each edit one command batch. Left as built: the extra Machining tab (M6) | [m4a](m4a-decisions.md) 42; [m6](m6-decisions.md) 28; [m4c](m4c-decisions.md) 13-15 |
| 4 | §8 Layout | The top bar holds project, variant, undo and redo, revision, the banner and export; the viewport has a section clipping plane | **Closed in `cdd720e` and `077e4ec`**: a variant switch every view follows, Export GLB, the revision with save and verify through the server, and a section plane square to X, Y or Z moved with a slider. Left as built: the read-only banner is its own bar under the top bar | [m4c](m4c-decisions.md) 1-12 |
| 5 | §8 Tools | Connect handles `butt`, `miter`, `splice`, `pivot` and `face` | **Closed in `077e4ec`**: Connect also builds pivots and fastened face joints (bolt, screw, T-nut; layers, stations, gaps), showing what is missing, the command's refusal and derive's diagnostics. Left as built: editing an existing connection is not in the properties panel | [m4b](m4b-decisions.md) 15; [m4c](m4c-decisions.md) 16-19 |
| 6 | §8 Targets, Rendering | Snap targets are nodes, bar ends, stations on face and groove centre lines, face centres and the grid. Placeholders render translucent and hatched | Snap targets add each bar's design line and every placed part's datums and face centres. Placeholders are translucent without hatching (it waits for a texture) | [m4b](m4b-decisions.md) 7, 38; [m4a](m4a-decisions.md) 34 |
| 7 | §8 Targets | Snapping is analytic, "not a raycast against meshes" | Snapping is analytic. Picking a bar, a bar end or a part (select, connect, pattern, `W`) does raycast the drawn bodies | [m4b](m4b-decisions.md) 14 |
| 8 | §7.1 | An invalid project goes read-only, with "restore last good" | That holds for an invalid direct edit while the server runs. `alukit serve` refuses to start on invalid files and lists the problems, since there is no last good state to restore | [m4a](m4a-decisions.md) 6, 8 |
| 9 | §2, §7.1 | Files are canonicalised on the next write; a direct edit is one `file` step | A valid direct edit is taken in as written, not rewritten into canonical form (an editor would reload it); an edit equal to the canonical state is no step | [m4a](m4a-decisions.md) 9 |
| 10 | §7.1, §7.3 | Undo, redo and the log are the server's; `source` tags are `ui`, `cli:<name>`, `agent:<name>`, `file` | `source` must be `ui`, `cli`, `cli:<name>` or `agent:<name>`; `file` is the watcher's alone. `undo`, `redo` and `log` need a running server and say so without one | [m4a](m4a-decisions.md) 16, 27 |
| 11 | §7.2 | Every `/api` request carries the token | `GET /api/health` is the one `/api` path without it (it answers `{ ok: true }`). `Host` and `Origin` are checked on static files too. The server also sends a CSP, `X-Frame-Options`, `nosniff` and `Referrer-Policy`, and checks `Sec-Fetch-Site` | [m4a](m4a-decisions.md) 18-22 |
| 12 | §7.3 | `alukit derive <dir> --json [--select <paths>]`; `alukit catalog search\|show\|check\|import` | **Closed in `cc81bd0`**: `derive --select` (dotted paths, `*`), `catalog search` (ranked as the app's browser, bounded) and `catalog import forseti` (runs the Python importer on its inputs, or says what is missing). Left as built: `catalog schema` besides; the importer itself stays a Python script | [m4c](m4c-decisions.md) 20-25 |
| 13 | §4.9, §5.5 | A check may read `cost("high")` | The language has no strings: `cost(low)`, `cost(likely)`, `cost(high)` take a bound name. `mass()` is the BOM total in kg and `cost()` is in the currency's major unit | [m3b-doc](m3b-doc-decisions.md) 39 |
| 14 | §3.1 | `catalogs/<id>/services.json` holds machining services and their prices | Not built: the design gives no schema and the lock would need to pin it. Services are priced only through a covering cost line (`covers`) | [m3b-order](m3b-order-decisions.md) 13 |
| 15 | §4.10 | A swap replaces an item | A swap replaces an item in entities and `defaults`; `order`, `costs` and `price_bands` keep naming what they name. A swapped bar keeps only the options its new item has (each dropped one is an info) | [m5](m5-decisions.md) 5, 6 |
| 16 | §5.5 | `placeholder` blocks "its own line, under unsourced" | It holds only the group that holds the placeholder's line (the unsourced group, or the supplier it names); an unpriced placeholder gives no `missing-price` besides | [m6](m6-decisions.md) 16 |
| 17 | §4.8 | Project items are described alongside catalog items | They hold numbers, not expressions (a parametric plate is a catalog item). Plates and bent angles default to supplier `local`; placeholders and generic items with no supplier go to the unsourced group | [m6](m6-decisions.md) 3, 4 |

## The three that matter most

1. **Entry 1 (§4.5, §16)**: the end-plane rule gained `plane.normal` as a bar reference. It
   changes the document format and the reference handling of the commands, and the claim in §16
   that the strut's length stays a design input no longer holds.
2. **Entry 2 (§8)**: the work plane defaults to the ground, not to a plane that follows the view,
   because a plane that changes as the camera moves made the drawn point unpredictable.
3. **Entries 6-7 (§8)**: snapping adds targets the design does not list, and picking raycasts
   the drawn bodies, though snapping stays analytic.

Entries 3-5 (the app did less than §8 lists) and 12 (§7.3's CLI) were closed in M4c; what each
still leaves as built is in its row.
