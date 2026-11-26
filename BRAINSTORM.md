# AluKit: brainstorm

*Started 2026-11-26 as "build-planner". Named **AluKit** the same day (D12). No code yet.
This file holds the decisions and the ideas. The design that follows from it is in
`docs/design.md`.*

## The pitch

A browser tool, built on three.js, for planning frames and machines made from catalog
systems, with aluminium T-slot extrusion first. You lay out the structure in 3D. The tool
gives you what you need to build it: the cut list, a priced BOM from real suppliers, the
machining on each bar and the assembly order. Agents can drive it as well as you can.

## Decisions (Marcio, 2026-11-26)

| # | Topic | Decision |
|---|---|---|
| D1 | Audience | Marcio first, for his own builds. It runs in the browser on a local server, with no hosting. |
| D2 | First project | The reference project, an internal lab rack. **Projects are never committed to this repo** (`projects/` is gitignored); the repo holds only the tool. |
| D3 | Interaction | Drawing in 3D, and a good way for agents to drive it. Both are first-class. |
| D4 | Catalog | Custom catalogs can be created and imported. The first one is **all of Forseti's catalog**, built by an agent. |
| D5 | Depth | v1 is building with a catalog; simulation comes later. **Catalog entries carry all the technical data simulation will need from the start.** |
| D6 | Export | GLB in v1; STEP later. |
| D7 | Stack | Claude's choice; lightweight and fast. **Not based on openPlan3D.** (See the stack section below.) |
| D8 | Home | Marcio's GitHub account, marciogranzotto. |
| D9 | Reference project | It lives in its own repo, versioned with the rest of that work. The tool opens projects from any folder. |
| D10 | Vendor catalog data | **Committed**: the facts (numbers, SKUs, prices with their read date, source URLs and pages) and the extracted section geometry. Forseti's PDF, images and description text stay in the gitignored `.cache/`. |
| D11 | v1 scope | Keep the three wishlist items in v1: parametric custom parts, variants side by side, and an order list that blocks on open items. |
| D12 | Name | **AluKit** (Marcio, 2026-11-26). The repo is `marciogranzotto/alukit` and the CLI is `alukit`. |
| D13 | Visibility | **The repo is public** (Marcio, 2026-11-26). Internal specifics of the reference project stay in the gitignored `internal/`, on Marcio's machine only. |
| D14 | Model scope | **Widen the model** (review B2): anything sold by length (T-slot profile, steel tube or RHS, rod, flat bar, linear rail) is a *bar* with a section and a cut length; face-to-face connections; parts placed at a position along a bar; patterns and splices. Moving parts stay in v3. |
| D15 | Node | Whatever version is needed, switched with **nvm**. The repo pins Node 26 (the current LTS) in `.nvmrc`; M0 verifies the stack on it and falls back to 24 LTS if something breaks. |
| D16 | License | **MIT**: anyone may use anything, as long as the copyright notice (the attribution) stays. |
| D17 | Design draft 2's calls | Kept all four (Marcio, 2026-11-26): the lock file pins catalog data; prices default to regular and estimated prices block the order; no constraint solver in v1; the design keeps its full length. Building starts in autonomous mode with subagents. |

## Why: the evidence from a real build

The reference project, a lab rack about 5 m long, is exactly this kind of build. Planning
it by hand took:

- a Fusion generator script of about 10,000 lines. All its dimensions live in one
  parameter set, and a `derive()` step computes the rest and asserts the clearances;
- bought-part models with every dimension tagged `[src]`, `[meas]` or `[est]`;
- section polygons and three.js pages built by hand;
- separate cost models, BOMs, sheet-metal flats, report builders, and a long design log.

The project is internal, so its files stay out of this repo (D2, D13).

### Lessons from building it by hand (the agent that built it, 2026-11-26)

- **The same geometry was written 4–5 times**: the Fusion generator, the 3D-page
  generators, the calc scripts, the BOM csv/md and the report SVGs. Only tests held them
  together; one test checks 224 figures in the docs against the model.
  → **One model.** Every output is derived from it.
- **One catalogue correction (a rail seal's resistance) touched about 10 files and 5
  published pages.** → **One catalog source of truth, referenced by id.**
- **Cut lengths and hole positions were worked out by hand** (struts cut square between
  hinge pivots, holes measured from a named end). → The tool computes them.
- **Tool access was caught only by a reviewer**: fastening sets nobody could tighten,
  too close to a wall. → A **tool-access check** (wrench clearance) alongside the T-nut
  pre-load check.
- **Published pages traced to no commit** (builders drifted into scratch folders).
  → Every export is stamped with the tool version and the project revision.
- **item's Engineering Tool has no API**, and a reload lost the work. This confirms D3:
  the agent API is a core feature.
- **Section outlines were hand-built**: a box less rectangular slot tools, and the
  reinforced 80x80 drawn with the basic outline. Extracting real outlines from the PDF
  would be an improvement.
- **Keep**:
  - `derive()` asserts with open-check floors;
  - comparing configurations against each other: the tool should support a project's
    **variants** (e.g. rail type or frame material) and diff them;
  - placeholders shown as placeholders (parts not yet in the catalog);
  - named camera shots for screenshots;
  - build stamps;
  - old revisions that replay as published;
  - independent review rounds.
- **Change**:
  - semi-rigid joints in the model from the start;
  - **a requirements sheet first**: project requirements become checks;
  - **deterministic maths**: compensated summation and fixed steps (Python 3.11 against
    3.12 moved one result by 0.2 %);
  - label-collision checks in figures.

## What's already out there

| Tool | What | Gap |
|---|---|---|
| [item24 Engineering Tool](https://tools.item24.com/MXen/tools/engineeringtool/) | item's own configurator | **Tried by Marcio:** no custom catalog, and the interface doesn't let you do much |
| [MISUMI FRAMES](https://us.misumi-ec.com/blog/aluminum-extrusion-design-frames/) | Free frame modeller, BOM and ordering through MISUMI | MISUMI parts only; appears to be a download (search results, not tried) |
| [TSLOTS TBUILD](https://www.tslots.com/tbuild-design-software) | Web-based, BOM with real-time pricing | One supplier (search results, not tried) |
| [Onshape Frames](https://www.onshape.com/en/features/frames) | Frame feature with standard profiles and a [cut list](https://cad.onshape.com/help/Content/frame_cut_list.htm) | Full CAD; no hardware logic or local pricing |
| [SOLIDWORKS 3D Structure Creator](https://blogs.solidworks.com/products/solidworks/create-manufacturing-ready-structure-designs-with-web-based-3d-structure-creator/) | Browser, on 3DEXPERIENCE, cut list | Expensive, general-purpose |
| [ConstructFrame (hofk)](https://discourse.threejs.org/t/construction-of-frames-with-contour-profile/13490) | three.js frame-from-profile geometry | Geometry only |

**The gap:** none of these does all of the following: lets you bring your own catalog
(custom and imported), knows local suppliers and their BRL prices, mixes systems, carries
engineering data, and can be driven by an agent.

## The document model (the core)

The design is a graph, not a pile of meshes. Everything else is derived from it.

- **Member**: a catalog profile placed along a segment, with a roll angle, an anchor
  (centre or a face), end treatments (square, mitre, tapped, counterbored) and machining
  (access holes, cross holes).
- **Joint**: where members meet. The joint type picks the hardware (bracket, joining plate,
  anchor or end connector, cube corner) **and changes member lengths**. A butt joint takes
  the abutting profile's width off the bar. The tool owns that arithmetic.
- **Hardware and accessories**: T-nuts (drop-in or slide-in), bolts, panels (inset to the
  slot depth), feet and casters, hinges, linear rails and blocks.
- **Parameters**: named variables with expressions (`width = 1200`), the `P` / `derive()`
  pattern from the reference project's generator.
- **Checks**: first-class assertions ("clearance A to B ≥ 25 mm"), re-evaluated live.
- **Provenance**: every catalog number keeps its `[src]`, `[meas]`, `[est]` or `[calc]` tag
  and its source (URL and page).

## Agents drive it: one command layer, three fronts

- **The project file is the API.** A project is a folder holding JSON, validated by a
  published JSON Schema. An agent can read and edit it directly, and the open tab reloads
  live.
- **One command layer.** Every edit (`addMember`, `setJoint`, `setParam`, `moveNode`, ...)
  is a command in the core library: undoable, and the same whether it comes from the UI,
  the CLI or an agent. Agents call semantic commands, so they never compute joint
  deductions by hand.
- **CLI** (Node, same core): `check`, `bom`, `cutlist`, `query`, `add ...`, `export glb`,
  and `snapshot --view iso -o shot.png` so an agent can see what it built. When a tab is
  open, the CLI acts through the local server and the edits appear live, with undo.
  Without a tab it runs headless.
- **A Claude Code skill** in the repo documents the format and the CLI. An MCP server is
  added only if the CLI proves insufficient.

## The catalog

- One package per supplier: `catalogs/<vendor>/`, holding JSON plus section geometry.
  There will be an **in-app catalog editor** (define a profile from a DXF section or by
  drawing it; the tool computes A and I) and **importers** (JSON, CSV, DXF for sections,
  vendor importers).
- **Simulation-ready fields from day one (D5).** The list below is what the reference
  project's calculations needed.
  - *Profile*:
    - geometry: section polygon with holes; groove type (standard or light, because item
      rates its T-nuts in standard grooves only), with opening, depth and lip; centre bore,
      and whether it can be tapped;
    - section properties: A, Ix, Iy, Wx, Wy, torsion constant J, centroid, kg/m;
    - material: E, G, ν, Rp0.2, fu;
    - tolerances: straightness and twist (DIN EN 12020-2);
    - commercial: stock and maximum length, finishes, price per metre, cut fee.
  - *Connector*:
    - permissible F and M by direction, **with its safety factor** (item uses over 2, but
      1.5 for T-nuts);
    - tightening torque, preload (or the K factor), slip capacity, stiffness (joints are
      semi-rigid);
    - the grooves it fits, its hole pattern, the length deduction, mass and price.
  - *Fastener*: thread, length, head, strength class, drop-in or slide-in, torque.
  - *Rail and block*: C, C0, M_R / M_P / M_Y, seal resistance per end seal (a maximum),
    μ, preload class, dimensions, hole pitch.
  - *Drive*: pulley force, belt-skip force, the gearbox's allowable radial load.
  - *Damper*: energy per stroke, maximum force, stroke, force curve.
  - *Anchor*: ETA values.
  - *Accessory*: load ratings.
  - **Every field** records its source URL, page, the date it was read, a
    `[src]`/`[meas]`/`[est]`/`[calc]` tag, and **low / design / high** for estimates. A
    correction is recorded in place as "(corrected <date>; was X)".
- **The tool computes A, Ix, Iy (and later J) from the polygon itself** and flags any
  mismatch with the published values. The prior record shows why: Forseti's catalogue
  p. 17 gives the 40x80 básico IX 17.76 and IY 6.55 cm⁴, which can't be right for the
  strong axis (noted in the reference project's record).

### What Forseti publishes (measured 2026-11-26)

- The shop is WooCommerce with the public **Store API**: 495 products in 34 overlapping
  categories, with SKUs (e.g. `PF40-01-c7`), BRL prices, and descriptions holding some
  data (the 40x40 básico: 1.482 kg/m, a **3 m maximum bar**, Canal 8, centre tappable to
  M16, tolerances per ABNT NBR 8116).
- Section properties and drawings are in the PDF catalogue
  ([catalogo_forsetiA4.pdf](https://www.forsetisolucoes.com.br/catalogo_forsetiA4.pdf),
  Dec 2022): alloy 6063-T5, E 69,000 MPa (p. 6); profiles from p. 10.
- **The full survey is in `docs/research/forseti-inventory.md`** (agent, 2026-11-26).
  Raw dumps, the scripts and `out/inventory.csv` (1,493 rows) are in `.cache/forseti/`.
  - **Inventory** (products / variations): 495 products and 998 variations, 1,196
    orderable SKUs. Variations come only from `products?type=variation`.

    | Kind | Products / variations |
    |---|---|
    | Linear motion | 130 / 343 |
    | Connector | 84 / 134 |
    | Accessory | 75 / 155 |
    | Fastener | 65 / 272 |
    | Profile | 46 / 2 (25 stems: series 20/30/40/45/50/80) |
    | Electronics | 34 / 10 |
    | Other (panels, cable chain, tools, kits) | the rest |

    Tecmaf is a separate brand (44 products).
  - **Exact sections come from the PDF's vector paths.**
    - The 40x40 básico's drawing on p. 16 is one path of 856 segments. Scaled from its
      40 mm width, it gives A 553.5 mm² and Ix/Iy 9.129/9.131 cm⁴, against the
      catalogue's 553 and 9.12. Claude re-checked these from the extracted polygon.
    - **Only 8 of the roughly 20 catalogue profiles have a vector outline** (p. 11, 14,
      15, 16 ×2, 18, 19, 21). Of those, 6 agree within 1%; the 40x40 leve and the 20x60
      are off by 3–4%.
    - The rest, including the 40x80, the 40x40 fechado and the 80x80 básico, need raster
      tracing, Forseti's CAD (GrabCAD, or an unlinked IGES such as `PF30-02zip.zip`), or a
      parametric redraw. *(Corrected 2026-11-26; this said only those 3 lacked an outline.
      The survey said 8 of about 20; review M6 checked every page.)*
    - **J can be computed from the polygon.**
    - The reference project's polygons were a parametric drawing, 40% above the real
      area. Its record already notes this as a drawn envelope, not section data.
  - **Sold cut to length** (40–3000 mm, ±1 mm, priced per metre). Machining (holes,
    threads, mitres) is priced outside the API, in a 56-page services guide. So for
    Forseti the cut list becomes a cut-to-length order. Stock-bar nesting is for
    suppliers that sell whole bars, or for cutting your own.
  - **Gaps**: Forseti publishes no J, Wx or Wy, strengths, torques, connector loads or
    slip, joint stiffness, rail or block ratings (its HGR/HGH match HIWIN's HG family; the
    caveat is clone ratings), or foot ratings. Caster ratings appear on only 2 listings.
    EN 755-2 values still need verifying from the standard.
  - **16 inconsistencies** were found in the catalogue and shop. Examples: the 40x80
    strong-axis inertia, printed 6.55 for 65.5 cm⁴, a lost digit; *(corrected 2026-11-26 by M2a,
    checked on five drawings: the labels are not swapped, since the catalogue always gives IX about
    the long side)*; the
    40x40 fechado's mass; PF30-04 at 0.816 kg/m in the catalogue against 1.2 in the shop.
    These argue for the tool's own computed-versus-published check.

## Outputs

- **v1**:
  - a cut list, in one of two modes per supplier: a cut-to-length order (Forseti cuts
    40–3000 mm to ±1 mm), or nesting into stock bars allowing for kerf (the 1D
    cutting-stock problem) for whole-bar suppliers or self-cutting;
  - a priced BOM per supplier (CSV);
  - a per-bar machining sheet;
  - GLB (for Blender on the Windows PC, openPlan3D or the Quest);
  - JSON.
- **Later**: STEP (OpenCascade WASM through [replicad](https://replicad.xyz) or
  [opencascade.js](https://ocjs.org), lazy-loaded; not yet evaluated), DXF, an assembly
  order with the T-nut pre-load check, exploded views.

## Roadmap

The agent that built the reference project sent a 14-item wishlist at Marcio's request. It's mapped here onto
phases that respect D5 (v1 builds with a catalog; simulation later) and D6 (GLB first).
Wishlist numbers are in brackets.

| Phase | Scope |
|---|---|
| **v1: build with a catalog** | A documented JSON format, CLI, named revisions and **diffs that show which parts and numbers moved** [1]. Several vendors side by side (Forseti first; item, Bosch, local RHS and W beams as catalogs), plus **parametric custom parts**: a plate or bent angle with holes and thickness [2]. Joints with length deduction. An **order list** (cut lengths, holes from a named end, article numbers, supplier, BRL price, mass, and **open items that block ordering**) [8]. Provenance on every number [12]. Headless, deterministic, explicit units, tests [14]. GLB export. Variants side by side, with decisions and their reasons [11]. |
| **v1.1: requirements and space** | Requirements first (envelope, counts, masses, travel), checked automatically [6]. Static space checks: walls with a gap and tolerance, no-go zones, interference [4]. |
| **v2: engineering** | Load cases (static, impact, ULS factor) and a 3D frame solver with semi-rigid joints. Utilisation against each vendor's own rating, with its safety factor and catalogue page. Buckling, deflection, sway. Joint rules by groove type [3]. Assembly order with **tool access** per fastener [5]. Fabrication rules as constraints (no welding, laser-cut OK, ...) [7]. Tolerances: straightness, bow limits, shim-or-machine [13]. STEP and DXF import [2], STEP export, DXF flats, a self-contained report [10]. |
| **v3: mechanisms** | Rails with catalogue friction, drive sizing margins, end-stop absorbers (energy and force curves), swept volumes [9, 4]. Mass, centre of gravity, tipping and rocking, floor reactions, anchor or ballast sizing [9]. A 3D viewer link with comments pinned to parts [10]. |

The catalog schema covers v2's and v3's data from the start (D5), so those phases add
calculations, not data.

## Stack (D7: Claude's choice, still open to veto)

Chosen to stay light and fast, with nothing borrowed from openPlan3D:

- **TypeScript + Vite** for the dev server and build. **No backend:** a small Vite plugin
  serves the open project folder, watches it, pushes changes to the tab over Vite's own
  websocket, and relays CLI commands to the open tab.
- **three.js used directly** (no react-three-fiber), with a thin layer that syncs the
  scene from the document.
  - Members are prisms extruded from the section polygon, and repeated hardware is
    instanced.
  - Snapping is analytic (slot lines, faces and ends come from the document, not from
    raycasting meshes).
  - [camera-controls](https://github.com/yomotsu/camera-controls) gives a CAD camera
    (orthographic views, fit to selection); GLTFExporter writes the GLB.
- **Preact + @preact/signals** for the panels. The runtime is a few KB, every agent writes
  JSX fluently, and signals update only what changed.
- **Zod** for the project and catalog schemas, exported as JSON Schema for agents (to be
  verified at setup).
- **Vitest** for the core library and **Playwright** for end-to-end tests and screenshots.
  **pnpm** as the package manager; Node 22 for the CLI.
- **Layering**: `core/` is pure TS with no three.js (model, commands, joints, cut list,
  BOM, checks). `catalog/` holds the schema and importers. `viewer/` holds three.js and
  the UI. `cli/` holds the CLI. The core is what the tests pin down.

## Name brainstorm, round 2: two words, or two blended (decided: AluKit, D12)

npm and GitHub were checked on 2026-11-26 (measured). **Avoid "slot" + a generic suffix:**
slotforge, slotlab and slotsmith are crowded with slot-machine projects.

| Name | Made of | npm | GitHub (same name) |
|---|---|---|---|
| **Perfilaria** | *perfil* + *-aria*, the suffix of craft shops (*marcenaria*, *serralheria*): "the profile shop" | free | 0 repos |
| **AluKit** | alu + kit | free | 5 repos, all 0★ |
| **Perfilab** | *perfil* + lab | free | 3 repos, unrelated |
| **Boltframe** | bolt + frame | free | an unrelated org (132★) |
| **Tslotter** | T-slot + -er | free | 0 repos (but a "slotter" is a machine tool) |
| **Cutframe** | cut + frame | free | 23 repos, small |
| **Rackwright** | rack + wright | free | 5 repos, 0★ (too rack-specific?) |
| **Extrudio** | extrude + studio | free | clashes with a 3D-printing plugin |

Taken or crowded: KerfKit (a KerfKit org exists), Framesmith, Framewright, Framekit,
Bracketeer, Bracketry, Beambench, Benchwright.

**Claude's picks: Perfilaria** (Brazilian and unique; it says what it is: a workshop for
profiles) **or AluKit** (international, short, self-explanatory; `alukit bom`).

## Name brainstorm, round 1 (rejected)

The criteria: short, works as a CLI command an agent types (`<name> bom`), and free in
`marciogranzotto/`.

- **Portuguese** (distinctive, from the Brazilian shop floor):
  - **Prumo**: plumb line; *no prumo* means true and upright. `prumo bom`.
  - **Esquadro**: carpenter's square.
  - **Gabarito**: jig or template; *gabaritar* means to ace it.
  - **Encaixe**: fit or joint.
  - **Trilho**: rail.
  - **Canal**: what Forseti calls the T-slot.
  - **Bancada**: workbench.
- **English maker words**:
  - **Kerf**: the width of a saw cut, a nod to the cut list. `kerf cutlist`.
  - **Gusset**: the corner plate of a frame.
  - **Jig**.
  - **Plumb**.
- **Descriptive**: Framewright, Slotwright, Framekit, Slotkit.

**Claude's pick: Prumo.** It's short, Brazilian, means "built true", and is easy to say
in English. The runner-up is **Kerf**.
