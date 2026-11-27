# AluKit editing audit: what the 3D view needs to design and edit a frame

*2026-11-27. An audit of what the model can do against what the app lets a person do with it,
then a plan to close the gap. Asked by the owner after he found he could not move a bar: "make
sure to add all the expected UI/UX for the user to actually use the 3D view to design and edit
everything needed". It changes no code. The app was read and run at `b8ff033` (main, after the
UX redesign and its polish pass).*

*Labels: **measured** means seen in the running app (Playwright, headless Chromium) or printed by
the CLI. **Read** means read in the code at `b8ff033`, cited by file. **Inferred** means a
judgement or an estimate. Research claims carry their own label: **docs** (read in the tool's
documentation), **snippet** (seen only as a search result's excerpt of the documentation), or
**inferred** (general knowledge of the tool, not checked here).*

*Being built in parallel, and treated here as done: **(a)** end handles (drag a selected bar's end
along its axis, snap to the bars it meets, auto-attach on release, typed lengths during the drag);
**(b)** click-to-edit on a bar's length label in the view; **(c)** a Move tool (drag a selection
with axis locks and typed offsets, joined ends following or detaching, one step). §5.1 lists what
they leave uncovered.*

## Contents

1. [Summary](#1-summary)
2. [Method](#2-method)
3. [What the model can do, and how the app reaches it](#3-what-the-model-can-do-and-how-the-app-reaches-it)
4. [What a frame designer expects](#4-what-a-frame-designer-expects)
5. [The gap matrix](#5-the-gap-matrix)
6. [Decisions](#6-decisions)
7. [Streams](#7-streams)
8. [Sequencing](#8-sequencing)
9. [Risks](#9-risks)
10. [Later](#10-later)
11. [Calls for the owner](#11-calls-for-the-owner)
12. [Acceptance scenarios for the designer review](#12-acceptance-scenarios-for-the-designer-review)
13. [Sources](#13-sources)

## 1. Summary

**The model is far ahead of the app.** Of the 38 commands, 13 are fully reachable in the app,
8 partly, and 17 not at all (CLI only). The 3D view can select (click, Ctrl-click, Shift-drag
window) and orbit, and its tools can draw, frame, connect, place, pattern and measure. Once
something exists, the view cannot change it. A drag on a selected bar orbits the camera. A
right-click, a double-click and every common editing chord (Ctrl+C, Ctrl+V, Ctrl+D, Ctrl+A, H)
do nothing (measured, §3.3). Everything else is done in the inspector, and the inspector does not
edit a node, a pattern, an end's cut, an offset, a hole, or any connection other than a butt
(measured, §3.2).

**Size of the gap, after (a)–(c):** 62 capabilities a frame designer expects are missing or
partial:

- **12 must**, without which real frames dead-end in the app (three of them are defects);
- **29 should**, which CAD users expect, and which are friction to work around;
- **21 could.**

Of the 41 must and should gaps, 33 are UI work over commands the core already has. 8 need core
changes: one new command (`transform`, medium to large) and small or medium changes to
`autoConnect`, the problems, the corner arrangements and the query selectors.

**Found while running it** (§3.4). Four defects:

- After a frame is made from the start card, Draw says "no bar in the palette".
- An end that a joint claims reads "open: nothing joins it".
- An angled brace dead-ends in an error that has no fix.
- The problem list offers a "Join" fix that the core then refuses.

**The ten biggest missing capabilities:**

1. A **right-click context menu** and one **action registry**, so that every edit has a mouse
   path and a key, and the help lists both.
2. **Duplicate with an offset** (Ctrl+D), with typed arrays (`4x`, `/4`) as plain copies. The core
   has `array`; the app has no copy at all.
3. **Mirror.** The core has `mirror`; the app has no path to it.
4. **Rotate a selection** about an axis, with a typed angle. No command exists for it.
5. **End treatments.** Declare an angled or square cut, extend an end, stop an end at a face.
   Without them a diagonal brace ends in an error the app cannot fix (measured,
   [04](img/editing-audit/04-brace-angled-end.png)).
6. **Edit a live pattern**: pitch, count, skips, explode. All are read-only today
   ([02](img/editing-audit/02-pattern-read-only.png)).
7. **Edit face, pivot, mitre and splice connections** after they are made. Only butts are
   editable.
8. **Hide, isolate, show all.**
9. **Select similar, connected, a tag's members, all, and a crossing box.** Changing four legs
   takes four Ctrl-clicks today ([03](img/editing-audit/03-four-legs-replace.png)).
10. **Split a bar, and offset it in its own plane** (`off_mm`). Both are CLI-only today.

**Streams** (§7), in parallel worktrees after a contracts stream:

- **E0, contracts.** The action registry and context-menu shell, a pick-with-face API, gizmo
  primitives built once, view-state signals for hidden and isolated, the per-tool split of
  `wiring.ts`, and test hooks.
- **E1, core and CLI.** A `transform` command (move and rotate, with joined ends following) and
  `alukit move` / `rotate`. Angled cuts declared by `autoConnect`, which can also join an end into
  a corner's through bar. Words and fixes for every problem code, a mitre arrangement, and
  `like:` / `connected:` query selectors.
- **E2, selection and visibility.** The context menu in the view and the outline, the selection
  verbs, hide and isolate, a size readout, trackpad navigation, and the palette defect.
- **E3, transform and copy tools.** Rotate, mirror, duplicate and arrays, copy and paste,
  point-to-point, align, and a part sliding along its bar.
- **E4, bars and ends.** Editable ends, offsets and the section-dot anchor, split and reverse,
  holes, node fields, multi-selection fields, lengths bound to params, and the end-words defect.
- **E5, connections, patterns and parts.** Editing face, pivot, mitre, splice and butt fields,
  pattern editing and explode, part replace, groove and offset, and the corner's mitre
  arrangement.

**Calls for the owner** (§11). Two:

- Whether editing a variant's scope belongs in this round.
- Whether butt connectors should be drawn in 3D now, which needs a placement rule in the core.

## 2. Method

**Read** (at `b8ff033`):

- Design: §4 projects, §6 commands, §7.3 CLI, §8 viewer and UI.
- UX: `docs/ux/plan.md` (S0–S5), `contracts.md`, the stream decision notes and
  `review-phase4.md`.
- Commands: `src/core/commands/registry.ts` (38 commands) and the generated
  `skills/alukit/SKILL.md` reference (every argument).
- UI code: every command the UI sends, found by its literal `cmd` across `src/ui` and
  `src/viewer`. Then the inspector (`src/ui/inspector/{Inspector,BarFields,OtherFields,length}.tsx`),
  the tools (`src/ui/tools/{state,commands,wiring}.ts`), the keys (`src/ui/keys.ts`, and every
  `onKey` handler), the outline (`src/ui/outline/Outline.tsx`) and the viewer's pointer handling
  (`src/viewer/scene.ts`).

**Run:**

- The build (`pnpm build`), then `alukit serve` on two projects:
  - a scratch copy of `tests/fixtures/cart`, with its catalogs beside it;
  - an empty project from `alukit new --catalog forseti --currency BRL`.
- Each was driven by a Playwright script, headless, one page at a time, at 1440 × 900 in the
  dark theme.
- On the cart: select a bar; drag on it; right-click and double-click it; twelve editing chords
  with it selected; select a pattern, a face connection, a pivot, a part and a run from the
  outline; Ctrl-click two bars; Shift-drag a box; read the help.
- On the empty project: the box frame from the start card (1000 × 600 × 750, 40 × 40); select
  four legs and open Replace; the outline by tag; then a diagonal brace drawn corner to corner and
  joined.
- The CLI's `problems` and `do --dry-run` checked what the app could not show.

**Research** (§4):

- Official documentation of Blender, SketchUp, Fusion, Onshape, FreeCAD, Revit and Tekla, and of
  the extrusion-frame tools: MISUMI FRAMES, Bosch Rexroth FRAMEpro, Vention MachineBuilder,
  80/20 IdeaBuilder, Tslots TBUILD and item.
- A subagent did the first pass. Pages it could see only as search snippets were re-read where
  possible (Blender, through the manual's source; SketchUp's Measurements box; Onshape's shortcut
  and variable pages; Vention's docs; Fusion's parameters).
- Where a claim rests on a snippet or on general knowledge, it says so.

**Screenshots** (`img/editing-audit/`, measured, 1440 × 900):

| # | Shows |
|---|---|
| [01](img/editing-audit/01-bar-selected.png) | A selected bar: its length is driven by H, its ends are words, no handle in the view; the status bar's gestures are orbit, pan, zoom, box select, Delete |
| [02](img/editing-audit/02-pattern-read-only.png) | A live pattern: template, along, pitch, count and skip are read-only; only label and tags edit |
| [03](img/editing-audit/03-four-legs-replace.png) | Four legs selected by four Ctrl-clicks for Replace; the bin says "Draws: no profile yet" right after a frame of PF40-01 was made (defect D1) |
| [04](img/editing-audit/04-brace-angled-end.png) | A brace butted into two posts: two "A angled end problem" errors with no fix, the ends drawn square into the posts, and the End rows saying "open: nothing joins it" (D2, D3) |

## 3. What the model can do, and how the app reaches it

### 3.1 The commands

Each row gives where a person reaches the command today (read; the paths marked † were also
measured).

| Command | App path today | (a)–(c) |
|---|---|---|
| `setProject` | Project settings; start card; catalog card's "make default"; problem fixes † | |
| `addNode` | **none**: Draw writes points as the document would (coordinates, stations), never a node | |
| `moveNode` | **none**: a node's inspector is read-only words | (c) may move nodes: unknown |
| `addBar` | Draw bar † | |
| `setBar` | **partly**: inspector length (moves end b, numbers only), finish, anchor (named points only), roll, Replace (item); the catalog card's Replace; the pivot batch † | (a) and (b) write end points; (c) writes points |
| `reverseBar` | **none** | |
| `splitBar` | **none** | |
| `addFrame` | Box frame tool `G`; start card † | |
| `addRun`, `setRun` | **none** | |
| `removeEntity` | Delete key and button, with its cascade dialog † | |
| `addConnection` | Connect tool `C`: butt, mitre, splice, pivot, face, every field † | |
| `setConnection` | **partly**: a butt's through bar, connector and quantity; several butts' connector † | |
| `autoConnect` | Draw's ends; the inspector's Join on an open end; the corner inspector's Apply and "Join open corners"; the `unconnected` fix † | (a) auto-attach |
| `addPart` | Place part `P`, on a face or groove † | |
| `setPart` | **partly**: station bar, face, distance, from; roll; the catalog card's Replace † | |
| `addPattern` | Pattern tool `X`: along a bar, numeric pitch and count † | |
| `setPattern` | **partly**: only "Leave out" on a copy (adds a skip) | |
| `explodePattern` | **none** | |
| `mirror` | **none** | |
| `array` | **none** | |
| `addItem` | **none** | |
| `setItem` | **partly**: a price fix only | |
| `setParam` | Project panel's params † | |
| `addCost`, `setPriceBands`, `chooseOffer` | **none** | |
| `setCost` | **partly**: a fix that releases a blocking cost | |
| `tag`, `label` | **partly**: one entity at a time in the inspector † | |
| `addVariant`, `setVariant` | **none** | |
| `addCheck` | **none** | |
| `addOpen`, `resolveOpen`, `addDecision` | Problems and Records sheets † | |
| `saveView` | **none** | |
| `lockUpdate` | A problem fix † | |

**Totals:** 13 fully, 8 partly, 17 none.

Six of the 17 belong in the sheets rather than the 3D view: costs, price bands, offers, variants,
checks and saved views. They are listed in §10 and left to a records-and-order audit. The other
11 shape the frame, and are in the matrix.

### 3.2 The editable fields, entity by entity

The fields are design §4.2–§4.7's. "Edit" means a control in the inspector (measured on the cart
and the empty project); "words" means shown and read-only.

| Entity | Field | Today |
|---|---|---|
| Bar | `item` | edit: Replace, for this bar, the selected ones, or all like it |
| | `opt` (finish) | edit |
| | `a`, `b` | words. Length edits end b along the bar, numbers only; a param-driven length says "driven by H: edit H" (measured) |
| | `anchor` | edit, as a named point (centre, faces, corners) |
| | `off_mm` | words |
| | `roll_deg` | edit |
| | `up` | words |
| | `ends.a`, `ends.b`: `plane`, `cut`, `extend_mm` | words. "Join" when the end is open; nothing else (measured) |
| | `ops` (holes a person adds), `holes` (rail layout) | words |
| | `label`, `tags` | edit |
| | `only_in`, `not_in` | words |
| Node | `at`, `on`, `pivot` | words |
| Run | `bars` | words |
| Butt | `through`, `connector`, `qty` | edit (measured) |
| | `ends` | words |
| | `spacer_mm`, `stack`, `through_end`, `held_by` | words |
| Mitre, splice | `connector`, `qty`, `gap_mm` | words |
| Pivot | `base`, `axis`, `connector` | words (measured on c13) |
| Face | `bars`, `fastening`, `fastener`, `stack`, `stations`, `gaps_mm`, `faces`, `tap_depth_mm` | words (measured on c23) |
| Part | `item` | words in the inspector; the catalog card can replace it |
| | `on.bar`, `on.face`, `on.at_mm`, `on.from` | edit |
| | `on.groove` | not offered: the inspector's face list has no grooves, though Place can put a part in one |
| | `on.off_mm` | words |
| | `roll_deg` | edit |
| | `at` (a world pose) | words |
| | `qty`, `unplaced` | no path |
| Pattern | `template`, `along`, `pitch_mm`, `count`, `offsets_mm`, `skip`, `rail_holes` | words (measured on pt1); "Leave out" on a copy |
| Several selected | | Delete; Replace (when all the bars share an item); a shared connector (when all are butts). Nothing else (measured) |
| Project | `params` | edit (project panel) |
| | `name`, `catalogs`, `currency`, `price_basis`, `fx`, `defaults`, `order_rules` | edit (Project settings) |

### 3.3 The gestures in the view today (measured)

| Gesture | What happens |
|---|---|
| Click a body | Selects it; the inspector shows it |
| Ctrl or Cmd + click | Toggles it in the selection |
| Shift + drag | A box that selects what lies wholly inside it (19 entities over the cart's left half). No crossing box |
| Left-drag on a selected bar | **Orbits the camera.** The revision is unchanged |
| Right-click | **Nothing.** The canvas prevents the browser's menu and opens none of its own. Right-drag pans |
| Double-click | Nothing |
| Ctrl+C, Ctrl+V, Ctrl+D, Cmd+D, Ctrl+A, Ctrl+G, H, Alt+H, I, Shift+D, → and ↑ in Select | **Nothing**: no step, no change to the selection, the tool unchanged |
| The outline "by tag" | Groups rows under base, post and top. A group's head opens and closes; it does not select its members |
| `F`, `O`, the view buttons, the section plane | Fit, projection, standard views, a section: all work, and none of them is a step |
| The status bar in Select | "drag: orbit · right-drag: pan · wheel: zoom · Shift-drag: box select · Delete: remove the selection · ?: keys" |

The help lists the tool keys (V B G C P X M) and the draw keys (digits, `=`, `[`, arrows,
Space, Tab, R, A, W, Shift), then Delete, `/`, T, F, O, Ctrl+Z and `?`. That is every editing
key the app has (measured).

### 3.4 Defects found while running it

| # | Defect | Evidence | Cause | Stream |
|---|---|---|---|---|
| D1 | After a box frame from the start card, Draw says "no bar in the palette" and the bin "Draws: no profile yet", though the frame just set `defaults.bar`. A reload arms it | measured ([03](img/editing-audit/03-four-legs-replace.png)) | `startPalette` runs once, on the first model (`src/ui/App.tsx`). The frame form writes `defaults.bar` and never arms; the start card's "first bar" path does (`src/ui/shell/StartCard.tsx`). A default set later by settings or by an agent is missed the same way (read) | E2 |
| D2 | An end that a butt claims, whose plane fell back to the default after an error, reads "open: nothing joins it, square" with a Join button | measured ([04](img/editing-audit/04-brace-angled-end.png)) | The end's words read the derived provider (`by: "default"` after the fallback), not the connection that claims it (inferred from `src/ui/inspector/words.ts`). *E1 confirmed it is the UI's words; the core's half (the check and `autoConnect` taking such an end as open) is fixed (e1 2, 12)* | E4 |
| D3 | `angled-end` is titled "A angled end problem at b13.a" and offers no fix | measured | `checkTitle` falls back to "A <code> problem" for codes without words (`src/core/problems/words.ts`); there is no fix for this code (`src/core/problems/problems.ts`) (read). *Fixed in E1: every code has words, and `angled-end` two fixes (e1 7–9)* | E1 |
| D4 | A brace drawn corner to corner gets two `unconnected` warnings with the fix "Join with the default butt". The core refuses that fix: "only b13 meets at that point: nothing butts on it" | measured (`alukit problems`, `alukit do --dry-run`) | The corner's other ends are already claimed by the corner's butt, so `autoConnect` finds no partner. The fix is offered without asking the same rule (read). *Fixed in E1: the end butts on the corner's through bar, and the fix asks the same rule (e1 1–4)* | E1 |
| D5 | The Pattern tool's pitch is `Number(text)`: no expression and no param, unlike every other typed value (D-UX-17) | read (`src/ui/tools/commands.ts`, `patternCommand`) | | E5 |
| D6 | Design §8 says Select works "or by tag". In the app, tags only group the outline; selecting a tag's members takes a click per member | measured | A stale claim. E2.2 makes it true, and E2 corrects §8's wording when it lands | E2 |

The brace shows more than D3 and D4: getting a diagonal right is hard in the app today (measured,
with CLI dry runs on the empty project's frame).

1. The default centre anchor sets the brace half outside the frame's face plane. The named anchors
   are section-local, so a brace in a vertical plane moves "up" with `-y`, not into the frame.
   That gave `butt-miss` ("crosses b1 within 0.01 mm of an edge").
2. Once it sits inside the frame, each butt makes a 29.81° end. That is an `angled-end` error
   until each end declares `cut: "angle"`, a field the app has no control for.

So the app can draw a brace but cannot finish one.

## 4. What a frame designer expects

Each subsection gives what the established tools do, then what that means for AluKit. **Baseline**
marks what every tool does, so a user expects it; the others are what some tools do.

### 4.1 Selection

- **Baseline:** click selects, a modifier adds or toggles, a drag draws a box. Every tool does
  this (inferred). AluKit has it (§3.3).
- **Window vs crossing:** AutoCAD and SketchUp tie this to the drag's direction: left to right
  takes what is wholly inside, right to left takes what it touches (inferred; not checked here).
  A crossing box is what stretching a frame's side needs.
- **Select similar and linked:**
  - Blender has Select Similar and Select Linked (inferred).
  - Revit has "Select All Instances" (inferred).
  - Onshape's Frame takes a path picked contiguously (docs: [Onshape Frame][onshape-frame]).
- **Hide and isolate:** in every tool, and usually on single keys.
  - Vention: Ctrl+H hide, Ctrl+J isolate, Ctrl+Shift+H unhide all; hidden parts stay in the BOM
    (docs: [Vention design shortcuts][vention-keys]).
  - Onshape: `y` hides, `shift+y` shows hidden, `shift+i` isolates by making the rest
    transparent (docs: [Onshape shortcuts][onshape-keys]).
  - Blender: H, Shift+H and Alt+H (inferred).

**For AluKit:** hide, isolate, select similar and select connected are expected. A crossing box
is the natural partner of the Move tool.

### 4.2 Transform

- **Move with typed values during the gesture:**
  - SketchUp: type a distance into the Measurements box while moving (docs:
    [SketchUp Measurements box][su-vcb]).
  - Blender: G, R and S take typed numbers at once. Tab moves between axes; `=` turns on advanced
    mode, which takes units (`cm`, `deg`) and expressions (docs: [Blender numeric input][bl-num]).
- **Axis and plane locks:**
  - Blender: X, Y or Z constrains to the current orientation; a second press gives the Global
    axis; a third removes it. Shift with the key locks the plane that excludes that axis, for
    move and scale (docs: [Blender axis locking][bl-axis]).
  - SketchUp locks an inference axis with the arrow keys (inferred).
  - AluKit's Draw already takes → ← ↑ the SketchUp way.
- **Gizmo vs point to point:**
  - Fusion's Move/Copy has Free Move, Translate, Rotate, Point to Point and Point to Position.
    Free Move is "not captured parametrically" (snippet: [Fusion Move/Copy][fusion-move]).
  - Onshape's Transform translates by a line, a distance or XYZ; rotates about an axis with a
    typed angle; and copies (docs: [Onshape Transform][onshape-transform]).
  - Baseline: a translation by picked base point and target point.
- **Rotate about an axis or point:** in every tool; SketchUp's Rotate takes a centre, a reference
  line and a typed angle (inferred).
- **Mirror:** Fusion, Onshape, Blender and FreeCAD (inferred).
- **Align:** Fusion has Align (inferred).
- **Distribute:** rare in mechanical CAD (inferred).
- **End grips:**
  - Revit: drag a beam end's shape handle to change its extension, or its cutback when the end is
    joined; Change Reference sets which line a joined end aligns to (snippet:
    [Revit beam ends][revit-beam]).
  - Tekla: members have end handles, several of which can be selected and moved together, with
    typed X/Y/Z (snippet: [Tekla handles][tekla-handles]).
  - This is the precedent for (a).

**For AluKit:** (c)'s Move with axis locks and typed offsets matches the baseline. Still expected:
rotate with a typed angle, mirror, point-to-point, and align. A plane lock (Shift + axis) is a
nicety.

### 4.3 Copy, duplicate, arrays

- **Copy while moving:**
  - SketchUp: Move with a modifier copies (inferred: the documentation page was not readable).
    Then `5x` (or `5*`) makes five more copies at the same spacing, and `5/` divides the distance
    to the first copy into equal gaps (docs: [SketchUp Measurements box][su-vcb]).
  - Fusion: a Create Copy option in Move/Copy (snippet: [Fusion Move/Copy][fusion-move]).
  - Onshape: Transform copies (docs: [Onshape Transform][onshape-transform]).
  - Blender: Shift+D duplicates and drops into a move (inferred).
  - Vention: `i` re-inserts the last part used (docs: [Vention design shortcuts][vention-keys]).
- **Patterns:** linear and circular in Fusion, Onshape and FreeCAD; linear arrays in SketchUp
  (inferred).

**For AluKit:** duplicate-then-offset is baseline and is missing entirely. SketchUp's `Nx` and `/N`
fit AluKit's command bar, which already takes typed values. Live patterns exist (`X`) but cannot be
edited. Circular patterns are rare in frames.

### 4.4 Bar-specific edits

- **Onshape's Frame** (docs: [Onshape Frame][onshape-frame]):
  - the profile sits on the path, centred by default, or on another alignment point;
  - an angle rotates it, with flip arrows;
  - corners are Miter, Butt, Coped butt or None, with a per-corner override;
  - a flip arrow chooses which member runs through;
  - "Limit frame ends" trims an end to a plane, face or part.
- **FreeCAD FrameForge** trims, offsets, cuts and mitres beams, and splits corners into end-trim
  and end-mitre (snippet: [FrameForge][frameforge]).
- **Tekla** swaps a member's handles to reverse it, and "Fit part ends" cuts an end to a picked
  line (snippet: [Tekla fit part ends][tekla-fit]).
- **MISUMI FRAMES** shortens a bar automatically when a corner bracket is added (snippet:
  [MISUMI FRAMES][misumi]).

**For AluKit:** most of this is in the model already:

| Edit | In the model | In the app |
|---|---|---|
| Alignment | `anchor`, `off_mm` | the anchor only, as named points |
| Profile rotation | `roll_deg` | ✓ |
| Corner type, and who runs through | butt, mitre, splice; through bar | the corner inspector's arrangements (butts) |
| Limit an end | `ends.x.plane.face` | — |
| Cut an end | `ends.x.cut` | — |
| Reverse a bar | `reverseBar` | — |
| Split a bar | `splitBar` | — |

All but the arrangements and roll are missing from the app. Joining collinear bars has no command.

### 4.5 Connections and parts

- **Tekla:** connections come from a catalog, double-clicking the component's symbol edits its
  parameters, and they update when the parts change (snippet: [Tekla end plate][tekla-conn]).
- **MISUMI FRAMES:**
  - brackets can only be placed where they join two bars;
  - colour says whether a placement is valid: blue fastens, orange snaps, red is an error;
  - brackets and nuts are added at joints and counted in the BOM (snippet: [MISUMI FRAMES][misumi]).
- **FRAMEpro** creates connections by macro, adjusts profile lengths, and checks caps and joints
  (docs: [FRAMEpro][framepro]).
- **Vention** connects a part as it is inserted: "each new part can be added and constrained to an
  assembly in a single mouse click", with the arrow keys turning it before the click (docs:
  [Vention inserting parts][vention-insert]).
- No source found describes sliding a part along a groove in these tools.

**For AluKit:**

- Its Connect tool and joint markers already match this.
- What is missing is editing after creation, beyond butts. Tekla's "open the joint and change its
  parameters" is the model.
- A part's distance edits in the inspector; dragging it along its bar is expected.

### 4.6 Parameters and dimensions

- **Fusion:**
  - user parameters live in a Change Parameters dialog, with expressions that reference other
    parameters;
  - Fusion suggests parameters as you type in a value field (snippet:
    [Fusion parameters][fusion-params]);
  - Free Move is outside the timeline; Translate and Point to Point are inside it.
- **Onshape:** typing `#` in any numeric field offers the variables, and a field can create one;
  changing a variable updates everything that uses it (snippet: [Onshape variables][onshape-vars]).
- **Dimensions:** a live distance readout while moving is baseline (SketchUp, Blender). Persistent
  driving dimensions belong to sketches in parametric CAD (inferred).

**For AluKit:**

- The command bar already writes a value that reads a param as typed (D-UX-17). The inspector's
  length does not: it writes numbers.
- Onshape's "`#` anywhere" is the expectation: `=W` should bind in every numeric field.
- An overall size readout (W × D × H) is the dimension a frame designer checks most (inferred).

### 4.7 Menus, undo and input

- **Context menus:**
  - Onshape's `s` opens a shortcut toolbar at the pointer (docs: [Onshape shortcuts][onshape-keys]).
  - Fusion has a right-click marking menu, Blender right-click and `W` menus (inferred).
  - Tekla moves a handle from the right-click menu (snippet: [Tekla handles][tekla-handles]).
  - Every tool here has one (inferred).
- **Undo:** one committed operation, one undo, everywhere (inferred). In SketchUp, typing `5x`
  after a copy edits the same operation until another starts (docs: [SketchUp Measurements
  box][su-vcb]). AluKit's server undo is one step per batch, already right.
- **Several selected:** Revit's properties show "Varies" for differing values (inferred).
- **Navigation:** keyboard-modal (Blender), mouse with typed values (SketchUp), mouse with dialogs
  (Fusion, Onshape) (inferred). Trackpad modes were not found in the documentation read
  (unverified).

### 4.8 What the extrusion tools add, and their limits

| Tool | What it adds in 3D | Limits |
|---|---|---|
| MISUMI FRAMES | Brackets and nuts placed at joints, bars shortened, BOM updated live, ordering from the tool (snippet: [MISUMI][misumi]) | Windows only, online only |
| FRAMEpro | Connection macros, a sawing and drilling list per profile, checks (docs: [FRAMEpro][framepro]) | Runs only inside Inventor or SolidWorks |
| Vention | A 45 mm grid library, automatic connection on insert, a deflection calculator (snippet: [Vention FAQ][vention-faq]) | Its own components only |
| 80/20 IdeaBuilder, Tslots TBUILD | Free web tools with a BOM (snippet: [IdeaBuilder][ideabuilder], [TBUILD][tbuild]) | |
| item MotionDesigner | A linear-unit selector, not a frame designer (snippet: [item][item]) | |

No source was found describing multi-selection editing, a typed array grammar, or typed values in
any of these configurators.

**For AluKit,** the strengths of this class are things AluKit already has: catalog-bound joints, a
live cut list, BOM and order, and validity shown in 3D (markers and badges). Its gap is the general
CAD editing verbs.

## 5. The gap matrix

**Importance:** **must** means a real frame dead-ends in the app without it, or the owner's own
acceptance tasks need it; **should** means CAD users expect it and its absence is friction;
**could** means nice to have.

**Core:** UI means the commands exist and the work is UI only; **core** means a command or a core
rule changes.

**Streams** are those of §7.

Already supported, and not counted:

- click, Ctrl-click and window selection;
- the tools' typed values (Draw, Frame, Place) and Draw's axis locks;
- Replace for one bar, a selection, or all bars like it;
- roll, anchor and finish;
- butt through bar, connector and quantity, and the corner arrangements;
- Place on a face or groove; a part's station and roll;
- live patterns made along a bar;
- params in the project panel;
- Measure; standard views, fit, orthographic and the section plane;
- Delete with its cascade; one undo per step.

After (a)–(c): moving a selection with axis locks and typed offsets, end drags along the axis,
and the length label editor.

| # | Capability | Today, after (a)–(c) | Importance | Core | Stream |
|---|---|---|---|---|---|
| **Selection and visibility** | | | | | |
| 1 | Crossing box (what it touches) | missing | should | UI | E2 |
| 2 | Select all (Ctrl/Cmd+A) | missing | should | UI | E2 |
| 3 | Select similar: same item and options, same tag | partly: Replace's "all like it" only | should | UI + `like:` selector | E2, E1 |
| 4 | Select an outline group's members (a tag, a kind) | missing | should | UI | E2 |
| 5 | Select connected: joined bars, a run, a corner's bars | missing | should | UI + `connected:` selector | E2, E1 |
| 6 | Hide, isolate, show all | missing: Show and the legend ghost the rest, nothing hides | should | UI | E2 |
| 7 | Pick through: cycle what lies under the pointer | missing | could | UI | later |
| **Transform** | | | | | |
| 8 | Point-to-point move: base point, then a snap | unknown in (c) | should | UI | E3 |
| 9 | Rotate a selection about X, Y or Z through a point, typed angle | missing | should | **core** (`transform`) | E1, E3 |
| 10 | Mirror a selection as a copy | missing in the app (core `mirror`) | **must** | UI | E3 |
| 11 | Align a selection to a face | missing | should | UI | E3 |
| 12 | Distribute evenly | missing | could | UI | later |
| 13 | Nudge with arrow keys in Select | missing | could | UI | later |
| 14 | Plane lock (Shift + axis) | missing | could | UI | later |
| 15 | Move, rotate and mirror carry what hangs on the selection: parts by station, nodes by `moveNode`, a pattern's copies with its template; a param-driven coordinate stays driven | unknown in (c); no core command | **must** | **core** (`transform`) | E1 |
| **Copy** | | | | | |
| 16 | Duplicate with an offset (Ctrl/Cmd+D, then move or type) | missing (core `array`) | **must** | UI | E3 |
| 17 | Copy and paste within the project | missing | should | UI | E3 |
| 18 | Arrays as plain copies: `4x` and `/4` after a copy, and an Array action | missing in the app (core `array`) | should | UI | E3 |
| 19 | Edit a live pattern: along, pitch (expressions, D5), count, skips | missing: read-only | **must** | UI | E5 |
| 20 | Explode a pattern | missing | should | UI | E5 |
| 21 | Pattern by direction or offsets; rail-hole stations | missing | could | UI | later |
| 22 | Circular pattern | no command | could | core | later |
| **Bars and ends** | | | | | |
| 23 | Re-aim an end at any snap point, off its axis | partly: (a) drags along the axis | should | UI | E4 |
| 24 | Stop an end at a face, or flush with another end (`plane.face`, `plane.of`) | missing | should | UI | E4 |
| 25 | Declare an end's cut (angle, square) and extension; an angled butt the app makes declares it | missing (D3, measured dead end) | **must** | UI + **core** (`autoConnect` declares) | E4, E1 |
| 26 | Split a bar at a point, with a splice and a run | missing in the app (core `splitBar`) | should | UI | E4 |
| 27 | Join collinear bars into one | no command | could | core | later |
| 28 | Reverse a bar | missing in the app (core `reverseBar`) | could | UI | E4 |
| 29 | Offset in the bar's plane (`off_mm`), and the anchor picked on the section's dots | partly: named anchors only | should | UI | E4 |
| 30 | The bar's up vector | missing | could | UI | later |
| 31 | Holes a person adds (`ops`): add on a face, edit, remove | missing | should | UI | E4 |
| 32 | A rail's hole layout (`holes`) | missing | could | UI | later |
| 33 | A length typed as `=W` binds the param, in the inspector and the label; a choice of which end moves | partly: Draw only; (b) unknown | should | UI | E4 |
| 34 | Edit or move a node, the point several bars share | missing: read-only words | should | UI (`moveNode`) | E4 |
| 35 | Name a run from selected spliced bars | missing | could | UI | later |
| 36 | Fields for several selected: finish, anchor, roll, label, tags, with "varies" | partly: Replace, the butt connector | should | UI | E4 |
| **Connections** | | | | | |
| 37 | Mitre or splice as a corner arrangement | missing: arrangements are butts only | should | **core** (arrangements) | E1, E5 |
| 38 | Edit a face connection: fastening, fastener, stations, stack, gaps | missing (design v1 limit) | **must** | UI | E5 |
| 39 | Edit a pivot: base station, axis, connector | missing | should | UI | E5 |
| 40 | Edit a mitre or splice: connector, quantity, gap | missing | should | UI | E5 |
| 41 | Edit a butt's spacer and through-end mode | missing | should | UI | E5 |
| 42 | Edit a butt's stack and `held_by` | missing | could | UI | later |
| 43 | Draw a butt's connectors in 3D | counted, not placed (design §4.5 v1 limit) | could | core, large | owner call |
| 44 | A brace or an extra end at a joined corner joins (D4) | missing: the fix is refused | **must** | **core** (`autoConnect`) | E1 |
| **Parts** | | | | | |
| 45 | Slide a part along its bar by drag, with a typed distance | missing: inspector only | should | UI | E3 |
| 46 | Replace a part from its inspector | partly: the catalog card only | should | UI | E5 |
| 47 | A part's groove and offset (`on.groove`, `on.off_mm`) | missing in the inspector | should | UI | E5 |
| 48 | A part at a world pose: place and edit | missing | could | UI | later |
| 49 | Unplaced lines (consumables) | missing | could | UI | later |
| **Params and dimensions** | | | | | |
| 50 | Make a param from a value ("Make parameter…") | missing | could | UI | later |
| 51 | The size of the selection, or of the model, in view (W × D × H) | missing | should | UI | E2 |
| 52 | Persistent dimensions, guides, construction lines | missing | could | UI | later |
| 53 | Distance to neighbours while moving (inference readouts) | missing | could | UI | later |
| **Menus, input and views** | | | | | |
| 54 | A right-click context menu in the view and the outline, with every action on the selection; the menu key and Shift+F10 open it | missing | **must** | UI | E0, E2 |
| 55 | Every edit reachable by mouse alone and by keyboard alone; the help lists every action | partly | **must** | UI | E0, all |
| 56 | Command search (Ctrl+K) | missing | could | UI | later |
| 57 | Trackpad navigation: two-finger pan, pinch zoom | partly: the wheel dollies, and pan needs a right-drag (read: camera-controls defaults in `src/viewer/scene.ts`; inferred on a real trackpad) | should | UI | E2 |
| 58 | Saved views | missing in the app (core `saveView`) | could | UI | later |
| **Defects** | | | | | |
| 59 | D1: the palette follows `defaults.bar` while it is empty | defect | **must** | UI | E2 |
| 60 | D2: an end's words name the connection that claims it | defect | **must** | UI | E4 |
| 61 | D3: words and a fix for every problem code (`angled-end` first) | defect | **must** | **core** (problems) | E1 |
| **Beyond the view** | | | | | |
| 62 | Project items (plates, bent angles, placeholders) and variant scope (`only_in`) from the app | missing | could | UI | later; variant scope is an owner call |

**Counts:**

| Importance | Count | Rows |
|---|---|---|
| must | 12 | 10, 15, 16, 19, 25, 38, 44, 54, 55, 59, 60, 61 |
| should | 29 | 1–6, 8, 9, 11, 17, 18, 20, 23, 24, 26, 29, 31, 33, 34, 36, 37, 39–41, 45–47, 51, 57 |
| could | 21 | 7, 12–14, 21, 22, 27, 28, 30, 32, 35, 42, 43, 48–50, 52, 53, 56, 58, 62 |

Of the 41 must and should rows, 8 need the core: rows 3 and 5 (the selectors), 9 and 15
(`transform`), 25 and 44 (`autoConnect`), 37 (arrangements) and 61 (problems).

### 5.1 What (a)–(c) leave uncovered

- **(a) end handles:**
  - Re-aiming an end off its axis (row 23).
  - Stopping it at a face as a provider (row 24), as distinct from snapping its length to a face.
  - An end at a reference (a node, a station, a pivot): the handle should say what sets it, as the
    inspector does, and offer to detach.
  - An auto-attach at an angle makes an `angled-end` error unless the end's cut is declared
    (row 25; E-UX-11 makes `autoConnect` declare it).
- **(b) the length label:**
  - Binding to a param with `=W` (row 33).
  - Which end moves. Today's inspector always moves end b; a symmetric stretch from the middle is
    common.
  - A label for a param-driven length should open the param, as the inspector's "edit H" does.
- **(c) Move:**
  - Rotate (row 9) and copy-while-moving (row 16).
  - Point-to-point (row 8), unless its drag starts from a snapped point.
  - Crossing selection for a stretch (row 1).
  - A part dragged alone should slide on its bar and write `on.at_mm`, not leave its station
    (row 45).
  - Nodes and param-driven coordinates (row 15).
  - **CLI parity:** if (c) composes `setBar` patches in the browser, agents would have to compute
    the same coordinates by hand, which design §6 rules out ("agents never compute cut lengths by
    hand"). E-UX-3 lifts it into a core `transform` command.

## 6. Decisions

Each is a default taken without asking (open to the owner's veto) where a sensible one exists.

| # | Decision | Why |
|---|---|---|
| E-UX-1 | **One action registry.** Every edit is an action (id, title, group, keys, `when` that says why not, `run`) registered once. The context menu, the keys, the help, the selection header's buttons and the inspector's action row all read it. No action exists only as a key or only as a button | Mouse-only and keyboard-only parity (row 55); one place to test; Blender's operators and VS Code's commands work this way (inferred) |
| E-UX-2 | **Right-click without movement** (≤ 4 px, the click threshold the view already uses) opens the context menu on what is under the pointer, selecting it first if it is not selected. Right-drag still pans. Ctrl+click on a Mac, the ContextMenu key and Shift+F10 open it for the selection | Keeps today's pan; WAI-ARIA's menu pattern for the keyboard |
| E-UX-3 | **A core `transform` command**: `{ ids, by?: [dx, dy, dz], rotate?: { axis: "x"\|"y"\|"z", deg, about: [x, y, z] }, joined: "follow"\|"detach" }`. CLI: `alukit move <dir> --ids … --by dx,dy,dz` and `alukit rotate <dir> --ids … --axis z --deg 90 --about x,y,z`. If (c) already composes `setBar` patches in the browser, E1 moves that builder into the core, and (c)'s tool sends `transform` | Design §6 and §7: one edit path, CLI parity, agents never compute geometry by hand |
| E-UX-4 | `transform` moves what is written, keeping its form. Inline points move. A node moves by `moveNode` semantics, so what uses it follows. A part on a station follows its bar, or, selected alone along its bar, changes `at_mm`. A world-pose part moves its pose. A pattern's template moves and its copies follow. **A coordinate written as an expression keeps it**: `W` moved by 100 becomes `W + 100`, and the step's words say so | Never silently turns a param-driven point into a number (D-UX-17's spirit); the frame still follows W afterwards |
| E-UX-5 | **Rotation** in this round turns about a world axis through a picked point, at any typed angle; quarter turns use §4.4's exact table. Free-axis rotation is later | Frames are mostly orthogonal; this covers turning a sub-assembly |
| E-UX-6 | **Duplicate** (Ctrl/Cmd+D, the menu) enters a Move session on a copy, from the original's place: the copy follows the pointer or a typed offset, and the commit is one `array` step. **Within the same session**, typing `4x` (or `x4`) makes four copies at that spacing, and `/4` divides it into four. These are plain copies: the Pattern tool stays the live way | SketchUp's grammar (docs); plan §7 defers amending a committed step, so the count is typed before the commit |
| E-UX-7 | **Copy and paste** stay within the tab's project: Ctrl+C remembers the selection, and Ctrl+V starts a Duplicate session at the pointer's snap. Pasting into another project is later | No clipboard format to design now |
| E-UX-8 | **Mirror makes copies** across a plane square to X, Y or Z, through a picked point or the selection's centre. "Remove the originals" is an option of the same step. An asymmetric section takes the item's other hand (§4.7) | The CAD default; `mirror` already copies |
| E-UX-9 | **Hide and isolate are view state**, like the section plane: no step, per tab, cleared by Show all. Picks and snaps skip what is hidden. Isolate uses the existing ghost path; hide uses instance visibility. Keys: H hides, Shift+H isolates (hides the rest), Alt+H shows all. While anything is hidden, a strip says "n hidden · Show all" | Blender's keys (inferred), free in AluKit; nothing gets lost; no material per change (view.spec) |
| E-UX-10 | **Box direction:** Shift-drag left to right is a window (wholly inside); right to left is a crossing (touching), drawn dashed | The CAD convention (inferred); keeps Shift as the box key |
| E-UX-11 | **An angled butt end the app or `autoConnect` creates declares `cut: "angle"` in the same step.** The end's row offers angle or square. §4.5's rule that an undeclared angled end is an error stands: the document stays explicit | Finishes the brace (§3.4) without loosening the rule; an angle cut sits flush on the face that the seat checks read |
| E-UX-12 | **`autoConnect` at an end on an already joined corner** adds a butt of that end through the corner's through bar, instead of refusing. The `unconnected` problem offers its fix only when the same predicate accepts it: one shared function, not a dry run per problem | Fixes D4 at the cause; a problem's fix never fails |
| E-UX-13 | **Pattern editing** sends one `setPattern`. Pitch and offsets take expressions, and a param is written as typed (D5). Explode is one step and selects what it made | Consistent with D-UX-17 |
| E-UX-14 | **Editing a face connection** reuses the Connect tool's face form, filled from the connection, and sends one `setConnection`. Changing its layers is done by re-picking in Connect, which offers "replace c23" | One form, already tested |
| E-UX-15 | **Several selected:** each shared field shows its value, or "varies". A change is one step, one patch per entity | Revit's convention (inferred) |
| E-UX-16 | **Lengths bind params** everywhere: the inspector and (b)'s label take `=W` (or any expression that reads a param) and write it as typed. By default end b moves; a menu on the field chooses end a or both ends from the middle | D-UX-17 applied to every numeric field (Onshape's `#`) |
| E-UX-17 | **Trackpad navigation** is a preference, Mouse (the default) or Trackpad. Trackpad maps two-finger scroll to pan and pinch (a wheel with `ctrlKey`) to zoom; a left-drag still orbits | Pan without a right-drag (inferred; to be tried on a real trackpad in the review) |
| E-UX-18 | **`draw.spec` does not move.** New declarations (E-UX-11) add a `cut` only where an end is angled, which the base frame never has; the draw tool's batch is otherwise unchanged | The oracle stays byte-identical |
| E-UX-19 | **Gizmos and handles are built once**, with their materials, and shown, hidden and moved per frame. Nothing creates or disposes a material per revision or per drag | `view.spec` expects zero shader links per revision |
| E-UX-20 | **Previews during a drag are local geometry**: the moved bodies drawn with their own materials. A dry run comes only after a snap or a 250 ms pause, as the joint preview does | S5 measured 144–167 ms per dry run at 1,008 bars |
| E-UX-21 | **Split** is on the menu of a bar at the pointed station (snapped, or a typed distance): `splitBar`, with a splice when the bar is in a run, otherwise none unless chosen | Fewest surprises: no connector bought unasked |
| E-UX-22 | **Holes** are added from the menu on a face ("Add hole here", at the snapped station or a typed distance) and edited in the inspector's Holes list, one step each | Reuses the Place tool's station logic |
| E-UX-23 | **Align** picks a target face; the selection moves along that face's normal until its own matching face is flush, as one `transform` | One click per alignment; distribute waits |
| E-UX-24 | **Rotate's key is `Q`** (SketchUp's). Mirror, Duplicate, Split and the selection verbs have no single letter: they live in the menu, plus the chords Ctrl/Cmd+D, C, V and A. (c)'s Move keeps the key it has | Today's single letters are V B G C P X M F O T W A R; `Q` is free |

## 7. Streams

### 7.1 The shape

As in the redesign, a contracts stream lands first, alone. Then five streams run in parallel
worktrees, each owning its files. Every stream forks **after (a)–(c) merge**: (c) and (a) are
changing `src/ui/tools/wiring.ts` and the viewer's pointer handling now, and E0 splits exactly
those.

| Stream | What | Tasks | Load (inferred) |
|---|---|---|---|
| E0 | Contracts: action registry, menu shell, pick-with-face, gizmo primitives, view state, the `wiring.ts` split, hooks | 9 | 2 days, one implementer, before the rest |
| E1 | Core and CLI: `transform`, `autoConnect`, problems, arrangements, selectors | 6 | 3 S, 2 M, 1 M–L |
| E2 | Selection, visibility, menus, navigation, D1 | 8 | 5 S, 3 M |
| E3 | Transform and copy tools | 8 | 3 S, 4 M, 1 M–L |
| E4 | Bars and ends, nodes, multi-selection fields, D2 | 7 | 3 S, 4 M |
| E5 | Connections, patterns, parts | 6 | 3 S, 3 M |

### 7.2 E0: the contracts (first, alone)

**Rule:** no visible change, apart from the help reading its key list from the registry. Every
e2e passes with no assertion changed.

| Id | Task | Done when |
|---|---|---|
| E0.1 | Split `src/ui/tools/wiring.ts` (1,302 lines at `b8ff033`, plus (a) and (c)) into one module per tool under `src/ui/tools/wire/` (`draw`, `frame`, `connect`, `place`, `pattern`, `measure`, `move`, `ends`), a `common.ts`, and a router left in `wiring.ts` | Every e2e and unit test passes unchanged; `wiring.ts` is the router only |
| E0.2 | `src/ui/actions/registry.ts`: `registerAction`, `actionsFor(ctx)`, `runAction(id, ctx)`. Keys bind through `keys.ts`. Help lists the registry. Seeded with today's actions (Delete, Join end, Replace, Fit, Show) | A unit test: every action with keys is in the help, and no two actions share a key in one scope; `keys.spec` passes |
| E0.3 | Viewer: `pickAt(x, y): Hit` (`{ id, point, normal, face?, station? }`), with face and station computed analytically from the derived model, as snapping is; `onContextMenu(cb)` fired by a right-click without movement | A unit test on the cart: a known point on b1 returns b1, its `+x` face and its station |
| E0.4 | `src/ui/shell/ContextMenu.tsx`: `role="menu"`, arrow keys, type-ahead, Esc, disabled entries saying why; it renders `actionsFor(ctx)` by group | An e2e opens it on b1 with the seeded actions and closes it on Esc |
| E0.5 | View state in `src/ui/focus.ts`: `hidden` and `isolated` signals. Viewer `setHidden(ids)` as a no-op; picks and snaps take a `skip` set | A unit test: snap skips a hidden bar's targets |
| E0.6 | `src/viewer/gizmo.ts`: arrows, rings, plane squares and handle dots, screen-sized, built once; `setGizmo(spec \| undefined)`, `onGizmoDrag`. If (a) and (c) built handles, generalise theirs into this module | `view.spec`'s shader-link count stays zero across a revision with a gizmo shown; a unit test of hitting a ring |
| E0.7 | `src/ui/edit/batches.ts`: typed signatures of the batch builders the streams fill (`duplicateBatch`, `mirrorBatch`, `arrayBatch`, `splitBatch`, `alignBatch`, `transformBatch`), each starting as "not available yet", except (c)'s, moved here | Types compile; (c)'s tests pass through the move |
| E0.8 | Test hook: `selection()`, `hidden()`, `menu()` (the open menu's entries), `gizmo()`. E2E helpers: `contextMenu(page, point)`, `selectByIds(page, ids)`, `docOf(dir)` | Used by E0.4's e2e |
| E0.9 | `docs/ux/contracts.md` gains "Editing round: E0", with the ownership of §7.4 | |

### 7.3 The interfaces between streams

E0 creates each of these. Afterwards only its owner changes it, and only by adding. *As built
(2026-11-27): where E0 or E1 built a member differently from this sketch, the line says so and
names the decision (e0 n, [e0-decisions.md](e0-decisions.md); e1 n, [e1-decisions.md](e1-decisions.md));
[contracts.md](contracts.md), "Editing round: E0", lists every interface E0 built.*

```ts
// src/ui/actions/registry.ts (owner E2)
interface ActionContext { m: Model; selection: ReadonlySet<string>; hit?: Hit; ref?: string; from: "view" | "outline" | "key" | "button" } // ref added (e0 4)
interface Action {
  id: string; title: string | ((c: ActionContext) => string);
  group: "select" | "view" | "edit" | "transform" | "bar" | "connection" | "pattern" | "part";
  keys?: readonly string[];                       // "mod+d", "h", "shift+h": exactly these modifiers (e0 5)
  scope?: KeyScope; help?: string; applies?(c: ActionContext): boolean; // added (e0 4)
  when(c: ActionContext): true | string;          // true, or why it cannot run (shown greyed)
  run(c: ActionContext): void | Promise<void>;
}
registerAction(a: Action): () => void;            // a key another action holds in the scope throws (e0 7)
actionsFor(c: ActionContext): { action: Action; enabled: true | string }[];
runAction(id: string, c: ActionContext): true | string;

// src/viewer/scene.ts (owner E2), added to Viewer
interface Hit { id: string; p: V3; normal: V3; face?: "+x" | "-x" | "+y" | "-y" | "a" | "b"; station?: { bar: string; at_mm: number } } // p, the built pick's name, not point (e0 12)
pickAt(x: number, y: number, skip?: ReadonlySet<string>): Hit | undefined; // skip added (e0 14)
onContextMenu(cb: (hit: Hit | undefined, client: readonly [number, number]) => void): () => void;
setHidden(ids: ReadonlySet<string>): void;

// src/viewer/gizmo.ts (owner E3)
type GizmoSpec = { at: V3; parts: ("move-x" | "move-y" | "move-z" | "ring-x" | "ring-y" | "ring-z" | "plane-xy" | "plane-xz" | "plane-yz")[] }
  | { handles: { key: string; at: V3; axis?: V3; locked?: boolean }[]; hot?: string }; // locked, hot added (e0 17)
setGizmo(spec: GizmoSpec | undefined): void;
gizmo(): GizmoSpec | undefined;                   // added (e0 17)
onGizmoDrag(cb: (e: { part: GizmoPart; phase: "start" | "move" | "end"; delta: V3; angle?: number }) => void): () => void;

// src/ui/focus.ts (owner E2)
hidden: Signal<ReadonlySet<string>>; isolated: Signal<ReadonlySet<string> | undefined>;

// src/core/commands/transform.ts (owner E1), as built: deg and about are numbers, and exactly
// one of by and rotate is given (a turn writes numbers but at quarter turns, so an expression
// angle would have nothing to keep)
{ ids: string[]; by?: [Expr, Expr, Expr]; rotate?: { axis: "x" | "y" | "z"; deg: number; about: [number, number, number] }; joined?: "follow" | "detach" }

// src/core/query.ts (owner E1): pure, used by the app's selection verbs and `alukit query`
similarTo(doc, derived, id, by: "item" | "tag"): string[];
connectedTo(doc, ids, opts?: { transitive?: boolean }): string[]; // as built: no derived (e1 11)
```

### 7.4 Who owns which files

| Path | Owner |
|---|---|
| `src/core/**`, `src/cli/**`, `src/server/**`, `src/ui/client/**`, `skills/alukit/SKILL.md` (regenerated), new fixtures | **E1** |
| `src/ui/actions/**`, `src/ui/shell/ContextMenu.tsx`, `src/ui/focus.ts`, `src/ui/outline/**`, `src/ui/catalog/state.ts` (D1), `src/viewer/scene.ts`, `src/ui/viewport/ViewControls.tsx`, `src/ui/shell/StatusBar.tsx`, `src/ui/keys.ts` | **E2** |
| `src/ui/tools/wire/{move,rotate,mirror,duplicate,align}.ts`, `src/ui/tools/state.ts`, `src/ui/tools/CommandBar.tsx`, `src/ui/edit/**`, `src/viewer/gizmo.ts`, `src/viewer/snap.ts` | **E3** |
| `src/ui/inspector/{BarFields,length,words,replace}.ts(x)`, new `inspector/{Ends,Holes,NodeFields,ManyFields}.tsx`, `src/ui/tools/wire/ends.ts` | **E4** |
| `src/ui/inspector/{OtherFields,CornerInspector,arrangements}.ts(x)`, new `inspector/{FaceEdit,PatternFields}.tsx`, `src/ui/tools/ToolForm.tsx` (the face form, extracted for reuse), `src/ui/tools/commands.ts` (D5) | **E5** |
| `src/ui/inspector/Inspector.tsx` | E4 (E5 adds its rows through `PartFields` and `ConnectionFields`) |
| `docs/design.md` (§6, §8), the decision notes | the coordinator folds them in; each stream writes `docs/ux/eN-decisions.md` |

E0 split `wiring.ts` and added modules this table does not name; [contracts.md](contracts.md),
"Editing round: E0", gives the table with them (the tools' modules by the stream whose tools they
are, the drag machinery and the batches to E3, the end rules to E4).

Each stream registers its own actions and keys from its own files. A stream that breaks another's
spec makes the smallest selector fix in that spec, in the same merge, and names it. A semantic
assertion is never weakened.

### 7.5 E1: core and CLI

| Id | Task | Size | Done when |
|---|---|---|---|
| E1.1 | `transform` (E-UX-3, E-UX-4, E-UX-5), with `alukit move` and `alukit rotate` sugar, `describe` words, and dry-run effects | M–L | Unit tests: translate and rotate a bar, a node, a station part, a world part, a pattern's template; quarter turns exact; `follow` on the cart moves the joined ends and adds no diagnostic; `detach` removes the joint; a `W` coordinate becomes `W + 100`. CLI tests through `capture`. `pnpm skill` regenerated. Every golden and fixture diagnostic unchanged |
| E1.2 | `autoConnect`: declares `cut: "angle"` on an angled end it makes (E-UX-11), and joins an end on a joined corner into its through bar (E-UX-12) | M | The audit's brace, as a fixture: drawn corner to corner and joined, it derives with no error. The base frame's cut lists are byte-identical (`draw.spec`, the `add frame` tests) |
| E1.3 | Problems: plain words for every diagnostic code (a unit test lists the codes and fails on a code with no title); `angled-end` gains "Cut it on the face" and "Cut it square" fixes; `unconnected`'s fix only when E1.2's predicate accepts it (D3, D4) | M | Tests: no title starts "A <code> problem"; the brace's problems carry working fixes, each applied by a dry run in the test |
| E1.4 | Arrangements: a mitre where the two ends can mitre (same section, mirrored), and a splice where they are collinear; `alukit arrangements` prints them | S | Unit tests on a ground rectangle and on a collinear pair |
| E1.5 | `src/core/query.ts`: `similarTo`, `connectedTo`; `alukit query` gains `like:b1` and `connected:b1` (and `connected*:b1`, transitive) | S | CLI tests on the cart |
| E1.6 | Dry-run effects for `mirror`, `array`, `splitBar`, `explodePattern` and `transform` list what they add, with cuts | S | Tests: the app's previews read real numbers |

**Order:** drop 1 is E1.5, E1.2 and E1.3, merged as soon as they pass; drop 2 is E1.1, E1.4 and
E1.6. **CLI parity:** every new verb in the app is either an existing command (sent as `alukit do`
would send it, and shown in the log under that command's name) or E1.1's `transform`, which has
its own sugar.

### 7.6 E2: selection, visibility, menus, navigation

| Id | Task | Size | Done when |
|---|---|---|---|
| E2.1 | The context menu in the view and on outline rows (E-UX-2); the selection header's buttons from the registry. Each stream's actions appear as it lands | M | `menu.spec`: right-click b1 opens a menu naming b1, with Delete; right-drag still pans; Shift+F10 opens it for the selection |
| E2.2 | Select all, similar (item and options), same tag, connected (E1.5); a click on an outline group's head selects its members, while the twisty still opens and closes; D6's wording in design §8 | M | `select.spec`: on the empty project's frame, "same tag" on a post selects b1–b4; a click on the head "post" selects the same four; Ctrl+A selects 12 bars; "connected" on b5 selects the bars it joins |
| E2.3 | Crossing box (E-UX-10) | S | A right-to-left box over the frame's right side selects the bars it touches, and a left-to-right one only those inside |
| E2.4 | Hide, isolate, show all (E-UX-9) | M | `visibility.spec`: H hides b9 and a click there picks what lies behind; Shift+H isolates; Alt+H restores; the revision never changes; the shader-link count is zero across hide and show |
| E2.5 | The size readout: the selection's bounding W × D × H (the model's when nothing is selected) in the status bar, and as a dimension box in the view while Alt is held | S | On the frame, nothing selected reads 1000 × 600 × 750 |
| E2.6 | Trackpad navigation preference (E-UX-17) | S | A wheel event without `ctrlKey` pans in Trackpad mode and dollies in Mouse mode; with `ctrlKey` it zooms in both |
| E2.7 | D1: the palette arms `defaults.bar` whenever it is empty and the default changes | S | `first-run.spec` gains: after the start card's frame, `B` then a click starts a bar of PF40-01 |
| E2.8 | Keys for the verbs, registered as actions; help updated | S | `keys.spec` gains Ctrl+A, H, Shift+H, Alt+H; with single-letter keys off, H does nothing |

### 7.7 E3: transform and copy tools

| Id | Task | Size | Done when |
|---|---|---|---|
| E3.1 | Rotate `Q` (E-UX-5, E-UX-24): pick the centre (a snap, or the selection's centre with Enter); X, Y or Z, or a gizmo ring; a typed angle; one `transform` step. Needs E1.1 | M | `transform.spec`: an angle bracket on b1 turned 90° about Z ends where `alukit rotate` puts it on a scratch copy (`alukit diff` empty) |
| E3.2 | Mirror (E-UX-8): from the menu; plane X, Y or Z through a picked point or the selection's centre; "remove originals"; one `mirror` step | M | Mirroring the bracket across x = 500 gives the copy `alukit do mirror` gives |
| E3.3 | Duplicate Ctrl/Cmd+D (E-UX-6): a Move session on a copy; typed offset; `4x` and `/4`; one `array` step | M–L | `copy.spec`: duplicate the top front rail −300 along Z, then `/3` on another: the cuts and counts equal the CLI batch's |
| E3.4 | Copy and paste (E-UX-7) | S | Ctrl+C on b9, Ctrl+V, a click on a snap: one step, one new bar |
| E3.5 | Point to point: in Move, Rotate and Duplicate, the first click on a snap is the base point | S | A rail moved from its end to another bar's end lands on it exactly |
| E3.6 | Align to a face (E-UX-23) | M | A rail whose top is 7 mm below the posts' tops is flush after one Align |
| E3.7 | A part dragged alone slides along its bar (gizmo axis = the bar), with a typed distance, as one `setPart` | S | A bracket dragged from 300 to 450 reads `at_mm: 450` |
| E3.8 | Move and Rotate send `transform` once E1.1 lands; previews are local (E-UX-20) | M | `view.spec` unchanged; dry runs per 60 pointer moves ≤ 8, as S5's preview measured |

### 7.8 E4: bars and ends

| Id | Task | Size | Done when |
|---|---|---|---|
| E4.1 | Editable ends: cut (angle, square), extension, plane (default; stop at a face, picked; flush with an end, picked); detach from the claiming connection. The words name that connection (D2) | M | `ends.spec`: the audit's brace gets both cuts declared from its rows and derives with no error; "stop at face" on a rail's end writes `plane.face`; D2's words read "butts on b1 (c9)" (*E4: on `tests/fixtures/brace` the brace butts on b3, so "butts on b3 (c9)"*) |
| E4.2 | Offset fields (`off_mm` u, v) and the anchor picked on the section's dots (reuse the command bar's picker) | S | Setting `off_mm` [0, 20] on the brace moves it into the frame plane, as `setBar` does on the CLI (*corrected by E4, measured: the brace's section x runs along world +Y and its y lies in the brace's own plane, so the offset is [−20, 0]; [e4 7](e4-decisions.md)*) |
| E4.3 | Split here and Reverse, from the menu (E-UX-21) | S | Splitting b9 at 400 gives two bars whose cuts sum to b9's; Undo restores b9 |
| E4.4 | Holes: "Add hole here" on a face; the inspector's Holes list edits and removes (E-UX-22) | M | A Ø7 hole at 20 from end a on b1's +x face equals the CLI's `setBar ops` result in `alukit machining` |
| E4.5 | Fields for several selected, with "varies" (E-UX-15) | M | Four legs set to finish black in one step; Undo takes it back as one |
| E4.6 | Lengths bind params; a choice of which end moves (E-UX-16) | S | Typing `=D` in a side rail's length writes `D` in its end b; "from the middle" keeps the centre |
| E4.7 | A node's fields edit (`at`, `on`), through `moveNode` | M | On the skill's example (which uses nodes), moving a node by its fields moves every bar end at it (*corrected by E4, read: the skill's worked example has no node; the test builds a tripod whose three legs share one; [e4 18](e4-decisions.md)*) |

### 7.9 E5: connections, patterns, parts

| Id | Task | Size | Done when |
|---|---|---|---|
| E5.1 | Edit a face connection (E-UX-14) | M | `connections-edit.spec`: c23's stations go from (100, 200) to (100, 200, 300) in one step, and its hardware count rises by the CLI's numbers |
| E5.2 | Edit a pivot (base, axis, connector), a mitre or splice (connector, quantity, gap), and a butt's spacer and through-end mode | M | Each field round-trips through Undo; each refusal shows under its row |
| E5.3 | Pattern editing (E-UX-13): along, pitch, count, skips, expressions; Explode; D5 in the Pattern tool | M | `pattern-edit.spec`: pt1's count from 7 to 8 in one step equals `alukit do setPattern`; Explode makes plain bars that select |
| E5.4 | Part: Replace in its inspector; groove in the face list; offset | S | A T-nut moved from face +y to groove +y.1 derives where the CLI puts it |
| E5.5 | The corner inspector shows E1.4's mitre and splice arrangements | S | On a ground rectangle of one section, "Mitre" applies as one step, with the cuts the dry run showed |
| E5.6 | Each connection kind's actions in the menu: Edit, Change connector, Delete | S | Through `menu.spec` |

### 7.10 The e2e specs

| Spec | Owner | Holds |
|---|---|---|
| `menu.spec`, `select.spec`, `visibility.spec` | E2 | E2.1–E2.4 |
| `transform.spec`, `copy.spec` | E3 | E3.1–E3.7 |
| `ends.spec`; `edit.spec` (extended) | E4 | E4.1–E4.7 |
| `connections-edit.spec`, `pattern-edit.spec` | E5 | E5.1–E5.5 |
| `editing.spec` (new) | the integration pass | §12's A1–A13, scripted, each ending in an `alukit diff` or cut-list comparison against the CLI |

## 8. Sequencing

```
(a)(b)(c) merge ─► E0 contracts (alone, ~2 days)
                    ├─► E1 drop 1 (E1.5, E1.2, E1.3) ───────► E1 drop 2 (E1.1, E1.4, E1.6)
                    ├─► E2.1, E2.3–E2.7 ─(E1.5)─► E2.2, E2.8
                    ├─► E3.2–E3.5, E3.7 ──────────(E1.1)─► E3.1, E3.6, E3.8
                    ├─► E4.1–E4.7 (E4.1's words need nothing from E1)
                    └─► E5.1–E5.4, E5.6 ──────────(E1.4)─► E5.5
                                    ─► integration: editing.spec, design §6/§8, guide
                                    ─► designer review (§12)
```

1. E0 forks after (a)–(c) merge and lands alone, with the full gate (`CLAUDE.md`'s sequence).
2. E1's drop 1 merges first among the others; the UI streams order their tasks so that what needs
   E1 comes last.
3. One merge at a time, each with the full gate. A stream runs locally only its own specs plus
   `draw.spec` and `view.spec`, the two oracles.
4. The integration pass:
   - folds the decision notes into design §6 (`transform`) and §8 (the tools, the menu, the v1
     limits lifted);
   - updates the guide and the README;
   - scripts §12 as `editing.spec`.
5. Then the designer review runs §12 on the running app.

## 9. Risks

- **The oracles:**
  - `draw.spec`'s cut list must stay byte-identical. E1.2 changes `autoConnect`, which Draw sends
    at each end. Guard: E-UX-18, and the base frame has no angled end.
  - `view.spec` expects zero shader links per revision. Gizmos (E0.6), hide (E2.4) and drag
    previews (E3.8) are the new places a material could be created. Guard: E-UX-19, and each of
    those tasks extends `view.spec` with its own case.
- **The parallel work.** (a)–(c) are being written against today's `wiring.ts` and viewer, and
  their contracts are not visible to this audit. E0 adapts its signatures to what they land (the
  drag session, the handle module, the Move key) rather than this document's guesses; §7.3's
  shapes are the intent.
- **Browser chords:**
  - Ctrl/Cmd+D bookmarks, Ctrl/Cmd+A selects the page, Ctrl+C copies text. The handlers must take
    them only while the focus is on the view or the outline, and must call `preventDefault`.
    Whether Chromium lets a page take Cmd+D on a Mac is inferred, not measured; E3.3's spec
    checks it, with a fallback key in the menu.
- **Right-click vs right-drag.** The menu must open only on a right-click that did not move.
  E2.1's spec covers both.
- **Dry runs under load.** Previews follow E-UX-20. `transform` with `follow` on 1,000 bars needs
  a time test: E1.1 measures it on the 1,008-bar lattice the S1 notes used.
- **Amending a committed step** (SketchUp's "type again") is out (plan §7). So `4x` must be typed
  inside the session, and the review should check that people find that.
- **Param-driven moves** (E-UX-4) write `W + 100`. That is honest, but it can surprise someone who
  expected W itself to change. The step's words say what was written, and the review watches for
  it.
- **Public repository.** Fixtures added for the brace and the editing scenarios use the test or
  the shipped catalogs only, with generic names.

## 10. Later

| Deferred | Why |
|---|---|
| Join collinear bars (row 27), circular patterns (22) | New core commands for rare edits; undo covers a mistaken split |
| Pick-through cycling (7), distribute (12), nudge (13), plane lock (14), the up vector (30) | Niceties once the verbs exist |
| A rail's hole layout (32), stack and `held_by` editing (42) | Rare, and hand-edited by the acceptance frames' authors |
| Parts at a world pose (48), unplaced lines (49), runs by hand (35) | Mostly agent-written today |
| "Make parameter…" (50), persistent dimensions and guides (52), neighbour readouts (53) | After the review shows the need |
| Command search (56), saved views (58), pasting into another project | Not needed to edit a frame |
| Costs, price bands, offers, variants, checks: their commands have no app path | Not the 3D view's job: a records-and-order audit should take them |
| Project items: a plate or bent-angle editor (62) | A design tool of its own |
| Butt connectors drawn in 3D (43); variant scope from the app (62) | Owner calls (§11) |

## 11. Calls for the owner

1. **Variant scope from the app.** `only_in` and `not_in` on entities, and a variant's params and
   swaps, are CLI-only. Design call 35 kept variants a derivation of the document as written, and
   the plan deferred editing them. Should this round add "show only in variant…" to the menu and
   the inspector? *Default if no answer: not in this round.*
2. **Butt connectors drawn in 3D.** A butt's connector is counted, not placed (design §4.5's v1
   limit). Drawing it needs a placement rule in the core (large), so a corner would show its
   bracket as MISUMI's and FRAMEpro's do. Is that wanted now, or does it stay v1.1? *Default:
   v1.1; joint markers stay the 3D sign of a joint.*

## 12. Acceptance scenarios for the designer review

**How the review runs:**

- On the running app, at the integration head.
- On an empty project made by `alukit new --catalog forseti --currency BRL`, with each scenario
  following from the one before.
- Times are a person's at a steady pace, from the first click. Clicks and keys are counted.
  "Steps" are the server's log lines.
- Each scenario has a check a script can run. The integration pass's `editing.spec` runs the same
  checks, so the review judges the experience and the test holds the result.

| # | Task | Target | Check |
|---|---|---|---|
| A1 | Build a 1000 × 600 × 750 table frame of 40 × 40, with a shelf ring 250 up, W, D and H as params | ≤ 45 s, ≤ 8 clicks, ≤ 20 keys, 1 step | The cut list equals `alukit add frame --size 1000,600,750 --shelf 250 --params` on a scratch copy, byte for byte |
| A2 | Widen it by 100: (i) by editing W; (ii) on a copy of the frame made without params, by crossing-selecting the right side and moving it +100 along X | (i) ≤ 10 s, 1 step; (ii) ≤ 20 s, 1 step | Both cut lists equal a 1100-wide frame's |
| A3 | Move the shelf up 150 | ≤ 15 s, 1 step | The shelf rails' cuts are unchanged, their ends are 150 higher, and no diagnostic is new |
| A4 | Change all four legs to 40 × 80, the 80 along X | ≤ 30 s, ≤ 2 steps, the legs selected in ≤ 2 clicks | The rails' cuts equal the CLI's after the same edit |
| A5 | Add a diagonal brace in the back plane, from 100 above the bottom-left corner to 100 below the top-right corner, joined at both ends | ≤ 45 s, ≤ 2 steps | No error; both ends declared `angle`; the brace's cut equals a dry run of the same batch |
| A6 | Place an angle bracket on the front-left leg's inner face at 300, then mirror it to the front-right leg | ≤ 20 s for the mirror, 1 step | The copy is on the right leg's inner face at 300 (`alukit derive --select parts`) |
| A7 | Duplicate the top front rail 300 down, joined to the legs | ≤ 15 s, 1 step | Butts at both ends; its cut equals the top rail's |
| A8 | Four slats across the shelf, evenly spaced; then make it five by editing the pattern (or the array) | ≤ 30 s, then ≤ 10 s, 1 step each | Equal spacing within 0.01 mm; the count follows |
| A9 | Slide the bracket from 300 to 450 along its leg | ≤ 10 s, 1 step | `on.at_mm` is 450 |
| A10 | Delete the back top rail and its joints | ≤ 10 s, 1 step | The dialog lists the butts; no orphaned end; Undo restores it all |
| A11 | Hide the top ring, isolate one corner, show all | ≤ 10 s, no step | The document is unchanged (`alukit diff` empty) |
| A12 | On a project with a T-nut plate (a face connection), go from 2 bolts to 3 | ≤ 20 s, 1 step | The hardware count rises as `alukit do setConnection` says |
| A13 | Undo all of it | 1 key per step, each Undo naming its step | `alukit diff` against the empty project is empty |
| A14 | Mouse only: A3, A6 and A10 with the context menu and the pointer (typed values allowed) | ≤ 1.5 × the keyboard time | Same checks |
| A15 | Agent parity: replay the log's commands with `alukit do` on a scratch copy | — | `alukit diff` against the app's document is empty |

**The review also reports, as phase 4 did:**

- what a person tried first and did not find;
- whether the menu's wording matches the inspector's;
- whether `W + 100` surprised anyone (§9);
- whether the trackpad mode is usable (E-UX-17), on a real trackpad, since headless tests cannot
  judge it.

## 13. Sources

**In this repository:**

- `docs/design.md`: §4, §6, §7.3, §8.
- `docs/ux/plan.md`, `contracts.md`, `s5-decisions.md`, `review-phase4.md`.
- `skills/alukit/SKILL.md`.
- The code paths cited in each section.

**Measured:**

- Playwright probes on a scratch copy of `tests/fixtures/cart` and an empty Forseti project, at
  `b8ff033`.
- `alukit problems` and `alukit do --dry-run` on the frame and the brace.
- The screenshots in `img/editing-audit/`.

**Outside** (read or seen 2026-11-27; the label in §4 says which):

[onshape-frame]: https://cad.onshape.com/help/Content/frame.htm
[onshape-transform]: https://cad.onshape.com/help/Content/PartStudio/transform.htm
[onshape-keys]: https://cad.onshape.com/help/Content/Home/keyboard_shortcuts_and_hotkeys.htm
[onshape-vars]: https://cad.onshape.com/help/Content/variable.htm
[fusion-move]: https://help.autodesk.com/view/fusion360/ENU/?guid=SLD-MOVE-COPY-GEOMETRY
[fusion-params]: https://help.autodesk.com/cloudhelp/ENU/Fusion-Model/files/SLD-MODIFY-CHANGE-PARAMETERS.htm
[su-vcb]: https://help.sketchup.com/en/using-measurements-box
[bl-axis]: https://docs.blender.org/manual/en/latest/scene_layout/object/editing/transform/control/axis_locking.html
[bl-num]: https://docs.blender.org/manual/en/latest/scene_layout/object/editing/transform/control/numeric_input.html
[revit-beam]: https://help.autodesk.com/cloudhelp/2020/ENU/Revit-Model/files/GUID-97EC8054-9359-455A-9289-789425FBE6F2.htm
[tekla-handles]: https://support.tekla.com/article/selecting-several-handles-at-once
[tekla-fit]: https://support.tekla.com/cs/doc/mod_fit_part_ends
[tekla-conn]: https://support.tekla.com/doc/tekla-structures/2025/detail_1002_help
[frameforge]: https://wiki.freecad.org/FrameForge_Workbench
[misumi]: https://us.misumi-ec.com/service/promotion/frames/
[framepro]: https://boschrexroth.com/en/my/products/product-groups/assembly-technology/topics/aluminum-profiles-solutions-components/framepro-cad-plug-in
[vention-keys]: https://docs.vention.com/docs/design-shortcuts
[vention-insert]: https://docs.vention.com/docs/inserting-and-connecting-parts
[vention-faq]: https://vention.io/resources/faqs
[ideabuilder]: https://8020.net/ideabuilder
[tbuild]: https://www.tslots.com/tbuild-design-software
[item]: https://dk.item24.com/theme-world/linear-system/item-linear-motion-unitsr

**General CAD:**

- [Blender: axis locking](https://docs.blender.org/manual/en/latest/scene_layout/object/editing/transform/control/axis_locking.html)
  and [numeric input](https://docs.blender.org/manual/en/latest/scene_layout/object/editing/transform/control/numeric_input.html):
  docs, read through the manual's source.
- [SketchUp: the Measurements box](https://help.sketchup.com/en/using-measurements-box): docs.
- [Fusion: Move/Copy](https://help.autodesk.com/view/fusion360/ENU/?guid=SLD-MOVE-COPY-GEOMETRY):
  snippet.
- [Fusion: Change Parameters](https://help.autodesk.com/cloudhelp/ENU/Fusion-Model/files/SLD-MODIFY-CHANGE-PARAMETERS.htm):
  snippet.
- Onshape: [Frame](https://cad.onshape.com/help/Content/frame.htm) (docs),
  [Transform](https://cad.onshape.com/help/Content/PartStudio/transform.htm) (docs),
  [keyboard shortcuts](https://cad.onshape.com/help/Content/Home/keyboard_shortcuts_and_hotkeys.htm)
  (docs) and [variables](https://cad.onshape.com/help/Content/variable.htm) (snippet).
- [FreeCAD: FrameForge](https://wiki.freecad.org/FrameForge_Workbench): snippet.

**Structural precedents:**

- [Revit: beam end alignment](https://help.autodesk.com/cloudhelp/2020/ENU/Revit-Model/files/GUID-97EC8054-9359-455A-9289-789425FBE6F2.htm).
- Tekla: [selecting several handles](https://support.tekla.com/article/selecting-several-handles-at-once),
  [fit part ends](https://support.tekla.com/cs/doc/mod_fit_part_ends) and
  [end plate (1002)](https://support.tekla.com/doc/tekla-structures/2025/detail_1002_help).
- All snippets.

**Extrusion tools:**

- [MISUMI FRAMES](https://us.misumi-ec.com/service/promotion/frames/): snippet.
- [Bosch Rexroth FRAMEpro](https://boschrexroth.com/en/my/products/product-groups/assembly-technology/topics/aluminum-profiles-solutions-components/framepro-cad-plug-in):
  docs.
- Vention: [design shortcuts](https://docs.vention.com/docs/design-shortcuts) (docs),
  [inserting and connecting parts](https://docs.vention.com/docs/inserting-and-connecting-parts)
  (docs) and [FAQ](https://vention.io/resources/faqs) (snippet).
- [80/20 IdeaBuilder](https://8020.net/ideabuilder), [Tslots TBUILD](https://www.tslots.com/tbuild-design-software)
  and [item](https://dk.item24.com/theme-world/linear-system/item-linear-motion-unitsr): snippets.

**Not found:** an open-source T-slot web designer with direct 3D editing, documentation of a
groove-sliding interaction in any configurator, and documentation of trackpad navigation modes.
