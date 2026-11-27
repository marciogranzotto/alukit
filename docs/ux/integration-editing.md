# AluKit editing round: the integration pass

*2026-11-27. Step 4 of the [editing audit](editing-audit.md)'s §8, after the round merged (E0, E1,
the end handles and Move, E2, E3, E4, E5 and gap X11): the decision notes folded into
[design.md](../design.md) §6, §7 and §8 (its changelog's "3D editing, integration", calls
105–107), the [guide](../guide.md) and the README brought up to the app, the contracts' editing
sections put in order ([contracts.md](contracts.md)), and the audit's §12 acceptance scenarios
scripted as `tests/e2e/editing.spec.ts`. Labels as in the stream notes: **measured** (a test or a
run says so), **read** (from the code that runs), **inferred**. Cited as "ie".*

No product code changed: every scenario that the app can do passes as built, and what it cannot
do is listed below as a gap.

## How the scenarios are scripted

- **One test per scenario**, A2 and A14 one per part: 18 tests. §12 runs the scenarios as one
  session on an empty Forseti project, each following from the one before. Here each test starts
  from the state the scenarios before it leave, built by the CLI before the server starts
  (`serveNew(args, prepare)`): the frame of A1 is the batch the start card sends, read off A1's
  own request (`FRAME` in the spec). A test runs alone, and one that fails hides none after it.
  A13 (undo all) and A15 (agent parity) are about a session, so they make theirs in the app
  (call 105).
- **Each test drives the app as a person would**: the start card, the outline, the tool rail and
  its keys, the menu, the inspector's fields, typed values in the command bar. The hook
  (`window.__alukit`) is only read, for the screen position of a world point and to wait for a
  revision to be drawn.
- **Each test ends in a comparison with the CLI**: `alukit diff` empty against a scratch project
  the CLI built with the same edit (`alukit move`, `alukit do`), or a byte-identical cut list
  (A1, A2 (i), A4), or the BOM the CLI's `setConnection` gives (A12), besides the scenario's own
  check.
- **A scenario is `fixme` only when the app cannot do it as built.** Where one path failed and
  another the app offers worked, the test takes the one that works and the defect is listed below
  (call 106).

## Results and times

**Script** is the time of the in-app steps as the test ran them, from the first click or key to
the drawn revision (**measured**, one run of the spec on the merged tree, headless Chromium on
SwiftShader, 1280 × 800, the machine running other agents): a floor, not a person's, and noisy
from run to run (A4 took 5.1 s in an earlier run); the counts do not vary. **Estimate** is a person's at a steady pace by the
keystroke-level model (Card, Moran and Newell, 1980): 2.65 s per click (a mental preparation,
1.35 s, then pointing, 1.1 s, and the press, 0.2 s) and 0.28 s per key (an average typist); it
counts no thinking within a typed sequence, so it is low for the keyboard paths (**inferred**).
Clicks count a select's opening and its choice as two, a filled field as one click and its
characters as keys. Steps are the server's.

| # | Task | Target (§12) | Result | Clicks | Keys | Steps | Script | Estimate |
|---|---|---|---|---|---|---|---|---|
| A1 | Table frame, shelf ring 250, W, D, H as params | ≤ 45 s, ≤ 8 clicks, ≤ 20 keys, 1 step | pass: the cut list is `alukit add frame --shelf 250 --params`'s, byte for byte; **10 clicks** | 10 | 13 | 1 | 2.8 s | 30 s |
| A2 (i) | Widen by 100, editing W | ≤ 10 s, 1 step | pass: the 1100-wide frame's cut list | 2 | 5 | 1 | 0.8 s | 7 s |
| A2 (ii) | Widen by 100 on a frame without params: crossing box over the right side, Move +100 X | ≤ 20 s, 1 step | **fixme**: gap 1 | (3) | (11) | (1) | (5.6 s) | (11 s) |
| A3 | Shelf up 150 | ≤ 15 s, 1 step | pass: cuts as before, ends 150 up, no new diagnostic, `alukit move`'s project | 2 | 11 | 1 | 0.7 s | 8 s |
| A4 | Four legs to 40 × 80, the 80 along X | ≤ 30 s, ≤ 2 steps, legs in ≤ 2 clicks | pass: the CLI's cut list (front and back rails 840, sides 520 by hand); legs in 2 clicks; **6 steps** (gap 3) | 20 | 8 | 6 | 3.8 s | 55 s |
| A5 | Diagonal brace in the back plane, joined at both ends | ≤ 45 s, ≤ 2 steps | pass: no error, both ends `angle`, its cut the dry run's of the same batch | 1 | 32 | 1 | 1.4 s | 12 s |
| A6 | Bracket on the front-left leg's inner face at 300, mirrored to the front-right leg | ≤ 20 s for the mirror, 1 step | **fixme**: gap 2 | | | | | |
| A7 | Top front rail duplicated 300 down, joined to the legs | ≤ 15 s, 1 step | pass: butts at both ends, its cut the top rail's, the CLI's `array` and joins | 1 | 7 | 1 | 1.8 s | 5 s |
| A8 | Four slats across the shelf, evenly spaced; then five by editing the pattern | ≤ 30 s, then ≤ 10 s, 1 step each | pass: spacing equal within 0.01 mm, the count follows, the CLI's project; four slats are **2 steps** (a slat, then its pattern) | 6, then 2 | 39, then 2 | 2, then 1 | 2.9 s, then 0.3 s | 27 s, then 6 s |
| A9 | Bracket slid from 300 to 450 along its leg | ≤ 10 s, 1 step | pass: `at_mm` 450, `alukit move`'s project | 1 | 5 | 1 | 0.5 s | 4 s |
| A10 | Back top rail and its joints deleted; Undo | ≤ 10 s, 1 step | pass: the dialog lists b14 and the two butts it changes, no end left open, `removeEntity { cascade }`'s project; Undo gives the frame back | 2 | 1 | 1 | 0.8 s | 6 s |
| A11 | Hide the top ring, isolate a corner, show all | ≤ 10 s, no step | pass: no step, `alukit diff` empty | 3 | 3 | 0 | 0.9 s | 9 s |
| A12 | A T-nut plate's face joint from 2 bolts to 3 | ≤ 20 s, 1 step | pass: one screw and one T-nut more, the BOM of `alukit do setConnection` | 4 | 16 | 1 | 0.8 s | 15 s |
| A13 | Undo it all | 1 key per step, each Undo naming its step | pass: three steps, three keys, each named as `alukit log` words it; the empty project again | 0 | 3 | 3 undone | 0.4 s | 1 s |
| A14 (A3) | The shelf up 150, by mouse (the rail's Move, the offset typed, a click) | ≤ 1.5 × the keyboard's | pass, the same project; 1.56 × A3's estimate, 1.3 × its script time | 4 | 9 | 1 | 0.9 s | 13 s |
| A14 (A6) | The bracket mirrored, by mouse | | **fixme**: waits on A6 (gap 2) | | | | | |
| A14 (A10) | The rail deleted from the outline row's menu, undone from the top bar | ≤ 1.5 × the keyboard's | pass, the same project; 1.42 × A10's estimate, 1.6 × its script time | 3 | 0 | 1 | 1.3 s | 8 s |
| A15 | Agent parity: the session's commands replayed with `alukit do` | `alukit diff` empty | pass: five steps (the frame, the shelf, a brace, a duplicate, a delete) replayed from the commands the app posted (gap 6) | | | 5 | | |

A2 (ii)'s numbers in brackets are its run as written, which fails its check; the same steps with
the window's corners swapped (left to right) pass it (**measured**, a probe not kept).

## What the scenarios found

*Since closed* (the editing polish, [polish-editing-decisions.md](polish-editing-decisions.md),
cited as "pe"; design's "Editing polish, core"): gaps 1 and 2 and defects 4 and 6. A2 (ii), A6 and A14 (A6)
pass, each ending in its CLI comparison; A3 runs by D, ↑, 150, Enter, and A15 replays
`alukit log --json` itself. The entries below are as the integration found them, each marked.

Gaps (the app cannot do it as built; listed in design §8, "What the editing round left for
later"):

1. **Closed: a crossing box then Move stretches** (pe 1–7). **No stretch (A2 (ii)).** Move moves whole entities (`transform`, §6). A crossing box over the
   frame's right side takes the right posts and side rails and also the front and back rails that
   reach into it, which then move whole: their left ends land 60 mm off the left posts, six
   `end-far` warnings, and the cut list is not the 1100-wide frame's (**measured**). A window
   (left to right) takes only b2, b4, b8, b12 and b16, the rails butted on them follow, and the cut
   list is the 1100-wide frame's, byte for byte (**measured**). The audit assumed a crossing would
   stretch (its row 1); the guide teaches the window.
2. **Closed: `mirror` lands on the bar at the image** (pe 8–11). **Mirror does not re-home a station part (A6).** `mirror` keeps a part on its bar's station, so
   a bracket on b1 mirrored across x = 500 is refused unless b1 is mirrored with it ("p1/on: b1 is
   not mirrored and the plane does not map it onto itself; include it", **measured** with
   `alukit do --dry-run`), and with b1 it copies the leg. Placing the second bracket on b2 works.
   A mirror that moves a station part onto the bar standing at its image would close it; it is a
   core change (E1's), not made here.

Defects and friction (the scenario passed by another path; for the designer review):

3. **The 80 along X costs six steps (A4).** A 40 × 80 standing up has its 80 along its section's
   y, world Y. A quarter roll (one step for the four, in the shared Roll field) turns it, and then
   each leg's anchor, a corner of the section, must turn with it to keep the leg inside the
   footprint, a different corner per leg, so four more steps. **The anchor dots overlap on a
   40 × 80**: the pad scales the section to 26 px on its long side, so the narrow face's corner and
   middle dots sit 6.5 px apart, and the middle dot's press area (12 px dot, 6 px more around it)
   covers the corner's centre: a press on `-x+y` goes to `+y` (**measured**: Playwright refuses
   the click, naming the dot that takes it). The anchor's list beside the dots works. Both are
   E4's (`ManyFields.tsx`, `AnchorDots.tsx`).
4. **Closed: the arrow locks start the move, wherever the focus is** (pe 14, 15). **Move's arrow locks wait for a move (A3, A2 (ii)).** `→ ← ↑` are the move gesture's keys
   (`wire/move.ts`), so they act once a drag or a first digit has started it; while a selection
   only waits, they go to what has the focus, the outline's head or row after selecting there
   (it opens, closes or moves) (**measured**: D, ↑, 150 left the move asking for a direction).
   Rotate's X, Y and Z do start a turn while a selection waits (e3 2). A typed offset
   (`0, 0, 150`) works, and the guide gives it.
5. **A1 takes 10 clicks** (§12: ≤ 8): the shelf and "as params" are under More options, and the
   joint is a select (two). Its keys and time are within the target.
6. **Closed: the log keeps each step's commands** (pe 12, 13). **The log carries no arguments (A15).** `alukit log` keeps each step's command names (`what`)
   and words (`text`), so "replay the log's commands" cannot be done from it; the test replays the
   commands the app posted, read off its requests, one `alukit do` per step, and checks that the
   log names the same commands (call 107).
7. **Four slats are two steps (A8)**: one slat drawn, then its pattern; §12 counts one.

## Decision notes against the code

Where a note and the code disagree, the code wins (**read**):

- [contracts.md](contracts.md), E0's interfaces: "`setHidden(ids)` (a no-op until E2.4)": it hides
  by visibility since E2.4; corrected there. E2's section called `registry.ts` and `focus.ts`
  "E0's", where E0's own table makes their owner E2; corrected.
- E0's file table named neither the files E2, E4 and E5 added (`viewport/size.ts`,
  `navigation.ts`, `AnchorDots.tsx`, E4's and E5's inspector modules, `forms/FaceForm.tsx`) nor
  `editing.spec.ts`; added, with gap X11's `context.ts`.
- The design's E0, E3, E4 and E5 groups said §8 "takes these in when the editing round is folded
  in"; it does now, and they say so.
- No decision note (e0–e5, ends and move, x11) states a number or a rule the code contradicts,
  among those this pass folded in and checked: the joins after a move (the first 12 bars) and a
  copy (the first 48 ends), at most 100 copies, a pattern's count down to 1, Split here and Add a
  hole rounded to the millimetre, Rotate's place on the rail after Move, `transform`'s arguments,
  `exprNames` on a sleeve's `len_mm` only, the `like:`, `like:… by tag` and `connected:`
  selectors. E0's "`wiring.ts` routes and nothing else: 273 lines" was true when E0 merged; it is
  311 lines since E3, and still routes.
- The server's own table of requests (the doc comment in `src/server/server.ts`) does not list
  `GET /api/query`; design §7.1 does now. The comment is left for the server's owner.

## What the documents now say

- **design.md**: §6 (`transform` as built, `autoConnect`'s declarations, merge patches of lists,
  `context`, `exprNames`, `explodePattern`'s copies), §7.1 (`GET /api/query`), §7.3 (`like:… by
  tag`), §8 (the registry, the menu and the view's state, the tools, the inspector, the corner's
  joints, what each edit sends, the editing gizmo, the limits left), the changelog's group and
  calls 105–107.
- **guide.md**: a section, "Editing in the 3D view", that walks every §12 task with its keys and
  clicks, as run here; the tools table gains Rotate; the box frame's shelf and params, and how to
  arm a part for placing.
- **README.md**: what the app edits in 3D.
- **contracts.md**: the editing round's sections in stream order, E0 first, each interface named
  once with its owner, and an integration section for the e2e helper this pass added.
