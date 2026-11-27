# AluKit editing, stream E1: core and CLI

*E1 of the [editing audit](editing-audit.md) (§7.5): the core and CLI work the 3D editing tools
stand on. This note covers E1.2–E1.6; E1.1 (`transform`, with `alukit move` and `rotate`) is built
by another stream with the Move tool and has its own note. Drop 1 is E1.5, E1.2 and E1.3; drop 2 is
E1.4 and E1.6. Labels: **measured** (a test or a run says so), **read** (from the code),
**inferred**. Decisions are numbered for the design's citations ("e1 3").*

## Done

| Id | What | Where | Test |
|---|---|---|---|
| E1.5 | `similarTo` and `connectedTo`; `alukit query` takes `like:<id>`, `connected:<ids>` and `connected*:<ids>` | `src/core/query.ts`, `src/cli/query.ts` | `src/core/query.test.ts`; `alukit query` in `src/cli/edit.test.ts` |
| E1.2 | `autoConnect` joins an end on a joined corner through the corner's through bar (E-UX-12) and declares an angled end's cut (E-UX-11); one join rule, shared with the problem list | `src/core/commands/join.ts`, `geometry.ts`; `Derived.claims` (`derive/ends.ts`) | `src/core/brace.test.ts` on `tests/fixtures/brace`; `autoConnect` in `commands.test.ts` |
| E1.3 | Words for every diagnostic code; `angled-end`'s two fixes; `unconnected`'s fix only when the join rule accepts it (D3, D4) | `src/core/diagnostics.ts`, `problems/{words,problems}.ts` | `problems.test.ts`: every code, and the brace's fixes applied by dry run |

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

## New fixture

`tests/fixtures/brace`: the audit's box frame (1000 × 600 × 750 of the test catalog's 40 × 40),
made by `alukit add frame`, and `brace.json`, the draw tool's batch for a diagonal in the back
plane from the bottom-left corner to the top-right one. By hand: the posts' inside faces stand at
x = 40 and x = 960, so the brace is cut 920 / 0.8 = 1150 mm, each end at acos 0.8 = 36.87°.
