/**
 * The problem model, `alukit.problems/1` (docs/ux/plan.md §5.3, D-UX-12, BE-3): one list of
 * what stands between the project and a sendable order or a sound build, merged from the check's
 * diagnostics, the order's reasons, the open items and the unconnected ends, grouped by
 * consequence, each in plain words with its targets and its fixes. Served at `GET /api/problems`
 * and printed by `alukit problems`; S1.6 builds it. Until then the UI streams build against the
 * hand-made `tests/fixtures/ux/problems-cart.json`, which these types describe.
 *
 * Types only. Owner: S1; after S0 a change only adds (a field, a fix kind, a group).
 */

/**
 * A reference to something a problem is about, as the app's focus takes it (src/ui/focus.ts):
 * an entity (`b1`, `c3`, `p2`, `pt1`, `n4`, `r1`), a bar's end (`b1.a`), a pattern copy
 * (`b26@1`), a catalog item (`forseti:PF40-01`) or a project item (`project:plate-a`), an open
 * item (`O1`), a corner (`corner:<key>`, src/ui/corners.ts) or a supplier (`supplier:<id>`).
 */
export type Ref = string;

/** What a problem holds up, most serious first. */
export type ProblemGroup = "blocks-order" | "error" | "warning" | "note";

export interface ProblemsAnswer {
  schema: "alukit.problems/1";
  /** The revision the problems are of. */
  rev: number;
  /** The variant derived, as the model's `variant`: the one asked for, else the default. */
  variant: string | null;
  /** The order's date the order's reasons were judged at. */
  as_of: string;
  /**
   * The order's state: READY, BLOCKED, or EMPTY when there is nothing to order. `blocks` counts
   * the problems in `blocks-order`; `warnings` the order's own warnings (its rules that warn).
   */
  order: { status: "READY" | "BLOCKED" | "EMPTY"; blocks: number; warnings: number };
  /** By group, in ProblemGroup's order; within a group, as `alukit check` and `order` list them. */
  problems: Problem[];
}

export interface Problem {
  /** Stable while the problem lasts: its code, its targets and its suppliers. */
  id: string;
  /** The diagnostic's code or the order rule's name, shown small, for parity with the CLI. */
  code: string;
  /** The order rule that judged it, when the order did. */
  rule?: string;
  group: ProblemGroup;
  /** Plain words, keyed by code: "No finish chosen for b1 Post, b2 Rail". */
  title: string;
  /** What follows from it, and what to do, in plain words. */
  detail: string;
  /** The message the CLI prints for it, as printed. */
  raw: string;
  /**
   * The suppliers whose order it holds, when it holds an order; `null` is the unsourced lines
   * (the order's supplier with no offer).
   */
  suppliers?: (string | null)[];
  /** What it is about, to show and select. */
  targets: Ref[];
  /** The field the inspector points at, as `opt.finish`, when one field is the problem. */
  field?: string;
  /** What fixes it, first the likeliest. */
  fixes: Fix[];
  /** Where it was found: the check, the order, the open items. */
  from: ("check" | "order" | "open")[];
}

/** A fix: one batch of commands (one step), or a named form the app opens. */
export type Fix = { label: string } & (
  | { kind: "commands"; commands: { cmd: string; args?: unknown }[] }
  | { kind: "resolve-open"; open: string }
  | { kind: "set-price"; item: string }
  | { kind: "param"; param: string }
  | { kind: "lock-update"; item: string }
);
