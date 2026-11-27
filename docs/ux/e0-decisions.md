# AluKit editing round, E0: the contracts

*Stream E0 of the [editing audit](editing-audit.md) (§7.2): the shared modules every later
editing stream builds on, with no visible change but the help reading its key list from the
registry, and the context menu a right-click opens (decision 10). It forked after the end handles,
the length label and the Move tool merged ([drag-ends-decisions.md](drag-ends-decisions.md)), and
took their code in. The interfaces and their owners are in [contracts.md](contracts.md),
"Editing round: E0". Labels as in the audit: **measured**, **read**, **inferred**.*

## The tools' wiring (E0.1)

| # | Decision | Why |
|---|---|---|
| 1 | **One module per tool under `src/ui/tools/wire/`**: `draw`, `frame`, `connect`, `place`, `pattern`, `measure`, `move` and `ends`, each `create…Tool(ctx)` giving a `Wire` (its pointer handler, and its preview, Esc, Enter, keys, value keys, Tab, and what it resets on a tool change). `wire/common.ts` holds the `WireContext` the router hands each (the viewer, the snap targets, `snapAt`, `pickAt`, the hint, the pointer, `refresh`, what is typed) and the helpers several shared. `wiring.ts` routes and nothing else: 273 lines, from 1,300 | The streams each change one tool; a file per tool is a file per owner (§7.4). The code moved as it was: every unit and e2e test passed without an edit (**measured**) |
| 2 | **The end handles and the Move tool moved in**: `tools/handles.ts` is `wire/ends.ts`, `tools/mover.ts` is `wire/move.ts` (moved with git, so their history follows). Each registers its own keys and help section, which the router used to: the Move tool its value key and "While moving", the draw tool "While drawing" | They were the two tools living beside the wiring. Their pure rules (`tools/ends.ts`, `tools/moves.ts`), the drag machinery (`drag.ts`) and the shared joint preview (`preview.ts`) stay where they are: they are not tools |
| 3 | **The order a tool change resets things in is kept**: the router clears what every tool shares, asks the draw and frame tools to forget their gesture where it used to, and tells connect, pattern, measure, frame and place, in that order, that the tool changed | A signal written early can redraw another tool's overlay before it is cleared; keeping the order keeps that out of the question |

## The action registry (E0.2)

| # | Decision | Why |
|---|---|---|
| 4 | **§7.3's `Action`, plus four optional members**: `scope` (keys.ts's, `app` unless said), `help` (what the help says the keys do), `applies(c)` (whether it belongs in this context's menu at all) and, on the context, `ref` (an end the asker names, `b1.a`). Adding is the contract's only way to change | Without `applies` a part's menu would list "Join an end" greyed; with it, a menu holds what is about the thing. `ref` lets an inspector row ask about its own end |
| 5 | **A key holds exactly the modifiers it names**: `mod` is Ctrl or Cmd, then `shift`, `alt`; a printable symbol (`?`, `/`) carries its own Shift. So `h` and `shift+h` are two keys, as E-UX-9 needs. One difference from before: Shift+F no longer fits and Shift+Delete no longer deletes, since the old handlers ignored Shift | E2.8 binds H and Shift+H to different actions; a key that ignored Shift would take both. The help names no Shift for either, so nothing it promised changed |
| 6 | **A key runs its action when `when` says yes, and otherwise is left to the next handler**, as a hand-written handler that returns false | Delete with nothing selected, or in a tool, behaves as before: the key does nothing and its default is not prevented |
| 7 | **Two actions never share a key in one scope: registering the second throws.** An action registered again under its id replaces the one before | The audit's test, made a rule at the source rather than checked afterwards; replacing by id keeps a module loaded again (the dev server) from throwing |
| 8 | **The help reads the registry**: `helpSections` lists each action's keys under its group's section (edit under "Editing", view under "View"), then the rows a region describes itself (`describeKeys`) for keys that are not actions: a gesture's, a tool's letter, O. A row gains `or`, other keys that do the same | The help reads as before. Delete's line now says "Delete or Backspace" where it said "Delete + Backspace", which read as a chord |
| 9 | **Seeded with what the app already does**: Delete (its keys, replacing Delete.tsx's handler), Join an open end, Replace a profile, Fit (with F, replacing that half of the view keys) and Show. The inspector registers the first three while it is shown, the view controls the last two. The inspector's buttons still run their own code; reading the registry is E2.1's (the selection header) and E4's (the action row) | Each action runs what its button runs: Delete calls `startDelete`, which still says "read-only" itself, as the key did; Replace opens the inspector's own form for the bars (`replaceAsked`); Join sends the button's `autoConnect`; Show is `show()` on the selection, as a toast's Show is. Join asks about the end its row names, else the end nearer where the menu opened, else the bar's one open end |

## The context menu (E0.4) and the pick (E0.3)

| # | Decision | Why |
|---|---|---|
| 10 | **A right-click that does not move opens the menu in the view, in Select** (E-UX-2): on what is under the pointer, selected first if it was not, else on the selection. This is the one visible addition beyond the help. The outline's rows, the menu key and Shift+F10, the selection header's buttons and `menu.spec`'s further cases stay E2.1's | E0.4's test opens the menu on b1 with E0.8's `contextMenu(page, point)`, a right-click; without a way in, the shell could only be tested through a hook that changes the page, which the hook's contract rules out. Right-click did nothing before (the camera kept the browser's menu away), so nothing that worked changed |
| 11 | **The menu is WAI-ARIA's menu pattern**: focus on the first entry that can run, ↑ ↓ Home End move, a letter jumps to the next entry starting with it, Enter or Space runs one, Esc or Tab closes it and gives the focus back. A greyed entry stays focusable and says why under its title. A press outside it, a new revision, a resize or a chord closes it | A reason a person can read is the point of `when`. A new revision may have changed what it was opened on |
| 12 | **`Hit` keeps `p`, the name the viewer's pick already used, and adds `normal`, `face` and `station`** (§7.3 sketched `point`). On a bar, the face and station come from the derived model (`src/viewer/pick.ts`): the ray against the bar's placed box between its two end planes, each through the end's point and square to its normal, so an angled end is cut as derive cuts it; the face is a side (`±x`, `±y`) or an end (`a`, `b`), the station is along the bar from its design point a, as snapping counts it. The point stays the raycast's, so every tool reads what it read; on anything else the normal is the mesh's | Every tool reads `hit.p`; adding fields keeps the contract additive. A face found on the mesh would see the grooves; the box's faces are the ones snapping, Place and Connect name |
| 13 | **`onContextMenu` is the viewer's own pointer events**: a right press and release within 4 px, the left click's threshold. The camera's right-drag pan is untouched. A joint marker under the pointer is the hit (`corner:<key>`), as a click selects it | The browser's `contextmenu` event fires on every right-click, drags included |

## View state (E0.5)

| # | Decision | Why |
|---|---|---|
| 14 | **`hidden` and `isolated` are signals in focus.ts; the viewer's `setHidden` is a no-op until E2.4.** The tools' snaps and picks pass `hidden` as their skip (`WireContext.pickAt`, the Move tool's `pick`); Select's own click and hover pick waits for E2.4, which gives the viewer the set | Nothing sets them yet; when E2.4 does, every tool already passes over what is hidden |
| 15 | **`findSnap`'s `skipBars` became `skip`**, ids of bars, parts and nodes, through each snap point's new `of` (the entity it belongs to; a pattern copy's own id) | `skipBars` had no caller; a second option beside it would have been two ways to say one thing |

## Gizmos (E0.6) and batches (E0.7)

| # | Decision | Why |
|---|---|---|
| 16 | **`src/viewer/gizmo.ts` holds both kinds, one at a time**: axes at a point (an arrow along each world axis, a ring square to it, a square in each plane), sized to 96 px on the screen each frame; and handles, the end handles' grips, moved from the overlay with their three lasting materials. Every geometry and material is made in the constructor; showing, hiding, moving and lighting a part change positions, visibility and colours only | E-UX-19. A revision with the handles shown links no shader program (**measured**, `view.spec`). The axes' materials compile the first time they are drawn, as the overlay's preview did |
| 17 | **The end handles draw through `setGizmo({ handles })`**, keyed `a` and `b`, and take the gizmo away only when they showed it. `Viewer.setHandles` is gone; `gizmo()` reads what is shown | One gizmo at a time, and no tool clears another's |
| 18 | **A press on an axes part is the gizmo's, before a grab, a tool or the camera**; `onGizmoDrag` reports `start`, `move` and `end` with the offset along the arrow or in the plane, or the angle round the ring, from the ray at the press. The part under the pointer is drawn lit. Which part is hit and what a drag comes to are pure functions (`gizmoPartAt`, `gizmoDrag`, `handleAt`) | The press must not orbit the camera; the pure functions are what the unit tests read. Handles keep their drag through `setGrab`, which the end handles' gestures already use |
| 19 | **The Move tool built no gizmo to move here**: its axis guide (a dashed line along the locked axis) is the overlay's, shared with the draw tool, and stays | What the Move tool draws is a guide, not something to grab |
| 20 | **`src/ui/edit/batches.ts`**: `transformBatch` is the Move tool's `moveCommands`, `endBatch` the end handles' `endCommands`, both moved and renamed; `duplicateBatch`, `mirrorBatch`, `arrayBatch`, `splitBatch` and `alignBatch` take their arguments and answer "not available yet (…)", naming the task that builds each. `moves.test.ts` and `ends.test.ts` changed only their import and the function's name; no assertion changed | E0.7. The stubs' arguments follow the built commands' schemas (`splitBar`'s `at_mm` is a number, `array`'s `along` a bar, a run or `{ dir }`). Each builder's body is its task's stream's; the file's shape is E3's |

## Hooks and helpers (E0.8)

| # | Decision | Why |
|---|---|---|
| 21 | **The test hook adds `selection()` and `hidden()` (focus.ts), `menu()` (the open menu: its title and entries, each enabled or why not; ContextMenu.tsx) and `gizmo()` (the viewport).** The e2e helpers add `contextMenu(page, at)` (a right-click at a world point, returning the menu), `selectByIds(page, ids)` (from the outline, Ctrl+click after the first) and `docOf(dir)` | Readers only, as the hook's contract says |

## Against §7.3

| Interface | Sketch | Built | Changed in the audit |
|---|---|---|---|
| `transform`'s arguments | `rotate: { axis, deg: Expr, about: [Expr, Expr, Expr] }`; `by` and `rotate` both optional | `deg` a number and `about` three numbers; exactly one of `by` and `rotate` (src/core/commands/transform.ts). A turn writes numbers except at quarter turns, so an expression angle would have nothing to keep | yes |
| `Hit` | `point` | `p`, the built pick's name (decision 12) | yes |
| `pickAt` | `pickAt(x, y)` | `pickAt(x, y, skip?)` (decision 14) | yes |
| `GizmoSpec`'s handles | `{ key, at, axis? }[]` | adds `locked?` on a handle and `hot?` on the spec, which the end handles draw | yes |
| `connectedTo` | `(doc, derived, ids, opts?)` | `(doc, ids, opts?)`: E1 corrected it (e1 11) | already |
| `similarTo` | `(doc, derived, id, by)` | the same | no |
| `ActionContext`, `Action` | as sketched | adds `ref`; `scope`, `help`, `applies` (decision 4) | yes |

## Tests

- `src/ui/actions/registry.test.ts`: keys hold exactly their modifiers; a key runs its action
  through keys.ts only when it can run; a second action on a key throws, the same id replaces;
  **every seeded action with keys is in the help, and no two share a key in one scope**; the menu
  on the cart's b1 lists Delete, Join b1's end, Replace, Fit and Show, each enabled or saying why.
- `src/viewer/pick.test.ts`: **a ray at b1's +x face, 300 along it, gives b1, `+x` and station
  300**; down its axis, end b at its end plane; **a snap passes over a hidden bar's targets**.
- `src/viewer/gizmo.test.ts`: **a pointer on the Z ring hits it**, off it nothing; an arrow near
  its shaft, a plane inside its square; a drag along an arrow, round a ring, in a plane; the scale
  in orthographic and perspective; the nearest handle grabbed.
- `tests/e2e/menu.spec.ts` (E2 extends it): **a right-click on b1 opens the menu with the seeded
  actions, b1 selected first; the arrows and a letter move the focus; Esc closes it**, nothing
  written.
- `tests/e2e/view.spec.ts` gains **a revision with the gizmo shown links no shader program**.
- Every e2e passes with no assertion changed; `draw.spec`'s cut list is byte-identical
  (**measured**, the full gate).
