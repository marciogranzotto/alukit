# AluKit re-check fixes, the app side

*2026-11-28. The [editing review](review-editing.md)'s re-check (§9.4) found ten new things; this
round fixes the app's: N2 (Mirror's preview words), N4 (a refused Mirror posts on Enter), N6
(switching a hole's reference moves it) and the nits N7–N10. N1, N3 and N5 are the core's, in a
round of their own. Decisions are cited as "xa n"; the design's calls are 138–140. Labels as in
the stream notes: **measured** (a test or a run says so), **read** (from the code or the page
cited), **inferred**.*

*No command, schema or CLI path changes, and no golden value. Two words of the core change, each
the smallest change that does it: the order's open-end reason (N8, `core/order/rules.ts`) and the
machining problems' titles (N10, `core/problems/words.ts`); xa 6 and 7 list what moved.*

## Done

| Re-check | What changed | Where | Test | Failed first |
|---|---|---|---|---|
| N4 | One gate for every previewed commit: a refusal the preview shows for exactly the commands about to be sent, at the revision the app holds, is not sent. The gestures (Move, Duplicate, Paste, Rotate, Mirror, Align, an end drag) ask it in their one commit path; Draw and the length label ask it too; Pattern's Create is disabled by it | `tools/preview.ts` (`refusalOf`, `shownRefusal`, `heldByPreview`), `tools/drag.ts`, `tools/wire/draw.ts`, `tools/LengthEdit.tsx`, `tools/wire/pattern.ts`, `tools/ToolForm.tsx`; Move's own copy of the check removed (`tools/wire/move.ts`) | `recheck-fixes.spec`: Mirror, Rotate, Pattern | yes, all three: Mirror and Rotate posted, Create was enabled |
| N9 | The bar says a held refusal once: as Enter's answer (the result), no longer also as the preview, and only while that preview stands | `tools/CommandBar.tsx` (`Result`, `ValueField`), `tools/state.ts` (`lastResult.held`) | `recheck-fixes.spec` (Mirror, Rotate: once, then gone when the plane changes); `review-fixes.spec` m3 gained the same assertion | yes: m3's new assertion, against a build without the bar's change, found the preview still beside the result |
| N2 | Mirror's preview says an image's end stays open only when nothing in the step claims it, as the dry run's `effects.claimed` says | `tools/wire/mirror.ts` (`mirrorWords`) | `batches.test.ts`: a real dry run with one post of another section, and a dry run built by hand | yes: "joins b4 (c11) · joins b3 (c12) · b14.a and b14.b stay open" |
| N6 | Switching a hole's reference keeps the hole where it is and converts its number, an expression staying one | `inspector/holes.ts` (`switchFrom`), `inspector/Holes.tsx` | `holes.test.ts`: each reference, the cut list's place unchanged; an expression | yes: 300 stayed 300, the cut list moved 40 |
| N7 | Draw's second point names its face with the world direction, as the first does | `viewer/draw.ts` (`DrawPoint.tip`), `tools/wire/draw.ts` | `interaction.test.ts` | yes (no `tip`) |
| N8 | The order quotes the check's line once: "unconnected: b17.b lies on b4's -x face with no connection" | `core/order/rules.ts` | `joins.test.ts` | yes |
| N10 | A machining problem's title says what is wrong: "A hole off its piece at b5", "A tap with too little wall at b5" | `core/problems/words.ts` (`machiningTitle`), `core/problems/problems.ts` | `problems.test.ts` | yes: both "Machining to check at b5" |

## 1. One gate for every previewed commit (N4)

Review m3 held a refused Move or Duplicate on Enter: each asked its previewer, in its own
`commit`, whether the dry run had refused exactly those commands. Mirror, Rotate, Align and an end
drag did not ask, so Enter posted a step the preview already showed refused (HTTP 422, and a toast
in the API's form; **measured**, re-check N4 and the failing tests here). The check was in the
tools, one copy each, and four tools lacked it.

- **The rule lives in one function, `refusalOf(cmds, shown)`** (`tools/preview.ts`): the refusal a
  preview shows, when what it dry-ran is exactly the batch about to be sent (as JSON) and the app
  still holds the revision it asked at. Anything else is sent, and the server judges it, as
  before: a preview still in flight, a batch the preview did not see (Draw with Pattern's repeat
  sends more than it previewed), or a revision that arrived since.
- **The revision is new.** The previewer re-asks only when the batch changes, so a refusal could
  outlive a revision that makes the same batch acceptable (a CLI edit that frees the joint). The
  joint preview now records the revision the app held when it asked (`JointPreview.rev`), and
  Pattern's preview its own (`patternPreview.shown`); a refusal holds a commit only at it.
- **Every previewer writes the one `jointPreview`** (`createPreviewer`, shared by the draw tool,
  the end handles, the length label, Move, Duplicate, Rotate, Mirror and Align), so
  `shownRefusal(cmds)` reads the gate from it for all of them.
- **The gestures ask it in their one commit path** (`drag.ts`'s `commit`), after the spec's own
  `why` and before anything is sent: one place for Move, Duplicate, Paste, Rotate, Mirror, Align
  and an end drag. Move's own copy of the check is removed; the previewer's `refused(cmds)` stays,
  as `shownRefusal`, for the contract.
- **Draw** asks it in `commitBar`. Its preview never shows a refusal today (`drawnWords` says
  nothing for a refused dry run, so nothing is held), so this changes nothing now; it keeps the
  rule true if Draw's words ever show one (**read**).
- **The length label** asks it in its commit, and shows the refusal as its error, in the place of
  the preview, as it already showed a server's refusal.
- **Pattern's Create is disabled** while its preview shows the core refusing exactly the command
  Create would send, with the refusal as its title. Create is a button, not Enter in a gesture:
  the line above it already says "Create would be refused: …" (polite live region), so a press that
  did nothing would say nothing new. A dry run that did not answer (the network) is not a refusal
  and does not disable it.
- **Checked, each tool with a preview** (**read**, then **measured** for three): Move and Duplicate
  (held by m3, now by the gate), Rotate (posted: a test now), Mirror (posted: the re-check's case, a
  test now), Align and an end drag (would have posted: the gate covers them by the same path),
  Pattern (posted: a test now), Draw (no refusal shown, nothing to hold).

The tests ([`recheck-fixes.spec.ts`](../../tests/e2e/recheck-fixes.spec.ts)) count the steps the
app posts (commands without `dryRun`) and read the bar. Their refusals do not depend on traced
sections, so the core's N1 fix cannot remove them: Mirror of the bracket across y = 500, where
no bar stands at b1's image; Rotate of b2, butted on b1, about its own centre; Pattern's template
removed by the CLI while the form holds it.

## 2. A held refusal is said once (N9)

After m3's Enter, the bar held the refusal twice: the joint preview's line and the result chip
(**measured**, re-check N9). `heldByPreview` sets `lastResult` with `held`, the commands it held:

- the result chip shows it, error-styled, as Enter's answer;
- the value field's joint preview hides while its commands are the ones held;
- when the gesture moves on (another plane, angle or offset), the preview asks again, its commands
  differ, and the held result hides: the new preview shows alone.

The result, not the preview, keeps it because Enter was pressed: the answer belongs where every
step's answer goes (the result chip, `<output>`), in the error style a refusal of a step has.
The gesture stays on, as m3 decided.

## 3. Mirror's preview says one outcome per end (N2)

Where the posts' section was traced, the preview said "joins b4 (c19) · joins b3 (c20) · b20.a and
b20.b stay open" (**measured**, re-check N2). The words joined two sources: `mirror`'s own report,
`info.open`, the images' ends whose joint it could not land, and the joins the step's
`autoConnect`s make after it at each image's end (review B2). When `mirror` cannot land a joint
and a join then butts the end, both were said.

- **An end stays open when nothing in the step claims it.** The dry run says which bar ends a
  connection of the whole step claims (`effects.claimed`, the core's `effectsOf`: an end whose
  provider is no longer the default; a through bar's end at its joint included, **measured**:
  `alukit derive` gives b1.a `by: "c1"` in the brace fixture). `mirrorWords` keeps from `info.open`
  only the ends not claimed. So whether the mirror lands a joint or a join after it does, the words
  follow what the core will do, and an end is never both joined and open.
- **Correct by construction, not by today's case.** The core's N1 fix may land the traced posts'
  joints in `mirror` itself; the words do not depend on which command makes the joint. The test
  makes the case without traced sections: one back post of another section (test:TS4080), so
  neither post is the other's mirror image, `mirror` reports both of the brace image's ends open,
  and the joins butt them. A second test builds the dry run by hand, one end claimed and one not:
  "makes b20 · joins b4 (c19) · b20.b stays open · cut 958.67".
- **Left for the core: the step's own words.** The step and Undo say "mirror b17, making b20;
  b20.a and b20.b left open, joined at 2 ends": `mirror`'s `describe` writes "left open" from its
  own report, and `joinPhrases` (`core/commands/words.ts`) adds the joins after it. Merging them
  needs the batch's words to know which ends the joins claimed, which is history's wording, the
  core's; the core's N1 fix removes today's trigger.

## 4. Switching a hole's reference keeps the hole (N6)

Hole 1 (no `from`, 300 from design point a, 260 on the cut list) switched to **end a's cut** was
stored `"from": "a.cut"` at 300: the hole moved 40 mm along the bar, unsaid (**measured**,
re-check N6).

- **CAD keeps the geometry when a dimension's reference changes, and the number reads the new
  distance.** SOLIDWORKS: "In sketches, the value of the dimension changes to reflect the new
  attachment point" ([Changing the Attachment Point](https://help.solidworks.com/2017/English/SolidWorks/sldworks/t_changing_attachment_point.htm);
  **read** through the search engine's extract, the page renders by script). AutoCAD's
  [DIMREASSOCIATE](https://help.autodesk.com/cloudhelp/2018/ENU/AutoCAD-LT/files/GUID-8CD54B4A-4BA6-40E8-819D-DDBC013114B8.htm)
  attaches a dimension's origins to new points, and the dimension measures them. Keeping the
  number and moving the geometry is a different, deliberate command (SOLIDWORKS's Replace, by
  user reports, not its documentation). AluKit's own Reverse and Split keep a hole where it is
  ([machining decisions](review-fixes-machining-decisions.md) 7).
- **The conversion is the core's rule and numbers.** A distance `x` from a reference lies at
  `o + w·x` along the axis from design point a, where design point a is `o = 0, w = +1`, end a's cut
  `o = la, w = +1`, design point b `o = len, w = −1` and end b's cut `o = lb, w = −1`, as derive
  resolves a hole (`resolveOps`); `la` and `lb` are the view model's long points (`long_mm`, what
  the menu's distance already reads). From the old reference to the new the distance is
  `(o₁ − o₂)·w₂ + w₁·w₂·x`, built with the core's `plus` and `minus` (`core/commands/numbers.ts`),
  so a number is quantised as every command's, and a distance written over params stays an
  expression that follows them (`2 * 150` from design point a is `2 * 150 - 40` from end a's cut).
- **The row shows the new number**: the step is one `setBar`, and the field and the row's words
  read the stored value ("Ø7 on face +y, 260 mm from end a's cut").
- A bar that does not derive has no long points: the switch says "b5 does not derive, so the hole
  cannot be kept where it is" under the row, and sends nothing.

The test switches b5's hole in the brace fixture to each reference and back, and reads the cut
list: the hole is at the same place on the piece every time (260 from end a; from end b, 660 of
920).

## 5. Draw's second point names the world direction (N7)

The first point's tip said "b3 +x face (world +X) at 560", the second "b4 -x face at 560"
(**measured**, re-check N7): the tool showed the end point's `label`, which a snap's machine label
fills, never its `tip` (**read**, `tools/wire/draw.ts`). `DrawPoint` gains `tip`, the person's
words, which `endUnder` fills from the snap's `tip` when it closes on it, meets it (the station
rewritten as the label's is) or stops level with it; the tool shows `tip ?? label` for both points.
The label stays the machine's, for scripts and tests (rfa 12).

## 6. The order quotes the check once (N8)

The order's open-end reason read "**warn** unconnected: unconnected b17.b: b17.b lies on b4's -x
face with no connection" (**measured**, re-check N8): the rule `unconnected` built its message as
`check-error` does, code and entity first, and the check's message names the end itself
(**read**, `core/check/check.ts`: "b17.b lies on b4's -x face …", "b1.b, b2.a meet at …"). The
reason's message is now the check's line alone: "**warn** unconnected: b17.b lies on b4's -x face
with no connection". `check-error` keeps its form, since its rule names no code.

- **What moved** (**measured**): no golden value and no fixture's order (the cart's has no open
  end; `cart_by_hand.py` lists the rule only); the open-end reasons of any project's `alukit
  order` lose their repeated "unconnected <end>:".

## 7. A machining problem says what is wrong (N10)

Every `machining` diagnostic was titled "Machining to check at b5", so a bar with a tap in a
groove's opening and a hole off its piece listed two problems of one title (**measured**,
re-check N10). The problem list's rule is "a title that says what is wrong and where"
(`core/problems/words.ts`); `unconnected` already names its kind from its message.

- **`machiningTitle(message)`** reads the outcome clause each of derive's machining checks writes
  and names the problem by it: "A hole off its piece" (`on-piece.ts`), "A tap with too little
  wall" (`face-taps.ts`), "The same machining made twice at one place" (`duplicates.ts`), "A tap
  on no core", "A tap that does not fit its core", "A tap whose fit is not checked" and "Taps not
  checked against the section's cores" (`cores.ts`). The clauses read are the outcomes (what is
  wrong), not how the hole is named, so the core's N3 change to how a hole is named keeps them.
  A message none matches keeps "Machining to check".
- **What moved** (**measured**): titles only; the problem's id, detail, `raw`, targets and fixes,
  and every CLI output but `alukit problems`' titles, are as before.

## The nits' tests

The nits have tests, each seen failing for its reason: N7, N8 and N10 unit tests (N7's against the
unfixed `viewer/draw.ts`), N9 in N4's e2e tests and in m3's, whose new assertion failed against a
build without the command bar's change.
