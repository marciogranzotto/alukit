# AluKit UX: the integration pass's decisions

*2026-11-27. The engineering items of the integration pass ([plan](plan.md) §6, step 5) after
streams S1 to S5 merged: the bundle, one call for a corner's arrangements, the built-in catalogs
in Project settings, and the docs. Labels as in the stream notes: **measured** (a test or a run
says so), **read** (from the code that runs), **inferred**. The interfaces it changed are in
[contracts.md](contracts.md) ("Integration changes"); [design.md](../design.md) §8 states the
result, under "UX redesign, integration" in its changelog.*

The machine ran other agents throughout (load averages 20 to 200 on 10 cores), so every time
below is a median of runs interleaved with its comparison, and the absolute values are high.

## Done

| Item | What | Where |
|---|---|---|
| Bundle | three.js in two chunks of its own; the flows only some sessions open load on first use; no raised warning limit | `vite.config.ts`, `src/viewer/scene.ts`, `src/ui/lazy.tsx`, `src/ui/tables/{index.ts,badges.tsx}`, `src/ui/shell/{open.ts,example.ts}`, `App.tsx`, `inspector/Inspector.tsx` |
| Arrangements | `GET /api/arrangements` and `alukit arrangements`: every corner rule for one corner or many, sharing the derive; the corner inspector asks it once | `src/core/corners/{arrange,batch}.ts`, `src/server/{host,server}.ts`, `src/cli/arrangements.ts`, `src/ui/client/arrangements.ts`, `src/ui/inspector/` |
| Joint preview | no dry run while neither end of the stroke touches a bar | `src/ui/tools/{joint,wiring}.ts` |
| Built-in catalogs | `/api/catalog` lists them; Project settings offers each with **Add** | `src/server/{catalog,server}.ts`, `src/ui/shell/Settings.tsx` |
| Docs | S2.17's README Quickstart and guide, with S5's keys and tools text; the stream notes folded into design.md §8; every command they show run | `README.md`, `docs/guide.md`, `docs/design.md` |
| `addFrame` | refuses a frame with no item, saying so (found running the docs) | `src/core/commands/frame.ts` |
| Tools' wiring | subscribes to the model after the handlers it refreshes (found by the gate) | `src/ui/tools/wiring.ts` |

## The bundle

1. **Before (measured):** one 1,185.5 kB entry chunk (gzip 326.1 kB), over Vite's 500 kB advice,
   with the warning limit raised to 1,000 kB in `vite.config.ts` (and still exceeded). The schema
   chunk for did-you-mean (112.9 kB) was already lazy.
2. **What was in it (measured, from the chunks of a build split as now, with the old install of
   item 3):** three.js and camera-controls 793 kB, the app 312 kB, and 90 kB of the sheets,
   settings, the corner inspector and the skill's text for the example.
3. **three kept all of itself because camera-controls was installed with its namespace**
   (`import * as THREE` passed to `CameraControls.install`): a bundler cannot see which exports a
   reader of the namespace takes, so none is shaken out. The install now hands it the subset its
   README lists (`Vector2`, `Vector3`, `Vector4`, `Quaternion`, `Matrix4`, `Spherical`, `Box3`,
   `Sphere`, `Raycaster`), and scene.ts imports three by name. **Measured** with a probe build that
   put the namespace back: three's chunks are 793.3 kB with it and 617.5 kB without (gzip 200.7
   and 153.9 kB).
4. **three is two chunks, `three-core` (220.2 kB) and `three` (397.4 kB, with camera-controls)**,
   following three's own build, which is two files: `three.core.js` (shared with its WebGPU
   renderer) and `three.module.js` (the WebGL renderer and its shader library). One chunk was
   615.9 kB, over the advice (measured). Rolldown's `codeSplitting.groups` make them.
5. **A manual group changes how rolldown splits everything else**: with one set, the modules the
   entry shares with a lazy chunk were no longer merged into the entry, and the page loaded seven
   small chunks of them on the critical path (measured). A last group, `index`, tagged
   `$initial`, puts everything the page imports statically back into the entry's chunk.
6. **`chunkSizeWarningLimit` is gone**, not raised: the largest chunk is 397 kB, under the
   default 500 kB, and a warning now means a chunk to split.
7. **What loads on first use** (`lazy()` in `src/ui/lazy.tsx`, measured sizes): the BOM (2.0 kB),
   Machining (4.2 kB), Order & costs (11.4 kB), Problems (2.5 kB) and Records (3.6 kB) sheets,
   with the open items they share (2.8 kB); Project settings (9.0 kB); the corner inspector
   (10.3 kB); and the skill's text that holds the example (44.8 kB), read when **Load the example**
   is pressed. 90.5 kB in all.
8. **The sheets' badges and the cut list stay in the entry.** A badge shows on the rail before its
   sheet is opened, so the badges moved out of the sheets' modules into `tables/badges.tsx`, and
   `tables/index.ts` registers every sheet in one place with a lazy body. The cut list is the
   sheet an opened project shows first.
9. **What stays eager, and why.** The viewer: the first draw needs it, and S3's `corners.ts` and
   `targets.ts`, which the outline and the inspector read, import modules that import three, so a
   lazy viewer would also need those split (inferred: little to gain, since the first frame waits
   on its shader programs, item 11). The catalog overlay (about 5 kB): its `/` key, its key
   descriptions and the focus return live in its mounted effects, and its card is shared with the
   inspector and the start card. Help (2.8 kB). Export needs nothing in the browser: the server
   writes the GLB.
10. **`lazy()` is a dozen lines on signals, not preact/compat's `lazy` and `Suspense`.** Compat
    patches Preact's global `options` hooks (`vnode`, `event`, `unmount`, `diffed`, `__e`) for the
    whole app (read). While a chunk loads the part renders nothing (inferred: a few milliseconds
    from the local server); a failed load says "This part of the app did not load
    (…). Reload the page." and tries again when the part is shown again. `settingsOpen` moved to
    `shell/open.ts` so the top bar, the project panel and the start card open settings without
    loading its module.
11. **Time to first draw** (measured, `first-draw.mjs`: the cart served locally, headless
    Chromium on SwiftShader at 1280 × 800, six rounds, before and after in turn, load 99 to
    100), medians from the navigation's start:

| | First paint | Model request starts | Scene built | First frame drawn | Chunks |
|---|---|---|---|---|---|
| Before | 256 ms | 378 ms | 429 ms | 1,593 ms | 1 |
| After | 208 ms | 313 ms | 357 ms | 1,351 ms | 3 |

   The frame after the scene is built is a long task of about 1 s on SwiftShader (measured
   earlier with a long-task observer): linking the first shader programs, which no bundle change
   touches. The gain is in parsing less code before the model request: 65 ms earlier.
12. **Under the CSP (measured):** `tests/e2e/chunks.spec.ts` opens the cart, checks that the first
    draw fetched only `index`, `three` and `three-core`, then opens each lazy sheet, settings and a
    corner, and checks every script came from the server's own origin with status 200 under its
    `default-src 'self'` policy, with no page error, console error or CSP message.

## One call for every corner rule

13. **`arrange()` in the core** (`src/core/corners/arrange.ts`) answers every rule for a set of
    corners: the catalogs are opened once, the corners' butts are taken out once, the state that
    leaves is derived once and shared by each rule's `autoConnect`, and each rule then costs its
    own `autoConnect` and one derive of what it builds. The batches are the inspector's (S5's
    decision 34: the connector and quantity kept), so what the app applies is what it was shown.
    The server's `GET /api/arrangements?at=x,y,z[&at=…][&rule=…]` and `alukit arrangements <dir>
    --at x,y,z [--rule …] [--json]` are this function, byte for byte (`alukit.arrangements/1`;
    `server.test.ts` compares them); the CLI goes through a running server, else opens the project
    itself at rev 0, as every other read command does.
14. **Sharing the derive is a hook on the command context**: `CommandEnv.derived?(state)`, which
    `makeContext` asks before deriving. States are immutable, so an answer for the same state
    object is safe to share; the arrangement passes the one state it derived, and nothing else
    sets the hook.
15. **An answer is `{ rule, ok, commands, plans, effects }` per rule**, `plans` being each corner's
    through bar and butting ends from `autoConnect`'s `info`, and `effects` the dry run's
    (`cuts`, `added`, `removed`, `claimed`); a refused rule gives the failed command's index in
    its own batch and the errors. **No diagnostics**: the inspector shows none, and checking each
    arrangement would cost a check per rule.
16. **The batch builders are their own module** (`batch.ts`), with `CORNER_RULES` written out
    (a test holds them to the schema's order), so the inspector's chunk imports no schema: with
    them in `arrange.ts` the corner inspector's chunk pulled Zod and weighed 254.6 kB (measured);
    now 10.3 kB.
17. **The inspector asks once per corner and revision**, and drops an answer whose `rev` is not
    the drawn one (S5's decision 39). **Measured** (`corners-bench.mjs`: 84 box frames, 1,018
    bars, three corners, 21 asks each, load 57 to 81): the four dry runs one after another, as
    before, median 670 ms (600 to 841); one `GET /api/arrangements`, median 244 ms (218 to 280).
    The answers were the same at every corner.
18. **The joint preview no longer asks while neither end of the stroke touches a bar** (a bar's
    end, or its design line between the ends, within the core's 0.01 mm; pattern copies left
    out, as `autoConnect` leaves them). Nothing could join there, so the answer was never shown
    (S5's decision 10). The test is on geometry, not on how the end was found: a typed or grid
    end that lands on a bar's end still asks, which keeps S5's worry about an end that lands
    without snapping. It only skips asks whose answer would join nothing. **Measured**
    (`joint-sweep.mjs`, S5's gesture: a rail typed from `[-600, 0, 800]`, 61 pointer moves
    through open space 16 ms apart, then a rest on the post's end, three rounds): dry runs in the
    sweep 7, 13 and 6 before, 0, 0 and 0 after; at rest on `b1.b` one each, with the same preview
    ("will butt on b1 · cut 580 · b1 800 → 820").
19. **No material churn.** Neither change makes or changes a material: the preview draws DOM
    labels, and the arrangements are data. `view.spec`'s count of shader links per revision stays
    zero (measured: it passes).

## The built-in catalogs

20. **`/api/catalog` gains `builtins`**: every folder of `catalogs/` that is a catalog, in id
    order, named by the project or not, each `{ id, name, vendor?, items, bars, tslot }`
    (`tslot`: it sells T-slot profile, `alukit new`'s question, D-UX-7). Each is opened alone, as
    `alukit new`'s notice opens them. S2 asked for `profiles`; `bars` is the catalog index's own
    kind, and the app words it "profiles", as the start card does.
21. **Opened the first time `/api/catalog` is asked, once per server**: built-in catalogs ship with
    AluKit and do not change while it runs (a failed opening is not kept). **Measured** (load
    61): the first `/api/catalog` of a fresh server on `alukit new --catalog forseti` takes 100 to
    158 ms, of which the built-ins are about 40 to 57; later answers 1 to 5 ms.
22. **Project settings list the built-ins the project does not name**, each with its name, id,
    counts, whether it sells T-slot profile, and **Add**, which adds it to the form; saving is
    still one `setProject`. The typed field stays for a folder inside the project. The start
    card's "no catalog sells a profile" line keeps opening settings (S2's decision 11) and now
    says "pick a built-in catalog, or name a folder inside the project".
23. **No CLI command lists catalogs**, so there is no parity to add: `alukit new` names built-in
    ids, and `alukit catalog search` searches every built-in catalog by default.

## The docs

24. **The README and the guide** take S5's keys and tools text, the box frame, the command bar,
    the inspector and the corner inspector, the view's toggles and Project settings; the README's
    CLI table adds `problems`, `arrangements`, `add frame` and `do --dry-run`. **Every command they
    show was run** in a scratch folder (the home folder's paths moved there), with a server for the
    ones that need one: `serve` answered 200, the outputs, revisions, diffs (folder, `rev:`,
    `git:main:`, variants), lock updates, snapshots, the GLB and `skill install --dir` exited 0, and
    `order` on the cart exits 1, blocked, as both say. Two were wrong, and are fixed: the README's
    own-catalog example copied `test` alone, whose carriage clones a block in `ref-test`, so
    `catalog check` and `new` failed with `ref-unknown-catalog`; it now copies `ref-test` beside it
    and names it. And item 26.
25. **design.md §8 states the result**, marked *2.3*, and its changelog gains "UX redesign,
    integration". The stream notes stay where they are, beside the plan, as the detailed record:
    moving them to `docs/notes/` as the plan first named would break the links between them and
    from the plan, and the designer review reads them there.
26. **`addFrame` with no item refused at its first corner, "no bar end meets at that point"**
    (measured: `alukit add frame <dir> --size 1000,600,800` on the README's `alukit new --catalog
    forseti` project, which has no default bar). A bar may be written with no item, so the posts
    and rails were added, sectionless, and `autoConnect` found no ends. `addFrame` now refuses up
    front, code `item`, field `item`: "the frame's bars name no item, and defaults.bar.item is not
    set: give item, or set the project's default bar first" (`commands.test.ts`). The box frame
    form already asked for a profile first (read); this was the CLI's and an agent's path.

## Found by the gate

27. **A second tab on a warm server wired nothing after the tools (measured).** The first full
    gate failed `live.spec` and `presence.spec`: the second tab showed no step toast, every time
    (four of four runs alone). Its page threw "Cannot access … before initialization" in
    `createTools` (S5's `tools/wiring.ts`): the model subscription sat at the top of the function
    and `subscribe` calls at once when the model is already there, so its `refresh()` read the
    tool `handlers` declared 900 lines below. The throw ended `useWiring`'s effect at
    `connectTools()`, so the palette, the presence wiring and the rest never started. It needs the
    model to arrive before the viewport makes its viewer, which the smaller entry chunk made
    common in a second tab (inferred: the model request now starts 65 ms earlier, item 11); the
    order was wrong before. The subscription now comes after the handlers. `tools/wiring.test.ts`
    builds the tools on a stand-in viewer with the model already set, for Select, Draw and the box
    frame: it fails with the old order on exactly that error, and passes.

## Left as found

- **S4's stopgaps for BE-3** (`problems/source.ts`'s `fromCheck`, `OrderCosts.tsx`'s `fixesFor`):
  S2.6 now fills `store.problems` every revision (read), so they serve only until the answer for a
  revision arrives. Removing them changes what the Problems list shows in that moment, a flow the
  designer review is looking at; not an item of this pass.
