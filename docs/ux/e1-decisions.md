# AluKit editing, stream E1: core and CLI

*E1 of the [editing audit](editing-audit.md) (§7.5): the core and CLI work the 3D editing tools
stand on. This note covers E1.2–E1.6; E1.1 (`transform`, with `alukit move` and `rotate`) is built
with the Move tool, and its note is [drag-ends-decisions.md](drag-ends-decisions.md), "The Move
tool". Drop 1 is E1.5, E1.2 and E1.3; drop 2 is
E1.4 and E1.6. Labels: **measured** (a test or a run says so), **read** (from the code),
**inferred**. Decisions are numbered for the design's citations ("e1 3").*

## Done

| Id | What | Where | Test |
|---|---|---|---|
| E1.5 | `similarTo` and `connectedTo`; `alukit query` takes `like:<id>`, `connected:<ids>` and `connected*:<ids>` | `src/core/query.ts`, `src/cli/query.ts` | `src/core/query.test.ts`; `alukit query` in `src/cli/edit.test.ts` |
| E1.2 | `autoConnect` joins an end on a joined corner through the corner's through bar (E-UX-12) and declares an angled end's cut (E-UX-11); one join rule, shared with the problem list | `src/core/commands/join.ts`, `geometry.ts`; `Derived.claims` (`derive/ends.ts`) | `src/core/brace.test.ts` on `tests/fixtures/brace`; `autoConnect` in `commands.test.ts` |
| E1.3 | Words for every diagnostic code; `angled-end`'s two fixes; `unconnected`'s fix only when the join rule accepts it (D3, D4) | `src/core/diagnostics.ts`, `problems/{words,problems}.ts` | `problems.test.ts`: every code, and the brace's fixes applied by dry run |
| E1.4 | A corner's miter and splice arrangements, judged by derive; `alukit arrangements` prints them, `--rule miter` and `--rule splice` name them | `src/core/corners/{arrange,batch}.ts`, `src/cli/arrangements.ts`, the server's `/api/arrangements` | `arrange.test.ts`: G01's ground corner, a collinear pair, G10's two sections, a box frame's corner; `alukit arrangements` in `src/cli/edit.test.ts` |
| E1.6 | Dry-run effects list the parts a step adds; `explodePattern` maps each copy to its new entity | `src/core/commands/{dry,patterns}.ts`, `src/cli/do.ts` | `src/cli/edit.test.ts`: `mirror`, `array`, `splitBar` and `explodePattern` on the cart, each dry run's numbers against the applied model |
| — | A mass computed from a traced section's area is tagged `est`, not `calc` (a follow-up asked for with drop 2) | `computedSrc` in `src/catalog/link.ts`, `barMass` in `src/core/items.ts` | `catalog.test.ts`: a traced section with nothing published, then exact, then with a published area |

## Decisions

| # | Decision | Why |
|---|---|---|
| 1 | **One join rule** (`planJoin`, `src/core/commands/join.ts`): which ends at a point are free, which bar runs through, whether the through bar's end is the corner's, which ends are cut at an angle. `autoConnect` applies it; the `unconnected` problem asks it before offering "Join with the default butt" | E-UX-12: "one shared function, not a dry run per problem". The audit's D4 was a fix offered by one rule and refused by another (**measured** at `b8ff033`) |
| 2 | **An end is free when no provider claims it**, read from derive's claims (`Derived.claims`: every provider that names an end, whether or not its plane resolved), not from its plane's provider (`by`). The check's unconnected ends read the same | An end whose claim fails (two providers, a miter of two sections, an angled end not declared) falls back to its default plane, `by: "default"`, and was taken as open: the check warned "has no connection" beside the failure's own error, and `autoConnect` would have added another provider. G10 and G11 each lose a false `unconnected` warning, and the "Join" fix it offered (**measured**, below) |
| 3 | **An end at a joined corner gets a butt of its own** through the corner's through bar, with `through_end: "none"`; the corner's butt is not touched | Put into the corner's butt, the brace's infinite prism takes part in the cover rule and cuts the post's own end to the brace's face (**measured**: a dry run of `c3.ends + b13.a` says "b3.a is cut at 36.87° by c3"). A butt of its own also keeps the brace's connector apart from the rails' |
| 4 | **The corner's through bar** is the one a butt claiming an end at the point runs through (a butting end or the through end itself), the first such butt by id. A corner with no butt through a bar (a miter) has none, and the end stays refused ("only b3 meets at that point: nothing butts on it") | A corner has one through bar in every arrangement the corner rules make; the lowest id is the rule's own tie-break |
| 5 | **The angle is derive's own**: `buttEndAngle` (`derive/ends.ts`) uses the crossing the butt's end plane is built from, factored out of `butt()`. An end is declared `angle` when that angle is over `tol.ang` and under 90° − `tol.ang`, and only when it declares no cut of its own (a `square` stays). `autoConnect`'s answer gains `angled`, the ends it declared, and its words say "cut at an angle" | One computation, so the declaration and §4.5's check cannot disagree. A plane parallel to the axis is the butt's error, not a cut to declare. The draw tool's joint preview reads only `through` and `ends`, so the new field changes nothing there (**read**: `src/ui/tools/joint.ts`) |
| 6 | **`autoConnect`'s refusal says when every end at the point is joined already**, apart from "no bar end meets at that point" | The old words said no end met where two did (G01's corner), and the problem list now shows the refusal's words (decision 9) |
| 7 | **The diagnostic codes are one list**, `DIAGNOSTIC_CODES` in `src/core/diagnostics.ts`; `Diagnostic.code` and the collector's methods take only those, and the problem titles are a map over the list (`Record<DiagnosticCode, string>`). The unit test sweeps the list, one test per code | A code cannot be emitted without its words: the type refuses it before a test runs. Only five call sites passed a code as a plain string (helpers with a code parameter), now typed. Catalog diagnostics keep their own type: a project sees them as `catalog` |
| 8 | **Titles say what is wrong, never the code**: "A miter problem" is now "A mitre that cannot be cut", "A two providers problem" "An end joined twice", "A chain problem" "An end that reads another end's plane", and every code without words has some. `angled-end` has its own: "b13.a is cut at an angle it does not declare", with the joint and its angle in the detail (read from the message, as the order's reasons are) | D3; principle 5 of the UX plan |
| 9 | **`angled-end` offers "Cut it on the face" and "Cut it square"**: one `setBar` merge patch on the end's `cut`, on the bar that owns the end (a pattern copy's template). **`unconnected` offers its join only when decision 1's rule accepts it**; otherwise its detail gives the rule's reason | A problem's fix never fails (E-UX-12). Both fixes clear the error in a dry run (**measured**: `problems.test.ts`) |
| 10 | **`similarTo(doc, derived, id, "item" \| "tag")`**: same kind; by item, a bar's and part's item and options as derived (the default bar's included), a connection's type and items, any other kind the items it names; by tag, every tag the entity carries (an untagged entity is like nothing but itself). Itself included; pattern copies never | The app's "select similar" (E2.2) and `like:` need one meaning. Options as derived, so posts that take the default bar are alike with bars that name it |
| 11 | **`connectedTo(doc, ids, { transitive })`** reads the document's references: a connection joins every bar it names structurally (through bar, ends, a pivot's base, a face connection's layers and a run's bars, a stack's bars), not a bar its expressions read. From a bar, its connections' bars; from a connection or a run, its bars; from anything else, what it names and what names it. It takes no derived model, unlike the audit's sketch (§7.3) | "Joined" is what connections say, which the document holds; nothing derived changes it. A cover strip placed on a beam by its points (the cart's b19) is not joined, as it is not |
| 12 | **The audit's other defect, an end a joint claims reading "open: nothing joins it"** (D2), is the UI's: the inspector's words (`src/ui/inspector/words.ts`) read the derived plane's provider, `by: "default"` after a failed claim, while the derived butts' seats and the written connection name the claim. It is left to the stream that owns those words (E4 in the audit's plan). Its core half, the check and `autoConnect` taking a claimed end for an open one, is decision 2. With E1.2 the audit's brace no longer fails its claims, so it no longer shows the words | The core already reports the claim; the fix belongs where the words are made |
| 13 | **A miter and a splice are arrangements beside the corner rules** (`Arrangements.joints`), not among them (`rules`) | A joint is no corner rule (§4.5): `autoConnect` never makes one, and the inspector's arrangements (`src/ui/inspector/arrangements.ts`) read `rules` as corner rules and rebuild their batches by rule. A separate list leaves them as they are for E5.5 to extend |
| 14 | **Derive is the judge**: a joint's batch (the corner's joint out, then `addConnection` of the two ends) runs from the state the corner's butts left, and an error-severity diagnostic in its derive that the state did not have refuses it, in derive's words. The only check of its own is that the corner holds two ends | One rule, not two that can disagree: "the two bars are parallel: use a splice", "b1 and b2 are not collinear (90.00°)", "a miter joins one section" are derive's (**measured**: `arrange.test.ts`). Judged against the current state instead, G10's miter, already in error, would have looked fine |
| 15 | **Taking a corner's joint out removes a miter or splice of its ends**, whole, besides its butts; `lostFields` names what such a connection carries beyond its type and ends (a miter's `gap_mm`) | So any arrangement follows any other: after a miter, the corner rules butt the corner again rather than finding every end joined. A pivot or a face connection is not the corner's joint and stays |
| 16 | **`DryEffects.parts`**: each part a step adds, as derived, with its item, where it lands (bar and distance from its A, and origin, to 0.01 mm) or its quantity counted | The gap E1.6 names, **measured** on the cart: a dry run of `mirror` of a part, or `explodePattern` of a part pattern, listed nothing, since effects listed bars only. Bars and cuts were listed already for `array` and `splitBar`, so their effects are unchanged; the tests hold all four to the applied model's numbers |
| 17 | **`explodePattern`'s `info.copies`** maps each pattern copy (`b26@2`) to the entity it became | The copies were drawn already, so a preview that reads only `added` would draw them twice; the map says the new entities are the copies, in place |
| 18 | **A computed value's provenance follows its section's fidelity** (`computedSrc`): `est` from a traced outline, `calc` from an exact one or a generator; a mass from a published area stays `calc` | Design §3.5's fidelity table says a traced section's computed properties are `est`; `barMass` tagged every computed mass `calc`. **Measured**: all eight traced Forseti items publish their mass, so no built-in mass moves. The BOM's markdown marks only a `calc` mass, so an `est` one, published or traced, reads plain: unchanged here, and left to the BOM's owner |

## What moved

Compared on every fixture project, `alukit check --json` and `alukit problems --json`, before and
after (**measured**):

- **G10**: the warning `unconnected b1.b` ("b1.b, b2.a have no connection") is gone, with its
  "Join" fix; the miter c1 names both ends, and its error stays. Decision 2.
- **G11**: the warning `unconnected b2.a` is gone, with its "Join" fix, which would have made a
  third provider; the `two-providers` error stays. Decision 2.
- **Problem titles** of G07 (`angled-end`, which also gains its two fixes), G10 (`miter`), G11
  (`two-providers`) and G20 (`chain`). Decision 8.
- No golden value, cut list or derived output moved: the box frame's corners have no angled end
  and every corner finds a free partner, so `addFrame`'s documents are byte for byte the same (the
  `add frame` tests and `base-frame.test.ts` pass).
- `commands.test.ts`: the skipped words at G01's joined corner, "no bar end meets at that point",
  are now "every bar end at that point is joined already" (decision 6). Not a diagnostic.
- **Drop 2** (E1.4, E1.6 and the traced provenance, with `main`'s traced sections merged in):
  nothing moved against drop 1, on all 55 fixture projects (**measured**). The arrangements of a
  served project gain `joints`, and dry runs' effects gain `parts` (`{}` where nothing is added);
  the tests that compare them whole (`server.test.ts`, `inspector.test.ts`) compare the new fields
  too and pass. The corner inspector asks for every arrangement, so a corner of two ends now also
  runs its miter and its splice, two more derives; a corner of three ends, as every corner of a
  box frame is, is refused before anything runs (**read**; not timed).

## New fixture

`tests/fixtures/brace`: the audit's box frame (1000 × 600 × 750 of the test catalog's 40 × 40),
made by `alukit add frame`, and `brace.json`, the draw tool's batch for a diagonal in the back
plane from the bottom-left corner to the top-right one. By hand: the posts' inside faces stand at
x = 40 and x = 960, so the brace is cut 920 / 0.8 = 1150 mm, each end at acos 0.8 = 36.87°.
