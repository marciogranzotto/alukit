# AluKit v1 design: review 1

*2026-11-26. An independent review of `docs/design.md` (draft 1, commit `211e718`), read with
`BRAINSTORM.md` and `docs/research/forseti-inventory.md`. No code exists yet. This file changes
nothing else in the repo.*

**How to read it.** Findings are ranked most severe first. Each has a severity and a provenance:

- **Severity:** *blocker* (change the design before any code), *major* (change it before the
  milestone that builds on it), *minor*, *nit*.
- **Provenance:** *verified* (I ran something or checked a source; section 9 says how), *read*
  (from the documents), *inferred* (my reasoning).

Findings that need the reference project's specifics are in
`internal/design-review-1-internal.md`, which is gitignored and not published.

## 1. Verdict

The principles are right, and the stack works as pinned (verified, section 9). The design is
not ready to build from. Three things have to change first:

1. The cut-length arithmetic, which is the tool's core promise, has no rule yet (B1).
2. The document model describes a T-slot frame joined at centre-line nodes. The acceptance
   project is mostly something else (B2).
3. The catalog schema cannot hold Forseti's catalog as Forseti sells it (B3).

After those, the largest risks are the tab owning the document (M1), an unprotected local
server (M2), and a milestone order that finds B2 only at the end (M9).

| Severity | Count |
|---|---|
| Blocker | 3 |
| Major | 10 |
| Minor | 16 |
| Nit | 6 |

## 2. Blockers

### B1. Cut lengths are not well-defined: the trim and extend arithmetic has no rule

**Blocker. Read (design 4.2, 5.1, 5.2); the examples are worked by hand (inferred).**

Section 5.2 says a butt joint trims the butting member "to the face". That is the whole rule.
It does not survive the design's own features:

| Case | What is undefined |
|---|---|
| Eccentric anchor on the through member | A 40x40 leg anchored at a corner, to sit inside an envelope, has its far face 40 mm from the node, not 20. "Half the width" (BRAINSTORM's wording) and "to the face" then differ by 20 mm |
| A 40x80 through member | The trim is 20 or 40 depending on `roll`. The rule has to use the placed section, not the item |
| Through member ending at the node (a corner of two horizontals) | Section 5.1 says "trims and extensions", and 5.2 lists no extension. With centre anchors the through member stops on the other's centre line, and half of the butting end hangs past it |
| A member meeting a face at an angle | A square cut cannot sit on the face. Either the end is cut at the angle (two lengths, long point and short point, 40 mm apart for a 40 mm bar at 45°) or it is square and touches on an edge. Forseti sells 45° and 60° plates and articulated connectors, so this is normal use |
| Two joints naming the same member end | Nothing forbids it. Which trim wins? |
| `tee` on a span | The joint's `at` is a node. Nothing ties that node to the through member's line. "Raise n2 by 100" (the design's example) leaves it behind |
| `miter` | Valid only if both members have the same profile and mirrored anchor and roll. It does not say which length is the cut length, and it takes two members only |
| `lap` at a node | Two bars that rest on each other do not share a centre line. Their design lines meet at a node only if both anchors lie in the contact plane. A bar that touches others on two different faces cannot do that |
| `offset_mm` | One number. A centre or corner anchor needs two (x and y in the section) |

**Failure scenario.** M3 is done "when a scripted bench project derives the right cut lengths".
Two implementers reading 5.2 write two different functions, and both pass on the bench, because
a bench with centre anchors and square 40x40 bars hits none of the cases above. The first
flush-to-envelope frame then orders bars 20 mm wrong. Changing the rule later changes what
saved documents mean.

**Fix.** Define the arithmetic as end planes:

- Every member end resolves to **exactly one cut plane**, from one provider: a joint, an
  explicit end spec on the member, or the default (square, at the node).
- A butt joint's plane is the face of the through member's **placed bounding box** that the
  butting member's axis meets. Say "bounding box" explicitly; rolled steel sections need it.
- A through member that ends at the node extends to cover the butting members (`cover`), or
  stops at the node (`node`). Pick the default and write it down.
- A butt at an angle is an error unless the end asks for an angled cut. Angled ends report the
  long-point length, the centre-line length and the angle.
- Validation: one provider per end; a span node within 0.01 mm of the through member's line; a
  mitre only between compatible sections.
- Add nodes placed **on a member** (`{"on": "m1", "at_mm": 640}`), so span joints follow it.
- Give M3 a table of about a dozen hand-computed cases as its "done when".

### B2. The document model cannot express the acceptance project

**Blocker. Read (design 3.3, 4.2, 5.2); measured against the reference project's record
(counts in the internal note, I1).**

The model is: T-slot profiles as members, joined at shared nodes by five joint types, with
single parts attached. The reference project's frame does not look like that:

- **A minority of its modelled bodies are T-slot members.** The rest are steel sections, linear
  rails and carriages, rod and tube cut to length, and plates.
- **Only `profile` items can be members** ("a member is a catalog profile", 4.2). A linear
  rail, a threaded rod, a tube or a flat bar has a length, a cut and a stock length, and none
  can be a member. As a `part` it has a pose and no length, so it never reaches the cut list.
- **Most of its connections are face to face**, between bars that share no centre-line node:
  a bar resting on another, a bar bolted flat against another, a plate under a beam. Joints
  exist only `at` a node.
- **Its braces are "cut square between hinge pivots"** (BRAINSTORM lists this as a lesson: "the
  tool computes them"). The design has no pivot joint and no explicit end offset. The brace's
  end points would be typed in as free nodes, worked out by hand as before.
- **Several runs are longer than the supplier's maximum** and are spliced. The check flags the
  length; there is no in-line splice joint to fix it with.
- **Its hardware is repetitive**: dozens of identical fastener stations along a bar, rail bolts
  at the hole pitch, pairs of carriages. There is no pattern, array or mirror. Each instance is
  a hand-listed entry, and changing a pitch means regenerating them with a script outside the
  document. That script is the generator the tool was meant to replace.
- **Holes in custom plates carry a diameter only**: no thread, countersink or counterbore.

**Failure scenario.** Acceptance arrives after M6. Modelling the frame shows that most of the
bill of materials cannot come from the document. The criterion "the differences are explained"
then passes with a list of exceptions longer than the model.

**Fix.** Either widen the model or narrow the acceptance, and say which.

- *Members are any linear stock.* Replace "profile" with a `stock: "linear"` capability shared
  by profiles, rails, rod, tube and flat bar. Grooves, hole pitch and end distance are optional
  features of it.
- *Joints between members*, not only at nodes: `{"between": ["m1", "m2"], ...}`, located at the
  closest points or at an `at_mm` on each.
- *Two more joint types*: `pivot` (the connector supplies a pivot offset; the member is cut
  square to it) and `splice` (two collinear pieces, with studs or union plates).
- *Explicit ends*: `ends.from: { offset_mm, cut }`, applied after the joint's plane.
- *One repetition primitive*: a pattern on a part or joint along a member (`count` with
  `start_mm` and `pitch_mm`, an explicit `at_mm` list, or "every rail hole"), and `mirror` and
  `array` commands that create real entities.
- *Hole features*: `thread`, `csk`, `cbore`.
- If v1 should stay smaller: state that acceptance covers the T-slot members and their cut
  list, and that the rest enters as generic parts and cost lines. That is a legitimate v1, but
  it has to be written down now.

### B3. The catalog schema cannot hold Forseti's catalog as it is sold

**Blocker. Verified against the survey's inventory (1,493 rows) and read (design 3.3).**

D4 asks for all of Forseti's catalog, and M2 is done when "every Forseti product present".
The schema has no place for most of what the shop sells:

- **An item is not an offer.** The shop has 495 products and 998 variations, 1,196 orderable
  SKUs. Parent SKUs are templates (`HGHXX-01CA`); the real ones are on the variations.
  - *Packs*: `PAM408-25-10` (10 hammer screws, R$ 31.74) and `PAM408-25-50` (50, R$ 142.82).
    The schema has no pack size, so the order list cannot turn 37 screws into packs.
  - *Kits*: rail kits bundle a rail with two blocks. A bracket kit such as `CT75-06-K40-50`
    contains its own screws, nuts and washers, while a connector's `hardware` set adds them
    again.
  - *Lengths as variations*: rails come in 500 to 3000 mm, each its own SKU and price.
- **Two prices.** 369 of the 1,493 rows have a price below their regular price. The schema has
  one `price`. A project priced during a sale cannot be told apart from one priced without.
- **`c7` is not a finish.** The design's example sets `"finish": "c7"`. `PF40-01-c7` is
  anodised and `PF40-01-pp-c7` is black: `-pp` is the finish, and the survey already warns not
  to parse the `-c7` tail. Finishes also exist only on profiles in the schema, while brackets
  and screws have variants too (left and right, zinc and stainless).
- **About 200 of the 495 products fit no kind**: electronics (34), tools (11), kits (12),
  finished goods (15), cable chain (13), and most of the 130 linear-motion and drivetrain
  products (ball screws, bearings, pulleys, belts, couplings). `placeholder` is the only kind
  that fits, and it blocks the order.
- **A connector's hardware set depends on the groove** (inferred). The shop sells one square
  plate for base 40 and base 45, whose grooves are Canal 8 and Canal 10, so its T-nuts differ
  by profile. `hardware [{item, qty}]` is one fixed list.
- **The fields every item shares are never stated**: SKU, vendor name, URL, mass, bounding box,
  price, stock flag. Section 3.3 gives a price and a mass to profiles and connectors only.

**Failure scenario.** The importer and the agents' family modelling run in M2 on this schema.
M3 then builds the order list, needs packs and kits, and the schema changes. The import and the
reviewed family files are redone.

**Fix.**

- Split **item** (the physical part: geometry, mass, technical data) from **offer** (SKU, pack
  quantity or kit contents, option values, regular and sale price with read dates, stock flag,
  URL). The BOM counts items. The order list chooses offers: an explicit choice first, then the
  cheapest cover. Kits are used only when chosen.
- Give every item `options` (finish, hand, length), named by meaning (`anodised`, `black`) and
  mapped to SKUs. A member picks an option, and a check reports "not sold in this finish".
- Add a `generic` kind (name, mass, bounding box, offers) that can be ordered.
- Key the hardware set by system.
- Write the common item envelope once, above the kind table.

## 3. Majors

### M1. The tab owning the document loses edits and makes the agent path depend on a browser tab

**Major. Read (design 7); the scenarios are inferred.**

"When a tab is open, the tab owns the document. CLI commands route through the server to the
tab. The tab writes the file." A tab cannot write a file on its own (short of the File System
Access API, which the design does not mention), so it writes through the server. The server is
therefore already in every write, and the tab's ownership adds a round trip and these failures:

1. **Two tabs.** The design does not mention them. If a command is broadcast, both tabs apply
   it and both write. The second write carries that tab's document, without what the other tab
   changed.
2. **An invalid direct edit.** An agent edits `alukit.json` and leaves it invalid. The tab
   cannot load it, keeps its old state, and writes that state on the next command. The agent's
   edit is gone, with no banner, since the banner is for unsaved tab edits.
3. **A stale read.** The tab has unsaved edits. The agent reads the file, or runs `query`,
   and sees the old state. Its next command is applied to a document it has not seen.
4. **A tab that is not listening.** The command goes out over SSE. If the tab is closing,
   reloading or suspended by the browser, the CLI hangs or the command is dropped. A retry
   after a lost acknowledgement applies `addMember` twice.
5. **Undo.** The undo stack lives in one tab and dies on reload. With edits interleaved from
   the UI and an agent, Ctrl+Z pops the agent's last command, and the agent is not told.

**Fix: the server owns the document.**

- One in-memory document per project in the server process, one command queue, an atomic write
  (temporary file, then rename), and a revision counter returned with every answer.
- Tabs and the CLI are both clients: `POST /api/commands { baseRev, commands, source, id }`.
  The `id` makes a retry harmless. The server broadcasts each new revision over SSE.
- A tab holds no unsaved state. A drag is a local preview, committed as one command on release.
- The undo stack is the server's, one line for all sources, each entry tagged with its source.
  An agent's batch is one step, and an agent can ask what was undone (`alukit log`).
- A direct file edit is read by the watcher and enters as one "external edit" step if it is
  valid. If it is not, the project goes read-only and every client shows why.
- With no server running, the CLI runs the same code in-process under the lock. The lock holds
  a pid and a start time, so a crashed holder is detected.
- The CLI finds the server through `<project>/.alukit/server.json` (port, pid, token).

### M2. The local server has no protection against other web pages

**Major. Inferred from design 7; the precedent is verified.**

The server binds to `127.0.0.1`, takes edit commands on `/api/*` and writes files. Binding to
localhost stops other machines. It does not stop a page in the same browser, which can send
requests to `http://127.0.0.1:<port>`, or reach it by DNS rebinding. Vite had this exact class
of bug in its dev server
([CVE-2025-24010](https://github.com/vitejs/vite/security/advisories/GHSA-vg6x-rcgg-rjx6)),
fixed with an allowed-hosts list, stricter CORS and a token.

**Failure scenario.** `alukit serve` is running. Another tab opens a hostile page. It posts
`removeEntity` commands, or an export whose output path points outside the project.

**Fix.** A random token per server start, required on every `/api` request and on the SSE
stream. Check `Host` and `Origin`. Accept JSON bodies only, and send no CORS headers. Resolve
every path in a request inside the project folder and refuse the rest.

### M3. The local-frame rule is discontinuous at vertical, and anchors are ambiguous

**Major. Verified by computing the rule as written (section 9).**

"Local y points to world +Z for non-vertical members, and local x to world +X for vertical
ones." There is no tolerance for "vertical", and the two branches do not meet:

| Member | Local x | Local y |
|---|---|---|
| Exactly vertical | +X | +Y |
| Top node at x = `0.1 + 0.2 - 0.3` (5.6e-17 mm) | +Y | -X |
| Leaning 0.001 mm toward +Y | -X | -Y |
| Leaning 0.001 mm toward -Y | +X | +Y |

A 90° or 180° turn of the section follows from a rounding error in an expression. With a face
or corner anchor the bar also jumps sideways by its width.

Other gaps in the same rule:

- Reversing `from` and `to` flips local x for a horizontal bar, so a side anchor swaps sides.
- "Top" on a vertical member means its +Y face, or its -Y face if it was drawn downward.
  Section-local names (`+x`, `-y`, `+x+y`) would not mislead.
- The sign of `roll` is not given.
- A roll of 90° through `Math.cos` gives 6.1e-17, not 0, so a rolled 40x80 has corners at
  20.000000000000004.

**Fix.** Treat a member as vertical when its horizontal run is under 1e-6 of its length. Make
roll exact at multiples of 90°. Name anchors in section terms, and state that anchors and roll
follow `from → to`. Allow an optional `up` vector on a member for the cases the rule handles
badly. Zero-length members are an error.

### M4. The determinism claim is not met by the measures listed

**Major. Verified in part (section 9); the rest inferred.**

Principle 5 promises byte-identical outputs on any machine. Section 5.1 offers Neumaier
summation, id order and rounding. Those miss the real sources of difference:

- **`sin`, `cos`, `atan2`** are in the expression language. Their precision is
  implementation-dependent
  ([MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Math)).
  The CLI runs in Node, and a tab may run in another engine.
- **Rounding does not hide a last-bit difference at a tie.** `(250.125).toFixed(2)` is
  `250.13`, and its neighbour one bit down gives `250.12`.
- **"Id order" is undefined.** Code-point order gives `m1, m10, m2`. `localeCompare` and a
  numeric collator give other orders, and both depend on the machine's locale data.
- **JSON key order.** Integer-like keys are moved to the front by the engine, whatever order
  they were inserted in.
- **"An exact search when the pieces are few"** (5.3). If it stops on a time limit, the result
  depends on the machine.
- **`floor`, `ceil` and `round` in expressions** turn a last-bit difference into a different
  count: `floor(L / pitch)` at 14.999999999 or 15.
- **Snapshots** are PNGs from a GPU. They cannot be byte-identical.

Neumaier summation is not the answer to any of these. With a fixed order, plain summation is
already repeatable. The lesson it cites came from
[Python 3.12 changing `sum()`](https://docs.python.org/3/whatsnew/3.12.html), which moves a
float sum only in its last digits. A result that moved by 0.2 % had a threshold or a step
downstream (inferred). The cure is to find those, not to change the adder.

**Fix.**

- Files are written by one engine: the server or CLI in Node. The tab's derive is for display.
- State the claim as "same AluKit version, same Node major".
- Define id order: split the prefix and the number, compare by code point and by value.
- Write one canonical serialiser (key order, number format, no `-0`).
- Compare with a tolerance, and snap to an integer within 1e-9 before `floor` and `ceil`.
- Bound the exact search by node count.
- Round money per line to whole cents, then add integers.
- Leave snapshots out of the claim.

### M5. A frozen revision does not guarantee the replay, and diffs between git refs use today's catalog

**Major. Read (design 4.5, 7); inferred.**

- **A revision freezes the catalog items, not the results.** It replays through the current
  `derive`. A later fix to the joint arithmetic changes an old revision's cut list. "Old
  revisions replay as published" then fails for the reason the feature exists.
- **`alukit diff git:<ref>:<path>`** compares two versions of a working document. Neither
  carries its catalog, so both are derived with today's. A price that changed between the two
  commits does not appear as a change.
- **The working copy pins nothing.** The project lives in another repository (D9) and its
  catalogs live in this one. A second machine with a different AluKit checkout derives other
  numbers from the same commit.
- **The git stamp says little.** The revision file is new and untracked when it is written, so
  the recorded commit is the parent, and the dirty flag is nearly always set.
- The design does not say whether a revision includes the section outlines.

**Fix.**

- Store the derived outputs in the revision. Opening it shows them. `alukit revision verify`
  re-derives and reports any drift.
- Write a lock file beside the document on every save: the resolved catalog items and their
  hashes. Any git commit then replays, a diff between refs is sound, and a catalog change shows
  up as a lock change. A named revision becomes a copy of the document and its lock.
- Stamp exports with a content hash of document, lock and tool version. Keep the git commit as
  a second field.
- Record the schema version, and say how an old revision is read after the schema moves.

### M6. Only 8 profiles have an extractable outline, and the design assumes nearly all do

**Major. Verified on the cached PDF (section 9).**

Section 11 says "the 3 profiles without vector outlines need raster tracing". The survey says
8 of about 20 catalogue profiles have a vector outline. I checked every profile page:

| Catalogue pages | Vector outline |
|---|---|
| 11, 14, 15, 16 (two), 18, 19, 21 | yes: 8 outlines |
| 10, 12, 13, 17, 20 | none |
| The 45x45 on p. 18 and the 45x45 econômico on p. 19 | none; each page has one outline, the 45x90 |

At least 10 catalogue profiles have none. The shop also sells stems that are not in the
catalogue at all (the survey lists PF20-15, PF20-13, PF20-21, PF40-11, PF30-11 and PF50-01).
So about 17 of the 25 profile stems cannot be "complete" as M2 asks. Profiles the reference
project relies on are among them (internal note, I5).

**Failure scenario.** M2 stalls on tracing rasters, or on CAD files that someone must download
by hand. Or it ships hand-drawn outlines whose computed area is 40 % off, which is the error
the survey found in the earlier hand-built polygons.

**Fix.**

- Give each section a `fidelity`: `exact` (vector), `traced`, `parametric` or `box`.
- Add **parametric section generators**: a T-slot from its groove dimensions, a rectangular
  tube with corner radii, flat bar, rolled angle, round tube and bar. A local steel catalog
  then needs no outline files, which B2 needs anyway.
- State the authority rule. Published values win for mass and section properties. Computed
  values are used only for `exact` outlines with nothing published, and `catalog check` flags
  the mismatches.
- Restate M2: "every profile has a section with a declared fidelity; the 8 exact ones pass
  `catalog check` within 1 %, or are listed as known mismatches".

### M7. The cost model cannot reproduce a real bill

**Major. Read (design 2, 3.3, 5.4; survey); measured on the reference project's bill (internal
note, I3).**

- **Cut-to-length pricing has a step.** The survey reads "10 mm of cut consumes 1 stock unit".
  A 1234 mm piece at R$ 126.50/m is R$ 156.10 priced by the millimetre and R$ 156.86 in 10 mm
  units. `sale` has a minimum, a maximum and a tolerance, and no step or rounding rule. A cut
  length of 1234.57 mm is also not something a supplier accepts.
- **Whole bars are priced per bar.** Steel is bought as 6 m bars. `price_per_m_cents` times the
  used length understates it.
- **Stock lengths with different prices.** A rail is sold in several lengths at several prices.
  Choosing among them minimises cost, not waste. First-fit decreasing on one stock length does
  not do that.
- **No ranges in totals.** A valued field can hold low and high. Section 5 never says the
  totals carry them. The reference bill is low, likely and high on every line.
- **No lines that are not parts.** Machining, fabrication, assembly, freight and a contingency
  are a large share of the reference bill. The document has nowhere to put them.
- **One currency per catalog, no project currency.** BRAINSTORM plans item and Bosch catalogs
  beside Forseti's. Totals across currencies need dated exchange rates, or must stay separate.
- **Provenance stops at the catalog.** The reference bill states how much of its total rests on
  prices actually read. Derive could give that share for free.

**Fix.** `sale` gains `step_mm` and a rounding rule, and `bar` mode a price per stock length.
The project gains a `costs` list (label, low, likely and high, provenance, optional `blocks`).
Totals carry low, likely and high, per currency, and the share by provenance tag. An exchange
rate is a valued field in the project.

### M8. The order list blocks on too little

**Major. Read (design 4.4, 5.4, 5.5).**

The order list is BLOCKED by open items marked `blocks: "order"` and by placeholders. Failing
checks do not block it. A bar longer than the supplier's maximum, or a connector that does not
fit its groove, fails `alukit check` and still prints in an unblocked order.

**Failure scenario.** An agent runs `alukit order` without `alukit check` and hands over a list
with a 3.4 m bar from a supplier that cuts 3 m at most.

**Fix.** Any check of severity `error` blocks the order. So do a missing price, a price tagged
`est`, and an item the shop marks out of stock; make each a rule that can be switched off by
name. Scope a block to the entities it names, so one open question about a caster does not
hold the profile order, and report BLOCKED per supplier.

### M9. The milestones find the biggest risk last, and most "done when" lines cannot be tested

**Major. Read (design 12).**

- **Acceptance comes after M6.** It is the first time the document model meets the reference
  project. B2 is found then.
- **M2 runs before M3.** The whole catalog is imported and modelled by agents, with a second
  agent reviewing, before any joint has consumed a connector's `mounts`, `hardware` or
  `requires`. The schema will move in M3.
- **M3 is the whole core in one step**: schema, expressions, commands, undo, derive, joints,
  generation, cut list, BOM, order list, checks and the CLI.
- **The criteria:**

  | M | "Done when" | Problem |
  |---|---|---|
  | M2 | "profiles complete" | undefined, and unreachable (M6) |
  | M3 | "the right cut lengths" | right by what oracle? (B1) |
  | M4 | "a frame drawn by hand matches the same frame built by CLI" | matches how, and who draws it in a test? |
  | M6 | "all D11 items are in" | not a test |
  | Acceptance | "the differences are explained" | cannot fail |

- **Missing work**: a local steel catalog; reference data for the rails' clone ratings; a path
  from the existing model into AluKit; a fixture in this repo that exercises what the reference
  project needs (D2 keeps projects out of the repo, so nothing here would test rails, steel or
  braces).
- **The record is not one oracle.** Its files disagree on revision, price basis and lengths
  (internal note, I2). Acceptance must name the files and the tolerances.

**Fix.**

1. M0: scaffold, plus the Node decision (m4).
2. M1: catalog schema with offers, section properties, parametric sections.
3. **M1.5, a paper model.** Before the core, write the reference frame's document by hand
   against the draft schema, or convert it from its existing model (internal note, I4). List
   what does not fit. Fix the schema. One or two days, and it converts B2 from a risk into a
   list.
4. M2a: the profiles and the parts the reference project uses.
5. M3a: place, end planes, cut list, against the golden table. M3b: generation, BOM, order
   list, checks, CLI. An early acceptance slice follows: the reference frame's T-slot cut list
   against its record.
6. M4: the viewer. M2b, the rest of the catalog, runs beside it.
7. M5 and M6, then acceptance with numbers: lengths within 0.5 mm, mass within 1 %, the
   supplier's lines to the cent on a frozen price snapshot, and a written exceptions list.

A synthetic example in `tests/fixtures/` (a small cart with a rail, a steel tube and a brace)
keeps D2 and still tests those features.

### M10. An item's facts come from three files, and no rule merges them

**Major. Read (design 2, 3.1, 11).**

`catalog.json` is regenerated by the importer. `families/*.json` is written by agents.
`overrides.json` holds corrections. The valued-field example also shows a `corrected` history
written in place. So:

- An in-place correction in `catalog.json` is lost at the next import.
- No order of precedence is given between the three files.
- An override does not record what it replaced. If Forseti fixes its catalogue, the override
  keeps overriding the corrected value and nobody is told.
- It is not said which mass the BOM uses: the catalogue's, the shop's or the computed one. For
  the 40x40 básico they are 1.493, 1.482 and 1.4945 kg/m.

**Failure scenario.** A re-import after a price update drops a hand correction to a profile's
inertia, and the BOM's mass moves by 0.7 % because the loader now sees the shop's value first.

**Fix.** One merge order: importer facts, then family modelling, then overrides, as a merge by
item id. Corrections live only in `overrides.json`, each with the value it expects to replace.
`catalog check` reports an override whose expected value no longer matches. The loaded item
shows the `corrected` history; nobody writes it by hand. State the authority rule from M6.

## 4. Minors

**m1. Undo by inverse commands is the hard way.** *Read (design 6).* Each command "records its
own inverse". The inverses of `removeEntity`, `autoJoints` and `splitMember` have to restore
ids, attached parts and joints exactly. The document is small, so keep the previous document
(immutable updates share structure) or a generic patch. Undo then cannot be wrong. Related: ids
must never be reused. "Highest plus one" reuses the last id after a delete, and a diff against
an old revision then shows a changed member where one was removed and another added. Keep a
counter in the document.

**m2. A CLI and a skill are enough for v1, on four conditions.** *Inferred.* No MCP server is
needed for an agent with a shell.
1. Commands from a file or stdin (`alukit do <dir> -f batch.json`). Inline JSON in a shell
   string is fragile, and agent harnesses often stop to ask permission for such strings.
2. One process per batch, since each start loads and validates the catalog.
3. Structured errors that name the entity, and the ids a command created in its answer.
4. Bounded output: `derive --json` on a large project will not fit an agent's context, so
   `query` needs field selection and summaries.

Generate the command reference in the skill from the command schemas, so it cannot go stale.

**m3. The published JSON Schema needs `io: "input"`, and it drops refinements.** *Verified
(Zod 4.6.7).* By default `z.toJSONSchema` describes the output type, so a field with a default
(`roll`, `anchor`) comes out as `required`. An agent writing a file would be told to supply
them. `.refine` rules vanish without notice, and transforms throw. Publish with `io: "input"`,
keep cross-reference rules in `alukit check`, and say so in the skill. `derive --json` is a
contract for report builders too: give it its own `schema` field and JSON Schema.

**m4. Node: the flag is not the only limit.** *Verified on Node 22.16.0 and in
[Node's docs](https://nodejs.org/api/typescript.html).*
- On 22.16 a `.ts` file needs `--experimental-strip-types` and prints a warning on every run.
  Both end at 22.18.0. The feature is marked stable from 24.12.0.
- Vite 8.4.0 needs `^20.19.0 || >=22.12.0`, so Vite does not force a Node upgrade. The CLI
  does. Set `engines` to `>=22.18`, or move to 24 LTS.
- Node refuses `.ts` files under `node_modules`. The CLI runs from a checkout or a link, and a
  future npm package needs a build.
- `.tsx` is unsupported, so nothing the CLI imports may reach the UI.
- Imports need the `.ts` extension and `import type`. Set `allowImportingTsExtensions` and
  `verbatimModuleSyntax` in M0. `tsconfig` paths do not work at run time.

**m5. GLB export does not run headless as designed.** *Verified (three 0.187.0, Node 22.16.0).*
three's `GLTFExporter` fails in Node with "FileReader is not defined", for binary and for JSON
output. `ExtrudeGeometry` works in Node. Two more conflicts:
- Rendering uses one `InstancedMesh` per profile, and the export wants one named node per
  member with `extras`. The export scene is a different scene.
- `core/` has no three.js, so the tessellation has no home that both the viewer and the CLI
  import.

Decide where meshes are built. Then polyfill `FileReader` over `Blob.arrayBuffer`, or write the
GLB directly; an untextured GLB is a small format. For `snapshot`, use headless Chromium always
rather than "the open tab if there is one": one code path, no dependence on the user's camera,
selection or a hidden tab.

**m6. The expression language is underspecified.** *Read (design 4.2).*
- Do `sin` and `cos` take degrees (the file convention) or radians?
- Checks use `<=` and `.z`. Neither is in the list of what the language has.
- There is no `abs`, `tan`, `hypot`, `pi` or conditional.
- A check written as value, operator and limit can report its margin. A boolean cannot, and the
  reference project's "asserts with floors" are margins.
- A param can be a measured fact (a wall's clear width). Let params be valued fields.

**m7. The fields kept for simulation (D5) are named, not specified.** *Read (design 3.3,
BRAINSTORM).*
- "Ratings per direction" needs a connector frame to give the directions meaning.
- `stiffness` is one word. A solver needs it per degree of freedom, and it depends on the pair
  of profiles joined.
- A block's dynamic rating needs its basis, 50 km or 100 km of travel. Makers differ (from
  memory; check each maker's catalogue).
- Material has no thermal expansion, which matters where aluminium is bolted to steel.
- Two fields in BRAINSTORM's list are missing from 3.3: a damper's stroke and a gearbox's
  allowable radial load.
- Units disagree with section 2, which sets moments in N·mm: `torque_Nm`, `MR/MP/MY_Nm`. Also
  `density_kg_m3` beside `mass_kg_per_m`.

Since Forseti publishes almost none of these, the cost today is small. Type them before agents
start filling them in.

**m8. Clone ratings are copied into the rebadger's overrides.** *Read (design 3.3, 11).* The
original maker's values would then sit in every catalog that sells the clone, against
principle 2. Hold them once, in a reference catalog for the maker, and point `clone_of` at the
item. A correction then lands in one place.

**m9. Variants by omission make `base` a frame nobody builds.** *Read (design 4.3); internal
note, I6.* When two options differ by whole groups of members, the document holds both and each
variant omits one. Add `only_in` on entities, or name a default variant. Say what happens to a
joint whose member is omitted, and to a node position when a swap changes a section's size.

**m10. `derive` should never throw on document content.** *Read (design 5.1).* "Unknown
references are errors." A half-edited document must still draw. Return diagnostics tied to
entities and skip what cannot be derived. Also state what `removeEntity` does to things that
refer to the entity: refuse, or cascade.

**m11. Rendering and the draw tool.** *Inferred.*
- An 856-segment outline per member is several thousand triangles. Simplify outlines for
  display and keep the exact one for properties.
- `EdgesGeometry` is not instanced with an `InstancedMesh`; 1,000 members are 1,000 line
  objects, or one merged buffer.
- "Shift frees the line" needs a rule for depth: a work plane.
- M4 holds the viewer, the panels around it, a catalog browser for 1,196 SKUs and the draw
  tool. It is as large as M3.

**m12. `panel` is a catalog kind with no document entity.** *Read.* A panel has a size derived
from its opening. Nothing in section 4 holds one. Define it, or drop it from v1.

**m13. The file format's form is not specified.** *Read.* Determinism and agents editing by
hand both need a canonical form: one entity per line, fixed key order, `alukit fmt`. Also: how
a catalog named by path gets its id, and what happens when two paths claim one id.

**m14. Cut-list details.** *Read (design 5.3).* Identical pieces should group into one line;
that needs a canonical form for machining (a piece flipped end for end is the same piece). Bar
mode needs an end trim as well as a kerf.

**m15. Fastener length is still by hand.** *Inferred; an example is in the internal note, I3.*
The tool owns cut lengths. Nothing owns a bolt's length against the stack it clamps. A
`fastening` entity (the layers it passes through, the engagement it needs) would catch a bolt
that bottoms before it clamps. A candidate for v1.1.

**m16. Over-built for v1.** *Inferred.* Each of these has a simpler form above, or no user yet:
- Neumaier summation (M4);
- inverse commands (m1);
- the exact cutting-stock search (first-fit decreasing is enough until a project needs more);
- the `generic` metric catalog and "retarget by item mapping" (a variant's `swap` does it);
- fixed schemas for drive, damper and anchor, which nothing reads (a typed, provenance-carrying
  `ratings` bag would keep D5 without the upkeep);
- tab-rendered snapshots (m5);
- four ways to keep a tab and a file in step: SSE, a watcher, a lock and routing through the
  tab (M1 leaves two).

## 5. Nits

- **n1.** *Verified.* "pnpm 10.12" is the installed version, not the registry's. `latest` is
  12.23.0, and the 10 line is at 10.34.9.
- **n2.** *Verified.* vite 8.4.0 was published on 2026-11-26, the day it was pinned. Preact 11
  is eight weeks old (11.0.0 on 2026-09-30). Pin exact versions and let M0's smoke test decide.
- **n3.** *Verified.* The `typescript` 7 package exports only a version at `.`; its API sits
  under `./unstable/*`. Nothing in the stack imports it today. A tool that needs the old
  compiler API will not run.
- **n4.** *Verified ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events)).*
  SSE over HTTP/1.1 is limited to 6 connections per browser and host. One server per project
  keeps it harmless.
- **n5.** *Read.* `tee` is a `butt` whose node is on a span, and `cube` is a `butt` with a
  spacer. Three types would do.
- **n6.** *Read.* `price_per_m_cents` names a unit some currencies lack. `_minor` is neutral.

## 6. What holds up

- One model, with every output derived from it, and a pure `derive(doc, catalogs, variant)`.
- A small safe expression language instead of JavaScript.
- Facts-only vendor data with provenance, and `catalog check` against computed values.
- Z-up millimetres, converted only at the scene root and at export.
- SSE and fetch rather than websockets.
- A CLI and a skill before any MCP server (m2).
- The stack. All ten pinned packages exist, are `latest`, and work together (section 9).

## 7. Simpler alternatives that still serve D1–D13

| Instead of | Use | Saves |
|---|---|---|
| The tab owning the document | The server owning it (M1) | the conflict banner, routing through the tab, per-tab undo |
| Five joint types with implied trims | End planes, with joints as one provider (B1) | a special case per type; gives pivots, splices and explicit ends for free |
| Profiles as the only members, plus special kinds | One linear-stock capability and parametric sections (B2, M6) | separate handling of rails, rod and tube; outline files for steel |
| Finishes on profiles | Items and offers (B3) | separate fixes for packs, kits, sale prices and variations |
| Frozen revisions as a mechanism of their own | A lock file on every save; a revision is a named copy (M5) | a second replay path; makes diffs between git refs sound |
| Inverse commands | The previous document, or a patch (m1) | an inverse per command |
| A node server and a Vite middleware | Vite in middleware mode as the only server, since D1 is local-only (Vite becomes a runtime dependency) | a second server mode and a build step for users |
| Modelling the reference project by hand | A converter from its existing model (M9) | days of entry; gives a length oracle per member |

## 8. The decisions D1–D13: flags

The decisions are taken as given. Four cause a real problem:

- **D4, all of Forseti in v1.** The schema must then cover about 200 products that are not
  frame parts (B3). Importing all of it before the core exists risks doing it twice (M9).
- **D5, simulation data from the start.** Fine as a rule. The fields are only named so far
  (m7).
- **D2 with D13, no projects in a public repo.** The repo then has no test of what the
  acceptance project needs. Allow synthetic fixtures (M9).

## 9. What I verified, and how

Everything was run on 2026-11-26, on Node 22.16.0 and npm 11.19.1, in a scratch project outside
the repo.

| Assumption | Result | How |
|---|---|---|
| The ten pinned versions exist | All exist and are the registry's `latest`: [three](https://www.npmjs.com/package/three/v/0.187.0) 0.187.0, [vite](https://www.npmjs.com/package/vite/v/8.4.0) 8.4.0, [preact](https://www.npmjs.com/package/preact/v/11.2.0) 11.2.0, [@preact/signals](https://www.npmjs.com/package/@preact/signals/v/2.11.4) 2.11.4, [zod](https://www.npmjs.com/package/zod/v/4.6.7) 4.6.7, [camera-controls](https://www.npmjs.com/package/camera-controls/v/3.1.2) 3.1.2, [vitest](https://www.npmjs.com/package/vitest/v/5.1.2) 5.1.2, [@playwright/test](https://www.npmjs.com/package/@playwright/test/v/1.65.1) 1.65.1, [@biomejs/biome](https://www.npmjs.com/package/@biomejs/biome/v/2.6.9) 2.6.9, [typescript](https://www.npmjs.com/package/typescript/v/7.0.2) 7.0.2 | `npm view <pkg> version dist-tags` |
| Vite 8's Node requirement | `^20.19.0 \|\| >=22.12.0`; Node 22.16 satisfies it. Vitest 5.1.2 needs `^22.12.0 \|\| ^24.0.0 \|\| >=26.0.0`; camera-controls needs `>=22` | `npm view <pkg> engines` |
| TypeScript 7 beside Vite | `tsc --noEmit` passes with `erasableSyntaxOnly`, `verbatimModuleSyntax`, `allowImportingTsExtensions` and Preact JSX, in 0.24 s on a sample. It rejects an enum and a parameter property (TS1294). `vite build` compiles the same sources; Vite 8 depends on Rolldown, not on `typescript` | installed both, ran `tsc` and `vite build` |
| Preact JSX without a plugin | Vite reads `jsxImportSource: "preact"` from `tsconfig.json`; no React import in the bundle. `@preact/preset-vite` 2.10.6 accepts Vite 8 and needs Babel | the same build; `npm view` |
| Preact 11 with signals | The peer range is `>= 10.25.0 \|\| >=11.0.0-0`. A render test passes: a signal change updates the text with one component render | `npm view`; Vitest with happy-dom |
| Vitest 5 with Vite 8 | The peer range includes `^8.0.0`; a test importing a `.ts` path runs | `npm view`; ran it |
| Node type stripping | On 22.16.0: fails without the flag; works with it and prints `ExperimentalWarning`; rejects an enum; refuses `.ts` under `node_modules`; `.tsx` unsupported. Default-on and warning-free from 22.18.0; stable from 24.12.0 | ran each case; [Node docs](https://nodejs.org/api/typescript.html), [22.18.0 notes](https://nodejs.org/en/blog/release/v22.18.0) |
| Zod 4's JSON Schema export | `z.toJSONSchema` works (draft 2020-12). A union becomes `anyOf`. Refinements are dropped. Defaults are `required` unless `io: "input"`. Transforms throw | ran it on a model of the project schema; [Zod docs](https://zod.dev/json-schema) |
| three 0.187.0 | `WebGLRenderer`, `InstancedMesh`, `EdgesGeometry` and `ExtrudeGeometry` are exported. `ExtrudeGeometry` runs in Node. `GLTFExporter` does not ("FileReader is not defined") | ran it in Node; read the exporter's source |
| Release dates | vite 8.4.0 2026-11-26; vitest 5.1.2 2026-11-25; preact 11.0.0 2026-09-30; typescript 7.0.2 2026-07-08; three 0.187.0 2026-10-30 | `npm view <pkg> time` |
| pnpm | 10.12.3 is installed; the registry's `latest` is 12.23.0 | `pnpm --version`; `npm view pnpm dist-tags` |
| Section outlines in the PDF | Pages 11, 14, 15, 16, 18, 19 and 21 hold large vector paths (8 outlines); pages 10, 12, 13, 17 and 20 hold none | PyMuPDF `get_drawings()` on the cached catalogue, largest path per page |
| Shop inventory | `-c7` appears on anodised and black SKUs alike; 369 of 1,493 rows have a price under the regular price; packs, kits and length variations as quoted in B3 | read `.cache/forseti/out/inventory.csv` |
| The local-frame rule | The table in M3 | computed the rule as written, in Node |
| Number handling | `Math.cos(Math.PI/2)` is 6.1e-17; `(250.125).toFixed(2)` against its one-bit neighbour; three sort orders for `m1, m10, m2, M3`; integer-like JSON keys reordered | ran each in Node |
| Outside sources | Math precision ([MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Math)); Python 3.12's `sum()` ([docs](https://docs.python.org/3/whatsnew/3.12.html)); the SSE limit ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events)); Vite's advisory ([GHSA-vg6x-rcgg-rjx6](https://github.com/vitejs/vite/security/advisories/GHSA-vg6x-rcgg-rjx6)) | fetched and read each page |

**Not verified.** How browsers treat a hidden tab holding an SSE stream. Headless Chromium
rendering this scene through Playwright. Biome 2.6's configuration. The 60 fps target. The
camera-controls 3 API. Whether two JavaScript engines actually differ on a given `sin` or `cos`
(the documentation says they may).
