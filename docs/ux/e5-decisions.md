# AluKit editing round, E5: connections, patterns and parts

*Stream E5 of the [editing audit](editing-audit.md) (§7.9, tasks E5.1–E5.6): what was made can now
be changed in the inspector. A face joint's form, a pivot's, a mitre's, a splice's and a butt's
fields, the face a cross hole goes in from, a live pattern's fields and Explode, a part's Replace,
groove and offset, and a corner's mitre and splice. It forked after E0 and E1 merged
([e0-decisions.md](e0-decisions.md), [e1-decisions.md](e1-decisions.md)) and builds on their
registry, menu and arrangements. Interfaces it adds are in [contracts.md](contracts.md), "Editing
round: E5 changes". Labels as in the audit: **measured** (a test or a run says so), **read** (from
the code or the page cited), **inferred**. Decisions are numbered for the design's citations ("e5
3").*

## Done

| Id | What | Where | Test | Failed first |
|---|---|---|---|---|
| E5.1 | A face joint's form in the inspector, filled from the joint: one `setConnection` of what changed; the layers re-picked in Connect, which offers "Replace c23" | `inspector/FaceEdit.tsx`, `tools/forms/FaceForm.tsx` (the form, out of `ToolForm.tsx`), `faceOptionsOf` and `faceEditCommand` in `tools/commands.ts` | `connections-edit.spec`: c23's stations (100, 200) to (100, 200, 300) in one step, the document, the BOM and derive's errors `alukit do`'s; then (100, 150, 200), four more nuts by hand; `commands.test.ts` | yes, both |
| E5.2 | A pivot's base, axis, hinge and quantity; a mitre's and a splice's connector, quantity and gap; a butt's spacer and through end; each butting end's cross-hole face (F12's `hole_faces`) | `inspector/OtherFields.tsx`, `connection.ts`, `rows.tsx`; `ConnectorSelect`'s `joins` | `connections-edit.spec`: seven edits on the cart, each one step, the document `alukit do`'s, seven Undos back; a quantity of 0 refused under its row; G50's cross hole named `-x` and judged by derive; `connection.test.ts` | yes, both |
| E5.3 | A live pattern's along, pitch, count, offsets and skips, one `setPattern` each; Explode, one step that selects what it made; the Pattern tool's pitch typed as every length (D5) | `inspector/PatternFields.tsx`, `pattern.ts`, `edit-actions.ts`; `patternCommand` | `pattern-edit.spec`: pt1's count 7 to 8, its pitch `W / 8`, skips 3 and 5 and along b10 against `alukit do`; Explode against `alukit do explodePattern`; the tool's `W / 12`; `commands.test.ts` | yes, both |
| E5.4 | A part's Replace in its inspector; its groove in the face list; its offset | `inspector/PartReplace.tsx`, `OtherFields.tsx` | `connections-edit.spec`: a T-nut from face +y into groove +y.1 derives where the CLI puts it, then replaced by another T-nut | yes (Replace and the offset); the groove was listed already (decision 25) |
| E5.5 | The corner inspector's mitre and splice beside the butts | `inspector/arrangements.ts`, `CornerInspector.tsx` | `connections-edit.spec`: a ground rectangle's corner mitred in one step with the dry run's cuts (b3 1000 to 1040 by hand), then the three like it (1040 and 640 by hand); `inspector.test.ts` | yes, both |
| E5.6 | Edit and Change connector on a connection (and on a joint marker, for its one joint), Explode on a pattern, Replace on a part, in the menu | `inspector/edit-actions.ts`, registered with the inspector's actions | `menu.spec` (added): a right-click on a ground rectangle's joint marker offers its butt's Edit and Change connector, each taking the inspector to the field; `edit-actions.test.ts`: every kind's menu on the cart | the e2e, yes; the unit test was written after the actions, which landed with E5.3 |

Screenshots, on the cart and a ground rectangle: [a pattern's fields](img/e5/pattern-fields.png),
[a face joint's form](img/e5/face-edit.png), [a pivot's](img/e5/pivot-fields.png) and [a
butt's fields](img/e5/butt-fields.png), [a corner's mitre](img/e5/corner-mitre.png).

## Rows and steps

| # | Decision | Why |
|---|---|---|
| 1 | **Each editable row keeps its own outcome** (`rows.tsx`: `useEdit`, `TextRow`, `SelectRow`, `EditErrors`): a refusal, or a value that makes no step, shows under the row that sent it, and nothing is sent for the latter | E5.2's "each refusal shows under its row"; U30. The inspector's earlier rows shared one outcome per group, so a refusal of the distance showed under the station's last row |
| 2 | **Every field is a merge patch of that field**, `setConnection`, `setPattern` or `setPart`, sent as `alukit do` sends it, one step per edit | CLI parity with no new command: the three commands take RFC 7396 patches already (**read**, `src/core/commands/entities.ts`) |
| 3 | **Lengths are typed as every length is** (D-UX-17): a pitch, an offset, a gap, a spacer and a station's distance take units and expressions, and are written as the number they come to unless they read a param, which is then kept as typed | The audit's D5, and E-UX-16's "`=W` binds in every numeric field". A count and a quantity are whole numbers, as the schema's `int` is |

## Patterns (E5.3)

| # | Decision | Why |
|---|---|---|
| 4 | **The Pattern tool's pitch is `typedNumber`'s**, as the draw tool's lengths are: `W / 12` stays `W / 12`, `15cm` is 150 | D5: it was `Number(text)`, so it took no expression and no param (**read**) |
| 5 | **The inspector takes a count down to 1**, the schema's minimum; the tool still asks 2 or more | A pattern of one is a valid document (no copies), a pattern made with one would make nothing |
| 6 | **Skips are typed as copy numbers**, `3, 5`, sorted and each once; empty removes `skip` | The copies' own numbers are what a copy's id (`b26@3`) and its Leave out already say |
| 7 | **Along is a select of the document's bars and runs**; a direction stays in words | The audit leaves patterns by direction to later (row 21) |
| 8 | **Explode is one `explodePattern` and selects every entity it made** (bars, parts and connections), from the step's `created`; the button and the menu's action run the same function | E-UX-13. A refusal ("pt1 is used by c35") shows under the row from the inspector, in a toast from the menu, as a key's does |

## Corners (E5.5)

| # | Decision | Why |
|---|---|---|
| 9 | **A corner of two ends lists each joint derive accepts** after the butts, from the same answer (`GET /api/arrangements` already carries `joints`), applied by the core's `jointBatch` | E1.4 built the dry runs; reading them is no new request. What was shown is what is built (**measured**: the unit test compares the batch with the answer's) |
| 10 | **Only a pivot that sets an end there, or a pattern copy, keeps a corner from being arranged**; a butt, a mitre or a splice is the corner's joint, which any arrangement replaces | e1 15: taking a corner's joint out removes a mitre or splice too. The inspector refused "c9 is a splice" before |
| 11 | **A joint's "Apply to matching corners"** takes the corners where the same lines meet the same way and the same profiles' ends meet, and asks the server to judge them all first (`rule=miter` for those corners); derive's error at any one refuses it, in derive's words | A mitre joins one section (§4.5); matching by lines alone would mitre corners of two sections, then report the error after the step. One dry run of the set is derive judging (e1 14) |
| 12 | **Flip stays which bar runs through**: it cycles the butts and passes a joint by; at a mitred corner it has nothing to flip | The arrow is the through-bar flip (Onshape's Frame); stepping through a mitre would change the joint's kind under a button that says Flip |
| 13 | **A joint not offered says why**, only at a corner of two ends, where one could be | At a box frame's corners of three ends both joints are refused by shape, which is no news |

## Connections (E5.2)

| # | Decision | Why |
|---|---|---|
| 14 | **A connector is chosen among those that join that way** (`ConnectorSelect`'s `joins`): a splice's among the splices, a pivot's among the hinges, a mitre's among every connector; the joined bars' systems first, as a butt's | A splice or a hinge was kept out of the butt's list for the same reason. No subtype names a mitre's connector (**read**, the catalog's subtypes), so it is not narrowed |
| 15 | **A pivot's base is a station, edited as a part's is**, but on a face only | §4.5: a pivot's base is on a face, not in a groove; the Connect tool's base snaps the same way (**read**, `wire/connect.ts`) |
| 16 | **The through end offers the schema's choices** (the corner's default, cover, node, none, or end a or b with its mode), only where the butt runs through a bar | §4.5: "Not with an end as `through`" |
| 17 | **A cross hole's face is one face per butting end, or AluKit's choice** (F12's `hole_faces`). A face per hole, written by hand or the CLI, shows in words, and choosing one face replaces it. Choosing AluKit's choice for the last end removes the map | The brief: a person who wants another face than AluKit's had no way to say so in the app. The holes' positions are derive's and not in the view model, so a per-hole list cannot be offered without them; one face per end is F12's own first form |
| 18 | **The cross-hole rows show where a connector applies** (the connection's own, or a butt's project default), and derive judges a face as it judges the catalog's: a face no hole can take is a `connection` error on the field, under Problems, its row lit | F12 decision 14: derive's error, not the schema's, so a half-edited document still draws. **Measured**: G50's `-x` (the hole at (20, 20) 60 from its core) |

## Face joints (E5.1)

| # | Decision | Why |
|---|---|---|
| 19 | **The Connect tool's face form is shared** (`tools/forms/FaceForm.tsx`), and so is the function that turns it into fields (`faceFields`) | E-UX-14: one form, already tested; a joint is written one way whether made or edited |
| 20 | **An edit sends the difference between what the form wrote when filled from the joint and what it writes now**, as a merge patch, so a field the person did not touch stays as written | A sleeve in the stack, a rail-hole selection or a list member with a comma cannot be typed back; they are shown in words, read only, and kept. A resting contact takes no stations, fastener or stack (derive's error, **read** `fastenings.ts`), so fastening "none" removes them all, the kept ones included |
| 21 | **A face joint is applied with a button, not field by field** | Its fields depend on each other (a fastening needs a fastener and stations); a field-by-field step would pass through joints derive refuses |
| 22 | **The layers are re-picked in Connect**: "Change layers…" opens the tool on a face joint with the layers picked and the form as the inspector's draft; its Apply reads "Replace c23" and sends one `setConnection` of the layers and any field changed; "make a new one instead" drops the replacing, as leaving the tool does | E-UX-14 |

## Parts (E5.4)

| # | Decision | Why |
|---|---|---|
| 23 | **Replace lists the catalog's items of the part's kind, its own family first** (a T-nut for a T-nut), with its options, for this part or every part like it (the same item and options as written); one `setPart` each (`replaceBatch`) | The catalog card's Replace from the other side, and the bar's Replace's scope |
| 24 | **The offset is `u, v`**, across the face then out from it, empty removes it | §4.3's `off_mm` |
| 25 | **Grooves were already in the part's face list**, since S5 (**read**: `facesOf` in `OtherFields.tsx`, added with S5's inspector); the part the audit measured was likely the cart's carriage, on a rail, which has none (**inferred**). E5.4's test passed that half on the first run | The audit's §3.2 said "not offered"; its row now carries the correction |

## Actions (E5.6)

| # | Decision | Why |
|---|---|---|
| 26 | **Edit (a connection), Change connector (a butt, mitre, splice or pivot), Explode (a pattern or one of its copies) and Replace part**, registered with the inspector's own actions (`edit-actions.ts`); Delete is the inspector's and already takes them | E-UX-1. A face joint names fasteners, not a connector, so its menu has no Change connector |
| 27 | **Edit, Change connector and Replace take the inspector to the field** through `asked` (the field focused, the form opened), as the bar's Replace profile does through `replaceAsked` | The menu and the inspector stay one place to edit; the menu does not grow a second form |
| 28 | **A joint marker's menu offers its joint's Edit and Change connector** when one connection is at the corner; running one selects that connection first | Most connections have no body to right-click: a butt's connector is not drawn (§4.5's v1 limit), and a face joint's bolts sit inside its layers (**measured**: every point along the cart's c23 bolts hovers a bar or nothing). The marker is the joint's sign in the view (§11's default) |

## Found on the way

| # | Decision | Why |
|---|---|---|
| 29 | **A command accepts `bore` in a sleeve's `len_mm`**, as derive reads it (§4.5: "In `len_mm`, `bore` is that layer's inside depth"). The schema says which names an expression's field binds besides the params (`exprNames` on the sleeve's `len_mm`); the command check and a param's readers take them from there. `bore` anywhere else is still "not a param" | **Measured**: `alukit do` refused every `setConnection` of the cart's c23, whatever it changed (`stack/2/len_mm: "bore" is not a param`), and so would any `addConnection` of a face joint with such a sleeve: the check read every expression against the params alone, since M3b. E5.1's acceptance is c23's edit, so the cause was fixed in the core, with its failing test (`commands.test.ts`). No golden value or diagnostic moves: derive already bound `bore` |
| 30 | **The face form's draft belongs to the revision it was typed against**, compared during render | A reset in an effect ran after paint, so a value typed before it ran was overwritten (**measured**: the E5.1 test under load). A new revision still refills the form |
| 31 | **A field table's value cell takes the room its label leaves, and no more** (`td { width: 100%; max-width: 0 }`); the face form's stack field takes its row | **Measured**: a pivot's Base select, listing labelled bars, was 454 px wide and the table 570 px in a 320 px panel, its selects cut off at the edge; a select's `max-width: 100%` cannot hold it in a table sized by its content. After: the table 296 px, the bar's fields unchanged (their cell 246 px before and after) |

## Against the E-UX decisions

- **E-UX-13** and **E-UX-14**: followed. **E-UX-1**: every new edit is an action or a field of the
  inspector's.
- **No deviation.** Decision 17 builds one face per end of F12's two forms, and says why.
- **The brief's E5.1 premise, measured otherwise**: a third station at 300 does not add hardware on
  the cart. 300 along b20 is y 450, past the packers (y 200 to 400), so derive reports "the
  fastener misses b21" for its two bolts and counts none, the CLI exactly as the app. The test
  keeps that edit and checks those errors against the CLI's, then shows the hardware rising with a
  station that fits (150).

## What moved

In the core, one fix (decision 29): a command no longer refuses a sleeve cut to `bore`. Nothing in
the outputs; no golden value, fixture diagnostic or cut list moved (`draw.spec` byte for byte). The corner inspector of a two-end corner now shows a mitre card
(`corners.spec`'s count of arrangement cards is now the count of butt cards, two, and one mitre
beside them: a selector change).
