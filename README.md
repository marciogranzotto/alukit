# AluKit

Plan mechanical builds made from catalog parts, starting with aluminium T-slot extrusion,
in the browser.

You lay out the frame in 3D and AluKit gives you what you need to build it: the cut list,
a priced bill of materials from real suppliers, the machining on each bar and an order
list. Catalogs can be your own, imported or created. Agents can drive the whole thing
through a documented file format and a CLI.

**Status: design phase. There is no code yet.**

| Document | What |
|---|---|
| [`BRAINSTORM.md`](BRAINSTORM.md) | the decisions so far, the ideas, the roadmap |
| [`docs/design.md`](docs/design.md) | the v1 design: catalogs, the project format, the solver, the agent interface, the viewer, milestones |
| [`docs/research/forseti-inventory.md`](docs/research/forseti-inventory.md) | a survey of the first vendor catalog ([Forseti](https://loja.forsetisolucoes.com.br), Brazil) |

It runs locally: a small Node server with the app in your browser, and no hosting. Your
projects live wherever you keep them and are never part of this repository.

## License

[MIT](LICENSE). Use anything here as you like; keeping the copyright notice (attribution) is the only condition.
