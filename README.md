# AluKit

Plan mechanical builds made from catalog parts, starting with aluminium T-slot extrusion,
in the browser.

You lay out the frame in 3D and AluKit gives you what you need to build it: the cut list,
a priced bill of materials from real suppliers, the machining on each bar and an order
list. Catalogs can be your own, imported or created. Agents can drive the whole thing
through a documented file format and a CLI.

**Status: milestones M1 (catalog core), M2a (first catalogs), M3a (geometry core) and two parts
of M3b: generation with the bill of materials, and the edit path.**
- Catalog schemas, the three-layer merge, section generators and section properties, and
  `alukit catalog check`, which compares computed section properties against published ones.
- Built-in catalogs: `forseti` (from [`importers/forseti`](importers/forseti/README.md): the
  profiles, hardware, rails and blocks of a first set), `std` (standard steel shapes and fasteners)
  and `ref-hiwin` (the HIWIN HG parts that rails and blocks clone).
- The project format, placement and end planes, and the cut list: `alukit derive <dir>` and
  `alukit cutlist <dir>`.
- Generation: rail holes from factory ends or drilled, parts on stations, bolted, screwed and
  T-nut face connections with their clearance holes, taps, rods and sleeves, connectors' hardware
  and machining; and the bill of materials with masses: `alukit bom <dir>`.
- Editing through commands, the one edit path: `alukit new`, `alukit do` (a batch of commands,
  applied atomically) and `alukit add`, `alukit query`, `alukit check`; the canonical form
  (`alukit fmt`) and the lock file that pins catalog data (`alukit lock update`).

The app still draws an empty scene.

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
| `pnpm dev` | Vite dev server with hot reload |
| `pnpm build` | builds the app into `dist/` |
| `pnpm serve` | serves `dist/` on 127.0.0.1 (a free port) through the CLI |
| `pnpm test` | unit tests (Vitest) |
| `pnpm test:e2e` | end-to-end test (Playwright, Chromium); run `pnpm build` first |
| `pnpm lint` / `pnpm format` | Biome check / format |
| `pnpm typecheck` | TypeScript 7, no emit |

The CLI runs straight from the sources, with no build step: `node src/cli/main.ts --help`. For
example, `node src/cli/main.ts catalog check tests/fixtures/catalogs/test` checks the synthetic test
catalog. Internal imports use `package.json` subpath imports (`#core/*`, `#catalog/*`), which Node,
TypeScript, Vite and Vitest all resolve.

## License

[MIT](LICENSE). Use anything here as you like; keeping the copyright notice (attribution) is the only condition.
