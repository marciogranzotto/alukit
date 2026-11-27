# AluKit UX review, phase 4: the redesigned app, as it runs

*2026-11-27. An independent product-design review of the app after the six UX streams (S0 to S5)
merged, at `f264ea5`. It judges the running app against the goals of the three reviews
([flows and IA](flows-and-ia.md) = A, [heuristics and first run](heuristics-and-first-run.md) = B,
[visual design](visual-design.md) = C) and the [plan](plan.md). It changes no code.*

*Since fixed: the polish pass took up these findings; what changed, what it decided differently
and what it left is in [polish-decisions.md](polish-decisions.md). The findings below describe
the app at `f264ea5`.*

*Labels: **measured** means seen in the running app (Playwright) or printed by the CLI. **Read**
means read in the code at `f264ea5`, cited by file. **Inferred** means a judgement or an estimate.*

## Contents

1. [Verdict](#1-verdict)
2. [Method](#2-method)
3. [The three timed flows](#3-the-three-timed-flows)
4. [Findings, ranked](#4-findings-ranked)
5. [The coordinator's five items](#5-the-coordinators-five-items)
6. [What works, and must be kept](#6-what-works-and-must-be-kept)
7. [Notes on the record](#7-notes-on-the-record)
8. [Sources](#8-sources)

## 1. Verdict

**Yes, the app is now far more user-friendly than the one the three reviews walked.** The worst
problems they found are gone. Measured:

- An empty project opens on a start card with three ways in. A first bar takes 3 clicks and 4
  keys, about 22 s by estimate. Before, it took 5 clicks and 7 keys and hit a dead end on the way.
- A box frame is one step, with its cut lengths shown before it is made. Before, it took 16
  clicks and 35 keys and left 8 open corners.
- The joint preview says "b1 800 → 820" before the click, and a toast says it again after.
  Corners show as markers in 3D.
- The order's state is always in view, and problems are shown in 3D with Show.
- Delete lists what else goes. Undo says whose step it takes back.
- Agent edits arrive with a name, a Show and an Undo.

Where it still is not friendly, in order of harm:

1. **The template path's payoff is hollow.** The box frame reads **Ready to order** at once, but
   the order buys 12 bars and nothing to join them. The 8 butts name no connector, and nothing in
   the app says so (B1).
2. **The card's first way in cannot start on its own.** The box frame column asks you to "arm a
   bar in the parts bin" first: app jargon, and the fix lives outside the card (M1).
3. **Some status signals mislead.** The Problems tab shows a green "Every check passes" while a
   warning is listed (M3). A length typed with no direction does nothing and says nothing (M2).
4. **The canvas is crowded.** The coach strip, the toasts and the read-only label collide at its
   top. The command bar covers the model at its foot, and Fit ignores it (M4, M5).
5. **The narrow columns cut off the useful words.** The outline cuts off the cut lengths (M7),
   and the box frame keeps two forms that disagree mid-gesture (M6).

None of these needs a new concept. Each is a fix to something the streams built, and section 4
gives each fix.

## 2. Method

- **Build:** `f264ea5`, `pnpm build`, then `alukit serve` on scratch copies:
  - the README's project: `alukit new --catalog forseti --currency BRL`;
  - a bare `alukit new` project, which gets `std` only;
  - `tests/fixtures/cart` with its catalogs;
  - small variants made through the CLI: a box frame made with `alukit add frame`, and an
    unjoined corner.
- **Driving:**
  - Playwright scripts in headless Chromium (SwiftShader), one browser and one page at a time,
    under `nice -n 10`.
  - 1440 × 900 and 1280 × 800, in the dark and light themes.
  - The scripts clicked, typed, read `window.__alukit` and the DOM, and ran the CLI as an oracle
    (`alukit order`, `bom`, `problems`).
  - They were throwaway and are not committed.
- **Reading:** the reviews and the plan, for the goals. Code was read only to explain a
  measured behaviour.
- **Time:**
  - The machine was shared and heavily loaded, so the app response times quoted are upper
    bounds.
  - The human times are **Keystroke-Level Model** estimates (Card, Moran and Newell 1980, with
    Kieras's operator values):

    | Operator | Time |
    |---|---|
    | K, a key | 0.28 s |
    | P, point | 1.1 s |
    | A click | 0.2 s |
    | H, hand to the keyboard | 0.4 s |
    | M, a decision | 1.35 s |
    | Reading | 4 words a second |

  - KLM models an error-free run, so the places where a newcomer would stall are added as
    ranges. All human times are **inferred**.
- **Severity:**
  - **blocker:** the task's outcome is wrong or out of reach without help;
  - **major:** a first-time user stalls or is misled, and a workaround exists;
  - **minor:** it slows or confuses, and recovery is easy;
  - **polish:** a detail.

  Each finding names the heuristic it breaks: Nielsen's ten (H1 to H10, as in B), or a WCAG 2.2
  criterion.

Screenshots are in [`img/review4/`](img/review4/), cited by number.

## 3. The three timed flows

### 3.1 A first bar from an empty project (target: 30 s)

The README's project, the start card's "Draw the first bar" way.

| # | What the user does | Clicks | Keys | Decisions | Would a first-timer know? | KLM, s |
|---|---|---:|---:|---:|---|---:|
| 1 | Reads the card's three ways and picks "Draw the first bar" | | | 1 | Yes, but the box frame column comes first, and stall A waits there | 7.6 |
| 2 | Clicks the 40 × 40 chip, out of 15 | 1 | | 1 | Mostly: the sizes are a maker's words. Four chips with blank thumbnails are linear guides (M8) | 2.7 |
| 3 | Takes the preselected profile and finish | | | 1 | Takes PF20-15 *V-Slot, Canal 6*, not the Básico (M8) | 1.4 |
| 4 | Start drawing | 1 | | | Yes. Measured 277 ms to the drawn step | 1.6 |
| 5 | Reads the coach: "Click where the bar starts" | | | 1 | Yes | 2.9 |
| 6 | Clicks a point on the grid | 1 | | | Yes | 1.3 |
| 7 | Moves the pointer up | | | 1 | **Not told**; this is stall B | 2.5 |
| 8 | Types `800`, presses Enter | | 4 | | Yes. Measured 142 ms to the drawn bar | 1.7 |
| | **Total** | **3** | **4** | **5** | | **≈ 22** |

**It meets the target**, with the plan's goals visible on the way:

- the default is written as one step ("Undo · you: change the project's defaults");
- the bar is sold;
- the pill turns green;
- the outline and the rail count the new piece (**measured**).

Where a newcomer would stall (**inferred**, except where marked):

- **A:** they start in the box frame column, the first one. The W, D and H fields take input,
  then the button stays disabled under "Choose the frame's profile first: arm a bar in the parts
  bin". About +10 to 20 s.
- **B:** they type the length straight after the click, as the coach's step 2 says ("Type its
  length and press Enter"). With the pointer unmoved, Enter makes no bar and shows no message
  (**measured**, [03](img/review4/03-typed-no-direction.png)). About +5 to 15 s, or giving up
  (M2).
- **C:** they read the five 40 × 40 names to choose one. Each is about 70 characters, 36 of
  them a shared prefix. About +12 s, which gives about 34 s and misses the target.

### 3.2 A box frame from an empty project (target: 60 s)

The path the card itself points to. The box frame column, then "arm a bar in the parts bin",
then Browse catalog… and Use for drawing, then back to the card's form.

| # | What the user does | Clicks | Keys | Decisions | Would a first-timer know? | KLM, s |
|---|---|---:|---:|---:|---|---:|
| 1 | Reads the card and starts in "A box frame" | | | 1 | Yes: it is the goal, and it comes first | 5.1 |
| 2 | Reads "arm a bar in the parts bin", then finds Parts at the top left | | | 2 | **No**: *arm* and *parts bin* are the app's own words (M1) | 2.7 |
| 3 | Clicks Browse catalog… | 1 | | | Yes | 1.3 |
| 4 | Types `40x40` | | 5 | | Yes: profiles now rank first. Measured about 0.9 s to results | 2.7 |
| 5 | Reads the five profile rows and clicks the Básico | 1 | | 1 | Yes: full names, kg/m and price | 15.2 |
| 6 | Leaves the finish preselected and clicks Use for drawing | 1 | | 1 | Yes | 2.7 |
| 7 | Back on the card, which now says "In Perfil … Básico" | | | 1 | Yes | 1.4 |
| 8 | Clicks W and types `1000` Tab `600` Tab `800` | 1 | 12 | | Yes. Measured 521 ms to the cut lengths, from a dry run | 5.6 |
| 9 | Reads "posts 4 × 800, base ring 2 × 920, 2 × 520…" and clicks Make the frame | 1 | | 1 | Yes. Measured about 0.6 s to the drawn frame | 6.3 |
| | **Total** | **5** | **17** | **7** | | **≈ 43** |

That is about 31 s if the user takes the first profile row. **It meets the target only if step 2
is decoded at once.**

Other paths (**measured** step counts; the times are **inferred**):

- **Through the chips:**
  - The clicks are 40 × 40, then Start drawing, then Box frame in the rail; the right panel's
    form takes W, D and H, then Make the frame.
  - That is 5 clicks and 12 keys, 2 more clicks to change the profile, and about 31 s with no
    stall.
  - Its stall: Start drawing closes the card and turns on a different tool, the draw tool, so
    the frame form is gone until the user finds Box frame (G) in the rail. At 1280 px the rail is
    icons only, and the coach strip covers part of it (M4).
- **Through the gesture**, for an expert with a bar armed:
  - G, a click on a corner, `1000,600` Enter, then `800` Enter.
  - That is 1 click and 14 keys, about 10 s. From an empty project through the chips it was 5
    clicks and 14 keys in all.
- **Stall D:** filling W, D and H in the card's column before reading the gate. About +10 to
  20 s, which gives 53 to 63 s, at the limit.

### 3.3 A READY order on the template path

| Step | What happens (**measured**) |
|---|---|
| Make the frame | The step is drawn about 0.6 s after the click, and the pill turns green: **Ready to order**. Order & costs says "Every one of 1 supplier can be ordered from as it stands", 1 133.44 BRL. Problems says "Every check passes" ([07](img/review4/07-frame-ready-no-connectors.png)) |
| What the order holds | 12 bars in three cut lengths, 1 BOM line. **No connector and no fastener**: the 8 butts name no connector. A new project has no `defaults.butt`, and the frame form's "connector" is an empty text field |
| What tells the user | Nothing in the order, the Problems sheet or the pill. Only the corner inspector, if opened, says "no connector named" in grey |
| What it takes to add brackets | **Before** Make the frame: type an item id such as `forseti:CT75-06` into the frame form's connector field. **After**: for each butt, expand a corner (▸), click the butt, then choose from **101 connectors not filtered by fit**. The list includes 20 mm V-slot connectors for a 40 mm Canal 8 butt ([08](img/review4/08-butt-connector.png)). That is 3 clicks and a scan per butt, about 24 clicks for 8 butts (that count is inferred). Settings has no default butt connector, and a selection of several entities shows no fields |
| After one connector | Still READY. The BOM gains 2 × CT75-06, with no mass and no screws or T-nuts |

**Verdict:** "ready" takes no extra step, but it is not an order that builds the frame. Review
B's target was "a READY order on the template path with no detour, because the template asks for
the finish". The app meets its letter and misses its intent. This is finding B1, a blocker.

## 4. Findings, ranked

### Blocker

#### B1. The box frame reads "Ready to order" with nothing to join it

- **Evidence:**
  - [07](img/review4/07-frame-ready-no-connectors.png) and
    [08](img/review4/08-butt-connector.png).
  - `alukit order` on the frame prints READY with three bar lines. The BOM has one line
    (**measured**).
  - The order rules treat "a butt with no connector" as a connection "that buys nothing of its
    own" (`src/core/order/rules.ts:226`, **read**).
  - The plan expected otherwise: S2's done-when for this path says "if a missing connector or
    price blocks it, the spec names that problem". Neither blocks.
- **Principle:**
  - H1, visibility of system status: the one status that matters most at the payoff is wrong.
  - H5, error prevention.
  - The README's promise: an order list "that tells you when it is not ready to send".
- **Fix:**
  1. **Ask for the joint in the template.** `FrameForm` (`src/ui/tools/forms/FrameForm.tsx`)
     replaces the free-text "connector" with a **Joined with** select. It lists the connectors
     whose `fits` holds the chosen bar's system (for PF40-01, `forseti:s40-c8`), with a quantity
     per end. "Nothing: I will join them myself" is an explicit choice. When the project has no
     `defaults.butt.connector`, the choice goes out as
     `setProject {defaults: {butt: {connector, qty}}}` in the **same batch** as `addFrame`, so
     it is one undo step. Bars drawn later then butt with it too.
  2. **Say it when it is missing.** Add a problem, code `butt-no-connector` and group `warning`,
     to `src/core/problems/`. It lists every butt whose connector resolves to nothing. The title
     reads "8 butts name no connector: the order buys nothing to join them". It has a Fix, "Set
     a connector for all 8…", which opens the same fit-filtered picker and sends one batch.
     The Order sheet's verdict strip names it ("Ready, but 8 joints buy no hardware"). An order
     rule `no-connector`, default `warn`, lets a project make it block, like the other rules in
     Settings.
  3. **Settings** (`src/ui/shell/Settings.tsx`): add "Default butt connector" and quantity. The
     `setProject` schema already takes `defaults.butt`; only the form lacks it.
  4. **The inspector's connector select** (`src/ui/inspector/OtherFields.tsx`) lists "Fits these
     bars" first and "Other connectors…" after. A selection of several butts shows one shared
     Connector field, which sends one batch.

### Major

#### M1. The start card's box frame cannot choose its own profile

- **Evidence:** [01](img/review4/01-start-card-1440-dark.png) and
  [02](img/review4/02-start-card-1280-light.png).
  - The first column opens on an amber "Choose the frame's profile first: arm a bar in the parts
    bin" (`FrameForm.tsx:145-149`, **read**).
  - The profile chooser sits in the next column, and its button (Start drawing) closes the card
    and turns on Draw (**measured**).
- **Principle:**
  - H6, recognition rather than recall.
  - H2, match with the real world: *arm* and *parts bin* are the app's words.
  - H3, user control.
  - B's own wireframe (§4.4) put Profile and Finish inside the template form.
- **Fix:**
  - Make the profile **step 1 of the card**, shared by both ways: size chips, then profile, then
    finish, in a strip under the catalog line.
  - Choosing sends today's `setProject {defaults: {bar}}` without closing the card or switching
    tool.
  - Step 2 is then two equal buttons: "Make a box frame" (W, D, H, Make) and "Draw the first
    bar".
  - The example stays a one-line way beside them.
  - Delete the amber gate copy. While no profile is chosen, the W, D and H fields stay usable,
    and Make the frame says "pick a profile above".

#### M2. A length typed with no direction does nothing, silently

- **Evidence:** [03](img/review4/03-typed-no-direction.png).
  - The test was a click on the grid, then `800` Enter with the pointer unmoved. No bar was made
    and no message appeared. The command bar kept "800 mm, from grid (200, 100, 0)"
    (**measured**).
  - `drawEnd()` returns nothing when a value is typed and there is neither a pointer end nor a
    locked axis (`src/ui/tools/wiring.ts:229-232`, **read**).
- **Principle:**
  - H1.
  - H9, help users recognise and recover from errors.
  - The coach's step 2 tells a newcomer to do exactly this.
- **Fix:**
  - When `drawEnd()` has a typed value and no direction, Enter says why, inline in the command
    bar's result: "Which way? Move the pointer, or press → ← ↑".
  - While digits are typed with no direction, the result reads "800 mm from (200, 100, 0): point
    the way".
  - The coach's step 2 becomes "Point the way, type the length, press Enter".
  - For the very first bar of a project, a default of +Z (a post) would also be defensible.

#### M3. The Problems tab says "Every check passes" while a warning is listed

- **Evidence:** [12](img/review4/12-warning-only.png). The project has an unjoined corner, shown
  as ⚠ on both bars and "Corner (0, 0, 800) · open" in the outline. The Problems tab shows a
  green ✓, titled "Every check passes" (**measured**).
  - On the cart, the badge reads ⚠ 1 while the sheet lists 4 warnings (**measured**).
  - Cause: the badge counts `answer.order.warnings`, the order's warnings. The sheet counts
    every problem in group `warning` (`src/ui/problems/source.ts:58-61`, **read**).
- **Principle:**
  - H1.
  - H4, consistency: two counts of one thing, side by side.
- **Fix:**
  - `problemCounts` counts the groups of `answer.problems`, the same way the sheet's summary
    does, and the badge shows blocks, errors and warnings.
  - `order.warnings` stays for the Order tab's own badge.
  - Fix the title's grammar ("1 warning").
  - Test: on the warning-only project, the badge reads ⚠ 1.

#### M4. Overlays at the top of the canvas collide

- **Evidence**, all **measured**:
  - [03](img/review4/03-typed-no-direction.png): the coach strip lies over the rail's active
    tool (Draw bar) and Connect, and over the second row of view toggles.
  - [06](img/review4/06-frame-gesture-1280.png): at 1280 px the strip's text is cut off, and its
    close button falls outside its own clip. The strip ends at x 951, the button sits at x 986
    to 1012, and the viewport ends at x 954.
  - The coach is Draw's ("1. Click where the bar starts") but shows while Box frame is the tool,
    and it ticks its steps for a frame.
  - [11](img/review4/11-readonly-and-agent.png): an agent's toast covers the view toggles and
    hides the read-only label, "The files have an error: this is…".
- **Principle:**
  - H8, aesthetic and minimalist design.
  - H1: the label that says what you are looking at is hidden.
  - Fitts's law: the active tool's own button is covered.
- **Fix:**
  - Give the canvas one **message lane** under the view toolbar's last row. Its left edge is
    the rail's right edge plus 8 px; its width is the canvas width minus the rail.
  - It stacks, top to bottom: the read-only label, the coach, then toasts. Toasts stay in the
    lane's right half and never go above the toolbar's bottom edge.
  - The coach wraps instead of `overflow: hidden`, and puts its × in the first grid column so it
    is never clipped.
  - Each tool gets its own coach. The frame tool's reads "1 click a corner · 2 W, D · 3 H"; with
    no coach for a tool, none shows.

#### M5. The command bar covers the model, and Fit ignores it

- **Evidence**, all **measured**:
  - At 1440 × 900 with the sheets open, the frame's front post sits under the command bar
    ([07](img/review4/07-frame-ready-no-connectors.png)).
  - At 1280 × 800, after Fit, the corner (1000, 0, 0) projects inside the bar's rectangle. The
    bar is 96 px tall on a 688 px canvas, and it is two rows at both widths.
- **Principle:**
  - Do not cover the work.
  - H1: what Fit promises ("see everything") is not what it shows.
- **Fix**, either of two:
  - (a) Make the command bar a **layout row** under the canvas while a tool is active, as the
    status bar already is (S2 decision 1).
  - (b) Keep it floating, and pass its height to the viewer as a bottom inset. `fitSelection`
    and `fitBox` then frame into the visible rectangle, through the camera's view offset.
  - In both cases, fit the bar into one row at 1280 px or wider: move Plane, Join ends and
    Corners into an "Options ▾" popover.

#### M6. The box frame lives in two forms that disagree

- **Evidence:** [06](img/review4/06-frame-gesture-1280.png).
  - With G active, the command bar holds the value, the profile, the rings, the corners and "as
    params". The right panel's form holds W, D, H, the corner, the rings, the shelf, the corners,
    the connector and "as params".
  - Mid-gesture, `800` was typed in the command bar while the panel still said "give the height
    H", with an empty H field (**measured**).
- **Principle:**
  - H4.
  - One source of truth. D-UX-5 sent long forms to the right column, and the command bar now
    duplicates their options.
- **Fix:**
  - With the frame tool on, the command bar shows only the prompt, the value field and its
    result.
  - The options live in the panel alone.
  - The typed value updates the frame draft on every keystroke, not on Enter, so the panel's W,
    D and H and its cut lengths follow the typing.

#### M7. Outline rows hide the cut length

- **Evidence:** [07](img/review4/07-frame-ready-no-connectors.png) and
  [09](img/review4/09-cart-overview.png).
  - A row reads "b1 post, front left · Perfil Estrutural em Alumínio 40×40 Básico – Canal 8 ·
    800.00 mm". In the 272 px column, every row of the frame and the cart is cut off before the
    length (**measured**).
  - The "new · the CLI" marks shorten the rows further
    ([13](img/review4/13-delete-cascade.png)).
- **Principle:**
  - H6.
  - U19's goal ("rows read label · item name · cut length") is only half met.
- **Fix:**
  - Lay the row out as a grid: the label (or the item's short name when there is no label),
    cut off at its end, then the cut length in a fixed right-aligned `tabular-nums` column that is
    never cut.
  - The item's full name moves to the row's tooltip, and to the group head when grouped by item.
  - Use the catalog code plus size as the short name ("PF40-01 40×40").

#### M8. The 40 × 40 chip preselects a V-slot profile, and the chips mix in linear guides

- **Evidence:**
  - After the 40 × 40 chip, the profile select holds PF20-15 "V-Slot – Canal 6", the first of
    five by code (**measured**). A newcomer who takes the defaults draws a profile from another
    slot system than most 40-series fittings.
  - The 15 × 15, 20 × 18, 23 × 22 and 28 × 26 chips have blank thumbnails, black in the light
    theme. They are single linear guides, not frame profiles
    ([02](img/review4/02-start-card-1280-light.png)).
- **Principle:**
  - Sensible defaults.
  - H5.
  - H2: the vendor's long names, which share a 36-character prefix, hide the difference.
- **Fix:**
  - Order the profiles within a size by how common they are in the catalog: the system shared
    by the most connectors that fit, then exact sections before parametric ones. That puts PF40-01
    first.
  - Show the differing part of the name first ("Básico · Canal 8 · 126.50 BRL/m") and the full
    name as a tooltip.
  - Put linear guides under their own "Linear guides" heading after the frame profiles, or
    leave them out of the first-bar chips.

### Minor and polish

| # | Sev | Finding | Evidence | Principle | Fix |
|---|---|---|---|---|---|
| m1 | minor | **Selection, hover and warning share one amber band.** In the dark theme, selection `#FFA133`, hover `#FFD29A` and warning `#EBC84A` are 13 to 18 apart in ΔE2000, at CIELAB hues 68°, 76° and 91° (`src/ui/theme/tokens.ts`, **read**; computed). On unselected bars, the warning outline reads as a selection | [12](img/review4/12-warning-only.png), [10](img/review4/10-show-in-3d.png) | C's rule, one meaning per colour; WCAG 1.4.1 is met, since badges carry a glyph | Draw warning outlines **dashed** (`LineDashedMaterial`) and leave the amber band to the selection. Or drop bar outlines for warnings and keep the ⚠ badge, outlining only blocks and errors in red. Hover changes lightness only (+12 % L), with no hue shift |
| m2 | minor | **The status bar repeats the tool's prompt** word for word, and cuts it off at 1280 px | [03](img/review4/03-typed-no-direction.png), [06](img/review4/06-frame-gesture-1280.png) | H8 | While the command bar shows, drop the prompt from the status bar; the live region still announces it. In Select, where the bar is hidden, the status bar keeps it |
| m3 | minor | **"Anchor c"** is a code, not a truncated word: the label is 47 px wide and not cut (**measured**), and the inspector says "centre". The Corners select *is* cut ("the project's: the upright runs") | [03](img/review4/03-typed-no-direction.png) | H2 | Show the word the inspector uses ("Anchor: centre"). Shorten the select's text ("Corners: post through"), and keep the long wording in the options |
| m4 | minor | **Use for drawing turns Draw on under the open start card.** The command bar shows through behind the card, and digits typed outside a field go into it | [05](img/review4/05-use-under-card.png) | H1, H3 | While the card is open, Use for drawing arms the palette and leaves the tool alone (the card's frame form then uses it), or closes the card |
| m5 | minor | **At 1280 × 800 the card scrolls** (785 px of content in 616 px), the example way is out of sight with no cue, and the frame column puts 12 controls up front | [02](img/review4/02-start-card-1280-light.png) | H8; progressive disclosure | W, D, H and Make up front; rings, shelf, corners and connector under "More options". Below 1400 px, the example becomes a link under the title |
| m6 | minor | **The connector select overflows the inspector**: it is as wide as its longest name, about 100 characters, and runs past the window's edge. It lists all 101 connectors | [08](img/review4/08-butt-connector.png) | Layout; H6 | `max-width: 100%` on `.insp-select`; the fit-first grouping of B1 (4) |
| m7 | minor | **Show's callout is vague.** Its title is the generic "A joint problem at c21", and the measurement is only in the sheet. It has a Show button inside Show, and two counters ("1 of 3", the targets, against "problem 7 of 12" in the status bar) | [10](img/review4/10-show-in-3d.png) | H1, H9 | The callout shows the detail ("b18's end overhangs b9 by 30 mm"). Drop the inner Show. Name the stepper "target 1 of 3". Make problem titles specific in `src/core/problems/` |
| m8 | minor | **Joined-corner markers flood a busy frame**: a green dot at every joined corner of the cart (33 joints), competing with its 12 problem badges | [09](img/review4/09-cart-overview.png), [14](img/review4/14-cart-1280-light.png) | H8; signal over noise | By default draw only *open* and *failed* markers, and joined ones when a corner is hovered or selected or the Joints toggle is pressed. Or fade joined markers below a screen size |
| m9 | minor | **The box frame shows no box while it is drawn**: a diagonal for W × D, a vertical line for H. The frame first appears when it is made | [06](img/review4/06-frame-gesture-1280.png) | H1; B §5.2's ghost | Draw the footprint as four ghost bars at the size stage, and the 12 bars at the height stage, from the dry run the form already asks for. Show "posts 4 × 800 · rings 920 / 520" in the command bar's result |
| m10 | minor | **Machine words remain.** Settings labels its order rules with codes ("check-error", "est-price", "option-not-sold"). The catalog card shows "shape tslot", "system forseti:s40-c8" and "fidelity exact", and its price column wraps to four lines. Catalogs are added by typing an id. On a `std`-only project the card does not offer a profile catalog | [04](img/review4/04-catalog-card.png) | H2 | Words with the code small ("A price is an estimate · est-price"). On the card, "T-slot, Forseti 40 system" and "Section: exact". List the built-in catalogs with Add buttons (S2 decision 11 asked S1 for the list) |
| m11 | minor | **After Make the frame the tool stays Box frame**, so the sheets never open on the first output (S2 decision 3 opens them only in Select), and a stray click starts a second frame's gesture | [07](img/review4/07-frame-ready-no-connectors.png) | H1: the payoff moment, the cut list, is not shown | A frame made from the start card returns to Select, so the sheets open on the cut list. The G tool may stay on, as CAD tools do |
| p1 | polish | The view cube's targets are 10 to 16 px (**measured**) | — | WCAG 2.5.8 | Hit areas of at least 24 px around each face |
| p2 | polish | Disabled primary buttons look enabled in the dark theme (Make the frame, Start drawing) | [01](img/review4/01-start-card-1440-dark.png) | H1 | Disabled: a neutral fill and `--text-3`, not a dimmed accent |
| p3 | polish | "new · the CLI" marks sit on every row after a batch | [13](img/review4/13-delete-cascade.png) | H8 | One mark on the group head ("12 new, from the CLI") |
| p4 | polish | The frame form says "In Perfil …"; its corner fields show no x, y, z (they have accessible names only) | [06](img/review4/06-frame-gesture-1280.png) | H2 | "Profile: … Change"; small x, y, z prefixes |

## 5. The coordinator's five items

| Item | Verified? | Severity | Where |
|---|---|---|---|
| Warning outlines on bars look close to the amber selection colour | **Yes.** The two colours are 17.7 ΔE2000 apart, hover sits between them, and an unselected warning bar reads as selected | minor | m1 |
| The box frame form appears in the command bar and in the right panel | **Yes**, and the two disagree mid-gesture | major | M6 |
| The command bar overlays part of the model | **Yes.** Fit lets the model run under it | major | M5 |
| The status line repeats the tool's prompt | **Yes**, word for word | minor | m2 |
| A truncated label, "Anchor c…", in the command bar | **Partly.** The label is not cut: "c" is the anchor's code, which reads as a cut word. The Corners select next to it is cut | minor | m3 |

## 6. What works, and must be kept

Keep each of these through the fixes above. Several of the fixes extend them.

- **The start card**: three ways in, Esc to close, and `?` to show it again.
  - The example loads as one undoable step.
  - The size, then profile, then finish choice makes the default sold, so the README's old
    first error (`option-not-sold`) cannot happen (**measured**: the first bar's order is READY).
- **The command bar's typed values**:
  - a live result ("800 mm, from grid (0, 0, 0), along +Z");
  - units, params and expressions;
  - precise inline errors ('"Q" is no param of this project').
- **The joint preview and the step toast**:
  - "will butt on b1 · cut 580 · b1 800 → 820 · Tab: flip" before the click;
  - "you: add bar b2, joined at 1 end · b1 800.00 → 820.00 mm · Show · Undo it" after it.
  - This is A's and B's worst finding, solved (**measured**).
- **The box frame as one step**:
  - its cut lengths come from a dry run before Make;
  - all eight corners are joined;
  - bars are labelled "post, front left", "base rail, front".
- **The readiness pill**: always visible, honest on the cart ("Blocked · 6 things to resolve"),
  and it opens Order & costs on its verdict strip.
- **The Problems sheet**: grouped by consequence, in plain words, with the rule's code shown
  small, and with Show and Fix.
- **Show in 3D**: it frames, dims the rest, opens a callout with a stepper, says "Showing problem
  7 of 12 · Esc to leave", and lists the problems in the inspector
  ([10](img/review4/10-show-in-3d.png)).
- **Delete**: "Delete 3 things? … bar b1, butt c1, butt c5 … One step: Undo brings it all back"
  ([13](img/review4/13-delete-cascade.png)).
- **History in words, and presence**:
  - "Undo · claude: add bar b35";
  - the agent's toast with Show and Undo it;
  - the presence chip in the status bar ([11](img/review4/11-readonly-and-agent.png)).
- **The corner inspector**: the arrangements in a builder's words ("Rail X runs through · b1 760,
  b5 960, b7 520 · b1 stands on it"), and "Apply to 8 matching corners".
- **The catalog overlay**: for `40x40` the five profiles rank first, with full names, kg/m, the
  "from" price and section thumbnails ([04](img/review4/04-catalog-card.png)).
- **Read-only**: the banner names the entity and the field, with "Did you mean "anchor"?", and
  disabled tools say why in their titles.
- **The 3D encodings**:
  - joint markers by state, and problem badges with glyphs (not colour alone);
  - a hover tint with its label;
  - a selection label with the cut and its ends;
  - the cut list's row lighting up for a selected bar.
- **Accessibility**:
  - the skip link comes first in the Tab order, then the top bar, then the bin;
  - a 2 px focus ring in its own colour (`#74B4FF` dark, `#1F63C6` light);
  - the sheets are a tablist;
  - a sweep of every visible HTML text node found none under WCAG 1.4.3 in either theme. The
    only hits were SVG labels whose CSS colour is not the drawn fill.
- **The light theme** is coherent in the panels, the tables and the viewport
  ([14](img/review4/14-cart-1280-light.png)).

## 7. Notes on the record

- `tests/e2e/first-run.spec.ts` still holds `test.fixme("the box frame way reads READY…")`. The
  way now exists and reads READY (**measured**), so the fixme is stale. It should become a test,
  and once B1 is fixed that test should also check that the order holds the joining hardware.
- The plan's S2 done-when expected a missing connector to block the box frame's order. It does
  not: the order rules treat a connector-less butt as buying nothing (B1). The plan's sentence
  describes an outcome the code never had, and the template work should settle it.
- S2's note says the card "shows two ways" until S5.7 merged (decision 10). S5.7 has merged, and
  the card shows three, so the sentence is now history and not a current state.

## 8. Sources

- Card, Moran and Newell, "The Keystroke-Level Model for User Performance Time with Interactive
  Systems", *Communications of the ACM* 23(7), 1980,
  [doi:10.1145/358886.358895](https://doi.org/10.1145/358886.358895).
- Kieras, "Using the Keystroke-Level Model to Estimate Execution Times", University of Michigan,
  2001 (the operator values used here).
- Nielsen, [10 Usability Heuristics for User Interface Design](https://www.nngroup.com/articles/ten-usability-heuristics/).
- W3C, [WCAG 2.2](https://www.w3.org/TR/WCAG22/): 1.4.1, 1.4.3, 2.5.8.
- CIE, CIEDE2000 colour difference, as in Sharma, Wu and Dalal, "The CIEDE2000 Color-Difference
  Formula: Implementation Notes", *Color Research and Application* 30(1), 2005,
  [doi:10.1002/col.20070](https://doi.org/10.1002/col.20070).
- AluKit: [plan.md](plan.md), [s2-decisions.md](s2-decisions.md),
  [s5-decisions.md](s5-decisions.md), and the three reviews linked at the top.

### The screenshots

| # | Shows |
|---|---|
| [01](img/review4/01-start-card-1440-dark.png) | The empty README project at 1440 × 900, dark: the start card, with the box frame's gate |
| [02](img/review4/02-start-card-1280-light.png) | The same at 1280 × 800, light: two columns, the example out of sight, blank linear-guide chips |
| [03](img/review4/03-typed-no-direction.png) | `800` Enter with no direction: no bar and no message; the coach over the rail; the prompt repeated; "Anchor c" |
| [04](img/review4/04-catalog-card.png) | The catalog for `40x40`: profiles first, and the card's remaining schema words |
| [05](img/review4/05-use-under-card.png) | After Use for drawing: Draw on, the command bar behind the start card |
| [06](img/review4/06-frame-gesture-1280.png) | The G gesture at 1280: the two forms disagree, the frame preview is only a line, the coach is Draw's and cut off |
| [07](img/review4/07-frame-ready-no-connectors.png) | The frame made: Ready to order with no hardware; the command bar over the front post; cut-off outline rows |
| [08](img/review4/08-butt-connector.png) | A butt's inspector: "none named", and a select as wide as its longest name |
| [09](img/review4/09-cart-overview.png) | The cart: the pill, the badges, the joint markers, the rail's counts |
| [10](img/review4/10-show-in-3d.png) | Show on c21: framing, dimming, the callout, the inspector's problems |
| [11](img/review4/11-readonly-and-agent.png) | Read-only after a misspelt field, with an agent's toast over the "last good state" label |
| [12](img/review4/12-warning-only.png) | An unjoined corner: warnings on the bars and in the outline, a green ✓ on the Problems tab |
| [13](img/review4/13-delete-cascade.png) | Delete on a post: the cascade dialog |
| [14](img/review4/14-cart-1280-light.png) | The cart at 1280 × 800, light |
