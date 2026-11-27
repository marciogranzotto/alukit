# AluKit user guide

This guide covers a project day to day: what is in its folder, what the document holds, how to
draw in the viewer, how to read the outputs, and how to keep catalog data and history under
control. The examples are lines of the synthetic cart project in
[`tests/fixtures/cart`](../tests/fixtures/cart) (its catalogs are test data, not a real vendor's).
The [design](design.md) is the full reference; the CLI's `--help` lists every option.

Lengths are in millimetres, angles in degrees, masses in kilograms, and money in integer minor
units (`_minor`) with a currency. The world is right-handed with **Z up**.

## The project folder

A project is a folder wherever you keep it:

```
my-frame/
  alukit.json          the document: everything you decided
  alukit.lock.json     the catalog data the document uses, pinned
  revisions/           named revisions you saved (optional)
  .alukit/             per-machine state: the server's address and token, the edit lock
```

`alukit new my-frame --catalog forseti --currency BRL` creates the first two files and adds
`.alukit/` to the folder's `.gitignore` line. Commit the document, the lock and `revisions/`;
leave `.alukit/` out.

- **`alukit.json`** holds only what you chose. Everything else (cut lengths, end angles, holes,
  hardware, masses, prices) is derived from it and never stored in it.
- **`alukit.lock.json`** holds the catalog data the document refers to (the items, their sections
  and offers) as it was when pinned. AluKit derives from the lock, not from the live catalogs, so
  the same project gives the same answer next month even if a vendor changes a price. See
  [Locks](#locks).
- **`revisions/<name>.json`** is a named revision: the document, its lock, every output and a
  stamp. See [Revisions and diff](#revisions-and-diff).
- **`.alukit/`** is per machine. While `alukit serve` runs it holds `owner.json` (port, process,
  token, mode 0600) and `edit.lock`, so a second writer is refused.

You can edit `alukit.json` by hand. A running server takes a valid edit in as one step of its
history; an invalid file makes the project read-only until it is valid again. `alukit fmt <dir>`
rewrites the files into canonical form (`--check` only reports), so diffs stay small.

## The document

A document is a set of entities with ids: a letter prefix and a number. Commands assign ids and
never reuse them. A bar's end is `b7.a` or `b7.b`. This is the cart, cut to the pieces that
show each kind of thing.

**Params** are named numbers, or expressions, or valued fields that say where a number came from.
Anywhere a number goes, an expression may go.

```json
"params": {
  "D": "600",
  "H": { "v": 900, "src": "meas", "note": "under a bench top" },
  "W": "1200"
}
```

**Points** are `[x, y, z]`, a node id, a point on a bar that follows it (`{ "on": ... }`), or a
hinge (`{ "pivot": "c13" }`). **Bars** run from end `a` to end `b`; `item` picks the profile (or
the `defaults`), `anchor` names the section point that sits on the line, `roll_deg` turns the
section. `alukit catalog search "40x40" --kind bar` finds an item's id.

```json
"bars": {
  "b1": { "a": [0, 0, 0], "b": [0, 0, "H"], "anchor": "-x-y", "tags": ["post"] },
  "b5": { "item": "test:TS4080", "a": [0, 0, "H"], "b": ["W", 0, "H"], "anchor": "+x+y",
          "roll_deg": 90, "label": "top rail, front" }
}
```

**Connections** decide where bars end and how they are joined. `butt` stops ends on a through
bar; `miter`, `splice` and `pivot` join two ends, collinear ends or a hinge; `face` holds layers
face to face with bolts, screws or T-nuts and generates the holes and hardware.

```json
"connections": {
  "c1": { "type": "butt", "through": "b5", "ends": ["b1.b", "b2.b", "b7.a", "b8.a"] },
  "c9": { "type": "splice", "ends": ["b11.b", "b12.a"], "connector": "test:SPL-40" }
}
```

A connection that stops a bar cuts it: `b7` is 440 long because it butts between the posts'
faces. You do not type that length.

**Parts** are catalog items that are not bars: carriages, T-nuts, brackets. They sit on a station
of a bar (`on`), at a world pose (`at`), or are unplaced lines that are counted and priced but
not drawn.

```json
"parts": {
  "p1": { "item": "test:CAR20", "on": { "bar": "r2", "at_mm": 100, "face": "+y" }, "label": "carriage" },
  "p2": { "item": "test:TNUT-M8", "qty": 10, "unplaced": true, "why": "spares for light fixings" }
}
```

**Patterns** repeat a template along a bar by pitch and count; the copies stay live (`b26@2`).

<a id="items"></a>
**Items** (`items`, named `project:<id>` by parts) are what no catalog holds: a `plate` with an
outline and holes, a `bent-angle` with its legs, bend radius and K-factor, a `generic` item, or a
`placeholder` for something not chosen yet, with a bounding box, an estimated mass and an
estimated price. Holes are through, threaded (`"thread": "M6"`), countersunk (`csk`) or
counterbored (`cbore`).

```json
"items": {
  "plate-a": { "kind": "plate", "name": "Motor plate", "material": "test:s235", "thickness_mm": 8,
               "outline": [[0, 0], [160, 0], [160, 100], [30, 100], [0, 70]],
               "holes": [{ "at": [20, 20], "thread": "M6" },
                         { "at": [140, 20], "d_mm": 6.6, "csk": { "d_mm": 12.4, "angle_deg": 90 } }],
               "datums": { "mount": [80, 50, 0] } },
  "motor": { "kind": "placeholder", "name": "Gear motor, model to be chosen",
             "bbox_mm": [[-60, -45, 0], [60, 45, 110]],
             "price_minor": { "v": 45000, "src": "est", "low": 30000, "high": 70000 } }
}
```

**Variants** override params, swap items, and scope entities with `only_in` and `not_in`. Add a
taller option with shelf rails, with no `--variant` flag meaning the default:

```sh
alukit do table '[
  {"cmd": "addVariant", "args": {"name": "standard", "variant": {}, "default": true}},
  {"cmd": "addVariant", "args": {"name": "tall", "variant": {"params": {"H": 900}}}}
]'
```

An entity with `"only_in": ["tall"]` exists only in that variant. Every output takes
`--variant`, and `alukit diff <dir> --variant standard --variant tall` compares two.

**Costs and price bands** cover what is not a catalog line. `costs` are lines (labour,
machining, freight, fabrication, contingency); each has a low, likely and high, a source, and may
be in another currency (`fx`) or a percentage of the subtotal. `price_bands` give catalog prices
a low and a high by supplier or kind.

```json
"costs": [
  { "id": "K1", "label": "assembly", "kind": "labour", "low_minor": 40000, "likely_minor": 60000,
    "high_minor": 90000, "src": "est" },
  { "id": "K5", "label": "contingency", "kind": "contingency", "pct": 10, "of": "subtotal" }
],
"price_bands": [
  { "supplier": "test-steel", "low_pct": -10, "high_pct": 25, "src": "est", "why": "steel prices move weekly" }
]
```

A **provenance** (`src`) says how a number is known: `src` (a source, with `ref` and the date
`read`), `meas`, `est`. Estimates are fine while you plan, and they block the order until
replaced.

**Open items** are questions that must be answered before you order. `scope` limits which
suppliers they hold.

```json
"open": [
  { "id": "O1", "text": "confirm the rail screws' length against the rail's counterbore",
    "blocks": "order", "scope": ["c35"] }
]
```

**Checks** are your own rules (`{ "value": "len(b3)", "op": ">", "limit": 800, "text": "..." }`);
`alukit check` reports each one's margin. The skill's
[document section](../skills/alukit/SKILL.md) lists the expression functions.

## Editing

The one edit path is commands: `alukit do <dir> '<json>'` applies a batch atomically and refuses
a command that does not validate, with a structured error. `alukit add bar|point|connection|part`
is sugar for the common ones, and the app's tools send the same commands. `alukit query <dir>
tag:knee --summary` reads entities back. With a server running, the CLI and every open tab edit
through it and see each other's changes at once; `alukit undo`, `redo` and `log` use its
history, whoever made a step.

Check after each batch: `alukit check <dir>` exits 1 on an error, prints warnings (an unconnected
end, an item with no offer) and reports your checks.

## Drawing in the viewer

`alukit serve <dir>` prints an address with a token and opens it. The server answers only its own page,
and the token changes on every start.

The window has five parts, each resizable by the splitter beside it (drag it, or focus it and
use the arrow keys; the sizes are kept in your browser):

- **The left column**: the **parts bin** on top (what is armed for drawing and placing, the items
  this project uses, the ones you pinned and the ones armed lately; click one to arm it), and the
  **outline** under it, one tree of bars, joints, parts, patterns, runs and points. A row reads
  label · item · cut length; a mark shows a problem. Joints are grouped by corner. Filter it, or
  group it by tag. The arrow keys walk it, Enter selects.
- **The catalog** opens wide over the left column and the 3D view with `/` or **Browse catalog…**:
  a search (a size such as `40x40`, a code, a name), a row of kinds that follows the active tool,
  vendor › kind › family, and the results with their size, mass per metre and lowest price. A
  card says the item's data in words with its source, its options (only a value someone sells is
  preselected) and its offers. **Use for drawing** (or **Use for placing**) arms it, **Add to bin**
  keeps it at hand, **Replace selected** gives the selected bars or parts this item, and **Make it
  the default** writes the project's default bar. `Esc` closes it; it keeps its search and card.
- **The 3D view** in the middle, with the tools on its left edge and the views on top. Under it
  the **status bar**: the connection, the step counter with who made the last step and when, what
  the tool asks for next, who else is editing, and the units.
- **The right column**: the active tool's form, then the inspector. With nothing selected the
  inspector is the **project panel**: First steps (on a project that started empty), the
  project's bars, parts, joints, mass, likely cost and order state, and the **params**, each
  editable in place. **Settings…** opens the project settings.
- **The sheets** below: Cut list, BOM, Machining, Order & costs, Problems and Records, each tab
  with its count. `T` collapses or opens them, `Shift+T` maximizes them over the view; drag their
  top edge to resize. An empty project starts with them collapsed; they open on the cut list once
  there is something to cut.

The top bar has the **Project** menu (settings, revisions, Export GLB, help, the start card),
the **variant** every view shows (when the project has variants; a strip says that edits still go
to the base document), Undo and Redo naming whose step they take back (`Undo · claude: add bar
b35`; undoing another source's step asks first), the order's state (**Ready to order**,
**Blocked · n things to resolve**, **Nothing to order**; click it for Order & costs), whether the
current state is a saved revision (**Saved as Quote 1** or **Not saved**; click it to save or
verify one), the theme and `?`. **Export GLB** downloads the variant shown as `alukit export glb`
writes it.

An empty project opens with the **start card**: the catalogs it can draw from, the currency, and
three ways in: **A box frame** (the box frame tool's form, below, made as one step), **Draw the
first bar** (a size, the profile and its finish, which become the default bar, then three steps
that tick as you draw) or **Load the example** (the skill's work table, as one step). `Esc` closes
it; **Show the start card** in help brings it back.

**Project settings** (the Project menu, or **Settings…** in the project panel) edit the name, the
catalogs, the currency, the price basis and exchange rates, the default bar, the cutting
allowances, the corner rule and the order rules, saved as one step. The built-in catalogs the project does not name are
listed with their counts and an **Add** button; a folder inside the project is added by its path.

When another source edits the project (an agent through the CLI, a hand edit, another tab), a
toast says who and what, with **Show** and **Undo it**; the outline marks what it made, "new ·
claude", until your next step. Your own step gets a toast when it did more than it made: a cut
that auto-connect moved, an entity removed. A refused command says why where you made it, or in a
toast with the whole message, **Copy** and **Select the places** it names.

The tools are a column on the 3D view's left edge, each with its key on a cap; a tool that cannot
be used now is disabled and says why.

| Tool | Key | How |
|---|---|---|
| Select | `V` | click to pick, Ctrl or Cmd-click to toggle, Shift-drag a box; `Delete` or `Backspace` deletes the selection, listing first what else goes |
| Move | `D` | drag the selection (or a bar or part you press), or click a base point and then where it goes; type `200`, `0, 200, 0` or `[x, y, z]` and `Enter`. `→ ← ↑` lock an axis; joined ends follow, and holding **Alt** frees them instead |
| Draw bar | `B` | click a start, then click an end, or type a length and press `Enter` |
| Box frame | `G` | click the corner, type `1000, 600` and `Enter` (or click the far corner), then the height and `Enter` |
| Connect | `C` | pick a through bar and the ends that butt, two ends for a miter or splice, or two or more bars for a face joint, then apply. A face joint takes a fastening (none, bolt, T-nut, screw) with its fastener, stack and stations; a pivot takes a station on a face as its base, then the ends it carries, and a hinge. A pick the type cannot take is left out, and the tip says why |
| Place part | `P` | click a face or groove: the part goes there, one step. Type a distance first to place it that far from the nearer end |
| Pattern | `X` | take the selection as the template, click the bar to repeat along, give pitch and count |
| Measure | `M` | two snapped points: the distance and its components |

**Changing a bar's length.** Select a bar: a handle shows at each end. Drag one to lengthen or
shorten the bar along its axis; it falls onto the bars it meets and joins them on release, as the
preview by the end says first ("will butt on b1 · cut 580"). Type a number while dragging to set
the cut. Or click the cut length on the bar's label and type it, then `Enter`. An end that is
joined is freed by the drag, and the preview says so; one a pivot, mitre or a param sets is
locked, and says why ("driven by L: edit L").

**Moving.** With Move (`D`), the moved bars are drawn where they would go, and the preview says
what comes along, what is freed and which cuts change ("b2.a, p1 follow · cut b2 580 → 680"), or
why the move cannot keep a joint ("Alt: detach"). A part on a bar slides along it. `alukit move`
and `alukit rotate` do the same from the command line.

`Esc` steps back one level at a time: what is typed, the last pick, the gesture, the tool, then
the selection. `Ctrl/Cmd+Z` undoes the last step, and `Shift` with it redoes.

**The command bar** at the foot of the 3D view shows the tool, what it asks next, the value you
type and what it comes to, and the tool's options. Start typing a number (or `[`, `(`, a sign)
and it goes there; start with `=` to begin with a param. A value is an expression of the
project's params with `mm`, `cm` or `m`: `1.2m`, `W / 2 + 20`, `-300`. A value that reads a param
is written as the expression, so the param keeps driving it.

**Drawing a bar.** Click a start point (or type `[x, y, z]` and `Enter`, or select a corner and
press `Enter`), then click the end or type a length and `Enter`; a click while a length is typed
draws that length toward the pointer. While drawing:

- The point snaps to nodes, bar ends, face and groove centre lines, face centres, the datums and
  face centres of parts, and the grid (10 mm).
- The line follows the world X, Y or Z axis nearest your pointer. `→ ← ↑` lock it to X, Y or Z
  (again, or `↓`, frees it); hold **Shift** to leave the axes and move freely in the work plane.
- Once you type, nothing pulls the line.
- `R` rolls the section a quarter turn; `A` cycles the anchor (centre, corners, faces, datums), or
  click a dot on the section in the command bar.
- `W` sets the work plane to a face: press it, then click a bar's face; press it again for the
  ground. The plane defaults to the ground.
- `Space` draws the next bar from the last one's end.
- With **Join ends** on (the command bar's check box, on by default), when the end closes on
  another bar the preview says what the joint will do ("will butt on b1 · cut 580 · b1 800 →
  820"), and `Tab` flips which bar runs through. **Corners** sets the corner rule for every bar
  drawn until you change it. Switch Join ends off to join the ends yourself with Connect.

**A box frame.** `G`, click the corner, type `1000, 600` and `Enter` (or click the far corner),
type the height and `Enter`: four posts, a base and a top ring, every corner butted, as one step.
The form beside the inspector (and on the start card) sets the rings, a shelf, the corner rule,
the connector, and whether W, D and H become params; it shows the cut lengths before you make it.

**Placing a part.** Click a face or a groove: the part goes there, one step. Type a distance first
to place it that far from the nearer end. A pattern's copies take no parts: place it on the
template.

**The inspector** edits the selection in place: a bar's length (which moves end b along the bar,
and says "driven by H: edit H" when a param sets it), its item (**Replace**, for this bar, the
selected ones or all like it), its finish and options. Select a corner (its marker in the view,
or its row under Joints in the outline) for the **corner inspector**: each way the bars there can
meet, which bar runs through and the cut lengths each gives, the current one marked "now".
**Apply** rearranges the corner as one step; **Apply to n matching corners** does the same at
every corner built the same way. `alukit arrangements <dir> --at x,y,z` gives the same answer from
a terminal.

Views: the toolbar has Iso, Top, Front and Side (the gizmo in the corner turns to the others),
**Orthographic**, and **Fit**; `O` toggles perspective and orthographic, `F` fits the selection (or
everything). **Section** cuts the view with a plane square to X, Y or Z: move it with its slider,
**Flip** shows the other side. It changes only what you see; clicks and snaps ignore what it
hides. **Joints** marks every corner by its state (a disc joined, a ring open, a cross failed),
**Problems** badges the bodies a problem names, and **Colour by item** colours each item as the
BOM's swatch does, with a legend. In Select, hovering a body tints it and names it. Anything the
tools do not cover is one `alukit do` away.

Every gesture is one step in the history. The sheets hold the outputs described next; Order &
costs has a date for the staleness of prices. Problems lists what stands between the project and
an order, each with its fixes and **Show**, which selects what it is about, frames it and opens
its outline row (`Esc` leaves Show). Problems also holds the open items, and Records the
decisions and the history: add or resolve an open item, record a decision, set a param in the
project panel, each one step that undo takes back.

If the file on disk stops being valid, a banner lists each error with the entity and field it is
in (and the name you likely meant, for a field the format does not know), the view says it shows
the last good state, and the tools are disabled until the file is fixed. **Restore last good**
asks first, then writes the server's state over the files and names the copy it kept of the
rejected text, in `.alukit/rejected/`.

`?` lists every key, what the snap names by the pointer mean, and a switch that turns off the
single-key shortcuts (a letter, `/`, `?`) for screen readers and speech input; the buttons and
the keys with Ctrl or Cmd still work.

## Reading the outputs

**Cut list** (`alukit cutlist`) lists, per item and option, each piece with its quantity, its cut
length at the long point, the cut angle on each end, and its machining (holes and taps, from a
named end, on a named face). A piece with an angled end also gives its centre-line length and its
**span**: the length of bar it takes, from one end's long point to the other's. A piece is ordered,
billed and nested at its span. That is its cut length unless its two cuts lean the same way: a
brace cut on two parallel faces takes its long point plus the section's depth times the tangent of
the cut angle. For an item sold by the bar the pieces are nested into stock bars with kerf and end
trim, and you see the stock bar, its price, its offcut and its waste:

```
| 2 | 300.00 |  |  | square / square | Ø11.00 hole 100.00 mm from end a on face -y, -15.00 across; ... | b20, b23 |
```

**BOM** (`alukit bom`) is every item and quantity grouped by kind, with its mass: as the catalog
publishes it, else computed from the section and material (the table says which). Plates and bent
angles weigh from their material.

**Order** (`alukit order`) is the buying list per supplier: the offer, quantity, unit price, low
to high, and what each line is for. Each supplier is **READY** or **BLOCKED**, with every reason,
and the totals follow, in the project's currency. A cost line that covers an item (a fabricator
drilling it, say) replaces the item's price. The rules, and what each blocks:

| Rule | Blocks by default | When |
|---|---|---|
| `check-error` | yes | a check failed; blocks the suppliers of the entities it names |
| `open-item` | yes | an open item with `"blocks": "order"`, within its `scope` |
| `placeholder` | yes | a placeholder is on the list; blocks its own line under "unsourced" |
| `missing-price` | yes | no offer or no price, or no exchange rate |
| `est-price` | yes | the price is an estimate |
| `out-of-stock` | yes | the offer was read as out of stock |
| `option-not-sold` | yes | the option (a finish) is not sold |
| `stale-price` | warns | the price was read more than 30 days before `--as-of` (today by default) |
| `no-connector` | warns | butts name no connector and the project names no default butt connector, so nothing is bought to join them |

Set a rule to `block`, `warn` or `off` in the document's `order_rules`. `alukit order` exits 1
while any supplier is blocked, which is what you want in a script. The cart is blocked, on
purpose: `alukit order tests/fixtures/cart` shows an open item, a missing price, an estimate and
a placeholder.

**Costs** (`alukit costs`) is the cost lines and the low, likely and high totals with their
provenance, including the share of the total that is sourced and the share that is estimated.

**Machining sheet** (`alukit machining`) is for the project's own plates and bent angles. Each
part has its material, thickness, quantity and maker, its outline (or an angle's legs, bend
and blank, with the bend allowance), and a table of holes measured from the part's datum, with
type, size and the face to drill from:

```
| h2 | 140.00 | 20.00 | countersunk | Ø6.60, countersink Ø12.40 at 90.00°, 2.90 deep, through | front |
```

A bar's machining is on the cut list, from a named end; the sheet's last table lists the cut-list
lines that carry some.

`--format md|csv|json` works on the output commands (`md|json` for `machining`).

Every output says which lock it came from: `lock` in JSON, a line "Derived from the lock
sha256:…" in Markdown, a first `stamp` row in CSV. The hash is the sha256 of the lock file, so
`shasum -a 256 alukit.lock.json` gives it too. The cut list, the order and the costs carry prices,
so they also state the price basis and the oldest date a price they use was read.

## Locks

A new item you name is pinned into the lock automatically. To take in what a vendor changed since,
run:

```sh
alukit lock update my-frame --dry-run    # print what would move, write nothing
alukit lock update my-frame              # refresh every item
alukit lock update my-frame --item forseti:PF40-01
```

The output lists each change (a price, a section, a stock length) and what it does to cut
lengths. An entry that live catalogs no longer have is kept and reported, never dropped
silently, and `lock update` refuses to write when the catalogs have errors. Add `--frozen` to any
output to make an unpinned item an error rather than reading it live, which is what you want in a
build you must reproduce.

## Revisions and diff

A revision is a named, immutable copy of what you published:

```sh
alukit revision save my-frame "v1"       # document, lock, every variant's outputs, a stamp
alukit revision list my-frame
alukit revision show my-frame "v1" --output order
alukit revision verify my-frame "v1"     # re-derive and report any drift; exit 1 on drift
```

`verify` opens no catalog: it derives again from the stored document and lock and compares every
output. The report names every field that moved; a different AluKit or Node version is noted, not counted as drift.
While `alukit serve` runs, `revision save` goes through the server, as the app's revision panel
does.

`alukit diff <a> [<b>]` shows what moved between two sides: entities, cut lengths, BOM and order
lines, prices, totals and the lock. A side is a project folder or its `alukit.json`, a revision
file, `rev:<name>` (a revision of the project in the current folder), or `git:<ref>:<path>`; each
side derives with its own lock.

```sh
cd my-frame
alukit diff rev:v1 .                            # since the revision
alukit diff git:main:. .                        # since the main branch's committed copy
alukit diff . --variant standard --variant tall  # one side, two variants
```

## Exports

`alukit export glb <dir> -o model.glb` writes the model as binary glTF: Y up, metres, a node per
bar, part and fastener named `<id> <label|item>`, with the item, SKU, options and cut length in
`extras`. A project plate's or angle's holes are children of its node. The same project gives the
same bytes, and the app's Export GLB downloads them. `alukit snapshot <dir> --view iso --size 1600x1000 -o shot.png` renders a view to
PNG in headless Chromium; the document can name its own views.

Next: the [design](design.md) for the rules behind each of these, and the
[decision notes](notes/README.md) for what was settled while building them.
