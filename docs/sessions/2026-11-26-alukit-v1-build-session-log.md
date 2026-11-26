# 2026-11-26: AluKit v1 build, session log

*Autonomous mode, started 2026-11-26 14:15 -03 at Marcio's request ("keep all and start building
with subagents on /auto-mode"). This log is public. Internal specifics of the reference project go
in the gitignored `internal/session-notes.md`.*

**Plan:** the milestones of [`docs/design.md` §12](../design.md#12-v1-milestones-review-m9), in order:

1. M0 scaffold;
2. M1 catalog core;
3. M1.5 paper model, alongside M0 and M1;
4. M2a the reference project's catalog items;
5. M3a geometry and cut list;
6. M3b generation, BOM, order, commands and CLI;
7. the early acceptance slice;
8. M4a and M4b viewer (M2b the rest of Forseti alongside);
9. M5 variants, revisions and GLB;
10. M6 custom parts;
11. acceptance.

**Working rules:**

| Area | Rule |
|---|---|
| Models | Subagents run on Opus where several invariants must hold at once (catalog core, solver, server) and on Sonnet for implementation and review elsewhere. No Fable. |
| Parallel work | In separate worktrees when files overlap. |
| Reviews | A small task's review folds into the next task. |
| Commits | Personal repo: no AI co-author trailers. Agents commit locally; the coordinator reviews, then pushes `main`. |
| Public hygiene | The reference project is "the reference project" only. Every push is scanned for internal names and paths. |

## Status

| Milestone | State | Notes |
|---|---|---|
| M0 scaffold | **done** (14:16), pushed `81a8a8e` | Every done-when check passed in a fresh clone on Node 26.13.1 / pnpm 12.23.0 (agent), and again on the coordinator's own run. First CI run on GitHub: **success** (run 45866365568). |
| M1.5 paper model | **done** (14:48) | 254 of 254 bodies in the document: 88 clean, 166 awkward, 0 missing. 20 schema gaps (P1–P20) with fixes. The end-plane rules reproduce every drawn bar length within 0.05 mm. Public summary: [`docs/reviews/m1.5-paper-model-findings.md`](../reviews/m1.5-paper-model-findings.md). |
| Design draft 2.1 | running (Opus), launched 14:50 | folds in P1–P20 |
| M1 catalog core | running (Opus), launched 14:17 | includes a folded-in review of M0 |

## Decisions taken autonomously

| # | When | Decision | Why |
|---|---|---|---|
| A1 | 14:15 | The paper model (M1.5) and its converter live in the gitignored `internal/paper-model/`, not in the reference project's repo | Another session is actively working on the reference project's branches. Writing there could collide with it. Move it later, once things settle. |
| A2 | 14:15 | Profiles without a vector outline get parametric sections from published dimensions; GrabCAD CAD is optional | GrabCAD needs a logged-in browser. The design already allows parametric sections with a declared fidelity (§3.5). |
| A3 | 14:15 | Add GitHub Actions CI at M0 (lint, typecheck, unit tests, build) | The repo is public, so Actions minutes are free, and CI gives the history an independent check. |

## For Marcio to review later

- **pnpm's release-age policy.** pnpm 12 refused vite 8.4.0 (published 2026-11-26) under its
  minimum-release-age rule, so `pnpm-workspace.yaml` carries `minimumReleaseAgeExclude:
  [vite@8.4.0]`. Drop the exclusion once 8.4.0 is old enough.
- **The local pre-push hook** (`.git/hooks/pre-push`, not committed) blocks pushes that contain
  internal markers. It lives only in this clone; a fresh clone doesn't have it.

## Log

- **14:15**: D17 recorded (all four of draft 2's calls kept). Autonomous mode started. M0 and
  M1.5 launched in parallel.
- **14:16**: M0 done in 6 commits (`6df83fe` … `81a8a8e`).
  - Exact pins as §10, plus `@types/three` and `@types/node`.
  - No install scripts needed.
  - Biome excludes Markdown: its first run reformatted the docs, which the agent reverted.
  - The renderer keeps its drawing buffer so tests can read pixels; e2e uses SwiftShader WebGL.
  - Re-verified by the coordinator, then pushed.
- **14:17**: M1 (catalog core) launched on Opus, with the M0 review folded in: subpath imports,
  the server path guard, CI action versions.
- **14:17**: First CI run green. Working rule added: while an agent commits on `main` in the
  shared working tree, the coordinator doesn't push. Later milestones run on their own branches,
  in worktrees.
- **14:48**: M1.5 done.
  - The biggest gaps: end planes taken from another bar's end (27 bodies), bolts through three or
    more bodies, fasteners and sleeves cut from bar stock, rail holes measured from the factory
    end, loose bill items, and a price band for low/likely/high totals.
  - The paper derive also found three lines where the reference project's own bill disagrees with
    its drawing. That went to the reference project's session as an FYI; details are internal.
- **14:50**: Design draft 2.1 launched on Opus to fold in P1–P20. Its catalog-schema changes will
  reach M1's code as a follow-up.
