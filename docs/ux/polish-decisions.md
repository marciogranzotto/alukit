# AluKit UX, the polish pass: the phase-4 review's findings fixed

*2026-11-27. Fixes the findings of the [phase-4 review](review-phase4.md), each at its cause,
within the [plan](plan.md) (§3, D-UX-n) and [contracts.md](contracts.md). Labels: **measured** (a
test, a run or the CLI says so), **read** (from the code), **inferred**. After-screenshots are in
[img/polish/](img/polish/).*

## Done

| Id | What changed | Where | Held by |
|---|---|---|---|
| B1 (1) | The box frame asks how its corners are joined: **Joined with**, the connectors that fit the profile first, or "Nothing: I will join them myself". Chosen, it becomes `defaults.butt` in the frame's own step (one undo). With no choice and no project default, the form and the gesture's last Enter say what is missing | `tools/forms/FrameForm.tsx`, `tools/commands.ts` (`frameBatch`), `common/ConnectorSelect.tsx` | `commands.test.ts`; `first-run.spec.ts` (both box-frame tests), `frame.spec.ts` |
| B1 (2) | `butt-no-connector`: the check notes each butt with no connector while the project names no default; the problem model folds those notes and the order's reason into **one** problem, "N butts name no connector: the order buys nothing to join them", with a Fix that picks a connector (fit first) and makes it the default, one step | `core/check/joints.ts`, `core/check/check.ts`, `core/problems/problems.ts`, `problems/Fixes.tsx` | `core/check/joints.test.ts`; `first-run.spec.ts` ("joined with nothing") |
| B1 (3) | Order rule `no-connector`, default `warn`; a project may set `block` or `off` | `core/order/rules.ts`, `core/project/schema.ts`, design §5.5, guide | `joints.test.ts`, `cart.test.ts`, the cart's hand calculation |
| B1 (4) | Settings sets the default butt connector and its quantity (fit to the default bar first). A butt's Connector lists what fits the joined bars first; several selected butts share one Connector field, one step | `shell/Settings.tsx`, `inspector/OtherFields.tsx` (`ButtConnector`), `inspector/Inspector.tsx` | `shell/settings.test.ts` |
| B1 (pill) | While the order warns, the readiness pill reads "Ready, N warnings" in the warning style, its title naming them; the Order sheet's verdict reads "Ready, but check first" and lists them. Never a plain green READY | `shell/readiness.ts`, `TopBar.tsx`, `tables/OrderCosts.tsx` | `problems/source.test.ts`; `first-run.spec.ts` |
| M1 | The start card has one first step, the profile (size, profile, options), shared by "A box frame" and "Or the first bar"; the card starts on the project's default bar when it has one | `shell/StartCard.tsx`, `shell/start.ts` | `first-run.spec.ts`, `frame.spec.ts` |
| M2 | Enter on a length with no way to go says "Which way? Move the pointer, or press → ← ↑"; the value's words say "point the way" before; the coach says "Point the way, type the length, press Enter" | `tools/wiring.ts` (`NO_DIRECTION`), `tools/CommandBar.tsx` | `polish.spec.ts` (M2) |
| M3 | The Problems tab's badge counts the list's blocks, errors and warnings, as its summary does | `problems/source.ts` (`problemCounts`), `problems/ProblemsSheet.tsx` | `problems/source.test.ts` |
| M4 | One message lane under the view controls: the read-only label, the tool's coach, then the toasts (right part). The coach wraps, its × in the first column. Each tool has its own coach (the frame's "Click a corner · W, D · H"), none for the others | `viewport/Viewport.tsx`, `App.tsx`, `shell/StartCard.tsx` (`Coach`), `styles/viewport.css`, `styles/shell.css` | `polish.spec.ts` (M6 checks the frame coach) |
| M5 | The command bar is a row of the canvas column under the view, as the status bar is (the review's option a); in Select the same row holds the view's keys, so the view keeps its height. One row from 1280 px: Plane, Join ends and Corners are in an Options popover, closed by a press elsewhere | `tools/CommandBar.tsx`, `styles/tools.css` | `polish.spec.ts` (M5); `draw.spec.ts` (opens Options) |
| M6 | With the frame tool on, the command bar holds the prompt, the value and its result only; the panel's W, D, H and its dry-run numbers follow the typing, before Enter | `tools/CommandBar.tsx`, `tools/forms/FrameForm.tsx` (`liveDraft`) | `polish.spec.ts` (M6), `frame.spec.ts` |
| M7 | Outline rows: the id, the label (else the item's code and size, "PF40-01 40×40"), then the length in a right-aligned column never cut; the full name in the title | `outline/rows.ts`, `outline/Outline.tsx` | `outline/rows.test.ts` |
| M8 | Linear guides are left out of the size chips. A size's profiles: the system the most connectors fit, then exact before parametric, then the one sold in the most ways; names lead with what differs ("Básico – Canal 8", then its price per metre), the full name in the title | `shell/StartCard.tsx` (`bySize`, `profileOrder`, `shortNames`), `catalog/search.ts` (`offers`) | `shell/startcard.test.ts`; `first-run.spec.ts` (PF40-01 preselected) |
| m1 | A warning no longer outlines its bar: its triangle badge stays, and only blocks and errors outline in red, so amber means the selection (the review's second option) | `viewer/scene.ts` (`edgeLook`) | `view.spec.ts` (selection amber) |
| m2 | The status bar shows the tool's prompt only in Select; the command bar says it (and announces it) while a tool is on | `shell/StatusBar.tsx`, `tools/CommandBar.tsx` | read |
| m3 | "Anchor: centre"; the Corners select reads "post through", its long words in each option's title | `tools/CommandBar.tsx` | read |
| m4 | Arming an item from the catalog closes the start card | `catalog/state.ts` (`arm`) | read |
| m5 | W, D, H, Joined with and Make up front; corner, rings, shelf, corners and params under "More options"; the example is a one-line way under the two | `tools/forms/FrameForm.tsx`, `shell/StartCard.tsx` | `frame.spec.ts` |
| m6 | `.connector-select` is at most the column's width; the fit-first grouping of B1 (4) | `styles/inspector.css` | read |
| m7 | Show's callout: no Show inside it, the diagnostic's own words (its measurement) under the title, the stepper "target 1 of 3" | `problems/ProblemRow.tsx`, `viewport/Overlays.tsx` | read |
| m8 | Joint markers: by default the open and failed corners, and a joined one while hovered or selected; the Joints button steps to none, then to every corner | `viewer/markers.ts` (`setQuiet`), `viewer/scene.ts`, `viewport/ViewControls.tsx`, `viewport/viewer.ts` | `view.spec.ts` (markers, off, hover) |
| m9 (part) | The frame's dry-run numbers show in the command bar while the frame is drawn ("posts 4 × 800 · …") | `tools/state.ts` (`frameNumbers`), `tools/CommandBar.tsx` | `polish.spec.ts` (M6) |
| m10 (part) | Settings' order rules in words, their codes small; the catalog card's shape, system and section in words ("T-slot", "Forseti 40 series, 8 mm slot", "exact, from the vendor's drawing"); prices on one line | `shell/Settings.tsx`, `catalog/Card.tsx`, `styles/shell.css` | read |
| m11 | A frame made from the start card returns to Select, so the sheets open on its cut list | `shell/StartCard.tsx` | `first-run.spec.ts` |
| p1 | The view cube's ends take a 24 px target | `styles/viewport.css` | read |
| p2 | A disabled primary button is neutral, not a dimmed accent | `styles/base.css` | read |
| p3 | Several new rows in one group: one mark on the group head ("12 new · the CLI"), an edge on each row | `outline/Outline.tsx` | `presence.spec.ts` (a single new row keeps its mark) |
| p4 | "Profile: … Change"; small x, y, z before the corner's fields | `tools/forms/FrameForm.tsx` | read |

## Decisions

1. **`butt-no-connector` is a note per butt in the check, a rule in the order, one problem in the
   list.** The check stays about the model (a note: nothing is wrong with the geometry); whether
   it holds the order is the order rule's (`warn` by default, so a project that joins by hand can
   say `off`, and one that never may say `block`). One note per butt, not one note for all:
   a single note naming every butt would change its words with each butt drawn, and the step
   diff (new and resolved diagnostics) would report it as resolved and new on every step. The
   problem model folds the notes and the rule's reason into one problem in the first note's
   place. **Measured:** `alukit check` on a frame with none prints one `info butt-no-connector`
   per butt; `alukit order` adds `- **warn** no-connector: 8 butts name no connector, …` and
   `"no-connector": "warn"` in its JSON `rules`; `alukit problems` lists one warning with its fix.
2. **That problem badges no body in the view.** It is one buying problem over every butt alike,
   whose fix is the project's; a triangle on each butted bar covered the cart (18 butts,
   **measured**) and hid the problems that have a place (the review's own m8 point). The pill,
   the lists and Show, which frames the butts, carry it (`viewport/words.ts`, `NO_BADGE`).
3. **The connector chosen in the box frame becomes the project's default butt connector**, in the
   frame's step, rather than a connector on each of its 8 butts: the bars drawn later take it
   too, as Settings would set it, and Undo takes both back. When the project already has a
   default and the frame chooses another, the frame's butts name their own.
4. **Joined with is required when the project names no default.** "Nothing" is a choice to make,
   not a default to fall into: an unnoticed default of nothing is how the review's frame read
   "Ready to order" with nothing to join it. It is offered only while the project names no
   default: a butt with no connector takes the default (derive's `connector ??
   defaults.butt.connector`), so with one, "Nothing" could not be honoured.
5. **The start card writes nothing until something is made.** The profile becomes `defaults.bar`
   in the frame's step or in "Draw the first bar"'s, not when it is chosen, so a person who looks
   and closes the card leaves no step; and nothing at all when it is the default already.
6. **M8's order needs a third key.** Forseti's 40 × 40 Leve (PF40-00) and Básico (PF40-01) are both
   exact sections of `s40-c8` (**measured**), so the review's two keys leave the code to decide,
   and PF40-00 came first. The one sold in more ways (two finishes against one) is the common
   one: `catalog/search.ts` now gives each entry its offer count.
7. **M5: a row in Select too.** The review's option (a) has the bar a row while a tool is active;
   then the view would change height, and the camera jump, on every tool switch. The row holds
   the view's keys in Select, and both are 44 px high. The canvas is that much shorter than
   before in every state; the specs that measure pixels project world points, so they follow.
8. **m1: the second option.** Dashed warning outlines would add a material to the outline pass;
   dropping the warning tint keeps one material (no shader churn per revision) and removes the
   amber that read as a selection. Hover keeps its pale amber: it is now the only other amber,
   shown on one body while the pointer is on it, and `view.spec` pins it.
9. **m8: three states on the one Joints button**, in the order problems → off → all, so its first
   press still hides the markers, as before.
10. **The readiness pill's warnings are the order-judged ones** (problems with `from` holding
    `order`, not blocking): those are what "ready to send" depends on; the model's own warnings
    stay in the Problems list and its badge.

## Not done, and why

- **m9's ghost bars.** The overlay draws one ghost bar; a frame's 4 then 12 need a multi-ghost
  overlay and `addFrame`'s layout (which bar runs through at each corner) on the client, or the
  dry run's geometry, which it does not return. The numbers are in the command bar meanwhile.
- **m7's specific titles in `src/core/problems/`.** The callout now shows the diagnostic's own
  words under the title; changing the core titles changes the CLI's `problems` output and its
  goldens, which is a core pass of its own.
- **m10's built-in catalog list with Add buttons**: the integration pass owns it.

## Tests

- Written first and seen failing: `core/check/joints.test.ts` (B1), `problems/source.test.ts`
  (M3), `outline/rows.test.ts` (M7), `viewport/words.test.ts` (decision 2), `shell/settings.test.ts`
  (B1 4). The e2e tests for M2, M5 and M6 (`polish.spec.ts`) were written after their fixes;
  they assert the review's measured failures (a typed length made nothing and said nothing; the
  bar was 96 px over a 688 px canvas; the panel's H stayed empty while `800` was typed).
- `first-run.spec.ts`'s fixme is two real tests: a frame joined with a bracket that fits reads
  READY, the order (its date pinned to the oldest price read) buys 16 brackets and no rule judges
  the joints; joined with nothing, the pill reads "Ready, 1 warning", the verdict "Ready, but
  check first", and the problem's fix joins it.
- Kept as they were in meaning: `draw.spec`'s byte-identical cut list (it opens Options to set
  Join ends), `frame.spec`'s equality with `alukit add frame` (it chooses Nothing, as the CLI
  without `--connector`), `view.spec`'s zero shader links per revision (markers and outlines
  change points and vertex colours, not materials).
- `view.spec`'s section-plane test failed (168 pixels differed after the plane was turned off).
  It looked like load at first (it passed once alone), but it was this pass's: moving the axes
  gizmo from 24 px to 6 px above the canvas's foot. The camera was the same to the last digit;
  the gizmo's strokes were drawn a sub-pixel differently once the toolbar's layers changed.
  **Measured:** 168 pixels at 6 px, 0 at 24 px; the gizmo stays at 24 px.
- `view.spec`'s hover-tint test failed on the cart: the new `butt-no-connector` warning badged
  b2 at its middle, over the probe. That led to decision 2; the test is unchanged.
