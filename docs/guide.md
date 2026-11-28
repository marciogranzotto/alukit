# AluKit user guide

This guide covers a project day to day: what is in its folder, what the document holds, how to
draw in the viewer and edit what you drew, how to read the outputs, and how to keep catalog data
and history under control. The examples are lines of the synthetic cart project in
[`tests/fixtures/cart`](../tests/fixtures/cart) (its catalogs are test data, not a real vendor's),
and, for editing, a table frame made on an empty project of the built-in Forseti catalog.
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

**Context.** What the frame stands in but is not part of (a wall, the floor, a bench it is fixed
to) is a bar or a placed part with `"context": true`. It is drawn translucent and the checks read
it, but it is not cut, counted, bought or weighed, and `bbox()` leaves it out; the BOM lists it
apart. Use it rather than a placeholder, which is a part still to buy and blocks its order line.

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
end, an item with no offer) and reports your checks. An unconnected end is one that meets another
bar's end, or lies on a bar's face or runs into it, with no joint: "b13.a lies on b3's +x face
with no connection". `autoConnect { "end": "b13.a" }` joins it, and the order warns until it is.

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
| Select | `V` | click to pick, Ctrl or Cmd-click to toggle, Shift-drag a box (left to right takes what is inside, right to left what it touches); right-click for the menu; `Delete` or `Backspace` deletes the selection, listing first what else goes |
| Move | `D` | drag the selection (or a bar or part you press), or click a base point and then where it goes; type `200`, `0, 200, 0` or `[x, y, z]` and `Enter`. `→ ← ↑` lock an axis; joined ends follow, and holding **Alt** frees them instead |
| Rotate | `Q` | click the centre (or `Enter` for the selection's centre), `X`, `Y` or `Z` for the axis (Z at first), type the angle and `Enter`; or drag one of the rings, in 15° steps |
| Draw bar | `B` | click a start, then click an end, or type a length and press `Enter` |
| Box frame | `G` | click the corner, type `1000, 600` and `Enter` (or click the far corner), then the height and `Enter` |
| Connect | `C` | pick a through bar and the ends that butt, two ends for a miter or splice, or two or more bars for a face joint, then apply. A face joint takes a fastening (none, bolt, T-nut, screw) with its fastener, stack and stations; a pivot takes a station on a face as its base, then the ends it carries, and a hinge. A pick the type cannot take is left out, and the tip says why |
| Place part | `P` | click a face or groove: the part goes there, one step. Type a distance first to place it that far from the nearer end |
| Pattern | `X` | take the selection as the template, click the bar to repeat along, give pitch and count: the copies are drawn and **Create** says what it will make before you press it |
| Measure | `M` | two snapped points: the distance and its components |

Changing what you drew (moving, turning, copying, mirroring, lengths and ends, holes, joints,
patterns) is the next section, [Editing in the 3D view](#editing-in-the-3d-view).

`Esc` steps back one level at a time: what is typed, the last pick, the gesture, the tool, then
the selection. While you hold a drag, `Esc` ends it at once, even with a number typed, and
letting go then changes nothing. `Ctrl/Cmd+Z` undoes the last step, and `Shift` with it redoes.

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
- `R` rolls the section a quarter turn, its anchor turned with it so the bar stays on the same
  side of the line; `A` cycles the anchor (centre, corners, faces, datums), or click **Anchor** in
  the command bar and a dot on the section it opens.
- `W` sets the work plane to a face: press it, then click a bar's face; press it again for the
  ground. The plane defaults to the ground.
- `Space` draws the next bar from the last one's end.
- With **Join ends** on (the command bar's check box, on by default), when the end closes on
  another bar the preview says what the joint will do ("will butt on b1 · cut 580 · b1 800 →
  820"), and `Tab` flips which bar runs through. An end on a bar's face joins it too: click one
  post's inner face, then the other's, and the rail butts on both. **Corners** sets the corner
  rule for every bar drawn until you change it. Switch Join ends off to join the ends yourself
  with Connect.

**A box frame.** `G`, click the corner, type `1000, 600` and `Enter` (or click the far corner),
type the height and `Enter`: four posts, a base and a top ring, every corner butted, as one step.
The form beside the inspector (and on the start card) sets the rings, a shelf, the corner rule,
the connector, and whether W, D and H become params; it shows the cut lengths before you make it.
On the start card, for a table frame of 40 × 40 with a shelf: click the **40 × 40** size, type
`1000`, `600` and `750` in W, D and H, `250` in **Shelf at** (its top face that high above the
base), tick **W, D and H as params**, click the bracket offered beside **Joined with** (CT38-06,
the bracket made for the most profile series; the list beside it holds every connector that fits,
and Nothing), then **Make a box frame**. **More options** holds the corner, the rings and the
corner rule.

**Placing a part.** Arm it first: `/` opens the catalog, search (`CT38-06`, `bracket`), open its
card and press **Use for placing**; Place (`P`) is then on. Click a face or a groove: the part goes
there, one step. Type a distance first to place it that far from the nearer end (`300`, then the
click). A pattern's copies take no parts: place it on the template.

**The inspector** edits the selection in place; what each kind of selection offers is under
[Editing in the 3D view](#editing-in-the-3d-view) below.

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
the keys with Ctrl or Cmd still work. It also has **Navigating the view**: **Mouse** (drag to
orbit, right-drag to pan, the wheel zooms) or **Trackpad** (drag to orbit, two fingers pan, pinch
to zoom), kept in your browser.

## Editing in the 3D view

Everything you made can be changed in the app, each change one step that `Ctrl/Cmd+Z` takes back
and that the CLI would make with the same commands. The examples follow on from one another: a
table frame of 1000 × 600 × 750 with a shelf ring 250 up, made from the start card with W, D and H
as params (above, A box frame), whose bars `addFrame` numbers posts b1 (front left), b2 (front
right), b3 (back left) and b4 (back right), then the base ring b5–b8, the shelf ring b9–b12 and
the top ring b13–b16, each ring front, back, left, right.

### Selecting

- **Click** a body to select it; **Ctrl or Cmd + click** adds or takes one away.
- **Shift + drag** a box. Drawn **left to right** it takes what lies wholly inside (a solid
  outline); drawn **right to left** it takes everything it touches (dashed), and remembers which
  ends of the bars it only crosses lie inside it, so that Move stretches those bars (below).
- **The outline**: tick **by tag** and click a tag's heading (`post`, `shelf`, `top`) to select
  its members; the small arrow beside it still opens and closes the group. Two clicks select the
  four legs.
- **Ctrl/Cmd+A** selects every bar and part the view shows.
- **The menu** (below) has **Select similar** (the same item and options), **Select tagged …**
  (the same tags), **Select connected** (the bars its joints join to it) and **Select the whole
  assembly**. `alukit query <dir> like:b1`, `like:b1 by tag`, `connected:b1` and `connected*:b1`
  select the same from a terminal.

The status bar shows the size of the selection, W × D × H in millimetres (of everything when
nothing is selected); hold **Alt** to see it as a box in the view.

### The menu

**Right-click** a body (without moving the mouse: a right-drag still pans) to open the menu on
it, or on open ground for the current selection; right-click an outline row, or a group's
heading, for the menu about it. **Shift+F10** or the **Menu** key opens it from the keyboard. It
lists everything you can do to what it is about, with its key; an entry that cannot run now is
grey and says why. `↑` `↓` move, the underlined letter goes to its entry (`D` Duplicate, `L`
Delete), `Enter` runs, `Esc` closes. On a Mac the keys read ⌘, ⌥ and ⇧. The buttons at the
top of the inspector are the same actions: Delete, Duplicate, Copy, Paste, Mirror…, Align to a
face….

### Hiding

**H** hides the selection, **Shift+H** isolates it (hides everything else), **Alt+H** (Option+H on
a Mac) shows everything again; the menu has the same three. To hide the top ring and then look at
one corner alone: select the `top` heading, press `H`; click a corner's marker, press `Shift+H`;
then `Alt+H`. While anything is hidden the status bar says "n hidden · Show all", and the menu of
a hidden entity's outline row has **Show**, which draws it again. Hiding changes
only what you see, like the section plane: it is not a step, and clicks and snaps pass over what
is hidden.

### Moving and turning

- **Move (`D`)**. Drag the selection, or click a base point and then where it goes: both snap to
  ends, faces and grooves, so a bar moved from its end onto another bar's end lands on it exactly.
  Or type and press `Enter`: one number is the distance along the locked axis or the way the
  pointer went, three are the offset, `[x, y, z]` is where the base point goes. `→ ← ↑` lock X,
  Y or Z (again, or `↓`, frees it), and with a selection they start the move too, wherever the
  focus is. To move the shelf up 150: select the `shelf` heading, `D`, `↑`, `150`, `Enter` (or
  type `0, 0, 150`). The moved bars are drawn where they would go, and the preview says what follows,
  what is freed and which cuts change. Ends joined to what you move **follow** along their own
  bars, so the rails butted on a moved post stretch with it; hold **Alt** to free them instead.
- **Widening a frame without params: a stretch.** From the front, in orthographic, draw a box
  **right to left** over the right side (round the right posts and the rails' ends against them),
  then `D`, `→`, `100`, `Enter`. What the box holds whole (the right posts and side rails) moves;
  the front and back rails it only crosses keep their left ends and move their right ends, which
  lie inside it, so they grow by 100, as AutoCAD's STRETCH does. The preview says "stretches b5,
  b6 …" before you commit. A box drawn left to right gives the same frame here, since the rails
  butted on the moved posts follow; any other selection, and Rotate and Duplicate, move whole
  bars. `alukit move <dir> --ids b2,b5.b --by 100,0,0` moves b2 whole and only b5's end b.
- **With params**, change the param instead: with nothing selected, the project panel lists the
  params; **Edit** beside `W`, type `1100`, `Enter`.
- **A part alone** slides along its bar. Select the bracket: an arrow along its bar shows; drag
  it, and it lands on the 10 mm grid or on another part's station (hold `Shift` to slide it
  freely), or press `D`, type `150` and `Enter` to move it 150 along the bar (from 300 to 450).
- **Rotate (`Q`)**. With a selection, three rings stand at its centre. Click a point for the
  centre (or press `Enter` for the selection's centre), press `X`, `Y` or `Z` for the axis (Z at
  first), type the angle (counter-clockwise looking down the axis) and `Enter`; or drag a ring,
  which turns in 15° steps and commits when you let go. `Q`, `X`, `90`, `Enter` turns the
  selection 90° about X through its centre.
- **Align to a face…** (the menu): click a bar's face, and the selection moves along it until its
  own face that looks the same way is flush ("flush with b1's top · by [0, 0, 7]").

### Copying and mirroring

- **Duplicate (`Ctrl/Cmd+D`)**: the copy follows the pointer from the original's place; click a
  base point and then where it goes, or type the offset. To copy the top front rail 300 down,
  joined to the legs: select b13, `Ctrl/Cmd+D`, `↑`, `-300`, `Enter`. Type `4x` after the offset
  for four copies at that spacing, or `/4` for four dividing it (`0, 0, -600 /3`). A copy keeps
  the joints that are its bar's own (a slat's butts on the rails), and each new bar's other ends
  join what they land on.
- **Copy (`Ctrl/Cmd+C`) and Paste (`Ctrl/Cmd+V`)**: paste hangs the copy from the pointer by its
  lowest corner; click where it goes.
- **Mirror…** (the menu): the plane is square to X (press `Y` or `Z`, or `→ ← ↑`, to turn it) and
  goes through the selection's centre or the point under the pointer; type where it crosses its
  axis (`500`, `=W / 2`) and press `Enter`. **Remove the originals** in the command bar takes them
  away in the same step. A part on a bar lands on the bar standing where that bar's image is: a
  bracket on the front-left leg's inner face at 300, mirrored at `=W / 2`, lands on the
  front-right leg's inner face at 300 ("mirror p1, making p2 on b2"). Where no bar stands at the
  image, the preview says so and nothing is made. A mirrored bar keeps its joints, landed on the
  bars at their images, and its other ends join what they land on: the brace butted on the back
  posts, mirrored at `=W / 2`, is cut as the brace and butted on the opposite posts, and the
  preview says so before the click ("makes b18 · joins b4 (c15) · joins b3 (c16) · cut 1049.97").
  An end whose joint has no bar at its image stays open, and the preview says that too.

### Lengths and ends

- **A bar's end.** Select a bar: a handle shows at each end. Drag one to lengthen or shorten the
  bar along its axis; it falls onto the bars it meets and joins them on release, as the preview
  says first ("will butt on b1 · cut 580"). Type a number while dragging to set the cut. Or click
  the cut length on the bar's label, type it, `Enter`. A joined end is freed by the drag, and the
  preview says so; one a pivot, mitre or a param sets is locked, and says why ("driven by L: edit
  L").
- **The Length field** in the inspector takes a number or an expression: `=D` makes the bar as
  long as `D` and keeps following it. The select beside it chooses which end moves: end b, end a,
  or both from the middle.
- **Each end's row** says what joins it ("butts on b3 (c9)"; when the joint fails, why; "held by
  c36 (face joint)" for a plate's; "open" only where it meets other ends and nothing joins them,
  with **Join**, or why it cannot be joined in its place). Under the ends, **Joints** lists every
  joint the bar takes part in, each with **Edit**; the menu's **Edit c36…** does the same. It sets
  the end's **cut** (angle or square), an **extension**, and where it stops: by its joint, **at a
  face** (the faces its line meets, nearest first), **flush with an end**, or **Pick in the view**
  and click the face. **Free from c9** takes the end out of its joint.
- **A diagonal brace.** Draw it with its ends on the posts' lines and it butts on both, its ends
  declared cut at an angle: `B`, type `[0, 600, 100]`, `Enter`, click **Anchor** in the command
  bar and the section's dot on its face `+x` (so the brace lies in the posts' plane, not half
  outside it), type
  `[1000, 600, 650]`, `Enter`. If one sits off the plane, its **Offset** row moves it along its
  section's x and y, each labelled with the world direction it runs in.
- **Split and Reverse.** Right-click a bar where it should be cut: **Split b9 here, 400 mm from end
  a** splits it there (rounded to the millimetre); **Split b9 at…** takes a typed distance and adds
  a splice when asked. **Reverse b9** swaps its ends. Both are also buttons in the inspector.
- **Holes.** Right-click a bar's side: **Add a hole on b1's face +x (world +Y), 20 mm from end a's
  cut…** opens the hole form there, its distance ready to type over; set the distance, what it
  counts from, the size (a drill such as `7`, or a thread such as `M6`) and the depth (empty for
  through), then **Add the hole**. A distance counts from **end a's cut** or **end b's cut**, as
  the cut list prints it and a shop measures, or from a design point, which stays put when the
  ends are cut back or extended. Each hole is then a row that edits and removes it ("20 mm from
  end a's cut"). A hole that reaches past a cut is an error: off the piece, no shop can make it
  there. In the document, `"from": "a.cut"`; without `from`, a hole counts from design point a.

### Several selected, profiles and nodes

- **Several bars** share fields in the inspector: options (when they are one profile), anchor,
  roll, label and tags, each showing the value they share or "varies". A change is one step for
  all of them.
- **The anchor** is picked on the section's dots beside its list (or from the list): each dot is
  a press of its own on any section, a 40 × 80 drawn to scale.
- **A roll by a quarter turn keeps the bar on its anchor's side**: the anchor turns with it, so a
  40 × 80 on a corner stays in that corner and swaps its long side for its short one. Another
  angle turns the bar about its anchor.
- **Replace…** changes the profile, for the selected bars or all like the one selected. To make the
  four legs 40 × 80 with the 80 along X: select the `post` heading, **Replace…**, find `40x80`,
  choose the profile, **Replace 4 bars**; then type `90` in **Roll** and `Enter`. Each leg turns
  in its own corner, its anchor turned with it (front left `-x+y`, front right `-x-y`, back left
  `+x+y`, back right `+x-y`): two steps.
- **A node** (a point several bar ends share) moves by its x, y and z fields, and every bar end at
  it follows.

### Joints, patterns and parts

- **A joint's fields**: select it (its row under Joints in the outline, or type its id in the
  outline's filter). A butt edits its through bar, connector, quantity, spacer and through end; a
  pivot its base, axis and hinge; a mitre or a splice its connector, quantity and gap; each butting
  end can name the face its cross holes go in from. The menu's **Edit c9…** and **Change
  connector…** take you to the field; a joint marker's menu offers them too.
- **A face joint** (a plate held by bolts, screws or T-nuts) shows the Connect tool's form, filled
  in. To go from 2 bolts to 3: change its stations from `100, 300` to `100, 200, 300` and press
  **Apply**. **Change layers…** picks the layers again in Connect.
- **A corner**: select it (its marker in the view, or its row under Joints) for the **corner
  inspector**: each way the bars there can meet, which bar runs through and the cut lengths each
  gives, the current one marked "now"; where two ends meet, a **Mitre** or a **Splice** too.
  **Apply** rearranges the corner as one step; **Apply to n matching corners** does the same at
  every corner built the same way. `alukit arrangements <dir> --at x,y,z` gives the same answer.
- **A pattern.** For four slats across the shelf, in one step: press `X` with nothing selected,
  type `b9` as the bar to repeat along (or click it), pitch `150`, count `4`, then **Draw the bar
  to repeat**; draw the slat (`[200, 0, 250]`, `Enter`, **Anchor** in the command bar and the
  section's dot `+y` so its top is flush with the rails', `[200, 600, 250]`, `Enter`). The slat and
  its pattern are made together, and the pattern is selected: type `5` in its **Count** to make it
  five. Each copy carries the slat's joints, so every slat is cut 520 and butted on both rails. To repeat what exists, select it first and press **Create** instead. A pattern's pitch
  (`W / 8` keeps following W), offsets, skips (`3, 5`) and along edit the same way, and
  **Explode** turns the copies into plain bars, selected.
- **A part**: **Replace…** picks another item of its kind, for this part or all like it; its bar,
  face or groove, distance, offset and roll edit in place. **Context** (also on a bar) marks it
  as something the frame stands in rather than part of it.

### Deleting and undoing

Select the back top rail (b14) and press `Delete` (or right-click it, **Delete**): what goes at
once goes, and otherwise a dialog lists what else would be removed and what changes (here, the
two butts it leaves keep their other ends) before **Delete**; **Cancel** has the focus, so a key
pressed by mistake deletes nothing. `Ctrl/Cmd+Z` undoes the last step,
whoever made it (the top bar's Undo button names the step it takes back), one press per step;
`Shift+Ctrl/Cmd+Z` redoes.

### By mouse alone, by keyboard alone

Every edit has a mouse path (the tool rail, the menu, the inspector's buttons) and a keyboard path
(the keys in `?`, `Shift+F10` for the menu; in the outline `↑` `↓` move and `Shift` with them
extends the selection); typed values work in both. To move the shelf by
mouse: click the `shelf` heading, click **Move** on the rail, type `0, 0, 150`, click in the
view. To delete the back top rail: right-click its outline row, **Delete**, then the dialog's
**Delete**; the top bar's **Undo** takes it back.

### What an agent sends

Each edit is a command an agent sends the same way, and the log keeps it: `alukit log` lists
each step's words, and `alukit log --json` each step's commands, which `alukit do` replays one step
at a time (an undo or a redo is `alukit undo` or `alukit redo`). Moving is `alukit move <dir> --ids b9,b10,b11,b12 --by 0,0,150`,
turning `alukit rotate`; everything else is `alukit do` with the batch the app sends (the
[design](design.md), §8, "What each edit sends", lists them).

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
drilling it, say) replaces the item's price. A supplier's machining (holes, taps, angled cuts)
has no price until a cost line covers its services: Problems says "2 machining services on
Profile 40x40 have no price", selects the bars that carry them, and gives the cost line to add
with `alukit do`'s `addCost` (`"covers": { "supplier": "…", "services": true }`). The rules, and what each blocks:

| Rule | Blocks by default | When |
|---|---|---|
| `check-error` | yes | a check failed; blocks the suppliers of the entities it names |
| `open-item` | yes | an open item with `"blocks": "order"`, within its `scope` |
| `placeholder` | yes | a placeholder is on the list; blocks its own line under "unsourced" |
| `missing-price` | yes | no offer or no price, no exchange rate, or a supplier's machining no cost line covers |
| `est-price` | yes | the price is an estimate |
| `out-of-stock` | yes | the offer was read as out of stock |
| `option-not-sold` | yes | the option (a finish) is not sold |
| `stale-price` | warns | the price was read more than 30 days before `--as-of` (today by default) |
| `no-connector` | warns | butts name no connector and the project names no default butt connector, so nothing is bought to join them |
| `unconnected` | warns | an end meets another bar's end, or lies on a bar, with no joint: nothing holds it, so nothing is bought to |

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
