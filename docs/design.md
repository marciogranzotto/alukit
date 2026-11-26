# AluKit: design (v1)

*Draft 1, 2026-11-26. Built from the decisions D1–D12 in `../BRAINSTORM.md`, the Forseti
survey `research/forseti-inventory.md`, and the lessons and wishlist from the reference project. No code
exists yet. Everything here is open to veto; section 13 lists the calls made without asking.*

## 1. Principles

1. **One model.** The project document is the only place a design lives. Everything else is
   derived from it: cut list, BOM, order list, checks, 3D view, GLB, and data for reports.
   The reference project wrote its geometry 4–5 times.
2. **One catalog source of truth, referenced by id.** A correction is made once and reaches
   every project and output.
3. **Every number carries its provenance**: the source, the date it was read, a tag, and a
   low/design/high range for estimates.
4. **Agents are first-class.** The format is documented, every edit is a command, and there
   is a headless CLI and a way for an agent to see the result.
5. **Deterministic.** The same inputs give byte-identical outputs on any machine.
6. **Explicit units.** Units are fixed per field, and field names carry them (`Ix_mm4`,
   `price_per_m_cents`).

## 2. Conventions

- **Units.** Length in mm, force in N, moment in N·mm, stress in MPa, mass in kg, angles in
  degrees in files, money as integer minor units (cents) plus the catalog's currency.
- **World frame.** Right-handed and Z up, like the Fusion design frame used for the
  reference project. Conversion to three.js (Y up) happens only in the scene's root transform. GLB export
  converts to glTF's Y-up metres
  ([glTF 2.0 §3.4](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#coordinate-system-and-units)).
- **Ids.**
  - Catalog items are `<catalog>:<item>`, e.g. `forseti:PF40-01`.
  - Project entities (nodes, members, joints, parts) have short stable ids (`n12`, `m7`,
    `j3`) plus an optional human `label` and `tags`.
- **Valued fields.** A bare number inherits its item's default provenance. An object adds
  per-field provenance:

  ```json
  "Ix_mm4": 91200
  "Ix_mm4": { "v": 91200, "src": "src", "ref": "pdf:catalogo_forsetiA4.pdf#p16", "read": "2026-11-26" }
  "J_mm4":  { "v": 120000, "low": 90000, "high": 150000, "src": "est", "note": "…" }
  "Iy_mm4": { "v": 655000, "src": "src", "ref": "…#p17",
              "corrected": [{ "date": "2026-11-24", "was": 65500, "why": "p.17 prints 6.55 cm4; lost digit (inferred)" }] }
  ```

  `src` is one of `src` (read from a source), `meas` (measured), `est` (estimated) or
  `calc` (computed). Values the tool computes, such as section properties, are **not
  stored** in a catalog. The tool derives them, and `alukit catalog show` prints both.

## 3. Catalogs

### 3.1 Layout

```
catalogs/<id>/catalog.json      vendor, currency, materials, groove types, systems, items (facts only)
catalogs/<id>/sections/*.json   profile outlines (large polygons), one file per profile
catalogs/<id>/families/*.json   per-family modelling (geometry, mounting, fastener sets) written by agents
catalogs/<id>/overrides.json    corrections and clone ratings, each with provenance
importers/<id>/                 the importer that regenerates catalog.json and sections/ (README, scripts)
```

A custom catalog has the same format and can sit anywhere on disk; a project lists the
catalog paths it uses. `catalogs/generic/` is hand-written: metric 20/30/40/45 series, so a
design can start before a supplier is chosen. Changing supplier then retargets by item
mapping. Vendor data is committed as facts only (D10). Vendor PDFs, images and verbatim
text stay in the gitignored `.cache/`.

### 3.2 Shared definitions

- **Material**: `E_MPa`, `G_MPa`, `nu`, `density_kg_m3`, `Rp02_MPa`, `Rm_MPa`, alloy and
  temper.
- **Groove type**: `opening_mm`, `lip_mm`, `depth_mm`, `undercut_mm`, and `class`
  (`standard` or `light`). item rates its T-nuts in standard grooves only.
- **System**: a series plus a groove type (e.g. `forseti:s40-c8`). It decides which
  connectors and T-nuts fit.

### 3.3 Item kinds and the fields v1 must carry

Fields marked † are needed only by later phases (D5), but the schema has them from day one.

| Kind | Fields |
|---|---|
| **profile** | `system`; `section` (a file ref: outline and holes in mm, about the nominal centre; local x = width, y = height); `grooves` [{face, offset_mm, type}]; `bores` [{x, y, d_mm, tap}]; published `area_mm2`, `Ix_mm4`, `Iy_mm4`, `J_mm4`†, `Wx_mm3`†, `Wy_mm3`†, `mass_kg_per_m`; `material`; tolerances† (straightness, twist; DIN EN 12020-2 / ABNT NBR 8116); `sale`: `cut-to-length` {min_mm, max_mm, tol_mm} or `bar` {lengths_mm}; `price_per_m_cents`, `cut_fee_cents`, `services` [{op, thread/d, price}]; `finishes` [{id, sku, name, price}] |
| **connector** | `subtype` (bracket, plate, end-connector, cube, gusset, hinge); `fits` [systems]; `geometry` (parametric or a mesh ref); `mounts` [{plane, holes}]; `hardware` [{item, qty}] (the fastener set it needs); `spacer_mm` (bodies between members, e.g. a cube); `requires` [machining on the joined members, e.g. end tap M8 plus an access hole]; ratings† per direction `F_N`/`M_Nmm` **with `safety_factor`**; `torque_Nm`, preload or K†, `slip_N`†, `stiffness`†; `mass_kg`, price |
| **fastener** | `thread`, `length_mm`, `head` (DIN/ISO), `class`, `material`, `torque_Nm`; T-nuts add `groove`, `insertion` (`drop-in` or `slide-in`) and ratings† |
| **linear-rail / linear-block** | dimensions, `hole_pitch_mm`, `E_mm`; blocks add `C_N`, `C0_N`, `MR/MP/MY_Nm`, `seal_N` (a maximum), `mu`, `preload`†; `clone_of` {maker, part, ref} when the vendor is a rebadger, whose ratings then carry a clone caveat |
| **panel** | `thickness_mm`, `material`, groove inset rules |
| **accessory** | feet, casters, handles, hinges: `thread`, `load_N` (or an explicit "not published"), dimensions |
| **drive†, damper†, anchor†** | pulley force and belt-skip force; energy per stroke, maximum force and force curve; ETA values |
| **placeholder** | name, price, mass, bounding box. Drawn as a placeholder, and it **blocks the order list** until it's replaced |

### 3.4 Computed against published

`alukit catalog check <id>` computes area, centroid, Ix, Iy and Ixy from each outline
([polygon formulas](https://en.wikipedia.org/wiki/Second_moment_of_area#Any_polygon)) and
mass from the density. It flags any mismatch beyond a tolerance (1% by default). The survey
found 16 inconsistencies in Forseti's data; this check makes such errors visible instead of
silent. J is computed later (v2) by Saint-Venant torsion on the polygon, which is FEM work
and out of v1.

## 4. Projects

### 4.1 Layout

A project is a folder, wherever its owner keeps it (D2, D9; the reference project's lives in its own repo):

```
<project>/alukit.json            the document
<project>/revisions/<name>.json  named revisions, frozen (4.5)
<project>/exports/               derived outputs (the project's own repo decides whether to ignore it)
```

### 4.2 The document

```json
{
  "schema": "alukit.project/1",
  "name": "Bench 1200",
  "catalogs": ["forseti", "../my-parts"],
  "defaults": { "profile": "forseti:PF40-01", "joint": { "type": "butt", "connector": "forseti:CANT-40" }, "finish": "c7" },
  "params": { "W": "1200", "D": "600", "H": "900", "rail_z": "H - 20" },
  "nodes":   { "n1": { "at": [0, 0, 0] }, "n2": { "at": [0, 0, "H"] }, "n3": { "at": ["W", 0, "H"] } },
  "members": { "m1": { "item": "forseti:PF40-01", "from": "n1", "to": "n2", "roll": 0, "anchor": "center", "tags": ["leg"] },
               "m2": { "item": "forseti:PF40-01", "from": "n2", "to": "n3", "anchor": "top", "tags": ["rail"] } },
  "joints":  { "j1": { "at": "n2", "type": "butt", "through": "m1", "butting": ["m2"], "connector": "forseti:CANT-40", "qty": 2 } },
  "parts":   { "p1": { "item": "forseti:SAP-M8", "on": "m1", "end": "from" } },
  "custom":  { "plate-a": { "kind": "plate", "material": "steel-1020", "thickness_mm": 4, "outline": [[0,0],[120,0],[120,80],[0,80]], "holes": [{ "at": [20,20], "d_mm": 8.5 }] } },
  "variants": { "base": {}, "tall": { "params": { "H": "1100" } } },
  "checks":  [ { "id": "C1", "expr": "bbox().z <= 950", "text": "fits under the shelf" } ],
  "open":    [ { "id": "O1", "text": "caster rating not published; ask Forseti", "blocks": "order" } ],
  "decisions": [ { "id": "D1", "date": "2026-11-26", "text": "40-series, not 30", "why": "…" } ],
  "views":   { "iso": { "pos": [2500, -2000, 1800], "target": [600, 300, 450] } }
}
```

- **Nodes** are points, as numbers or expressions. Members connect nodes, which makes the
  structure a graph: joints are explicit, and an agent can say "raise n2 by 100".
- **A member** is a catalog profile along its *design line* `from → to`.
  - `anchor` places the section relative to the line: `center`, a face or a corner, plus an
    `offset_mm`. Frames can then sit flush to an envelope, as profile location points do in
    [Onshape Frames](https://www.onshape.com/en/features/frames).
  - `roll` turns the section about its axis.
  - The local frame is deterministic: local z runs along the line. Local y points to world
    +Z for non-vertical members, and local x to world +X for vertical ones, before `roll`.
  - Manual machining goes in `ops`; joints generate more (5.2).
- **Expressions** use a tiny, safe language: arithmetic, params, and
  `min max round floor ceil sqrt sin cos atan2`. There is no JS `eval`. In `checks`,
  accessors read the derived model: `len(m3)`, `cut(m3)`, `bbox()`, `mass()`, `cost()`,
  `count(tag:leg)`.
- **Parts** attach to a member (`on`, `face`, `groove`, `at_mm` from a named end) or sit at
  a world pose. Attached parts follow their member.
- **Custom parts** (D11) are parametric, defined in the project:
  - a `plate` (outline, holes, thickness);
  - a bent `angle` (two legs, thickness, bend radius, holes per leg).

  Material comes from a catalog. Their price is entered, or left as an open item.

### 4.3 Variants (D11, wishlist 11)

A variant can override params, swap items (`"swap": {"forseti:PF80-01": "local:RHS-200x100"}`)
and omit tagged entities. The UI and CLI choose the active variant. `alukit diff
--variant a --variant b` compares any two.

### 4.4 Open items and decisions (wishlist 8, 11)

`open` entries with `blocks: "order"` (and every placeholder part) mark the order list as
**BLOCKED** and list why. `decisions` records each choice with its date and reason. Both
appear in the UI and the CLI.

### 4.5 Revisions (wishlist 1; lesson: "old revisions replay as published")

`alukit revision save "Rev 1.2"` writes `revisions/rev-1.2.json` holding:

- the document;
- **every catalog item it resolved, frozen**;
- the tool's version and the catalog content hashes;
- the git commit and dirty flag, when the project lives in git.

An old revision opens read-only and replays with its frozen data: a later price or
correction doesn't change what was published. The working copy always uses the live
catalogs. Git, wherever the project lives, keeps the full history. AluKit adds the
semantic diff.

## 5. The derived model (the solver)

`derive(doc, catalogs, variant) → Derived` is a pure function in `core/`.

### 5.1 Pipeline

1. **Resolve.** Apply the variant, evaluate params and node positions, and resolve item
   references. Unknown references are errors.
2. **Place.** Compute each member's frame and section pose from its line, anchor, offset
   and roll.
3. **Joints.** Compute trims and extensions per joint type (5.2), then each member's
   **cut length** and end treatments.
4. **Generate.** Expand machining from joint requirements (end taps, access holes), the
   hardware sets of connectors, and the T-nuts.
5. **Collect.** Build the cut list, BOM, order list and mass and cost totals.
6. **Check.** Evaluate the built-in and custom checks.

Every sum uses Neumaier compensated summation
([Kahan–Babuška](https://en.wikipedia.org/wiki/Kahan_summation_algorithm#Further_enhancements)).
Collections are processed in id order, and outputs round to 0.01 mm and whole cents. This
answers a past run where a Python upgrade moved a result by 0.2%.

### 5.2 Joint types (v1)

This is the trim and extend model of weldment and frame tools, made hardware-aware.

| Type | Geometry | Length effect | Typical hardware |
|---|---|---|---|
| `butt` | the end of each member in `butting` meets the face of `through` | butting members are trimmed to the face (plus `spacer_mm`) | brackets or plates (no machining); end connector (end tap and access hole generated); end-tap bolt |
| `tee` | a butt joint onto the span of `through` | same | same |
| `miter` | two members cut at the bisector | both end at the mitre plane | mitre connector |
| `cube` | members end at a cube body | each trimmed by half the cube size | cube corner |
| `lap` | one member rests on another's face | none | plates, brackets |

The draw tool creates the project's default joint when it closes on a node. A default rule
picks which member runs through, and it can be changed: verticals run through.

### 5.3 Cut list (two modes, per catalog `sale`, overridable per project)

- **cut-to-length**: the supplier cuts. Forseti cuts 40–3000 mm to ±1 mm. The output is a
  piece list per profile and finish, checked against the minimum and maximum length.
- **bar**: whole bars, cut by you. Pieces are nested into stock lengths, allowing for saw
  kerf. This is the 1D [cutting-stock problem](https://en.wikipedia.org/wiki/Cutting_stock_problem):
  first-fit decreasing in v1, an exact search when the pieces are few. The output gives
  waste per bar.

Every piece lists its machining **measured from a named end**, e.g. "tap M8 at end A; Ø7
access hole 20 mm from end A on face +y".

### 5.4 BOM and order list

- **BOM**: every item and quantity, grouped by kind, with mass and price.
- **Order list**: per supplier, with SKU (finish variant), name, quantity, unit, unit
  price, total, cut pieces and machining services. **BLOCKED** while open items or
  placeholders remain (4.4).
- Output as Markdown, CSV or JSON.

### 5.5 Checks in v1

| Check | What it catches |
|---|---|
| Schema and references | invalid documents, missing items |
| Joint completeness | a node with several members and no joint |
| Fit | the connector or T-nut doesn't fit the member's groove type |
| Lengths | cut length ≤ 0, or outside the supplier's range |
| Custom expressions | `checks` from the project |
| Open items | unresolved items and placeholders |

Interference and clearance arrive in v1.1. Loads, tool access and fabrication rules arrive
in v2 (BRAINSTORM roadmap).

## 6. Commands (the one edit path)

Every edit is a JSON command, `{ "cmd": "addMember", "args": {…} }`. It is a pure function
from document to document, and it records its own inverse for undo. Batches apply
atomically. The UI, the CLI and agents use the same commands.

| Group | Commands |
|---|---|
| Structure | `addNode` `moveNode` `addMember` `setMember` `splitMember` `removeEntity` |
| Joints | `setJoint` `autoJoints` |
| Parts | `addPart` `setPart` `addCustom` |
| Params | `setParam` |
| Organising | `tag` `label` |
| Records | `addVariant` `setVariant` `addCheck` `addOpen` `resolveOpen` `addDecision` |
| Views | `saveView` |

Agents work at this level of meaning, so they never compute joint deductions by hand.

## 7. Agent interface

- **Files.**
  - `alukit.json` validates against a published JSON Schema, generated from the Zod
    schemas ([Zod JSON Schema](https://zod.dev/json-schema)).
  - An agent may edit the file directly. The server watches it, and the open tab reloads
    it.
  - If the tab has unsaved edits, a conflict banner offers a choice. Nothing is lost
    silently.
- **CLI** (`alukit`, Node, the same core library). `--json` gives machine output, and the
  exit code is non-zero when checks fail.

  | Command | Does |
  |---|---|
  | `alukit new <dir>` | creates a project |
  | `alukit serve <dir>` | runs the local server and opens the tab |
  | `alukit check <dir>` | validates, derives, and runs the checks |
  | `alukit bom` / `cutlist` / `order <dir> [--variant v] [--format md\|csv\|json]` | the outputs |
  | `alukit derive <dir> --json` | **the whole derived model, for report builders** (external report builders read this instead of re-deriving geometry) |
  | `alukit do <dir> '<command json>'`, and sugar such as `alukit add member --item … --from n1 --to 0,0,900` | edits |
  | `alukit query <dir> <selector>` | e.g. `tag:leg`, `m7`, `joints at n2` |
  | `alukit diff <a> <b>` | files, `git:<ref>:<path>`, revisions or variants: which parts and numbers moved |
  | `alukit revision save "<name>"` | 4.5 |
  | `alukit snapshot <dir> --view iso [--size 1600x1000] -o shot.png` | lets an agent see what it built |
  | `alukit export glb <dir> -o x.glb` | GLB export |
  | `alukit catalog search\|show\|check <…>`, `alukit catalog import forseti` | catalog work |

- **Local server.** Built on `node:http`, bound to `127.0.0.1` only. It serves the app and
  `/api/*`, and pushes events to the tab over
  [Server-Sent Events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events)
  (no websocket dependency).
  - **When a tab is open, the tab owns the document.** CLI commands route through the
    server to the tab, so you watch them happen and can undo them. The tab writes the file.
  - **With no tab open**, the CLI works headless on the file, under a lock file.
  - `snapshot` renders in the open tab if there is one, and otherwise in headless Chromium
    through Playwright.
- **Skill.** `skills/alukit/SKILL.md` in the repo documents the format, the commands and
  the conventions. `alukit skill install` links it into `~/.claude/skills/`, so it works
  from any repo, including the ones where projects live. An MCP server comes only if
  the CLI proves insufficient.

## 8. Viewer and UI

### Layout

| Area | Holds |
|---|---|
| Top bar | project, variant, undo and redo, save state, revision, export |
| Left | catalog browser (vendor › kind › family, search, item cards with a section thumbnail and key data) and the project tree (by tag or kind) |
| Centre | the 3D viewport: perspective or orthographic, standard views (top, front, side, iso), a section clipping plane, grid |
| Right | properties of the selection. Every number has a provenance popover; derived values (cut length, mass, price) are shown read-only |
| Bottom drawer | Cut list · BOM · Order · Checks · Open items · Params · Decisions |

### Tools

- **Select**: click or box select, or by tag.
- **Draw member**:
  1. Click a snap point.
  2. The line follows the axis, inferred X, Y or Z (Shift frees it).
  3. Type a length and press Enter.
  4. R rolls the section and A cycles the anchor. The profile comes from the palette.
- **Place part**.
- **Measure**.

Snap targets are nodes, member ends, groove centre lines (projected), face centres and the
grid (10 mm by default). Snapping is analytic, from the derived model, not a raycast against
meshes. The camera is [camera-controls](https://github.com/yomotsu/camera-controls), with
orthographic views and fit to selection.

### Rendering

- One unit-length extruded geometry per profile, built from its real outline, then
  `InstancedMesh` per profile and finish, scaled along the axis.
- Mitred members get their own geometry. Holes are drawn as markers, not booleans, in v1.
- Edges come from `EdgesGeometry` per profile.
- Hardware uses simple parametric meshes, or a GLB per item where one exists.
- Placeholders render translucent and hatched.

### Targets

1,000 members and 5,000 hardware items at 60 fps on an M-series Mac. A full derive under
50 ms for 1,000 members; incremental derive comes later if needed.

## 9. Exports

- **GLB.** Z-up mm converts to Y-up m at the root. One node per member or part, named
  `<id> <label|item>`.
  - `extras`: id, item, SKU, cut length.
  - The `asset.extras` stamp: AluKit version, project revision, git commit and dirty flag.
    This answers the "published page traced to no commit" lesson.
- **BOM, cut list and order list** as Markdown, CSV or JSON.
- **`derive --json`**, the full derived model for external report builders.

STEP, DXF flats and a self-contained report come in v2 (D6).

## 10. Repository layout and stack

```
src/core/      schema (Zod), expressions, commands, derive, joints, cut list, BOM, checks, diff, section properties
src/catalog/   loading, validation, computed-vs-published, search
src/viewer/    three.js scene sync, tools, snapping, picking
src/ui/        Preact panels
src/server/    node:http + SSE (also mounted as Vite middleware in development)
src/cli/       the alukit CLI
catalogs/      forseti/, generic/
importers/     forseti/ (Python + PyMuPDF; the PDF vector extraction proven in the survey)
skills/alukit/ SKILL.md
docs/
tests/e2e/     Playwright (unit tests sit next to the code)
```

Versions as of 2026-11-26 (measured with `npm view`):

| Package | Version |
|---|---|
| three | 0.187.0 |
| vite | 8.4.0 |
| preact | 11.2.0 |
| @preact/signals | 2.11.4 |
| zod | 4.6.7 |
| camera-controls | 3.1.2 |
| vitest | 5.1.2 |
| @playwright/test | 1.65.1 |
| @biomejs/biome | 2.6.9 (lint and format: one fast binary instead of ESLint + Prettier) |
| typescript | 7.0.2 (type-check only; Vite transpiles) |

Package manager: pnpm 10.12.

- **TypeScript is erasable-syntax only** (`erasableSyntaxOnly`: no enums or parameter
  properties), so Node runs the CLI's sources directly with type stripping.
- **Node**: the machine has 22.16, where type stripping is still behind a flag. M0 verifies
  Vite 8's Node requirement and proposes Node 24 LTS if needed.

## 11. The Forseti catalog (D4)

1. **Bulk import** (a script, deterministic).
   - Fetch the Store API products and variations, and classify them with the survey's
     rules.
   - Parse descriptions for kg/m, maximum length, groove and tap.
   - Emit facts with provenance (shop URL, read date).
2. **PDF.**
   - Map pages to families and parse the tables (A, Ix, Iy, kg/m).
   - Extract section outlines from the vector paths. This works for only **8 of the roughly
     20 catalogue profiles**. On those, the 40x40 is within 0.1% of the catalogue, and
     Claude re-checked it.
   - The other profiles need raster tracing, CAD from Forseti's GrabCAD (downloaded by
     Marcio, because GrabCAD blocks automated access), or a parametric redraw. *(Corrected
     2026-11-26; was "the 3 profiles without vector outlines", per review M6.)*
3. **Family modelling by agents.**
   - For connectors, fasteners, linear parts and accessories, one agent per family reads
     the catalogue and shop pages. It writes `families/*.json` (geometry parameters,
     mounting, fastener sets, fits, ratings) with provenance.
   - A second agent reviews it independently (a lesson from the reference project).
   - The parts the reference project uses go first, then the rest.
4. **Overrides.** Corrections (the 40x80 Ix/Iy, the 40x40 fechado's mass) and clone ratings
   (HIWIN HG for the HGR/HGH rails and blocks) go in `overrides.json`, each with its
   provenance.
5. **`alukit catalog check forseti`** produces the computed-vs-published report.

## 12. v1 milestones (to be detailed into a plan after review)

| M | Delivers | Done when |
|---|---|---|
| M0 | Scaffold: Vite + TS + Preact + three, Biome, Vitest, Playwright; the CLI entry; the server skeleton | `pnpm test` and `pnpm dev` work; the empty viewer renders |
| M1 | Catalog schema, loader, section properties, `catalog check` | the 40x40 básico computes 553.5 mm² and 9.13 cm⁴ from its outline |
| M2 | Forseti import: bulk, profiles with outlines, overrides; family modelling for the reference project's parts | every Forseti product present; profiles complete; those parts modelled and reviewed |
| M3 | Project schema, expressions, commands with undo, derive (joints, generation), cut list, BOM, order list, checks, CLI | a scripted bench project derives the right cut lengths in tests |
| M4 | Viewer: rendering, selection, properties, catalog browser, draw tool with snapping, live file sync over SSE | a frame drawn by hand matches the same frame built by CLI |
| M5 | Variants, diff, frozen revisions, decisions, GLB export, `snapshot`, the skill | an agent builds, checks and snapshots a frame using only the skill |
| M6 | Custom plates and bent angles; placeholders; open items blocking the order | all D11 items are in |
| **Acceptance** | **the reference project's frame modelled (in its own repo), and its cut list, BOM, mass and cost compared with its hand-built record** | the differences are explained |

## 13. Calls made without asking (veto any)

1. Z-up mm world (the Fusion frame); conversion only in the scene and GLB.
2. The UI is in English; vendor names stay as published (Portuguese).
3. Desktop, mouse and keyboard only, for editing in v1. The Quest sees the GLB.
4. One JSON file per project, plus `revisions/`.
5. A small safe expression language, not JavaScript.
6. The default joint is a butt joint with an angle bracket (no machining). Verticals run
   through.
7. Importers may be Python (PyMuPDF is the right tool for PDF vectors); the tool itself is
   TypeScript.
8. SSE and fetch rather than websockets; the server is bound to localhost only.
9. Biome instead of ESLint + Prettier; TypeScript 7 for type-checking.
