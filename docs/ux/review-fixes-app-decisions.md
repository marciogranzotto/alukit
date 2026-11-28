# AluKit review fixes, the app side

*2026-11-27. The [editing review](review-editing.md)'s app-side findings: majors M2, M4, M5 and
M7, and its minors and nits, except what belongs to the core (M1, M3, M6 and B1–B3 have their own
pass; m2 and n2, and part of n3, are core work too, below). In the app, but for one catalog
classification (the Forseti importer's 180° extender, rfa 15): no command, schema, CLI path, golden
value or derived output changes, so CLI parity is the existing commands' (design §7.5's
rule). Decisions are cited as "rfa n"; the design's calls are 130–134. Labels as in the stream
notes: **measured** (a test or a run says so), **read** (from the code or the page cited),
**inferred**.*

## Done

Every row has a test written before the fix and seen failing for the reason the review gives
(**measured**: each was run against a build made before its fix), except the nits marked "none".

| Review | What changed | Where | Test | Failed first |
|---|---|---|---|---|
| M2 | The hole form focuses its distance once, when it opens, and selects it; typing stays where it is typed | `inspector/Holes.tsx` | `edit.spec`: typed (not filled) 20 is stored as 20, M6 as M6 | yes: at 2, size "0M6" |
| M4 | Esc during a held drag ends it, whatever is typed; the release sends nothing | `tools/drag.ts` | `ends.spec`: drag, type 500, Esc, release: no step | yes: a step at the dragged length |
| M5 | Every label and tip in the view draws `--tip-ink`; the gizmo's letters draw the ink their disc's colour needs | `styles/viewport.css`, `styles/tools.css`, `theme/tokens.ts` (`inkOn`), `viewport/Overlays.tsx` | `labels.spec`: every view label and tip, both themes, ≥ 4.5:1 over white and over black; `tokens.test.ts` | yes: 1.2:1 in light |
| M7, m12 | A bar lists its joints, face joints included, each with Edit; its menu has Edit c36…; its ends say what the core says of them; Join is offered only where the problem list would join | `inspector/joints.ts`, `Joints.tsx` (new), `words.ts`, `Ends.tsx`, `actions.ts`, `edit-actions.ts` | `bar-joints.spec` (the plate; the mitred and open corners); `joints.test.ts` | yes, both |
| m1 | Edit on a param focuses and selects its field; Esc gives the focus back to Edit | `records/Params.tsx` | `records.spec` | yes |
| m3 | A move the preview refused is not sent on Enter; the bar says why, in the app's words | `tools/preview.ts` (`refused`), `tools/wire/move.ts` | `review-fixes.spec` m3 | yes: HTTP 422 |
| m4 | A gesture's field is named by the gesture and what it takes: "Drag end b3.b: cut length" | `tools/CommandBar.tsx` | `review-fixes.spec` m4 | yes |
| m5 | On a Mac the caps are ⌘ ⌥ ⇧, in Apple's order, and the words say Option | `platform.ts` (new), `actions/registry.ts`, `shell/ContextMenu.tsx`, `shell/Help.tsx`, the tools' prompts | `review-fixes.spec` m5, a Mac and a Linux user agent | yes (Mac) |
| m6 | The tool's readout keeps clear of the selection's length label | `viewer/scene.ts` (`keptClear`), `viewport/Overlays.tsx` | `review-fixes.spec` m6 | yes: 942 px² overlap |
| m7 | At 1000 × 700 the orientation gizmo stands right of the tool rail | `viewport/Overlays.tsx` (`Gizmo`) | `review-fixes.spec` m7 | yes: 3,998 px² overlap |
| m8 | Pattern draws its copies as ghosts and reads its dry run by Create; its prompt moves on | `tools/wire/pattern.ts`, `tools/ToolForm.tsx`, `tools/state.ts` | `review-fixes.spec` m8 | yes: the prompt stayed |
| m9 | A bar's face is named with the world direction it looks along: "face -y (world +X)" | `inspector/words.ts` (`faceWords`), `Holes.tsx`, `barActions.ts`, `OtherFields.tsx`, `endEdits.ts`, `viewer/snap.ts` (`tip`), `tools/wire/draw.ts`, `place.ts`, `connect.ts` | `menu.spec` and `edit.spec` (the menu's hole), `tools.spec`, `connect.spec`, `ends.spec`; `endEdits.test.ts` | yes: "face +x, 300 mm" |
| m10 | The menu's Show draws a hidden selection again; on a drawn one it is not offered | `focus.ts` (`unhide`), `viewport/actions.ts` | `review-fixes.spec` m10 | yes |
| m11 | Each menu entry has its own access key, underlined (D Duplicate, L Delete); a typed letter goes to its entry; Delete's dialog focuses Cancel | `shell/ContextMenu.tsx` (`withAccessKeys`), `actions/registry.ts` (`access`), `inspector/Delete.tsx` | `review-fixes.spec` m11 | yes: D went to Delete |
| m13 | The box frame's Joined with lists the corner joints that fit first, the other fitting connectors after; nothing is chosen | `common/ConnectorSelect.tsx` (`corner`), `tools/forms/FrameForm.tsx`; the 180° extender a splice in the Forseti importer (`tables.py`) and its `catalog.json` | `review-fixes.spec` m13 | yes: one group |
| m14 | In the outline, Shift + an arrow extends the selection | `outline/Outline.tsx` | `review-fixes.spec` m14 | yes |
| m15 | A part slid by its arrow lands on the 10 mm grid of stations, or on another part's station; Shift slides it freely | `tools/wire/move.ts` (`slideStop`), `viewer/gizmo.ts`, `viewer/scene.ts` | `review-fixes.spec` m15 | yes: 427 |
| n1 | One thing deleted: "Delete b14?" and **Delete** | `inspector/Delete.tsx` | in `review-fixes.spec` m11, after m11's steps | not on its own |
| n3 | Move's reading says "writes", not "keeps" | `tools/moves.ts` | none (a nit) | — |
| n4 | A verb that works in Select or Move says "press Esc first", as Delete does | `tools/wire/duplicate.ts`, `mirror.ts`, `align.ts` | none (a nit) | — |
| n5 | The hover tip hides while a gesture runs | `viewport/Overlays.tsx` (`HoverLabel`) | none (a nit) | — |

**Left for the core** (**read**): m2, a duplicate's label numbered ("top rail, front 2"): the copy
is the core's `array` command (`core/commands/patterns.ts`), and the CLI's copy must number it the
same way. n2, an undo name that does not repeat its verb: the names are the core's
(`core/commands/words.ts`, `changed`). n3's folding of "H - 300 - 100" into "H - 400": the
expression is the core transform's (its `kept` list).

**Guarded tests**: `draw.spec`, `view.spec` and `live.spec` are unchanged and pass. No new lasting
material: Pattern's ghosts use the ghost material Move and Duplicate already compile at startup
(**read**, `viewer/overlay.ts`).

**Tests that changed with the words they read**, each kept exact: the caps are the platform's
where a spec reads them (`menu.spec`, `visibility.spec`, `move.spec`: ⌘, ⇧H and Option on a
Mac's user agent, as the browser the tests run in reports it); the face tips and options carry
"(world …)" (`tools.spec`, `connect.spec`, `ends.spec`, `edit.spec`, `holes.test.ts`,
`endEdits.test.ts`); `first-run.spec` finds CT38-06 under "Corner joints that fit"; the menus'
lists lost Show on a drawn entity and Join where nothing can be joined (`registry.test.ts`,
`edit-actions.test.ts`, `menu.spec`); Move's refusal says "hold Alt to detach it"
(`moves.test.ts`).

## 1. The hole form keeps the focus where it is typed (M2)

The size field had a callback ref, `ref={(el) => el?.focus()}`, which Preact runs on every render,
so each keystroke anywhere in the form put the focus back on size (**read**, review M2). The form
now focuses once, in a layout effect with no dependencies, so the focus is there before the first
paint.

- **The distance takes the focus, not the size.** The menu entry that opens the form names the
  distance it offers ("Add a hole on b1's face +x (world +Y), 300 mm from end a's cut…"), and it is
  the field a person corrects first; it is selected, so typing replaces it. A person who wants
  the size tabs to it.
- **The test types.** `edit.spec`'s hole test used `fill`, which sets a value without
  keystrokes and so never saw the bug (review M2). The new test presses keys: 20 in at, M6 in
  size; the hole is stored at 20 with M6 (**measured**).
- Each field gained a name a screen reader reads ("Distance, mm", "Size: a drill in mm, or a thread
  such as M6", "Depth, mm; empty is through").

## 2. Esc ends a drag, whatever is typed (M4)

Esc steps back one level (D-UX-18): what is typed, then the pick, then the gesture. During a held
drag that made the first Esc clear the digits only, and the release then committed the dragged
length (**measured**, review M4).

- **A held drag ends on Esc.** Its levels are not there to step back through: the pointer is
  down, and what the person means is "not this". Blender and Fusion cancel a transform on Esc
  (review M4). Backspace still clears the digits.
- **A click-move gesture keeps its levels** (an end's handle clicked, then the pointer moved
  without holding): the first Esc takes back what is typed, the second the gesture, as the guide
  says. The rule is in `drag.ts`'s `back()`: `typed && !held` clears the value, anything else ends.

## 3. The view's labels draw the tip's ink (M5)

The tip by the pointer is dark in both themes; its text is `--tip-ink` (**read**, `tokens.css`).
The joint and frame labels (the joint preview, and the Move, Duplicate and Paste readouts that use
the joint label) drew `--text-1`, which is dark in the light theme: 1.22:1 over white, 1.15:1
over black (computed from the tokens, compositing as the test does; the review measured 1.2:1).

- **`.view-label` draws `--tip-ink`**, the base rule, so every view label (joint preview, frame,
  Move's and Duplicate's readouts, Paste) has it and a new one cannot miss it. Worst case after:
  11.4:1, the tip composited over white.
- **The gizmo's axis letters** drew the selection ink on every disc; on the light theme's red and
  blue discs that is under 4.5:1. `inkOn(rgb, theme)` picks, of `--act-ink` (white) and
  `--sel-ink`, the one with the higher contrast on the disc, per axis and theme; `act-ink` joins
  the token mirror in `tokens.ts` (it was in `tokens.css` already). `tokens.test.ts` holds each
  letter at ≥ 4.5:1 in both themes.
- **`labels.spec`** opens `ux/ends` in each theme and reads every label and tip the view can show:
  the selection label, the gizmo's letters, the hover tip, an end drag's joint label and tool hint,
  an end's note, Alt's size labels, Move's readout and a problem's Show callout. A translucent
  background is composited over white and over black and the worse kept; `::first-line` colours
  are read where a rule sets them. All are ≥ 4.5:1 (WCAG 2.2 1.4.3) after; before, the test failed
  in the light theme on the end drag's labels (**measured**).

## 4. A bar's joints, and ends that say what the core says (M7, m12)

The T-nut plate's ends read "open: nothing joins it" beside a Join the core refused ("only b36
meets at that point: nothing butts on it"), and its face joint c36 was reachable only from the
outline (**measured**, review M7). Two app words disagreed with the core: "open" meant "no
connection names this end", and Join was offered on any such end.

- **"Open" is the check's verdict.** An end is open when the core's `unconnected` diagnostic
  names it (`check.ts`: the ends that meet at a point, none claimed, no bar through), it is not
  claimed, and no butt bears on its bar there (`openCorner`, `joints.ts`). An end a face joint
  holds by its bar reads "held by c36 (face joint)"; an end a through bar carries reads "b1.b and
  b7.a butt on it here (c1)"; an end that meets nothing reads "nothing joins it", with no Join.
- **Join is the problem list's verdict.** Join is enabled when the `unconnected` problem for that
  end carries the "Join with the default butt" fix, which the core adds only when `planJoin`
  would make the joint (e1 1, 9); otherwise the inspector shows the problem's own detail ("only
  b5 meets at that point: nothing butts on it") where Join was, and the menu greys Join with it.
  The problems are read per drawn revision; until they arrive Join is disabled, saying it is
  checking. No second copy of the rule lives in the app.
- **A bar lists its joints.** A **Joints** row under its ends: one line each, the connection's
  words ("face joint c36 (T-nut plate): with b35, 2 stations", "butt c1: end a on b5"), its chips
  and **Edit**, which selects the connection and opens its form, as a joint marker's menu does.
  The menu has **Edit c36…** when the bar has one joint (or one at the end face the menu was
  opened on), else **Edit a joint of b35…**, which opens the row. Tekla edits a connection from
  its symbol (audit §4.5); here the bar is what a person clicks (review M7).
- A hinge's base is not a joint that holds the bar: the bar carries the hinge (the cart's b1
  reads "nothing joins it" at its foot, as before).

## 5. Edit on a param takes the focus (m1)

**Edit** beside a param opened its field and left the focus on Edit, so A2 (i)'s "Edit beside W,
type 1100" typed into nothing (**measured**). The field now takes the focus, its value selected,
as the inspector's fields do; Enter sets it, Esc cancels, and either gives the focus back to Edit.

## 6. A refused move stays in the gesture (m3)

The preview's dry run already knew a move would break a joint, and Enter still sent it, for an
HTTP 422 in the API's words ("give joined: \"detach\" to free it") (**measured**). The joint
previewer now answers `refused(cmds)`: the reason, when its last answer was a refusal of exactly
these commands. Move and Duplicate ask it on Enter and keep the gesture open, saying why in the
command bar ("this move would break a joint: … · hold Alt to detach it"). The server is still the
judge: a step the preview did not see is sent and refused as before.

## 7. A gesture's field is named for the gesture (m4)

Every gesture's value field was named "Draw bar: value", because the command bar passed the draw
tool's name (**read**, review m4). It is named by the gesture's title and what its field takes:
an end drag's is "Drag end b3.b: cut length" (**measured**), a move's ends in "distance", a
duplicate's in "offset, then 4x or /4", a mirror's in "where the plane crosses".

## 8. ⌘ and ⌥ on a Mac (m5)

The caps said Ctrl and Alt on macOS (**measured**). `platform.ts` reads the user agent (`Mac`,
`iPhone`, `iPad`) once; on a Mac the caps are ⌥ ⇧ ⌘ in that order, run together (`⇧⌘Z`), as
Apple's menus write a chord (Apple HIG, keyboard shortcuts), and the words say Option; elsewhere
Ctrl+Shift+Z, Alt. The menu, the inspector's buttons, Help, the top bar's titles and the tools'
prompts use it. The keys themselves were already `mod` (⌘ on a Mac): only the words were wrong.

## 9. The readout keeps clear of the length label (m6)

The view's labels already keep clear of the gizmo (`Labels` `avoid`); the selection's length label
is a DOM overlay the viewer did not know of (**read**). An overlay that labels must avoid is marked
`data-keep-clear`, and the viewer adds the rectangles of the visible ones to `avoid`. At
1000 × 700, A7's duplicate readout overlapped the length label by 942 px²; now by none
(**measured**). Of the review's two choices this keeps both labels, each saying its own thing.

## 10. The gizmo clear of the rail (m7)

At 1000 × 700 the tool rail reaches below the gizmo's corner, 3,998 px² over its axis buttons
(**measured**). The gizmo keeps its corner (bottom left, near the axes it names) and, when the
rail's measured bottom reaches it, stands 8 px right of the rail instead; a `ResizeObserver` on
the view and the rail keeps it so when either changes size. Of the review's two choices this one
leaves every larger view as it was, where the rail ends well above the gizmo (**inferred**).

## 11. Pattern previews before Create (m8)

Pattern drew nothing until Create, and its prompt stayed "Click the bar to repeat along" (**measured**).

- **Ghost copies**, as Duplicate's `4x` draws: each copy of the template's bars, k pitches along
  the bar (the core's rule, `derive/patterns.ts`), up to 24 copies and 96 ghost bars.
- **A dry-run reading by Create**: "makes 2 copies: 2 bars more", the cuts that move, the
  problems it would raise; or "Create would be refused: …" in the core's words. It is asked again
  when the form or the revision changes, and only the latest answer is shown.
- **The prompt moves on**: what to repeat, then the bar to repeat along, then "Repeats along b1:
  set the pitch and the count, then Create makes the copies drawn".
- The review's A8 also notes the guide says **Apply** where the button says **Create**; the guide
  now says Create.

## 12. Faces named in the world too (m9)

On a rolled 40 × 80 the face that looks +X is the section's −y, and every place that named a face
said only that (**measured**, review m9). `faceWords(m, bar, face)` says "face -y (world +X)" when
the face looks along a world axis, as the Offset rows already said "(world +Y)"; `worldAxis` moved
from `BarFields.tsx` to `words.ts` for both. It names the faces in the hole form's selects and its
menu entry, a part's face select, an end's "stops at" choices, and the snap tips of Draw, Place
and Connect's base.

- **The snap keeps its machine label.** `Snap.label` ("b9 +y face at 300") is what scripts, the
  status line's `snap` and the tests key on; a new `Snap.tip` carries the person's words ("b9 +y
  face (world +Z) at 300"), and the tools show `tip ?? label`.
- **The hole row keeps its words** ("Ø7 on face +x, 20 mm from end a's cut"): the core's pass changed
  that row for M3 (which end a distance counts from), and the select beside it names the world
  direction.

## 13. Show is Hide's undoing (m10)

The menu's Show framed and pulsed a drawn entity with a callout that said only its id, right under
Fit to the selection, and read as un-hide (**measured**). Of the review's two choices: Show is now
offered only when the selection holds something hidden, and draws it again (`unhide`), which is
what its place beside Hide promises. A problem's, a toast's or a chip's Show still frames what it
is about (`show` in `focus.ts`); only the menu's verb changed.

## 14. Menu access keys, and a dialog that cancels by default (m11, n1)

Shift+F10, D jumped to Delete (the first title starting with D), and its dialog focused "Delete
all n", so an offset typed next deleted b18 and its joints (**measured**, review m11).

- **Each entry has its own access key**, underlined, as menus' mnemonics are: first the letters
  actions name (`Action.access`; Delete's is L, the review's choice), then an entry's own key's
  letter (Duplicate's D of ⌘D, Hide's H, Fit's F), then the first letter of a word of its title,
  then any letter of it. A typed letter goes to its entry and does not run it: Enter does, so a
  letter typed by mistake costs nothing. A letter no entry has falls back to the type-ahead.
- **Shift+F10, then a letter at once, keeps the letter.** The key sends a `contextmenu` event
  after itself, which the focused outline row took as a right-click and opened the menu again,
  resetting it: a letter typed then was lost, or the Enter after it went astray, in 3 of 8 runs
  (**measured**, the m11 test typing straight on). A menu already open is now left as it is; a
  right-click elsewhere closes it on its pointerdown first, so a right-click still opens the menu
  where it is. After: 4 of 4 runs pass, with `menu.spec`'s (**measured**).
- **Delete's dialog focuses Cancel**, the least destructive answer (WAI-ARIA APG, alert dialog),
  so a key typed on cancels rather than deletes.
- **One thing deleted is named** (n1): "Delete b14?" and **Delete**; "all n" only when n > 1. The
  test asserts it after m11's steps; it was not seen failing on its own.

## 15. The corner joints first (m13)

Joined with listed every connector that fits the profile, 33 for a 40 × 40, among them a 180°
extender, a latch plate and an X plate that cannot make a corner (**measured**, review m13).

- **The corner joints come first**, under "Corner joints that fit": the connectors of the
  `bracket` and `end-connector` families (a bracket holds a corner from outside, an end connector
  from inside); the others that fit follow under "Other connectors that fit". The families are the
  catalog's (`familyOf`, the item's `subtype`), so a catalog adds a corner joint by its subtype.
- **The 180° extender is a splice.** The Forseti importer classed every "Conector …" as an end
  connector, so the review's 180° extender (CN30-04, CN40-04, CN45-04, CN50-04, "Conector
  Prolongador 180°") would have led the corner joints (**measured**: the first screenshot of the
  list put it there). It joins two bars end to end, in line: the importer now classes "conector
  prolongador" as `splice` (`importers/forseti/forseti_importer/tables.py`, `KIND_RULES`), and a
  butt's connector list leaves splices out, as it already did. The importer was rerun from the
  cached 2026-11-26b snapshot: first unchanged, to check it rebuilt the committed files byte for
  byte (it did), then with the rule; `catalog.json` changed by those four subtypes and nothing
  else, `offers.json` and `sections/` not at all; `alukit catalog check forseti` passes
  (**measured**). The latch plate and the X plate now stand under "Other connectors that fit".
- **Declined: one preselected.** Polish's pu 3 already offers the bracket that fits the most
  systems as one click beside the list, and review B1 (phase 4) made the corners' joint the
  person's choice: a preselected joint would order hardware nobody chose (design call 118). The
  list orders; it does not choose.

## 16. Shift + arrow in the outline (m14)

The outline's keys handled Ctrl and Meta only (**read**, review m14). Shift with ↑ or ↓ now moves
and adds the row it reaches, and the one it leaves, to the selection (WAI-ARIA APG, tree view,
multi-select).

## 17. A part's slide snaps (m15)

A part dragged by its arrow along its bar landed on any millimetre: 427 for a drag toward 450,
while drawing snaps to a 10 mm grid (**measured**). `slideStop` lands the station on another part's
station of the same bar within half a grid step, else on the 10 mm grid counted from end a, as
drawing does; Shift slides it freely, by the millimetre. A typed distance is taken as typed. The
gizmo's drag now carries Shift (`GizmoDrag.shift`).

## 18. The nits (n3–n5)

- **n3**: Move's reading said "keeps b18.a z: H - 300 - 100", which reads as "unchanged"; it says
  "writes" now. Folding the sum to "H - 400" is the core's (above).
- **n4**: Duplicate, Paste, Mirror and Align, disabled under another tool, said "in Select or
  Move"; they say "works in Select or Move: press Esc first", Delete's wording.
- **n5**: the hover tip is hidden while a gesture runs; the readout by the pointer is what matters
  then.

No test for these three: they are nits, each a word or a condition, and the review allows it.

## Screenshots

- [The light theme's Move readout, after](img/review-fixes-app/01-move-label-light.png) (M5)
- [A T-nut plate's joints and ends](img/review-fixes-app/02-plate-joints.png) (M7)
- [1000 × 700: the gizmo beside the rail](img/review-fixes-app/03-gizmo-clear-1000-light.png) (m7)
- [Pattern's ghosts and reading](img/review-fixes-app/04-pattern-preview.png) (m8)
- [The menu's access keys](img/review-fixes-app/05-menu-access-keys.png) (m11)
- [Joined with: the corner joints first](img/review-fixes-app/06-joined-with-corners.png) (m13)
