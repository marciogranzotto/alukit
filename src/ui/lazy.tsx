import { signal } from "@preact/signals";
import type { ComponentType } from "preact";
import { useEffect } from "preact/hooks";

/**
 * A component whose code loads when it is first rendered (docs/ux/integration-decisions.md): the
 * parts of the app only some flows need (a sheet other than the cut list, project settings, the
 * corner inspector) are their own chunks, fetched by `import()` the first time the flow opens, so
 * the page parses less before it draws the model. Until the chunk is in, it renders nothing; the
 * chunk is fetched once, and every later render is the component itself.
 *
 *     const Settings = lazy(() => import("./shell/Settings.tsx").then((m) => m.Settings));
 *
 * Render it only where the flow is open (`{settingsOpen.value && <Settings />}`), so a closed
 * flow costs no request. A chunk that does not load (the server stopped, or the tab is older than
 * a rebuild) says so where the component would be, and is asked for again when the flow next
 * opens (the component mounts again).
 *
 * Preact's own `lazy` is in `preact/compat`, which installs React-compatibility hooks into every
 * render (`options.vnode`, `options.event`, …) when imported; this app is not a compat app, and
 * this is the part of it the app needs.
 */
export function lazy<P extends object>(
  load: () => Promise<ComponentType<P>>,
): ComponentType<P> & { preload(): Promise<void> } {
  const loaded = signal<ComponentType<P> | undefined>(undefined);
  const failed = signal<string | undefined>(undefined);
  let loading: Promise<void> | undefined;
  const preload = (): Promise<void> => {
    loading ??= load().then(
      (c) => {
        failed.value = undefined;
        loaded.value = c;
      },
      (e: unknown) => {
        loading = undefined;
        failed.value = e instanceof Error ? e.message : String(e);
      },
    );
    return loading;
  };
  function Lazy(props: P) {
    const C = loaded.value;
    const why = failed.value;
    useEffect(() => {
      if (!loaded.peek()) void preload();
    }, []);
    if (C) return <C {...props} />;
    if (why === undefined) return null;
    return (
      <p class="msg-error" role="alert">
        This part of the app did not load ({why}). Reload the page.
      </p>
    );
  }
  return Object.assign(Lazy, { preload });
}
