# AluKit UX: the contracts S0 built

*S0 of the [UX plan](plan.md) (§5.2): the shared modules, stubs, file splits and test moves the
streams S1 to S5 build against, with no visible change. Read it with the plan's §5.3 (the
interfaces) and §5.4 (who owns which files). After S0, only a file's owner changes it, and a
contract changes only by adding.*

## The interfaces

| Interface | File | Owner | How the streams use it |
|---|---|---|---|
| Design tokens, CSS | `src/ui/styles/tokens.css` | S4 | §5.3's names at today's values, plus today's roles (S0 decision 2). Every colour in a stylesheet is a `var()`; S4 changes values, light ones under `:root[data-theme="light"]` |
| Stylesheets | `src/ui/styles/{tokens,base,shell,viewport,tools,inspector,tables}.css` | S4 (tokens, base, tables), S2 (shell), S3 (viewport), S5 (tools, inspector) | Each region styles in its owner's file. `main.tsx` imports them in cascade order; a later file wins a tie |
| Design tokens, numbers | `src/ui/theme/tokens.ts` | S4 | `COLOURS[theme]` mirrors tokens.css (a test holds them equal); `viewTheme(theme)` gives the viewer its `ViewTheme`; `itemSwatches(model)` is S4.3's (empty today) |
| The theme | `src/ui/theme/theme.ts` | S4 | `theme` signal (dark only today), kept on `<html data-theme>` by `applyTheme()`; the viewport hands `viewTheme(theme)` to the viewer |
| What the viewer draws with | `src/viewer/theme.ts` | S3 | `ViewTheme`: background, fog, lights, bodies by tone, edges, selection, hover, tool, status, grid, overlay. The viewer reads no other colour |
| The export's palette | `src/mesh/style.ts` | S3, frozen (D-UX-24) | The GLB's colours. `finishTone` and `partTone` decide a body's tone for both palettes |
| Selection, hover, Show | `src/ui/focus.ts` | S2 | `selection`, `select`, `hover`, `shown`, `show(req)`, `clearShow()`, type `Ref`. `show` selects what the refs stand for and records the request; each region reacts to the signals (S3 frames and pulses, S2 reveals the targets' rows, S5 points at `field`) |
| Targets | `src/ui/targets.ts` | S3 | `resolveTargets(model, refs)`: ids, points, box. Today: entities and their parts, as the order's reason links did; S3.6 adds ends' points, connections, items, suppliers, open items |
| Corners | `src/ui/corners.ts` | S3 | `Corner` (extends the viewer's `CornerMarker`), `cornersOf(model)` (no corners yet: S3.4), `cornerRef(key)` |
| Viewer additions | `src/viewer/scene.ts` | S3 | `setHover`, `onHover`, `setGhost`, `pulse`, `fitBox`, `setCorners`, `setProblemBadges`, `setColourBy`, `setTheme`, `onRender`, `setLabel`: no-ops, each naming the S3 task that builds it. `createViewer(container, theme)` |
| Viewport and its slots | `src/ui/viewport/{Viewport.tsx,ViewControls.tsx,viewer.ts}` | S3 | `<Viewport slots={{ left, centre, bottom, topRight }} />`: S5's tool buttons in `left`, S2's start card in `centre`, S5's command bar and S2's status bar in `bottom`, S2's toasts in `topRight`. `viewer`, `projection`, `sectionPlane` signals |
| The inspector slot | `src/ui/shell/ProjectPanel.tsx`; `App.tsx` | S2 (S5 renders it) | With nothing selected the inspector (today `Properties.tsx`, S5's) renders `<ProjectPanel />` and nothing else; S2.12 fills it. `App.tsx` places S5's tool form (today `ToolPanel`) and inspector in the right column |
| Palette | `src/ui/palette.ts` | S2 | `palette`, `PaletteItem`: the catalog, bin and start card set it; the tools read it |
| Keys | `src/ui/keys.ts` | S2 | `onKey(scope, handler, priority)` returns its undo. Scopes in order: `overlay`, `tool`, `app`; then priority, then registration. A handler returns true to take the key. The text-entry guard is here alone; plain-key handlers start with `if (chord(e)) return false` |
| Test hook | `src/ui/hook.ts` | S2 (each field: the module that adds it) | `window.__alukit`. A module declares its fields by augmenting `AlukitHook` and adds them with `extendHook` when imported. Today: `rev`, `readOnly` (store), `tool` (tools), `stats`, `drawnRev`, `screen`, `snapshot`, `section`, `clipped` (viewport) |
| Problem model | `src/core/problems/types.ts` | S1 | `ProblemsAnswer`, `Problem`, `Fix`, `Ref`. Types only; additive after S0 |
| Problem fixture | `tests/fixtures/ux/problems-cart.json` | S1 | The cart's problems by hand, for S2, S3 and S4 until BE-3 lands. `src/core/problems/fixture.test.ts` holds it to `alukit check --json` and `alukit order --json` |
| Clients | `src/ui/client/{answer,problems,dryrun}.ts` | S1 | `fetchProblems(q)`, `dryRun(commands)`, each a `ClientAnswer` with `unavailable: true` until S1.6 and S1.7. No stream writes its own `fetch` to these endpoints. S1.3 adds the catalog list's `prefer` here |
| The problems | `src/ui/store.ts`, `problems` | S2 | The drawn revision's `ProblemsAnswer`; S2.6 fills it each revision. Undefined today |
| The tool's prompt, the snap | `src/ui/tools.ts`, `toolPrompt`, `hint.snap` | S5 | `toolPrompt` is what the active tool asks next (the panels show it; S2.7's status bar will). `hint.snap` is the machine label of what the pointer is on, read as `__alukit.tool().snap` |
| Sheets | `src/ui/sheets/{registry.ts,Sheets.tsx}` | S2 | `registerSheet({ id, title, order, badge, Body })`, `sheets`, `activeSheet`, `sheetsOpen`, `openSheet(id, { maximize })`, `selectionOnly`. The container imports no sheet |
| Tables and records | `src/ui/tables/*.tsx`, `src/ui/records/*.tsx` | S4; `records/Params.tsx` S2 | Each registers its sheet when imported: `tables/index.ts` imports S4's, `App.tsx` imports it and `records/Params.tsx` |
| Formats | `src/ui/format.ts` | S4 | `mm`, `deg`, `kg`, `kgPerM`, `money`, `qty`, `group`, each with `{ table? }`; today's forms are the tables', which are the CLI's |
| Entity chips | `src/ui/common/EntityChip.tsx` | S4 | `EntityChip`, `EntityChips`: an id that selects, lit while selected |
| A problem's row | `src/ui/problems/ProblemRow.tsx` | S4 | `ProblemRow({ p })`, `GROUP_LOOK`: one problem as a diagnostics row |

Files §5.4 does not list: `src/ui/main.tsx`, the entry, which imports the stylesheets (S2); and
those S0 added, `src/ui/client/answer.ts` (S1), `src/ui/viewport/viewer.ts` (S3),
`src/viewer/theme.ts` (S3), `src/ui/tables/{common.tsx,index.ts}` (S4),
`src/core/problems/fixture.test.ts` (S1), and `src/ui/testing.ts`, the unit tests' models, to which
any stream adds. A module's unit test (`focus.test.ts`, `keys.test.ts`, …) is its module's owner's.

## The e2e tests after S0

| Spec | Owner | What S0 did |
|---|---|---|
| `view.spec.ts` (new) | S3 | Holds "the cart draws its bars" (from `canvas`), "looks from standard views…" (from `tools`) and "the section plane…" (from `topbar`), with the helpers they use |
| `catalog.spec.ts` (new) | S2 | Holds "the catalog browser lists the project's own items" (from `canvas`) |
| `inspector.spec.ts` (was `canvas`) | S5 | Holds what was left: selection and properties |
| `tools.spec.ts` | S5 | Gains "the tools snap to the project's own items" (from `canvas`) |
| `topbar.spec.ts` | S2 | Loses the section test |
| `draw.spec.ts` | S5 | Reads `snap`, not `hint`. The cut list and BOM assertion is byte for byte as before |

Every moved test's body is the same lines as before. A spec whose tests serve different fixtures
now serves each test's in the test (`served = await serve(...)` first), where its old spec's
`beforeEach` did. `playwright.config.ts` pins `colorScheme: "dark"` (D-UX-21).

## S0 decisions

1. **store.ts re-exports the selection, and focus.ts reads the model from store.ts.** The plan
   asks for both, which makes the two modules import each other. That is safe: neither reads the
   other's bindings while it loads, only when `show` runs. A new import of the selection should
   name `focus.ts`.
2. **Tokens beyond §5.3's list.** Today's styles have roles the list does not name, so S0 adds
   them rather than merge two looks into one name: `--mark-active` and `--mark-active-text` (the
   active tool's outline and label, the active tab's underline, the tool panel's title, the
   catalog filter chosen, the armed item), `--act-line` (a primary action's border),
   `--sel-wash` (a selected row's fill), `--blocked-wash`, `--blocked-ink` and `--blocked-ink-2`
   (the read-only banner), `--status-ink` (text on a status fill), `--bg-tip` (the tip by the
   pointer), `--fs-tiny` (11 px), and `--fs-mono` with `--lh-mono` (code). S4 values each, or
   the owning stream moves its use to a §5.3 name and S4 drops it. Two washes are `color-mix()` of
   a token rather than tokens: box select's fill (`--sel` at 8 %) and the tool bar's buttons
   (`--bg-panel` at 92 %).
3. **Several names share a value today**, because today's styles use one colour where the plan
   names two: `--bg-app` and `--bg-well`, `--line` and `--line-strong`, `--text-2` and
   `--text-3`. Each use was given the name its meaning asks for. Tokens nothing uses yet hold a
   placeholder: `--sel-ink`, `--info`, `--fs-display`, `--fs-title`, `--sp-*`, `--row-h-*`
   (`auto`), `--focus-ring`.
4. **`ViewTheme` is the viewer's type, in `src/viewer/theme.ts`;** the values are tokens.ts's.
   The viewer never imports from `src/ui`. Its bodies are coloured by tone (`finishTone`,
   `partTone` in `src/mesh/style.ts`), so the GLB and the view share the rule, not the colours.
   `createViewer` now takes the theme; `setTheme` waits for S3.12.
5. **Corner and badge types**: the viewer declares what it draws (`CornerMarker`, `ProblemBadge`
   in `scene.ts`), and `corners.ts`'s `Corner` extends `CornerMarker`.
6. **`Problem.suppliers` is `(string | null)[]`**, not `string[]`: `null` is the order's unsourced
   lines, as `alukit order` writes their supplier. `order.blocks` counts the `blocks-order`
   problems; `order.warnings` the order's own warnings (rules that warn).
7. **The hook's fields are added when their module loads**, as functions that read the state when
   called, so `window.__alukit` is whole before the app renders (today's was set in the
   viewport's first effect). Each answers `undefined` for what is not there yet.
8. **`snap`, per tool**: draw gives the point or end under the pointer; connect the pick a click
   makes (`bar b5`, `end b1.b`) or the pivot's base station; place and measure the station or
   point; pattern `bar <id>`, where its hint says `along <id>`. Only `draw.spec` reads `snap`, as
   the plan says; the other specs still read `hint`, and S5 may move them to `snap`.
9. **Keys**: the router prevents a taken key's default. Today Esc, the tool letters, F and O did
   not; on anything but a text field (where the guard keeps them out) that changes nothing.
10. **The tool buttons stay in today's bar.** The viewport renders the `left` slot at the start of
    the bar over the canvas, before the view controls, so it wraps as it did. S3.11 gives the
    view controls their groups and the rail its column. The tools wire themselves to the viewer
    through `connectTools()`, which `App.tsx` calls; the viewport knows no tool.
11. **Sheets**: `SheetDef` gains `order`, so the rail's order does not depend on import order, and
    `badge` returns markup, which the sheet renders (S4.12 owns badges; `.badge` moved to
    `tables.css`). `sheetsOpen` keeps today's collapse on clicking the active tab. `openSheet`
    accepts `maximize` and ignores it until S2.2; no table honours `selectionOnly` yet (S4.4).
    The ids: `cutlist`, `machining`, `bom`, `order`, `costs`, `checks`, `open-items`, `params`,
    `decisions`, `history` (titled "Log").
12. **The clients do not fetch** until their endpoint exists: a 404 would log a console error,
    which `dev.spec` fails on. They answer `{ ok: false, unavailable: true }`.
13. **`kgPerM` writes three decimals.** No screen uses it yet; the catalog list's raw float (U67)
    stays until S2.3 writes it through `format.ts`.
14. **The fixture is a transcription, and its test says so.** When the cart's check or order
    changes (the derive work on fastenings, say), the fixture test fails until the fixture is
    transcribed again.
15. **No visible change, checked.** Screenshots of 32 states (the cart, a selection, a
    provenance popover, every sheet, the revisions popover, the catalog card, each tool, the
    section, orthographic, the tree filtered, read-only, an empty project) equal today's to the
    pixel after each S0 step, but for rounded corners' antialiasing, which also differs between
    two runs of today's build.

## S4 changes

S4 ([s4-decisions.md](s4-decisions.md)) changed these contracts. Each adds, except the sheets' ids,
which S0 listed as the sheets' present set and which the plan's own grouping (D-UX-2) replaces.

- **Sheet ids** are now `cutlist` (10), `bom` (20), `machining` (30), `order` (40, "Order & costs",
  with the costs inside), `problems` (50) and `records` (60), then S2's `params` (80). `checks`,
  `open-items`, `costs`, `decisions` and `history` no longer register; their sections keep their
  `data-testid`s inside Problems and Records. `badge` returns a figure or a status.
- **Tokens**: values changed, names did not. Added: `--act-ink`, `--tip-ink`, `--hover-wash`,
  `--warn-wash`, `--ready-wash`, `--info-wash`. `--mark-active`, `--mark-active-text` and `--act-line`
  are no longer amber (amber is only the selection). In light, `--sel` is a fill; text and borders in
  the selection's colour use `--sel-text`.
- **`theme`** (`theme/theme.ts`) is a `computed`, not a writable signal: write with
  `chooseTheme(pref)` (`"system" | "dark" | "light"`). `applyTheme()` also starts the system and
  storage reads, so `main.tsx` needs no change. `ThemeSwitch` is the control S2 places.
- **`viewTheme(theme)`** returns a two-stop background and a light set. `itemSwatches(model, theme?)`
  is real (bars first, then by count; eight hues, then a neutral); `swatchCss(n)` writes one for a
  style attribute.
- **`format.ts`** adds `date`, `plural`, `plain`, `splitNumber`, `withUnit`, `THIN`, `NBSP`;
  `group` and every quantity now group thousands (table: from four digits).
- **Components**: `common/{StatusGlyph,Num,ItemSwatch,EmptyState}.tsx`; `EntityChips` takes `max`.
  `ProblemRow({ p, compact? })` renders a row with its Show and fixes; `GROUP_LOOK` keeps `word` and
  `tone` and adds `status` and `label`. `ProblemList` gives the rows the arrow keys.
- **Tables** (`tables/common.tsx`): `Sheet`, `SheetBar`, `SheetTable`, `Row`, `Clip`, `Stamp`,
  `useOutput`; `selectionOnly` is honoured. `window.__alukit.hovered()` (declared there) returns
  `focus.hover`'s ids.
- **`problems/source.ts`**: `problemList` and `problemCounts` read `store.problems`, with the
  check's diagnostics standing in until S2.6 fills it (see s4-decisions.md for what to delete).
- **Fonts** are files in `src/ui/fonts` with `OFL.txt`, not a dependency (D-UX-22 said `@fontsource`).

## S3 changes

S3 ([s3-decisions.md](s3-decisions.md)) changed these contracts. Each adds, except two fields of
`ViewTheme`, which C's rendering spec replaces.

- **`ViewTheme`** (`src/viewer/theme.ts`). Replaced: `lights.fill` by `lights.sky` (a hemisphere
  light, with `ground`), and `grid.centre` by `grid.major`, `grid.axis` and `grid.axisOpacity`
  (metre lines, and the world X and Y across the ground), because C §5.1 drops the fill light and
  the centre lines; a field kept for nothing would still need a value. Added: `fog`, `cut` (the
  cut faces' factors), `body.neutral`, `edge.onDark`, `edge.outline`, `edge.detail`,
  `edge.selected`, `edge.xray`, `overlay.marker.face`, `overlay.marker.datum`, `overlay.ring`.
  Only `viewTheme` builds one.
- **`tokens.ts`** (S4's file, cross-edited): `VIEW_DARK` holds C's dark values (§5.1 to §5.3);
  `VIEW_LIGHT` keeps S4's light values and adds S3's roles (light fog, lights, metre lines,
  `neutral` as the light steel). The line, pick and preview markers take the `tool` token in both
  themes, the grid marker `text-3` and the free one `text-1` (U42: amber is the selection's
  alone). S4 may retune any value. `tokens.test.ts` no longer holds the dark view's bodies to the
  export's (they are C's now); `src/viewer/theme.test.ts` holds the export's palette (D-UX-24)
  and the view's contrast rules.
- **`Icons.tsx`** (S4's file, cross-edited): adds `joints`, for the Joints toggle.
- **`MarkerKind`** (`src/viewer/overlay.ts`) adds `face` (a triangle: a face's centre) and
  `datum` (⊕: a part's origin or datum). Each kind has its shape (C §5.3): `point` a square (a
  node or a bar's end), `line` a diamond, `grid` a cross, `free` a ring, `pick` a dot. The tools
  still send `point` for every station; S5 maps a face centre to `face` and a part's origin to
  `datum`.
- **The viewer** (`src/viewer/scene.ts`): S0's no-ops are built. It adds `camera()`
  (`CameraState`: position, target, right, up, in the world, and `moving` from the moment a
  move is asked for until it rests, which scripts wait on), `renderStats()` (`RenderStats`:
  frames, render ms, hover picks and their ms) and `CORNER_PREFIX` (`corner:`; also in
  `markers.ts`). `ViewerStats` adds `outlineSegments`, `detailSegments`, `joints` (joined, open,
  failed) and `badges`. `fitBox(box)` takes a world box and keeps the view's direction.
  `onHover` reports a body's id or `corner:<key>`, once per change, in Select with no tool armed.
  `setGhost` fades the joint markers and badges with the bodies.
- **`resolveTargets(model, refs, ctx?)`** (`targets.ts`): S3.6's refs (ends, connections, runs,
  patterns, corners, items, open items, suppliers given `ctx.order`); no refs is the whole model.
  `Targets` adds `bodies`. `ids` stay what S0's were, the entities the refs name (what Show
  selects and a selection filter matches): a connection is `c35`, a run `r1`, a corner
  `corner:<key>`; a ref that names no entity (an item, an open item, a supplier) gives the
  entities that stand for it. `bodies` are what draws them in the scene (a connection's
  fasteners under its id and its bars, a run's bars, a corner's bars), which the view tints,
  pulses, keeps out of the ghost, badges and frames. `boxOf(model, ids, points)` is exported.
- **`corners.ts`**: `cornersOf` is built; adds `cornerKey(ref)` and `pointKey(p)`.
- **The viewport**: signals `showJoints`, `showProblems`, `colourBy` (`"finish" | "item"`) and
  `drawnCorners` (`viewport/viewer.ts`). The `left` slot is a column down the viewport's left
  edge (`.tool-rail`, `data-testid="tool-rail"`); the view controls sit at the top right
  (`.toolbar`, `data-testid="toolbar"`, as before), in three groups with S4's icons. Esc leaves
  Show before it clears the selection (`onKey("app", …, 10)`). A Show dims the rest when it
  shows a problem or asks to (`ghostsRest(shown)`: B §5.3 dims for every problem; `isolate`
  stays the caller's way to ask for it otherwise). The badges and the callout's row read S4's
  `problemList`, so they follow the check until S2.6 serves the problems. Snapshot mode draws no
  hover, markers, badges or labels.
- **The hook** adds `corners()`, `camera()` and `frames()`. `hovered()` stays S4's.
- **`src/mesh/bars.ts`** adds `sectionEdgeSets(section)` (outline and detail edges);
  `angledGeometry` keeps the extrusion's two groups, which the GLB writer ignores, so its bytes
  do not change.
- **`src/ui/testing.ts`** adds `viewOf(dir, ...batches)`: the served view model of a scratch
  project after command batches.
- **Tests**: `tests/e2e/png.ts`'s `coverage` counts the pixels off their row's commonest colour,
  since the background is a gradient; snapshot.spec is otherwise unchanged. view.spec checks the
  projection by `aria-pressed` (§5.10).
- **Show in the outline** (after merging S2): the outline reveals every target's row, not only
  the first's (`placesOf` in `outline/rows.ts`). With S3's corners a connection's row is inside
  its corner's group, closed by default, and Show selects every target, so revealing one left
  the others selected out of sight (s3-decisions.md, decision 30).

## What S1 added

S1 changed the contracts above only by adding, and built the clients. Its decisions are in
[`s1-decisions.md`](s1-decisions.md). Outside its files it changed two assertions of S2's
`live.spec.ts`, which read `alukit log`'s output before BE-4 put it in words (s1-decisions, "Outside S1's files").

| Interface | File | What S1 added |
|---|---|---|
| Clients | `src/ui/client/{problems,dryrun,catalog}.ts` | `fetchProblems(q)` calls `GET /api/problems`; `dryRun(commands)` posts `dryRun: true`; `catalog.ts` (new) is `fetchCatalogItems(q)` with `prefer`. `problemsParams`, `dryRunOf` and `catalogParams` are exported for tests. `notYet` is gone, its stubs with it; `ClientAnswer` keeps `unavailable` |
| A dry run's effects | `src/core/commands/dry.ts` | `DryRunEffects` is `DryEffects`: S0's `cuts`, `removed` and `claimed`, and `added`, each bar the step would create with its cut length (s1-decisions 14) |
| Problem model | `src/core/problems/` | `problemsOf`, `problemsAt` and `problemsText` beside `types.ts`, whose types did not change |
| The catalog list | `src/catalog/search.ts` | `CatalogEntry.size_mm` for bars, `SearchQuery.prefer` |
| Steps in words | `src/core/commands/types.ts`, `history.ts`; `src/server/host.ts` | `CommandDef.describe`; `LogEntry.text`, `StepInfo.text` and the `rev` event's `text`. `what` is unchanged |
| The corner rule | `src/core/project/schema.ts` | `CornerRule`; `Defaults.corner`; `autoConnect`'s `prefer` (drop 2) |
| The box frame | `src/core/commands/frame.ts` | `addFrame`, whose answer's `info` is `{ posts, rings: { base?, shelf?, top? }, connections, params? }`: what S5.7's tool and S2's start card read (drop 2) |
| Restore | `POST /api/restore` | `kept`, the paths of the files kept in `.alukit/rejected/` (drop 2) |
| The catalog list | `src/catalog/search.ts` | `CatalogEntry.from`, `{ minor, currency?, per }` (`FromPrice`, `src/core/order/price.ts`; drop 2) |

## S2 changes

S2 ([s2-decisions.md](s2-decisions.md)) changed these contracts. Each adds, except the two marked
**changed**.

- **Changed: the status bar is not in the viewport's `bottom` slot.** It sits under the viewport in
  the canvas column (`App.tsx`), so it never covers the scene; `bottom` is the command bar's alone
  (S5). `centre` holds the start card, the coach strip and the read-only "last good state" label;
  `topRight` the toasts.
- **Changed: `params` is no longer a sheet.** The params are in the project panel (D-UX-4);
  `records/Params.tsx` exports `ParamsTable` and `pointParam(name)`, which a problem's param fix
  calls (`problems/Fixes.tsx`, an S2 cross-edit). The sheet ids are S4's six.
- **Sheets** (`sheets/registry.ts`): `setSheets({ open?, max?, height? }, remember?)`, `sheetsMax`,
  `sheetsHeight`, `SHEETS_HEIGHT`, `firstOutputPending`; `openSheet(id, { maximize })` maximizes.
  A sheet's body sits in `.drawer-body`, as before.
- **The store** (`store.ts`): `problems` is filled for each drawn revision (`fetchProblems`, in the
  tab's variant and date). `tell(text, error, refs?)` raises a notice, which is
  `{ text, error, refs?, n }` and shows as a toast. `sendCommands(commands, what, { strict?, inline? })`:
  `inline` keeps a refusal out of the toasts, for a form that shows it under itself; S4's and S5's
  forms do not pass it yet. `heard` holds the `rev` events the tab heard, with when (`heardAt(rev)`).
  `restore()` answers `{ ok, rev?, kept: string[], message? }`.
- **Keys** (`keys.ts`): `letterKeys` and `setLetterKeys(on)`, the single-key switch (app-scope
  handlers do not see one printable character while it is off); `isCharacterKey(e)`.
  `describeKeys({ id, title, order, rows })` puts a section in help and returns its undo; help shows
  `tools` (10), `drawing` (20), `view` (50) and `app` (60) itself until S5 and S3 describe those ids.
- **Focus** (`focus.ts`): `showKey(e)`, Esc leaving Show, which `App.tsx` registers at app scope,
  priority 10. S3's viewport registers its own: one goes at the merge.
- **Steps** (`steps.ts`): `who(source)`, `isOwn`, `stepWords(step)` (`text`, else `what`),
  `whoWhat`, `ago(ms)`, `diffModels(before, after)`, `hasConsequences`, `summaryText`.
- **Shell modules** (`shell/`): `start.ts`'s `frameWay` is the box frame's form: S5.7 sets it to a
  component taking `{ onDone }`, and the start card shows it as its first way in. `startShown`,
  `showStart()`, `dismissStart()`. `readiness()` is the order's state for the pill.
  `prefs.ts`'s `readPref`/`writePref` guard every storage access.
- **Catalog** (`catalog/`): `arm(card, opt)` arms the palette and switches tool; `cardOf(id)` caches
  `/api/catalog/item`; `Card.tsx` exports `OptionSelects` and `useOptions`. `options.ts`'s
  `optionFields(options, offers, defaults)` is the one place an item's options are offered.
- **The project panel** has `data-testid="project-panel"`; it keeps the hint "Select a bar, part or
  connection…" at its foot.
- **Requested from S1**: `/api/catalog` listing the built-in catalogs (`builtins: [{ id, name,
  vendor, profiles }]`), so the start card and settings can add one with one click (D-UX-6). Until
  then they take a built-in id typed in Project settings. *Done in the integration pass (below).*

## S5 changes

S5 ([s5-decisions.md](s5-decisions.md)) changed these contracts. Each adds, except the moves
marked **moved**, which §5.4 asked for.

- **Moved: the tools** are `src/ui/tools/`: `state.ts` (every signal S0 named in `tools.ts`:
  `activeTool`, `toolPrompt`, `hint` with `snap`, `drawState`, `typed`, …), `commands.ts` (the
  batches a tool sends), `typed.ts` (a typed value), `wiring.ts` (`connectTools`), `joint.ts`,
  `CommandBar.tsx`, `ToolRail.tsx`, `ToolForm.tsx` and `forms/FrameForm.tsx`. `Properties.tsx` is
  `src/ui/inspector/Inspector.tsx` (`Inspector`), its root still `data-testid="properties"`. Other
  streams' files changed only their import paths (`activeTool`, `toolPrompt`, `drawState`,
  `TOOL_KEYS` from `tools/state.ts`; `typedValue` from `tools/typed.ts`).
- **Tools**: `TOOLS` gains `frame`; `TOOL_KEYS` gains `x` (Pattern) and `g` (Box frame);
  `TOOL_NAMES` and `toolKey(t)` name them. `drawOptions` gains `lock` (an axis) and `prefer` (a
  corner rule). New signals: `fieldWanted` and `fieldDone` (the command bar takes and gives back
  the keyboard), `jointPreview`, `lastResult` (the result chip), `frameDraft`, `frameOptions`.
  `placeState` loses `from` (a typed distance counts from the nearer end). `CORNER_RULES`,
  `CORNER_WORDS`.
- **The hook's `tool()`** adds `typed`, `lock`, `prefer`, `joint` and `jointMs` (the joint
  preview's words and its dry run's time) and `stage` (the box frame's next value).
- **The command bar** is the viewport's `bottom` slot (`data-testid="command-bar"`), with the value
  field `command-value`, its reading `command-result`, the joint preview `joint-preview` and the
  result chip `tool-result`. The draw tool's `draw-autoconnect`, `draw-roll`, `draw-plane`,
  `palette-bar` and `palette-part` moved into it from the right column; `draw-anchor` is now the
  anchor picker, a group of dots (`data-anchor` on each), not a `<select>`; `measure-result` is in it
  too. The right column's form (`ToolForm`) holds Connect, Pattern and the box frame only.
  `place-apply` is gone: Place commits on the click (D-UX-16).
- **`frameWay`** (S2's `shell/start.ts`) is set to `FrameForm` when `forms/FrameForm.tsx` loads.
- **The dry-run client** (`src/ui/client/dryrun.ts`, S1's): the ok answer gains `results`
  (`DryRunResult`: each command's `created`, `removed`, `changed` and `info`, which the server already
  sent), and the refused answer `failed: { index, cmd? }`. The box frame's numbers read `addFrame`'s
  `info`; Delete reads what a cascade removes and changes, and which command refused.
- **`viewer/draw.ts`**: `EndOptions.lock`; `typedEnd(start, toward, length, written?)` writes an
  expression into the coordinate along an axis; `offset(c, sign, d)`; `BarGesture.prefer` goes into
  each `autoConnect`; `parseLength` is gone (`tools/typed.ts`'s `parseTyped` reads what is typed).
- **`Feedback.tsx`**: `stepDiagnostics(outcome, ids)`, every diagnostic a step added, those naming
  `ids` first (U6).
- **Help**: the tools describe their own `tools` (10) and `drawing` (20) key sections; S2's
  `Help.tsx` no longer does.
- **Icons** (S4's file, cross-edited): adds `frame`.
- **The inspector** (`src/ui/inspector/`): edits in place, Delete with its cascade (`delete-dialog`)
  and the corner inspector, which the inspector shows for a selected corner (`corner:<key>`).
  `Inspector` stays the right column's export.
- **Toasts** (S2's `shell/Toasts.tsx`, cross-edited): the person's own step's toast offers "Undo
  it" too (D-UX-13).
- **`src/ui/testing.ts`**: `hostOf(dir)`, dry runs on a scratch project for unit tests.

## Integration changes

The integration pass ([integration-decisions.md](integration-decisions.md)) changed these
contracts. Each adds, except the moves marked **moved**.

- **Moved: the sheets register in one place.** `src/ui/tables/index.ts` registers all six sheets
  (`registerSheet` as before); a sheet's module no longer registers itself. Every body but the cut
  list's is `lazy(() => import(…))`, and the badges, which the rail shows before a sheet loads,
  are `src/ui/tables/badges.tsx` (`PiecesBadge`, `LinesBadge`, `OrderBadge`, `ProblemsBadge`, and
  `blocks` and `thingsToResolve`, which Order & costs reads too). A new sheet registers there.
- **`lazy(load)`** (`src/ui/lazy.tsx`): a component that loads its module on first render, renders
  nothing until then and an error with a reload hint if the load fails; `.preload()` starts the
  load early. The corner inspector and Project settings load through it.
- **Moved: `settingsOpen`** is `src/ui/shell/open.ts`'s, so opening settings loads no settings
  code. `Settings.tsx` no longer exports it.
- **The example** (`shell/example.ts`): `loadExample()` reads the skill's text on demand; the start
  card no longer imports it.
- **`GET /api/arrangements?at=x,y,z[&at=…][&rule=…]`** answers `alukit.arrangements/1`: the corners
  (`at`, `ends`, `butts`) and per rule `{ rule, ok, commands, plans, effects }` or `{ rule, ok:
  false, commands, failed }`, with `rev`; 400 on a bad query, 409 when read-only. Its client is
  `src/ui/client/arrangements.ts` (`fetchArrangements(at, rules?)`); `alukit arrangements` prints
  the same JSON with `--json`. The core is `src/core/corners/arrange.ts` (`arrange`), and the batch
  builders `src/core/corners/batch.ts` (`CORNER_RULES`, `takeOut`, `keptConnector`, `lostFields`,
  `arrangeBatch`), which `inspector/arrangements.ts` now wraps instead of keeping its own; its
  `RULES` is `CORNER_RULES`, and `arrangementsOf(m, corner, answers)` reads the rule answers.
- **`CommandEnv.derived?(state)`** (`src/core/commands/types.ts`): a derive to reuse for a state the
  caller already derived; `makeContext` asks it first. Only `arrange` sets it.
- **`/api/catalog`** adds `builtins: [{ id, name, vendor?, items, bars, tslot }]`, every built-in
  catalog (S2's request, with `bars` for `profiles`). Project settings read it.
- **The joint preview** asks only when an end of the stroke touches a bar (`touchesBars(m, p)` in
  `tools/joint.ts`).
- **`src/ui/testing.ts`**: `hostOf(dir).arrange(at)`, the arrangements of a scratch project.

## Polish changes

*The phase-4 review's fixes ([polish-decisions.md](polish-decisions.md)).*

- **Core**: the order rule `no-connector` (`ORDER_RULES`, `RULE_DEFAULTS`: `warn`); the check's
  note `butt-no-connector` per butt (`core/check/joints.ts`: `unjoinedButts`, `buttSystems`); the
  problem model folds both into one problem whose `Fix` is the new
  `{ kind: "connector"; butts; systems }`.
- **`catalog/search.ts`**: a listed entry carries `shape`, `system` and `fits` (full ids) and
  `offers` (how many offers sell it).
- **`tools/state.ts`**: `FrameOptions` gains `joint` (a connector id, `JOIN_NONE` for nothing, `""`
  for the project's default) and `qty`; `frameNumbers`, the panel's dry run in a line.
  **`tools/commands.ts`**: `frameBatch(draft, options, bar, project, params, defaultBar?)` gives
  the frame's step (`setProject` defaults, then `addFrame`) or why not; `frameCommand` takes the
  project's `{ hasDefaultBar, defaultButt }`.
- **`shell/start.ts`**: `frameWay` takes `{ onDone, profile }`, `profile` the card's first step
  (`FrameProfile`, its `patch` absent when it is the default bar already).
- **`common/ConnectorSelect.tsx`**: the connector picker every connector field uses, fit first.
- **The viewer**: `setJoinedShown(all)`; `MarkerLayer.setQuiet(glyphs)`. The viewport's slots gain
  `lane`, the message lane; the command bar is no longer a viewport slot but a row of the canvas
  column (`App.tsx`).
- **`outline/rows.ts`**: a `Row` gains `figure` and `title`.

## End handles changes

*The end handles and the length label ([drag-ends-decisions.md](drag-ends-decisions.md)). Each
adds, except the move marked **moved**.*

- **The viewer** (`src/viewer/scene.ts`, S3's): `setGrab(g)` with `Grab` (`press`, `move(e, held)`,
  `release`, `busy`): a press the app takes as a drag, asked before the camera, the tools and
  Select; a taken press turns the camera off and captures the pointer until the button comes up,
  and makes no click. `setHandles(h)` with `HandlesState` (`src/viewer/overlay.ts`): grips drawn
  over every body, draggable or locked, one hot; three lasting materials, so no state links a
  program. *(Moved in E0: the grips are the gizmo's, `setGizmo({ handles })`, `src/viewer/gizmo.ts`.)*
- **Moved: the joint preview** is `src/ui/tools/preview.ts` (`createPreviewer(viewer, live, rule)`,
  `PreviewAsk`, `PAUSE_MS`, `SNAP_MS`), shared by the draw tool, the end handles and the length
  label; the draw tool's wiring no longer keeps its own. `jointWords` reads a moved bar's own cut
  from `effects.cuts` as it reads a new bar's from `added`.
- **Drag gestures** (`src/ui/tools/drag.ts`): `createGestures(viewer)` and `GestureSpec`; the
  signals `gesture` (a drag on: its title, prompt, reading and snap) and `labelEdit` (the bar and
  end the label's field moves) in `tools/state.ts`. The command bar shows a drag's bar whatever the
  tool (`data-tool="drag-end"`), its `ValueField` taking a `reading` and a `placeholder`.
- **The end handles** (`src/ui/tools/handles.ts`, since E0 `wire/ends.ts`; `ends.ts`, `LengthEdit.tsx`): `createEndHandles`,
  made by the tools' wiring and given the viewer's grab in Select; `endNote` (what holds a locked
  end, by its handle, `EndNoteView`, which the viewport renders); `LengthLabel`, which the
  viewport's `SelectionLabel` renders in place of the label's text.
- **Words** (`src/ui/viewport/words.ts`, S3's): `barWords` says "cut 569.88 mm  square · square";
  `endsWords` gives the ends alone.
- **The hook** adds `handles()` (each end's point, whether locked, and its state) and `gesture()`.
- **Core**: `src/core/commands/hold.ts` (`endHold`, `drivenEnd`, `drivers`, `movingAxes`), free of
  the schemas, which the app reads; `src/core/commands/move.ts` (`moveEnd`); `numbers.ts` adds
  `offsetBy`. After E4, `endHold` takes the end's claims and `by` (`EndClaims`; the app passes the
  view model's `claims`), a detachable hold carries `conns` and `fails`, and `heldWords` says it
  as one clause, for the handles' hint, the label's refusal and `moveEnd`'s (e4 23, 24).

## Move tool changes

*The Move tool and `transform` ([drag-ends-decisions.md](drag-ends-decisions.md), "The Move
tool"). Each adds.*

- **Tools** (`src/ui/tools/state.ts`): `move` in `TOOLS`, its key `D` in `TOOL_KEYS`, "Move" in
  `TOOL_NAMES`, and its prompt; the icon `move` (`src/ui/icons/Icons.tsx`).
- **The Move tool** (`src/ui/tools/mover.ts`, since E0 `wire/move.ts`): `createMoveTool(viewer, gestures, { snap })` gives
  `{ handler, grab, startFromKeyboard, dispose }`; the tools' wiring makes it once, hands the
  viewer its `grab` while Move is the tool, and routes a value key to `startFromKeyboard` when a
  selection waits and no drag is on. Its gesture is a `GestureSpec` of kind `"move"` on
  `drag.ts`, the end handles' machinery; the gesture bar shows it (`data-tool="move"`).
- **Its rules** (`src/ui/tools/moves.ts`, pure): `moveSet`, `slideAxis`, `typedOffset`,
  `offsetOf`, `moveCommands` (since E0 `transformBatch`, `src/ui/edit/batches.ts`), `moveWords`,
  `MOVE_LOCKS`, `UNIT`.
- **The overlay** (`src/viewer/overlay.ts`, S3's): `OverlayState.ghosts`, several bars drawn as the
  ghost is, on its one material, from a pool of meshes and a geometry per section, both kept.
- **Core**: `src/core/commands/transform.ts` (`transform`, `TransformInfo`); `move.ts` exports
  `axisMeetsLine`, which `moveEnd` and `transform` share. **CLI**: `src/cli/move.ts` (`alukit
  move`, `alukit rotate`); `add.ts` exports `vec3` and `numbers3` for it.

## Editing round: E0

*Stream E0 of the [editing audit](editing-audit.md) (§7.2) built the shared interfaces the editing
streams E1 to E5 build on ([e0-decisions.md](e0-decisions.md)). Each adds, except the moves
marked **moved**. After E0, only an interface's owner changes it, and only by adding; a stream
registers its own actions and keys from its own files.*

### The interfaces

| Interface | File | Owner | What it is |
|---|---|---|---|
| The tools' router | `src/ui/tools/wiring.ts` | E3 | `createTools`, `connectTools`, `toolFieldKey`, as before; it routes the pointer, the gesture and tool keys and the command bar's field to the active tool's `Wire`, and nothing else |
| A tool's wiring | `src/ui/tools/wire/common.ts` | E3 | `WireContext` (the viewer, `targets`, `rayAt`, `snapAt`, `pickAt`, `show`, `pointer`, `track`, `refresh`, `used`, `typedNow`, `params`), `Wire` (`handler`, `preview?`, `back?`, `enter?`, `key?`, `takesValue?`, `flip?`, `reset?`, `switched?`, `dispose?`), and the shared helpers (`markerOf`, `typedPoint`, `noteResult`, `refuse`, `VALUE_START`) |
| **Moved:** the tools | `src/ui/tools/wire/{draw,frame,connect,place,pattern,measure,move,ends}.ts` | see the table below | One module per tool, each `create…Tool(ctx)`. **Moved:** `tools/handles.ts` is `wire/ends.ts` (`createEndHandles`, `endNote`, `endGhost`, `endWords`, the hook's `handles()` and `gesture()`), `tools/mover.ts` is `wire/move.ts` (`createMoveTool(viewer, gestures, { snap, pick })`, `MoveDeps` gaining `pick`). `NO_DIRECTION` is `wire/draw.ts`'s |
| Actions | `src/ui/actions/registry.ts` | E2 | `ActionContext` (`m`, `selection`, `hit?`, `ref?`, `from`), `Action` (`id`, `title`, `group`, `keys?`, `scope?`, `help?`, `applies?`, `when`, `run`), `ActionGroup`, `registerAction(a)` (binds its keys through keys.ts; a key another action holds in the scope throws; the same id replaces), `actionsFor(c)`, `runAction(id, c)` (true, or why not), `titleOf`, `keyMatches`, `keyCaps`, `parseKey`, `GROUP_HELP`, `helpSections` (what the help lists), `actions` |
| The seeded actions | `src/ui/inspector/actions.ts`; `src/ui/viewport/actions.ts` | E4; E2 | `inspectorActions()`: `delete` (Delete, Backspace), `join-end`, `replace`, with `joinEnd(c)`, `replaceAsked`, `replaceKey`, `useReplaceAsked`; `viewActions()`: `fit` (F) and `show`. Each returns its undo |
| Key help rows | `src/ui/keys.ts` | E2 | `KeyHelpRow.or`, other keys that do the same. `keyHelp` holds the described sections; the help shows `helpSections` |
| The context menu | `src/ui/shell/ContextMenu.tsx` | E2 | `menu`, `openMenu(ctx, at)`, `closeMenu()`, `connectMenu()` (the view's right-click, in Select), `menuEntries(ctx)`, `menuTitle(ctx)`, `MenuEntry`, `ContextMenu`. Styles in `shell.css` (`.context-menu…`) |
| The pick | `src/viewer/scene.ts`; `src/viewer/pick.ts` | E2 | `Hit` (`id`, `p`, `normal`, `face?`, `station?`); `pickAt(x, y, skip?)` gives one; `onContextMenu(cb)` (a right-click within 4 px; returns the undo); `setHidden(ids)` (since E2.4 it hides by visibility: E2's section). `barHit(ray, bar)` and `hitOn(bars, id, ray, p, normal)`, pure |
| Snaps | `src/viewer/snap.ts` | E3 | `SnapOptions.skip` (ids of bars, parts, nodes) replaces the unused `skipBars`; `SnapPoint.of`, the entity a point belongs to |
| View state | `src/ui/focus.ts` | E2 | `hidden`, `isolated` signals; the tools pass `hidden` as their picks' and snaps' skip |
| The gizmo | `src/viewer/gizmo.ts`; `src/viewer/scene.ts` | E3 | `GizmoPart`, `GizmoHandle` (`key`, `at`, `axis?`, `locked?`), `GizmoSpec` (axes `{ at, parts }`, or `{ handles, hot? }`), `GizmoDrag`, `Gizmo` (the scene's, built once; the viewer links its programs, hidden parts too, before its first frame), `gizmoPartAt`, `handleAt`, `gizmoDrag`, `mmPerPx`, `GIZMO_PX`, `GRAB_PX`. Viewer: `setGizmo(spec)`, `gizmo()`, `onGizmoDrag(cb)`. **Moved:** `Viewer.setHandles` and `HandlesState` are gone; the end handles show `{ handles }` |
| Batches | `src/ui/edit/batches.ts` | E3 (each builder's body: the stream its task names) | `transformBatch` (**moved**: `tools/moves.ts`'s `moveCommands`), `endBatch` (**moved**: `tools/ends.ts`'s `endCommands`), and `duplicateBatch` (E3.3), `mirrorBatch` (E3.2), `arrayBatch` (E3.3), `splitBatch` (E4.3), `alignBatch` (E3.6), each "not available yet" until built; `Batch`, `Vec` |
| The test hook | `focus.ts`, `ContextMenu.tsx`, `viewport/Viewport.tsx` | the module that adds each | `selection()`, `hidden()`; `menu()` (the open menu's title and entries); `gizmo()`; `frames().modelFrame` (`RenderStats.modelFrame`, `src/viewer/scene.ts`: the frame that first drew the model given last, 0 until one has); `frames().badgeFrame` (the same for the problem badges given last, which follow the problems by their own request). The e2e helper `waitDrawn(page, rev)` waits for both the hand-over (`drawnRev`) and `modelFrame` |
| E2E helpers | `tests/e2e/helpers.ts` | any stream adds | `contextMenu(page, at)`, `selectByIds(page, ids)`, `docOf(dir)` |

### Who owns which files (the audit's §7.4, with what the round added)

| Path | Owner |
|---|---|
| `src/core/**`, `src/cli/**`, `src/server/**`, `src/ui/client/**`, `skills/alukit/SKILL.md` (regenerated), new fixtures | **E1** |
| `src/ui/actions/**` (`registry.ts`, `select.ts`, `ActionButtons.tsx`), `src/ui/shell/ContextMenu.tsx`, `src/ui/focus.ts`, `src/ui/outline/**`, `src/ui/catalog/state.ts` (D1), `src/viewer/scene.ts`, `src/viewer/pick.ts`, `src/ui/viewport/{ViewControls,actions,size,navigation}.ts(x)`, `src/ui/shell/StatusBar.tsx`, `src/ui/shell/Help.tsx`, `src/ui/keys.ts` | **E2** |
| `src/ui/tools/wiring.ts`, `src/ui/tools/wire/{common,draw,frame,measure,move,rotate,mirror,duplicate,align}.ts`, `src/ui/tools/{drag,preview,moves}.ts`, `src/ui/tools/state.ts`, `src/ui/tools/CommandBar.tsx`, `src/ui/edit/**` (`batches.ts`, `geometry.ts`), `src/viewer/gizmo.ts`, `src/viewer/snap.ts` | **E3** |
| `src/ui/inspector/{BarFields,length,words,replace,actions}.ts(x)`, E4's new `inspector/{Ends,endEdits,Holes,holes,NodeFields,node,ManyFields,many,ActionRow,barActions}.ts(x)`, `src/ui/common/AnchorDots.tsx`, `src/ui/tools/wire/ends.ts`, `src/ui/tools/{ends,LengthEdit}.ts(x)` | **E4** |
| `src/ui/inspector/{OtherFields,CornerInspector,arrangements}.ts(x)`, E5's new `inspector/{FaceEdit,PatternFields,PartReplace,rows,connection,pattern,edit-actions}.ts(x)`, `src/ui/tools/ToolForm.tsx`, `src/ui/tools/forms/FaceForm.tsx`, `src/ui/tools/commands.ts` (D5), `src/ui/tools/wire/{connect,place,pattern}.ts`; in `src/ui/common/ConnectorSelect.tsx`, its `joins` | **E5** |
| `src/ui/inspector/Inspector.tsx` | E4 (E5 adds its rows through `PartFields` and `ConnectionFields`) |
| `tests/e2e/menu.spec.ts` | E2 (E0 wrote its first test) |
| `src/ui/inspector/context.ts` and the Context row | gap X11 (its own section, below) |
| `tests/e2e/editing.spec.ts` | the integration pass (below) |
| `docs/design.md` (§6, §8), the decision notes | the coordinator folds them in; each stream writes `docs/ux/eN-decisions.md` |

A stream that breaks another's spec makes the smallest selector fix in that spec, in the same
merge, and names it. A semantic assertion is never weakened.

## Editing round: E1 changes

*Stream E1 of the [editing audit](editing-audit.md) ([e1-decisions.md](e1-decisions.md)). Owner of
everything below: E1; other streams add to it only.*

- **`src/core/query.ts`**: `similarTo(doc, derived, id, by: "item" | "tag"): string[]` and
  `connectedTo(doc, ids, opts?: { transitive?: boolean }): string[]`, each in id order with the
  given entities included, document entities only (no pattern copies). `connectedTo` takes no
  derived model, unlike the audit's §7.3 sketch (e1 11). `select(doc, selector, derived?)` takes
  `like:<id>` (it needs `derived`) and `connected:<ids>`, `connected*:<ids>`.
- **`autoConnect`'s `info`** gains `angled: string[]`, the ends it declared `cut: "angle"`, only
  when there are some; `through` and `ends` are unchanged, and its result's `changed` names the
  bars whose cut it declared (e1 5).
- **`src/core/commands/join.ts`**: `planJoin(derived, point, rule)`, the rule `autoConnect` applies
  and the `unconnected` problem asks (e1 1).
- **`Derived.claims`**: every provider that claims each bar end, whether or not its plane resolved
  (e1 2). Not in `alukit.derived/1`.
- **`DIAGNOSTIC_CODES`** and `DiagnosticCode` (`src/core/diagnostics.ts`): a diagnostic's code is
  one of the list, and each has a problem title (e1 7).
- **`Arrangements.joints`** (`src/core/corners/arrange.ts`, `alukit.arrangements/1`): a
  `JointArrangement` per kind, `{ kind: "miter" | "splice", ok: true, commands, plans: { at, ends
  }[], effects }` or `{ kind, ok: false, why }`, after the rules; `ArrangedCorner.joints?`, the
  corner's written miter or splice. `rules` is unchanged and holds only corner rules, so the
  inspector's `arrangementsOf` reads what it read. `arrangeQuery` and `?rule=` take `miter` and
  `splice`; naming any rule or joint answers only those named. In `batch.ts`: `JOINT_KINDS`,
  `jointsAt`, `jointAdds`, `jointBatch`; `takeOut` also removes a corner's miter or splice (e1
  13–15). For E5.5.
- **`DryEffects.parts`** (`src/core/commands/dry.ts`): each part a step adds, `{ item, bar?, s_mm?,
  origin }` for a placed part or `{ item, qty }` for a counted one, by id; always present, `{}` when
  none. `explodePattern`'s `info.copies` maps each copy (`b26@2`) to the entity it became (e1 16,
  17).

## Editing round: E2 changes

*Stream E2 of the [editing audit](editing-audit.md) ([e2-decisions.md](e2-decisions.md), cited as
"e2"). Owner of everything below: E2, unless a line names another; other streams add to it only.*

- **Actions** E2 registers: `select-all` (`mod+a`), `select-similar`, `select-tagged`,
  `select-connected`, `select-assembly` (group `select`; `src/ui/actions/select.ts`,
  `selectActions()`, registered by the outline); `hide` (`h`), `isolate` (`shift+h`), `show-all`
  (`alt+h`) (group `view`; `src/ui/viewport/actions.ts`); `menu` (`shift+f10`, `contextmenu`; never
  an entry of a menu; `src/ui/shell/ContextMenu.tsx`, registered by `connectMenu()`).
- **`keyMatches(keys, e)`** (`src/ui/actions/registry.ts`, which E0 made and E2 owns): with Alt held, a key that is not
  a plain letter or digit is read from `e.code` (`KeyH`, `Digit1`), so `alt+h` matches Option+H on
  a Mac, which types ˙ (e2 15).
- **`selectable(m)`**: the ids Ctrl+A selects, the document's bars and placed parts the view draws
  and does not hide, in id order (e2 7). **`queryIds(selector)`**: the ids `alukit query` selects,
  asked of the server.
- **`GET /api/query?select=<selector>&variant=<v>`** (`src/server/server.ts`, E1's file): `200 {
  ok: true, rev, selector, ids }`, or `400 { ok: false, message }` with the selector's error (e2 5).
- **`select(doc, "like:<id> by tag")`** (`src/core/query.ts`, E1's): `similarTo(…, "tag")`; `by
  item` is the default (e2 6).
- **`<ActionButtons m />`** (`src/ui/actions/ActionButtons.tsx`): the registry's `edit` and
  `transform` actions for the selection as buttons, greyed with their `when`; the inspector's
  selection header shows it in place of `DeleteButton`, which is gone (e2 3, 4).
- **`outlineMenu(e, ids)`** (`ContextMenu.tsx`): opens the menu about `ids` at the pointer, from
  `"outline"`, selecting them first unless they are all selected (e2 2). **`membersOf(group)`**
  (`src/ui/outline/rows.ts`): a group's rows, its subgroups' first (e2 8).
- **`src/ui/focus.ts`** (the view state E0 made, E2's): `drawnBodies(m)`, `bodiesOf(m, refs)` (what draws the refs, as
  `resolveTargets` says), `hide(m, refs)`, `isolate(m, refs)`, `showAll()`, `hiddenCount(m, h)`.
  `isolate` writes the rest into `hidden` and the refs into `isolated` (e2 12, 13).
- **`src/ui/viewport/size.ts`**: `sizeOf(m, refs?)` (the bounding box of what draws the refs, or of
  every body), `extentOf`, `sizeNumber`, `sizeText` (`1000 × 600 × 750 mm`), `altHeld`,
  `connectSizeBox()` (e2 16, 17). **`src/ui/viewport/navigation.ts`**: `navigation` (`"mouse" |
  "trackpad"`, kept as `alukit.navigation`), `setNavigation`, `connectNavigation()` (e2 18).
- **`Viewer`** (`src/viewer/scene.ts`): `setHidden(ids)` hides by visibility (e2 11);
  `setDimensions({ box, words } | undefined)`, the size box, labels `size-w`, `size-d`, `size-h`;
  `setNavigation(n)`; `camera().moving` turns false when camera-controls sleeps, after an instant
  move too (e2 22). `CornerMarker.bars?`: the corner's bars, so a corner whose bars are all hidden
  is not drawn. A box drawn right to left gets the class `crossing`.
- **`src/viewer/pick.ts`**: `boxTakes(points, rect, "window" | "crossing")`, `convexHull(points)`,
  `ScreenRect` (e2 10).
- **`src/viewer/labels.ts`** (S3's): `placeInside(el, at, view, avoid?)`, `nudgeInside(box, view,
  gap)`, `clearOf(box, view, avoid, gap)`, `EDGE_GAP_PX`; `Labels` takes an `avoid` provider. The
  labels and the anchored overlays place inside the view and clear of the gizmo (e2 21, 23).
- **`src/viewer/gizmo.ts`** (E3's): `gizmoFootprint(spec, project, mmPerPx)`, where on the screen a
  press is the gizmo's; **`Viewer.gizmoFootprint()`**, the shown gizmo's, on the page (e2 23).
- **`src/ui/catalog/state.ts`**: `keepPalette()` starts the palette and arms `defaults.bar` whenever
  the palette has no bar and the default changes; `startPalette` is gone (e2 20).

## Editing round: E3 changes

*Stream E3 of the [editing audit](editing-audit.md) ([e3-decisions.md](e3-decisions.md)): the
transform and copy tools. Each adds; E0's interfaces keep their members. Owner of everything
below: E3, but the line on `wire/ends.ts`, E4's.*

- **Tools** (`src/ui/tools/state.ts`): `rotate` in `TOOLS`, its key `Q` in `TOOL_KEYS`, "Rotate"
  in `TOOL_NAMES`, its prompt; the icon `rotate` (`src/ui/icons/Icons.tsx`). `Gesture.kind` adds
  `duplicate` (Duplicate and Paste), `rotate`, `mirror` and `align`; the command bar's gesture row
  reads its icon and its field's placeholder by kind (`data-tool` is the kind, `drag-end` for an
  end), and Mirror's box (`data-testid="mirror-remove"`). `mirrorOptions` (`{ remove }`).
- **Gestures** (`src/ui/tools/drag.ts`): `GestureSpec.press?(e)`, asked before a press commits:
  `"drag"` (a new start, a base point), `"taken"`, or undefined to commit; `Gestures.refresh()`,
  the gesture drawn again where the pointer was. While a gesture is on, its keys reach it in the
  capture phase when the focus is on an element (not a text field, a dialog or a menu).
- **Rotate** (`src/ui/tools/wire/rotate.ts`): `createRotateTool(viewer, gestures, { snap, pick })`
  gives `{ handler, grab, enter, dispose }`; the router hands the viewer its grab while Rotate is
  the tool, and Enter to `enter`. It shows the gizmo's rings (`ring-x`, `ring-y`, `ring-z`) and
  hears `onGizmoDrag`.
- **The Move tool** (`wire/move.ts`): `MoveTool.startCopy(ids, { title, base?, based }, e?)`, a
  session on a copy (Duplicate, Paste); `CopyHow`. In Select, a part alone (or parts on one bar
  along a world axis) shows the gizmo's `move-x`, `move-y` or `move-z` arrow at it, and a drag on
  it slides them.
- **Duplicate, Copy, Paste** (`wire/duplicate.ts`): `copyActions(mover, pointer)` registers
  `duplicate` (`mod+d`, group transform), `copy` (`mod+c`) and `paste` (`mod+v`, in a menu once
  something is copied), both group edit; `clipboard`, the tab's copied ids.
- **Mirror** (`wire/mirror.ts`): `createMirror(viewer, gestures, { snap })` registers `mirror`
  ("Mirror…", group transform); `mirrorWords(dryRun)`; `membersCount(ctx)`.
- **Align** (`wire/align.ts`): `createAlign(viewer, gestures)` registers `align` ("Align to a
  face…", group transform).
- **Batches** (`src/ui/edit/batches.ts`): `duplicateBatch`, `mirrorBatch`, `arrayBatch` and
  `alignBatch` built; `duplicateBatch` gains `opts.prefer`, `alignBatch` a target face `a` or `b`
  (an end) and an optional `prefer`; new `rotateBatch(set, { axis, deg, about }, detach, prefer)`.
- **Geometry** (`src/ui/edit/geometry.ts`, new, pure): `membersOf`, `centreOf`, `minCorner`,
  `WorldMap` with `translation`, `turn` and `reflection`, `ghostsOf` (bars drawn where a map puts
  them), `barCorners`, `extentAlong`, `facePlane`, `BarFace`, `sideWords`, `rounded`, `splitCopies`
  (`4x`, `/4`), `MAX_COPIES`, `typedAngle`, `snapAngle`, `Axis`, `AXIS_INDEX`, `UNIT`.
- **Rules** (`src/ui/tools/moves.ts`): `copyWords(dryRun)`, a copy's preview in words.
- **The end handles** (`wire/ends.ts`, E4's): they take the gizmo away only when the view still
  shows the one they set (it was a flag), so another user's gizmo shown since stays.
- **The tools' router** (`wiring.ts`): Select's grab remembers the pointer (where a paste starts).

## Editing round: E4 changes

*Stream E4 of the [editing audit](editing-audit.md) ([e4-decisions.md](e4-decisions.md)): bars and
ends. Each adds; E0's interfaces keep their members. Owner of everything below: E4, but the lines
marked with another owner, whose files E4 changed by the smallest addition.*

- **The view model** (`src/server/view.ts`, E1's; `src/ui/model.ts`): `claims`, derive's providers
  of each bar end (`"b13.a"` → `["c9"]`), every one whether or not its plane resolved. Not part of
  `alukit.derived/1`.
- **End words** (`src/ui/inspector/words.ts`): `endWords` reads `claims` (D2), naming the joint
  that claims an end and why it fails; `planeWords(plane)`, an end's own plane in words.
- **End edits** (`src/ui/inspector/endEdits.ts`, new, pure): `endFields`, `planeKind`,
  `endPatch(m, bar, end, set)`, `faceStops`, `endStopsNear`, `detachBatch`, `planeBatch`,
  `pickedPlane(m, pick, hit)`, `EndPick` (`{ bar, end, kind: "face" | "end" }`). The rows
  (`Ends.tsx`: `EndRows`) carry `row-end-{e}`, `end-cut-{e}`, `end-extend-{e}`, `end-plane-{e}`,
  `end-face-{e}`, `end-flush-{e}`, `end-pick-{e}`, `end-detach-{e}`, `end-pick-note`.
- **The end pick** (`src/ui/tools/wire/ends.ts`): `endPick`, a signal (`EndPick` and an optional
  `why`); while set, the end handles' grab takes the next press in Select, sends the plane, and
  clears it; Esc (scope `tool`), another selection or another tool clears it.
- **The bar's actions** (`src/ui/inspector/barActions.ts`, new): `barActions()` registers
  `split-here`, `split-at`, `reverse` and `add-hole` (group `bar`), returning the undo;
  `splitAsked` and `holeAsked`, the forms the menu opens; `splitHere(c)`, `holeHere(c)`,
  `runOf(m, bar)`, `oneBar(c)`. The inspector registers them while it is shown.
- **The action row** (`src/ui/inspector/ActionRow.tsx`, new): `ActionRow({ m, ids, groups })`,
  buttons `action-{id}` for the registry's actions in those groups (Delete, Join and Replace have
  their own rows).
- **Batches** (`src/ui/edit/batches.ts`, E3's): `splitBatch` built (E4.3, its body E4's).
- **The anchor dots** (`src/ui/common/AnchorDots.tsx`, new): `AnchorDots({ bbox, datums, anchors,
  value, onPick, disabled?, size? })`, the section's dots on the `.cb-anchor-pad` classes. The
  command bar's `AnchorPicker` (`src/ui/tools/CommandBar.tsx`, E3's) renders it; its markup is
  unchanged. *Since the editing polish: no `size`, every dot a 24 px target, and the command bar's
  picker opens above the bar (below, "Editing polish changes").*
- **Holes** (`src/ui/inspector/holes.ts`, new, pure): `holesOf`, `holeWords`, `sizeText`,
  `parseSize`, `parseLength`, `holeOp`, `addHole`, `changeHole`, `removeHole`, `FACES`; the rows
  (`Holes.tsx`: `HoleRows`) carry `hole-{i}` with `-face`, `-at`, `-from`, `-size`, `-depth`,
  `-remove`, and the form `hole-form` (`hole-face`, `hole-at`, `hole-from`, `hole-size`,
  `hole-depth`, `hole-add`), `hole-new`.
- **Several selected** (`src/ui/inspector/many.ts`, new, pure): `shared`, `manyBars`, `labelled`,
  `optionBatch`, `anchorBatch`, `rollBatch`, `labelBatch`, `tagsOf`, `tagBatch`; `ManyFields.tsx`
  (`many-fields`, `many-opt-{name}`, `many-anchor`, `many-roll`, `many-label`, `many-tags`).
- **Lengths** (`src/ui/inspector/length.ts`): `LengthEnd` (`"b" | "a" | "middle"`),
  `lengthMode(m, id, which)`, `lengthPatch(m, id, typed, which)`, `TypedLength`; the select
  `field-length-end`.
- **Nodes** (`src/ui/inspector/node.ts`, new, pure): `nodePlace`, `NodePlace`, `moveNodeAt`,
  `moveNodeOn`, `nodeUsers`; `NodeFields.tsx` (`row-node-users`, `field-node-{x,y,z}`,
  `field-node-bar`, `-at`, `-from`, `-face`).
- **The bar's rows** (`BarFields.tsx`): `OffsetRow` (`row-offset`, `field-off-x`, `field-off-y`),
  the anchor's dots in `row-anchor`, `SplitForm` (`split-form`, `split-at`, `split-splice`,
  `split-apply`).
- **Styles** (`src/ui/styles/inspector.css`): `.end-edit`, `.end-pick`, `.insp-actions`,
  `.split-form`.

## Editing round: E5 changes

*Stream E5 of the [editing audit](editing-audit.md) ([e5-decisions.md](e5-decisions.md)). Owner of
everything below: E5, except where a line names another owner; other streams add to it only.*

- **Editable rows** (`src/ui/inspector/rows.tsx`): `Edit` (`{ commands } | { why }`), `useEdit()`
  (a row's own outcome and `edit(e, what)`, which sends one step inline or keeps the why),
  `EditErrors` (`row-<name>-errors`), `TextRow` and `SelectRow` (`row-<name>`, `field-<name>`),
  `editOff()` (e5 1).
- **Field edits, pure**: `src/ui/inspector/connection.ts` (`connectionSet`, `quantityEdit`,
  `lengthEdit`, `throughEndCode`, `throughEndEdit`, `THROUGH_END_CHOICES`, `holeFaceCode`,
  `holeFacesEdit`, `stationFacePatch`, `stationEdit`, `stationAtEdit`, `offsetEdit`) and
  `src/ui/inspector/pattern.ts` (`patternEdit`, `explodeEdit`).
- **The inspector's new parts**: `PatternFields.tsx` (Inspector.tsx shows it for a pattern, one
  line in E4's file), `FaceEdit.tsx`, `PartReplace.tsx` (`PartReplaceForm`, `partsLike`).
- **Actions** (`src/ui/inspector/edit-actions.ts`): `edit-connection`, `change-connector`,
  `explode-pattern`, `replace-part`, registered by `editActions()` beside `inspectorActions()`
  (one line in Inspector.tsx); the first two also apply to a corner (`corner:<key>`) with one
  connection, which they select first; `asked` and `useAsked(id, what, then)`, how an action asks the
  inspector to focus a field or open a form; `explodePattern(id, edit?)`, which selects what it
  made; `replaceable(m, id)`, whether the catalog can replace a part's item (e5 26–28).
- **The face form** (`src/ui/tools/forms/FaceForm.tsx`, out of `ToolForm.tsx`): `FaceForm`
  (`value`, `onChange`, `listId`, `fixed`, `disabled`), `BinList`, `connectReplacing` (the joint
  Connect replaces the layers of) and `startRelayer(m, id, layers, options)`. In
  `tools/commands.ts`: `faceOptionsOf(c)`, `faceEditCommand(id, c, edited, layers?)`, and
  `patternCommand(s, params)` (e5 4, 19–22).
- **Arrangements** (`src/ui/inspector/arrangements.ts`): `Arrangement` gains `kind` (`butt`, `miter`,
  `splice`) and `key`, `through` is optional; `arrangementsOf(m, corner, rules, joints?)`,
  `arrangementBatch(m, corners, a)`, `jointWords`, `JOINTS`; `nextArrangement` cycles butts only;
  `matchingCorners` matches a joint's corners by their ends' items too (e5 9–13).
- **`ConnectorSelect`** (`src/ui/common/ConnectorSelect.tsx`): `joins?: "butt" | "splice" | "hinge"
  | "any"` (butt unless it says), and `useConnectors(systems, joins?)` (e5 14).
- **`fetchArrangements` and `arrangementsParams`** (`src/ui/client/arrangements.ts`, E1's) take a
  `miter` or a `splice` among their rules, as the server's `?rule=` already did.
- **The test host** (`src/ui/testing.ts`): `hostOf(dir).arrange(at)` gives `joints` too.
- **`inspector.css`** (S5's, added to): a field table's value cell takes the room its label
  leaves (`table.kv.fields td`), so a long select no longer widens the table past the panel; the
  face form's rules (`.face-edit`) (e5 31).

## Editing round: integration

*The integration pass of the editing round ([integration-editing.md](integration-editing.md)):
the sections above are in stream order, E0 first. Each interface is named once, in the section
of the stream that made it, with its owner; where a stream added to another's interface, its
line names the owner (E3's `gizmoFootprint` in E2's section, E4's `splitBatch` body in E3's
`batches.ts`, E3's change to E4's `wire/ends.ts`). The file table is E0's, with what the later
streams added.*

- **E2E helpers** (`tests/e2e/helpers.ts`, any stream adds): `serveNew(args, prepare?)` runs
  `prepare` on the new project's folder before the server starts, so a test opens at revision 0
  on a state the CLI built.
- **`tests/e2e/editing.spec.ts`** (the integration pass): the audit's §12 scenarios, each ending
  in a comparison with the CLI; it adds no interface.

## Gap X11 changes

*Context ([`../notes/x11.md`](../notes/x11.md)): a bar or a placed part marked `context: true`,
drawn and checked against but not built or bought. Each adds.*

- **`ViewTheme`** (`src/viewer/theme.ts`) adds `body.context`, context's one tone whatever its
  item; **`tokens.ts`** holds its dark and light values (S4 may retune them).
- **The export's palette** (`src/mesh/style.ts`, frozen by D-UX-24): `COLOURS.context`, the GLB's
  `context, translucent` material; `partTone` answers `"context"` first and `barColour` reads a
  bar's `context`. No byte of a GLB without context moved (x11, what moved).
- **The view model** (`src/mesh/model.ts`): `BarJson.context`, `PartJson.context`,
  `ViewPart.context`, `ViewFastener.context`; `PartShape.context` (`src/mesh/place.ts`).
- **`ViewerStats`** (`src/viewer/scene.ts`) adds `context`, the bars, parts and fasteners drawn as
  context. The scene keeps a translucent pair of materials for context, made once, beside the
  opaque pair.
- **The inspector** (`src/ui/inspector/context.ts`): `contextOf(model, id)` (whether the entity can
  be marked, whether it is, and the command) and `contextBatch(model, id, on)`; the Context row
  (`ContextRow`, in `BarFields.tsx`) on a bar's and a placed part's fields, one step.

## Editing polish changes

*The editing polish's core and Move keys ([polish-editing-decisions.md](polish-editing-decisions.md),
"pe"). Each adds to its owner's interface; nothing is renamed.*

- **The selection** (`src/ui/focus.ts`, S2): `select(ids, mode, crossed?)` takes what a box held
  in part, and `crossedEnds(sel?)` answers, for the selection the boxes made (by identity), each
  bar a crossing took without holding it whole and its ends inside the box; any other change of
  the selection leaves it behind. Type `CrossedEnds` (`src/viewer/scene.ts`) (pe 2, 3).
- **The viewer** (`src/viewer/scene.ts`, S3): `onSelect`'s callback gets a box's `crossed` as its
  third argument (empty for a window, absent for a click) (pe 2).
- **Drag gestures** (`src/ui/tools/drag.ts`, E3): `Gestures.starting(handler)`, a tool's keys that
  start its gesture while a selection waits, asked in the capture phase with the focus on an
  element; Move's arrow locks and Rotate's axis keys use it beside their `onKey` handlers (pe 15).
- **Move's rules** (`src/ui/tools/moves.ts`, E3): `moveSet(m, ids, crossed?)` and
  `MoveSet.ends?`, the ends a crossing stretches; `moveWords` says "stretches …". **The batches**
  (`src/ui/edit/batches.ts`): `transformBatch` joins at each moved end, the first 24. **The
  geometry** (`src/ui/edit/geometry.ts`): `Members.ends?`, `stretchedGhosts(m, ends, d)` (pe 7).

## Editing polish changes (the app)

*The editing polish's app side ([polish-editing-ui-decisions.md](polish-editing-ui-decisions.md),
"pu"). Each adds to an interface above; the owner stays the stream that made it.*

- **The roll** (`src/ui/edit/roll.ts`, new, pure; the polish's): `rollSet(bar, next, params)`, the
  `setBar` patch of a bar's roll field, turning the anchor and offset back with a quarter turn;
  `turnedAnchor`, `turnedOffset`, `quarterTurns`, `ROLL_WORDS`. The inspector's Roll rows
  (E4's `BarFields.tsx`, `ManyFields.tsx`) and the draw tool's R send it; `rollBatch(m, ids, roll)`
  (E4's `many.ts`) now takes the model and the typed value (pu 1).
- **The anchor dots** (E4's `AnchorDots.tsx`): `AnchorDots({ bbox, datums, anchors, value, onPick,
  disabled? })`, `size` gone; `anchorLayout(bbox, datums, anchors)` (pure: the pad, the dots'
  centres, the datums' marks), `TARGET` (24 px), and `AnchorGlyph({ bbox, datums, value })`, the
  chosen anchor drawn small. Each dot is a `button.cb-dot` 24 × 24 px with `data-anchor`; a datum
  is a `button.cb-datum`. The several-bars anchor row shows it too (pu 2).
- **The draw tool's anchor picker** (E3's `CommandBar.tsx`): a `details.cb-more.cb-anchor`
  (`draw-anchor`, `data-anchor` the chosen one) whose summary is `draw-anchor-open`; the dots in
  its panel. Its `A` key is unchanged (pu 2).
- **Tool state** (S5's `tools/state.ts`): `rollDrawn()`, R's and the Roll button's quarter turn
  with the anchor turned; `drawRepeat`, Pattern's repeat waiting for the next bar drawn, which the
  draw wire clears when the tool changes (it now hears `switched`, in `wiring.ts`'s order) (pu 1,
  4).
- **Commands** (S5's `tools/commands.ts`, pure): `patternRepeat(s, params)` (along, pitch, count, or
  why not; `patternCommand` builds on it), `repeatBatch(drawn, doc, repeat)` (the draw step and
  the `addPattern` of the bar it makes, by `nextIdNumber`), `suggestedJoint(fit)` (the box frame's
  one-click bracket) (pu 3, 4).
- **Test ids**: `frame-joint-suggested` (the box frame's bracket, a radio), `pattern-draw` (Pattern's
  Draw the bar to repeat), `draw-repeat` (the command bar's pending repeat); `frame-shelf` and
  `frame-params` are now outside More options (pu 3, 4).

## Review fixes, joins

*The editing review's blockers B1–B3 ([review-fixes-joins-decisions.md](review-fixes-joins-decisions.md),
"rj"). Each adds to an interface above; the owner stays the stream that made it.*

- **Batches** (E3's `src/ui/edit/batches.ts`): `mirrorBatch(m, ids, plane, { removeOriginals?,
  prefer? })` adds an `autoConnect` at each image's end (the first 48, after any removal), as
  `duplicateBatch` does (rj 5).
- **Rules** (E3's `src/ui/tools/moves.ts`): `copiedJoins(dryRun)`, a copying step's joints in
  words, those its first command carried (`info.joined` of `array` or `mirror`) and then each
  `autoConnect`'s; `copyWords` and `mirrorWords` (E3's `wire/mirror.ts`) use it, and a carried
  joint is a join in the words, not an entity made (rj 6).
- **The joint preview** (S5's `tools/joint.ts`): `touchesBars(m, p)` also says yes for a point on
  a bar's bounding box or inside it, between its end faces, where `autoConnect` may now butt an
  end (rj 7).
- **Words** (`shell/Settings.tsx`'s rule labels, `problems/ProblemRow.tsx`'s rule words): the
  order rule `unconnected` ("An end with no connection", "Open end") (rj 9).

## Review fixes changes (machining and speed)

*Three majors of the editing review ([review-fixes-machining-decisions.md](review-fixes-machining-decisions.md),
"rm"). Each adds to an interface above; the owner stays the stream that made it.*

- **The batches** (E3's `batches.ts`): `transformBatch(set, written, detach, prefer, at?)`, `at`
  being `{ m, by }`, the model and the offset in numbers; with it, the joins go only to the moved
  ends a join can take (`joinable`), without it to every moved end as before. The Move wire passes
  it (rm 12).
- **The view model** (`src/mesh/model.ts`): `ViewBar.long_mm?`, each end's long point along the
  axis from design point a, where a hole counted from a cut end measures (rm 8).
- **Holes** (E4's `holes.ts`, `Holes.tsx`, `barActions.ts`): `From` (`a.cut`, `b.cut`, `a`, `b`),
  `FROMS` (their words), `fromOf(op)`; `HoleAsked.from`; `holeHere` offers the distance from end
  a's cut (rm 8).
- **Problems** (S1's `Fixes.tsx`): a fix button is disabled only while a step is in flight or the
  app is read-only (rm 2).

## Review fixes, app

*The editing review's app-side fixes ([review-fixes-app-decisions.md](review-fixes-app-decisions.md),
"rfa"). Each adds to an interface above; the owner stays the stream that made it.*

- **A bar's joints** (`src/ui/inspector/joints.ts`, new, pure; E4's inspector): `openCorner(m, ref)`
  (the check's `unconnected` diagnostic for an end that is open), `joinVerdict(m, ref, problems)`
  (the problem list's verdict on Join: ok, or why not; undefined until that revision's problems
  are read), `barJoints(m, bar)` (`BarJoint`: id, type, roles, the bar's ends in it, the others,
  a face joint's stations), `holdingJoints`, `jointLine`, `JOINT_NOUN`. `Joints.tsx`
  (`JointRows`, row `row-joints`, lines `joint-<id>`, buttons `joint-edit-<id>`) sits under the
  ends in `BarFields.tsx`; `endWords` and `Ends.tsx` use the verdicts (rfa 4).
- **Edit joint** (E5's `edit-actions.ts`): the action `edit-joint` ("Edit c36…", or "Edit a joint
  of b35…" opening the row), `editConnection(id)`; `Asked.what` gains `"joints"` (rfa 4).
- **Menu access keys** (E2's `ContextMenu.tsx`, S5's registry): `Action.access?` (a letter of its
  title; Delete's is `l`), `MenuEntry.access`, `withAccessKeys(entries)`; the hook's `menu()`
  entries carry `access`. `outlineMenu` leaves a menu that is already open as it is (rfa 14).
- **Platform words** (`src/ui/platform.ts`, new): `isMac()`, `modifierWord(m)`, `capsText(caps)`;
  the registry's `keyCaps` gives ⌥ ⇧ ⌘ on a Mac, and `keyText(k)` a key as one string (rfa 8).
- **Tokens** (S1's `theme/tokens.ts`): `act-ink` joins the mirror; `inkOn(rgb, theme)`, the ink
  of `act-ink` and `sel-ink` with the more contrast on a fill (the gizmo's letters) (rfa 3).
- **Labels keep clear** (the viewer's `Labels`): an overlay marked `data-keep-clear` is avoided
  like the gizmo; the selection label carries it (rfa 9).
- **Snaps** (`viewer/snap.ts`): `Snap.tip?` and `SnapPoint.tip?`, the person's words for a bar
  face ("b9 +y face (world +Z) at 300"); `label` is unchanged. `faceWords(m, bar, face)` and
  `worldAxis(v)` live in `inspector/words.ts` (rfa 12).
- **The gizmo's drag** (`viewer/gizmo.ts`): `GizmoDrag.shift?`; `slideStop(m, set, bar, s, free)`
  in `tools/wire/move.ts` (rfa 17).
- **The joint previewer** (S5's `tools/preview.ts`): `refused(cmds)`, its last refusal of exactly
  those commands (rfa 6). **The command bar** (`CommandBar.tsx`): `ValueField`'s `name` (rfa 7).
- **Pattern** (`tools/wire/pattern.ts`): `patternPreview` (the reading by Create),
  `patternWords(r, count)`; the hook's `patternGhosts()` (rfa 11).
- **Focus** (S2's `focus.ts`): `unhide(m, refs)`, the menu's Show (rfa 13).
- **ConnectorSelect** (`common/ConnectorSelect.tsx`): `corner?` (corner joints first),
  `CORNER_FAMILIES` (rfa 15).
- **Test ids**: `row-joints`, `joint-<id>`, `joint-edit-<id>`, `join-end-why-<e>`,
  `delete-cancel`, `pattern-preview`, `selection-label`.

## Re-check fixes, app

*The editing review's re-check, the app's findings ([recheck-fixes-app-decisions.md](recheck-fixes-app-decisions.md),
"xa"). Each adds to an interface above; the owner stays the stream that made it.*

- **The commit gate** (S5's `tools/preview.ts`): `ShownAnswer` (`key`, `rev`, `refused`),
  `refusalOf(cmds, shown)` (the refusal a preview shows for exactly these commands at the
  revision the app holds), `shownRefusal(cmds)` (the joint preview's), `heldByPreview(cmds)`
  (holds a commit, setting `lastResult.held`). `JointPreviewer.refused` is kept, as
  `shownRefusal`. `drag.ts`'s commit asks it for every gesture; Draw's `commitBar`, the length
  label and Pattern's Create ask it too (xa 1).
- **Tool state** (`tools/state.ts`): `JointPreview.rev`, the revision the app held when it asked;
  `lastResult.held`, the commands a held Enter met, as JSON, which `CommandBar.tsx` shows once, as
  the result, while that preview stands (xa 1, 2).
- **Pattern** (`tools/wire/pattern.ts`): `patternPreview.shown`, its answer as the gate reads it
  (xa 1).
- **Draw** (S3's `viewer/draw.ts`): `DrawPoint.tip`, the person's words for a face end, from the
  snap's `tip` (xa 5).
- **Holes** (E4's `inspector/holes.ts`): `switchFrom(m, bar, i, to)`, the step that makes a hole
  count from another reference and keeps it where it is, or why it cannot (xa 4).
- **Core words** (E1's `core/problems/words.ts`): `machiningTitle(message)`;
  `checkTitle(code, where, message?)` reads a `machining` message for its title (xa 7).
  Superseded by the core's round, below.

## Re-check fixes, core

*The editing review's re-check, the core's findings and two follow-ups
([recheck-fixes-core-decisions.md](recheck-fixes-core-decisions.md), "xc"). Each adds to or
replaces an interface above; the owner stays the stream that made it.*

- **Core words** (E1's `core/problems/words.ts`): `checkTitle(code, where, reason?)` titles a
  `machining` diagnostic by its `reason` (`MACHINING_REASONS`, `core/diagnostics.ts`), never by
  its message; `machiningTitle(message)` is removed (xc 15).
- **Diagnostics** (`core/diagnostics.ts`): `Diagnostic.reason?`, a machining check's finding. The
  order's `Reason.services?: { of, count }` on the unpriced-machining reason (xc 15).
- **Step words** (`core/commands/words.ts`): a command's phrase may be a `Said`, a sentence with
  the bar ends it leaves `open` or `joins`; `joinPhrases` says each end once, never "left open"
  for an end the step joins (xc 16).
- **Answers**: `mirror`'s `info.there` (a bar of the set not copied, and the bar at its image);
  `autoConnect`'s `info.covers` and the arrangement endpoint's `CornerPlan.covers` (the corner
  end its butt covers) (xc 9, 16).
- **Order rules**: `coincident`, warn by default; the app's rule labels need it (xc 13).

## The review's last items

*The editing review's m2, n2 and n3, in the core
([review-last-items-decisions.md](review-last-items-decisions.md), "rl"). Each adds to an
interface above; the owner stays the stream that made it.*

- **Copies** (`core/commands/copies.ts`, new): `copyLabel(doc, label)`, `asCopy(doc, value)`,
  `tagsOf(value)` and `taggedWords(tagged)`, the words "tagged top" that `copyWords`,
  `mirrorWords` and `alukit do` all use (rl 1–3).
- **Answers**: `array`'s and `mirror`'s `info.tagged`, each copy's tags by its id, absent when
  none carries any (rl 2).
- **Step words** (`core/commands/words.ts`): a command's phrase may be a `Change` (`change`, the
  fields in words; `ids`); `changed(id, set)` returns one, and `joinPhrases` merges consecutive
  changes of the same fields (rl 4).
- **Expressions** (`core/expr.ts`): `foldConstants(src)` and `formatExpr(ast)`; every composer in
  `core/commands/numbers.ts` folds what it writes (rl 5–7).
