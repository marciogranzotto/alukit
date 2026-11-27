/**
 * What a call to one of the server's newer endpoints answers (docs/ux/plan.md §5.3, Clients): its
 * value, or why not. `unavailable` says the server has no such endpoint yet, so the app shows
 * the feature as not there rather than as failed: every client answers it until S1 builds the
 * endpoint behind it. Owner: S1.
 */
export type ClientAnswer<T> =
  | { ok: true; value: T }
  | { ok: false; why: string; unavailable?: boolean };

/** The answer of a client whose endpoint the server does not have yet. */
export function notYet(endpoint: string, task: string): ClientAnswer<never> {
  return { ok: false, why: `not available yet: ${endpoint} (${task})`, unavailable: true };
}
