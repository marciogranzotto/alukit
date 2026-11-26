# M5 decisions: variants, diff, revisions, the GLB writer and the skill

*2026-11-26. Calls made while building M5 without `snapshot` (design §12: variants with
`only_in`, diff, revisions with stored outputs, the GLB writer, the skill) where
[`design.md`](../design.md) is silent or ambiguous. For the coordinator to fold into the design
or veto. Labels: **verified** (run, with how), **read**, **inferred**.*

## Variants (§4.10)

| # | Decision | Why |
|---|---|---|
| 1 | A variant is applied in derive's stage 1 (`applyVariant` on the raw document, before parsing), and `Derived` records which. Every reader (outputs, checks, the server, commands' derived views) gets it with no change of its own | §5.1 puts variants in stage 1; one place means the outputs and the checks cannot disagree |
| 2 | Which variant: the one named, else `variants.default`, else none (the document as written). An unknown name is an error diagnostic in the core; the CLI refuses it first with exit 1, listing the variants | `--variant tll` must not quietly derive the default |
| 3 | `only_in` puts an entity in the variants it lists **and in no other, so not in the document derived with no variant**; `not_in` leaves it out of those it lists. A name that is not in `variants.list` is an error | The plain reading of "only in"; a project that wants a base variant names one as the default |
| 4 | What hangs on a left-out entity follows §6's cascade: a list that can lose a member (a connection's ends, a run's or a template's members, an open item's scope) drops it with an info; a connection left with too few ends, or whose through bar or pivot base is out, is left out with an info; anything else naming it (a point or a part on it, a pattern along it) is an error, "scope it to the same variants", and is left out too | The same rule `removeEntity --cascade` already follows, so a variant is "the document with those entities removed" |
| 5 | Variant params replace or add to the document's. Swaps replace an item wherever the frame names one: the entities and `defaults`. `order`, `costs` and `price_bands` keep naming what they name | Swaps change what is built; buying choices are about specific items, and a choice for the old item would be wrong for the new one |
| 6 | A swapped bar or part keeps only the options its new item has (each dropped option is an info); a swap whose source item nothing names is a warning | A finish the new profile lacks must not fail the derive; a dead swap is usually a typo |
| 7 | `addVariant` and `setVariant` refuse a swap to an item that does not resolve, or a param expression reading an unknown param | Commands validate what they create (§6) |
| 8 | `--variant v` on `derive`, `cutlist`, `bom`, `order`, `costs`, `check`, `export glb`, `revision show`; the text outputs name the variant in their header, the JSON carries `variant` | One flag, one meaning |

## Revisions (§4.13)

| # | Decision | Why |
|---|---|---|
| 9 | One file holds the outputs of **every** variant in the list, in name order, with the document as written first when there is no default; `show --variant` picks one | A revision is what was published, and a variant is part of it |
| 10 | The stored outputs are exactly the JSON of `alukit derive`, `cutlist`, `bom`, `order`, `costs` (`--format json`) and the check report, through one function (`projectOutputs`) | **verified**: `revision.test.ts` compares them with the CLI's own output |
| 11 | File name: the name in NFKD, lower case, runs of anything but `a-z0-9.` turned into `-`, trimmed; the name as written is kept inside. Save refuses an existing file: a revision is never overwritten | A stable, portable file name; a published revision is immutable |
| 12 | `as_of` (`--as-of`, else today) is stored and every replay uses it | Prices go stale with the calendar (§5.5); a replay months later must not drift for that reason |
| 13 | The stamp: AluKit's and Node's versions, the schema, `hash` = sha256 of "alukit <version>\n" + the canonical document + the canonical lock, and `git: {commit, dirty}` or null. `dirty` looks at `alukit.json` and `alukit.lock.json` only | A revision or export written into the folder must not make the next stamp differ (it broke GLB byte identity before this) |
| 14 | `verify` is read only and opens no catalog: it re-derives from the stored document and lock, then reports a broken hash, a tool-version difference (a note, not drift), missing or extra variants, and every output field that moved, by path. Exit 1 on drift or a broken hash | "zero drift on an untouched revision" (**verified**: `revision.test.ts`, and the skill's worked example) |
| 15 | A model with errors is saved anyway, with a warning | A revision records what was; refusing would hide the state being recorded |

## Diff (§4.13, §7.3)

| # | Decision | Why |
|---|---|---|
| 16 | A side is a folder or its `alukit.json`, a revision file (known by its schema), `rev:<name>`, or `git:<ref>:<path>`. A git side reads the document and the lock beside it at that ref; git runs in the nearest existing folder of the path, so absolute paths and folders outside the current repository work | A lock changed between commits must show as a lock change **and** its effect (**verified**: `diff.test.ts`, a price 12650 → 13000 across two commits) |
| 17 | Each side derives from its own lock only, never the live catalogs; a revision side gives its stored outputs | What a commit or a revision meant, not what the catalogs say today |
| 18 | Variants: one side with two `--variant` compares two variants of it; two sides take none (each its default), one (both) or two (in order) | The common cases, with no new syntax |
| 19 | `as_of`: `--as-of`, else a revision side's, else today, the same for both sides | Otherwise staleness alone would differ |
| 20 | Entities are compared on the documents after the variant is applied; params by their derived values; bars by item, cut and centre length; BOM lines keyed by kind, item and options; order lines by supplier, item, options, SKU, unit and length | Keys that survive a reorder; a value moved by an expression shows where it lands |
| 21 | Exit 0 whether or not anything moved; 1 when a side cannot be read or lacks the variant named. `--format md` prints only the sections that moved ("No differences." otherwise); `json` is `alukit.diff/1` | It is a report, as `git diff` is without `--exit-code` |

## GLB (§9)

| # | Decision | Why |
|---|---|---|
| 22 | `src/export/glb.ts` is AluKit's own writer and imports no three.js: one buffer view per accessor, POSITION with min and max, normals, `UNSIGNED_INT` indices, flat metallic-roughness materials (a translucent one is `BLEND` and double-sided), no textures | The brief: pure, no three.js. Little-endian through `DataView`, no clock and no randomness, so the same project gives the same bytes (**verified**: `glb.test.ts`, two CLI exports compared byte for byte) |
| 23 | One root node, named after the project, carries the change of frame: rotation −90° about X and scale 0.001. Everything under it stays in the model's millimetres, Z up | Y up and metres at the root, as the brief asks, while a node's own matrix still reads in the model's terms |
| 24 | Square-ended bars of one section and material share a mesh, placed by their node matrix; a bar with an angled end has its own; parts are boxes; fasteners share one unit rod, scaled per node | Small files for big frames; the same geometry the viewer draws |
| 25 | Node names `<id> <label\|item>`; a pattern copy takes its template's label. Extras: `kind`, `id`, `item`, `sku`, `opt`, `cut_mm`, and a fastener's `connection`. A bar's SKU comes from its cut-list group; a part's or fastener's from the order lines (a sorted list when one item orders as several SKUs). `asset.extras` holds the stamp: `alukit`, `hash`, `variant`, `revision` (null from `export`), `git` | What a downstream tool needs to match a node to a line of the order |
| 26 | three's `GLTFLoader` sanitises object names (spaces to `_`, `:` dropped) and keeps the written name in `userData.name`; the test reads that | **verified**: `glb.test.ts` loads the file with `GLTFLoader.parse` in Node, and checks the names, the extras, the stamp, the root transform and every bar's box against derive's corners |
| 27 | What does not derive is not in the file; `export` warns and still writes | As the viewer draws a half-built model |

## `src/mesh/` (shared by the viewer and the GLB writer)

| # | Decision | Why |
|---|---|---|
| 28 | Bars stay in `src/mesh/bars.ts`, the one module that uses three's geometry classes (`ExtrudeGeometry` and its triangulation of outlines with holes); the GLB path reads the arrays out with `meshData()` | Triangulating a T-slot outline is what three's earcut already does; rewriting it would be a second, untested copy |
| 29 | New three-free modules: `data.ts` (arrays, column-major matrices), `solids.ts` (the box and the rod, wound outward), `style.ts` (the palette), `place.ts` (a part's box and a fastener's rod as one matrix each), `display.ts` (`meshDisplay`, moved from the server's view model) | The viewer and the GLB writer place parts and fasteners with the same matrices. The viewer's `scene.ts` now builds them from `boxMesh`/`rodMesh` and `partShape`/`fastenerMatrix` instead of `BoxGeometry`/`CylinderGeometry` (**verified**: the Playwright suite, 10 of 10) |

## The skill (§7.5)

| # | Decision | Why |
|---|---|---|
| 30 | The worked example builds a synthetic work table from the built-in `forseti` catalog | It ships in the repository and has offers, so the order and costs show prices; `std` has no offers |
| 31 | The reference section is generated between markers from the usage text `--help` prints and every command's Zod schema (`io: "input"`); `pnpm skill` rewrites it and a test fails while it is behind | §7.5: "generated from the command schemas" |
| 32 | The example's test splits the fenced block into words (quotes, comments) and refuses pipes, redirects and variables, then runs each command as its own process in an empty folder and checks the numbers the prose states | "runs through the CLI as written" |
| 33 | `alukit skill install [--dir]` makes an absolute symlink to this checkout's `skills/alukit`. A link already pointing there is fine; another link, a folder or a file at that path is refused, never replaced. There is no uninstall | Idempotent and never destructive; removing a link is one `rm` the person chooses |
