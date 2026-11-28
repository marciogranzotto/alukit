import { useEffect, useState } from "preact/hooks";
import type { CornerRule } from "#core/project/schema.ts";
import type { V3 } from "../../../mesh/model.ts";
import { cardOf, openCatalog } from "../../catalog/state.ts";
import { dryRun } from "../../client/dryrun.ts";
import { ConnectorSelect, connectorLabel, useConnectors } from "../../common/ConnectorSelect.tsx";
import { Errors } from "../../Feedback.tsx";
import { optionsText } from "../../options.ts";
import { palette } from "../../palette.ts";
import { type FrameProfile, frameWay } from "../../shell/start.ts";
import { busy, type CommandOutcome, model, sendCommands } from "../../store.ts";
import { type frameBatch, frameSizing, JOINT_UNCHOSEN, suggestedJoint } from "../commands.ts";
import {
  activeTool,
  CORNER_RULES,
  CORNER_WORDS,
  type FrameDraft,
  frameDraft,
  frameNumbers,
  frameOptions,
  frameStage,
  JOIN_NONE,
  lastResult,
  typed,
} from "../state.ts";
import { parseTyped } from "../typed.ts";

/**
 * The box frame's form (S5.7, D-UX-8): W, D and H (expressions with params), a shelf and the
 * params switch, how the corners are joined (the common bracket one click beside the full list),
 * and under More options the corner, the rings and the corner rule
 * (docs/ux/polish-editing-ui-decisions.md 3); the frame's numbers from a dry run of the step it
 * would send; one step. The box frame
 * tool shows it above the inspector, sharing its draft with the gesture: a click fills a field,
 * and what is typed in the command bar shows in the fields as it is typed (review M6). The start
 * card shows it as its first way in (`frameWay`), with the profile its first step chose. Owner: S5.
 *
 * Joined with (docs/ux/review-phase4.md B1): the connectors that fit the frame's bar, or nothing,
 * said so. With no project default yet it must be chosen, and the connector chosen becomes the
 * project's default butt connector in the same step.
 */

/** How long the form waits after a change before it asks for the numbers: a dry run. */
const NUMBERS_MS = 300;

/** Why the suggested connector is offered, in its title. */
const SUGGESTED_WHY =
  "the bracket that fits the most profile series, as one click; the list beside it holds every connector that fits, and Nothing";

/** What the frame would come to, from its dry run: each part's cut lengths, or why not. */
type Numbers = { lines: string[]; problems?: string } | { why: string } | undefined;

interface FrameInfo {
  posts?: string[];
  rings?: Partial<Record<"base" | "shelf" | "top", string[]>>;
  connections?: string[];
}

type Batch = ReturnType<typeof frameBatch>;

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

/** The form's numbers: the dry run of the frame's step as it stands, asked after a pause. */
function useNumbers(key: string, batch: Batch): Numbers {
  const [numbers, setNumbers] = useState<Numbers>(undefined);
  useEffect(() => {
    if ("why" in batch) {
      setNumbers(undefined);
      return;
    }
    let live = true;
    const timer = setTimeout(async () => {
      const r = await dryRun(batch.commands);
      if (!live) return;
      if (!r.ok) setNumbers({ why: r.why });
      else if (!r.value.ok)
        setNumbers({ why: r.value.errors.map((e) => e.message).join("; ") || r.value.why });
      else {
        const info = (r.value.results.at(-1)?.info ?? {}) as FrameInfo;
        const added = r.value.effects.added;
        const lines = [
          ...(info.posts ? [`posts ${cuts(info.posts, added)}`] : []),
          ...(["base", "shelf", "top"] as const).flatMap((ring) => {
            const ids = info.rings?.[ring];
            return ids ? [`${RING_WORDS[ring]} ${cuts(ids, added)}`] : [];
          }),
          `${info.connections?.length ?? 0} butts`,
        ];
        const n = r.value.diagnostics.length;
        setNumbers({
          lines,
          ...(n > 0
            ? {
                problems: `${n} new ${n === 1 ? "problem" : "problems"}: ${r.value.diagnostics[0]?.message ?? ""}`,
              }
            : {}),
        });
      }
    }, NUMBERS_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [key]);
  return numbers;
}

/** A bar item's system, as its catalog card gives it: what the frame's connectors must fit. */
function useSystem(item: string | undefined): string | undefined {
  const [system, setSystem] = useState<string | undefined>(undefined);
  useEffect(() => {
    setSystem(undefined);
    if (!item) return;
    let live = true;
    cardOf(item).then(
      (c) => live && setSystem(c.entry.system),
      () => live && setSystem(undefined),
    );
    return () => {
      live = false;
    };
  }, [item]);
  return system;
}

/**
 * The draft as the form shows it: while the box frame tool is on, what is typed in the command
 * bar for the value it asks next, before Enter (review M6), so the fields and the numbers follow
 * the typing. The draft itself changes on Enter or a click, as the gesture's stages need.
 */
export function liveDraft(d: FrameDraft, params: Readonly<Record<string, number>>): FrameDraft {
  if (activeTool.value !== "frame") return d;
  const t = parseTyped(typed.value, params);
  const stage = frameStage(d);
  if (stage === "size" && t.kind === "list" && t.items.length === 2) {
    const [w, dd] = t.items;
    return { ...d, w: w ? String(w.written) : d.w, d: dd ? String(dd.written) : d.d };
  }
  if (stage === "height" && t.kind === "value") return { ...d, h: String(t.written) };
  return d;
}

export function FrameForm({
  onDone,
  profile,
}: {
  onDone?: () => void;
  /**
   * The start card's profile (review M1): the frame is made of it, and it becomes the project's
   * default bar in the same step; `null` while the card's first step has none. Absent in the box
   * frame tool, which draws with the palette's bar, else the project's default.
   */
  profile?: FrameProfile | null;
}) {
  const m = model.value;
  const params = m?.derived.params ?? {};
  const d = liveDraft(frameDraft.value, params);
  const o = frameOptions.value;
  const inCard = profile !== undefined;
  const bar = inCard ? undefined : palette.value.bar;
  const defaultBar =
    (m?.defaults.bar as { item?: unknown; opt?: Record<string, string> } | undefined) ?? undefined;
  const hasDefault = typeof defaultBar?.item === "string";
  const butt = m?.defaults.butt as { connector?: unknown; qty?: unknown } | undefined;
  const defaultButt = typeof butt?.connector === "string" ? butt.connector : undefined;
  const item = inCard
    ? profile?.item
    : (bar?.id ?? (hasDefault ? String(defaultBar?.item) : undefined));
  const system = useSystem(item);
  const systems = system ? [system] : [];
  const connectors = useConnectors(systems);
  // One click for the common bracket while the project names no default (polish-editing 3).
  const suggested = defaultButt ? undefined : suggestedJoint(connectors.fit);
  const at: V3 = d.at ?? [0, 0, 0];
  const project = { hasDefaultBar: hasDefault, defaultButt };
  // `batch` is what Make sends; `asked` is what the numbers come from, which while the joint is
  // the only thing missing is the frame as if nothing joined it (review N4).
  const { batch, asked, pending } = ((): { batch: Batch; asked: Batch; pending: boolean } => {
    if (inCard && !profile) {
      const why = { why: "pick a profile above" };
      return { batch: why, asked: why, pending: false };
    }
    const s = frameSizing({ ...d, at }, o, bar, project, params, profile?.patch);
    return {
      batch: s.pending ? { why: JOINT_UNCHOSEN } : s.batch,
      asked: s.batch,
      pending: s.pending,
    };
  })();
  const numbers = useNumbers(JSON.stringify(asked), asked);
  // The panel's numbers are the command bar's too, while the frame tool draws (review m9).
  useEffect(() => {
    if (inCard) return;
    frameNumbers.value =
      numbers && "lines" in numbers ? numbers.lines.slice(0, -1).join(" · ") : undefined;
    return () => {
      frameNumbers.value = undefined;
    };
  }, [numbers, inCard]);
  const [outcome, setOutcome] = useState<CommandOutcome | undefined>(undefined);
  const setDraft = (next: Partial<FrameDraft>) => {
    frameDraft.value = { ...frameDraft.value, ...next };
  };
  const setOptions = (next: Partial<typeof o>) => {
    frameOptions.value = { ...frameOptions.value, ...next };
  };
  const text = (k: "w" | "d" | "h", label: string, title: string) => (
    <label title={title}>
      {label}{" "}
      <input
        class="frame-size"
        data-testid={`frame-${k}`}
        inputMode="decimal"
        placeholder="mm"
        value={d[k]}
        onInput={(e) => setDraft({ [k]: (e.currentTarget as HTMLInputElement).value })}
      />
    </label>
  );
  const create = async () => {
    if ("why" in batch) return;
    const r = await sendCommands(batch.commands, "box frame", { inline: true });
    setOutcome(r);
    if (r.ok) {
      lastResult.value = { rev: r.rev, created: r.created };
      frameDraft.value = { w: "", d: "", h: "" };
      onDone?.();
    }
  };
  const chosenName = (() => {
    const e = [...connectors.fit, ...connectors.other].find((x) => x.id === defaultButt);
    return e ? connectorLabel(e) : defaultButt;
  })();
  // "Nothing" only while the project names no default: a butt that names no connector takes the
  // default (derive's `connector ?? defaults.butt.connector`), so with one it cannot be honoured.
  const joint = defaultButt && o.joint === JOIN_NONE ? "" : o.joint;
  const lead = defaultButt
    ? [{ value: "", label: `the project's default: ${chosenName}` }]
    : [
        { value: "", label: "Choose how the corners are joined…" },
        { value: JOIN_NONE, label: "Nothing: I will join them myself" },
      ];
  const profileText = bar
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
      {!inCard && (
        <p class="frame-profile" data-testid="frame-profile">
          <span class="sub">Profile:</span> {profileText ?? "none yet"}{" "}
          <button type="button" class="link" onClick={openCatalog}>
            {profileText ? "Change" : "Choose one"}
          </button>
        </p>
      )}
      <div class="tp-row">
        {text("w", "W", "The outside width, along X: an expression with params, 1.2m, …")}
        {text("d", "D", "The outside depth, along Y")}
        {text("h", "H", "The outside height, along Z")}
      </div>
      <div class="tp-row">
        <label title="A shelf ring, its top face this high above the base">
          Shelf at{" "}
          <input
            class="frame-size"
            data-testid="frame-shelf"
            inputMode="decimal"
            placeholder="none"
            value={o.shelf}
            onInput={(e) => setOptions({ shelf: (e.currentTarget as HTMLInputElement).value })}
          />
        </label>
        <label title="Write W, D and H as params, and the frame's points from them">
          <input
            type="checkbox"
            data-testid="frame-params"
            checked={o.params}
            onChange={() => setOptions({ params: !o.params })}
          />{" "}
          W, D and H as params
        </label>
      </div>
      <div class="tp-row frame-joint">
        <label for="frame-joint">Joined with</label>
        {suggested && (
          <label class="frame-joint-chip" title={`${connectorLabel(suggested)}: ${SUGGESTED_WHY}`}>
            <input
              type="radio"
              name="frame-joint-suggested"
              data-testid="frame-joint-suggested"
              value={suggested.id}
              checked={joint === suggested.id}
              disabled={busy.value}
              onChange={() => setOptions({ joint: suggested.id })}
            />{" "}
            <span class="frame-joint-name">{connectorLabel(suggested)}</span>
          </label>
        )}
        <ConnectorSelect
          id="frame-joint"
          testid="frame-joint"
          label="How the frame's corners are joined: a connector that fits the bar, or nothing"
          value={joint}
          systems={systems}
          lead={lead}
          corner
          disabled={busy.value}
          onChange={(v) => setOptions({ joint: v })}
        />
        {joint !== JOIN_NONE && (joint !== "" || defaultButt) && (
          <label title="Connectors at each butting end">
            ×{" "}
            <input
              class="frame-qty"
              data-testid="frame-qty"
              inputMode="numeric"
              size={2}
              placeholder={typeof butt?.qty === "number" && o.joint === "" ? String(butt.qty) : "1"}
              value={o.qty}
              onInput={(e) => setOptions({ qty: (e.currentTarget as HTMLInputElement).value })}
            />{" "}
            per end
          </label>
        )}
      </div>
      <details class="frame-more">
        <summary>More options</summary>
        <div class="tp-row">
          <span>corner at</span>
          {([0, 1, 2] as const).map((i) => (
            <label key={i} class="frame-at-field">
              <span class="frame-axis" aria-hidden="true">
                {"xyz"[i]}
              </span>
              <input
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
            </label>
          ))}
        </div>
        <div class="tp-row">
          <label>
            <input
              type="checkbox"
              data-testid="frame-base"
              checked={o.rings.base}
              onChange={() => setOptions({ rings: { ...o.rings, base: !o.rings.base } })}
            />{" "}
            base ring
          </label>
          <label>
            <input
              type="checkbox"
              data-testid="frame-top"
              checked={o.rings.top}
              onChange={() => setOptions({ rings: { ...o.rings, top: !o.rings.top } })}
            />{" "}
            top ring
          </label>
        </div>
        <div class="tp-row">
          <label>
            corners{" "}
            <select
              data-testid="frame-corner"
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
        </div>
      </details>
      <div class="frame-numbers" data-testid="frame-numbers" aria-live="polite">
        {"why" in asked ? (
          <p class="hint-text">{asked.why}</p>
        ) : numbers === undefined ? (
          <p class="hint-text">working out the cut lengths…</p>
        ) : "why" in numbers ? (
          <p class="warn">{numbers.why}</p>
        ) : (
          <>
            <ul>
              {/* While the joint is open the dry run assumed "Nothing": its warning is not news. */}
              {[...numbers.lines, ...(numbers.problems && !pending ? [numbers.problems] : [])].map(
                (l) => (
                  <li key={l}>{l}</li>
                ),
              )}
            </ul>
            {pending && (
              <p class="hint-text" data-testid="frame-joint-pending">
                Choose how the corners are joined to make it: the joint adds its connectors to the
                order, and does not change these lengths.
              </p>
            )}
          </>
        )}
      </div>
      <button
        type="submit"
        class="btn primary"
        data-testid="frame-create"
        disabled={"why" in batch || busy.value || (numbers !== undefined && "why" in numbers)}
        title={"why" in batch ? batch.why : undefined}
      >
        {inCard ? "Make a box frame" : "Make the frame"}
      </button>
      <Errors outcome={outcome} />
    </form>
  );
}

// The start card's first way in (D-UX-6, S2.10): the same form, closing the card when done.
frameWay.value = FrameForm;
