# UX redesign, S1: decisions

*2026-11-27. Calls made while building stream S1 of the [UX plan](plan.md) (§5.5: core, server
and CLI) where the plan, [`contracts.md`](contracts.md) or [`design.md`](../design.md) is silent or
ambiguous. The design's changelog lists the behaviour under "UX redesign, S1". For the
coordinator to fold in or veto. The plan's §5.5 names this note `docs/notes/ux-s1-decisions.md`;
the stream's brief put it here, beside the plan.*

**No golden value changed.** G1–G38, the cart's cut list, BOM, order, costs and machining sheet
pass unchanged. The outputs that did change are listed under "Output changes" below, each where
the bug was the cause or where a field was added.

## Output changes

| Where | Before | After | Why |
|---|---|---|---|
| `alukit order`, the `option-not-sold` reason, no option chosen | `forseti:PF40-01: not sold with ` (the option text empty) | `forseti:PF40-01: sold only with finish anodised or black; choose one` | U10: the message named the option asked for, and none was. With an option chosen it is unchanged |
| The `option-not-sold` reason's `entities` | `[item]` | `[item, …the bars and parts asking, sorted]` | Added, so a fix knows what to change (BE-3). The message is unchanged |
| `alukit check`, the cut list's `no-offer` warning | `forseti:PF40-01 [] has no offer that sells it by length`; with an option, `… [["finish","red"]] has …` | `forseti:PF40-01 has no offer that sells it by length; it is sold only with finish anodised or black`; with an option, `… with finish red has …` | BE-7: the option key's JSON is not words. The sold part is added only when offers exist and none matches |
| The same warning's `refs` | none | the bars whose pieces it lists, sorted | Added (BE-3) |
| `alukit log` | `   1  cli:a        addNode` | `   1  cli:a        add point n2` | BE-4, as the plan allows. `--json` keeps `what` and adds `text` |
| `alukit catalog search 40x40` | 40 × 40 accessories first (short names won the whole-word tier) | the 40 × 40 profiles first | U14 (BE-8) |
| `alukit catalog search --json`, `/api/catalog/items` | — | each bar gains `size_mm: [W, H]`; the answer gains `prefer` when asked | Added (BE-8) |
| The same, each item | — | `from: { minor, currency, per: "m" \| "unit" }` | Added (BE-12) |
| `POST /api/restore` | `{ ok, rev }` | `{ ok, rev, kept: [".alukit/rejected/2026-11-27T05-30-12Z.json"] }` when it wrote over a file | Added (BE-9) |
| `alukit new` with no T-slot catalog | nothing on stderr | `notice: no catalog here sells T-slot profile; forseti does: name it with --catalog forseti, or add it later with setProject` | D-UX-7. Standard output is unchanged; the notice is on standard error, as the lock's notices are |

## Drop 1: S1.1–S1.7

| # | Decision | Why |
|---|---|---|
| 1 | **The sold options in words**: each option's values in name order, each set sorted, `finish anodised or black`; two options `finish raw and length 3000 or 6000` (`soldOptionsText`, `src/core/order/types.ts`). The cut list and the order use the same function | One rule for both messages, and the Problems sheet reads it too |
| 2 | **`--as cli:<name>` passes through** as `agent:<name>` does; a bare name is `cli:<name>`; anything else (`ui`, `file`, a space) is a usage error naming `--as`. The rule lives in `src/server/source.ts` beside the server's `SOURCE` | `cli:cli:a` was the old answer to `--as cli:a`, which nobody means. One module holds the rule both ends apply |
| 3 | **A bar's own size** is its built section's box, W × H to 0.01 mm, computed when the index is built (lock or live catalog), and a size query (`40x40`, `40×40`, `40 x 40`) matches it either way round. The size rank (2) sits between a code prefix (1) and whole words (3); every other word must still be a whole word. `prefer` orders a kind first within each rank, never filtering | U14's root cause (§2.2) was that the ranking knew no bar's size. The box is the dimension the catalogue names a profile by; the name is not always written that way |
| 4 | **`setProject`'s args are the patch itself** (`{ "currency": "EUR" }`), not `{ set: … }`: the project has no id to name, and each field is a merge patch over the document's own (§6). `changed` lists the fields changed (`["currency"]`). An empty patch is refused. The step is one undo step like any | Matches the plan's CLI form (BE-1). Field names in `changed` are what the log's words say |
| 5 | **Catalog confinement** judges only catalogs a step **adds**: each must be a built-in id or a folder that resolves (symlinks followed) inside the project and holds a `catalog.json`. A list that keeps an outside folder already there is accepted, so reordering or removing does not need a hand edit. An absolute path is refused. Confinement needs the places (`CommandEnv.catalogs`); a command applied with none refuses every folder | §7.2's rule applies to a path a request names; a folder already in the document was named by a hand edit, which stays the way to name one elsewhere |
| 6 | **A step that adds a catalog may use its items in the same command**: a command declares `catalogsAfter(args, doc)`, and `applyBatchLive` opens the new list before that command runs. The server adopts the new live catalogs only after the step is written | "Add forseti and make PF40-01 the default bar" is one gesture in the start card; without this it would be two steps |
| 7 | **`describe(args, did)` is required on every command** (`CommandDef`), returning a phrase (`over("add", "bar", ids)`) or a sentence, or nothing when it did nothing visible. A step joins its phrases: the same verb and noun merge ("add bars b1, b2 and b3"); the `autoConnect`s after a drawing command fold into "joined at 2 ends"; more than three parts give the first two "and n more"; nothing visible is "no change". Undo and redo are "undo …" and "redo …" of the step's words; a file step is "edit the files by hand" | Required by the type, so a new command cannot leave it out. The words are the plan's examples (BE-4, U16–U18) |
| 8 | **The problems are made in the core**, from the snapshot's check diagnostics and the order after the checks (`checkedOrder`), never judged again: a diagnostic is one problem in its severity's group; an order reason is one problem over every supplier it holds (`suppliers`); a `check-error` reason is the error it repeats, which then blocks, `from: ["check", "order"]`; an open item is the `open-item` reason it causes (`from` gains `open`), or a note while it holds nothing | The plan's rule: nothing here changes what `check` and `order` mean, and every `raw` is a CLI message |
| 9 | **Ids** are `<code>/<what>[/<suppliers>]`: a diagnostic's entity, or a reason's targets joined by commas, then the suppliers (`-` for the unsourced). A second problem of the same three gains `~2`. Stable while the problem lasts; not a key across projects | The app keeps a problem's row open and its badge across revisions by id |
| 10 | **Fixes, the likeliest first.** An open corner: `autoConnect` at the end. An option not sold (and the cut list's `no-offer` for the same reason): one "Set <value>" per set sold, setting it on every document bar and part that asks, as one step (a pattern copy changes through its template); and "Make <value> the default" through `setProject` when every asking bar takes the option from `defaults.bar`. A cost line that holds the order: "Release K1" (`setCost`, `blocks: null`). An open item: the `resolve-open` form. A price: `set-price`; out of stock or stale: `lock-update`; a param a diagnostic names: `param`. Tests apply the option and corner fixes and check that the problem goes | The commands are the ones the UI would send; a form is named where a value must be typed |
| 11 | **Headless `alukit problems` is revision 0**, as a server just opened on the files would say; through a server it reports the server's counter. The JSON is `problemsText`, so the server and the CLI agree byte for byte. The server caches the text per revision, variant and date | The plan's byte-for-byte rule (§5.5's done-when) |
| 12 | **`order.status` is `EMPTY`** when no supplier has a line or a cost; `order.blocks` counts the `blocks-order` problems; `order.warnings` the problems the order warns about (an order rule that warns), not the check's warnings | contracts.md's S0 decision 6, kept |
| 13 | **`alukit problems` human form**: a group heading with its count, each problem's title with its code, its detail, its fixes' labels; then a line of counts and the order's status at its date. Exit 1 when one blocks the order or is an error | BE-3 |
| 14 | **A dry run answers `effects.added`** beside `cuts`, `removed` and `claimed`: each bar the step would create, with its cut length. `cuts` holds only bars whose cut moves, `[before, after]`; `claimed` the ends that go from the default to a provider, the new bars' included. Recorded in contracts.md as an addition | The box frame's numbers and the joint preview need the new bars' lengths, which `cuts` (before → after) cannot hold |
| 15 | **A dry run runs in the queue**, after the files are read, against the revision after every step queued before it; it is not remembered by `id` (it takes none). A refused dry run answers 422 with `dry: true` as a refused step would; read-only answers 409. Headless, `alukit do --dry-run` runs the same core under the edit lock and writes nothing; its `rev` is the content hash of the state it ran against | BE-2. A dry run and a real step never share a remembered answer |
| 16 | **`alukit do --dry-run`'s human form** says "would create", "would add", "would resolve", one line per moved cut (`cut b1: 1000 → 980`), new bar (`new b4: cut 600`) and the claims, and ends "dry run on rev …: … after it; nothing was written". Without `--dry-run` the output is unchanged | The plan allows no other change to `do`'s output |
| 17 | **The skill reference writes a nullable type** as `string \| null` (Zod writes `{"type": ["string", "null"]}`, which the generator printed as `any`) | Found when `setProject`'s `name` printed `any` |
| 18 | **The S0 problem fixture stays a hand transcription** (`tests/fixtures/ux/problems-cart.json`), held by its own test to `check` and `order`. It is not replaced by `alukit problems`' output, whose words differ from the hand ones; streams that read it move to `fetchProblems` | Replacing it would change S2–S4's fixture under them; contracts.md says only adding |

**Outside S1's files.** S1 changed two lines of `tests/e2e/live.spec.ts`, which S2 owns: its last
two assertions read `alukit log`'s human output, `1  cli:e2e  addBar` and `2  ui  undo addBar`,
which BE-4 puts into words (`add bar b35`, `undo add bar b35`). Nothing else in the spec changed,
and what it proves (the log names who made each step, and the undo is the server's) holds. §5.5
gives S1 `alukit log`'s words and §5.10 lets a spec's words change; left alone, the lines fail
the gate on S1's own planned change. S2's rewrite of the spec (§5.10's "live" row) keeps them or
replaces them.

## Drop 2: S1.8–S1.14

| # | Decision | Why |
|---|---|---|
| 19 | **The corner rule** (`CornerRule` in `schema.ts`): a bar passing the point still runs through first; else `vertical` is the rule as it was (a vertical, else the lowest id), `first` the lowest id, `x` and `y` the lowest-id bar along that world axis (within `tol.vert`); where no bar runs along the axis asked, the rule as it was decides. `autoConnect`'s `prefer` wins over `defaults.corner`, which `setProject` sets. The rectangle's three arrangements are worked by hand in the test (a through bar reaches 20 past its corner, a butting one stops 20 short): 1040/600/1000/560, 1040/560/1040/560, 960/640/960/640 | D-UX-9 (b). The fallback keeps `x` meaningful at a corner that has no bar along x |
| 20 | **`addFrame` is made of commands**: `setParam` ×3 (with `params`), `addBar` ×4 posts and ×4 per ring, `autoConnect` at every ring corner, run in order inside it by `runSteps` (`helpers.ts`), which pins what each names as a batch does. `pinNew` moved from `apply.ts` to `helpers.ts` for it | The corner rule and the validation stay in one place, and the frame dry-runs and undoes as one step (D-UX-8) |
| 21 | **Ids and order**: posts first (front left, front right, back left, back right), then the base ring, the shelf ring, the top ring, each front, back, left, right; then the butts, ring by ring, corner by corner. Bars carry a tag of their role (`post`, `base`, `shelf`, `top`) and a label (`top rail, front`). With only a top ring this is the skill's worked-example table, bar for bar: a test builds both and gets the same cut list, BOM and machining sheet byte for byte | A frame reads the same in the outline whoever drew it, and the tags select a role (`tag:post`) |
| 22 | **Outside flush by anchors**: the design points are the footprint's corners and the height, and each bar's anchor puts its section inside (posts `-x-y` … `+x+y`; a rail along +x `-x` at the front, `+x` at the back; along +y `+x` at the left, `-x` at the right; `-y` on the base ring, `+y` on the shelf and the top). Rails always run +x or +y | As the cart and the skill draw a frame; the design lines meet at the corners, so `autoConnect` finds them |
| 23 | **Refusals**: W, D or H not over twice the profile's larger side (a rail that butts loses a profile at each end); a shelf whose top face is below the base ring plus a profile or above the top ring's underside; `params` when W, D or H exists (`exists`). An item that cannot be found is not refused, as `addBar` does not refuse it | The frame would derive with no length; a param of that name would be overwritten |
| 24 | **Restore keeps each file that differs** from the state it writes, the document as `<UTC time>.json` and the lock as `<UTC time>.lock.json`, the time to the second with `-` for `:` (not allowed in a file name everywhere), numbered `-2`, `-3` within a second, a stem being free only when neither its `.json` nor its `.lock.json` exists, so one restore's files never share a stem with another's; created exclusively, mode 0600. Nothing is kept when the files hold the state already (a failed write). The answer's `kept` lists the paths relative to the project | D-UX-15. The host takes a clock (`now`) so a test names the file |
| 25 | **`--theme`** sets both the page's `&theme=` and the browser's `colorScheme`, so a page that follows `prefers-color-scheme` draws the theme asked even before it reads the parameter. Today the page has one theme (S4.11 adds light). The output line is unchanged | D-UX-21. A rendering test needs the built app and lives in `snapshot.spec.ts`, which S1 does not own; the URL and the option are unit-tested |
| 26 | **`from`**: per metre when any offer sells the item by length (cut, or in stock lengths, a bar price over its length, a per-unit stock offer over its pack's length), else per unit (a pack's price over its count); the regular price, never the sale; a quoted range's likely value; kits left out; none when the offers are in several currencies. Rounded half away to a minor unit | BE-12. A sale is not the price a list should promise; a kit's price is not the item's |
| 27 | **`alukit new` names the built-in catalogs that sell T-slot profile** (a bar whose section has grooves, with an offer), opening each only when none of those it names does. It never adds one | D-UX-7 (a): making one vendor the default is a product call. §5.5 lists only BE-7 and BE-4 as human-output changes; this notice is D-UX-7's, on standard error |
| 28 | **Drop 2 left `src/core/derive/` alone**, `fastenings.ts` and its neighbours included | The brief: another stream changes them |

## Measured (S1.13)

A generated project of 84 box frames (`addFrame`, 1000 × 600 × 800 in test:TS40), 1,008 bars and
672 butts, through the server's HTTP API, measured 2026-11-27 on the development Mac with the
load average at 13 (other work running; `nice -n 10`), Node 26:

| What | Time |
|---|---|
| Building it: one batch of 84 `addFrame` | 7.8–8.2 s (each `autoConnect` derives the model so far, so the cost grows with the project) |
| Opening the server on it (derive, check) | 181–197 ms |
| `GET /api/problems`, first at a date (the order priced) | 23 ms |
| The same, again (cached per revision, variant and date) | 2–3 ms |
| The same at another date | 2–3 ms |
| A dry run: a post on a rail and its `autoConnect` | 144–167 ms |
| The same step, real (written, logged, broadcast) | 181 ms |
| A dry run of one `addFrame` (12 bars, 8 butts) | 389–395 ms |
| That `addFrame`, real | 498 ms |

So a dry run per pointer move is affordable on a small project and not on a 1,000-bar one (the
joint preview should dry-run on snap, not on every move), and the box frame tool's numbers cost
about 0.4 s a change at that size: S5.6 and S5.7 should debounce. `addFrame` derives once per
corner; a single derive for all its corners would cut that, but it would have `autoConnect` read
geometry from before the connections it makes, which holds only because a frame's corners share
no end. Not done: the time is within reason, and the rule stays in one place.
