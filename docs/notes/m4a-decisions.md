# M4a decisions: the viewer and the server that owns the document

*2026-11-26. Calls made while building M4a (design §12: rendering, selection, properties, the
server owning the document, the event stream, the watcher, security) where
[`design.md`](../design.md) is silent or ambiguous, and the gap G-A fold-in. For the coordinator
to fold into the design or veto. Labels: **verified** (run, with how), **read**, **inferred**.*

## Gap G-A in the command layer

| # | Decision | Why |
|---|---|---|
| 1 | `ends.<x>.plane.normal` as a string is a whole reference to that bar, as `face.bar` and `of` are: `removeEntity` refuses while it names the bar, `cascade` removes the bar that holds it, `setBar` checks the bar exists, and `query` lists it (`bars of b3`) | One rule for every reference a plane holds; cascade never rewrites an entity (m3b-doc decision 17) |
| 2 | Copies remap it through a new rewriter hook, `axisBar`, which defaults to `id`: `array` and `explodePattern` rename it inside the copied set and keep it outside, since a translation keeps an axis. It never reaches the `direction` hook, which reads world axes (`+x`) | The string is a bar, not a direction |
| 3 | `mirror` keeps a bar outside the set when the plane maps its axis onto itself, up to sign (t_k = 0, or t square to the plane); otherwise it asks for the bar to be included. This is weaker than the self-map other bar references need | A normal reads only the bar's axis (g-a-end-bearing.md), so the image is square to R(t), and R(t) = ±t is all it needs |
| 4 | `reverseBar` and `splitBar` leave it as it is | Reversing turns the axis over, and the sign does not matter (§4.5); split pieces are collinear |

## The server owns the document (§7.1)

| # | Decision | Why |
|---|---|---|
| 5 | **Valid** means what §7.4 says: strict JSON (no duplicate keys) that validates against the document schema, and a lock, if present, that validates against the lock schema. A dangling reference or a bar that does not derive is a diagnostic, not invalidity | Principle 8: a half-edited document still draws. Commands may leave such documents too (m3b-doc decision 12), so the server must hold them |
| 6 | `alukit serve` refuses to start on invalid files, listing the problems, rather than starting read-only with no last good state | A read-only server with nothing to restore helps no one; `alukit check` says what to fix |
| 7 | The server holds `.alukit/edit.lock` for as long as it runs (`by: "alukit serve"`). A headless writer is then refused with a message naming the server. The CLI looks for a server first, so it only meets the lock in a race | No headless process can write between the server's read and its write. A read command that finds the lock held derives anyway, from the lock pinned in memory, and says it did not write it |
| 8 | A step is applied (pure), its files written (lock, then document, only the ones whose canonical text changed), then committed to the history and broadcast. A failed write leaves no step and makes the project read-only with the error; "restore last good" writes again | The history never holds a step the disk does not |
| 9 | A valid direct edit is taken in as it was written, not rewritten into canonical form. An edit whose canonical text equals the current state's (`fmt`, an editor's re-save) is no step; an edit that names a new item pins it and writes the lock only | §2: "canonicalised on the next write". Rewriting a file just saved makes every editor reload it |
| 10 | The watcher is `fs.watch` on the project folder (an editor that saves by rename replaces the file's inode) plus a 1 s stat poll; a burst settles for 50 ms. Both only queue the same hash check, so a duplicate is harmless | Node's docs say `fs.watch` is not reliable on every file system (**read**). Both paths are tested, in place and by rename (**verified**: `host.test.ts`) |
| 11 | The revision is the history's counter, from 0 at each start; undo and redo move it on. Going read-only and back does not: it is a `status` event | A revision names a state; read-only is about the files |
| 12 | The log names who asked for an undo or redo (`ui`, `cli:me`), and the step taken back by its revision (`of`); the step keeps its maker | "Undo pops the latest step, whoever made it, and names it" |
| 13 | Live catalogs are opened again for each batch and each direct edit | A catalog edited while the server runs reaches pinning and `lockUpdate` with no restart |
| 14 | Ids: the last 256 are remembered with their answers, refusals included; a retry while the first is queued gets the same answer | §7.1: "makes a retry harmless" |
| 15 | `baseRev` is advisory: the answer lists the steps after it (`between`); `strict: true` refuses a stale base with 409 | §7.1 |
| 16 | `source` must be `ui`, `cli`, `cli:<name>` or `agent:<name>`; `file` is the watcher's alone | The log's tags (§7.1) must mean what they say |
| 17 | Answers: 200 applied, 422 refused, 409 read-only, stale base or nothing to undo, 400 malformed body, 415 not JSON, 403 the gate, 500 a failed write | An agent tells a refusal from a broken request by status |

## Security (§7.2)

| # | Decision | Why |
|---|---|---|
| 18 | `Host` and `Origin` are checked on every request, static files included | A rebinding page gets nothing, not even the app |
| 19 | `GET /api/health` is the only `/api` path without the token. It answers `{ ok: true }` and nothing about the project | A liveness probe needs no secret, and gives none |
| 20 | `Sec-Fetch-Site`, when present on `/api`, must be `same-origin` or `none` | Defence in depth for `no-cors` requests, which carry no `Origin` |
| 21 | The token is 256 bits, base64url, sent as `Authorization: Bearer`, compared in constant time | §7.2 |
| 22 | Every answer carries a CSP (own scripts and connections only, `frame-ancestors 'none'`), `X-Frame-Options: DENY`, `nosniff` and `Referrer-Policy: no-referrer`; API answers `no-store` | A framed or sniffed page is another way in |
| 23 | `owner.json` is written at 0600 from its creation (`writeAtomic` takes a mode) and removed on close only if it still holds this server's token | A newer server's file is not the old one's to remove |
| 24 | Path confinement: `confine()` resolves a request's path inside the project with symbolic links followed, a file not yet there through its nearest existing parent. No M4a request names a path, so it gates nothing yet; M5's exports and revisions use it. The static server confines to `dist/` as before | §7.2. The document's own catalog paths are the project's configuration and may lie outside it by design (§4.2, `../my-parts`): they are not request paths |
| 25 | The CLI trusts an owner file only when its process is alive (same host) and `GET /api/session` with its token answers for this folder's real path; otherwise it works headless | A crashed server or a reused pid must not swallow an edit |

## CLI (§7.3)

| # | Decision | Why |
|---|---|---|
| 26 | Through a running server: `do`, `add`, `lock update` (as the `lockUpdate` command; cut effects from the project before and after), `undo`, `redo`, `log`. `fmt` and the read commands work on the files; a `fmt` that would write meets the server's edit lock and says so | Edits appear live and enter the log; reads of the files are already the server's state, except while it is read-only, when the files are what is broken |
| 27 | `undo`, `redo` and `log` need a server and say so without one | The log lives as long as the server (§7.1) |
| 28 | `serve` prints the address with the token on stdout and opens it with the platform's opener; `--no-open` does not | Tests and remote shells need the address, not a browser |

## The view model and the viewer (§8)

| # | Decision | Why |
|---|---|---|
| 29 | One `GET /api/model` per revision holds everything a tab shows (`alukit.view/1`): `alukit.derived/1`, display data, the lock's entries the model uses, checks, cut list and BOM. It is built once per revision. Status and undo/redo come on the event stream | Every panel shows the same revision; the derived model's public contract is reused, not copied |
| 30 | The server sends display outlines (RDP at 0.05 mm, §3.5) and each bar's section shift (offset − anchor); the client places geometry from the derived frame and end planes | The browser never reads catalogs; the mesh code stays Node-safe for the GLB writer (§9) |
| 31 | An end within 0.005° of square is drawn square (instanced); any other bar gets its own geometry, each vertex moved along the axis to its end plane | Half the output quantum of angles (§2); exact for planar cuts (**verified**: G27's shoe, every vertex on its plane, `mesh.test.ts`) |
| 32 | Instancing groups bars by section and colour; colour follows `opt.finish` (anodised, black), steel grey with none | §8: "per section and finish" |
| 33 | Edges are `EdgesGeometry` at 30° once per section's unit extrusion, carried onto each bar by the same map into one buffer | §8; a T-slot's rounded corners would otherwise draw every facet |
| 34 | Parts: a box from the item's `bbox_mm` in its own frame at `origin`; with no box, a translucent 20 mm marker at the station; placeholders translucent. Hatching waits for a texture | §8; no item kind has a mesh yet |
| 35 | Fasteners of face connections are drawn: from the head (`point − axis × layers[0].to`, since the first layer's far face holds the station point) for the last layer's `to`, at the thread's diameter (6 mm with none); a pick selects the connection. A butt's connectors are counted, not placed, by derive, so they are not drawn | Draws only what derive positions |
| 36 | Bar mass in the properties is the BOM's rule (centre-line length × mass per metre), with the mass per metre's provenance in the popover | §5.4; one rule everywhere |
| 37 | Selection: a click picks (Ctrl or Cmd toggles); Shift-drag is a window box (every corner of a body inside); Escape clears. The tree lists the document's entities and derive's pattern copies, an entity that does not derive marked | §8 Tools: click or box. A body that does not derive must still be selectable to fix |
| 38 | The scene renders on demand (after a camera move, a model, a selection or a resize), and fits the camera to the first model only | Keeps the machine calm; later revisions keep the person's view |
| 39 | Test hook: `window.__alukit` gives the scene's counts and the revisions announced and drawn, nothing else | The rendering test compares the scene's bar count with `alukit derive --json` |

## Measured

- Done-when 1: a CLI `add bar` shows in both tabs, at the same revision and with the new bar in
  each scene, 4 to 31 ms after the CLI exits, and 500 to 520 ms after it starts, Node's own
  startup included (**verified**: three runs of `tests/e2e/live.spec.ts` on an M-series Mac).
- Done-when 2 and 3: `tests/e2e/readonly.spec.ts` and `tests/e2e/security.spec.ts` (**verified**).
  The security spec also runs the attacks as a browser makes them: a foreign page's fetch with
  the token is stopped at its preflight, and a page loaded through a rebinding name gets 403.
- The cart draws 39 bars, 3 parts and 2 fasteners; `alukit derive --json` reports 39 bars.

## Not done in M4a

- The API mounted in Vite's dev server (§10): `pnpm dev` shows the app with no access. Built apps
  through `alukit serve` only.
- `serve` rebuilding `dist/` when the sources change (§10): it refuses to start without a build.
- Orthographic and standard views, the section plane, hole markers, placeholder hatching, and the
  drawer's order, costs, open items, params and decisions tabs.

## For M4b (draw, connect, place, pattern, catalog browser)

- Commit each drag as one `POST /api/commands` with `source: "ui"`; the answer comes back as the
  next revision on the event stream.
- Snapping (§8) needs section grooves and datums in `display.sections`; the view model has
  outlines and boxes only.
- The catalog browser needs an API over the live catalogs (search, item cards, offers), which
  the server already opens per batch.
- `barCorners`, `barMapper` and the viewer's pick index (`src/mesh/bars.ts`, `src/viewer/scene.ts`)
  are where face picking and the work plane start.
