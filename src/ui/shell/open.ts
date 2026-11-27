import { signal } from "@preact/signals";

/**
 * Whether Project settings (S2.11) is open. It lives apart from the dialog, so the top bar, the
 * project panel and the start card open it without loading the dialog's code: `Settings.tsx` is
 * a chunk of its own, fetched the first time it opens (src/ui/lazy.tsx). Owner: S2.
 */
export const settingsOpen = signal(false);
