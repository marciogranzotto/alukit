/**
 * What tests and agents may read from a tab, as `window.__alukit` (docs/ux/plan.md §5.3): it holds
 * no secret and changes nothing. Each module adds the fields of what it owns, when it is first
 * imported, with `extendHook`, and declares them by augmenting `AlukitHook` in its own file:
 *
 *     declare module "./hook.ts" {
 *       interface AlukitHook {
 *         corners(): readonly Corner[];
 *       }
 *     }
 *     extendHook({ corners: () => ... });
 *
 * Every field is a function that reads the state when called, so the hook is complete before the
 * app renders and answers `undefined` for what is not there yet (no model drawn, no viewer).
 * Owner: S2 (this file); each field belongs to the module that adds it.
 */

export interface AlukitHook {
  /** The revision the server announced. */
  rev(): number | undefined;
  /** Whether the project is read-only (§7.1). */
  readOnly(): boolean;
}

declare global {
  interface Window {
    __alukit?: AlukitHook;
  }
}

const hook: Partial<AlukitHook> = {};
if (typeof window !== "undefined") window.__alukit = hook as AlukitHook;

/** Adds fields to the hook; a field added again replaces the one before. */
export function extendHook(fields: Partial<AlukitHook>): void {
  Object.assign(hook, fields);
}

/** The hook's fields so far, as `window.__alukit` holds them (for tests outside a browser). */
export function hookFields(): Readonly<Partial<AlukitHook>> {
  return hook;
}
