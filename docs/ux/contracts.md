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
