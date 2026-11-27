# Acceptance gaps: connector fit, joint recipes, end holes, cost scope, covers, sleeve holes

*2026-11-26. The v1 acceptance passed every numeric test but found six gaps in the model (A1–A7,
A3 aside). Each is closed here at its root, with a regression test written first and, where a
derive rule changed, a golden case with an independent hand calculation (`by_hand.py`, no AluKit
import). For the coordinator to fold into [`design.md`](../design.md), which is not edited here;
the last section proposes the wording. Labels: **verified** (run, with how), **read**,
**inferred**.*

**Golden values.** G1–G28, the cart's cut list, BOM, order, costs and machining sheet are
unchanged (**verified**: the full unit suite and the gate). The one value that moved is A7's, in a
unit test, not a golden case: see A7.

## A1: fit by role (bug)

**Root cause.** M3b decision 28 wanted every joined bar to carry a system the connector `fits`.
Draft 2.1 then let a mount's fastener set hold a sleeve set in the through bar's bore, which
needs a hollow through bar; only T-slot and rail bars carry a system, never an RHS or a tube. So
a connector with a mount sleeve could never derive cleanly: through an RHS it failed `fit`, through
a T-slot bar it failed the sleeve's bore, and the sleeve was cut either way. (**Verified**: a bush
end on a 40x40 profile butting into a 200x100 RHS, on the built-in `std` and `forseti` catalogs,
gave the fit error before and derives clean now, its sleeve 90.50.)

**The rule as built** (`src/core/derive/hardware.ts`):

1. Each mount's fastener set is chosen first: the one keyed by the system of a joined bar that the
   connector fits, the through bar's first (decision 28's order, now limited to fitted systems).
2. A **butting bar** is held at its end by its system: `fits` must name it.
3. The **through bar** is held by its system, or **by its bore**: a chosen set lists a sleeve
   `inside: "through"`. The sleeve then needs a through bar that is hollow (RHS or tube), whatever
   its length; a fixed `len_mm` used to skip that check, and a butt with no through bar (a body,
   a splice) cut a sleeve for nothing.
4. A bar held neither way is a `fit` error naming it; for the through bar the message adds that no
   fastener set sets a sleeve in it.
5. The through bar is judged only once a set is chosen. With none (the butting bar has no system
   the connector fits), the butting bar's error is the one to fix, and it stands alone.

| # | Decision | Why |
|---|---|---|
| 1 | `fits` stays the one authority on systems; a fastener set keyed by a system outside `fits` is not a way to fit | `catalog check` already warns on such a set (`fastener-set-unfit`); accepting it in derive would make a catalog slip pass |
| 2 | A `requires` hole in the through bar does not hold a through bar of no system | A T-slot connector that drills the through bar still holds it by its groove or core; counting the hole would let a T-slot bracket pass on an RHS |
| 3 | A sleeve's problem is reported once per set entry, not once per unit | One cause, one error |

Golden case **G30** (`tests/fixtures/golden-gen/G30`): the bush end through an RHS (575.00, sleeve
42.00, one bush); two butting ends; through a T-slot bar (fit error on the through bar); a T-slot
bracket on the RHS (fit error on the RHS); the bush end on a flat bar of no system (one error, on
the flat bar, no set applies); a sleeve of a fixed length, cut as given and refused in a T-slot
bar; and A2's recipe.

## A2: joint recipes (friction)

**Root cause.** A connector item was always a thing bought: derive counted it as hardware, so the
BOM wanted its mass and the order its price, though a joint of studs in tapped cores or a bush and
a sleeve has no body. The workaround was a zero-mass item covered by a cost line.

**The rule as built.** A connector may say `"recipe": true`: a joint recipe, with no body of its
own. Its fastener sets, sleeves, splice parts and `requires` machining are generated and billed as
any connector's; the recipe is not.

| # | Decision | Why |
|---|---|---|
| 4 | The schema refuses a recipe the fields that describe a body: `mass_kg`, `bbox_mm`, `datums`, `body`, `mesh` | A recipe that weighs or occupies something is a connector; the two must not be mixed |
| 5 | `catalog check` refuses an offer, or a kit entry, that sells a recipe (`offer-recipe`) | Its fasteners are what is sold |
| 6 | Derive lists a recipe's uses in `Derived.recipes` (one per butting end and unit, as a connector counts), never in `hardware`; `alukit derive --json` prints `recipes` when there are any | Nothing that counts hardware can count a recipe by mistake |
| 7 | The BOM lists recipes apart, in no group and no total: `recipes` in JSON (item, name, uses, connections), a "Joint recipes" section in Markdown, rows of kind `recipe` in CSV. No mass, no mass warning | The BOM says what the joint is made of without billing it; the lines it brings name the same connections in their sources |
| 8 | The order buys nothing for a recipe: it has no order line, needs no price and no cover | The order lists what is bought |
| 9 | A recipe cannot be a part (placed or unplaced: a `part` error) or a butt's through body (no box) | It has no body |
| 10 | A recipe keeps `fits`, `mounts`, `requires` and `splice` | Its fasteners still enter a system's groove or core |

Tests: G30's recipe case; `generate.test.ts` (BOM, order, parts), `schema.test.ts`,
`catalog.test.ts`.

## A4: a hole in the end a butt bears on (gap)

**Root cause.** Decision 29 put a connector's hole in the through bar where the butting bar's
centre line meets the face it butts into, a side face. Draft 2.1's butt through a bar's end (G17)
left it with no place, so it was refused ("needs a butt through its side").

**The rule as built.** For a butt through an end, a hole `requires` names `on: "through"` goes
**into that end face, along the through bar's axis**, at the point decision 29 already uses: the
butting bar's centre line meets its end plane, and the spacer carries that point along the face's
normal onto the through bar's end face. It is a new op, `end-hole`:

```json
{ "op": "end-hole", "from": "b", "off_mm": [10, 0], "d_mm": 9, "by": "c1" }
```

`off_mm` is the offset from the section's box centre in the section's x and y (absent at the
centre); `d_mm` or `thread`; `depth_mm`, else through.

| # | Decision | Why |
|---|---|---|
| 11 | No depth is through, along the axis, as a side hole with no depth goes through the bar | A screw along a short end block passes its length (the case that raised the gap). A connector that wants a blind hole gives `depth_mm` |
| 12 | The position is the joint point, not the connector's mount hole | v1 does not place a connector, so its mount's frame is not known (§4.5); the joint point is what decision 29 drills for a side |
| 13 | A hole that falls off the end face (a spacer carrying the point past the section's box) is a `connection` error | Nothing could be drilled there |
| 14 | An `end-tap` the connector asks of the through bar's end stays at its centre | Unchanged; a tap into a T-slot's core is centred |
| 15 | The cut list lists it from its end, `Ø9.00 hole in end a along the axis, at x -10.00, y 0.00 from the centre, through`; turning a piece end for end reverses x and keeps y; identity and orientation compare it by end, offset, size and depth; the order counts it as a service, `hole Ø9.00 into an end, along the axis, through` | One list of machining per piece, measured from a named end (§5.3) |

Golden case **G31**: a 120 mm block and a brace bearing on its end 10 off its centre line (the
hole at x 10 from end b, listed as x -10 from end a), with a spacer of 8 (the hole moves to 16)
and a tapped hole M8 20 deep. `generate.test.ts` adds the off-face error and two blocks that group
once turned end for end.

## A5: cost lines in variants (gap)

**Root cause.** Variants scoped the entity maps only (M5 decisions 3–4); cost lines had no
`only_in`, so a lump job priced for one option stayed in every variant.

**The rule as built.** Cost lines take `only_in` and `not_in`, written last in canonical form,
and `applyVariant` scopes them with the entities, in stage 1: the same meaning (`only_in` is in no
document derived without a variant), the same error for a name the document has no variant of,
and the same cascade for what names a left-out cost line (an open item's scope loses it, with an
info). The order and the costs read the variant's lines, so totals and the contingency follow.
`alukit diff` compares the variant's document, so a scoped line shows as added, removed or changed,
with the totals it moves, across two variants and across two revisions (each stores every
variant).

| # | Decision | Why |
|---|---|---|
| 16 | Only cost lines gain a scope; open items, checks and price bands do not | Not asked. An open item already follows its scope's entities; a check can test `cost()` per variant |
| 17 | A swap still does not rewrite a cost line's `covers.items` (M5 decision 5) | A buying record names a specific item |

Tests: `variant.test.ts` (scope, cascade, unknown name), `diff.test.ts` (two variants of the
cart, two revisions in each variant).

## A6: one job on several suppliers' bars (gap)

**The rule as built.** `covers.services_on` takes one `{ "supplier" }` or a list of them, each
supplier once. Each listed supplier's generated machining is covered by the cost line; the cost
line's output keeps the form written, and the order words it "machining on a's and b's bars". A
supplier in the list and in another cost line is covered twice: an error, as before.

| # | Decision | Why |
|---|---|---|
| 18 | A list of selectors, not a list of supplier ids inside one | It is what a user writes first (the acceptance tried it), and each selector can gain fields later |
| 19 | The single form stays valid and is not rewritten | Existing documents and the cart's expected order are unchanged |

Test: `order.test.ts` (a supplier-cut flat and a stock RHS of two suppliers under one job; twice
covered; a supplier named twice).

## A7: a clearance for a sleeve's hole (rule)

**Root cause.** Decision 24 drilled a wall or a layer a sleeve passes to the sleeve's outside
diameter exactly: a line-to-line fit no shop drills (a 16 mm sleeve got Ø16.00 where a shop drills
a clearance).

**The rule as built.** A hole a sleeve passes takes **ISO 273's medium series for a shank of the
sleeve's outside diameter**, the series the bolts of the same joint take (decision 20). The source
is the table already in `src/core/threads.ts`: ISO 273:1979, medium series, read from its identical
national adoption IS 1821:1987, p. 2. A counterbore a sleeve enters takes the same diameter.
`clearance_mm` on the sleeve's stack entry overrides it: the hole is the outside diameter plus
that, an expression; 0 restores the line-to-line hole; a negative one is an error.

| # | Decision | Why |
|---|---|---|
| 20 | ISO 273 medium, not a fixed allowance | A cited table, the one the bolts use; a sleeve passes a wall as a shank does. A shop's own practice (2 mm on 16 gives Ø18, where ISO 273 medium gives 17.5) is `clearance_mm: 2` |
| 21 | An outside diameter between the table's diameters takes the next row up (17.2 → 20, 21.3 → 24); past 150 there is no default, an error asks for `clearance_mm` | *Inferred*: ISO 273 tables only its own diameters; the next row up never clears less than the standard does for the smaller shank |
| 22 | The override is per sleeve, on the face connection's stack entry | That is where a sleeve drills holes. A connector mount's sleeve sits in the bore (cut to `bore`) and generates no wall hole in v1, so a `clearance_mm` there would do nothing; it joins `Sleeve` when mount sleeves drill |

**Values changed by this rule, and only by it:**

| Where | Value | Old | New |
|---|---|---|---|
| `generate.test.ts`, "widens the walls a sleeve passes…": a 50 mm tube 18x2 in G25's RHS, the RHS's head-side wall (4 holes) | hole | Ø18.00 | Ø20.00 |
| the same case, the flat below the RHS, which the sleeve enters 4 mm (4 holes) | counterbore | Ø18.00 × 4.00 | Ø20.00 × 4.00 |

No golden case moves: G25's and the cart's sleeves are cut to the bore and pass no wall, so their
holes are the bolts' Ø11 (**verified**: G25 and the cart's cut list, order and machining sheet
unchanged; the cart's hand script already says "a sleeve that only fills the bore passes no wall,
so no hole widens", which still holds, so it needed no change).

Golden case **G32**: G25's joint with a sleeve of `bore + sec(b3).t_mm` (46.00) that passes the
head-side wall: four holes Ø20, twenty Ø11; with `clearance_mm` 1, Ø19; with 0, Ø18; a 50 mm
sleeve also counterbores the flat below Ø20 × 4. `generate.test.ts` checks the function's rows and
an expression and a negative `clearance_mm`.

## Left open

- A mount sleeve is placed nowhere along the joint's axis, so a length beyond the bore has no
  position and generates no wall hole. A rule for it would also give `Sleeve` its `clearance_mm`.
- A3 (a layer on an angle's, channel's or beam's inner faces) is outside this brief.

## Suggested design wording

**§3.4, connector row.** After "`requires` [machining on the joined bars…]", add: "`recipe: true`
marks a **joint recipe**: a connector with no body (studs in tapped cores, a screw into a core, a
bush and a sleeve). It has no `mass_kg`, `bbox_mm`, `datums`, `body` or `mesh`, and no offer sells
it; its fastener sets, sleeves, splice parts and machining are generated and billed as any
connector's (§5.4)." After the sentence on sleeves, add: "**Fit is judged by role.** A butting
bar is held by its system, which `fits` names. The through bar is held by its system, or by its
bore when the fastener set chosen for a mount (keyed by a fitted system of a joined bar, the
through bar's first) sets a sleeve in it; the sleeve then needs it hollow. A bar held neither way
is a `fit` error."

**§3.4, `requires`.** "A hole on the through bar goes where the butting bar's centre line, moved
by the spacer, meets the face it butts into; for a butt through the through bar's end, into that
end face along its axis, at that point (an end hole, listed with its offset from the section's
centre). With no `depth_mm` a hole goes through."

**§4.5, Bearing on an end.** Add: "A connector's hole in the through bar is an end hole (§3.4)."

**§4.5, Generated holes.** Replace "where a sleeve passes a wall, that wall's hole takes the
sleeve's outside diameter instead" with: "where a sleeve passes a wall, that wall's hole clears the
sleeve instead: ISO 273 medium for a shank of its outside diameter (between the table's diameters,
the next one up), or that diameter plus the sleeve's `clearance_mm`; a layer the sleeve enters part
way is counterbored to the same diameter."

**§4.10.** "…and includes entities **and cost lines** by `only_in: ["steel"]` or `not_in`."

**§4.11, `costs`.** Add `only_in`, `not_in` to the field list. **`covers`**: "`{ "services_on":
{ "supplier": "<id>" } }`, or a list of such, each supplier once: the machining generated on bars
bought from those suppliers, whoever does it."

**§5.3.** "…'tap M8 at end a; Ø7 access hole 20 mm from end a on face +y; Ø9 hole in end b along
the axis, 10 off its centre'."

**§5.4, BOM.** "Joint recipes are listed apart, with their uses and connections, in no group or
total; the order buys only what they bring."
