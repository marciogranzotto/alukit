import { signal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { Diagnostics, Errors, stepDiagnostics } from "../Feedback.tsx";
import { select, selection } from "../focus.ts";
import { palette } from "../palette.ts";
import { busy, type CommandOutcome, model, sendCommands } from "../store.ts";
import {
  connectionCommand,
  faceEditCommand,
  patternCommand,
  pivotBatch,
  runOf,
} from "./commands.ts";
import { BinList, connectReplacing, FaceForm } from "./forms/FaceForm.tsx";
import { FrameForm } from "./forms/FrameForm.tsx";
import {
  activeTool,
  type ConnectPick,
  type ConnectType,
  connectPicks,
  connectType,
  faceOptions,
  type PivotOptions,
  patternState,
  pivotOptions,
  toolPrompt,
} from "./state.ts";
import { typedNumber, typedWords } from "./typed.ts";

/**
 * The active tool's long form, above the inspector (D-UX-5): Connect's picks, face and pivot
 * fields; Pattern's; the box frame's. The other tools' options are in the command bar. A
 * refusal shows under the form that sent it (U30). The face form is shared with the inspector,
 * which also sends Connect here to re-pick a face joint's layers, offering to replace that joint
 * (the editing audit's E-UX-14). Owner: E5.
 */

/** The last connection made or refused: the refusal, or the new connection and its checks. */
const connectOutcome = signal<{ outcome: CommandOutcome; id?: string } | undefined>(undefined);

/** A hinge to suggest: the palette's connector, else the one the document's pivots use. */
function connectorSuggestion(): string {
  const part = palette.value.part;
  if (part?.kind === "connector") return part.id;
  const conns = model.value?.doc.connections;
  if (typeof conns === "object" && conns !== null) {
    for (const c of Object.values(conns as Record<string, { type?: unknown; connector?: unknown }>))
      if (c.type === "pivot" && typeof c.connector === "string") return c.connector;
  }
  return "";
}

/** The layers of a face connection, head to nut: reorder, or take a bar's whole run. */
function LayerList({ picks }: { picks: readonly ConnectPick[] }) {
  const m = model.value;
  const set = (next: ConnectPick[]) => {
    connectPicks.value = next;
  };
  return (
    <ol class="picks" data-testid="connect-picks">
      {picks.map((p, i) => {
        const run = p.kind === "bar" && m ? runOf(m.doc, p.ref) : undefined;
        return (
          <li key={p.ref}>
            {p.kind} <code>{p.ref}</code>{" "}
            {i > 0 && (
              <button
                type="button"
                class="tp-btn"
                title="One layer nearer the head"
                onClick={() =>
                  set([
                    ...picks.slice(0, i - 1),
                    p,
                    picks[i - 1] as ConnectPick,
                    ...picks.slice(i + 1),
                  ])
                }
              >
                ↑
              </button>
            )}{" "}
            {run && !picks.some((x) => x.ref === run) && (
              <button
                type="button"
                class="tp-btn"
                data-testid="connect-use-run"
                title={`The whole run ${run} as this layer`}
                onClick={() =>
                  set(picks.map((x) => (x === p ? { ...p, ref: run, kind: "run" } : x)))
                }
              >
                run {run}
              </button>
            )}{" "}
            <button type="button" class="tp-btn" onClick={() => set(picks.filter((x) => x !== p))}>
              ×
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function PivotFields() {
  const o = pivotOptions.value;
  const set = (next: Partial<PivotOptions>) => {
    pivotOptions.value = { ...o, ...next };
  };
  const b = o.base;
  return (
    <>
      <p data-testid="pivot-base">
        base:{" "}
        {b ? (
          <>
            <code>{b.bar}</code> face {b.face}{" "}
            <button type="button" class="tp-btn" onClick={() => set({ base: undefined })}>
              ×
            </button>
          </>
        ) : (
          <span class="hint-text">click a face</span>
        )}
      </p>
      {b && (
        <div class="tp-row">
          <label>
            at{" "}
            <input
              type="number"
              data-testid="pivot-at"
              value={b.at_mm}
              onInput={(e) =>
                set({ base: { ...b, at_mm: Number((e.target as HTMLInputElement).value) } })
              }
            />{" "}
            mm from
          </label>
          <select
            data-testid="pivot-from"
            value={o.from}
            onChange={(e) => set({ from: (e.target as HTMLSelectElement).value as "a" | "b" })}
          >
            <option value="a">end a</option>
            <option value="b">end b</option>
          </select>
        </div>
      )}
      <div class="tp-row">
        <label>
          axis{" "}
          <select
            data-testid="pivot-axis"
            value={o.axis}
            onChange={(e) =>
              set({ axis: (e.target as HTMLSelectElement).value as "along" | "across" })
            }
          >
            <option value="across">across the base</option>
            <option value="along">along the base</option>
          </select>
        </label>
        <label>
          hinge{" "}
          <input
            data-testid="pivot-connector"
            list="connect-bin"
            placeholder="a connector id"
            value={o.connector}
            onInput={(e) => set({ connector: (e.target as HTMLInputElement).value })}
          />
        </label>
      </div>
    </>
  );
}

/** The written face joint Connect is replacing the layers of, while its type is face. */
function replacing(type: ConnectType): { id: string; c: Record<string, unknown> } | undefined {
  const id = connectReplacing.value;
  const conns = model.value?.doc.connections;
  const c =
    id && typeof conns === "object" && conns !== null
      ? (conns as Record<string, unknown>)[id]
      : undefined;
  return type === "face" && id && typeof c === "object" && c !== null
    ? { id, c: c as Record<string, unknown> }
    : undefined;
}

function ConnectPanel() {
  const picks = connectPicks.value;
  const type = connectType.value;
  const pivot = pivotOptions.value;
  const made = connectionCommand(picks, type, { pivot, face: faceOptions.value });
  const swap = replacing(type);
  // Replacing a joint's layers: the one setConnection that changes what was re-picked or retyped.
  const replace =
    swap && !("why" in made)
      ? faceEditCommand(
          swap.id,
          swap.c,
          faceOptions.value,
          picks.map((p) => p.ref),
        )
      : undefined;
  const c =
    replace === undefined
      ? made
      : "same" in replace
        ? { why: `nothing changed: re-pick ${swap?.id}'s layers, or change a field` }
        : replace;
  const last = connectOutcome.value;
  // Leaving Connect leaves the replacing behind.
  useEffect(
    () => () => {
      connectReplacing.value = undefined;
    },
    [],
  );
  const apply = async () => {
    const m = model.value;
    if ("why" in c || !m) return;
    if (swap) {
      const outcome = await sendCommands([c], `relayer ${swap.id}`, { inline: true });
      connectOutcome.value = { outcome, id: swap.id };
      if (outcome.ok) {
        connectPicks.value = [];
        connectReplacing.value = undefined;
        select([swap.id], "replace");
      }
      return;
    }
    // A pivot's carried ends point at it, so its batch names the id it creates (§4.5).
    const p = type === "pivot" ? pivotBatch(c, m.doc) : undefined;
    const outcome = await sendCommands(p ? p.commands : [c], "connect", {
      strict: p !== undefined,
      inline: true,
    });
    const id = outcome.ok ? outcome.created.find((x) => /^c\d+$/.test(x)) : p?.id;
    connectOutcome.value = { outcome, ...(id ? { id } : {}) };
    if (outcome.ok) {
      connectPicks.value = [];
      if (p) pivotOptions.value = { ...pivot, base: undefined };
    }
  };
  return (
    <div class="tool-panel" data-testid="panel-connect">
      <h3>Connect</h3>
      <div class="tp-row">
        <select
          data-testid="connect-type"
          value={type}
          onChange={(e) => {
            const t = (e.target as HTMLSelectElement).value as ConnectType;
            connectType.value = t;
            if (t === "pivot" && pivot.connector === "")
              pivotOptions.value = { ...pivot, connector: connectorSuggestion() };
          }}
        >
          <option value="butt">butt</option>
          <option value="miter">miter</option>
          <option value="splice">splice</option>
          <option value="pivot">pivot</option>
          <option value="face">face</option>
        </select>
      </div>
      <p class="hint-text">{toolPrompt.value}</p>
      {type === "face" ? (
        <LayerList picks={picks} />
      ) : (
        <ul class="picks" data-testid="connect-picks">
          {picks.map((p) => (
            <li key={p.ref}>
              {p.kind} <code>{p.ref}</code>{" "}
              <button
                type="button"
                class="tp-btn"
                onClick={() => {
                  connectPicks.value = picks.filter((x) => x.ref !== p.ref);
                }}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <BinList id="connect-bin" />
      {type === "pivot" && <PivotFields />}
      {type === "face" && (
        <FaceForm
          value={faceOptions.value}
          onChange={(f) => {
            faceOptions.value = f;
          }}
          listId="connect-bin"
        />
      )}
      <div class="tp-row">
        <button
          type="button"
          class="tp-btn"
          data-testid="connect-apply"
          disabled={"why" in c || busy.value}
          onClick={() => void apply()}
        >
          {swap ? `Replace ${swap.id}` : "Apply"}
        </button>
        {swap && (
          <button
            type="button"
            class="tp-btn"
            data-testid="connect-replace-off"
            title={`Make a new joint of these layers instead of replacing ${swap.id}'s`}
            onClick={() => {
              connectReplacing.value = undefined;
            }}
          >
            make a new one instead
          </button>
        )}
      </div>
      {"why" in c && (picks.length > 0 || pivot.base) && (
        <p class="hint-text" data-testid="connect-why">
          {c.why}
        </p>
      )}
      {last && (
        <div data-testid="connect-outcome">
          {last.outcome.ok && last.id && (
            <p class="tool-status">
              {last.outcome.created.includes(last.id) ? "made" : "changed"} <code>{last.id}</code>
              {stepDiagnostics(last.outcome, [last.id]).length === 0 ? "" : "; derive says:"}
            </p>
          )}
          <Errors outcome={last.outcome} />
          <Diagnostics list={last.id ? stepDiagnostics(last.outcome, [last.id]) : []} />
        </div>
      )}
    </div>
  );
}

/** The last pattern refused, shown under its form (U30). */
const patternOutcome = signal<CommandOutcome | undefined>(undefined);

function PatternPanel() {
  const s = patternState.value;
  const params = model.value?.derived.params ?? {};
  const c = patternCommand(s, params);
  const pitch = typedNumber(s.pitch, params);
  const field = (k: "pitch" | "count" | "along", label: string) => (
    <label>
      {label}{" "}
      <input
        inputMode={k === "along" ? "text" : "decimal"}
        data-testid={`pattern-${k}`}
        value={s[k] ?? ""}
        onInput={(e) => {
          patternState.value = { ...s, [k]: (e.target as HTMLInputElement).value };
        }}
      />
    </label>
  );
  return (
    <div class="tool-panel" data-testid="panel-pattern">
      <h3>Pattern</h3>
      <p>
        repeat <code data-testid="pattern-template">{s.template.join(", ") || "nothing"}</code>{" "}
        <button
          type="button"
          class="tp-btn"
          onClick={() => {
            patternState.value = { ...s, template: [...selection.value].sort() };
          }}
        >
          use selection
        </button>
      </p>
      <p class="hint-text">{toolPrompt.value}</p>
      <div class="tp-row">
        {field("along", "along")}
        {field("pitch", "pitch mm")}
        {field("count", "count")}
      </div>
      {!("why" in pitch) && typeof pitch.written === "string" && (
        <p class="hint-text" data-testid="pattern-pitch-words">
          pitch {typedWords(pitch)}
        </p>
      )}
      <button
        type="button"
        class="tp-btn"
        data-testid="pattern-apply"
        disabled={"why" in c || busy.value}
        onClick={async () => {
          if ("why" in c) return;
          patternOutcome.value = await sendCommands([c], "pattern", { inline: true });
        }}
      >
        Create
      </button>
      {"why" in c && <p class="hint-text">{c.why}</p>}
      <Errors outcome={patternOutcome.value} />
    </div>
  );
}

export function ToolForm() {
  if (!model.value) return null;
  switch (activeTool.value) {
    case "connect":
      return <ConnectPanel />;
    case "pattern":
      return <PatternPanel />;
    case "frame":
      return (
        <div class="tool-panel" data-testid="panel-frame">
          <h3>Box frame</h3>
          <FrameForm />
        </div>
      );
    default:
      return null;
  }
}
