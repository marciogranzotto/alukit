# AluKit UX: the implementation plan

*2026-11-27. This plan merges the three UX reviews into one list of problems, a set of decisions
for the coordinator, the backend and CLI additions the UI needs, and parallel implementation
streams. The three reviews are [task flows and IA](flows-and-ia.md) (A),
[heuristics and first run](heuristics-and-first-run.md) (B) and
[visual design](visual-design.md) (C). It changes no product code.*

*Labels: **measured** means a review drove the built app. **Read** means this plan read the code
at `b2077fc`. **Inferred** means reasoning, not run. A finding relayed from a review keeps that
review's label. Every decision has a recommendation; the coordinator answers each one by its id
(D-UX-n).*

## Contents

1. [Summary](#1-summary)
2. [The problems, unified](#2-the-problems-unified)
3. [Decisions](#3-decisions)
4. [Backend and CLI additions](#4-backend-and-cli-additions)
5. [Streams](#5-streams)
6. [Sequencing](#6-sequencing)
7. [Not now (v1.1 and later)](#7-not-now-v11-and-later)
8. [Risks](#8-risks)

## 1. Summary

The three reviews agree on the worst problems, and they found them independently:

- nothing drawn can be deleted or edited in the app;
- auto-connect changes drawn lengths silently, and corners are invisible;
- the README's first frame starts blocked;
- the order's blocked state hides inside its tab;
- problems are never shown in 3D;
- agent edits arrive unattributed;
- catalog search ranks a caster plate first for "40x40".

The reviews differ mostly in where things go, and §3 settles that. **68 problems** remain after
merging, **14 of them plain bugs** (§2.2). There are **26 decisions**, 13 **backend additions**
(9 of them small), and **six streams**:

- S0, the contracts, lands first;
- S1 to S5 then run in parallel worktrees.

The layout every stream builds toward (A's regions, with B's status bar and C's tab rail):

```
┌ Top bar ─────────────────────────────────────────────────────────────────────────────────┐
│ AluKit  Project ▾  variant ▾   ⟲ Undo · claude: add bar b13  ⟳    ● BLOCKED · 3   ⤓   ?    │
├ Left ───────────┬ Canvas ──────────────────────────────────────────────┬ Right ────────────┤
│ PARTS BIN       │ tool  3D view: joint markers, problem badges, hover  │ tool form         │
│  armed bar  B   │ rail  label, callouts                       view ▾   │ (Connect, Box     │
│  armed part P   │ V B G                                                │  frame), above    │
│  Browse… /      │ C P X        [start card, on an empty project]       │ INSPECTOR         │
│ MODEL           │ M                                                    │  editable; with   │
│  by tag · kind  │ ┌ command bar: tool · value = 620 mm ⏎ · options ──┐ │  nothing selected │
│  Joints ⚠ 8     │ └───────────────────────────────────────────────────┘ │  the project      │
│  Parts · …      │ ● Live · Step 14 · you drew b2 · type a length · mm  │  panel            │
├─────────────────┴──────────────────────────────────────────────────────┴───────────────────┤
│ SHEETS  Cut list 47 · BOM 24 · Machining 3 · Order & costs ⛔ 6 · Problems ⛔2 ⚠1 · Records  │
└────────────────────────────────────────────────────────────────────────────────────────────┘
```

See A's [layout wireframe](img/flows/08-proposed-layout.png), B's
[first run](img/heuristics/m1-first-run.png) and [problems](img/heuristics/m3-problems-in-3d.png)
wireframes, and C's [order mockup](img/visual/09-order-before-after.png).

## 2. The problems, unified

### 2.1 The list

**Sev** uses B's 0–4 scale (4: catastrophe, 3: major, 2: minor, 1: cosmetic). Where B rated a
finding, B's rating stands. A merged row takes the highest rating among its parts. A **\*** marks
a rating this plan made, for a finding B did not rate, or a row that adds an unrated part rated
higher. **Sources** cite A's problems (P#) or sections (§), B's findings (F#, and A# for its
accessibility rows) and C's numbered observations in its §2 (C1–C14) or §8. **Evidence** is the
reviews' own (measured, unless the source says code). Rows run by severity, then by theme.

| # | Problem | Sev | Bug | Sources | Evidence |
|---|---|---|---|---|---|
| U1 | **Nothing drawn can be deleted in the app**: no Delete key, button or menu | 4 | | A P1; B F12 | [B E4](img/heuristics/e04-autoconnect-silent.png) |
| U2 | **The README's first frame is born blocked.** The option list always offers "(the project's default)", even in a project with no default. The bars are drawn with no finish, and the order blocks on `option-not-sold` | 4 | bug | A P4; B F22 | [B E2](img/heuristics/e02-catalog-to-palette.png), [E3](img/heuristics/e03-first-order-blocked.png) |
| U3 | Nothing drawn can be edited in place: length, profile (this one, these, all like it), finish, anchor, roll, label. Fields show as JSON | 3 | | A P1; B F13 | [A 03](img/flows/03-today-drawn-box-readonly.png) |
| U4 | Auto-connect changes drawn lengths silently: a post typed 800 is cut 820. It picks the through bar by drawing order, so a 1000 × 600 rectangle is cut 1040 / 600 / 1000 / 560. Nothing previews the change or flips it | 3 | | A P2; B F1, Q7 | [B E4](img/heuristics/e04-autoconnect-silent.png) |
| U5 | Corners are invisible: no markers in 3D, open ends are only warnings in a tab, and which bar runs through shows only in a selected bar's derived section | 3\* | | A P2; B R9 | [A 03](img/flows/03-today-drawn-box-readonly.png) |
| U6 | Connect says "made c9" while the step broke another bar (`two-providers` on b1). The panel shows only the diagnostics that name the new connection | 3\* | bug | A P2 | [A 04](img/flows/04-today-connect-made-error-elsewhere.png) |
| U7 | Order readiness hides in the Order tab. Checks says "0 errors" while the order is BLOCKED, and the badge counts errors only. Inside the tab, BLOCKED is an 11 px pill, and READY suppliers take as much room as blocked ones | 3 | | A P3; B F2; C12 | [A 05](img/flows/05-today-order-blocked.png) |
| U8 | One problem has three vocabularies. A missing finish is a WARN `no-offer` in Checks, a BLOCK `option-not-sold` in Order, and nothing in the tree | 3 | | B F18; A P7 | [B E3](img/heuristics/e03-first-order-blocked.png) |
| U9 | Blockers offer no fix, and a missing price, a missing option or a placeholder has no fix anywhere in the app | 3\* | | A P3; B §5.4 | [A 05](img/flows/05-today-order-blocked.png) |
| U10 | The first error a new user meets is unreadable: "forseti:PF40-01: not sold with" (the option list is empty), while Checks prints `[]` | 3 | bug | B F37 | [B E3](img/heuristics/e03-first-order-blocked.png) |
| U11 | Problems are never drawn in 3D. A reason's link selects, but does not frame, pulse or reveal in the tree, and an open item that blocks is plain text | 3 | | B F38, F42; A P7 | [B E5](img/heuristics/e05-reason-to-entity.png) |
| U12 | An item id in a diagnostic "selects" the item, and Properties then call it "a pattern copy", which is false | 3 | bug | B F39 | [B E3](img/heuristics/e03-first-order-blocked.png) |
| U13 | Project setup is CLI-only: no command sets catalogs, currency, price basis, fx, defaults or order rules. `alukit new` without `--catalog` gives `std` only, with no T-slot profile, and the app neither says so nor can fix it | 3 | | A P5; B F24, Q1 | [B E2](img/heuristics/e02-catalog-to-palette.png) |
| U14 | Catalog search knows neither size nor kind: "40x40" ranks a caster plate and a hinge kit above the profile, and the first hit's "Set as palette" switches to Place | 3 | bug | A P6; B F23 | [A 02](img/flows/02-today-catalog-search.png) |
| U15 | The catalog and the model share one 260 px column. Names cut off before the words that tell profiles apart, and the list shows no price. Switching tabs hides the tree and drops the search, the filters and the open card | 3\* | | A P6; B F16 | [A 02](img/flows/02-today-catalog-search.png) |
| U16 | Agent and CLI edits arrive silently: nothing marks them. Only the Log tab and a tooltip say who made them | 3 | | A P9; B F6 | [A 07](img/flows/07-today-agent-edit.png) |
| U17 | Undo crosses sources without saying so: "Undo addBar" can take back an agent's step | 3 | | B F14; A P9 | [B E6](img/heuristics/e06-refusal.png) |
| U18 | The machine's words reach the person: undo labels are command names ("Undo addBar, autoConnect, autoConnect"), refusals use schema terms ("template/0: Invalid input"), references are paths (`b19 (b/on/at_mm)`), and `through` and `butt` go unexplained | 3 | | A P8; B F8 | [A 06](img/flows/06-today-error-in-top-bar.png) |
| U19 | Ids stand in for things: tree rows read "b1 forseti:PF40-01" and "c1 butt", with no role, length or label, and item ids stand where names would do | 3 | | B F27; C §6.1 | [B E4](img/heuristics/e04-autoconnect-silent.png) |
| U20 | Typing a unit or a tool letter in a typed length switches the tool and drops the gesture (`1.2m` → Measure) | 3 | bug | B F17, A7 | [B E8](img/heuristics/e08-typed-unit.png) |
| U21 | A typed length is digits only: no param, expression, unit, sign or coordinate | 3 | | B F31 | [B E8](img/heuristics/e08-typed-unit.png) |
| U22 | The keys are hidden. Tool keys are only in tooltips, R, A and W in small print, and Pattern has no key. The app has no shortcut list, no help and no link to the guide | 3 | | B F28, F43; A P11 | [B E1](img/heuristics/e01-first-run-empty.png) |
| U23 | "Restore last good" overwrites the hand edit with no confirmation, and keeps no copy | 3 | | B F15, Q5 | [B E7](img/heuristics/e07-read-only.png) |
| U24 | A box frame takes 16 clicks and 35 keys and leaves 8 open corners. There is no frame-first start | 3\* | | A §2.2, R5; B R3 | [A §2.2](flows-and-ia.md#22-draw-a-rectangular-base-frame-with-four-posts-connect-the-corners) |
| U25 | One fixed drawer (32 vh) holds ten tabs of outputs, problems, records and history, and it closes when its active tab is clicked. Selection links one way: a row selects but does not frame, and a 3D selection does not find its rows | 3\* | | A P7, R16; C §6.2 | [A 05](img/flows/05-today-order-blocked.png) |
| U26 | The core task needs a pointer. The canvas is not focusable, and no key starts a bar or picks an end (WCAG 2.1.1) | 3 | | B A1 | [B E9](img/heuristics/e09-keyboard.png) |
| U27 | An empty project offers no first step. The drawer opens to say "No pieces.", the tree is blank and the right panel says "Select a bar…". A Checks tab with nothing to report is a blank pane | 2 | | A §2.1; B F34; C13 | [A 01](img/flows/01-today-empty-project.png) |
| U28 | With an empty palette, Draw bar says "click a start point", and a click does nothing. The palette ignores the document's `defaults.bar`, every session | 2 | | B F7, F33 | [B E1](img/heuristics/e01-first-run-empty.png) |
| U29 | Bars do not chain: each of a rectangle's four rails starts over | 2 | | B F32 | [B M2](img/heuristics/m2-drawing-feedback.png) |
| U30 | Refusals land in the top-bar notice, far from the form or tool that sent them | 2 | | A P8; B F40 | [A 06](img/flows/06-today-error-in-top-bar.png) |
| U31 | The notice is cut off with an ellipsis, and there is no way to read the rest | 2 | bug | B F40 | [B E6](img/heuristics/e06-refusal.png) |
| U32 | Two "revisions" sit side by side: "rev 3", the history counter, which rises on undo, and "Revision: unsaved", a named snapshot | 2 | | B F3 | [B E7](img/heuristics/e07-read-only.png) |
| U33 | Read-only mode does not say what is shown: the pill stays "live" and the scene is the last good state, unlabelled. There is no did-you-mean, and disabled tools do not say why | 2 | | B F4, F41, F26 | [B E7](img/heuristics/e07-read-only.png) |
| U34 | With exactly one problem, the read-only banner drops the entity and the list the server sent | 2 | bug | B F41 | [B E7](img/heuristics/e07-read-only.png) |
| U35 | Select gives no hover feedback, and the view shows no labels (cut length, end angles) | 2 | | B F5; C5 | [C 05](img/visual/05-ghost-and-hover.png) |
| U36 | Variants can be viewed but not compared. While one is shown, edits go to the base document, and only a tooltip says so | 2\* | | A P10 | [A §2.6](flows-and-ia.md#26-compare-variants-save-a-revision-export-glb) |
| U37 | Hovering a pattern copy's face shows a target ("b26@1 +y face at 0") that the click then ignores | 2\* | bug | A P11, §2.3 | [A §2.3](flows-and-ia.md#23-place-a-bracket-and-add-a-pattern) |
| U38 | Connect accepts wrong picks and explains afterwards. A face joint's fasteners are typed as item ids, and the tool panel pushes the properties down | 2 | | B F25; A P11 | [A §2.3](flows-and-ia.md#23-place-a-bracket-and-add-a-pattern) |
| U39 | Placing a part and patterning it takes 11 clicks and 14 keys, and Place needs a button press after the click | 2\* | | A §2.3, F4 | [A §2.3](flows-and-ia.md#23-place-a-bracket-and-add-a-pattern) |
| U40 | Anchors are codes in a drop-down (`c`, `-x-y`), with no picture of the section | 2 | | B F9 | [B E1](img/heuristics/e01-first-run-empty.png) |
| U41 | Units and precision drift. The hint's length has no unit, and panels round to 3, 2 or 2 decimals. Money is not grouped, and `85.00 BRL` sits beside `85.00` | 2 | | B F11; C11 | [C 09](img/visual/09-order-before-after.png) |
| U42 | Colour means too many things. Orange marks the selection, picks, the draw preview, the active tool, the active tab and the accent. Cyan marks picks, line snaps and the section outline. The active tool's outline reads as focus | 2 | | B F19; C6 | [C 02](img/visual/02-selection-before-after.png) |
| U43 | Snap kinds differ only by colour, on one square marker | 2 | | B F30, A5; C6 | [B E4](img/heuristics/e04-autoconnect-silent.png) |
| U44 | The tool bar is thirteen identical text buttons, and it wraps to two rows at 1280 px | 2 | | B F21; C14 | [B E1](img/heuristics/e01-first-run-empty.png) |
| U45 | The item card speaks schema: `mass_kg_per_m`, `Ix_mm4`, `fidelity exact`, `s40-c8` | 2 | | B F29 | [B E2](img/heuristics/e02-catalog-to-palette.png) |
| U46 | One grey under one fixed light: profiles are told apart only by size, and orthographic views are flat silhouettes | 2\* | | C1 | [C 03](img/visual/03-ortho-front.png) |
| U47 | Slot edges hatch the frame at the usual zoom, and rounded profiles have no silhouette line | 2\* | | C2 | [C 07](img/visual/07-closeup-before-after.png) |
| U48 | A black-anodised profile disappears against the background (1.56:1, with edges darker still) | 2\* | | C3 | [C 01](img/visual/01-iso-before-after.png) |
| U49 | A selected bar behind another is hidden: nothing shows where it continues | 2\* | | C4 | [C 02](img/visual/02-selection-before-after.png) |
| U50 | Edges z-fight into dashes: no material has a polygon offset | 2\* | bug | C4 | [C 02](img/visual/02-selection-before-after.png) |
| U51 | Tables do not line up across groups and suppliers. Heads are dim and lowercase, cells wrap, and one machining cell is a 200-character sentence | 2\* | | C10 | [C 08](img/visual/08-cutlist-before-after.png) |
| U52 | Tab walks about 95 tree rows before it reaches the tool bar. There are no landmarks or skip link, and the tree is not one widget (WCAG 2.4.3, 2.4.1) | 2 | | B A2 | [B E9](img/heuristics/e09-keyboard.png) |
| U53 | Focus is the default 1 px ring, which competes with the orange active-tool outline (2.4.7) | 2 | | B A3 | [B E9](img/heuristics/e09-keyboard.png) |
| U54 | No live region: refusals, exports and outcomes are never announced (4.1.3) | 2 | | B A4 | [B §3](heuristics-and-first-run.md#accessibility-wcag-22) |
| U55 | Colour alone marks tree rows with errors and the provenance underline (1.4.1) | 2 | | B A5 | [B E4](img/heuristics/e04-autoconnect-silent.png) |
| U56 | Names and roles are missing. The Checks tab is named "Checks1", tabs have no tabpanel and no arrow keys, "×" and "↑" have no names, and the tree has no role (4.1.2) | 2 | bug | B A8 | [B E9](img/heuristics/e09-keyboard.png) |
| U57 | `--as agent:<name>` is refused: the CLI sends `cli:agent:<name>`, so an agent driving the CLI cannot tag itself `agent:` | 2\* | bug | A §2.7 | [A 07](img/flows/07-today-agent-edit.png) |
| U58 | The Persp/Ortho button names the state, not the action | 1 | | B F10 | [B E1](img/heuristics/e01-first-run-empty.png) |
| U59 | Esc means three things (cancel the gesture, leave the tool, clear the selection), and in Connect it drops every pick at once | 1 | | B F20 | [B §3](heuristics-and-first-run.md#h4-consistency-and-standards) |
| U60 | Audit stamps (lock hash, price basis, oldest read) head every output tab | 1 | | B F35; C §6.1 | [B E3](img/heuristics/e03-first-order-blocked.png) |
| U61 | The ground is a fixed 4 m sheet, the axes sit hidden inside the model, and there is no orientation gizmo | 1\* | | C7 | [C 01](img/visual/01-iso-before-after.png) |
| U62 | A section plane shows hollow bars: no caps | 1\* | | C8 | [C §2.1](visual-design.md#21-the-3d-view) |
| U63 | There is no type scale: headings use letter-spaced capitals, and values use monospace | 1\* | | C9 | [C 12](img/visual/12-tokens.png) |
| U64 | Some targets are under 24 px: tool bar buttons are 23 px, tree rows 22 px, and the "×" buttons smaller (2.5.8) | 1 | | B A6 | [B E9](img/heuristics/e09-keyboard.png) |
| U65 | Single-letter shortcuts cannot be turned off (2.1.4) | 1 | | B A7 | [B E8](img/heuristics/e08-typed-unit.png) |
| U66 | Popovers stay open until their own button is pressed again (the revision panel covered Connect's) | 1\* | | A §2.6, R16 | [A §2.6](flows-and-ia.md#26-compare-variants-save-a-revision-export-glb) |
| U67 | The catalog list prints a raw float, `7.356726885756334 kg/m` | 1\* | bug | B F11 | [B E2](img/heuristics/e02-catalog-to-palette.png) |
| U68 | `angledGeometry` drops the unit geometry's groups, so a bar with two materials (C's cut faces) draws nothing. Latent: today every bar has one material | 1\* | bug | C §8 | [C §8](visual-design.md#8-the-prototype-and-what-it-found) |

Severity counts: 2 rated 4, 24 rated 3, 31 rated 2 and 11 rated 1.

### 2.2 The plain bugs, and why they happen

A bug here is wrong behaviour by the app's own rules or plain intent, not a design choice. Where
this plan read the cause, the root column says **read**.

| # | Root cause | Fixed by |
|---|---|---|
| U2 | **Read**: `Catalog.tsx` always renders `<option value="">(the project's default)</option>`, whatever `defaults` says. "Set as palette" then arms an item with no option | S2.3 (offer the default only when it exists, else preselect a sold value); S1.1 (the wording) |
| U6 | **Read**: Connect shows `newDiagnostics(outcome, [id])`, which keeps only the diagnostics that name the new connection (`Feedback.tsx`). The answer held the error on b1 | S5.9 |
| U10 | **Read**: `src/core/order/rules.ts` writes `` `${item}: not sold with ${opt}` ``, and `opt` is empty when no option was chosen | S1.1 |
| U12 | **Read**: `kindOf` in `Properties.tsx` maps `forseti:PF40-01` to no document map, and the panel then treats the missing entry as a pattern copy | S5.3 (a non-entity is never a pattern copy); S3.6 (an item resolves to the bars and parts that use it) |
| U14 | **Read**: `src/catalog/search.ts` puts every item whose name holds "40x40" as a whole word in one tier, then sorts the tier by name length. Short accessory names win, and nothing knows a bar's own size or what the tool wants | S1.3 |
| U20 | B, from the code: `drawKey` passes letters on to `TOOL_KEYS` while digits are typed | S5.1 |
| U31 | B, measured: the notice has `scrollWidth > clientWidth`, and has no tooltip or expand | S2.15 |
| U34 | **Read**: `ReadOnlyBanner` renders the list only when `diagnostics.length > 1` | S2.14 |
| U37 | A, measured: the hover offers a station on a copy's face, and the click on a copy sets nothing | S5.8 |
| U50 | C, read: there is no `polygonOffset` on any material | S3.1 |
| U56 | B, measured: the badge sits inside the tab's name, and the buttons have no names | S2.16 |
| U57 | **Read**: `src/cli/do.ts` builds `` `cli:${opts.as}` ``. The server's source rule (`server.ts`, `SOURCE`) allows `agent:<name>`, but the CLI can never send one | S1.2 |
| U67 | B, measured: the list prints the mass per metre unformatted | S4.2, used by S2.3 |
| U68 | C, measured in its prototype: `angledGeometry` builds a new `BufferGeometry` from positions and index only | S3.3 |

## 3. Decisions

Each decision gives the options, a recommendation and the reason. The coordinator answers by id.

### Layout and information architecture

**D-UX-1 The left column.**

- Options:
  - (a) keep today's Project | Catalog tabs (B's wireframes keep them);
  - (b) a **parts bin** (what the project uses and what is armed) above an always-visible
    **model outline**, with the full catalog as a **wide overlay** on demand (`/`; A §5.2).
- **Recommend (b).** The 260 px column is the cause of U15: names cut off and the tree is lost.
  SketchUp's "In Model" materials split, a small used set beside a big library, is the
  established pattern (A §4). The overlay keeps its search and its open card when it closes.

**D-UX-2 The bottom region and its tabs.**

- Options:
  - (a) today's ten tabs, with badges;
  - (b) A's **sheets**, six groups, resizable, collapsible and maximizable, with two-way
    selection;
  - (c) (b) plus C's tab rail, which carries a figure or status per tab so it can be read
    closed, plus B's rule: collapsed for an empty project, opening once by itself on the first
    output.
- **Recommend (c).**
  - The groups are Cut list · BOM · Machining · **Order & costs** · **Problems** · **Records**.
  - Costs joins Order, since one date picker already drives both (m4a decision 42).
  - Checks and Open items fold into Problems.
  - Params move to the project panel (D-UX-4).
  - Records holds Decisions and History.
  - The explicit collapse replaces "click the active tab to close" (A R16).

**D-UX-3 Where readiness shows.** Three reviews offer three places:

- A, a **pill in the top bar**;
- B, an Order chip in a **status bar**;
- C, the status on the **Order tab** in the rail.

- **Recommend:**
  - the **top-bar pill** for the order's state (READY, BLOCKED · n to fix, pricing…, nothing to
    order), opening Order & costs on its blockers;
  - **rail badges** for counts (C);
  - B's **status bar** for connection, the last step and who made it, the tool's prompt, units,
    and the live region.
- Why: the status bar does not repeat the order chip. One always-visible order signal, plus the
  counts on the tabs that hold the detail, is enough, and a third copy is noise. B's status bar
  keeps the job its principle 1 gives it: the state that persists.

**D-UX-4 What the inspector shows with nothing selected.** A shows the params, B a First steps
checklist, and C a project summary.

- **Recommend:** a **project panel** in three parts.
  - First steps (B) at the top, on a project that started empty, until all four steps tick or
    the person hides it.
  - Then the summary (C): bars, parts, mass, the likely cost and the order's state.
  - Then the params table (A), editable, moved from the Params tab.
- Why: "Select a bar…" fills the most valuable column with nothing most of the time (U27, C13).
  Params are the project's main knobs and belong where nothing else competes.

**D-UX-5 Where a tool's options live.** A puts the typed value and options in a **command bar**
on the canvas. B puts a **Measurements box** there and keeps a tool panel on the right.

- **Recommend:** one **command bar** at the canvas foot, holding the tool, its prompt, the typed
  value with its evaluated result, and the frequent options (anchor, roll, work plane, join
  ends and the corner rule).
  - Long forms go to the **right column, above the inspector**, while their tool is active:
    Connect's picks, face and pivot fields, and the box frame form.
  - The step summary is a toast plus the status bar's last step, not a persistent "After the
    last step" panel.
- Why: it is SketchUp's Measurements-box model, which the draw tool already follows (A §7,
  B §2). A one-line bar cannot hold a face joint's twelve fields, and the right column can
  without pushing the inspector off screen (U38).

**D-UX-6 The start card's contents.**

- **Recommend** the card that shows in the viewport on an empty project. It is not a modal, and
  Esc closes it.
  - A **project strip**: the catalogs named, with their counts of bars and items. Built-in
    catalogs can be added with one click. When no catalog holds a profile, it says so (U13).
    Currency is a select.
  - **Three ways in**, side by side (B):
    1. a **box frame**, the `addFrame` form of D-UX-8;
    2. **the first bar**: profile chips with a required finish, which arm the palette and
       write the choice as `defaults.bar`, as one `setProject` step (A's "use for drawing and
       make default"); then a three-step coach strip that ticks on real events;
    3. **an example**: the skill's worked example, a Forseti work table, loaded as one step
       (D-UX-25).
  - Links to the shortcuts and the guide.
- Why: A's setup steps and B's three ways are the same card read from two sides. Writing
  `defaults.bar` fixes U28 for every later session too.

**D-UX-7 `alukit new` without `--catalog`.**

- Options:
  - (a) keep `std` and say what is missing;
  - (b) default to `std` plus `forseti`;
  - (c) ask interactively.
- **Recommend (a).** `alukit new` prints "no catalog here sells T-slot profile; add one with
  `--catalog forseti`", and the start card offers it.
- Why: making one vendor the default in a public tool is a product call bigger than UX, and the
  card fixes the dead end without it. (c) breaks scripted use.

### Building

**D-UX-8 Frame templates.** A has a box frame tool (`G`). B has templates as command-batch
generators, with `alukit template <name>`.

- **Recommend one core command, `addFrame`**, with three entry points:
  - the `G` tool;
  - the start card;
  - `alukit add frame`, as sugar over `alukit do`, like `alukit add bar`.
- **Recommend outside faces flush** (A Q6): the typed W × D is the frame's footprint, as the cart
  and the skill's example draw it. Ship the **box frame only**, with base and top rings, an
  optional shelf ring and posts, and a `params` switch that writes W, D and H as params.
- Why a command rather than a generator:
  - it predicts no ids (the batch names bars it creates);
  - it dry-runs like any command;
  - the skill's reference documents it automatically (§7.5);
  - Undo takes it back as one step, which `mirror` and `array` already do for the entities they
    create.
- Other templates wait for the owner's list (B Q2; §7).

**D-UX-9 The corner rule** (design call 6, open; A Q1; B Q7).

- Options:
  - (a) keep the rule and add Flip only;
  - (b) a per-project `defaults.corner`, which `autoConnect` reads, with a per-call `prefer`;
  - (c) change the global default.
- **Recommend (b).**
  - The values are `vertical` (today's rule and the default, so no document or script changes),
    `x`, `y` (the bar along that world axis runs through) and `first` (lowest id). A bar that
    passes through the point still wins first, as today.
  - The rule is made visible in three places:
    - while drawing, a joint preview with `Tab` to flip it (S5.6);
    - joint markers (S3.5);
    - a corner inspector with arrangements compared by cut length and a **Flip** (S5.5).
  - The box frame asks for the rule.
- Why: Onshape treats corners as first-class, with a default corner type, per-corner overrides
  and a flip arrow (A §4). Changing the global default would silently change what every existing
  script builds.

**D-UX-10 What a corner is** (A Q5). Corners are not entities.

- **Recommend:**
  - A corner is a point where two or more bar ends meet, or where an end meets another bar's
    line. It is derived in the browser from the view model, as a pure, unit-tested function
    (`corners.ts`).
  - Its state is *joined* (every end there is claimed by a connection), *open* (some end is not
    claimed) or *failed* (a connection there has an error).
  - The selection may hold `corner:<key>`.
  - The outline's Joints group lists corners, each with its connections. Connections at no
    corner (face joints, mid-bar butts) go under "Other connections".
- Why: the data is already in the view model (`ends.*.by`, the placed points; B R9), and the
  document needs no new entity.

**D-UX-11 Previews: a server dry run, or the browser** (A Q2, A2; B Q3).

- Options:
  - (a) `dryRun: true` on `POST /api/commands`, with `alukit do --dry-run`;
  - (b) running derive in the browser.
- **Recommend (a).**
  - A dry run applies, derives and answers in the command queue, against the current revision.
  - It writes nothing, adds no step and broadcasts nothing.
  - It answers the diagnostics the step would add, the ids it would create, and the derived
    effects: cut lengths that move, ends claimed, entities a cascade would remove.
- Why: §4.5's rule must stay in one place (m4b decision 5). The browser does not read catalogs
  (m4a decision 30). Nothing is written, so §7.1's "a tab holds no unsaved state" holds. Uses:
  - the joint preview (debounced, sent only when the snapped end changes);
  - the corner arrangements;
  - Delete's cascade list;
  - the box frame's numbers.

**D-UX-12 Where the problem model lives** (B §5.4, Q4).

- Options:
  - (a) the browser merges `/api/check` and `/api/order`;
  - (b) a core module, `alukit.problems/1`, served at `GET /api/problems` and printed by
    `alukit problems`.
- **Recommend (b)**, grouped by consequence (blocks the order, errors, warnings, notes), with
  **no change to the severities** `alukit check` reports.
- Why:
  - The fixes need what only core knows, such as which finishes an offer sells.
  - Plain words keyed by `code` then exist once, and `alukit` reads better too (B §5.1,
    principle 5).
  - Agents get the same list and the same fix batches.
  - Vitest can cover it without a browser.
  - Changing severities would move goldens.

### Editing and history

**D-UX-13 Delete, with cascade.**

- **Recommend:**
  - `Delete` or `Backspace` in Select (when nothing is typed), and a button in the inspector.
  - An unreferenced selection is removed at once, as one step, with an Undo toast.
  - A referenced one opens a dialog listing what goes, in words and from a dry run of
    `removeEntity {cascade: true}`, with "Delete all n" or Cancel.
  - A pattern copy offers "Leave this copy out" (`setPattern` skip), since `removeEntity` refuses
    copies.
  - A multiple selection is one batch.
- Why: A and B agree. The dry run shows the exact cascade, which can go beyond the direct
  referrers that a refusal lists.

**D-UX-14 Undoing another source's step** (B Q6).

- Options:
  - (a) label only;
  - (b) label, and confirm once per session;
  - (c) refuse unless the step is named.
- **Recommend (b).** The button always says whose step it is ("Undo · claude: add bar b13").
  When the step is another source's, Ctrl-Z or the button asks once: "This step was claude's,
  40 s ago. Undo it?", with "don't ask again this session".
- Why: the history is shared by design (§7.1). The surprise is undoing unknowingly (U17), not
  undoing at all.

**D-UX-15 Restore last good** (B Q5).

- **Recommend:** confirm first, saying what is lost. The server then **keeps the rejected file**
  as `.alukit/rejected/<UTC time>.json` before it writes, and the dialog names that file.
- Why: it is the one action in the app that can lose a person's typing (U23), and the fix is a
  small server change.

**D-UX-16 Place on click** (A Q3).

- **Recommend:**
  - The click commits at the hovered station, as one step.
  - A value typed before the click (in the command bar) sets the distance, and Enter commits
    there.
  - No amend-after-commit (SketchUp's "type again to change the last op") in this round.
- Why: it matches Draw (type, then commit) and halves the steps (U39). Amending a step after it
  commits needs a server rule for replacing the last step, which races with agents (§7).

**D-UX-17 Typed input** (B R10; Q8).

- **Recommend:** the command bar takes expressions in `#core/expr.ts`'s grammar, params, `mm`,
  `cm` and `m`, a sign, and `[x, y, z]` as an absolute start point.
  - A plain number is written as a number, so draw.spec's document is unchanged.
  - An expression is written into the document, so params keep driving the bar.
  - Inches wait (§7).
- Why: the document takes an expression wherever it takes a number. The project's catalogs are
  metric.

**D-UX-18 Keys.** A gives Pattern `X` and B gives it `T`, and A uses `T` for the sheets.

- **Recommend:**

  | Key | Does |
  |---|---|
  | `X` | Pattern |
  | `G` | Box frame |
  | `/` | Catalog |
  | `?` | Help: keys, the snap legend, the guide, "show the start card" |
  | `Delete`, `Backspace` | Delete the selection (in Select, nothing typed) |
  | `→ ← ↑` | Lock the draw axis to X, Y, Z |
  | `Space` | Chain the next bar from the last end |
  | `Tab` | Flip the previewed joint, only while a gesture is live; Esc ends the gesture, so it is no keyboard trap |
  | `T`, `Shift+T` | Collapse the sheets; maximize them |
  | Esc | Steps back one level: last pick, gesture, tool, then selection |

  A setting switches single-letter keys off (U65).
- Why: `X` reads as "×4" copies (A F4). B's `?` would both reopen the card and show the keys, and
  one Help overlay does both.

**D-UX-19 Edits while a variant is shown** (A Q4; design call 35).

- **Recommend:** keep writing to the document as written. Add a strip under the top bar:
  "Viewing *tall*. Edits go to the base document. [Back to default]". Editing a variant's
  overrides waits (§7).

**D-UX-20 "Step n" in the app.**

- **Recommend:** the app says **Step n** for the history counter, and "Saved as *Quote 1*" or
  "Not saved" for named revisions (B F3). The CLI's human text keeps `rev n`, and every API and
  JSON field keeps `rev`.
- Why: it ends the clash on screen without changing a contract scripts read. The leftover
  wording gap between app and CLI is accepted.

### Look

**D-UX-21 Theme.**

- **Recommend:**
  - Follow `prefers-color-scheme`, dark when the system says nothing, with a manual switch
    remembered per browser (C §4.1).
  - `alukit snapshot` pins **dark** unless `--theme light`.
  - The e2e config pins `colorScheme: "dark"`. Playwright's documented default is light, so
    without it every test, and every snapshot a test makes, would switch theme.
- Why: deterministic images, and no surprise in tests.

**D-UX-22 The font.**

- Options:
  - (a) system fonts with `tabular-nums`;
  - (b) **IBM Plex Sans and Plex Mono**, self-hosted.
- **Recommend (b).**
  - Use pinned `@fontsource` packages (the repo pins every dependency exactly), Latin and Latin
    Extended, Sans 400/500/600 and Mono 400, bundled by Vite into `dist/` and served from the
    app's own origin. No CDN.
  - **The CSP needs no change** (read: `default-src 'self'` with no `font-src` allows fonts
    from the origin).
  - Vite must never inline a font as a `data:` URI, which the same CSP refuses. Set
    `build.assetsInlineLimit` to a function that returns false for `.woff2` (read: Vite 8.4.0's
    types accept one).
  - Snapshot mode waits for `document.fonts.ready` before it says "ready".
  - The README credits the fonts' OFL licence.
- Why: C measured equal digit advances in all three cuts, and the same glyphs on every OS keep
  screenshots stable.

**D-UX-23 Three encodings in the 3D view.**

- **Hover:** C's pale amber tint (lerp 45 % toward `#FFD29A`), not B's non-orange outline. Hover
  previews what a click selects, and the strong amber with x-ray stays the selection's alone.
- **Snaps:** C's shapes, from AutoCAD's AutoSnap:
  - filled square: node or bar end;
  - triangle: face centre;
  - diamond: on a line;
  - cross: grid;
  - open ring: free;
  - plus B's ⊕ for a part datum, apart from face centres.
  - Each keeps its name in the hint.
- **Joints:** markers encode **state** (A): filled for joined, hollow for open, ✕ for failed,
  each with a colour. The connection type (B's ⊥ ⟋ ‖ ⟳ ⊕) goes in the hover label and the
  inspector.
- Why: one meaning per shape and colour (C's rule). State is what a person scans for.

**D-UX-24 Export colours.**

- **Recommend:** the GLB's colours **do not change** in this round. The viewer gets its own
  display palette from the tokens, and `src/mesh/style.ts` keeps the export palette as it is.
- Why: `alukit export glb` and the app's export stay byte-identical to today's (a
  `glb.test.ts` claim), and C's new finish tones apply on screen only (C §5.1 allows either).

### Scope

**D-UX-25 The example in the start card.**

- **Recommend:** load the **skill's worked example** (a Forseti work table, `skills/alukit/
  SKILL.md`) as one batch, parsed from the skill by `src/cli/skill-example.ts`'s parser, so it
  cannot drift. B's "lab cart on shipped catalogs" waits.
- Why: it already runs as a test, and it uses only shipped catalogs. The fixture cart uses
  synthetic ones (B §4.3).

**D-UX-26 What waits.** **Recommend** accepting §7's list as this round's cut: the Compare
variants sheet and its endpoint, more templates, the costly render passes, amend-after, and the
rest.

## 4. Backend and CLI additions

Each keeps §7's parity rule: the app and the CLI gain it together. **Size:** S is up to a day, M
two to four days, for one implementer (inferred).

| # | Addition | CLI form | Used by | Size |
|---|---|---|---|---|
| BE-1 | **`setProject`**: an RFC 7396 merge patch over `name`, `catalogs`, `currency`, `price_basis`, `fx`, `defaults` (bar, butt, cutting, corner) and `order_rules`. It is one step and validated like any command. A catalog a command adds must be a built-in id or a folder inside the project; a folder elsewhere stays a hand edit, applying §7.2's confinement to a path a request names | `alukit do <dir> '[{"cmd":"setProject","args":{"catalogs":["std","forseti"],"currency":"BRL"}}]'` | start card, project settings, "As default" fixes | S |
| BE-2 | **Dry run**: `dryRun: true` on `POST /api/commands` (today the strict body schema refuses the field with a 400; read). It runs in the queue against the current revision. It answers `{ok, dry: true, created, diagnostics: {new}, effects: {cuts: {b1: [800, 820]}, removed: [...], claimed: [...]}}`, and writes, logs and broadcasts nothing | `alukit do <dir> --dry-run [--json]` | joint preview, corner arrangements, Delete's cascade list, box frame numbers | M |
| BE-3 | **Problems**: `src/core/problems/` merges the check's diagnostics, the order's reasons, open items and unconnected ends into `alukit.problems/1`, grouped by consequence. Each problem carries plain words keyed by `code`, its targets and its fixes (command batches or named forms). The answer also carries the order's summary | `GET /api/problems?variant=&as_of=`; `alukit problems <dir> [--variant v] [--as-of d] [--json]`, which exits 1 when something blocks the order or is an error | readiness pill, Problems sheet, badges in 3D, Order's to-resolve rows | M–L |
| BE-4 | **Step words**: `CommandDef` gains `describe(args, result)`. Log entries, `hello`/`rev` events and undo/redo info gain `text` ("draw bar b12, joined at 1 end"), and `what` stays | `alukit log` prints the words; `--json` keeps `what` and adds `text` | Undo button, toasts, History | S–M |
| BE-5 | **Corner preference**: `autoConnect` takes `prefer: "vertical" \| "x" \| "y" \| "first"`, and reads `defaults.corner` when it is absent. The default is `vertical`, today's rule. The `Defaults` schema gains `corner` | through `do`; through `setProject` for the default | draw tool, joint preview, box frame | S |
| BE-6 | **`addFrame`**: `{at, size: [W, D, H], item, opt, corner, rings: ["base","top"], shelf_mm?, connector?, qty?, params?: true}` creates the bars, the butts and, when asked, the params, in one apply | `alukit add frame <dir> --at 0,0,0 --size 1000,600,800 --item forseti:PF40-01 --opt finish=anodised [--corner vertical] [--rings base,top] [--shelf 300] [--params]` | `G` tool, start card | M |
| BE-7 | **Option wording**: `option-not-sold` with no option chosen says "sold only with finish anodised or black; choose one", and the check's `no-offer` names the sold values instead of `[]` | `alukit order`, `alukit check` read the same | first run | S |
| BE-8 | **Search ranking**: a tier for items whose own size matches a size query (a bar's section W × H) above items that only mention the size, and a `prefer` kind hint that ranks that kind first within a tier | `/api/catalog/items?prefer=bar`; `alukit catalog search <q> [--prefer bar]` | catalog overlay | S |
| BE-9 | **Restore keeps the rejected file** as `.alukit/rejected/<UTC time>.json`; the answer names it | (restore is the app's) | read-only banner | S |
| BE-10 | **`--as agent:<name>`** passes through as the source. A bare name stays `cli:<name>` | `alukit do`, `add`, `undo`, `redo` | agent presence | S |
| BE-11 | **Snapshot theme**: `--theme dark\|light`, dark by default, passed to the page as `?snapshot=<view>&theme=` | `alukit snapshot <dir> --view iso --theme light -o x.png` | D-UX-21 | S |
| BE-12 | **Catalog list price**: list entries gain `from`, the lowest regular price per metre (bars) or per unit, in the offer's currency | `alukit catalog search --json` gains the field | catalog overlay | S |
| BE-13 | **Fonts and the CSP**: no change (read). An e2e check confirms the bundled font loads with no CSP refusal | — | D-UX-22 | S (a check only) |

Nine are small (BE-1, 5, 7, 8, 9, 10, 11, 12, 13), BE-4 is small to medium, and three are medium
or larger (BE-2, BE-3, BE-6). `GET /api/diff` for comparing variants is deferred with the Compare
sheet (§7); `alukit diff` already does the job.

## 5. Streams

### 5.1 The shape

The coordinator's sketch had four streams. This plan has six, for two reasons:

- **S0, the contracts**, lands first. It is one short refactor with no visible change. It
  freezes the seams and splits the shared files (one 14 KB stylesheet, one 24 KB drawer, the
  e2e specs that mix concerns), so the parallel streams stop meeting in the same lines.
- **S5, editing and tools**, comes out of the sketched S2. `tools.ts` (30 KB), `ToolPanel.tsx`
  (25 KB) and `Properties.tsx` are one cluster, and `App`, `TopBar`, `Tree`, `Catalog` and the
  drawer are another. One implementer holding both would carry about twice any other stream.
  The **Problems sheet** and **Records** move to S4 with every other sheet's contents, so
  `ProblemRow` lives in one stream with the Order's to-resolve rows that reuse it.

| Stream | What | Tasks | Load |
|---|---|---|---|
| S0 | Contracts: seams, file splits, test moves | 8 | 1–2 days, one implementer, before the rest |
| S1 | Core, server, CLI: the bugs in core and the additions of §4 | 14 | 10 S, 1 S–M, 2 M, 1 M–L |
| S2 | App shell and IA: layout, sheets container, bin and catalog, outline, top bar, status bar, presence, Show, start card, settings, help, a11y shell | 17 | 7 S, 2 S–M, 8 M |
| S3 | The 3D view: rendering, hover, labels, corners and markers, Show in 3D, badges, ground, colour by item | 13 | 5 S, 4 S–M, 4 M |
| S4 | Visual system and sheet contents: tokens, fonts, formats, tables, order, problems, records, icons, light theme | 12 | 5 S, 1 S–M, 6 M |
| S5 | Editing and tools: inspector, Delete, corner inspector, command bar, keys, joint preview, box frame, place, connect | 11 | 5 S, 1 S–M, 4 M, 1 M–L |

### 5.2 S0: the contracts (first, alone)

**Rule:** no visible change. Every e2e test passes with no assertion changed, apart from the
moves listed here and the hint-to-`snap` switch.

| Id | Task |
|---|---|
| S0.1 | Split `src/ui/style.css` into `src/ui/styles/{tokens,base,shell,viewport,tools,inspector,tables}.css`. `tokens.css` defines today's colours, sizes and fonts as custom properties (§5.3), and every literal colour elsewhere becomes a `var()`. Check: screenshots of five states (cart, a selection, the order tab, the draw tool, read-only) differ by 0 px from before |
| S0.2 | Add `src/ui/theme/tokens.ts` (the same values as numbers, for three.js) and `src/ui/theme/theme.ts` (a `theme` signal). The viewer reads display colours from `tokens.ts`; `src/mesh/style.ts` keeps the export palette (D-UX-24). Check: `snapshot.spec` images and `glb.test.ts` are unchanged |
| S0.3 | Add the seam modules, each starting with today's behaviour: `src/ui/focus.ts` (selection moved out of `store.ts`, which re-exports it; `hover`; `shown`), `src/ui/palette.ts` (moved out of `tools.ts`), `src/ui/keys.ts` (a key router with today's bindings), `src/ui/hook.ts` (`extendHook`, so each stream adds its own `__alukit` fields), and `src/ui/client/{problems,dryrun}.ts` (typed stubs that answer "not available yet") |
| S0.4 | Add the new methods to the `Viewer` interface as no-ops (§5.3). Extract `Viewport` from `App.tsx` to `src/ui/viewport/Viewport.tsx` with overlay slots, and the view buttons from `ToolPanel.tsx`'s `Toolbar` to `src/ui/viewport/ViewControls.tsx` |
| S0.5 | Split `Drawer.tsx` into `src/ui/sheets/{Sheets.tsx,registry.ts}` (the container) and `src/ui/tables/{CutList,Bom,Machining,Order,Costs,Checks,History}.tsx`. Split `Records.tsx` into `src/ui/records/{OpenItems,Params,Decisions}.tsx` |
| S0.6 | Write `src/core/problems/types.ts` (types only) and a hand-made `tests/fixtures/ux/problems-cart.json` transcribed from the cart's `alukit check --json` and `alukit order --json`. Add minimal versions of `src/ui/problems/ProblemRow.tsx`, `src/ui/common/EntityChip.tsx` and `src/ui/format.ts` (today's formats), stubs for `src/ui/corners.ts` and `src/ui/targets.ts`, a `problems` signal in `store.ts`, and a `toolPrompt` signal in `tools.ts` |
| S0.7 | Make the tests robust to wording. `__alukit.tool()` gains `snap`, the machine label that today's hint shows (`end b1.b`, `grid (0, 0, 0)`, `on b1 at 100`), and `draw.spec` reads `snap`, not `hint`. Move these tests: from `tools.spec`, "looks from standard views…", and from `topbar.spec`, "the section plane…", into a new `view.spec.ts`; from `canvas.spec`, "the cart draws its bars" to `view.spec`, "the tools snap to the project's own items" to `tools.spec`, and "the catalog browser lists the project's own items" to a new `catalog.spec.ts`. Rename what is left of `canvas.spec` (selection and properties) `inspector.spec.ts` |
| S0.8 | Pin `colorScheme: "dark"` in `playwright.config.ts` (D-UX-21). Nothing changes visually today: the app has no light theme yet |

### 5.3 The interfaces between streams

S0 creates each of these, and afterwards only its owner changes it, and only by adding. The
shapes below are the contract; S0 writes them as code.

**Selection, hover and Show**: `src/ui/focus.ts` (owner S2).

```ts
type Ref = string; // b1, c3, p2, pt1, n4, r1, b1.a (an end), b26@1 (a copy), forseti:PF40-01 (an item),
                   // O1 (an open item), corner:<key>, supplier:<id>
selection: Signal<ReadonlySet<string>>;             // as today; may hold corner:<key>
hover: Signal<{ ids: readonly string[]; from: "view" | "row" | "chip" | "tree" } | undefined>;
shown: Signal<{ refs: readonly Ref[]; problem?: string; field?: string; isolate: boolean; n: number } | undefined>;
select(ids, mode: "replace" | "toggle" | "add"): void;
show(req): void;  // select, frame, pulse (S3), reveal in the outline (S2), point the inspector at `field` (S5)
clearShow(): void;
```

Each region reacts to the signals on its own. No stream calls into another's components.

**Targets and corners**: `src/ui/targets.ts` and `src/ui/corners.ts` (owner S3). Both are pure,
and unit-tested with the cart's view model.

```ts
resolveTargets(m: Model, refs: readonly Ref[]): { ids: string[]; points: V3[]; box?: [V3, V3] };
// an end → its bar and a point; a copy → itself; a connection → its bars and fasteners;
// an item → the bars and parts of its BOM line's sources; a supplier → its lines' sources;
// an open item → its scope; a check with no entity → the whole model
interface Corner { key: string; at: V3; ends: string[]; bars: string[]; connections: string[];
                   state: "joined" | "open" | "failed"; through?: string }
cornersOf(m: Model): Corner[];
```

**Viewer additions**: the `Viewer` interface in `src/viewer/scene.ts` (owner S3). S0 adds them as
no-ops.

```ts
setHover(ids: ReadonlySet<string>): void;       onHover(cb: (id?: string) => void): void;
setGhost(keep: ReadonlySet<string> | undefined): void;   pulse(ids: ReadonlySet<string>): void;
fitBox(box: [V3, V3]): void;                    setCorners(c: readonly Corner[]): void;
setProblemBadges(b: readonly { ids: string[]; severity: "block" | "error" | "warn" }[]): void;
setColourBy(mode: "finish" | "item", swatches?: ReadonlyMap<string, number>): void;
setTheme(t: ViewTheme): void;                   onRender(cb: () => void): () => void; // DOM overlays
setLabel(key: string, at: V3 | undefined, text?: string): void; // tool labels (S5's joint preview)
```

**The problem model**: `src/core/problems/types.ts` (owner S1). S4, S2 and S3 build against the
S0 fixture until BE-3 merges.

```ts
interface ProblemsAnswer { schema: "alukit.problems/1"; rev: number; variant: string | null; as_of: string;
  order: { status: "READY" | "BLOCKED" | "EMPTY"; blocks: number; warnings: number }; problems: Problem[] }
interface Problem {
  id: string;                    // stable while the problem lasts: code + targets + supplier
  code: string; rule?: string;   // the diagnostic's or the order rule's code, shown small, for parity
  group: "blocks-order" | "error" | "warning" | "note";
  title: string; detail: string; // plain words, keyed by code: "No finish chosen for b1 Post, b2 Rail"
  raw: string;                   // the CLI's message
  suppliers?: string[]; targets: Ref[]; field?: string;   // "opt.finish": where the inspector points
  fixes: Fix[]; from: ("check" | "order" | "open")[];
}
type Fix = { label: string } & (
  | { kind: "commands"; commands: { cmd: string; args?: unknown }[] }   // one step
  | { kind: "resolve-open"; open: string } | { kind: "set-price"; item: string }
  | { kind: "param"; param: string } | { kind: "lock-update"; item: string });
```

**Tokens**: `src/ui/styles/tokens.css` and `src/ui/theme/tokens.ts` (owner S4).

- The names are fixed in S0, with today's values; S4 changes values only.
- Colours: `--bg-app`, `--bg-panel`, `--bg-raised`, `--bg-well`, `--line`, `--line-strong`,
  `--text-1`, `--text-2`, `--text-3`, `--sel`, `--sel-text`, `--sel-ink`, `--act`,
  `--act-fill`, `--tool`, `--ready`, `--blocked`, `--warn`, `--info`.
- Fonts and type: `--font-sans`, `--font-mono`, `--fs-{display,title,figure,body,small}` with
  their `--lh-*`.
- Spacing: `--sp-{1..8}`. Radii: `--radius-control` and `--radius-card`. Also `--shadow-float`,
  `--row-h-{cut,order,table,compact}` and `--focus-ring`.
- Light values live under `:root[data-theme="light"]`.
- `tokens.ts` exports `viewTheme(theme): ViewTheme` (background stops, fog, lights, body and edge
  colours, selection, hover, tool, status colours, grid) and `itemSwatches(model)`.
- **Rule:** no hex colour outside the tokens. S4 adds a unit test that searches `src/ui` and
  `src/viewer` for hex literals.

**Formats**: `src/ui/format.ts` (owner S4). It exports `mm`, `deg`, `kg`, `kgPerM`, `money`,
`qty` and `group`, each with `{ table?: boolean }`. Every number on screen goes through it.

**Sheets**: `src/ui/sheets/registry.ts` (owner S2).

- `registerSheet({ id, title, badge(), Body })`. S4's tables register themselves, so the
  container never imports them.
- `activeSheet` and `openSheet(id, { maximize? })`.
- `selectionOnly`, which every table honours.

**The inspector slot.**

- `src/ui/inspector/Inspector.tsx` (S5) renders S2's `src/ui/shell/ProjectPanel.tsx` when
  nothing is selected.
- `App.tsx` (S2) places S5's `ToolForm` and `Inspector` in the right column.
- S5 exports `toolPrompt` for S2's status bar.

**Viewport slots**: `Viewport.tsx` (S3) renders the canvas, its own DOM overlays (hover label,
callouts, legend, gizmo) and these slots:

- `left`: S5's tool rail;
- `centre`: S2's start card;
- `bottom`: S5's command bar above S2's status bar;
- `topRight`: S2's toasts.

**Keys**: `src/ui/keys.ts` (owner S2). `onKey(scope, handler, priority)`. Each stream registers
its own keys from its own files. The text-entry guard lives here, in one place.

**Clients**: `src/ui/client/**` (owner S1). These are the typed calls to S1's new endpoints:
`fetchProblems`, `dryRun`, and the catalog list's `prefer`. A stream that needs an endpoint
calls these and never writes its own `fetch`.

**testids**: every `data-testid` the e2e suite uses stays on whatever element takes over its job.
For example, the bin's "Browse catalog…" button keeps `left-catalog`, the inspector's root keeps
`properties`, the order sheet keeps `order` with `data-rev`, and the supplier cards keep
`data-supplier`. A stream renames one only in a spec it owns.

### 5.4 Who owns which files

Each path has one owner. A stream may read anything, and changes only what it owns. When its
change breaks another stream's spec, it makes the **smallest** selector or text fix in that spec,
in the same pull request, and names it there. **A semantic assertion is never weakened.**

| Path | Owner |
|---|---|
| `src/core/**` (problem types: additive only after S0), `src/catalog/**`, `src/server/**`, `src/cli/**`, `src/export/**`, `src/ui/client/**`, `skills/alukit/SKILL.md` (regenerated), new fixtures under `tests/fixtures/` (existing goldens untouchable) | **S1** |
| `src/ui/App.tsx`, `TopBar.tsx`, `Tree.tsx` (to `src/ui/outline/`), `Catalog.tsx` (to `src/ui/catalog/`), `store.ts`, `api.ts`, `sse.ts`, `focus.ts`, `palette.ts`, `keys.ts`, `hook.ts`, `options.ts`, `steps.ts`, `src/ui/sheets/**`, `src/ui/records/Params.tsx`, `src/ui/shell/**` (StatusBar, Toasts, StartCard, Help, ProjectPanel, Settings, ReadOnly), `styles/shell.css`; `README.md` and `docs/guide.md` | **S2** |
| `src/viewer/scene.ts`, `overlay.ts`, `views.ts`, `src/mesh/bars.ts`, `src/mesh/style.ts` (export palette frozen), `src/ui/viewport/**`, `corners.ts`, `targets.ts`, `styles/viewport.css`, `docs/images/cart-iso.png` | **S3** |
| `src/ui/theme/**`, `styles/{tokens,base,tables}.css`, `format.ts`, `src/ui/common/**`, `src/ui/icons/**`, `src/ui/tables/**`, `src/ui/problems/**`, `src/ui/records/{OpenItems,Decisions}.tsx`, `package.json`, `pnpm-lock.yaml`, `vite.config.ts`, `playwright.config.ts`, `index.html` | **S4** |
| `src/ui/tools.ts` and `ToolPanel.tsx` (to `src/ui/tools/**`: state, CommandBar, ToolRail, forms), `Properties.tsx` (to `src/ui/inspector/**`), `Feedback.tsx`, `src/viewer/draw.ts`, `snap.ts`, `workplane.ts`, `interaction.test.ts`, `src/ui/tools.test.ts`, `styles/{tools,inspector}.css` | **S5** |
| `docs/design.md`; decision notes are written per stream as `docs/notes/ux-sN-decisions.md` | the coordinator folds them in |

The e2e specs, after S0's moves:

| Spec | Owner |
|---|---|
| `security.spec.ts` | S1 |
| `live`, `readonly`, `topbar` (variant, export, revisions), `dev`, `catalog`, and new `first-run`, `presence`, `show`, `layout` | S2 |
| `view` and `snapshot` | S3 |
| `outputs`, `records`, and new `tables`, `problems`, `theme` | S4 |
| `draw`, `connect`, `tools`, `inspector`, and new `edit`, `frame`, `corners`, `keys` | S5 |

A dependency added to `package.json` goes through S4, so the lockfile has one writer.

### 5.5 S1: core, server and CLI

**Owns:** see §5.4. **Must not touch:** `src/ui/**` other than `src/ui/client/**`,
`src/viewer/**`, `src/mesh/**`, or any spec other than `security.spec.ts`. It must not move a
golden value. The only CLI human output it changes is the option wording (BE-7) and `alukit
log`'s words (BE-4).

Drop 1 merges as soon as its gate passes, because S2, S4 and S5 wait on it. Drop 2 follows.

| Id | Task | Fixes | Size |
|---|---|---|---|
| S1.1 | Option wording (BE-7) | U2, U10 | S |
| S1.2 | `--as agent:<name>` (BE-10) | U57 | S |
| S1.3 | Search ranking: the size tier and `prefer` (BE-8); the root cause is in §2.2 | U14 | S |
| S1.4 | `setProject` (BE-1), with catalog paths confined | U13 | S |
| S1.5 | Step words (BE-4) | U16, U17, U18 | S–M |
| S1.6 | Problems: the core module, `/api/problems`, `alukit problems` (BE-3), and the client in `src/ui/client/problems.ts` | U7, U8, U9, U11, U12 | M–L |
| S1.7 | Dry run (BE-2), and its client | U4; D-UX-13 | M |
| — | *Drop 1 ends here* | | |
| S1.8 | Corner preference (BE-5) | U4, U5 | S |
| S1.9 | `addFrame` and `alukit add frame` (BE-6) | U24 | M |
| S1.10 | Restore keeps the rejected file (BE-9) | U23 | S |
| S1.11 | `snapshot --theme` (BE-11) | D-UX-21 | S |
| S1.12 | The catalog list's `from` price (BE-12) | U15 | S |
| S1.13 | Measure `/api/problems` (first pricing, then cached) and a dry run on a generated 1,000-bar project, and record both in the note | §8 | S |
| S1.14 | `pnpm skill` (the reference gains `setProject`, `addFrame`, `prefer`, `problems`); write `docs/notes/ux-s1-decisions.md` | — | S |

**Done when:**

- `alukit order` on a fresh `forseti` project with an option-less PF40-01 prints "sold only with
  finish anodised or black; choose one". Every golden test (G1–G38, the cart's cut list, BOM,
  order and machining sheet) passes unchanged.
- `alukit catalog search 40x40 --catalog forseti` lists a 40 × 40 profile first.
- `alukit do --dry-run` leaves the files' hashes and the log unchanged, and answers the same
  diagnostics as the real run that follows. A server test sends a dry run while another command
  is queued and gets an answer for the revision after it.
- `GET /api/problems` equals `alukit problems --json`, byte for byte (the `server.test.ts`
  pattern). On the cart, its `blocks-order` count equals the blocking reasons `alukit order`
  gives, and every problem's `raw` is a message the CLI prints.
- `setProject` round-trips each field, refuses a catalog folder outside the project (a
  `security.spec` case), and is one undo step.
- `alukit add frame` builds 12 bars and 8 butts with no `unconnected-end`. `prefer` gives the
  three arrangements of a rectangle's corner, each with the cut lengths the hand table says.
- Restore leaves `.alukit/rejected/<time>.json` holding the bad text.
- `--as agent:claude` is logged as `agent:claude`.

### 5.6 S2: the app shell and the information architecture

**Owns:** see §5.4. **Must not touch:** `src/viewer/**`, `src/mesh/**`, `src/ui/{tools,inspector,
viewport,tables,problems,theme,common}/**`, core or server.

| Id | Task | Fixes | Size | Needs |
|---|---|---|---|---|
| S2.1 | Layout: the regions of §1, splitters, the slots of §5.3. It fits at 1280 × 800 and 1440 × 900 with no horizontal scroll | U25, U44 | M | S0 |
| S2.2 | Sheets container: the rail with badges from the registry; collapse, split and maximize, with the size kept per browser; collapsed on an empty project, opening once on the first output; "selection only"; `T` and `Shift+T` | U25, U27 | M | S0 |
| S2.3 | Catalog: the parts bin (items used, armed and recent) and the wide overlay (`/`). The kind facet follows the active tool (`prefer`); rows give full names, kg/m and the `from` price. `options.ts` offers "(project default: X)" only when `defaults` gives X, and otherwise preselects a sold value. Buttons: Use for drawing, Add to bin, Replace selected. State persists when closed, and the card reads in words | U2, U14, U15, U45 | M | S1.3, S1.12 for the extras |
| S2.4 | The palette starts from `defaults.bar`, and is remembered for the tab's session | U28 | S | — |
| S2.5 | Outline: rows read label · item name · cut length. Groups by tag or kind; a Joints group from `cornersOf`; a problem icon (shape and word) on rows; tree role, roving tabindex and arrow keys; reveals and scrolls to the row on Show | U19, U5, U52, U55, U56 | M | S3.4 |
| S2.6 | Top bar: the readiness pill (D-UX-3); Undo and Redo as "who: what" (BE-4) with the cross-source confirm (D-UX-14); "Saved as …" or "Not saved"; a Project menu (settings, revisions, export); the variant strip (D-UX-19) | U7, U16, U17, U32, U36 | M | S1.5, S1.6 |
| S2.7 | Status bar and live region: connection (Live, Read-only, Reconnecting), "Step n · who what · when", the tool prompt, units | U32, U33, U54 | S | — |
| S2.8 | Presence and step summary. `steps.ts` diffs the drawn models (created, removed, cut lengths changed), so every source gets a toast: "claude added b13 (shelf rail) · Show · Undo it", or for the person's own step, "Drew b2, 580 mm · joined to b1: b1 800 → 820". New and changed entities flash; rows are marked "new · claude" until the person's next step; a presence chip | U16, U4 | M | S3 (flash through `pulse`) |
| S2.9 | Show: `focus.show` resolves the targets, selects, asks the viewer to frame, pulse and isolate, reveals the row, and sets the field. The status bar says "Showing problem 1 of 3 · Esc to leave" | U11, U12 | S | S3.6 |
| S2.10 | The start card and the coach strip (D-UX-6), with the example (D-UX-25) | U27, U13, U2 | M | S1.4; S5.7's form |
| S2.11 | Project settings: catalogs, currency, price basis, fx, default bar and finish, kerf and trim, order rules, each through `setProject` | U13 | M | S1.4 |
| S2.12 | Project panel (D-UX-4): First steps, the summary, the params table (from `records/Params.tsx`) | U27 | S–M | S1.6 for the order line |
| S2.13 | Help (`?`): every key, the snap legend, the guide link, "show the start card", the single-letter-key switch; key caps on buttons | U22, U65 | S | — |
| S2.14 | Read-only and restore. The banner always names the entity and field, with a did-you-mean from the schema's keys. A "last good state" label shows on the viewport. Restore asks first and names the kept copy. Disabled controls say why | U23, U33, U34 | S | S1.10 |
| S2.15 | Refusals: a toast with the full text, expand and copy, and "Select the n places". Popovers close on an outside click and on Esc | U30, U31, U66 | S | — |
| S2.16 | Accessibility shell: landmarks and a skip link; tablist and tabpanel semantics on the sheets; every button named; 24 px targets; the 2 px focus ring token | U52, U53, U56, U64 | S–M | S4.1 |
| S2.17 | The README Quickstart and `docs/guide.md` for the new layout and keys, last, after S5 merges; `docs/notes/ux-s2-decisions.md` | — | S | all |

**Done when** (new Playwright specs):

- **`first-run.spec`**, on `alukit new --catalog forseti --currency BRL`:
  - the start card shows, with the catalog line;
  - choosing 40 × 40 and anodised, then Start drawing, arms the palette and writes
    `defaults.bar` as one step;
  - one bar is drawn;
  - `/api/problems` holds no `option-not-sold`.
  - The clicks and keys to an armed, sold profile are counted against A's F1 estimate (about 4
    clicks and 2 keys; inferred there, measured here).
  - On the box frame path, with the order's date pinned, the pill reads READY. If a missing
    connector or price blocks it, the spec names that problem, and the gap goes to the note.
- **`presence.spec`**:
  - `alukit add bar … --as agent:claude` shows a toast naming claude, with Show;
  - Undo reads "Undo · claude: add bar b35";
  - pressing it asks to confirm, and confirming removes the bar in both tabs.
- **`show.spec`**, on the cart:
  - Show on c35's reason selects c35;
  - the camera's target lies in c35's box;
  - the outline row is scrolled into view;
  - Esc clears the isolate.
- **`layout.spec`**:
  - no horizontal scroll at 1280 and 1440;
  - the tool rail is one row or column;
  - the sheets collapse, split and maximize, and the size survives a reload;
  - Tab reaches the tool rail within 5 stops through the skip link.
- **Screenshots**: the empty project against [A 01](img/flows/01-today-empty-project.png) and
  [B E1](img/heuristics/e01-first-run-empty.png); the cart with the pill against
  [A 05](img/flows/05-today-order-blocked.png); the agent toast against
  [A 07](img/flows/07-today-agent-edit.png).

### 5.7 S3: the 3D view

**Owns:** see §5.4. **Must not touch:** `src/viewer/{draw,snap,workplane}.ts` (S5), `src/ui/`
outside `viewport/`, `corners.ts` and `targets.ts`, core or server. **The GLB's bytes must not
move** (D-UX-24).

| Id | Task | Fixes | Size |
|---|---|---|---|
| S3.1 | Quick wins (C R1–R3): `polygonOffset` on every body; the selection tint that keeps shading, with x-ray edges; a hemisphere light and a key light that rides with the camera, low ambient light, fog and the gradient background; edge colour by body lightness, so black profiles show | U50, U49, U46, U48 | S |
| S3.2 | Hover in Select: one raycast per animation frame, the pale tint (D-UX-23), and a label by the pointer (id, item, cut length). `setHover` from rows and chips, and `onHover` out. A single selected bar gets a label at its middle with its cut length and both ends | U35 | S–M |
| S3.3 | Edges: an outline buffer and a detail buffer, lines where flat faces end, and a zoom ramp in perspective. Orthographic views keep the detail edges. `angledGeometry` keeps the groups; cut faces get their own material | U47, U68 | M |
| S3.4 | `corners.ts` (D-UX-10), first, since S2.5 and S5.5 use it. Unit tests: the cart's corners, and an auto-connected ground rectangle with 4 joined and 0 open corners, then 4 open after removing the butts | U5 | S–M |
| S3.5 | Joint markers (D-UX-23) at every corner. Hover and click select `corner:<key>`; a Joints toggle | U5 | M |
| S3.6 | `targets.ts` and Show in 3D: frame while keeping the direction, pulse three times, ghost the rest (C's spec), and a callout at the first target with "◀ n of m ▶", the message and the fixes (S4's compact `ProblemRow`) | U11, U12 | M |
| S3.7 | Problem badges on entities: a tinted outline and a glyph per group, and a Problems toggle | U11 | S–M |
| S3.8 | Tool overlays: snap glyph shapes; the cyan ghost bar and picks; the `setLabel` API for S5's joint preview | U43, U42 | S |
| S3.9 | Ground: a grid sized to the model and fogged, with faint X and Y lines; a clickable axes gizmo, bottom left, that snapshot mode leaves out | U61 | S–M |
| S3.10 | Colour by item, using S4's swatches, with a legend whose entries isolate their item | C R7 | M |
| S3.11 | View controls: icon groups for the views, the projection button named for its action, fit, section, and toggles for joints, problems and colour by | U58, U44 | S |
| S3.12 | The light theme in the viewport, from `viewTheme` | C R16 | S |
| S3.13 | Measure the hover raycast and the frame time on 1,000 bars, on SwiftShader and a real GPU; regenerate `docs/images/cart-iso.png`; after-screenshots; `docs/notes/ux-s3-decisions.md` | §8 | S |

**Done when:**

- **`view.spec`** gains:
  - hovering b2 sets `__alukit.hovered()` to `b2`, and moving off clears it;
  - a bar selected behind another shows selection-coloured pixels inside the front bar's
    silhouette (the x-ray);
  - on a black-anodised bar, edge pixels against the background measure at least 3:1;
  - a rectangle drawn with auto-connect off shows 4 open markers, and `__alukit.corners()`
    agrees with `cornersOf`;
  - Show on c35 puts the camera's target inside c35's box, and ghosting darkens the rest's
    pixels;
  - the legend's entries equal the BOM's items.
- **`snapshot.spec`** passes unchanged: the same state twice gives identical images, and so do
  an ephemeral and a running server. The images themselves change, as expected.
- `glb.test.ts` passes, and `alukit export glb` of the cart is byte-identical to before.
- **Screenshots** at 1600 × 1000 against C's "today" halves:
  [01](img/visual/01-iso-before-after.png), [02](img/visual/02-selection-before-after.png),
  [03](img/visual/03-ortho-front.png) (no flatter than today; C §5.2's rule),
  [05](img/visual/05-ghost-and-hover.png), [07](img/visual/07-closeup-before-after.png).

### 5.8 S4: the visual system and the sheets' contents

**Owns:** see §5.4. **Must not touch:** `src/viewer/**`, `src/mesh/**`, `src/ui/{tools,
inspector,viewport,outline,catalog,shell,sheets}/**`, core or server.

| Id | Task | Fixes | Size |
|---|---|---|---|
| S4.1 | Tokens (C §4): dark and light values, the type scale, spacing, radii, elevation; Plex as in D-UX-22; sentence case; the no-hex unit test. Merge it first: every stream styles with these | U63, U42 | M |
| S4.2 | `format.ts`: one format per quantity; grouping with U+202F, from 4 digits in tables and 5 in running text; dimmed `.00`; units in heads. The decimal point stays the CLI's | U41, U67 | S |
| S4.3 | Common components: `StatusGlyph` (four shapes, a word, a colour); `EntityChip` (selects, hovers in 3D, collapses to +N); `ItemSwatch`; `itemSwatches(model)`, which gives hues by count and avoids amber and cyan | U42, U55 | S |
| S4.4 | The table system: a shared `colgroup` per sheet, sticky heads, row heights, row hover sets `focus.hover`, rows light from `focus.selection`, the selection-only filter, no wrapping rows (they expand instead), and stale answers dimmed with a progress line. The lock stamp moves to the revision popover | U51, U60, U25 | M |
| S4.5 | Cut list: groups by pieces; group heads with stats; Qty, the cut length as each row's figure, end pictograms, machining pills, bar chips; a cutting diagram per stock group | C R9 | M |
| S4.6 | Order & costs: the verdict strip; supplier cards, blocked first; to-resolve rows as `ProblemRow`s; READY cards folded; likely figures with whiskers; then cost lines, totals and the provenance bar. Keeps `data-status`, `data-supplier` and `data-rev` | U7, U9 | M |
| S4.7 | BOM, Machining and History tables in the system | U51 | S–M |
| S4.8 | The Problems sheet and `ProblemRow`: groups by consequence; Show; fixes (commands, or the forms for resolving an open item, setting a price, a param or a lock update); ↑ ↓ and Enter; the open-item add form; the rail badge (blocks and warnings) | U7, U8, U9, U11 | M |
| S4.9 | The Records sheet: Decisions with their add form; History with the words, sources and undone steps | U25, U18 | S |
| S4.10 | Icons: 16 px domain icons for the tools, views and display toggles; words beside them from 1440 px | U44 | S |
| S4.11 | The light theme across the app, with its switch; a contrast test of every text token on every background it sits on | C R16 | M |
| S4.12 | Badges for every sheet ("Cut list 47 pieces", "Order ⛔ 6 to resolve"); `docs/notes/ux-s4-decisions.md` | U7, U25 | S |

**Done when:**

- **`outputs.spec`** (updated) still proves what it proves today:
  - each supplier's status (by `data-status`), its number of reasons and its total equal
    `alukit order`'s, with numbers compared after removing U+202F;
  - the costs totals equal `alukit costs`;
  - the machining holes equal `alukit machining`;
  - CLI edits reach every sheet live.
- **`tables.spec`**:
  - the cut list's "Cut length" column has the same x in every group;
  - hovering a row sets `__alukit.hovered()`;
  - clicking a row selects its entities, and `F` frames them;
  - "selection only" filters every sheet.
- **`problems.spec`**:
  - on the cart, the badge's blocks equal the `blocks-order` problems;
  - Fix "Resolve…" on O2 drops one blocker, as one undo step;
  - a fresh `forseti` project with an option-less bar offers "Set anodised" and "Set black", and
    one click clears the problem.
- **`theme.spec`**:
  - the switch sets `data-theme`;
  - every text token pair is at least 4.5:1 (3:1 for large text) in both themes;
  - `document.fonts.check('13px "IBM Plex Sans"')` is true;
  - no CSP refusal is logged.
- **Screenshots** against C's mockups: the cut list ([08](img/visual/08-cutlist-before-after.png)),
  the order ([09](img/visual/09-order-before-after.png), [10](img/visual/10-order-light.png)) and
  the states ([11](img/visual/11-states-before-after.png)).

### 5.9 S5: editing and tools

**Owns:** see §5.4. **Must not touch:** `src/viewer/{scene,overlay,views}.ts`, `src/mesh/**`,
`src/ui/{viewport,shell,sheets,tables,problems,theme}/**`, `App.tsx`, core or server.

| Id | Task | Fixes | Size | Needs |
|---|---|---|---|---|
| S5.1 | Keys: while a value is typed, letters belong to it (units); Esc steps back one level; `X` for Pattern and `G` for Box frame; the arrow keys lock the axis | U20, U59, U22 | S | S0 |
| S5.2 | Command bar (D-UX-5, D-UX-17): tool, prompt, value with its live result ("W / 2 + 20 = 620 mm, from the end of b1, along +X"), options in one line (an anchor picker on the section's dots, roll, plane, join ends and the corner rule); `Space` chains; `[x, y, z]` starts a bar from the keyboard; Enter at the selected end starts there | U21, U29, U40, U26 | M | S0 |
| S5.3 | Inspector: editable fields. A bar has its length (or "driven by W: edit W"), its profile with Replace (this, these, all like it), its finish from the sold values, anchor, roll, ends, label and tags. A part has its station, distance and roll; a butt its through bar, connector and quantity. Derived values stay read-only with provenance. Problems on the selection show first, and the field in `focus.field` is highlighted. Everything reads as words, not JSON; an id that is no entity is never "a pattern copy" | U3, U18, U19, U12 | M–L | S0 |
| S5.4 | Delete (D-UX-13) | U1 | S | S1.7 for the cascade list |
| S5.5 | Corner inspector: the ends, the connector, and the arrangements with their cut lengths from dry runs; Apply to this corner or to all matching corners, as one batch; Flip; "Join open corners" | U4, U5 | M | S1.7, S1.8, S3.4 |
| S5.6 | Joint preview while drawing: when an end snaps onto another bar, dry-run the gesture and label "will butt on b1 · b1 800 → 820 · Tab: rail runs through". `Tab` flips through `prefer`. A result chip appears after the commit | U4 | M | S1.7, S1.8, S3.8 |
| S5.7 | The box frame tool `G` and `FrameForm` (also used by S2's start card): a corner click, then `W, D`, then the height; rings, shelf, corner rule, connector; numbers from a dry run; one `addFrame` step | U24 | M | S1.9 |
| S5.8 | Place commits on the click (D-UX-16). A pattern copy's hover says "copies take no parts: use b26, the template"; the Pattern template defaults to the selection | U39, U37 | S | — |
| S5.9 | Connect: show every new diagnostic the step made, with those naming the new connection first; check picks against the type before accepting them; pick fasteners and stacks from the bin | U6, U38 | S–M | — |
| S5.10 | Tool rail: S4's icons, key caps, one row at 1280 px; disabled tools say why | U44, U22, U33 | S | S4.10 |
| S5.11 | `docs/notes/ux-s5-decisions.md`, with the keys and tools text for S2.17 | — | S | — |

**Done when:**

- **`draw.spec` passes with its semantics intact**: the drawn base frame's cut list and BOM equal
  the CLI fixture's, byte for byte. The only changes are the ones §5.10 lists.
- **`edit.spec`**:
  - select b1 and set its length from 900 to 950: the cut list changes as `alukit cutlist` says;
  - Replace profile, "all like it", moves the BOM line in one undo step;
  - Delete on an unreferenced bar removes it in one step;
  - Delete on a referenced bar lists what the dry run said, removes exactly that, and Undo
    restores all of it.
- **`frame.spec`**:
  - `G`, a click at the origin, `1000,600` Enter, `800` Enter gives 12 bars, 8 butts and no
    `unconnected-end`;
  - the project's `alukit cutlist` equals that of `alukit add frame` with the same arguments on
    a scratch copy, byte for byte.
- **`corners.spec`**:
  - draw a ground rectangle with auto-connect on, click a corner marker, choose "Rail X runs
    through": the cut lengths equal the dry run's numbers, as one step;
  - Flip and Undo round-trip.
- **`keys.spec`**:
  - `1.2m` while drawing gives a 1,200 mm bar, and the tool is still Draw;
  - `W/2+20` with W = 1200 gives 620;
  - `→` locks X;
  - `Space` chains;
  - Esc steps back one level;
  - `X` opens Pattern;
  - with single-letter keys off, `b` does nothing.
- **`connect.spec`** gains the U6 regression: a Connect that gives b1 a second provider shows
  that error in the panel.
- **Screenshots**: the inspector on a bar against [A 03](img/flows/03-today-drawn-box-readonly.png);
  the joint preview against [B M2](img/heuristics/m2-drawing-feedback.png); the corner inspector
  against [A 10](img/flows/10-proposed-corners.png).

### 5.10 The existing end-to-end tests: what changes

Selectors and words may change. What each test proves may not.

| Spec (after S0) | Owner | What changes | What must still hold |
|---|---|---|---|
| `draw` | S5 | Esc closes the start card first. The palette is set through the overlay (`left-catalog` is kept). It reads `snap` instead of `hint`. The auto-connect check box keeps `draw-autoconnect` in the command bar | the drawn base frame's cut list and BOM equal the fixture's, byte for byte |
| `connect` | S5 | "made c36" becomes the result chip's text; the undo label is in words | the face connection derives as the CLI's; refusals and new diagnostics show in the panel; a pivot is one step |
| `tools` | S5 | the catalog opens through the overlay; Place commits on the click (no `place-apply`); `left-project` is gone | the part lands at the typed distance; a pattern makes 3 copies; Measure reads 900.00 mm and 110.00 mm |
| `inspector` (was `canvas`) | S5 | the empty inspector shows the project panel, not "Select a bar…"; "Checks … 0 errors" becomes Problems' "Every check passes" | tree and box select pick 45; derived values and provenance popovers equal derive |
| `view` (moved) | S3 | `projection` is checked by `aria-pressed`, not the text "Ortho"; the section test moves the mouse off the model before its last screenshot (a hover tint would differ) | the bar count equals derive; standard views; fit keeps the direction; the section changes nothing in the document, and turning it off restores the image exactly |
| `snapshot` | S3 | none (the images change; determinism holds) | identical images for one state; an ephemeral server equals a running one |
| `catalog` (moved) | S2 | `left-catalog` opens the overlay | the project's own items are listed read-only, with their card |
| `dev` | S2 | the tab is "Order & costs" | under Vite it draws, follows a CLI edit and shows the order |
| `live` | S2 | "rev 1" becomes "Step 1"; "Undo addBar" becomes "Undo · e2e: add bar b35"; it adds the toast | both tabs reach the same revision within 1 s; undo in one tab is the server's |
| `readonly` | S2 | Restore asks to confirm; the kept copy exists | an invalid edit makes both tabs read-only with Undo disabled; a valid edit or Restore clears it |
| `topbar` | S2 | revisions sit in the Project menu; the export notice is a toast that keeps `notice` | the variant derives every view; the GLB's bytes equal the CLI's; save and verify show zero drift |
| `outputs` | S4 | verdicts and cards are found by `data-status`; numbers are compared without U+202F; Order and Costs share a sheet; a reason's link is the row's Show | statuses, reason counts and totals equal `alukit order` and `costs`; the machining sheet equals `alukit machining`; edits arrive live |
| `records` | S4 | Open items sit in Problems and Decisions in Records; Params move to the project panel (an S2 cross-edit); undo labels are in words | each record edit is one step that Undo takes back; a refusal shows under its form |
| `security` | S1 | adds the `setProject` folder refusal | every 403 |

## 6. Sequencing

```
S0 contracts ──┬─► S1 drop 1 (S1.1–S1.7) ──────────► S1 drop 2 (S1.8–S1.14)
  (alone,      ├─► S4.1 tokens, S4.2–S4.3 ─────────► S4.4 … S4.12
   1–2 days)   ├─► S3.1–S3.4 (corners first) ──────► S3.5 … S3.13
               ├─► S2.1–S2.5, S2.7, S2.13 ─(drop 1)─► S2.6, S2.10–S2.12 ─► S2.17 docs, last
               └─► S5.1–S5.3, S5.8–S5.9 ─(drop 1)──► S5.4–S5.6 ─(S1.9)─► S5.7
```

1. **S0 lands first, alone**, with the full gate. Everything else forks from it.
2. **S1 runs in parallel; it does not land before the others start.** Each UI stream has days of
   work that needs no new endpoint: the layout, the inspector editing through `setBar`, the
   rendering, the tables. Waiting for all of S1 would idle four streams. S1's **drop 1** is
   prioritised and merged as soon as it passes. The UI streams order their tasks so the ones
   that need it come later (the "Needs" columns), and build against S0's fixture and stubs
   until then.
3. **Merge early within streams:**
   - **S4.1–S4.3** (tokens, formats, common components) as soon as they are done, since every
     stream styles with them. The values change under the other streams; the names do not.
   - **S3.4** (corners), since S2.5 and S5.5 read it.
4. **One merge at a time, each with the full gate.** With five implementers driving Chromium, a
   stream runs locally only the specs it owns, plus `draw.spec` (the critical oracle). The full
   suite runs at the merge. The build's session log records a gate that failed at a load
   average of 50 while three agents ran browsers (read).
5. **Then an integration pass**:
   - S2.17's README and guide;
   - the coordinator folds the stream notes into the design's §8;
   - then phase 4 of the track, a designer review against B's targets: a first bar within 30 s,
     a template frame within 60 s, and a READY order on the template path.

## 7. Not now (v1.1 and later)

| Deferred | Why |
|---|---|
| The Compare variants sheet and `GET /api/diff` (A R13, A3) | `alukit diff` does it today, and comparing is rarer than building, fixing and ordering. The "edits go to the base" strip ships now (D-UX-19) |
| Templates beyond the box frame (rack uprights, a bench, a cube shelf, a cart base; B Q2) | The list is the owner's call. The box frame with an optional shelf ring covers the first-run path |
| The screen-space outline pass, ambient occlusion, the contact shadow, stencil section caps (C R13, R14, R10's shadow) | L effort; AO is not byte-stable and none of them is proven on SwiftShader. Orthographic views keep today's edges meanwhile (C §5.2) |
| Amending a step after it commits (SketchUp's "type again") | It needs a server rule for replacing the last step, which races with agents' steps |
| Editing face and pivot connections in the inspector | The design's v1 limit stands. Butts are editable through the corner inspector |
| Dragging nodes and bar ends | The design's v1 limit (§8) |
| Inch input, a decimal comma | The catalogs are metric, and the CLI prints a point |
| Remappable shortcuts | Single-letter keys get an off switch now (U65) |
| "Undo to here" in History | It needs an atomic undo of n steps on the server |
| Colouring by supplier or by order status | Colour by item and by finish come first |
| Placeholder hatching | The design's v1.1 item, waiting for a texture |
| Bin pins saved in the document | The bin shows used, armed and recent items; pins are a per-browser convenience for now |
| Editing a variant's overrides from the app (A Q4) | Variants stay a derivation of the document as written (design call 35) |
| A checked tutorial beyond the coach strip; a dimension drawn for a failing check in Show (B §5.3) | After the designer review shows whether they are needed |
| `alukit new` asking for a catalog interactively | It breaks scripted use (D-UX-7) |

## 8. Risks

- **`draw.spec` is the oracle, and three changes touch it.**
  - The start card sits over an empty project's viewport.
  - The sheets open by themselves on the first output, which resizes the canvas between bars.
  - The hint's wording changes.
  - S0.7 moves the test to `snap`; the spec closes the card first and recomputes screen points
    after every commit, as it already does. The sheets' first opening must not resize the canvas
    during a gesture.
- **Hover breaks pixel equality.** The section test compares viewport images before and after,
  with the mouse resting on a bar. Snapshot mode must never tint on hover.
- **Theme and fonts in tests.** Playwright emulates the light scheme by default, so S0.8 pins
  dark. Snapshots must wait for `document.fonts.ready`. A `data:` font would be refused by the
  CSP.
- **Pricing per step.** The pill fetches `/api/problems` every revision, which prices the order
  every revision. Its cost at 1,000 bars is unmeasured (B §5.5; S1.13 measures it). The fallback
  is "pricing…" on the pill and a fetch only while the tab is visible.
- **Dry runs under load.** A dry run is a second derive per gesture and must queue like a step.
  Hover-driven previews must be debounced and sent only when the snapped end changes. Also
  measured by S1.13.
- **Work landing in core.** As this plan was written, the main checkout was mid-merge of the F2
  branch (end-hole axis, butt end-face coverage, head seats). F2 changes
  `src/core/project/schema.ts`, `src/core/order/lines.ts`, `src/core/cutlist/format.ts` and the
  cart's expected order and machining sheet (read: `git status`). S0 and S1 fork after that merge
  lands. S1 touches `schema.ts` (BE-5) and the order rules, and its golden checks must use the
  post-F2 values.
- **The size of S0.** Splitting the stylesheet and the drawer is a large mechanical diff. Done in
  parallel with anything it would conflict everywhere, so it goes first, alone, and is proved by
  0 px screenshot differences.
- **Public repository.** The templates, the example and the fixtures must name only shipped,
  public catalogs and generic projects.

## 9. Decisions taken (2026-11-27 03:31)

The coordinator took every recommendation in §3 as written, D-UX-1 to D-UX-26, while the owner was
away. Each stays open to his veto, and the session log lists them under "For Marcio to review
later". The streams build them as specified in §5.
