# M4c decisions: the v1 gaps between the design and the build

*2026-11-26. Calls made while closing the gaps [`design-vs-built.md`](design-vs-built.md) listed
as missing features (entries 3, 4, 5 and 12): the variant switch, export and revisions in the top
bar, the section plane, the Open items, Params and Decisions tabs, pivots and fastened face joints
in Connect, and `catalog search`, `catalog import` and `derive --select` in the CLI. Where
[`design.md`](../design.md) is silent or ambiguous. For the coordinator to fold into the design or
veto.*

**No golden value changed.** No file under `tests/fixtures/` was touched, and the golden tests
pass as before.

## The server

| # | Decision | Why |
|---|---|---|
| 1 | Every answer derived from the document takes `?variant=<name>` as the CLI takes `--variant`: `/api/model`, `/api/derived`, `/api/cutlist`, `/api/bom`, `/api/machining`, `/api/check`, `/api/order`, `/api/costs` and `/api/export/glb`. Without it, the project's default variant (as written when there is none); an unknown name is a 400 with the CLI's message ("there is no variant X; the project has a, b") | One rule for both (§4.10, §7.3): the same variant gives the same bytes from either. The CLI's message, so an agent reading both sees one wording |
| 2 | The server keeps one snapshot per variant asked for, per revision; a step drops them all | A variant is derived on demand and only when a tab shows it; the default variant's snapshot is the one the server already keeps |
| 3 | `/api/check` adds `variant` to its answer, as `alukit check --json` does | The tab says which variant the verdict is for; the two answers match field for field |
| 4 | `GET /api/export/glb` answers the bytes `alukit export glb` writes for the same state and variant (the stamp's revision is null and its git commit is the checkout's, as the CLI's), as an attachment named `<project name>[-<variant>].glb`, each part kept to letters, digits, `.` and `_` | §9's export, reachable from the app. One writer (`src/export/project.ts`) serves both, so a file from either is the other's. The name says what was exported |
| 5 | Revisions go through the server: `GET /api/revisions` lists them with the current state's content hash; `POST /api/revisions {name, as_of?}` saves one in the server's queue, after it takes in any direct edit; `GET /api/revisions/verify?name=` re-derives one. Saving is refused while read-only (409), on a name that exists (409, a revision is never overwritten) and on a name with no letter or digit (400) | §4.13's save and verify from the app. In the queue, the saved state is exactly a revision the server holds |
| 6 | `alukit revision save` sends its request to the server when one runs, and writes the file itself otherwise | The server holds the edit lock while it runs (§7.1), so the CLI could not save beside it; now the file is the same either way |
| 7 | The top bar's revision reads "Revision: <name>" when a saved revision's content hash equals the current state's, else "Revision: unsaved" | §8 names a revision in the top bar without saying which. The hash is §4.13's own test of "the same state" |

## The app

| # | Decision | Why |
|---|---|---|
| 8 | The variant switch shows only when the document has variants; its first entry is "default (<name>)" or "as written". It changes what every view derives: the model, the drawer's outputs and the stats. Edits still go to the document as written | §8 places the switch in the top bar without saying what it switches. A variant is a derivation of the document (§4.10), not a document of its own; a point drawn on a variant's geometry is stored as the numbers it snapped to |
| 9 | Export GLB exports the variant shown, with the server's file name, and says "exported <name>" | What is on screen is what is exported |
| 10 | The revision button opens a small panel: a name to save under, the saved revisions with their date, `alukit` version and commit, "(current)" beside the one that matches, and Verify, which shows the re-derive's verdict | Save and verify are the two revision actions §4.13 gives; both are single requests |
| 11 | The section plane is square to X, Y or Z (world axes, Z up), placed at a distance along that axis, and hides the side beyond it (Flip hides the near side). Dragging is a slider across the model's extent along the axis, not a handle in the viewport | §8 asks for "a section clipping plane" and nothing more. A slider is exact, can be typed into and tested, and does not fight orbit for the mouse |
| 12 | The section plane is rendering only: no step, nothing written. It clips the drawn bodies with three.js local clipping and draws its outline; picks and snaps ignore what it hides | A view setting, like the camera. A click must not land on a bar the user cannot see |
| 13 | Open items, Params and Decisions are drawer tabs. Each edit is one batch of one command (`addOpen`, `resolveOpen`, `setParam`, `addDecision`), so the top bar's undo takes it back as one step; a refusal is shown under the form, with the command's own message | §8 lists the tabs; §7.1's rule that the UI edits only through commands |
| 14 | An open item's scope is typed as ids or taken from the selection ("use selection"); "blocks the order" is ticked by default | Open items mostly gate the order (§5.5); the selection is how a person names entities in the app |
| 15 | A param edited in the tab keeps its provenance when it has one (`{v, src, note}` keeps `src` and `note`, with the new `v`); removing a param the document still reads is refused by `setParam` and the tab shows why | Changing a measured value does not make it unmeasured; the command layer already knows what reads a param |
| 16 | Connect builds pivots: the first click on a face is the base (a station on that face), each later click near a bar end adds that end; the connector is suggested from the palette, else from a pivot the document has | §4.5's pivot needs a base station, the carried ends and a connector with pivot geometry; the clicks follow that order |
| 17 | A pivot is one batch: `addConnection` and one `setBar` per carried end, setting the end to `{pivot: <id>}`. The new id is predicted with the command layer's own rule (`core/ids.ts`) and the batch is sent `strict` at the tab's revision, so a changed document refuses it rather than mis-pointing the ends | A carried end must name its pivot (§4.5), and the pivot does not exist before the batch runs. One rule for the id, shared, so the prediction cannot drift |
| 18 | Connect builds face connections with a fastening: none, bolt, T-nut or screw; a fastener, or a rod cut from bar stock and its length; the stack; stations along the first layer, or its rail's holes; offsets across; gaps; tap depth. The layers are clicked head to nut and may be bars, runs or parts | Every field §4.5 gives a face connection. The panel asks only for the fields the fastening uses |
| 19 | A connection's problems are shown in the panel at three points: a missing field before anything is sent ("name the fastener: an item id"), the command's refusal, and derive's new diagnostics on the new connection ("no groove of b5's face +x where the T-nut goes") | The brief's "validation errors in the UI"; derive's checks are the ones that know whether the joint can be built |

## The CLI

| # | Decision | Why |
|---|---|---|
| 20 | `alukit catalog search <query>` searches every built-in catalog unless `--catalog` names some (a folder or a built-in id, repeatable); `--kind` filters. It prints 20 items unless `--limit`, at most 200, and says how many more matched; `--json` answers `alukit.catalog-search/1`. Exit 1 when nothing matches | §7.3 names the command; bounded output is §7.3's rule for agents. The app's browser keeps its vendor and family filters; the CLI has the one an agent needs most |
| 21 | One index and one ranking for the CLI and the browser (`src/catalog/search.ts`): every word of the query must be in the id, code, name or family, accents, case and `×` aside. Ranked an exact id or code first, then codes that start with the query, then items where each word is a whole word of theirs, then the rest; within a rank the shorter name first, then id order. Browsing with no query stays in id order | The same query should find the same thing in either place. Forseti writes sizes with `×` (`40×40`), which no one types. Whole words first, so `m8` finds "Parafuso M8" before "M8x16"; a shorter name says more of what was asked |
| 22 | `alukit catalog import forseti` runs the importer's `build` (Python, PyMuPDF). Each input comes from its flag, else its variable (`FORSETI_PYTHON`, `FORSETI_SNAPSHOT`, `FORSETI_PDF`, the names the importer's test reads), else `.cache/forseti/` (`venv/bin/python`, the newest snapshot with a `manifest.json`, `catalogo_forsetiA4.pdf`). It writes `catalogs/forseti` unless `--out` | The README's own layout; the catalogue's place in `.cache/` is new and the README says so now. The importer stays a Python script, which the CLI runs |
| 23 | When an input is missing, the command lists each one with how to get it and runs nothing; it checks that the interpreter imports `pymupdf` before building | A half-run build is worse than none. The PDF library is the one dependency outside the standard library |
| 24 | The network is read only with `--fetch`, which first runs the importer's `fetch` into a new folder (`--snapshot`, else `snapshots/<today>`), then builds from it. A folder that exists is refused, as `fetch` itself refuses it | The brief: no network unless asked. A snapshot is new and whole (the importer's rule) |
| 25 | `alukit derive <dir> --select <paths>` answers JSON (`--json` is implied) with only the members named, each where it sits, plus `schema` and `variant`. A path is dotted (`bars.b3.cut_mm`); `*` is every member of an object or every element of a list; paths separated by commas merge. Members keep the model's order. A member the model lacks is an error (exit 1) naming it, not left out silently | §7.3 gives `--select <paths>` without a syntax. Dotted paths with `*` are the smallest syntax that cuts a report out of the derived model; keeping the shape means the answer is still `alukit.derived/1` |

## Checked, not changed

| # | What | Finding |
|---|---|---|
| 26 | In `docs/images/cart-iso.png`, a lower diagonal outside the frame's footprint | It is `b32`, the push handle's grip, not a brace: from `[W + 350, 20, 600]` up to the arm's end at `[W + 150, 20, 800]`, outside the footprint by design ("handle grip, bearing on the arm's end through an end plate"; the hand script's "The push handle"). The four braces `b14`–`b17` run between hinges at x 55 and 400 (and W − 55, W − 400), y 20 and 580: all inside. Not a fixture mistake; no golden touched |
| 27 | `alukit catalog import forseti --out <scratch>` on a cached snapshot and the catalogue PDF | It wrote `catalog.json`, `offers.json` and `sections/` byte-identical to the committed `catalogs/forseti`; only the hand-written `families/` and `overrides.json` are not the importer's |
