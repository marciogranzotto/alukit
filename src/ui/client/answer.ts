/**
 * What a call to one of the server's newer endpoints answers (docs/ux/plan.md §5.3, Clients): its
 * value, or why not. `unavailable` says the server has no such endpoint, so the app shows the
 * feature as not there rather than as failed. Every client answered it while S0's stubs stood;
 * since S1 each calls its endpoint, and none does. Owner: S1.
 */
export type ClientAnswer<T> =
  | { ok: true; value: T }
  | { ok: false; why: string; unavailable?: boolean };
