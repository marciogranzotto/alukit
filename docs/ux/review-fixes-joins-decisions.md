# AluKit review fixes: joins (B1–B3)

*2026-11-27. The three blockers of the [editing review](review-editing.md), each a cut list or a
BOM that went wrong while Problems stayed green: pattern copies that left the template's joints
behind (B1), a mirrored bar left unjoined (B2), and a rail clicked from one post's face to
another's that joined nothing while the order read Ready (B3). Each is fixed at its cause, in the
core, with the CLI's path the app's. Decisions are cited as "rj n"; the design's calls are
120–124. Labels: **measured** (a test or a run says so), **read** (from the code or the page
cited), **inferred**.*

## Done

| # | What | Where | Test | Failed first |
|---|---|---|---|---|
| B1 | A pattern's copies carry the joints that claim only its template bars' ends, listed or not; `explodePattern` and `array` copy them too | `src/core/derive/own-joints.ts` (`ownJoints`), `derive/patterns.ts`, `commands/patterns.ts` | `src/core/joins.test.ts` B1: four slats, each 520 and joined by `c9@k`, `c10@k`; explode and array give the same; `editing.spec` A8: every slat 520, none unjoined, no open end | yes: the copies were 600, their ends `default`; explode and array made no joint |
| B2 | `mirror` carries the set's own joints, landed on the bars at their images, and reports an end it cannot join; the app's Mirror then joins each image's end, as Duplicate does, and says what joins | `commands/mirror.ts`, `src/ui/edit/batches.ts` (`mirrorBatch`), `src/ui/tools/wire/mirror.ts` (`mirrorWords`), `src/ui/tools/moves.ts` (`copiedJoins`) | `joins.test.ts` B2 and its CLI test (`alukit do mirror`); `batches.test.ts`: the brace's image and its words; `editing.spec` "A6 on a bar": cut as the brace, joined, the same with `alukit do mirror` alone | yes: the image was 1141.27, its ends `default` |
| B3 | `autoConnect` butts an end lying on a bar's face, or inside it, on that bar, and the draw tool's preview names the butt before the click; the check calls such an end open while nothing joins it, with a Join that works; the order rule `unconnected` warns of every open end | `commands/join.ts` (`liesOn`, `planJoin`), `derive/ends.ts` (`buttBearing`), `check/check.ts`, `problems/problems.ts`, `order/rules.ts`, `project/schema.ts`, `src/ui/tools/joint.ts` (`touchesBars`) | `joins.test.ts` B3 and its CLI test: the rail butts on b3 and b4, cut 920; the check's two warnings, their fix, the order's warnings; `joint.test.ts`: a point on a post's face; `editing.spec` "A5 by pointer" | yes: "only b13 meets at that point", no warning, and no preview by the pointer |

## Research

| Source | What it does | What AluKit takes |
|---|---|---|
| Fusion, [Rectangular Pattern][fu-rect] (**read**, fetched) | Compute type **Adjust**: "creates potentially different copies by patterning features and calculating extents or terminations of each instance individually" | A copy re-solves its template's end conditions against what is around it: each copied butt bears on the rail where the copy's line crosses it (rj 2) |
| Onshape, [Linear Pattern][os-lin] (**read**, fetched) | **Reapply features** regenerates each instance "from the selected features, including feature dependencies and end conditions" | The same: what ends a body is patterned with it, and solved per instance (rj 2) |
| SOLIDWORKS, [Geometry Pattern][sw-geo] (**read** from the search engine's extract; the page renders by script and was not fetched) | With Geometry pattern selected, "end conditions and calculations are ignored", each instance an exact copy; cleared, an Offset from Surface instance is solved against the surface | A copy is not an exact copy of the template's cut: it is the template's bar with the template's joints, cut where they put it (rj 2) |
| Tekla Structures, [Copy objects][tk-copy] (**read**, fetched) | "When you copy an object, Tekla Structures copies all objects connected to it, including the components" | Copying a member copies its connections (rj 1, 3, 4) |
| Tekla Structures 2018, [copying and moving objects][tk-2018] (**read** from the search engine's extract; the page answers 403) | Copying objects connected to another part (connections, bolts), it "tries to find suitable new main parts for these copied objects. If none are found, some of the connected objects may not be copied at all" | A mirrored joint lands on the bar at its member's image, and is left out, its end reported open, where no bar stands there (rj 4) |
| SOLIDWORKS, [Copy with Mates][sw-cwm] (**read** from the search engine's extract) | Copies components with their mates, every mate selected at first; each kept on its reference (Repeat) or given a new one | A copy keeps its joints by default; a reference outside the copied set is kept (a translation) or remapped (a mirror's image) (rj 1, 4) |

## Decisions

| # | Decision | Why |
|---|---|---|
| 1 | **A set of bars' own joints** (`ownJoints`) are the connections that claim bar ends, every one an end of a bar in the set: a butt's butting ends and a through end it names (`through_end: { end }`), a miter's or a splice's two ends, a pivot's carried ends. A face connection claims no end and is never one. A joint that also claims an end outside the set (a corner's butt, shared by two rails) is not the set's. Read from the document, not from derive's claims | The joints that cut a bar's ends are its end conditions, which CAD patterns and copies carry with the body (research). A shared joint copied would claim the outside end twice (two providers). The document is what derive's patterns and the copying commands both see, so the rule is one |
| 2 | **A pattern carries its template bars' own joints in derive**, listed or not (§4.7): each copy gets `c17@k`, its through bar kept outside the template as §4.7 keeps any outside reference, so it bears on the rail where the copy's line crosses it. A joint another pattern lists is that one's | **Measured** (B1): the slat 520 and joined, its copies 600 through both rails. Live, so a joint made after the pattern (the problem list's Join on the template) reaches the copies. The one-step "Draw the bar to repeat" batch could not name the joints `autoConnect` makes (polish-editing-ui 4): derive needs no names. Rejected: `addPattern` writing the joints into `template`. It would serve that batch (the joins run first) but miss every joint made later, and leave hand-written patterns wrong |
| 3 | **`explodePattern` and `array` copy the own joints too**, through the same function, and `array` answers `joined`: each new connection and the bar it joins to | `array` is a pattern made ordinary at once (§6), so it must make what derive makes. **Measured**: exploding the slats' pattern keeps every cut; a duplicated slat keeps its butts, with the template's connector rather than the default |
| 4 | **`mirror` carries the set's own joints**, their members outside the set landed on the bars at their images by the existing rule (§6, call 112). A joint whose member has no image is left out, and the image's ends it claimed are listed in the answer (`open`) and the words ("b14.a and b14.b left open"); one the set names is mirrored, or refused, as before. The answer also gives `joined` | **Measured** (B2): the brace's image across x = 500, 1141.27 and unjoined, is now 1049.97, butted on b4 and b3 by the brace's own butts mirrored. A mirrored joint is the image of the joint, connector and all. Refusing the mirror for a joint the person did not name would block an image they asked for; dropping it silently is B2 again, so it is said (Tekla's "may not be copied at all", said aloud) |
| 5 | **The app's Mirror step is `mirror`, then an `autoConnect` at each image's end** (the first 48, after any removal), as Duplicate's is `array` then its joins (e3 10). In the app, not inside the core's `mirror` | The core's commands each do one thing, and the joins by rule are commands the log keeps and `alukit do` replays (§6, §7.1), as for drawing, Move, Rotate and Duplicate. `alukit do mirror` alone already gives the joined image wherever the bar's joints were its own (rj 4: the review's brace); the joins after it serve an end whose joint it shared with other bars (a rail's corner), which only the corner rule can join, and one that lands on a face. One rule for every copying verb in the app (review B2's fix), one in the core for every copy (rj 1) |
| 6 | **The previews say what a copy's joints join**: Mirror's "makes b14 · joins b4 (c11) · joins b3 (c12) · cut 1049.97", or "b14.a and b14.b stay open"; Duplicate's lists a joint `array` carried as a join, not as something it makes | Review B2: Mirror's preview said only "makes b20". The words read `info.joined`, as Duplicate's read each `autoConnect`'s plan |
| 7 | **`autoConnect` butts an end that lies on a bar** (`liesOn`): its design point on the bar's bounding box or inside it (within tol.len), strictly between the bar's end faces as derived, where a butt through the bar would bear on it (the butt's own crossing, `buttBearing`: the end's centre line crosses a face clear of its edges). That bar runs through, after a bar passing the point, before the corner rule. An end at a bar's end is a corner, and the corner rule decides it as before | **Measured** (B3): the rail clicked between the back posts' faces now butts on b3 and b4, cut 920, and the draw tool's preview names the butt before the click: its filter for where a stroke can join (`touchesBars`) says yes on a bar's box too, read a tolerance wider than the core's, so it never says no where the core joins. One crossing for the joint's plane, its angle and this test, so the join made is the one derive accepts. A strip lying along a rail's face is not taken (its line misses the face); `addFrame`'s documents, every corner rule's arrangement and every golden are unchanged (**measured**) |
| 8 | **The check calls an end open when it lies on a bar with no joint** (§5.5's unconnected ends, code `unconnected`, a warning): "b13.a lies on b3's +x face with no connection", or "b13.a runs 40 mm into b5, past its +x face, with no connection", naming the end and the bar. Not an end a butt bears on (an end plate's, a block's), as at a corner; not between two context bars | Review B3: the rail's ends said "open: nothing joins it" and Problems said nothing. A copy run into its rails (B1) would have been caught too. **Measured** on G35: a block's end lies inside the 40 × 80 that bears on it by its design segment, but past its cut and as the butt's through member, so the test reads the cut extents and skips through members (the first run warned of it; a test holds it) |
| 9 | **The order rule `unconnected`** (warn by default, §5.5): every open end of the check, a corner's or one on a bar, is an order reason for the suppliers of its bars, quoting the check's warning as `check-error` quotes an error, so the problem list keeps one problem with its Join fix, now from the check and the order | A check warning never reaches the order: the top bar said Ready to order while the rail floated (**read**: `ui/shell/readiness.ts` counts the order's warnings only). An open end buys nothing to hold it, as a butt with no connector buys nothing (`no-connector`, polish 1), so the order warns the same way: "Ready, 1 warning", never a plain Ready. A project may set it to `block` or `off` |
| 10 | **The problem's words**: "Open end: b13.a lies on b3 with no connection" (or "runs into"), its detail saying nothing holds it and nothing is bought to; its fix, "Join with the default butt", only where `autoConnect` would make it. An open end of a pattern's copy is joined at its template's end, whose copies follow (rj 2) | E-UX-12's rule: a fix the list offers is never refused. A copy is no entity a joint can name |
| 11 | **`editing.spec` checks what A8 missed**: every slat is cut as the template (520, by hand) and no slat end is unjoined, nor any end open; A5 checks the brace's ends are held and nothing is open; A6 that nothing is open; two scenarios join them: "A5 by pointer" (B3's path) and "A6 on a bar" (B2's) | Review §7: A8 compared the app with a CLI project built by the same commands, which had the same unjoined copies |

## What moved

Compared on all 58 fixture projects: `alukit check --json`, `problems --json`, `cutlist`, `bom`
and `order --format json`, before and after (**measured**).

- **No check diagnostic, cut list or BOM moved** in any fixture. No fixture has an end on a face
  or inside a bar without a joint, and the cart's only pattern lists its joints already, so B1's
  rule adds none there.
- **Every order lists the new rule** in its rules table (`"unconnected": "warn"`). The cart's
  by-hand order (`tests/fixtures/cart/hand/cart_by_hand.py`) gains it in its table, and the
  regenerated `expected-order.json` moves by that one line; the cart has no open end.
- **G14 and G24**: their open corners (one in G14, two in G24, warned of before) now warn at the
  order too, rule `unconnected`, for their bars' suppliers; in `alukit problems` each is the same
  problem, from the check and the order, counted in `order.warnings` (0 → 1, 0 → 2). Both
  orders stay READY. Rj 9 is their cause.
- No golden value moved.

## Tests

- `src/core/joins.test.ts` (new): B1 (the pattern, `ownJoints`, explode and array), B2 (the
  brace's image; a joint with no image left open), B3 (the face rail joined; a strip along a face
  and the frame's corners not; G35; the check's open ends), and the CLI: `alukit do mirror`,
  `alukit problems` and `alukit order` warning of the floating rail, each Join clearing its
  warning.
- `src/ui/edit/batches.test.ts`: Mirror's batch and words on the brace, its open ends; a
  duplicated slat's carried butts in Duplicate's words (a guard: the words were the same before,
  when `autoConnect` made the butts).
- `src/ui/tools/joint.test.ts`: a point on a post's face, or inside its box, touches it.
- `tests/e2e/editing.spec.ts`: A5, A6 and A8 strengthened; "A5 by pointer" and "A6 on a bar".

Failed first (**measured**, the new tests run against `main`'s sources): the core's B1–B3 tests
(the copies 600 with `default` ends; explode and array no joints; the image 1141.27; "only b13
meets at that point"; no warning); `batches.test.ts`'s mirror test (one command, no joins);
`joint.test.ts` (false on the face); `editing.spec` A8 ("b17@1: expected 520, received 600"), "A6
on a bar" (the preview "makes b18") and "A5 by pointer" (no joint preview). A5's and A6's added
checks, and the Duplicate words, held before as after: they guard.

[fu-rect]: https://help.autodesk.com/cloudhelp/ENU/Fusion-Model/files/GUID-9622573F-06FA-462F-AFA7-97CD0C7AA0C9.htm
[os-lin]: https://cad.onshape.com/help/Content/PartStudio/linear_pattern.htm
[sw-geo]: https://help.solidworks.com/2017/English/SolidWorks/sldworks/c_Geometry_Pattern_Concept.htm
[tk-copy]: https://help.trimble.com/doc/tekla-structures/2025/gen_copy_objects
[tk-2018]: https://teklastructures.support.tekla.com/2018/en/gen_copying_and_moving_objects
[sw-cwm]: https://help.solidworks.com/2021/english/solidworks/sldworks/HIDD_REPEAT_MATE.htm
