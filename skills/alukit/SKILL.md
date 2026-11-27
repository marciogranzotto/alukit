---
name: alukit
description: Use when planning, editing or checking a build made from catalog parts with AluKit (aluminium T-slot extrusion, steel sections, rails, brackets, fasteners) — an alukit.json project and its lock, bars, connections, parts, patterns, custom plates and bent angles, variants, the cut list, BOM, order list and costs, the machining sheet, revisions, diffs, a snapshot of the model or a GLB export. Triggers on "alukit", "alukit.json", "alukit.lock.json", "cut list for this frame", "T-slot frame", "aluminium profile frame", "add a bar", "order list", "machining sheet", "revision save", "alukit diff", "alukit snapshot", "export glb".
---

# AluKit

AluKit plans mechanical builds made from catalog parts. A project is a folder holding a JSON
document, `alukit.json`, and a lock, `alukit.lock.json`. AluKit derives everything else from
them: frames and end planes, cut lengths and angles, generated machining and hardware, the cut
list, the bill of materials, the order list per supplier, costs, the machining sheet for the
project's own plates and bent angles, checks, a GLB, and pictures of the model.

Work through the CLI, `alukit`. It is the same core the app uses, and every number it prints is
derived, so **never compute a cut length, a mass or a price by hand**: change the document,
then read the output.

## Ground rules

- **Edit with commands.** `alukit do <dir> '<json>'` applies a batch of commands atomically;
  `alukit add …` is sugar for the common ones. A command validates what it creates and refuses
  with structured errors (`code`, `entity`, `field`, `message`) rather than half-applying. A
  hand edit of `alukit.json` is accepted too (`alukit fmt` rewrites it into canonical form), but
  nothing checks it until the next command or `alukit check`.
- **Check after every change.** `alukit check <dir>` exits 1 on any error. Rules that span
  entities (a reference resolves, one provider per bar end, a fastener fits its groove) live
  there, not in the JSON Schema.
- **Units and frame.** Lengths in mm, angles in degrees, masses in kg, money as integer minor
  units (`_minor`) with a currency. The world is right-handed with **Z up**. A field's unit is
  its suffix: `at_mm`, `roll_deg`.
- **Ids.** Entities are a letter prefix and a number: `n` node, `b` bar, `r` run, `c`
  connection, `p` part, `pt` pattern, `K` cost line, `C` check, `O` open item, `D` decision.
  Commands assign them; ids are never reused. Pattern copies are `<id>@<k>` (`b26@2`). A bar end
  is `b7.a` or `b7.b`.
- **Items** are `<catalog>:<code>` (`forseti:PF40-01`), from the catalogs the document lists.
  `alukit catalog show <catalog>:<code>` prints one with its section, options and offers. A
  project's own bars and connectors (a pad strip, a fastening recipe) go in a **project-local
  catalog** named by path in `catalogs` (`"../my-parts"`), not in `items`: they need sections,
  systems and mounts, which a catalog holds. `items` is for plates, bent angles, generic items
  and placeholders (`project:<id>`). A joint with no body of its own (studs in tapped cores, a
  bush and a sleeve) is a connector with `"recipe": true` and no mass or box: its fasteners and
  machining are billed, the recipe is not, and no offer sells it. A tap into a bar's end, a
  connector's, a splice's or a tapped end hole, must stand on a core of its bar's section (`at_mm`
  or `at_holes` place a connector's; with none it is at the centre): one on no core is a
  `machining` error naming the nearest. It must also fit the core: a thread the vendor labels the
  core with (its `threads`, e.g. M5 in Forseti's 20-series Ø4.6) fits; any other is judged as a
  cut thread, the core no wider than its largest 6H minor diameter and the tap drill at most one
  pitch over it (an M6 fits an 80x80's Ø5 corner hole, an M16 does not; an M16 fits a Ø13.7
  core). A section that gives no core positions (a `tslot` section's `bores` and a drawn
  section's `cores` do) is not checked, an info.
- **The lock pins catalog data.** Derive reads the lock, never the live catalogs. A command
  that names a new item pins it; `alukit lock update <dir>` refreshes entries and prints what
  moved (prices, sections, cut lengths). `--frozen` on any output makes a missing entry an error.
  Every output states the lock it came from: `lock` in JSON (the sha256 of the canonical lock
  file), a "Derived from the lock" line in Markdown, a first `stamp` row in CSV; one that
  prices (the cut list, the order, the costs) also states its price basis and its oldest price
  read date.
- **Exit codes**: 0 fine; 1 the project has errors, an edit was refused, the order is blocked,
  or a revision drifted; 2 a usage error.

## The document

Top-level keys, in canonical order: `schema` (`"alukit.project/1"`), `name`, `catalogs`,
`currency`, `price_basis`, `fx`, `ids`, `defaults`, `params`, `nodes`, `bars`, `runs`,
`connections`, `parts`, `patterns`, `items`, `costs`, `price_bands`, `order`, `order_rules`,
`variants`, `checks`, `open`, `decisions`, `views`. Entities in `nodes` … `patterns` take
`label`, `tags`, `only_in` and `not_in`.

**Numbers and expressions.** Anywhere a number goes, an expression may: params, `+ - * / ^`,
comparisons, `and or not`, `if(c, a, b)`, `min max abs round floor ceil sqrt hypot`, trig in
degrees, and `sec(b3).t_mm` (a bar's section parameters, `width_mm`, `height_mm`). Params are
numbers, expressions, or valued fields `{ "v": 900, "src": "meas", "note": "…" }`.

**Points**: a node id `"n4"`; `[x, y, z]`; `{ "on": <station> }`, a point on a bar that follows
it; `{ "pivot": "c4" }`. End `b` may be a free end: `{ "len_mm": 300, "dir": "-z" }`.
A **station** is `{ "bar", "at_mm", "from": "a"|"b", "face": "+x"|"-x"|"+y"|"-y" or "groove":
"+y.1", "off_mm": [u, v] }`; `bar` may name a run.

**Bars**: `{ "item", "opt": { "finish": "black" }, "a", "b", "anchor", "off_mm", "roll_deg",
"up", "ends", "ops", "holes" }`. The bar's local z runs from a to b; local y is world +Z with
the axis removed (world +Y for a vertical bar), local x = y × z:

| Bar runs along | local x | local y |
|---|---|---|
| +X | +Y | +Z |
| −X | −Y | +Z |
| +Y | −X | +Z |
| up (+Z) | +X | +Y |

`anchor` names the section point that sits on the design line: `c`, a face `+x`, a corner
`-x-y`, or a section datum (`mount`). So a 40 × 40 rail drawn along +X at `y = 0`, `z = H` with
anchor `-x+y` lies at `y` from 0 to 40 with its top face at `H`. `roll_deg` turns the section
about the axis.

**Ends.** Every bar end has exactly one end plane from one provider: a connection that claims
it, or `ends.<a|b>.plane` (`{ "point", "normal" }`, `{ "face": { "bar", "face" } }`,
`{ "of": "b2.a" }`), else square at its design point. An angled plane needs `"cut": "angle"`
or `"square"`; `extend_mm` lengthens an end.

**Connections**:

| `type` | What it does |
|---|---|
| `butt` | `ends` stop on a face of `through` (a bar, a bar's end `"b7.b"`, or a body); `connector`, `qty`, `spacer_mm`, or a `stack` of bars between the face and the end (an end plate, a packer: each drilled where the connector's screw passes it, and held by that screw; not with a spacer). A plain solid through bar is held by a screw through a drilled hole into the butting end's tap. An end face that reaches past its face is a warning (a connector's `overhang_mm`, else `defaults.butt.overhang_mm`, allows more); a bar that goes into the body it bears on, an error. A connector's hole in a block's end for a screw into the butting bar's tap follows the screw's axis, and is an error where the screw leaves the block |
| `miter` | two ends cut on the bisector plane |
| `splice` | two collinear ends joined end to end; `gap_mm`; a run lists the pieces |
| `pivot` | a hinge on a `base` station; the carried ends' points are `{ "pivot": "<this id>" }` |
| `face` | layers held face to face (`bars`, head to nut): `fastening` `none`, `bolt`, `tnut`, `screw` or `blind` (a blind fastener: its item's `hole_mm` in every layer and only the near wall of a hollow last one, its grip within `grip_min_mm` to `grip_max_mm`), a `fastener`, a `stack`, and `stations` (`at_mm`, `across_mm`, `rail_holes`). A head or nut on less than half its seat (over a groove's opening, off the face) is a `fit` warning, on none an error; a washer in the stack (the first under the head, the next under the nut) widens it |

A face connection never moves or cuts a bar; it checks contact and generates holes and hardware.
A sleeve in its `stack` (`{ "item", "inside": "<hollow layer>", "len_mm": "bore" }`) clears the
holes it passes by ISO 273 medium for its outside diameter, or by `clearance_mm` over it. It
stands on the nut-side wall's inner face; with `"walls": "both"` it starts at that wall's outer
face, so `"bore + 2 * sec(<layer>).t_mm"` passes both walls, flush (a crush sleeve).

A connector fits a butting bar by its system, and the through bar by its system or by the
sleeve one of its mounts sets in the through bar's bore (an RHS or a tube). A hole a connector
requires in the through bar of a butt through that bar's end goes into the end face, along its
axis.

A hole in the butting bar's side (a quick connector's cross hole) goes in from a face no other
member stands in front of, within its tool's room (30 mm). A connection may name that face per
butting end, `"hole_faces": { "b2.a": "+x" }`, or per hole by the position its connector gives,
`{ "b2.a": [{ "at_mm": [20, 20], "face": "+x" }] }`, over the catalog's choice; a covered named
face is a `connection` error. A bar or part put in place after the frame's joints are made (a
wall the frame is set against, a panel fitted last) takes `"after_assembly": true`: it does not
block the tool when the joints are made, and a hole only it covers is a warning (the joint cannot
be re-tightened once it is there).

**Parts** sit on a station (`"on"`, with `roll_deg`), at a world pose
(`"at": { "pos", "rot_deg" }`), or are unplaced lines (`"qty", "unplaced": true, "why"`), counted
and priced but not drawn. **Patterns** repeat a `template` along a bar, a run or a `dir`, by
`pitch_mm` and `count` or `offsets_mm`, with `skip`; copies stay live. **Runs** name spliced
bars in order.

**Project items** (`"items": { "<id>": … }`, named `project:<id>` by parts) are what no catalog
holds: a `plate` (`material`, `thickness_mm`, an `outline` of `[x, y]` corners, `holes`), a
`bent-angle` (`legs_mm` to the outside, `length_mm`, `bend_radius_mm`, the shop's `k_factor`,
`holes` per leg `a` and `b`), a `generic` item and a `placeholder` (a `bbox_mm` not chosen yet,
which other bars may bear on and which blocks its own order line). A hole is `{ "at": [x, y] }`
with `d_mm` or a `thread` (`"M6"`), and `csk`, `cbore` or `depth_mm`. A plate's or angle's mass
comes from its material; `alukit machining` lists each one's holes from its datum, with an
angle's blank.

**Variants** (`"variants": { "default": "standard", "list": { "standard": {}, "tall": {
"params": { "H": 900 }, "swap": { "<item>": "<item>" } } } }`) override params and swap items.
An entity with `"only_in": ["tall"]` exists only in those variants (and not in the document
without a variant); `"not_in"` leaves it out of them. A connection naming a bar its variant
leaves out drops that end (an info); a point or part on a left-out bar is an error: scope it
too. With no `--variant`, the outputs use `variants.default`.

**Checks** are `{ "value", "op", "limit", "text", "severity" }` or `{ "expr", "text" }`, and
may read the model: `len(b3)`, `cut(b3)`, `pos(n3).z`, `dist(n1, n2)`, `bbox().z`, `mass()`,
`cost()`, `cost(high)`, `count(tag:leg)`. `alukit check` reports each one's margin.

**Buying.** `costs` are lines that are not parts (machining, labour, freight, contingency);
they take `only_in` and `not_in` like entities, and `covers` prices generated work as a whole
(`"services_on": [{ "supplier": "a" }, { "supplier": "b" }]` for one job on two suppliers' bars).
`price_bands` give catalog prices a low and a high; `order` chooses an offer per item; `open`
items with `"blocks": "order"` hold the order of their scope's suppliers.

## Workflow

1. `alukit new <dir> --catalog <id|path>… --currency <code>`: the document, its lock, a
   `.gitignore` line for `.alukit/`.
2. Params first, then bars, then connections, parts and patterns, with `alukit do`. Write
   positions from params so a change of size is one edit.
3. `alukit check <dir>` after each batch; `alukit query <dir> <selector>` to read entities back
   (`b7`, `tag:leg`, `connections of b2`, `item:forseti:PF40-01`).
4. Outputs: `alukit cutlist`, `bom`, `order`, `costs` (`--format md|csv|json`), `machining`
   (`--format md|json`), and `alukit derive --json` for the full model. Read them; do not
   recompute them.
5. Options as variants; compare them with `alukit diff <dir> --variant a --variant b`.
6. Publish: `alukit revision save <dir> "<name>"` stores the document, the lock and every
   output; `alukit revision verify <dir> "<name>"` re-derives it and exits 1 on any drift.
   `alukit diff git:<ref>:<dir> <dir>` shows what moved since a commit, each side with its own
   lock.
7. `alukit snapshot <dir> -o <file>.png --view iso` to see what you built: a PNG of a standard
   view (`iso`, `top`, `front`, `side`, `left`, `back`, `bottom`) or one the document names, drawn
   in headless Chromium the same way every time. Look at it after a batch that moves things.
8. `alukit export glb <dir> -o <file>.glb` for a 3D model (Y up, metres; each node named
   `<id> <label|item>`, with its item, SKU, options and cut length in `extras`; a project
   plate's or bent angle's holes are its node's children).

When a server runs for the project (`alukit serve`), `do` and `add` go through it and the open
tabs follow; nothing else changes.

## Worked example: a work table

A 1000 × 600 table frame, 750 high, from 40 × 40 profile in the built-in `forseti` catalog:
four legs, four top rails butted between them with brackets, and a taller variant with shelf
rails. Run it in an empty folder.

<!-- worked example: a test runs every command below as written -->
```sh
alukit new table --name "Work table" --catalog forseti --currency BRL

# Sizes first: every position below is written from them.
alukit do table '[
  {"cmd": "setParam", "args": {"name": "W", "value": 1000}},
  {"cmd": "setParam", "args": {"name": "D", "value": 600}},
  {"cmd": "setParam", "args": {"name": "H", "value": 750}}
]'

# Legs b1-b4, inside the W x D rectangle; top rails b5-b8, top faces flush at H.
alukit do table '[
  {"cmd": "addBar", "args": {"item": "forseti:PF40-01", "opt": {"finish": "anodised"}, "a": [0, 0, 0], "b": [0, 0, "H"], "anchor": "-x-y", "tags": ["leg"]}},
  {"cmd": "addBar", "args": {"item": "forseti:PF40-01", "opt": {"finish": "anodised"}, "a": ["W", 0, 0], "b": ["W", 0, "H"], "anchor": "+x-y", "tags": ["leg"]}},
  {"cmd": "addBar", "args": {"item": "forseti:PF40-01", "opt": {"finish": "anodised"}, "a": [0, "D", 0], "b": [0, "D", "H"], "anchor": "-x+y", "tags": ["leg"]}},
  {"cmd": "addBar", "args": {"item": "forseti:PF40-01", "opt": {"finish": "anodised"}, "a": ["W", "D", 0], "b": ["W", "D", "H"], "anchor": "+x+y", "tags": ["leg"]}},
  {"cmd": "addBar", "args": {"item": "forseti:PF40-01", "opt": {"finish": "anodised"}, "a": [0, 0, "H"], "b": ["W", 0, "H"], "anchor": "-x+y", "label": "front rail"}},
  {"cmd": "addBar", "args": {"item": "forseti:PF40-01", "opt": {"finish": "anodised"}, "a": [0, "D", "H"], "b": ["W", "D", "H"], "anchor": "+x+y", "label": "back rail"}},
  {"cmd": "addBar", "args": {"item": "forseti:PF40-01", "opt": {"finish": "anodised"}, "a": [0, 0, "H"], "b": [0, "D", "H"], "anchor": "+x+y", "label": "left rail"}},
  {"cmd": "addBar", "args": {"item": "forseti:PF40-01", "opt": {"finish": "anodised"}, "a": ["W", 0, "H"], "b": ["W", "D", "H"], "anchor": "-x+y", "label": "right rail"}}
]'

# The rails butt into the legs, two brackets at each rail end.
alukit do table '[
  {"cmd": "addConnection", "args": {"type": "butt", "through": "b1", "ends": ["b5.a", "b7.a"], "connector": "forseti:CT75-06", "qty": 2}},
  {"cmd": "addConnection", "args": {"type": "butt", "through": "b2", "ends": ["b5.b", "b8.a"], "connector": "forseti:CT75-06", "qty": 2}},
  {"cmd": "addConnection", "args": {"type": "butt", "through": "b3", "ends": ["b6.a", "b7.b"], "connector": "forseti:CT75-06", "qty": 2}},
  {"cmd": "addConnection", "args": {"type": "butt", "through": "b4", "ends": ["b6.b", "b8.b"], "connector": "forseti:CT75-06", "qty": 2}}
]'
alukit check table
alukit cutlist table

# A taller option with shelf rails, scoped to it; a check that holds in both.
alukit do table '[
  {"cmd": "addVariant", "args": {"name": "standard", "variant": {}, "default": true}},
  {"cmd": "addVariant", "args": {"name": "tall", "variant": {"params": {"H": 900}}}},
  {"cmd": "addBar", "args": {"item": "forseti:PF40-01", "opt": {"finish": "anodised"}, "a": [0, 0, 150], "b": ["W", 0, 150], "anchor": "-x+y", "label": "front shelf rail", "only_in": ["tall"]}},
  {"cmd": "addBar", "args": {"item": "forseti:PF40-01", "opt": {"finish": "anodised"}, "a": [0, "D", 150], "b": ["W", "D", 150], "anchor": "+x+y", "label": "back shelf rail", "only_in": ["tall"]}},
  {"cmd": "addConnection", "args": {"type": "butt", "through": "b1", "ends": ["b9.a"], "connector": "forseti:CT75-06", "qty": 2, "only_in": ["tall"]}},
  {"cmd": "addConnection", "args": {"type": "butt", "through": "b2", "ends": ["b9.b"], "connector": "forseti:CT75-06", "qty": 2, "only_in": ["tall"]}},
  {"cmd": "addConnection", "args": {"type": "butt", "through": "b3", "ends": ["b10.a"], "connector": "forseti:CT75-06", "qty": 2, "only_in": ["tall"]}},
  {"cmd": "addConnection", "args": {"type": "butt", "through": "b4", "ends": ["b10.b"], "connector": "forseti:CT75-06", "qty": 2, "only_in": ["tall"]}},
  {"cmd": "addCheck", "args": {"check": {"value": "bbox().z", "op": "<=", "limit": 1000, "text": "fits under a 1 m shelf"}}}
]'
alukit check table --variant tall
alukit cutlist table --variant tall
alukit bom table
alukit order table
alukit diff table --variant standard --variant tall

# Publish, verify, export the default variant, and look at it.
alukit revision save table "Rev A"
alukit revision verify table "Rev A"
alukit export glb table -o table/exports/table.glb
alukit snapshot table -o table/exports/table.png --view iso
```
<!-- end of the worked example -->

What it gives:

- `alukit check table`: no errors.
- `alukit cutlist table`: forseti:PF40-01, finish anodised, cut by the supplier: 4 × 750.00
  (b1–b4), 2 × 920.00 (b5, b6: W less two legs), 2 × 520.00 (b7, b8).
- `--variant tall`: the legs are 900.00, and two shelf rails of 920.00 (b9, b10) join the cut
  list; check C1 passes with a margin of 100.
- `alukit diff`: H 750 → 900, the legs' cut lengths, b9, b10 and their butts added, and the
  BOM, order lines and totals that follow.
- `alukit revision verify`: zero drift in 2 variants.
- `alukit snapshot`: `table/exports/table.png`, 1600 × 1000, the table seen from the front
  right, above.

## Reference

<!-- generated reference: do not edit by hand; `pnpm skill` rewrites it from the code -->

### CLI

```text
alukit serve <dir> [--port N] [--no-open]
    run the project's server: tabs and the CLI edit through it; opens the app
alukit undo | redo <dir> [--as <name>|agent:<name>] [--json]
    take back the latest step, whoever made it, or apply again the last one taken back
alukit log <dir> [--json]
    the server's log: every step, undo and redo, with its source
alukit derive <dir> [--json] [--select <paths>] [--variant v] [--frozen]
    the derived model: frames, end planes, cut lengths and angles, parts, rail holes,
    fastenings, generated machining and hardware (alukit.derived/1); --select answers
    JSON with only the members named, e.g. bars.*.cut_mm,params (* is every member)
alukit cutlist <dir> [--format md|csv|json] [--variant v] [--frozen]
    the cut list: pieces grouped per item and option, ordered or nested into stock
alukit bom <dir> [--format md|csv|json] [--variant v] [--frozen]
    the bill of materials: every item and quantity, grouped by kind, with mass
alukit order <dir> [--format md|csv|json] [--as-of YYYY-MM-DD] [--variant v] [--frozen]
    the order list per supplier, READY or BLOCKED with every reason, and the totals;
    exits 1 when any supplier is blocked (prices older than 30 days before --as-of,
    today by default, are stale)
alukit costs <dir> [--format md|csv|json] [--as-of YYYY-MM-DD] [--variant v] [--frozen]
    the cost lines and the low, likely and high totals, with their provenance
alukit machining <dir> [--format md|json] [--variant v] [--frozen]
    the machining sheet: each custom plate's and bent angle's holes from its datum,
    with its blank; the cut-list lines that carry the bars' machining
    (--variant v: derive that variant; without it, the project's default variant)
alukit new <dir> [--name <name>] [--catalog <id|path>]... [--currency <code>]
    create a project: alukit.json, alukit.lock.json and a .gitignore line for .alukit/
alukit check <dir> [--json] [--variant v] [--frozen]
    validate, derive and run the checks; exit 1 on an error
alukit problems <dir> [--json] [--variant v] [--as-of YYYY-MM-DD]
    the check and the order's reasons as one list in words, grouped by what they hold up,
    each with its fixes (alukit.problems/1); exit 1 when one blocks the order or is an error
alukit arrangements <dir> --at x,y,z [--at x,y,z]... [--rule vertical|x|y|first|miter|splice]... [--json]
    where bar ends meet at those points, each corner rule's arrangement: which bar runs
    through and the cut lengths it gives, and the batch that applies it; then a miter's and
    a splice's of a corner's two ends, or why derive refuses one; writes nothing
alukit do <dir> '<json>' | -f <file> | -  [--json] [--as <name>|agent:<name>] [--dry-run]
    apply a batch of commands atomically, from an argument, a file or stdin; --dry-run
    writes nothing and says what the step would do: diagnostics, ids, cut lengths that move
alukit add bar|point|connection|part|frame <dir> [options] [--json]
    add one entity, or a box frame in one step, as sugar over `do`; `alukit add <what> --help`
    lists the options
alukit move <dir> --ids <id,id,...> --by <dx,dy,dz> [--detach] [--dry-run] [--json] [--as <name>]
    move nodes, bars, runs, parts or a pattern's template by an offset, as sugar over `do`
    (`transform`); joined ends follow, or --detach frees them; expressions keep their params
alukit rotate <dir> --ids <id,id,...> --axis x|y|z --deg <deg> --about <x,y,z> [--detach] [--dry-run] [--json] [--as <name>]
    turn them about a world axis through a point (`transform`); exact at multiples of 90°
alukit query <dir> <selector> [--fields a,b] [--limit n] [--summary] [--json]
    entities by id, kind, tag:<t>, item:<ref>, `<kind> of <id>`, like:<id> (its kind, item and
    options), or connected:<ids> (the bars joined to them; connected*: the whole assembly);
    bounded output
alukit fmt <dir>... [--check]
    rewrite alukit.json and alukit.lock.json into canonical form; --check: exit 1 if one would change
alukit lock update <dir> [--item <id>]... [--dry-run] [--json]
    refresh alukit.lock.json from the live catalogs; print the changes and their effect on cut lengths
alukit diff <a> [<b>] [--variant v]... [--as-of YYYY-MM-DD] [--format md|json]
    what moved between two sides: entities, cut lengths, BOM and order lines, prices and
    totals, and the lock. A side is a project folder or its alukit.json, a revision file,
    rev:<name> (a revision of the project here), or git:<ref>:<path>; each derives with
    its own lock. One side and two --variant compare two variants of it
alukit revision save [<dir>] <name> [--as-of YYYY-MM-DD] [--frozen] [--json]
alukit revision list [<dir>] [--json]
alukit revision show [<dir>] <name> [--variant v]
                     [--output derive|cutlist|bom|order|costs|machining|check]
                     [--format md|csv|json]
alukit revision verify [<dir>] <name> [--json]
    revisions/<name>.json: the document, its lock, the outputs of every variant and a
    stamp; show prints what was stored; verify re-derives it and exits 1 on any drift
    (<dir> defaults to the current folder)
alukit snapshot <dir> -o <file.png> [--view <name>] [--size <w>x<h>] [--theme dark|light]
    render a view to PNG in headless Chromium, on the running server or an ephemeral one:
    a view the document names, or iso, top, front, side, left, back, bottom (1600x1000, iso)
alukit export glb <dir> -o <file.glb> [--variant v] [--frozen]
    the model as binary glTF: Y up, metres, one node per bar, part and fastener, each
    named <id> <label|item> with its id, item, SKU, options and cut length in extras;
    a project plate's or bent angle's holes are its node's children (<part>.<hole> <rod>)
alukit skill install [--dir <skills folder>]
    link the agent skill into ~/.claude/skills/alukit (refuses to replace another target)
alukit catalog check <path|id> [--catalog <dir>]... [--json]
    computed against published, references, overrides, family collisions, offers
alukit catalog show <catalog>:<item> [--catalog <dir>]...
    the merged item as JSON: fields with their sources, corrections, section, offers
alukit catalog search <query> [--kind <kind>] [--prefer <kind>] [--catalog <id|dir>]... [--limit n] [--json]
    items whose id, code, name or family hold every word, ranked: exact id or code first,
    then bars of a size the query writes (40x40), then whole words; --prefer ranks a kind
    first within each; every built-in catalog unless --catalog names some; 20 items unless
    --limit (200 at most)
alukit catalog schema [catalog|offers|section|family|overrides|item]
    the JSON Schema of a catalog file (all of them without a name)
alukit catalog import forseti [--snapshot <dir>] [--pdf <file>] [--python <path>] [--out <dir>] [--fetch]
    run the vendor's importer on a shop snapshot and its catalogue PDF (importers/forseti);
    says what is missing instead; reads the network only with --fetch (a new snapshot)
```

### Edit commands

Each is `{ "cmd": "<name>", "args": { … } }` in `alukit do`. A `set…` command's `set`
is a merge patch (`null` removes a field). Types: `expr` is a number or an expression
string; `<…>` is a string of that form; `?` marks an optional field.

- **`setProject`** (project): change the project's name, catalogs, currency, price basis, fx, defaults or order rules: a merge patch, one step
  - `name` (optional): `string | null` — the project's name
  - `catalogs` (optional): `[string, …] | null` — the whole list, in merge order (§3.1): built-in ids, or folders inside the project (./parts)
  - `currency` (optional): `string | null` — the project's currency, a 3-letter code (BRL)
  - `price_basis` (optional): `"regular" | "sale" | "lowest" | null` — regular, sale or lowest (§4.11)
  - `fx` (optional): `{ <key>: number | { v: number, src?: "src" | "meas" | "est" | "calc", ref?: string, read?: string, note?: string } | null } | null` — exchange rates by currency (§4.11): { EUR: 6.2 }; null removes one
  - `defaults` (optional): `{ bar?: { item?: <a catalog item: "<catalog>:<code>"> | null, opt?: { <key>: string | null } | null } | null, butt?: { connector?: <a catalog item: "<catalog>:<code>"> | null, qty?: integer | null, overhang_mm?: number | null } | null, cutting?: { kerf_mm?: number | null, trim_mm?: number | null } | null, corner?: "vertical" | "x" | "y" | "first" | null } | null` — bar { item, opt }, butt { connector, qty, overhang_mm }, cutting { kerf_mm, trim_mm }, corner (vertical, x, y or first); null removes
  - `order_rules` (optional): `{ <key>: "block" | "warn" | "off" | null } | null` — an order rule's action, block, warn or off (§5.5); null restores its default
- **`addNode`** (structure): add a named point that several entities share
  - `at` (optional): `[expr, expr, expr]` — a point: [x, y, z], numbers or expressions
  - `on` (optional): `{ bar: <a bar: b<number>> | <a run: r<number>>, at_mm: expr, from?: "a" | "b" | "a.cut" | "b.cut", face?: "+x" | "-x" | "+y" | "-y", groove?: <a groove: "+y.1", numbered by increasing section coordinate>, off_mm?: [expr, expr] }` — a point on a bar or run, which follows it (§4.3)
  - `pivot` (optional): `string` — a pivot connection's point
  - `label` (optional): `string`
  - `tags` (optional): `[string, …]`
  - `only_in` (optional): `[string, …]`
  - `not_in` (optional): `[string, …]`
- **`moveNode`** (structure): move a node to a point, onto a bar, or by an offset; what uses it follows
  - `id`: `string` — a node: n<number>
  - `at` (optional): `[expr, expr, expr]` — the new point
  - `on` (optional): `{ bar: <a bar: b<number>> | <a run: r<number>>, at_mm: expr, from?: "a" | "b" | "a.cut" | "b.cut", face?: "+x" | "-x" | "+y" | "-y", groove?: <a groove: "+y.1", numbered by increasing section coordinate>, off_mm?: [expr, expr] }` — a point on a bar or run
  - `pivot` (optional): `string` — a connection: c<number>
  - `by` (optional): `[number, number, number]` — move by [dx, dy, dz] mm
- **`addBar`** (structure): add a bar of any bar item between two points (§4.4)
  - `item` (optional): `string` — a bar item; defaults.bar.item when absent
  - `opt` (optional): `{ <key>: string }` — option values: { finish: black }
  - `a`: `<a node: n<number>> | [expr, expr, expr] | { on: { bar: <a bar: b<number>> | <a run: r<number>>, at_mm: expr, from?: "a" | "b" | "a.cut" | "b.cut", face?: "+x" | "-x" | "+y" | "-y", groove?: <a groove: "+y.1", numbered by increasing section coordinate>, off_mm?: [expr, expr] } } | { pivot: <a connection: c<number>> }`
  - `b`: `<a node: n<number>> | [expr, expr, expr] | { on: { bar: <a bar: b<number>> | <a run: r<number>>, at_mm: expr, from?: "a" | "b" | "a.cut" | "b.cut", face?: "+x" | "-x" | "+y" | "-y", groove?: <a groove: "+y.1", numbered by increasing section coordinate>, off_mm?: [expr, expr] } } | { pivot: <a connection: c<number>> } | { len_mm: expr, dir: "+x" | "-x" | "+y" | "-y" | "+z" | "-z" | [expr, expr, expr], from?: "a.cut" }`
  - `anchor` (optional): `string` — "c", a face "+x", a corner "-x-y", or a section datum "mount"
  - `off_mm` (optional): `[expr, expr]` — [dx, dy] along the section's own x and y
  - `roll_deg` (optional): `expr`
  - `up` (optional): `"+x" | "-x" | "+y" | "-y" | "+z" | "-z" | [expr, expr, expr]`
  - `ends` (optional): `{ a?: { plane?: {point, normal} | {face} | {of}, cut?: "angle" | "square", extend_mm?: expr }, b?: { plane?: {point, normal} | {face} | {of}, cut?: "angle" | "square", extend_mm?: expr } }`
  - `ops` (optional): `[{ op: "hole", face: "+x" | "-x" | "+y" | "-y", at_mm: expr, from?: "a" | "b", d_mm?: expr, thread?: string, depth_mm?: expr, csk?: {d_mm, angle_deg}, cbore?: {d_mm, depth_mm} }, …]`
  - `holes` (optional): `{ factory: "a" | "b", stock_mm?: number } | { drilled: true } | { E_a_mm: expr } | { E_b_mm: expr }` — rails: the hole layout
  - `after_assembly` (optional): `true` — placed after the frame's joints are made (a wall it is set against, a panel fitted last): it does not cover a cross hole while a joint made before it is tightened, only afterwards (a warning)
  - `label` (optional): `string`
  - `tags` (optional): `[string, …]`
  - `only_in` (optional): `[string, …]` — variants that include it (§4.10)
  - `not_in` (optional): `[string, …]` — variants that exclude it (§4.10)
- **`setBar`** (structure): change a bar's fields (item, points, anchor, roll, ends, ops, …)
  - `id`: `string` — the entity to change
  - `set`: `{ <key>: any }` — fields to change, as a JSON merge patch (RFC 7396): null removes a field
- **`moveEnd`** (structure): move one end of a bar along its own axis (to a length, a cut length, by a distance, or onto another bar); the other end stays
  - `end`: `string` — the bar end to move, along its bar's axis; the other end stays
  - `len_mm` (optional): `expr` — the bar's new design length, from the other end's design point; an expression over params keeps them on a bar along a world axis
  - `cut_mm` (optional): `expr` — the bar's new cut length: the end moves so the cut is this long, its plane being its own default after the move; an expression over params is kept, the design length written as it plus the ends' allowance (`W + 20`)
  - `by_mm` (optional): `number` — move the end outward by this much; negative shortens
  - `to` (optional): `string` — a bar, or a bar's end: the end goes where its axis meets that bar's design line, or to that end's design point
  - `detach` (optional): `boolean` — free an end that a node, a station, another bar's end or a butt holds: write it as coordinates and drop it from its butt (the butt goes with its last end)
- **`transform`** (structure): move or turn nodes, bars, runs, parts and pattern templates as one step, keeping or freeing what joins them to the rest
  - `ids`: `[string, …]` — the nodes, bars, runs, parts, patterns (their templates) and connections to move
  - `by` (optional): `[expr, expr, expr]` — [dx, dy, dz]: move by this; an expression over params is kept (W moved by D is W + D)
  - `rotate` (optional): `{ axis: "x" | "y" | "z", deg: number, about: [number, number, number] }` — turn about a world axis through a point; exact at multiples of 90°
  - `joined` (optional): `"follow" | "detach"` — what joins the moved set to the rest: follow (default) keeps each joint, the rest's joined ends sliding along their own bars to stay on what moved, or refuses naming the joint it would break; detach frees them
- **`reverseBar`** (structure): swap a bar's ends and rewrite anchor, offset, roll and every reference, so the body stays
  - `id`: `<a bar: b<number>> | <a run: r<number>>` — a bar, or a run: every bar of it, and its order
- **`splitBar`** (structure): split a bar in two at a distance from end a, optionally adding a splice and the run
  - `id`: `string` — a bar: b<number>
  - `at_mm`: `number` — where to split, from end a's design point
  - `splice` (optional): `true | { connector?: <a catalog item: "<catalog>:<code>">, gap_mm?: expr }` — add a splice connection between the pieces; always added when they are in a run, which needs it
  - `run` (optional): `true` — make the pieces a run (a bar in a run gains the new piece anyway)
- **`addFrame`** (structure): add a box frame as one step: four posts, base and top rings and an optional shelf ring, outside faces flush with the size, butted at every corner by the corner rule
  - `at` (optional): `[number, number, number]` — the frame's corner with the least x, y and z; [0, 0, 0] when absent
  - `size`: `[number, number, number]` — [W, D, H]: the outside size along x, y and z, mm
  - `item` (optional): `string` — the bars' item; defaults.bar.item when absent
  - `opt` (optional): `{ <key>: string }` — its options, { finish: anodised }; defaults.bar.opt when absent
  - `corner` (optional): `"vertical" | "x" | "y" | "first"` — which bar runs through at each corner: vertical, x, y or first; defaults.corner when absent, else vertical
  - `rings` (optional): `["base" | "top", …]` — the rings, ["base", "top"] when absent
  - `shelf_mm` (optional): `number` — a shelf ring, its top face this high above the frame's base
  - `connector` (optional): `string` — each butt's connector; defaults.butt.connector when absent
  - `qty` (optional): `integer` — connectors per butting end
  - `params` (optional): `boolean` — write W, D and H as params, and the frame's points from them
- **`addRun`** (structure): name a line of spliced bars, so stations and patterns can span its joints
  - `bars`: `[<a bar: b<number>>, …]` — collinear bars joined by splices, in order, all a → b (§4.3)
  - `label` (optional): `string`
  - `tags` (optional): `[string, …]`
  - `only_in` (optional): `[string, …]`
  - `not_in` (optional): `[string, …]`
- **`setRun`** (structure): change a run's bars, label or tags
  - `id`: `string` — the entity to change
  - `set`: `{ <key>: any }` — fields to change, as a JSON merge patch (RFC 7396): null removes a field
- **`removeEntity`** (structure): remove an entity; refused while anything refers to it, unless cascade
  - `id`: `string` — any entity: n1, b7, r1, c3, p4, pt1, K1, C1, O1, D1, or project:<item>
  - `cascade` (optional): `boolean` — also remove what refers to it, and drop it from lists that can lose it
- **`addConnection`** (connections): add a butt, miter, splice, pivot or face connection (§4.5)
  - `{ type: "butt", through: <a bar: b<number>> | <a bar end: "b7.a" or "b7.b"> | { body: <a catalog item: "<catalog>:<code>">, at: <a node: n<number>> | [expr, expr, expr] | {on} | {pivot} | {pos, rot_deg?} }, ends: [<a bar end: "b7.a" or "b7.b">, …], spacer_mm?: expr, stack?: [<a bar: b<number>>, …], through_end?: "cover" | "node" | "none" | { end: "a" | "b", mode: "cover" | "node" }, held_by?: <a butt through the same bar whose through-fastener holds these ends too: c<number>>, hole_faces?: { <key>: "+x" | "-x" | "+y" | "-y" | [{at_mm, face}, …] }, connector?: <a catalog item: "<catalog>:<code>">, qty?: integer, label?: string, tags?: [string, …], only_in?: [string, …], not_in?: [string, …] }`
  - `{ type: "miter", ends: [<a bar end: "b7.a" or "b7.b">, <a bar end: "b7.a" or "b7.b">], hole_faces?: { <key>: "+x" | "-x" | "+y" | "-y" | [{at_mm, face}, …] }, connector?: <a catalog item: "<catalog>:<code>">, qty?: integer, label?: string, tags?: [string, …], only_in?: [string, …], not_in?: [string, …] }`
  - `{ type: "splice", ends: [<a bar end: "b7.a" or "b7.b">, <a bar end: "b7.a" or "b7.b">], gap_mm?: expr, hole_faces?: { <key>: "+x" | "-x" | "+y" | "-y" | [{at_mm, face}, …] }, connector?: <a catalog item: "<catalog>:<code>">, qty?: integer, label?: string, tags?: [string, …], only_in?: [string, …], not_in?: [string, …] }`
  - `{ type: "pivot", base: { bar: <a bar: b<number>> | <a run: r<number>>, at_mm: expr, from?: "a" | "b" | "a.cut" | "b.cut", face?: "+x" | "-x" | "+y" | "-y", groove?: <a groove: "+y.1", numbered by increasing section coordinate>, off_mm?: [expr, expr] }, axis: "along" | "across", ends: [<a bar end: "b7.a" or "b7.b">, …], hole_faces?: { <key>: "+x" | "-x" | "+y" | "-y" | [{at_mm, face}, …] }, connector: <a connector with pivot geometry>, qty?: integer, label?: string, tags?: [string, …], only_in?: [string, …], not_in?: [string, …] }`
  - `{ type: "face", bars: [<a bar: b<number>> | <a run: r<number>> | <a part: p<number>>, …], gaps_mm?: [expr, …], faces?: [["+x" | "-x" | "+y" | "-y", "+x" | "-x" | "+y" | "-y"], …], fastening: "none" | "bolt" | "tnut" | "screw" | "blind", fastener?: <a catalog item: "<catalog>:<code>"> | { bar: <a catalog item: "<catalog>:<code>">, len_mm: expr }, stack?: [<a catalog item: "<catalog>:<code>"> | {item, qty?} | {item, inside, walls?, len_mm, clearance_mm?}, …], stations?: { at_mm?: [expr, …], across_mm?: [expr, …], rail_holes?: true | {along, every?, plus?}, pattern?: <a pattern: pt<number>> }, tap_depth_mm?: expr, connector?: <a catalog item: "<catalog>:<code>">, qty?: integer, label?: string, tags?: [string, …], only_in?: [string, …], not_in?: [string, …] }`
- **`setConnection`** (connections): change a connection's fields; its type may change when the result is valid
  - `id`: `string` — the entity to change
  - `set`: `{ <key>: any }` — fields to change, as a JSON merge patch (RFC 7396): null removes a field
- **`autoConnect`** (connections): add the default butt where bar ends meet: through the bar passing the point, else as prefer says (a vertical, else the lowest id, by default), else through the bar a joined corner's butt runs through; an end cut at an angle declares it
  - `at` (optional): `<a node: n<number>> | [expr, expr, expr]` — the point where the draw tool closed
  - `end` (optional): `string` — or a bar end, at its design point
  - `connector` (optional): `string` — defaults.butt.connector when absent
  - `qty` (optional): `integer`
  - `prefer` (optional): `"vertical" | "x" | "y" | "first"` — which bar runs through, when none passes the point: vertical, x, y or first; defaults.corner when absent, else vertical
  - `optional` (optional): `boolean` — do nothing, rather than refuse, when nothing butts at the point (the draw tool sends one for each end of a bar it adds)
- **`addPart`** (parts and patterns): place a part on a station or at a world pose, or add an unplaced line (§4.7)
  - `{ item: <a catalog item: "<catalog>:<code>">, opt?: { <key>: string }, on: { bar: <a bar: b<number>> | <a run: r<number>>, at_mm: expr, from?: "a" | "b" | "a.cut" | "b.cut", face?: "+x" | "-x" | "+y" | "-y", groove?: <a groove: "+y.1", numbered by increasing section coordinate>, off_mm?: [expr, expr] }, roll_deg?: expr, after_assembly?: true, label?: string, tags?: [string, …], only_in?: [string, …], not_in?: [string, …] }`
  - `{ item: <a catalog item: "<catalog>:<code>">, opt?: { <key>: string }, at: { pos: [expr, expr, expr], rot_deg?: [expr, expr, expr] }, after_assembly?: true, label?: string, tags?: [string, …], only_in?: [string, …], not_in?: [string, …] }`
  - `{ item: <a catalog item: "<catalog>:<code>">, opt?: { <key>: string }, qty: expr, unplaced: true, why: string, label?: string, tags?: [string, …], only_in?: [string, …], not_in?: [string, …] }`
- **`setPart`** (parts and patterns): change a part's fields
  - `id`: `string` — the entity to change
  - `set`: `{ <key>: any }` — fields to change, as a JSON merge patch (RFC 7396): null removes a field
- **`addPattern`** (parts and patterns): repeat entities along a bar, a run or a direction; copies stay live (§4.7)
  - `template`: `[<a node: n<number>> | <a bar: b<number>> | <a connection: c<number>> | <a part: p<number>>, …]`
  - `along`: `<a bar: b<number>> | <a run: r<number>> | { dir: [expr, expr, expr] }`
  - `pitch_mm` (optional): `expr`
  - `count` (optional): `integer`
  - `offsets_mm` (optional): `[expr, …]` — instead of pitch_mm and count
  - `skip` (optional): `[integer, …]` — copy numbers k to leave out
  - `rail_holes` (optional): `true | { along: <a bar: b<number>> | <a run: r<number>>, every?: integer, plus?: ["first" | "last" | "joint", …] }`
  - `label` (optional): `string`
  - `tags` (optional): `[string, …]`
  - `only_in` (optional): `[string, …]` — variants that include it (§4.10)
  - `not_in` (optional): `[string, …]` — variants that exclude it (§4.10)
- **`setPattern`** (parts and patterns): change a pattern: pitch, count, offsets, skips, template
  - `id`: `string` — the entity to change
  - `set`: `{ <key>: any }` — fields to change, as a JSON merge patch (RFC 7396): null removes a field
- **`explodePattern`** (parts and patterns): turn a pattern's copies into ordinary entities, so one can be edited on its own
  - `id`: `string` — a pattern: pt<number>
- **`mirror`** (parts and patterns): copy entities as their mirror image in a plane square to a world axis, as ordinary entities
  - `ids`: `[string, …]` — the nodes, bars, runs, connections and parts to mirror
  - `plane`: `{ axis: "x" | "y" | "z", at_mm: number }` — the mirror plane: square to a world axis, at a coordinate along it
- **`array`** (parts and patterns): copy entities at a pitch along a bar, run or direction, as ordinary entities (§4.7)
  - `ids`: `[string, …]` — the nodes, bars, connections and parts to copy
  - `along`: `<a bar: b<number>> | <a run: r<number>> | { dir: [expr, expr, expr] }`
  - `pitch_mm` (optional): `expr`
  - `count` (optional): `integer`
  - `offsets_mm` (optional): `[expr, …]` — instead of pitch_mm and count
  - `skip` (optional): `[integer, …]` — copy numbers k to leave out
- **`addItem`** (items): define an item that exists only in this project, as project:<id>
  - `id`: `string` — the item's id; the document refers to it as project:<id>
  - `item`: `{ <key>: any }` — the item: plate, bent-angle, generic or placeholder (§4.8)
- **`setItem`** (items): change a project item
  - `id`: `string` — project:<id>
  - `set`: `{ <key>: any }` — fields to change, as a JSON merge patch (RFC 7396): null removes a field
- **`setParam`** (params and costs): set a param (a number, an expression or a valued field), or remove an unused one
  - `name`: `string` — a param name: an identifier
  - `value`: `expr` — a number, an expression, a valued field; null removes it
- **`addCost`** (params and costs): add a cost line that is not a part (machining, labour, freight, …); its id is K<n>
  - `cost`: `{ <key>: any }` — a cost line without its id: { "label", "kind", "low_minor", "likely_minor", "high_minor", … } (§4.11)
- **`setCost`** (params and costs): change a cost line
  - `id`: `string` — the entity to change
  - `set`: `{ <key>: any }` — fields to change, as a JSON merge patch (RFC 7396): null removes a field
- **`setPriceBands`** (params and costs): replace the project's price bands
  - `bands`: `[{ <key>: any }, …]` — the whole list of price bands (§4.11); [] removes them
- **`chooseOffer`** (params and costs): choose the offer, cut-list mode, kerf or trim for an item (§5.3, §5.4)
  - `item`: `string` — a catalog item: "<catalog>:<code>"
  - `offer` (optional): `string | null` — the SKU to order, bare or <catalog>:<sku>; null forgets the choice
  - `sale` (optional): `"cut" | "stock" | null` — the cut-list mode (§5.3)
  - `kerf_mm` (optional): `number | null`
  - `trim_mm` (optional): `number | null`
- **`tag`** (organising): add tags to entities, or remove them
  - `ids`: `[string, …]`
  - `add` (optional): `[string, …]`
  - `remove` (optional): `[string, …]`
- **`label`** (organising): give an entity a label, or remove it
  - `id`: `string`
  - `label`: `string | null` — null removes it
- **`addVariant`** (records): add a variant: params it overrides and items it swaps
  - `name`: `string` — a variant: letters, digits, '.', '_' and '-'
  - `variant`: `{ label?: string, params?: { <key>: expr }, swap?: { <key>: <a catalog item: "<catalog>:<code>"> } }` — the params it overrides and the items it swaps: { "params": { "H": "1100" }, "swap": { … } } (§4.10)
  - `default` (optional): `boolean` — derive this variant when none is named
- **`setVariant`** (records): change a variant, or make it the default
  - `name`: `string` — a variant: letters, digits, '.', '_' and '-'
  - `set` (optional): `{ <key>: any }` — a merge patch of the variant
  - `default` (optional): `true` — make it the default variant
- **`addCheck`** (records): add a project check, with its margin (§4.9); its id is C<n>
  - `check`: `{ <key>: any }` — { "value", "op", "limit", "text", "severity" } or { "expr", "text" } (§4.9)
- **`addOpen`** (records): record an open item, which may block the order; its id is O<n>
  - `open`: `{ <key>: any }` — { "text", "blocks": "order" | null, "scope": [ids or "supplier:<id>"] } (§4.12)
- **`resolveOpen`** (records): close an open item: it leaves the list and a dated decision records how it was resolved
  - `id`: `string`
  - `text` (optional): `string` — what was decided; defaults to the open item's text
  - `why` (optional): `string`
- **`addDecision`** (records): record a decision with its date and reason (§4.12); its id is D<n>
  - `text`: `string`
  - `why` (optional): `string`
  - `date` (optional): `string` — defaults to today
- **`saveView`** (views): save a named camera view (snapshots render named views, §7.3)
  - `name`: `string`
  - `view`: `{ <key>: any } | null` — { "pos": [x, y, z], "target": [x, y, z] }; null removes it
- **`lockUpdate`** (lock): refresh the lock from the live catalogs, as one step of the log (§4.13)
  - `items` (optional): `[<a catalog item: "<catalog>:<code>">, …]` — refresh only these items; all when absent

<!-- end of the generated reference -->
