# AluKit

Plan mechanical builds made from catalog parts, starting with aluminium T-slot extrusion,
in the browser.

You lay out the frame in 3D and AluKit gives you what you need to build it: the cut list,
a priced bill of materials from real suppliers, the machining on each bar and an order
list. Catalogs can be your own, imported or created. Agents can drive the whole thing
through a documented file format and a CLI.

**Status: milestones M1 (catalog core), M2a (first catalogs), M3a (geometry core), M3b
(generation with the bill of materials; the edit path; offers, the order list and costs), M4a
(the viewer and the server that owns the document), M4b (drawing with the mouse), M5 (variants,
diff, revisions, the GLB export, snapshots and the agent skill) and M6 (project items and the
machining sheet).**
- Catalog schemas, the three-layer merge, section generators and section properties, and
  `alukit catalog check`, which compares computed section properties against published ones.
- Built-in catalogs: `forseti` (from [`importers/forseti`](importers/forseti/README.md): every
  orderable SKU, with a section for every profile stem), `std` (standard steel shapes and
  fasteners) and `ref-hiwin` (the HIWIN HG parts that rails and blocks clone).
- The project format, placement and end planes, and the cut list: `alukit derive <dir>` and
  `alukit cutlist <dir>`.
- Generation: rail holes from factory ends or drilled, parts on stations, bolted, screwed and
  T-nut face connections with their clearance holes, taps, rods and sleeves, connectors' hardware
  and machining; and the bill of materials with masses: `alukit bom <dir>`.
- Editing through commands, the one edit path: `alukit new`, `alukit do` (a batch of commands,
  applied atomically) and `alukit add`, `alukit query`, `alukit check`; the canonical form
  (`alukit fmt`) and the lock file that pins catalog data (`alukit lock update`).
- The order list per supplier (cheapest pack cover, kits, price bands, cost lines covering
  machining, READY or BLOCKED by named rules) and the costs and totals: `alukit order <dir>` and
  `alukit costs <dir>`.
- Project items (M6): custom plates and bent angles with through, threaded, countersunk and
  counterbored holes, weighed from their material; generic items and placeholders, which bars
  can bear on and which hold only their own order line; and the machining sheet, each custom
  part's holes from its datum: `alukit machining <dir>`.
- The server and the viewer: `alukit serve <dir>` owns the project and opens it in the browser,
  which draws the derived model (bars, parts, and the project's plates and bent angles with their
  holes marked, and placeholders outlined), selects by click or box, and shows properties (with
  where each catalog number comes from), the project tree, the cut list, the machining sheet, the
  BOM, the order, the costs and the checks. CLI edits go through a running server and appear live
  in every tab; `alukit undo`, `redo` and `log` use its history. A direct edit of `alukit.json` is
  taken in as a step, or makes the project read-only while the file is not valid. The server
  answers only its own page, with a per-start token.
- Drawing with the mouse: draw a bar from the palette (snapping to nodes, bar ends, face and
  groove centre lines, face centres, parts' datums and face centres, and the grid; the line
  follows X, Y or Z, Shift frees it in the work plane; type a length, R rolls, A cycles the
  anchor; ends butt where they meet others), connect ends and bars, place a part on a face or
  groove, pattern the selection along a bar, measure; a catalog browser (vendor, kind, family,
  search, item cards with sections and offers, and the project's own items, read only) sets the
  palette; standard views, orthographic or perspective, and fit to selection.
- Variants that override params, swap items and scope entities (`only_in`, `not_in`), on every
  output with `--variant`. `alukit diff` compares two sides (folders, revisions, git refs or
  variants), each with its own lock. `alukit revision save | list | show | verify` stores the
  document, its lock and every output, and replays them to show any drift. `alukit export glb`
  writes the model as binary glTF (bars, parts with the project's plates, bent angles and
  placeholders, their holes, fasteners), the same bytes for the same project. `alukit snapshot
  <dir> -o shot.png --view iso` renders a named view to PNG in headless Chromium.
- The agent skill, [`skills/alukit/SKILL.md`](skills/alukit/SKILL.md), with a reference
  generated from the code and a worked example that a test runs; `alukit skill install` links it
  into `~/.claude/skills/alukit`.

| Document                                                                   | What                                                                                                 |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| [`BRAINSTORM.md`](BRAINSTORM.md)                                           | the decisions so far, the ideas, the roadmap                                                         |
| [`docs/design.md`](docs/design.md)                                         | the v1 design: catalogs, the project format, the solver, the agent interface, the viewer, milestones |
| [`docs/research/forseti-inventory.md`](docs/research/forseti-inventory.md) | a survey of the first vendor catalog ([Forseti](https://loja.forsetisolucoes.com.br), Brazil)        |

It runs locally: a small Node server with the app in your browser, and no hosting. Your
projects live wherever you keep them and are never part of this repository.

## Development

Node 26 (see `.nvmrc`) and pnpm 12, with no Corepack (Node 26 does not ship it):

```sh
nvm install && nvm use          # Node from .nvmrc
npm install -g pnpm@12.23.0     # the version in package.json's packageManager
pnpm install --frozen-lockfile
pnpm exec playwright install chromium   # once, for the end-to-end test
```

| Script | Does |
|---|---|
| `pnpm dev` | Vite dev server with hot reload; `ALUKIT_PROJECT=<dir> pnpm dev` mounts that project's server in it and prints the address with its token |
| `pnpm build` | builds the app into `dist/` |
| `pnpm serve <dir>` | serves a project and the built app on 127.0.0.1 (a free port) through the CLI |
| `pnpm test` | unit tests (Vitest) |
| `pnpm test:e2e` | end-to-end tests (Playwright, Chromium, one worker); run `pnpm build` first |
| `pnpm lint` / `pnpm format` | Biome check / format |
| `pnpm typecheck` | TypeScript 7, no emit |
| `pnpm skill` | regenerates the skill's command reference from the code (a test fails while it is behind) |

The CLI runs straight from the sources, with no build step: `node src/cli/main.ts --help`. For
example, `node src/cli/main.ts catalog check tests/fixtures/catalogs/test` checks the synthetic test
catalog. Internal imports use `package.json` subpath imports (`#core/*`, `#catalog/*`), which Node,
TypeScript, Vite and Vitest all resolve.

## License

[MIT](LICENSE). Use anything here as you like; keeping the copyright notice (attribution) is the only condition.
