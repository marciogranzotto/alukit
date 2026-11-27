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
| 3 | `only_in` puts an entity in the variants it lists **and in no other, so not in the document derived with no variant**; `not_in` leaves it out of those it lists. A name that is not in `variants.list` is an error. *Cost lines take them too since [acceptance-gaps](acceptance-gaps.md) A5* | The plain reading of "only in"; a project that wants a base variant names one as the default |
| 4 | What hangs on a left-out entity follows §6's cascade: a list that can lose a member (a connection's ends, a run's or a template's members, an open item's scope) drops it with an info; a connection left with too few ends, or whose through bar or pivot base is out, is left out with an info; anything else naming it (a point or a part on it, a pattern along it) is an error, "scope it to the same variants", and is left out too | The same rule `removeEntity --cascade` already follows, so a variant is "the document with those entities removed" |
| 5 | Variant params replace or add to the document's. Swaps replace an item wherever the frame names one: the entities and `defaults`. `order`, `costs` and `price_bands` keep naming what they name | Swaps change what is built; buying choices are about specific items, and a choice for the old item would be wrong for the new one |
| 6 | A swapped bar or part keeps only the options its new item has (each dropped option is an info); a swap whose source item nothing names is a warning | A finish the new profile lacks must not fail the derive; a dead swap is usually a typo |
| 7 | `addVariant` and `setVariant` refuse a swap to an item that does not resolve, or a param expression reading an unknown param | Commands validate what they create (§6) |
| 8 | `--variant v` on `derive`, `cutlist`, `bom`, `order`, `costs`, `check`, `export glb`, `revision show` (and `machining`, since the M6 merge: decision 35); the text outputs name the variant in their header, the JSON carries `variant` | One flag, one meaning |

## Revisions (§4.13)

| # | Decision | Why |
|---|---|---|
| 9 | One file holds the outputs of **every** variant in the list, in name order, with the document as written first when there is no default; `show --variant` picks one | A revision is what was published, and a variant is part of it |
| 10 | The stored outputs are exactly the JSON of `alukit derive`, `cutlist`, `bom`, `order`, `costs` (`--format json`) and the check report, through one function (`projectOutputs`); since the M6 merge, `machining` too (decision 36) | **verified**: `revision.test.ts` compares them with the CLI's own output |
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
| 24 | Square-ended bars of one section and material share a mesh, placed by their node matrix; a bar with an angled end has its own; parts are boxes (a project plate or bent angle its shape, since the M6 merge: decision 40); fasteners share one unit rod, scaled per node | Small files for big frames; the same geometry the viewer draws |
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
| 32 | The example's test splits the fenced block into words (quotes, comments) and refuses pipes, redirects and variables, then runs each command as its own process in an empty folder and checks the numbers the prose states. Since the M4b merge the example ends with a snapshot, which the end-to-end suite runs ([`m4b-decisions.md`](m4b-decisions.md), decision 41) | "runs through the CLI as written" |
| 33 | `alukit skill install [--dir]` makes an absolute symlink to this checkout's `skills/alukit`. A link already pointing there is fine; another link, a folder or a file at that path is refused, never replaced. There is no uninstall | Idempotent and never destructive; removing a link is one `rm` the person chooses |

## The merge into main, and what it folded in

Main had gained M6: project items (plates, bent angles, generic items, placeholders), the
machining sheet and `/api/machining`, the viewer drawing plates, bent angles and placeholders,
and G28. Git met five conflicts (the README, the project commands' usage, derive, the server's
view model, the viewer's scene); both sides were kept in each. Decisions 34–41 join the two.

| # | Decision | Why |
|---|---|---|
| 34 | Derive's stage 1 applies the variant, parses the document it builds, then resolves that document's project items (`projectItems`) and derives from both. A variant changes no project item, so a swap to one is checked against the document as written: `applyVariant` looks the new item up among the catalogs' and the project's items, and a part swapped onto a project item drops its options with an info (decision 6) | **Verified**: `variant.test.ts`. Without it, a part swapped from a catalog item with a finish to `project:spacer` failed derive with `project:spacer has no option "finish"` |
| 35 | `alukit machining` takes `--variant` as every project command does | Decision 8 |
| 36 | A revision stores the machining sheet with the other outputs: `machining` is what `alukit machining --format json` prints (`checkedMachining`), `verify` compares it field by field, and `revision show --output machining` prints it as Markdown or JSON (no CSV, as M6 decision 18). `diff` already compares project items as entities (the `items` kind), so a moved hole shows there and in the masses it changes | "every output" (§4.13). **Verified**: `revision.test.ts`, the stored sheet against the CLI's, in JSON and Markdown |
| 37 | `meshDisplay` (`src/mesh/display.ts`) took in what M6 added to the server's view model: parts read through `projectItems`, a project plate's or bent angle's shape with its holes, the placeholder flag and a project item's mass. A hole in the view model also carries its `id` and `type`, as the machining sheet names them | One display for the viewer and the GLB writer (decision 29) |
| 38 | `src/mesh/items.ts` builds the project items' meshes as plain arrays (`plateMesh`, `angleMesh`, `partMesh`): one prism builder, flat-shaded, wound outward whichever way an outline runs. Its one call into three.js is `ShapeUtils.triangulateShape` (earcut) for the end faces of an outline that may be concave, as `bars.ts` relies on three for a section's (decision 28). A bend is 8 chords per 90°, in degrees through `#core/trig.ts`, so its ends are exact | Pure functions the viewer and the GLB writer share; no geometry class. M6's `ExtrudeGeometry` with `curveSegments: 8` drew each bend in 16 chords (**read**: three's `CurvePath.getPoints` doubles the divisions of an arc), not the 8 its note and comment state; 8 is what they meant, and the volume stays within 0.1 % (**verified**: `mesh.test.ts`, plate and angle volumes, bounds, winding against normals, a clockwise outline, a sharp bend) |
| 39 | `place.ts`: `partShape` carries a project shape (drawn instead of the box, never translucent) and the placeholder flag; `rodMatrix` places any rod, and `fastenerMatrix` and `holeMatrix` both use it. `style.ts` gained M6's colours (`custom`, `hole`, `placeholderEdge`) and `partColour`. The viewer draws parts from `partMesh`, places hole rods with `holeMatrix` under each part's matrix, and keeps `EdgesGeometry` for outlines, which the GLB has no use for | M6 decisions 31 and 32, now from one source. **Verified**: `mesh.test.ts`, each rod's extent against its hole; the Playwright suite |
| 40 | The GLB has a node per placed project part, named and placed as any part's: a plate's or bent angle's shape in material `custom` (one mesh per item), a placeholder's box translucent. Extras add `shape` (`plate`, `bent-angle`) or `placeholder: true`; a project item has no offer, so no `sku`. Each hole's rods (the drill's, and a countersink's or counterbore's mouth) are children of the part's node, named `<part>.<hole> <rod>`, on one shared 16-sided rod in material `hole`, with extras `kind: "hole"`, `id`, `part`, `hole`, `type`, `rod`, `d_mm` | A child moves with its part in any tool, and a hole is named as the machining sheet names it. **Verified**: `glb.test.ts`, through `GLTFLoader`: p6, p7 and p8 with their extras, their meshes' bounds and matrices (equal to `partShape`'s), p6's six rods and p7's two by name, h1's rod on (20, 20, 4) of the plate; two exports still the same bytes |
| 41 | The skill names project items and the machining sheet in its prose, and `pnpm skill` regenerated the reference, which now lists `machining` | Decision 31 |

**Test expectations changed by the merge.** `glb.test.ts` counted 3 parts in the cart's file; it
now counts 6 (p1 and its two pattern copies, plus M6's p6, p7 and p8), with the bars and
fasteners as before. `mesh.test.ts`'s hole markers gained the fields `hole`, `type` and `rod`,
their numbers unchanged, and its plate and angle tests read the new arrays instead of three's
geometries, with the same bounds and volumes. No golden value changed: G1–G28, the cart's cut
list, BOM, order and machining sheet, G26's checks, `/api/order` (the hand golden plus the lock's
stamp) and the GLB's byte identity all pass as they were.

