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
| Selection, hover, Show | `src/ui/focus.ts` | S2 | `selection`, `select`, `hover`, `shown`, `show(req)`, `clearShow()`, type `Ref`. `show` selects what the refs stand for and records the request; each region reacts to the signals (S3 frames and pulses, S2 reveals the row, S5 points at `field`) |
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
  then they take a built-in id typed in Project settings.
