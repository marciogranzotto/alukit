# AluKit UX, stream S4: the visual system and the sheets' contents

*S4 of the [UX plan](plan.md) (§5.8): the tokens, the bundled fonts, the theme, the number formats,
the table system and every sheet's contents. Labels: **measured** (a test or a run says so),
**read** (from the code), **inferred**. Interfaces it changed are in [contracts.md](contracts.md)
("S4 changes").*

## Done

| Id | What | Where |
|---|---|---|
| S4.1 | Tokens (dark and light), type scale, spacing, radii, elevation, focus ring; Plex bundled; the no-hex test | `styles/{tokens,fonts,base}.css`, `theme/{tokens,contrast}.ts`, `fonts/`, `vite.config.ts` |
| S4.2 | `format.ts`: grouping with U+202F, dimmed `.00`, `date`, `plural`, `withUnit` | `format.ts`, `common/Num.tsx` |
| S4.3 | `StatusGlyph`/`StatusMark`, `EntityChip` (hover, `+N`), `ItemSwatch`, `itemSwatches(model, theme)` | `common/`, `theme/tokens.ts` |
| S4.4 | The table system | `tables/common.tsx`, `styles/tables.css` |
| S4.5 | Cut list: groups by pieces, stats, end pictograms, machining pills, cutting diagram | `tables/CutList.tsx`, `tables/pictograms.tsx` |
| S4.6 | Order & costs: verdict strip, blocked-first cards, an action per blocker, whiskers, provenance bar | `tables/OrderCosts.tsx` |
| S4.7 | BOM and Machining in the system | `tables/{Bom,Machining}.tsx` |
| S4.8 | Problems sheet, `ProblemRow`, fixes, keys, open items | `problems/`, `records/{OpenItems,ResolveForm}.tsx` |
| S4.9 | Records: Decisions with their form, History in words | `records/{Records,Decisions,History}.tsx` |
| S4.10 | Domain icons (16 px) | `icons/Icons.tsx` |
| S4.11 | The light theme, its switch, the contrast test | `theme/`, `styles/tokens.css` |
| S4.12 | Badges on the rail | each sheet's `registerSheet` |

Empty states: a cut list with nothing, an order with nothing, a machining sheet with nothing, no
problems (the tick, "Every check passes", what was checked), no decisions, no steps.

## The tokens' headline values, and the contrast checks

C's values ([visual-design.md §4.1](visual-design.md)), with the three changes below. Every pair in
`theme/contrast.ts` (`PAIRS`) is held at WCAG 2.2 AA (4.5:1 text, 3:1 for graphics and a control's
border) in **both** themes by a unit test on the CSS (`theme/tokens.test.ts`, **measured**) and by
`theme.spec` on the running app's computed colours (**measured**). Ratios, worst case over every
background the token sits on:

| Token | Dark | Light | Used for |
|---|---|---|---|
| `text-1` | `#E8ECF0`, 10.1 to 15.1 | `#1A1F26`, 13.9 to 16.6 | values, names |
| `text-2` | `#AEB7C1`, 5.9 to 8.9 | `#48515C`, 6.7 to 8.1 | labels, heads |
| `text-3` | `#969FAB`, 4.6 to 6.7 | `#626C77`, 4.7 to 5.3 | units, dimmed decimals, hints |
| `sel-text` / `sel` | `#FFA133`, 6.1 to 8.9 | `#9A4F00`, 5.3 to 6.0 (`sel` is `#E08417`, a fill) | the selection |
| `act` | `#74B4FF`, 6.5 to 8.3 | `#1F63C6`, 5.0 to 5.7 | links, the focus ring (3:1 needed) |
| `ready` | `#4FCB8D`, 6.1 to 8.8 | `#1B7A4B`, 4.5 to 5.3 | READY, pass |
| `blocked` | `#FF7A6E`, 5.0 to 7.1 | `#C2362B`, 4.6 to 5.4 | BLOCKED, errors |
| `warn` | `#EBC84A`, 7.4 to 11.0 | `#8A6200`, 4.7 to 5.5 | warnings, estimates |
| `info` | `#8DB8F2`, 6.5 to 8.8 | `#2A62B5`, 5.1 to 6.0 | notes |
| `tool` | `#3CC8E6`, 7.1 to 9.1 | `#0B7F9A`, 4.1 to 4.6 (text on the panel 4.6) | what a tool builds |
| `line-strong` | `#6B7682`, 3.0 to 3.9 | `#7A8591`, 3.4 to 3.8 | a control's border |
| `status-ink` on a status fill | `#14171B`, 7.1 to 11.0 | `#FFFFFF`, 5.3 to 6.0 | counts, glyph marks |
| `sel-ink` on `sel` | `#201304`, 9.0 | `#201304`, 6.5 | text on a selection fill |

Type: IBM Plex Sans 13/18 body, 12/16 small, 15/20 figure, 18/24 title, 24/28 display; Mono 12/16 for
document literals (the lock stamp, code). Spacing 2/4/6/8/12/16/24/32. Radii 3 (controls, chips)
and 6 (cards). Rows: cut list 32, order 30, tables 28, compact 24. The focus ring is a 2 px `act`
outline on every `:focus-visible`. Status is shape + word + colour: `StatusGlyph` draws a circle with a
tick, an octagon, a triangle and a circle with an i.

Three changes to C's values, each for a measured reason:

1. **`text-3` dark `#8C96A1` becomes `#969FAB`.** C's was 4.1:1 on the selected-row wash; the new one
   is 4.6:1 there and 6.7 on the panel.
2. **`line-strong` is 3:1, not C's 2.1 (dark) and 1.9 (light).** It is the border of every input and
   button, which WCAG 1.4.11 asks to be 3:1 to be seen. Decoration stays on `line`.
3. **The active tool and tab are `--mark-active` = `text-1`, not amber** (C's own rule: amber is only
   ever the selection). S0's `--mark-active*` and `--act-line` take that value. New tokens: `--act-ink`
   (text on a primary button), `--tip-ink`, `--hover-wash`, `--warn-wash`, `--ready-wash`,
   `--info-wash`.

Known limit: the light `sel` fill is 2.8:1 against white. It is a fill that always carries a wash and
`aria-selected`, with its text at 6:1, so the state is not carried by the fill alone (1.4.11's
"required to understand"); the 3D tint is S3's.

## The fonts

IBM Plex Sans (Latin and Latin Extended, 400, 500 and 600) and Plex Mono (Latin, 400) are **in the
repo** as WOFF2 under `src/ui/fonts/`, with the SIL OFL 1.1 text (`OFL.txt`, from the
[@fontsource](https://fontsource.org/fonts/ibm-plex-sans) 5.3.0 packages the files come from).
**This differs from D-UX-22's wording** (a pinned `@fontsource` dependency): the task asks for the
files in the repo, which also keeps the lockfile and `package.json` as they were. `styles/fonts.css`
declares the faces with `unicode-range`; Vite emits each file into `dist/assets/` with a hash, and
the server serves it from its own origin with the `font/woff2` type it already had.

- **No `data:` URI**: `build.assetsInlineLimit` returns `false` for `.woff2`, because Vite would
  otherwise inline anything under 4 KiB and the CSP refuses `data:` fonts (**read**: the CSP is
  `default-src 'self'` with no `font-src`). Plex's smallest file is 14.7 KB, so the default would
  not have inlined one, but the rule is explicit.
- **The CSP needs no change.** `theme.spec` loads each weight, checks `document.fonts.check`, checks
  that every `.woff2` response is from the app's origin and that no resource is a `data:` URI, and
  fails on any console error or "Content Security Policy" message (**measured**: passes).
- A font's weight loads on first use; until then the system font shows (`font-display: swap`).
- **Not done here**: the README's credit to the fonts' licence (S2 owns the README); the snapshot
  mode's wait for `document.fonts.ready` (S3 owns it; the snapshot is a canvas with no text, so it
  does not depend on a font).

## The theme

`theme/theme.ts`: `theme` is a `computed` of the snapshot's pin, the remembered choice and the
system's scheme. It follows `prefers-color-scheme` (light when the system asks for light, dark
otherwise); a `<select>` (`ThemeSwitch`, test id `theme-switch`) chooses system, dark or light and
remembers it in `localStorage` (every read and write guarded). **Snapshots are pinned dark** unless the
page's URL has `theme=light`; `playwright.config.ts` pins the e2e colour scheme dark (S0). The switch
sits in the top bar, a one-line cross-edit in S2's `TopBar.tsx` for S2 to place.

`viewTheme(theme)` now has a light set and a two-stop background gradient in both themes (C §1).
**What waits on S3**: the viewer reads `background[0]` only until S3.1, so the dark ground is the
gradient's top stop for now; and `setTheme` is S3.12's, so the 3D view stays dark when the app is
light until then.

## Numbers

One function per quantity. Digits are the CLI's (mm and degrees to 2 decimals, kg to 3, money in
minor units). Thousands are grouped with U+202F from **four digits in a table** and five in running
text. A trailing `.00` is dimmed (`Num`). Units sit in the column head. Dates read `27 Nov 2026` in
the interface (ISO in files and the CLI). The decimal point stays the point.
**Test impact**: a table's text is not byte-equal to the CLI's, so specs compare with
`numberText(printed)` (`tests/e2e/helpers.ts`), a pattern allowing U+202F between the CLI's digits.
Money, lengths and masses compared are the CLI's, digit for digit (**measured**: `outputs.spec`).

## The sheets

The rail is **Cut list, BOM, Machining, Order & costs, Problems, Records** (then S2's Params, until
S2 moves it). Ids: `cutlist`, `bom`, `machining`, `order`, `problems`, `records`; the ids `checks`,
`open-items`, `costs`, `decisions` and `history` are gone (their contents are sections inside the new
sheets, each keeping its `data-testid`).

- **Table system.** One `<table>` per sheet with a shared `colgroup`, so the cut list's "Cut length"
  has one x in every group (`tables.spec`). Rows set `focus.hover` (`__alukit.hovered()`) and light
  from `focus.selection`; a click on a row selects its entities (Ctrl/Cmd toggles), a chip only
  itself; long text is one line that opens in place (`Clip`); a stale answer is dimmed under a
  progress line.
- **Selection only**: a checkbox in every sheet's bar, one global signal (`selectionOnly`, S2's
  registry). It filters rows that name entities: the cut list, BOM, machining, the order's lines (by
  the entities of the BOM lines they cover), problems and open items. Cost lines, history and
  decisions name none, so it leaves them. Selection-only opens a ready supplier's folded lines.
- **Cut list.** Groups by pieces; group heads with `Pieces`, `Total` and `Supply`; the cut length as
  the figure with the centre, span and ordered lengths on a second line when they differ; ends as a
  pictogram and in words (`endText`); machining as pills with the full sentences behind a
  disclosure; a cutting diagram per stock bar, to scale.
- **Order & costs.** The verdict strip (not ready / ready, "4 of 7 suppliers are blocked by 6 things
  to resolve", the likely total and its range, the one date, the lock stamp), then a card per
  supplier, blocked first, each blocker a `ProblemRow` with its action, a ready card folded to its
  head, the lines in a shared grid with the price source in words and a triangle for an estimate;
  then the cost lines, the totals (the total row at 18/24) and the provenance bar. "Things to
  resolve" counts distinct `rule|message` of blocking reasons: an open item holding three suppliers is
  one thing. One date picker (`as-of`, in the verdict) drives the order and the costs. Test ids kept:
  `order` and `costs` (each with `data-rev`), `totals` with `tr.total`, `cost-lines`,
  `section[data-supplier]` with `data-status`.
- **Problems.** Counts, then groups by consequence (blocks the order, errors, warnings, notes), each
  row a glyph, a word for screen readers, the title, what follows from it, its code (small, for parity
  with the CLI), the entities as chips, a **Show** (`focus.show`), and its fixes. **↑ and ↓ move
  between rows, Enter shows.** Then the document's checks and the open items (add form, Resolve).
  With nothing to report: the 28 px tick, "Every check passes" and what was checked.
- **Fixes.** A `commands` fix sends its batch (one step); `resolve-open` opens `ResolveForm` in the row;
  `set-price` opens a price form (a `setItem` with a valued `price_minor`, one step); `lock-update`
  runs `lockUpdate`; `param` opens the Params sheet. What a command refuses shows under the row.
  **`set-price` is enabled for a project item only**: no command sets a catalog item's price, so the
  button for `test:PSU-24V` is disabled with the reason as its tooltip, not a silent no-op.
- **Records.** Decisions with their add form, then History: who made each step in words ("You, in the
  app", "Agent claude"), what it did, and a struck row with "undone in step N" for a step that stays
  undone (a redo brings it back).
- **Badges** (`registry.ts`'s `badge`): `Cut list 47 pieces`, `BOM 24 lines`, `Order & costs` with
  the octagon and the count of things to resolve (it asks for the order itself, as the sheet does,
  so it does not wait for BE-3), `Problems` with the octagon and the warning triangle counts.

## What stands in for BE-3 until it lands

S1.6 and S2.6 are not in this branch, so `store.problems` is never filled. Two stopgaps, each with
its removal:

- `problems/source.ts` `fromCheck(model)`: the Problems list is the check's diagnostics (errors,
  warnings, notes, no fixes) until `store.problems` holds the drawn revision's answer; the badge
  counts follow. **Delete `fromCheck` and the `served` flag when S2.6 fills `problems`.**
- `tables/OrderCosts.tsx` `reasonProblem` and `fixesFor`: an order reason becomes a problem with the
  fixes its rule implies (open item: resolve; no or estimated price: set a price; stale: update the
  lock). When the server's problem for the reason exists (matched on the CLI's message and the
  supplier) its words and fixes are used instead. **`fixesFor` goes when every reason has a problem.**

Two checks wait for BE-3 and are written to run then: the rail's `Problems` count equals the
server's `blocks-order` problems (`problems.spec` skips while `alukit problems` fails), and "a fresh
`forseti` project with an option-less bar offers Set anodised and Set black" is **not written**: it
needs the server's `commands` fixes to exist, so it cannot be verified here. S1 or S4 adds it with
BE-3.

## Not done, and why

- **"Add a check"** in the all-clear state, and a check's **margin bar**: `addCheck` needs a form
  of its own; the margin is shown as a number.
- **The lock stamp** is still in each sheet's bar. It moves to the revision popover when S2 builds it
  (delete `Stamp` from `SheetBar`).
- **Colour by item on the bodies** is S3's: it takes `itemSwatches(model, theme)`.
- **Icons are drawn, not placed**: the rail and tool bar are S3's and S5's.
- 14 `noDescendingSpecificity` **warnings** from Biome in the stylesheets (generic table selectors after
  specific ones); `pnpm lint` exits 0.

## Cross-edits in files another stream owns

Each is the smallest change, and keeps what its test proves.

- `src/ui/TopBar.tsx` (S2): imports and places `ThemeSwitch` (two lines).
- `tests/e2e/topbar.spec.ts` (S2): the cut-length assertions use `numberText`, because the table
  groups thousands.
- `tests/e2e/inspector.spec.ts` (S5): "Checks … 0 errors" reads the Problems sheet's "0 errors".
- `tests/e2e/helpers.ts` (shared): adds `numberText`.

## Tests

- **Unit** (`pnpm test`): `format.test.ts` (grouping, `.00`, parity with the CLI's money);
  `theme/tokens.test.ts` (tokens equal in CSS and TS, light falls back to dark, every contrast pair in
  both themes, no colour literal in `src/ui` and `src/viewer`); `tables/tables.test.ts` (swatches:
  bars first, the neutral past eight, no amber or cyan hue, labels readable on every swatch in both
  themes; the history's words; the machining pills); `icons/icons.test.ts`.
- **E2E**: `theme.spec` (new; the switch, the system's scheme, the snapshot pin, the contrast of every
  pair on the running app in both themes, Plex from the origin, no CSP message); `tables.spec` (new;
  one grid, hover, click and F, chip, selection-only on four sheets); `problems.spec` (new; Resolve
  on O2 drops one blocker as one step and one undo restores it, the list's keys, status as shape and
  word, the empty project in every sheet and Draw a bar works; one skipped until BE-3). `outputs.spec`
  and `records.spec` keep their semantics: statuses (by `data-status`), reason counts and totals equal
  `alukit order`, `costs` and `machining`; each record edit is one undoable step; a refusal shows under
  its form.

## Screenshots

Before and after, dark, 1440 px, the cart: [cut list](img/s4/before-cutlist.png) →
[cut list](img/s4/after-cutlist.png); [order](img/s4/before-order.png) →
[order & costs](img/s4/after-order.png) and [in light](img/s4/after-order-light.png);
[Checks](img/s4/before-checks.png) → [Problems](img/s4/after-problems.png);
[an empty project](img/s4/after-empty-cutlist.png). The 3D view is the old one (S3's).
