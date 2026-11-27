# M3b decisions: commands, canonical form and the lock file

*2026-11-26. Calls made while building M3b's edit path (the §6 commands, the canonical form, the
lock file, and `alukit new`, `do`, `add`, `query`, `check`, `fmt`, `lock update`) where
[`design.md`](../design.md) is silent or ambiguous. For the coordinator to fold into the design
or veto. Generation, the bill of materials, offers, the order list and costs are M3b's other
parts and are not here.*

## Canonical form (§2)

| # | Decision | Why |
|---|---|---|
| 1 | Key order is read from the JSON Schema that §7.4 generates from the Zod schemas; keys a schema does not declare follow the declared ones, in id order. For a union, the branch the value fits; for a value that fits none, the object branch that declares the most of its keys | One source of truth: a field added to a schema gets its place with no second list to keep |
| 2 | One entity per line for the top-level maps and record lists (`nodes` … `views`, and `variants.list`); the document one key per line; everything else inline | A diff shows one line per entity changed |
| 3 | Numbers on `_mm` and `_deg` fields and point coordinates snap to 0.01, `_kg` to 0.001, only when they lie within `tol.snap` of that grid: `1199.9999999999998` is written `1200`, `12.345` stays | Canonical form removes float noise; it never rounds what a person wrote |
| 4 | Biome does not format `alukit.json` and `alukit.lock.json`; `alukit fmt` owns them | Two formatters would fight over the layout |

## The lock file (§4.13)

| # | Decision | Why |
|---|---|---|
| 5 | `alukit.lock.json` (`alukit.lock/1`) is a frozen slice of the linked catalogs: each pinned item, offer, section, material, groove type and system as `{hash, <kind>: value}`, keyed by full id, and each catalog it came from as `{hash, name, vendor?, currency?}`. A hash is sha256 of sorted-key compact JSON; a catalog's is taken over its loaded, linked content | Comparing hashes says cheaply whether the lock is behind, and the slice is enough to derive with no catalog present |
| 6 | Derive reads the lock rebuilt as a catalog set, so derive's item source and every function that reads it are unchanged | Nothing downstream of the item source needs to know about the lock, including what M3b's other parts add |
| 7 | Pinning follows an item's references (section, groove types, system, material, its offers) and not `clone_of`, which the merge already resolved | The slice holds what derive reads, not the catalog's history |
| 8 | Which items a document uses is found by the item-reference pattern in the document's JSON Schema, plus variant swaps and project items' materials | Fields added later that name items are found with no list to update |
| 9 | A missing lock is created on the first command that derives (`derive`, `cutlist`, `bom`, `check`, `query` with derived fields, `do`), and a missing entry is added, each with a `notice:` line on stderr; `--frozen` makes either an error and writes nothing. A new project's lock pins nothing: it holds only what the document uses | §4.13; a lock that pinned whole catalogs would change on every catalog edit |
| 10 | `lock update` keeps an entry the live catalogs no longer have, and reports it, rather than dropping it; it refuses to write when the catalogs have errors. `--item` refreshes one item and what it pulls in | A catalog deletion must not silently change what derives |
| 11 | `alukit check` reports a lock behind the catalogs as `info`. `--frozen` does not open the catalogs, so it reports no staleness | A lock behind is the lock working; CI with `--frozen` should not need the catalogs |

## Commands (§6)

| # | Decision | Why |
|---|---|---|
| 12 | A command validates every entity it creates or changes: the entity's schema, that what it names exists, that expressions parse and name params, that items resolve (in the lock, or the live catalogs). It does not re-validate the rest of the document | An error elsewhere must not block the edit that fixes it; `check` reports the whole |
| 13 | A refusal is `{code, message, entity?, field?, refs?}`; a command never throws, and an unexpected exception becomes `internal`. Codes: `command`, `args`, `missing`, `exists`, `schema`, `ref`, `expr`, `item`, `offer`, `referenced`, `run`, `geometry`, `derive`, `catalogs`, `internal` | Structured results an agent can act on |
| 14 | The `set*` commands take an RFC 7396 merge patch: `null` removes a field | One rule for every setter |
| 15 | Commands write the short forms: a node with only a position is `[x, y, z]`, a run with no label or tags is a list of bars; adding a label switches to the object form and removing it switches back | The forms people write by hand |
| 16 | Removing an entity records its number in `ids`, also in a document that has no counter yet | §2: ids are never reused, even after a delete |
| 17 | `removeEntity` with `cascade` removes referrers, or drops the entity from lists that can lose a member down to their minimum (a run keeps 2 bars, a butt or pivot 1 end, a face 2 layers, a pattern template 1, an open item's scope 1). It refuses to cascade into params, defaults and `order`, and refuses pattern copies (skip or explode instead) | Cascade removes and prunes; it never rewrites an expression or a setting behind the user's back |
| 18 | After each command of a batch, items the document newly names are pinned into the lock from the live catalogs, so the next command and derive see them. Without live catalogs, a command naming an unpinned item is refused | §4.13 "on every save"; inside a batch the later commands need them |
| 19 | Undo and redo keep `{document, lock}` snapshots: one step per successful batch, and `record()` takes a valid direct file edit in as one step | §6 and §7.1; the lock is part of the state an undo restores |
| 20 | `reverseBar` uses the section's first mirror symmetry in the order x, y, d, a, with the roll that keeps the body (0°, 180°, 90°, 270°). It refuses a section with none, a bar in a run (reverse the run), a free end b, and a rail-hole selection along the bar. It rewrites everything that names the bar's ends and stations: parts on it turn 180° about z, pattern steps along it change sign, a face connection's `at_mm` becomes L − at and its `across_mm` changes sign where the symmetry turns u over | The body and everything on it stay where they were; a run's bars must all point the same way |
| 21 | `splitBar` makes the split node from the written coordinates where the line keeps them: an axis-aligned bar gets `a ± s` expressions, so the node follows the params. Ops and stations past the split move to the new piece, valued with the params at the time. Pieces in a run, new (`run: true`) or existing, always get the splice, which derive requires; a face connection that names the bar needs the run and is refused without it | A run's pieces are joined by splices (§4.3); a face layer must stay one member |
| 22 | `mirror` takes a plane square to a world axis. References outside the mirrored set are kept only when the plane maps them onto themselves (a node on the plane, a bar in it or crossing it symmetrically); anything else is refused, naming what to include. A bar whose section has no mirror symmetry takes its item's other `hand`, else it is refused; a part keeps its item when its box and datums are symmetric about its landing datum, else the other hand. A part on a bar gets roll −ρ (180° − ρ on a bar the plane reverses); a part at a world pose gets the reflected position and the rotation turned over in its own y, as X-Y-Z Euler angles; a rotation written as expressions is refused | A mirror image is another body unless the section or item says otherwise |
| 23 | `array` and `explodePattern` share one copier: the template's entities translated as derive translates a copy (§4.7, decision 16 of M3a). `explodePattern` refuses a pattern something refers to, and a rail-hole pattern; a station on a bar that does not run along the pattern is refused | The copies must land where derive put them; a rail's holes are the rail's layout |
| 24 | `autoConnect` butts the ends meeting at a point through the bar that passes through it (not ending there), else a vertical bar ending there, else the lowest id; ends some connection already claims are left alone; the connector and qty come from `defaults.butt` | §4.5's default connection |
| 25 | `lockUpdate` as a command needs the live catalogs and answers with the same diff as `alukit lock update` | A step in the log like any other (§6) |

## The CLI (§7.3)

| # | Decision | Why |
|---|---|---|
| 26 | `alukit do` takes inline JSON, `-f <file>`, or `-` / `-f -` for stdin. A batch is a command, a list, or `{"commands": [...]}`. Exit 0 when applied, even if the model then has errors (`check` judges those); 1 when refused, when the edit lock is held, or when a file cannot be read; 2 on a usage error | The exit code says whether the edit happened |
| 27 | With no server, the answer's revision is the first 12 hex digits of the content hash of the canonical document and lock. `--as <name>` tags the source in the answer; the log itself is the server's (M4a) | A counter needs a process that outlives one batch |
| 28 | `do` answers with the diagnostics `alukit check` reports on the model (derive's, the cut list's, unconnected ends, project checks), as the ones the batch added and resolved plus totals | §6: diagnostics that name entities; the same rules everywhere |
| 29 | A held edit lock refuses at once, naming its holder; a lock whose process is gone on the same host is taken over | One process per batch; waiting would hide a stuck holder |
| 30 | `alukit add` writes a point as a node id, `x,y,z` (commas inside parentheses do not split), or a station `<bar>:<at_mm>[:<from>]`; `add connection` takes butt, miter and splice, and `--auto`; other connection types go through `do` | Sugar for the common cases; `do` stays the complete path |
| 31 | `alukit query` reads the document as written (pattern copies are derive's). `<kind> of <id>` takes references in both directions (`connections of b2`, `bars of c3`). It derives only when asked for a derived field (`cut`, `len`, `centre` of a bar, `pos` of a node). At most 50 entities, each line cut at 200 characters | Bounded output for an agent's context (§7.3) |
| 32 | `alukit new` names the built-in `std` catalog unless `--catalog` is given; a `--catalog` path is taken relative to the shell and written relative to the project. It refuses a folder that holds a project, and writes nothing when the catalogs have errors | The document's paths are the project's (§3.1) |

## Checks (§4.9, §5.5)

| # | Decision | Why |
|---|---|---|
| 33 | Unconnected ends: two or more bar ends meeting within `tol.len`, where an end has no provider and is not the through member of a butt at that point (a through bar, or a bar end a butt bears on, `through: "b31.b"`) | §5.5's warning, without flagging a deliberate end plate or `through_end: "none"` |
| 34 | `bbox()` is the extent of the bar bodies along each world axis, each body swept between its end planes (exact for every planar cut). Parts are not in it yet: derive places them since M3b's generation part, and adding them is open | Derive placed bars only when this was built |
| 35 | `count(tag:t)` counts nodes, bars, connections, parts and runs carrying the tag after pattern expansion, through derive's own expansion | A copy is as real as its template |
| 36 | `mass()` and `cost()` read the bill of materials and prices; until a caller supplies them (an accessor table), a check that uses them is `check-pending` info, not an error. *Supplied since the merge with part 3 (decision 39); a caller that passes no table still gets pending* | Prices are M3b's other part; a pending check is not a failed one |
| 37 | Margin: limit − value for `<` and `<=`, value − limit for `>` and `>=`, −\|value − limit\| for `==`, none for `!=` and for a plain `expr`. Pass or fail is the expression language's own comparison, within `tol.snap`. A check that cannot be evaluated is an error; a failing check reports at its own severity | §4.9; one comparison rule everywhere |

## For the merge with M3b's other parts

- The fixture locks pin the test catalogs as they are on this branch. When a merged branch
  changes a fixture catalog, run `alukit lock update` on each fixture project that uses it; the
  lock tests and `fmt --check` will say which.
- `checkModel` takes the extra accessors (`mass`, `cost`) as a table; the BOM and costs plug in
  there.
- Done in the merge with generation (2026-11-26): `fixtureProjects()` takes in `golden-gen/`
  too, every fixture project has a current lock and a canonical document, and a test derives each
  one from its lock and from the live catalogs and compares the derived model, cut list and BOM.
  Still open: `mass()` from the BOM's total, and parts in `bbox()`. *`mass()` is done (decision
  39); parts in `bbox()` are still open.*
- Done in the merge with part 3 (2026-11-26): `order` and `costs` parse options like the other
  project commands and derive from the lock (`--frozen` too). `fixtureProjects()` takes in
  `tests/fixtures/order`; every fixture lock was refreshed (part 3 changed the synthetic catalogs'
  offers) and every document formatted. Part 3's typed cost lines, price bands, rates and open
  items give the canonical form its key order (decision 1); cost lines and bands declare their
  fields in §4.11's order (id, label, kind, supplier, amounts, provenance, blocks, covers), since
  that declaration order is the file's.

## Tie-ins after the merge with part 3

| # | Decision | Why |
|---|---|---|
| 38 | An open item's scope is read by one grammar (`src/core/project/scope.ts`) in the order rules, the command references and the rewriter: `supplier:<id>` a supplier, `<catalog>:<id>` an item, else an entity by itself, its end (`b3.a`), a stock piece (`c23.f1`) or a pattern copy (`b26@2`). Only an entity of the document, or a project item, is a reference: a cascade prunes it, a missing one refuses the command. A bar end follows `reverseBar` and `splitBar` | Part 2 read every member as an entity id, so `addOpen` refused §4.12's `supplier:<id>` and the forms part 3's rules read (its decision 31) |
| 39 | `mass()` is the BOM's total in kg; `cost()` the order's likely total, and `cost(low)`, `cost(likely)`, `cost(high)` its bounds, in the project's currency's major unit (minor units / 100, as the outputs print it). The design writes `cost("high")`, but the language has no strings, so the bound is a bare name like an accessor's id. A total that leaves something out (an item with no mass, an order line with no price, a cost line with no rate) makes the check one that cannot be evaluated, an error naming what is missing, rather than one that passes on a partial sum. `alukit check`, `do`, `order` and `costs` supply both, each output computed once and only when a check reads it | §4.9; a budget check that passes because a price is missing would hide the gap |
| 40 | `order` and `costs` state the lock they derived from in every format (§5.4, §9): `lock` beside the basis and the oldest read date in JSON, a line in Markdown, a first `stamp` row in CSV. It is sha256 of the lock's canonical text, so `shasum -a 256 alukit.lock.json` gives it for a canonical lock. Called from code without a lock, the order has none, so the hand golden compares the order alone. *Since the third acceptance run every output states it, with the basis and the oldest read date where it prices ([v1-limits-closed](v1-limits-closed.md) 1–9)* | §4.13's stamp; the golden stays a statement about the order, not about one lock's bytes |
| 41 | `order` and `costs` run the model checks of `alukit check` (derive's, the cut list's, unconnected ends, project checks) before the order rules, so a failing check holds the order through `check-error`. The order is priced first (`priceOrder`), the checks read its totals, then `orderOf` applies the rules: §5.1's collect, check, order rules. A check's diagnostic names only the check, so a failing one holds every supplier (§5.5's "a check that names none"); scoping it to the entities its expressions read is open | Part 3's decision 30; an agent cannot hand over an order a project check forbids by skipping `alukit check` (§5.5) |
