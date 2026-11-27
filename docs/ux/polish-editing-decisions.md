# AluKit editing polish: the core, and the Move tool's keys

*2026-11-27. Closes two of the gaps and two of the defects the editing round's scenarios found
([integration-editing.md](integration-editing.md), "What the scenarios found"): gap 1, a crossing
box then Move does not stretch (A2 (ii)); gap 2, mirror does not re-home a station part (A6, A14
(A6)); defect 6, the log keeps no arguments (A15); defect 4, Move's arrow locks wait for a move
(A3). Design §6, §7.1 and §8 state the result (*2.3*), its changelog group "Editing polish, core"
and calls 109–114. Labels as in the stream notes: **measured** (a test or a run says so),
**read** (from the code or the page cited), **inferred**. Cited as "pe n".*

## Done

| Item | What | Where | Test | Failed first |
|---|---|---|---|---|
| Gap 1 | A crossing box records, of each bar it takes without holding it whole, the ends inside it; Move then sends one `transform` whose `ids` hold the bars held whole and those ends (`b5.b`), and `transform` moves an end alone, its bar stretching | `core/commands/transform.ts`; `viewer/scene.ts` (`boxed`); `ui/focus.ts` (`crossedEnds`); `ui/tools/moves.ts` (`moveSet`); `ui/edit/batches.ts`, `ui/edit/geometry.ts` (`stretchedGhosts`); `ui/tools/wire/move.ts` | `transform.test.ts` (9 tests), `edit.test.ts` (`alukit move` with ends), `moves.test.ts`, `focus.test.ts`; `editing.spec` A2 (ii), un-`fixme`d, ending in `alukit move`'s project | yes (all) |
| Gap 2 | `mirror` refers a bar outside the set to the bar standing at its image: itself, as before, or another bar of the same section whose line, frame and box are the image's; otherwise refused, saying no bar stands there. A part mirrored with its bar, refused before, lands on the bar's copy | `core/commands/mirror.ts` | `commands.test.ts` (4 tests), `edit.test.ts` (`alukit do mirror`); `editing.spec` A6 and A14 (A6), un-`fixme`d, ending in `alukit do mirror`'s project | yes (all) |
| Defect 6 | Each step's log entry keeps its commands in canonical form, so `alukit log --json` gives what `alukit do` replays | `core/commands/history.ts` (`canonicalCommands`); `server/host.ts` | `commands.test.ts` (a session replayed from its log), `server.test.ts` (`alukit log --json`, replayed with `alukit do`); `editing.spec` A15 replays the log itself | yes (all) |
| Defect 4 | In Move, `→ ← ↑` start the move with that axis locked while a selection waits, wherever the focus is; Rotate's arrows the same | `ui/tools/drag.ts` (`Gestures.starting`); `ui/tools/wire/move.ts`, `wire/rotate.ts` | `editing.spec` A3 by D, ↑, 150, Enter, the focus on the outline's head | yes |

## Research: what a stretch is

| Source | What it does | What AluKit takes |
|---|---|---|
| AutoCAD's STRETCH ([STRETCH (Command)](https://help.autodesk.com/cloudhelp/2026/ENU/AutoCAD-LT/files/GUID-F000A502-D39E-4D31-A8E2-4A626473FB72.htm)) | "Objects that are partially enclosed by a crossing window are stretched"; objects completely enclosed, or selected one by one, are moved; it "moves only the vertices and endpoints that lie inside the crossing selection, leaving those outside unchanged"; circles and blocks are not stretched | The rule itself: a bar the box holds whole moves; a bar it holds in part moves only its ends inside the box (**read**) |
| BricsCAD's STRETCH ([Stretching entities](https://help.bricsys.com/en-us/document/bricscad/modifying-entities/stretching-entities)) | Entities that cross the window are stretched, those completely within it moved; "all points and nodes inside the selected area will be moved" | The same rule in a second implementation; nodes inside move (here, a node an end sits at moves with it, as Move moves a node) (**read**) |
| MicroStation's fence stretch ([To Stretch Segments of Elements That Overlap a Fence](https://docs.bentley.com/LiveContent/web/MicroStation%20Help-v25/en/GUID-52A48C35-79C1-F394-406F-6F0EBCEF2C6B.html); Manipulate Fence Contents) | A vertex inside the fence moves, one outside does not; an arc with one endpoint inside is "rotated and scaled"; a cell moves only when wholly inside | An end moves by the whole offset, off the bar's axis too, so a bar may turn about its other end; a part (a cell) moves only when selected (**read**) |
| SketchUp's Move ([Stretching Geometry](https://help.sketchup.com/en/sketchup/stretching-geometry)) | The Move tool itself stretches: moving an endpoint "stretches all edges and faces adjacent to the selected endpoint" | A stretch is Move's, not a separate tool: Move after a crossing box stretches (**read**) |

## Gap 1: a stretch

| # | Decision | Why |
|---|---|---|
| 1 | **Move after a crossing box stretches**: the bars the box holds whole move, the bars it only crosses move their ends inside it and keep the others. A window box (left to right) keeps today's behaviour, and so does anything selected otherwise (a click, the outline, a verb): whole entities move | AutoCAD's and BricsCAD's rule for a crossing; SketchUp's Move stretches where a person has taken part of the geometry. The audit's scenario A2 (ii) expected it (its row 1); a separate Stretch tool would be one more letter for the same gesture |
| 2 | **What the box records**: for each bar it takes without holding its body whole, the ends whose point (where the end's face crosses the design line, as its handle stands) lies inside the box. Both ends inside (a body that juts out of the box) is the whole bar; none inside, the bar stays, as a line a STRETCH window crosses with no endpoint inside | The end a person sees is its face, where the handle is; the design point can sit inside another bar (a rail's on the post's far side). A bar crossed in its middle has nothing in the box to move |
| 3 | **The record belongs to the selection the box made**, by identity (`crossedEnds`, `focus.ts`): a box added with Ctrl/Cmd keeps what the boxes before it held in part, except a bar it holds whole or one selected whole already; any other change of the selection leaves it. Rotate, Align, Duplicate and Paste read the selection whole | A stretch is a translation of points (AutoCAD's STRETCH has no turn); a copy of half a bar has no meaning. Identity makes a stale record impossible without a reset anyone could forget |
| 4 | **The core: `transform` takes bar ends in `ids`** (`b5.b`), an end alone moving by `by` while its bar's other end stays. An end named with its bar is the bar; both ends of a bar are the bar; under a turn an end is refused ("b5.b is an end: a turn moves whole entities; turn b5, or move the end by an offset") | `moveEnd` in the same batch was the alternative, and is wrong in three ways: it moves an end along the bar's own axis only, where a stretch moves it by the whole offset (decision 5); the rails' ends butted on a moved post already follow under `transform`'s follow, so a `moveEnd` after it would move them twice; and `transform`'s guard would judge the state before the ends moved. One command keeps one step, one guard, one answer and one CLI form (`alukit move --ids b2,b5.b --by 100,0,0`) |
| 5 | **An end moves by the whole offset, kept in its written form**: coordinates move (`W` by 100 is `W + 100`); at a node, the node moves as `moveNode` moves it when follow keeps it shared (detach writes the end where it goes); at another bar's end, that end comes along under follow; a free length (`{ len_mm, dir }`) takes up a move along its direction, from either end, and is refused across it, since the end would leave its line | MicroStation rotates and scales an arc with one endpoint in the fence: an end is a point, moved as one, and a bar may turn about its other end. Writing a free length or a param-driven point as numbers would be the silent unlink E-UX-4 forbids |
| 6 | **Joints**: an end in the set belongs to the moved set, so a joint between it and what moves is kept (a rail's end butted on a moved post: nothing to follow, nothing to free), and one between it and the rest is followed or freed by `joined`, as for a moved bar (an end leaving the bar it butts on: follow refuses, naming the joint; detach frees it). **A stretched bar carries the ends that bear on it only when its line moves** (the end goes off its axis): they slide along their own bars to stay on its new line, or detach frees them; along its axis its line stays, and so do they | The whole-bar rule (move 3–5) applied to a set that holds ends. A rail lengthened along its axis leaves a post butted on its side where it was; freeing that post under detach would undo a joint the stretch does not touch |
| 7 | **The answer and the words**: `info.stretched` lists the ends (`b5.b`), present only when there are some, and the step reads "move b2, b4, b8 and 5 more by [100, 0, 0], stretching b5, b6, b9 and b10". The preview says "stretches b5, b6 and 2 more · cut b5 920 → 1020 …", and the stretched bars are drawn where they would be (`stretchedGhosts`, the moved end's face by the offset, the section kept as square to the new axis as it can be). The joins after a move are an `autoConnect` at each moved end, the first 24: both ends of each bar moved whole (12 bars' worth, as before), then the stretched ends | The same shape as every move's answer and preview (move 8, 17); the joins' bound is the old one counted in ends, so a move of whole bars sends what it sent before |

**Measured.** On the brace fixture (the audit's 1000 × 600 × 750 frame), `transform` of the right
posts and side rails with the front and back rails' ends b by [100, 0, 0] gives the document the
window and its following give, byte for byte, the four rails 100 longer, no diagnostic changed;
the same rails moved whole make warnings (`transform.test.ts`). In the app, A2 (ii) as §12 writes
it, a crossing box over the right side, D, →, 100, Enter, gives the 1100-wide frame's cut list,
byte for byte, in one step whose `transform` names b2, b4, b8, b12, b16 and the ends b of b5, b6,
b9, b10, b13 and b14, and `alukit move` of those ids makes the same project (`editing.spec`).

## Gap 2: mirror onto the bar at the image

| # | Decision | Why |
|---|---|---|
| 8 | **A reference to a bar outside the set lands on the bar at its image**: the bar itself when the plane maps it onto itself (as before), else an existing bar that stands exactly where its image would: the same section, its design points the image's (either way round, `tol.len`), its frame the image's under one of the section's maps, its box the image's box. One rule for every reference: a part's station (A6's bracket), a bar end on a station, a butt's through bar, a bar end named as a point, an end plane's face, a plane square to a bar | A bracket on one leg mirrored alone should land on the opposite leg, and a brace on that leg mirrored alone should land on it too, butted on it: re-homing station parts only would leave the brace refused beside a bracket that is not. A bar whose body is not the image (another anchor, another section) would put the copy's face elsewhere than the image, so it is no home |
| 9 | **Refused where no bar stands there, in words that say so**: "p1/on: b1 is not mirrored, and no bar stands at its image across x = 400; include b1"; a bar on the image's line that is not its mirror image is named ("b2 stands on its image's line but is not its mirror image (another section or placement)"); two bars at the image are named and refused, the choice being the person's. A station measured from a cut (`a.cut`) lands only where the bar it lands on is cut there as the image is | The old words ("the plane does not map it onto itself") were true but did not say what would have worked. A station from a cut follows the cut, not the design point, so the home must be cut alike |
| 10 | **The answer** gives `info.onto`, each bar outside the set the images landed on another bar for (`{ b1: "b2" }`), and the words end "on b2": "mirror p1, making p2 on b2" | The person sees where the copy went without opening it |
| 11 | **The entity hooks read the images' ids**: a part's roll, a butt's `through_end` and a face joint's layers find the map that made the id they see (a copy's or a home's), since the rewriter hands them the entity already rewritten | They looked an image's id up as if it were an original's: a part mirrored with its bar was refused ("b13 does not derive", the copy's id asked of the derived model; **measured**, `commands.test.ts` on the code before), and a re-homed bar would have answered with that bar's own image (**read**) |

**Measured.** On the brace fixture, a bracket (`test:BRK-40`) on b1's face +x at 300 mirrored
across x = 500 lands on b2's face −x at 300, its landing point and origin the originals'
reflected to 0.01 mm, no diagnostic added; across x = 400 it is refused with decision 9's words
(`commands.test.ts`, `edit.test.ts`). In the app, A6 (the menu's Mirror…, `=W / 2`, Enter) and
A14 (A6) (the outline row's menu, 500 typed, a click in the view) each make p2 on b2's face −x at
300 in one step, and the project equals the CLI's `addPart` then `mirror` (`editing.spec`).

## Defect 6: the log keeps the commands

| # | Decision | Why |
|---|---|---|
| 12 | **Each step's log entry keeps its commands** (`commands`), in canonical form: `{ cmd, args }` with the arguments as the command's schema reads them, in the schema's key order (`canonicalCommands`). An undo or a redo keeps none (`of` names the step), and neither does a file edit, which no command made | `alukit log --json` then gives what `alukit do` replays, so an agent replays a session from the log: a step with `alukit do`, an undo with `alukit undo`, a redo with `alukit redo`, or only the steps still in effect. The schema's reading makes the same edit log the same way whoever sent it and however its keys were ordered; the batch has applied, so every command parses |
| 13 | **Size and privacy: kept, in memory only, as before.** The A15 session's log is 2,023 bytes with its commands, 657 without, against a 3,368-byte document (**measured**, its five steps through `History`); a step's commands are what was posted, bounded by what a request carries. The log lives as long as the server process, is never written to disk, and is read only through `GET /api/log`, behind the same token and Host/Origin checks as the document (§7.2); the commands hold what the document holds (ids, points, items, labels, param names), and a source name (`agent:…`) was in the log already. Neither the event stream nor a command's answer (`between`) carries them: every tab gets each event, and none replays | The history already keeps two states per step in memory; the commands add a few hundred bytes a step. Nothing in them is more private than the files beside the log |

## Defect 4: Move's arrow locks

| # | Decision | Why |
|---|---|---|
| 14 | **In Move, `→ ← ↑` start the move with that axis locked while a selection waits**, from the selection's centre, as a digit starts one from the keyboard; so D, ↑, 150, Enter moves 150 up (§12's A3). `↓` frees a lock, so it starts nothing and stays the outline's | Rotate's X, Y and Z already start a turn while a selection waits (e3 2); the arrows are Move's documented keys and did nothing useful there |
| 15 | **A tool's starting keys are its own wherever the focus is**, except in a text field, a dialog or a menu: `Gestures.starting` asks them in the keys' capture phase with the focus on an element, as a live gesture's keys are (e3 13); with the focus on the page the tool's own `onKey` handler, the same function, takes them. Rotate registers its keys there too, so its arrows start a turn from the outline as well | **Measured** (the round's A3): after selecting by the outline's head, ↑ went to the head (the outline takes its arrows and stops them) and the move asked for a direction. A handler on the window cannot see a key a focused row stops; the capture phase is where the gesture's own keys already go |

## What moved

- **Golden values, fixtures' diagnostics**: none. Every fixture project's `alukit check --json`
  and `alukit problems --json` are the same before and after, on all 58 (**measured**). No derive
  code changed.
- **The log's entries** gain `commands`: `commands.test.ts`'s `addFrame` step and `host.test.ts`'s
  undo and redo compare entries whole, and now with each step's command (an undo or a redo names
  its step instead, as before).
- **`transform`'s and `mirror`'s answers** gain `stretched` and `onto`, each only when it applies,
  so every existing answer compared whole is unchanged; `mirror`'s words gain "on b2" only when a
  copy was re-homed.
- **The joins after a move** are counted in ends (the first 24), the same commands for whole bars.
- **The help's Move row** says the arrows start the move; `alukit move`'s and `alukit log`'s usage
  say what they take and give.

## Tests

- `src/core/commands/transform.test.ts`, "an end alone stretches its bar": a lone end along and off
  its axis, in words; a param kept; the brace frame's crossing equal to its window, and the whole
  move's warnings; an end butted on a bar that stays (follow refuses, detach frees); a through bar
  stretched along and across its axis; an end at a node; a free length along and across; an end
  with its bar, both ends; refusals.
- `src/core/commands/commands.test.ts`, "onto the bar standing at the image": the bracket on b2, its
  point and origin the image's; a part mirrored with its bar on the bar's copy (decision 11); a
  brace's station and its butt re-homed; the refusals' words. "keeps
  each step's commands": a session with undo, redo and a file edit replayed from its log.
- `src/server/server.test.ts`: `alukit log --json`'s commands, replayed with `alukit do` on a copy.
- `src/cli/edit.test.ts`: `alukit move` with ends (dry run, step, `fmt --check`, a turn refused);
  `alukit do mirror` onto b2 and refused across x = 400.
- `src/ui/tools/moves.test.ts`: the move set of a crossing, its batch's joins and its preview's
  words; `src/ui/focus.test.ts`: the crossing's record, merged, kept and left behind.
- `tests/e2e/editing.spec.ts`: A2 (ii), A6 and A14 (A6) un-`fixme`d, each ending in its CLI
  comparison; A3 by D, ↑, 150, Enter with the focus on the outline; A15 replayed from
  `alukit log --json`. A6 and A14 (A6) leave the Place tool first (Esc, or Select on the rail):
  the menu's Mirror… works in Select or Move and says so, which the integration's script, never
  run past the core's refusal, had not met; and the derived part names its bar and distance, the
  document its face, so the check reads each from where it is.
- **Failed first** (**measured**): the new tests on the code before. The unit tests above, each
  for the reason it names (no `stretched`, the old refusal's words, no `commands`, "b13 does not
  derive"). The five scenarios, against the base's product sources built with the new spec: A2
  (ii) and A3 stopped at the arrow lock ("lock an axis (→ ← ↑) or move the pointer the way to
  go"), A6 and A14 (A6) at the core's refusal ("b1 is not mirrored and the plane does not map it
  onto itself"), A15 at the log's missing commands. The stretch itself failed first in the core
  tests, and in the app as the integration measured it (the crossed rails moved whole).
