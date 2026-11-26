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
| M0 scaffold | running | |
| M1.5 paper model | running | in `internal/paper-model/` (gitignored) |
| M1 catalog core | queued after M0 | |

## Decisions taken autonomously

| # | When | Decision | Why |
|---|---|---|---|
| A1 | 14:15 | The paper model (M1.5) and its converter live in the gitignored `internal/paper-model/`, not in the reference project's repo | Another session is actively working on the reference project's branches. Writing there could collide with it. Move it later, once things settle. |
| A2 | 14:15 | Profiles without a vector outline get parametric sections from published dimensions; GrabCAD CAD is optional | GrabCAD needs a logged-in browser. The design already allows parametric sections with a declared fidelity (§3.5). |
| A3 | 14:15 | Add GitHub Actions CI at M0 (lint, typecheck, unit tests, build) | The repo is public, so Actions minutes are free, and CI gives the history an independent check. |

## For Marcio to review later

*(nothing yet)*

## Log

- **14:15**: D17 recorded (all four of draft 2's calls kept). Autonomous mode started. M0 and
  M1.5 launched in parallel.
