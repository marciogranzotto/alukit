import { useEffect, useState } from "preact/hooks";
import type { CornerRule } from "#core/project/schema.ts";
import type { V3 } from "../../../mesh/model.ts";
import { dryRun } from "../../client/dryrun.ts";
import { Errors } from "../../Feedback.tsx";
import { optionsText } from "../../options.ts";
import { palette } from "../../palette.ts";
import { frameWay } from "../../shell/start.ts";
import { busy, type CommandOutcome, model, sendCommands } from "../../store.ts";
import { frameCommand } from "../commands.ts";
import { CORNER_RULES, CORNER_WORDS, frameDraft, frameOptions, lastResult } from "../state.ts";

/**
 * The box frame's form (S5.7, D-UX-8): the corner, W, D and H (expressions with params), the
 * rings and a shelf, the corner rule, the connector and the params switch; the frame's numbers
 * from a dry run of the `addFrame` it would send; one step. The box frame tool shows it above the
 * inspector, sharing its draft with the gesture (a click or a typed value fills a field), and the
 * start card shows it as its first way in (`frameWay`). Owner: S5.
 */

/** How long the form waits after a change before it asks for the numbers: a dry run. */
const NUMBERS_MS = 300;

/** What the frame would come to, from its dry run: each part's cut lengths, or why not. */
type Numbers = { lines: string[] } | { why: string } | undefined;

interface FrameInfo {
  posts?: string[];
  rings?: Partial<Record<"base" | "shelf" | "top", string[]>>;
  connections?: string[];
}

/** Cut lengths of a group of bars, as "4 × 800" or "2 × 1000, 2 × 520". */
function cuts(ids: readonly string[], added: Readonly<Record<string, number>>): string {
  const by = new Map<number, number>();
  for (const id of ids) {
    const c = added[id];
    if (c !== undefined) by.set(c, (by.get(c) ?? 0) + 1);
  }
  return [...by]
    .sort((a, b) => b[0] - a[0])
    .map(([c, n]) => `${n} × ${Number.isInteger(c) ? c : c.toFixed(2)}`)
    .join(", ");
}

const RING_WORDS = { base: "base ring", shelf: "shelf ring", top: "top ring" } as const;

/** The form's numbers: the dry run of the frame as it stands, asked after a pause. */
function useNumbers(key: string, cmd: ReturnType<typeof frameCommand>): Numbers {
  const [numbers, setNumbers] = useState<Numbers>(undefined);
  useEffect(() => {
    if ("why" in cmd) {
      setNumbers(undefined);
      return;
    }
    let live = true;
    const timer = setTimeout(async () => {
      const r = await dryRun([cmd]);
      if (!live) return;
      if (!r.ok) setNumbers({ why: r.why });
      else if (!r.value.ok)
        setNumbers({ why: r.value.errors.map((e) => e.message).join("; ") || r.value.why });
      else {
        const info = (r.value.results[0]?.info ?? {}) as FrameInfo;
        const added = r.value.effects.added;
        const lines = [
          ...(info.posts ? [`posts ${cuts(info.posts, added)}`] : []),
          ...(["base", "shelf", "top"] as const).flatMap((ring) => {
            const ids = info.rings?.[ring];
            return ids ? [`${RING_WORDS[ring]} ${cuts(ids, added)}`] : [];
          }),
          `${info.connections?.length ?? 0} butts`,
          ...(r.value.diagnostics.length > 0
            ? [
                `${r.value.diagnostics.length} new ${r.value.diagnostics.length === 1 ? "problem" : "problems"}: ${r.value.diagnostics[0]?.message ?? ""}`,
              ]
            : []),
        ];
        setNumbers({ lines });
      }
    }, NUMBERS_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [key]);
  return numbers;
}

export function FrameForm({ onDone }: { onDone?: () => void }) {
  const m = model.value;
  const d = frameDraft.value;
  const o = frameOptions.value;
  const bar = palette.value.bar;
  const defaultBar =
    (m?.defaults.bar as { item?: unknown; opt?: Record<string, string> } | undefined) ?? undefined;
  const hasDefault = typeof defaultBar?.item === "string";
  const at: V3 = d.at ?? [0, 0, 0];
  const cmd = frameCommand({ ...d, at }, o, bar, hasDefault, m?.derived.params ?? {});
  const numbers = useNumbers(JSON.stringify(cmd), cmd);
  const [outcome, setOutcome] = useState<CommandOutcome | undefined>(undefined);
  const setDraft = (next: Partial<typeof d>) => {
    frameDraft.value = { ...frameDraft.value, ...next };
  };
  const setOptions = (next: Partial<typeof o>) => {
    frameOptions.value = { ...frameOptions.value, ...next };
  };
  const text = (k: "w" | "d" | "h", label: string, title: string) => (
    <label title={title}>
      {label}{" "}
      <input
        data-testid={`frame-${k}`}
        inputMode="decimal"
        placeholder="mm"
        value={d[k]}
        onInput={(e) => setDraft({ [k]: (e.currentTarget as HTMLInputElement).value })}
      />
    </label>
  );
  const create = async () => {
    if ("why" in cmd) return;
    const r = await sendCommands([cmd], "box frame", { inline: true });
    setOutcome(r);
    if (r.ok) {
      lastResult.value = { rev: r.rev, created: r.created };
      frameDraft.value = { w: "", d: "", h: "" };
      onDone?.();
    }
  };
  const profile = bar
    ? `${bar.name}${bar.opt ? ` ${optionsText(bar.opt)}` : ""}`
    : hasDefault
      ? `${String(defaultBar?.item)}${defaultBar?.opt ? ` ${optionsText(defaultBar.opt)}` : ""}, the project's default`
      : undefined;
  return (
    <form
      class="frame-form"
      data-testid="frame-form"
      onSubmit={(e) => {
        e.preventDefault();
        void create();
      }}
    >
      <p class={profile ? "frame-profile" : "frame-profile warn"} data-testid="frame-profile">
        {profile
          ? `In ${profile}`
          : "Choose the frame's profile first: arm a bar in the parts bin."}
      </p>
      <div class="tp-row">
        {text("w", "W", "The outside width, along X: an expression with params, 1.2m, …")}
        {text("d", "D", "The outside depth, along Y")}
        {text("h", "H", "The outside height, along Z")}
      </div>
      <div class="tp-row">
        <span>corner at</span>
        {([0, 1, 2] as const).map((i) => (
          <input
            key={i}
            class="frame-at"
            data-testid={`frame-at-${"xyz"[i]}`}
            aria-label={`corner ${"xyz"[i]}`}
            inputMode="decimal"
            value={at[i]}
            onInput={(e) => {
              const v = Number((e.currentTarget as HTMLInputElement).value);
              if (!Number.isFinite(v)) return;
              const next: [number, number, number] = [at[0], at[1], at[2]];
              next[i] = v;
              setDraft({ at: next });
            }}
          />
        ))}
      </div>
      <div class="tp-row">
        <label>
          <input
            type="checkbox"
            checked={o.rings.base}
            onChange={() => setOptions({ rings: { ...o.rings, base: !o.rings.base } })}
          />{" "}
          base ring
        </label>
        <label>
          <input
            type="checkbox"
            checked={o.rings.top}
            onChange={() => setOptions({ rings: { ...o.rings, top: !o.rings.top } })}
          />{" "}
          top ring
        </label>
        <label title="A shelf ring, its top face this high above the base">
          shelf at{" "}
          <input
            data-testid="frame-shelf"
            inputMode="decimal"
            placeholder="none"
            value={o.shelf}
            onInput={(e) => setOptions({ shelf: (e.currentTarget as HTMLInputElement).value })}
          />
        </label>
      </div>
      <div class="tp-row">
        <label>
          corners{" "}
          <select
            value={o.corner ?? ""}
            onChange={(e) => {
              const v = (e.currentTarget as HTMLSelectElement).value;
              setOptions({ corner: v === "" ? undefined : (v as CornerRule) });
            }}
          >
            <option value="">the project's rule</option>
            {CORNER_RULES.map((r) => (
              <option key={r} value={r}>
                {CORNER_WORDS[r]}
              </option>
            ))}
          </select>
        </label>
        <label title="Each butt's connector: an item id; the project's default butt when empty">
          connector{" "}
          <input
            data-testid="frame-connector"
            placeholder="the default"
            value={o.connector}
            onInput={(e) => setOptions({ connector: (e.currentTarget as HTMLInputElement).value })}
          />
        </label>
        <label title="Write W, D and H as params, and the frame's points from them">
          <input
            type="checkbox"
            checked={o.params}
            onChange={() => setOptions({ params: !o.params })}
          />{" "}
          as params
        </label>
      </div>
      <div class="frame-numbers" data-testid="frame-numbers" aria-live="polite">
        {"why" in cmd ? (
          <p class="hint-text">{cmd.why}</p>
        ) : numbers === undefined ? (
          <p class="hint-text">working out the cut lengths…</p>
        ) : "why" in numbers ? (
          <p class="warn">{numbers.why}</p>
        ) : (
          <ul>
            {numbers.lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        )}
      </div>
      <button
        type="submit"
        class="btn primary"
        data-testid="frame-create"
        disabled={"why" in cmd || busy.value || (numbers !== undefined && "why" in numbers)}
      >
        Make the frame
      </button>
      <Errors outcome={outcome} />
    </form>
  );
}

// The start card's first way in (D-UX-6, S2.10): the same form, closing the card when done.
frameWay.value = FrameForm;
