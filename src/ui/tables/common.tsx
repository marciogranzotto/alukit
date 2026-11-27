import { useEffect, useState } from "preact/hooks";
import { getAtRev } from "../api.ts";
import { asOf, outputPath } from "../store.ts";

/** What the tables share: options as words, the lock stamp, and outputs asked of the server. */

/** An item's options as words, by name: `finish anodised, length 3000`. */
export const optText = (opt: Readonly<Record<string, string>>) =>
  Object.keys(opt)
    .sort()
    .map((k) => `${k} ${opt[k]}`)
    .join(", ");

/** The lock an output was derived from (§4.13's stamp), shortened; the whole hash on hover. */
export function Stamp({ lock }: { lock: string | undefined }) {
  if (lock === undefined) return null;
  return (
    <span class="stamp" title={`Derived from the lock ${lock}`}>
      Lock {lock.slice(0, 19)}…
    </span>
  );
}

/** An output's answer; `stale` while it is another revision's, variant's or date's. */
export type Fetched<T> = { rev: number; value: T; stale: boolean } | { error: string };

/**
 * An output the server computes on request, for the drawn revision: asked again when the
 * revision or the path (its variant, its date) changes. The last answer stays on screen, marked
 * stale, until the one asked for arrives, so the sheet settles on what the scene shows.
 */
export function useOutput<T>(path: string, rev: number): Fetched<T> | undefined {
  const [got, setGot] = useState<{ rev: number; path: string; value: T } | { error: string }>();
  useEffect(() => {
    let live = true;
    getAtRev<T>(path).then(
      (r) => {
        if (live) setGot({ rev: r.rev, path, value: r.body });
      },
      (e: unknown) => {
        if (live) setGot({ error: e instanceof Error ? e.message : String(e) });
      },
    );
    return () => {
      live = false;
    };
  }, [path, rev]);
  if (got === undefined || "error" in got) return got;
  return { rev: got.rev, value: got.value, stale: got.rev !== rev || got.path !== path };
}

/** An output's path in the tab's variant, with the order's date when one was picked. */
export function withAsOf(path: string): string {
  return outputPath(path, { asOf: asOf.value });
}

/** The order's date: the server's today until one is picked; clearing it goes back to today. */
export function AsOfInput({ value }: { value: string }) {
  return (
    <label class="as-of">
      as of{" "}
      <input
        type="date"
        data-testid="as-of"
        value={value}
        onChange={(e) => {
          const v = (e.currentTarget as HTMLInputElement).value;
          asOf.value = v === "" ? undefined : v;
        }}
      />
    </label>
  );
}
