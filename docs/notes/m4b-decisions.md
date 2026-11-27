# M4b decisions: the draw tool, connect, place part, pattern, the catalog browser, snapshot

*2026-11-26. Calls made while building M4b (design §12: draw tool with snapping and work plane,
connect, place part, pattern, catalog browser) and M5's `alukit snapshot` (§7.3), where
[`design.md`](../design.md) is silent or ambiguous. For the coordinator to fold into the design
or veto. Labels: **verified** (run, with how), **read**, **inferred**.*

## The base frame (the done-when's oracle)

| # | Decision | Why |
|---|---|---|
| 1 | **The cart's base frame is its bars b1–b10 and the connections that cut them**: the posts b1–b4; the top rails b5, b6 (40x80 rolled 90°) and b7, b8 between them; the base rails b9, b10; the cart's c1 and c2 (posts and side rails butt through the front and back top rails) and c5–c8 (base rails butt through the posts) | It is the frame the rest of the cart hangs on, and it is self-contained: no other entity of the cart changes these bars' cuts or machining (**verified**: `src/core/base-frame.test.ts` derives the cart and the fixture and finds b1–b10 identical but for connection ids, the same cut list lines and the same lengths per BOM line) |
| 2 | The **CLI-built fixture** is `tests/fixtures/base-frame/cli`: `build.json` applied with `alukit do` to `empty/` (the cart's catalogs, defaults and params, no entities); its `expected-cutlist.json` and `expected-bom.json` are the CLI's own output, kept out of Biome's formatting like the cart's order golden | The done-when compares outputs, so the oracle is what the CLI prints; a test rebuilds the fixture and reprints them |
| 3 | The script (`tests/e2e/draw.spec.ts`) draws on `empty/` and compares `alukit cutlist` and `alukit bom --format json` of the drawn project, restricted to b1–b10, with the fixture's; the drawn project holds nothing else, so the whole output is also compared, byte for byte | (**verified**: passes; four posts 860, b5 and b6 1200, b7 and b8 440, b9 and b10 1120, as in the cart) |

## Drawing (§8 Tools)

| # | Decision | Why |
|---|---|---|
| 4 | The gesture is click, then click or a typed length with Enter; it commits as one `POST /api/commands` (`source: "ui"`): `addBar`, then an `autoConnect` at each end | §7.1: a tab holds no unsaved state, a gesture is one step |
| 5 | `autoConnect` takes `optional: true`: where nothing butts it does nothing instead of refusing, so the draw tool sends one per end without guessing the rule itself | A refusal would fail the whole batch; repeating §4.5's rule in the browser would be a second copy of it |
| 6 | Auto-connect is a check box of the draw tool, on by default | §4.5's rule makes a vertical the through bar, so a rail drawn onto a post's top butts into the post. The cart has its posts under the top rails; a person drawing that turns auto-connect off for the rails and joins them with the connect tool, as the script does |
| 7 | Snap targets: nodes, bar ends (design points), face centres (each face's centre line at half the design length), and lines along each bar: its **design line**, each face's centre line, each groove's centre line; then the grid on the work plane | §8's list. The design line is added because a station with no face is a point on it (§4.3), as the cart's stations on b9 and r1 are |
| 7a | The view model carries what snapping reads, and the browser builds the targets from it (`src/viewer/snap.ts`): the derived frames, placed boxes, design points and nodes it had, plus each section's grooves and datums, now in `display.sections` | The targets follow from derive's numbers by a few lines of arithmetic per bar; sending them would multiply the model's size by the lines per bar |
| 8 | A point within 10 px wins over a line (a face centre within 6 px); a line within 7 px; targets drawn on top of each other go to the one nearer the eye. A station lands on the 10 mm grid along its line | Ends and nodes are what one closes on; a tie on screen (a face seen edge on) must not pick the hidden face |
| 9 | Points are written as the document would: a node by id; another bar's end **as that end is written** (a point written with params keeps them); a point on a line as a station `{ on: { bar, at_mm, face \| groove } }`; anything else as coordinates to 0.01 mm. A typed length from an inline start adds to its written coordinate, so `[0, 0, "H"]` + 1200 along X is `[1200, 0, "H"]`. A pattern copy's points are coordinates | §4.3, and §1: one model, where params keep driving what is drawn from them |
| 10 | The axis is the world axis through the start whose screen image passes nearest the pointer. On a snap line, if an axis through the start crosses it (within 0.5 mm) the end is that crossing, written as a station at it | Exact meeting points: a base rail drawn along X from one post ends exactly on the other's line |
| 11 | Once digits are typed, nothing pulls the line: the length goes along the axis under the pointer, and the preview shows the typed length | A face centre near the axis would otherwise turn the typed length toward it (**verified** while building, on the cart) |
| 12 | The anchor cycle is `c`, the four corners, the four faces, then the section's datums; R turns the roll a quarter. A palette bar that lacks the anchor in use (a rail's `mount` on a T-slot) starts from `c`. The preview uses derive's own frame and anchor rule (`barFrame`, `anchorPoint`, moved to `src/core/derive/frame.ts` so the browser can import them) | One rule, so the preview is where the bar lands |
| 13 | **The work plane is the ground (world XY) by default**, as the brief says; W then a click on a bar picks that face's plane (a slab test of the ray against the bar's placed box between its end planes, analytic); W again returns to the ground. Shift frees the line in the work plane moved to the start | Design §8 says "the plane through the start point facing the view's dominant axis"; that plane changes as the camera turns, which the brief's ground avoids. Flagged for the design |
| 14 | Picking a bar or a bar end (connect, pattern's `along`, W's face) raycasts the drawn bodies: it picks an entity, which §8's "analytic, not a raycast" does not cover (that is about snap targets). Connect picks an end in a bar's outer quarters, the bar in its middle half | One click on the body names the end meant |

## Connect, place part, pattern, measure

| # | Decision | Why |
|---|---|---|
| 15 | Connect builds one connection per Apply: a butt from a bar and ends (or, with ends only, through the first end picked, §4.5's "bearing on an end"); a miter or splice from two ends; a resting `face` connection from two or more bars. Pivots and fastened face joints are left to `alukit do`; editing an existing connection is the properties panel's, later | §8 lists the pivot's picks (a face and the ends it carries) and the face joint's fasteners, which need more fields than one panel holds well; the base frame needs butts only |
| 16 | Place part snaps only to face and groove stations, takes the palette's part, and lets the distance be typed from either end, with a roll in quarter turns | §4.7: a part lands on a face or groove station |
| 17 | Pattern takes the selection as its template (pattern copies left out), the bar clicked (or a bar or run typed) as `along`, a pitch and a count | §4.7 |
| 18 | Measure (§8) is built: two snapped points, the distance and its components | It reuses the snapping |
| 19 | "Set as palette" fills the palette's bar (for the draw tool) for a bar item, its part (for the place tool) for any other kind, with options the card offers chosen or left to the project's defaults; it switches to that tool | §8's palette; one palette per tool that uses one |

## The catalog browser and its API

| # | Decision | Why |
|---|---|---|
| 20 | `GET /api/catalog` (vendor › kind › family with counts), `/api/catalog/items` (search; each bar with a thumbnail coarsened to 1 % of its size, fidelity and mass per metre), `/api/catalog/item` (a card: key data with provenance, the section as drawn, anchors, options, offers) | The list needs no request per card; the card has what §8 names |
| 21 | A **family** is a bar's system, else its shape; a connector's, fastener's or accessory's subtype; a carriage's rail system; a generic item's category | The catalogs have no family field; these are how their items group |
| 22 | The browser shows the catalogs the document names, not those linked in only because another refers to them (the test catalog pulls in `ref-test`, `ref-hiwin` and `forseti`); an item the lock pins that no named catalog holds is shown from the lock | §4.2's `catalogs` is the project's choice; the lock keeps what the project uses browsable without its catalogs (§4.13). `openCatalog` now returns the ids it was asked for (`named`) |
| 23 | The host keeps the live catalogs it last opened; a browse more than 5 s after that opens them again | M4a decision 13 opens them per batch; search-as-you-type should not reread every file each keystroke |
| 24 | Search matches every word in the id, code, name or family, ignoring accents and case; an exact id or code first, then codes that start with the query | Forseti's names are Portuguese |

## The camera

| # | Decision | Why |
|---|---|---|
| 25 | Two cameras under camera-controls, perspective and orthographic (wheel dollies one, zooms the other); switching keeps the apparent size at the target | §8 |
| 26 | Standard views: iso (from the front right, above: world (1, −1, 1)), top (world +Y up the screen), front, side (right), left, back, bottom; a document's named view wins over a standard one of the same name | §4.2, §8 |
| 27 | Fitting keeps the view's direction and puts every corner of the box in view with a margin (perspective: the distance each corner asks for; orthographic: the zoom). camera-controls' `fitToBox` was not used: it turns the view to the nearest axis (**read**: camera-controls 3.1.2, `fitToBox` rounds azimuth and polar to 90°) | An iso view must stay iso |
| 28 | The first model a tab gets is fitted at iso, even an empty one, which shows a metre cube of ground | M4a fitted only a model with bodies, so the first bar drawn moved the camera |

## `alukit snapshot` (§7.3)

| # | Decision | Why |
|---|---|---|
| 29 | It always renders in a **fresh headless page**, on the running server if there is one, else on an ephemeral one that holds the edit lock while it renders; never in a person's open tab | The brief reads "renders in the open tab if a server runs"; §7.3 says one code path from a fresh page that never depends on the user's camera, selection or a hidden tab (a hidden tab's animation frames are throttled). The design was followed; flagged for the design |
| 30 | The page is `?snapshot=<view>`: the viewport alone, the view set without animation, two renders, then `__alukit.snapshot()` says `ready` (or why not). SwiftShader, device scale 1. The CLI writes the PNG where `-o` says | §7.2: the server writes only inside the project. (**verified**: `tests/e2e/snapshot.spec.ts`, the same state twice, and on a running and an ephemeral server, gives identical images, 0 pixels differing; other views differ; an unknown view exits 1) |
| 31 | Playwright comes from the dev dependencies; without it the command says how to install it | AluKit runs from a checkout (§10); moving `@playwright/test` to dependencies is a packaging call for M5's skill install. Since the merge: `alukit skill install` links the checkout's skill, and a checkout has its dev dependencies, so it stays one |

## Fixes found on the way

| # | Fix | Why |
|---|---|---|
| 32 | The main area always takes the app's `1fr` grid row (rows 2 and 3 are the banners) | With no banner shown, it fell into an `auto` row and its height followed its content: an empty project's viewport was 150 px tall (**verified** in the draw script) |
| 33 | Keys go to the tools unless a text field, a list or an editable has focus; a focused check box or button no longer swallows them | Unticking auto-connect then pressing R did nothing |
| 34 | `window.__alukit` adds `screen(p)` (a world point on the page), `tool()` (the active tool, anchor, roll, the gesture's points and the hint) and `snapshot()`; still nothing secret and nothing that changes the project | The draw script points the mouse at world points and reads what the tool snapped to |

## Not done in M4b

- Dragging an existing node or bar end (a drag committed as one batch on release, §7.1): the
  gestures built are clicks; `moveNode` by drag comes with editing in place.
- Pivots and fastened face joints in the connect tool; parts at a world pose; patterns by a
  direction or offsets; the section clipping plane and placeholder hatching (left from M4a;
  M6 marks holes).
- A part's face as the work plane (decision 39).

## The merge into main, and what it folded in

Main had gained M6 (project items, the machining sheet, the viewer drawing plates, bent angles
and placeholders, G28) and M5 (variants, diff, revisions, the GLB writer, the skill, and
`src/mesh/`'s consolidation, which M6's drawing joined). Git met six conflicts (the README,
`biome.json`, the CLI's planned commands, the server's routes, its view model, the viewer's
scene); both sides were kept in each. Decisions 35–42 join M4b to them.

| # | Decision | Why |
|---|---|---|
| 35 | **One layout fix.** M4b (decision 32) and M6 (its note, "Found while checking by eye") fixed the same collapse the same way, `.main` in row 4 and the drawer in row 5. The rule stays on `.main` and `.drawer` themselves, with M6's explanation; M6's separate `.app > .main` and `.app > .drawer` rules are gone | One rule per element. The separate rules, more specific and earlier in the file, drew two Biome `noDescendingSpecificity` warnings (**verified**: `pnpm lint` clean; the draw script draws on an empty project at full height) |
| 36 | A section is built once, by `viewSection` in `src/mesh/display.ts` (`meshDisplay`, M5 decision 29), which now carries M4b's grooves and datums; the catalog card uses the same function. The GLB writer reads only a section's outline, so its bytes do not move | **Verified**: `glb.test.ts`, two exports byte for byte; `catalog.test.ts` |
| 37 | The interaction layer needed no change for M5's meshes: `pickAt` maps a hit on any instanced mesh to its entity, so a hole rod picks its plate; fitting to a selection boxes a part by its mesh, a plate or an angle as drawn. The tools' highlight colour joined the palette in `style.ts`, beside `selected` | **Verified**: the Playwright suite |
| 38 | **Snapping to parts.** Every placed part offers its datums (and its origin, unless a datum is there) and its face centres: a box's six; a plate's front and back at its outline's centroid, when that lies on the plate; a bent angle's four flats at the middle of each leg's flat (from R + T to the leg). They are written as coordinates (`{ kind: "part" }`), since a document point cannot name a part (§4.3). The view model's parts carry their item's datums (`display.parts[id].datums`) | Cheap: the frames, boxes and shapes were in the view model already. The place tool still takes face and groove stations only (decision 16). **Verified**: `interaction.test.ts`; `canvas.spec.ts` (since UX S0, `tools.spec.ts`) measures the cart's p8 from its top face centre to its origin, 110.00 mm |
| 39 | The work plane (W) still takes a bar's face only | A part's faces need a ray test per shape (a plate's outline, an angle's legs), not the box test a bar's uses; left for later |
| 40 | **The catalog browser lists the document's own items** under the vendor `project` (family: the material's id, else the kind), read only. The card gives what the BOM and the machining sheet read (material, thickness, legs, length, bend radius and blank, box, hole count, the mass with its source, the supplier, the price) and the item as the document writes it; no options, no offers. "Set as palette" places one like any part. The tree, the list and a project item's open card follow each revision | They are items the project places (§4.8); editing them is the commands' job. **Verified**: `catalog.test.ts`, the cart's three through the API; `canvas.spec.ts` (since UX S0, `catalog.spec.ts`), the plate's card in the app |
| 41 | `snapshot` sits with `diff`, `revision` and `export` (the publish group, in §7.3's order: diff, revision, snapshot, export), no longer with the server's commands; `pnpm skill` regenerated the reference. The skill's workflow names it, and its worked example ends with one. The unit suite runs the example without it, since it draws the built app and the gate runs the unit suite before the build; the end-to-end suite runs the example whole and checks the PNG (1600 × 1000, not blank). `src/cli/skill-example.ts` holds the example's parser for both | §7.5: the example runs as written, every command of it |
| 42 | Fixtures: `alukit lock update` and `fmt` leave `base-frame/cli`, `base-frame/empty`, the cart and G28 as they are | M5 and M6 changed no canonical form or lock entry the base frame uses |

**Test expectations changed by the merge.** None of M4b's or main's: M6 added no catalog to the
cart (`test-fab` is a supplier), so the browser's index and tree tests count as before, and the
project's items are a vendor of their own. Added: `skill.test.ts` checks that the example's one
command left for the end-to-end suite is its snapshot. **No golden value changed**: G1–G28, the cart's cut
list, BOM, order and machining sheet, G26's checks, the base frame's fixture and the draw script
against it, `/api/order` and the GLB's byte identity all pass as they were.
