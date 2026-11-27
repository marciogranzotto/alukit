import { signal } from "@preact/signals";
import { GROUND } from "../viewer/workplane.ts";
import { Diagnostics, Errors, newDiagnostics } from "./Feedback.tsx";
import { selection } from "./focus.ts";
import { palette } from "./palette.ts";
import { applyCommands, busy, type CommandOutcome, model, sendCommands, summary } from "./store.ts";
import {
  activeTool,
  type ConnectPick,
  type ConnectType,
  connectionCommand,
  connectPicks,
  connectType,
  drawOptions,
  type FaceOptions,
  faceOptions,
  hint,
  measured,
  measureState,
  type PivotOptions,
  patternCommand,
  patternState,
  pickingPlane,
  pivotBatch,
  pivotOptions,
  placeCommand,
  placeState,
  runOf,
  TOOLS,
  type ToolName,
  toolPrompt,
  workPlane,
} from "./tools.ts";

/**
 * The tools' parts of the screen (design §8): the tool buttons (the viewport's `left` slot), the
 * tip by the pointer and the help line over the viewport (its `bottom` slot), and the active
 * tool's panel, above the inspector.
 */

const TOOL_TEXT: Readonly<Record<ToolName, [string, string]>> = {
  select: ["Select", "V"],
  draw: ["Draw bar", "B"],
  connect: ["Connect", "C"],
  place: ["Place part", "P"],
  pattern: ["Pattern", ""],
  measure: ["Measure", "M"],
};

/** A button per tool; the active one is on. */
export function ToolButtons() {
  const readOnly = summary.value?.status.readOnly === true;
  return (
    <>
      {TOOLS.map((t) => {
        const [text, key] = TOOL_TEXT[t];
        return (
          <button
            type="button"
            key={t}
            data-testid={`tool-${t}`}
            class={activeTool.value === t ? "tb on" : "tb"}
            disabled={readOnly && t !== "select" && t !== "measure"}
            title={key ? `${text} (${key})` : text}
            onClick={() => {
              activeTool.value = t;
            }}
          >
            {text}
          </button>
        );
      })}
    </>
  );
}

/** The text by the pointer: what it snaps to, the length, what is typed. */
function Hint() {
  const h = hint.value;
  if (!h) return null;
  return (
    <div
      class="tool-hint"
      data-testid="tool-hint"
      style={{ left: `${h.x + 14}px`, top: `${h.y + 14}px` }}
    >
      {h.text}
    </div>
  );
}

/** Over the viewport: the tip by the pointer, and what the mouse does in the active tool. */
export function ToolOverlay() {
  return (
    <>
      <Hint />
      <div class="viewport-help">
        {activeTool.value === "select"
          ? "drag: orbit · right-drag: pan · wheel: zoom · Shift-drag: box select"
          : "click: pick · drag: orbit · Esc: back to select"}
      </div>
    </>
  );
}

function PaletteLine({ which }: { which: "bar" | "part" }) {
  const p = palette.value[which];
  if (!p)
    return (
      <p class="hint-text" data-testid={`palette-${which}-empty`}>
        No {which === "bar" ? "bar" : "part"} in the palette: pick one in the catalog and set it as
        the palette.
      </p>
    );
  const opt =
    p.opt && Object.keys(p.opt).length > 0
      ? ` (${Object.entries(p.opt)
          .map(([k, v]) => `${k} ${v}`)
          .join(", ")})`
      : "";
  return (
    <p class="palette" data-testid={`palette-${which}`} data-id={p.id}>
      <code>{p.id}</code>
      {opt} <span class="sub">{p.name}</span>
    </p>
  );
}

function DrawPanel() {
  const o = drawOptions.value;
  const bar = palette.value.bar;
  const anchors = bar?.anchors ?? ["c"];
  return (
    <div class="tool-panel" data-testid="panel-draw">
      <h3>Draw bar</h3>
      <PaletteLine which="bar" />
      <div class="tp-row">
        <label>
          anchor (A){" "}
          <select
            data-testid="draw-anchor"
            value={o.anchor}
            onChange={(e) => {
              drawOptions.value = { ...o, anchor: (e.target as HTMLSelectElement).value };
            }}
          >
            {anchors.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <label>
          roll (R){" "}
          <button
            type="button"
            class="tp-btn"
            data-testid="draw-roll"
            data-roll={o.roll}
            onClick={() => {
              drawOptions.value = { ...o, roll: (o.roll + 90) % 360 };
            }}
          >
            {o.roll}°
          </button>
        </label>
      </div>
      <label class="tp-row">
        <input
          type="checkbox"
          data-testid="draw-autoconnect"
          checked={o.autoConnect}
          onChange={() => {
            drawOptions.value = { ...o, autoConnect: !o.autoConnect };
          }}
        />{" "}
        connect ends (a butt where the bar closes on others)
      </label>
      <p class="tp-row">
        work plane (W):{" "}
        <span data-testid="draw-plane">
          {pickingPlane.value ? "click a face…" : workPlane.value.label}
        </span>{" "}
        {workPlane.value !== GROUND && (
          <button type="button" class="tp-btn" onClick={() => (workPlane.value = GROUND)}>
            ground
          </button>
        )}
      </p>
      <p class="tool-status" data-testid="draw-status">
        {toolPrompt.value}
      </p>
      <p class="hint-text">
        The line follows X, Y or Z; Shift frees it in the work plane. Type a length and press Enter,
        or click a point. Esc cancels.
      </p>
    </div>
  );
}

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
            placeholder="a connector id"
            value={o.connector}
            onInput={(e) => set({ connector: (e.target as HTMLInputElement).value })}
          />
        </label>
      </div>
    </>
  );
}

function FaceFields() {
  const f = faceOptions.value;
  const set = (next: Partial<FaceOptions>) => {
    faceOptions.value = { ...f, ...next };
  };
  const text = (k: keyof FaceOptions, label: string, placeholder: string) => (
    <label>
      {label}{" "}
      <input
        data-testid={`face-${k}`}
        placeholder={placeholder}
        value={f[k] as string}
        onInput={(e) => set({ [k]: (e.target as HTMLInputElement).value })}
      />
    </label>
  );
  return (
    <>
      <div class="tp-row">
        <label
          title={
            "none: resting; bolt: through every layer; T-nut: into the last layer's groove; " +
            "screw: tapped into the last layer"
          }
        >
          fastening{" "}
          <select
            data-testid="face-fastening"
            value={f.fastening}
            onChange={(e) =>
              set({ fastening: (e.target as HTMLSelectElement).value as FaceOptions["fastening"] })
            }
          >
            <option value="none">none (resting)</option>
            <option value="bolt">bolt</option>
            <option value="tnut">T-nut</option>
            <option value="screw">screw</option>
          </select>
        </label>
      </div>
      {f.fastening !== "none" && (
        <>
          <div class="tp-row">
            {text("fastener", f.rod ? "rod stock" : "fastener", "an item id")}
            <label>
              <input
                type="checkbox"
                data-testid="face-rod"
                checked={f.rod}
                onChange={() => set({ rod: !f.rod })}
              />{" "}
              cut from bar stock
            </label>
            {f.rod && text("rodLen", "length", "mm")}
          </div>
          <div class="tp-row">{text("stack", "stack", "items, head to nut")}</div>
          <div class="tp-row">
            {text("at", "at", "mm along the first layer, e.g. 100, 300")}
            {text("across", "across", "mm, e.g. -15, 15")}
            <label>
              <input
                type="checkbox"
                data-testid="face-railHoles"
                checked={f.railHoles}
                onChange={() => set({ railHoles: !f.railHoles })}
              />{" "}
              at the rail's holes
            </label>
          </div>
          {f.fastening === "screw" && (
            <div class="tp-row">{text("tapDepth", "tap depth", "mm (through when empty)")}</div>
          )}
        </>
      )}
      <div class="tp-row">{text("gaps", "gaps", "mm per pair of layers")}</div>
    </>
  );
}

function ConnectPanel() {
  const picks = connectPicks.value;
  const type = connectType.value;
  const pivot = pivotOptions.value;
  const c = connectionCommand(picks, type, { pivot, face: faceOptions.value });
  const last = connectOutcome.value;
  const apply = async () => {
    const m = model.value;
    if ("why" in c || !m) return;
    // A pivot's carried ends point at it, so its batch names the id it creates (§4.5).
    const p = type === "pivot" ? pivotBatch(c, m.doc) : undefined;
    const outcome = await sendCommands(p ? p.commands : [c], "connect", {
      strict: p !== undefined,
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
      {type === "pivot" && <PivotFields />}
      {type === "face" && <FaceFields />}
      <div class="tp-row">
        <button
          type="button"
          class="tp-btn"
          data-testid="connect-apply"
          disabled={"why" in c || busy.value}
          onClick={() => void apply()}
        >
          Apply
        </button>
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
              made <code>{last.id}</code>
              {newDiagnostics(last.outcome, [last.id]).length === 0 ? "" : "; derive says:"}
            </p>
          )}
          <Errors outcome={last.outcome} />
          <Diagnostics list={last.id ? newDiagnostics(last.outcome, [last.id]) : []} />
        </div>
      )}
    </div>
  );
}

function PlacePanel() {
  const s = placeState.value;
  const part = palette.value.part;
  const st = s.station;
  return (
    <div class="tool-panel" data-testid="panel-place">
      <h3>Place part</h3>
      <PaletteLine which="part" />
      <p class="hint-text">{toolPrompt.value}</p>
      {st && (
        <>
          <p>
            on <code>{st.bar}</code> {st.groove ? `groove ${st.groove}` : `face ${st.face}`}
          </p>
          <div class="tp-row">
            <label>
              at{" "}
              <input
                type="number"
                data-testid="place-at"
                value={st.at_mm}
                onInput={(e) => {
                  placeState.value = {
                    ...s,
                    station: { ...st, at_mm: Number((e.target as HTMLInputElement).value) },
                  };
                }}
              />{" "}
              mm from
            </label>
            <select
              data-testid="place-from"
              value={s.from}
              onChange={(e) => {
                placeState.value = {
                  ...s,
                  from: (e.target as HTMLSelectElement).value as "a" | "b",
                };
              }}
            >
              <option value="a">end a</option>
              <option value="b">end b</option>
            </select>
            <select
              data-testid="place-roll"
              value={s.roll}
              onChange={(e) => {
                placeState.value = { ...s, roll: Number((e.target as HTMLSelectElement).value) };
              }}
            >
              {[0, 90, 180, 270].map((r) => (
                <option key={r} value={r}>
                  {r}°
                </option>
              ))}
            </select>
          </div>
        </>
      )}
      <button
        type="button"
        class="tp-btn"
        data-testid="place-apply"
        disabled={!st || !part || busy.value}
        onClick={async () => {
          if (!st || !part) return;
          if (await applyCommands([placeCommand(part, st, s.from, s.roll)], "place part"))
            placeState.value = { from: "a", roll: 0 };
        }}
      >
        Place
      </button>
    </div>
  );
}

function PatternPanel() {
  const s = patternState.value;
  const c = patternCommand(s);
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
      <button
        type="button"
        class="tp-btn"
        data-testid="pattern-apply"
        disabled={"why" in c || busy.value}
        onClick={async () => {
          if ("why" in c) return;
          await applyCommands([c], "pattern");
        }}
      >
        Create
      </button>
      {"why" in c && <p class="hint-text">{c.why}</p>}
    </div>
  );
}

function MeasurePanel() {
  const { a, b } = measureState.value;
  const m = a && b ? measured(a.p, b.p) : undefined;
  const f = (x: number) => (Math.round(x * 100) / 100).toFixed(2);
  return (
    <div class="tool-panel" data-testid="panel-measure">
      <h3>Measure</h3>
      <p>from {a ? a.label : "—"}</p>
      <p>to {b ? b.label : "—"}</p>
      {m && (
        <p data-testid="measure-result">
          <strong>{f(m.d)} mm</strong> (dx {f(m.dx)}, dy {f(m.dy)}, dz {f(m.dz)})
        </p>
      )}
    </div>
  );
}

export function ToolPanel() {
  if (!model.value) return null;
  switch (activeTool.value) {
    case "draw":
      return <DrawPanel />;
    case "connect":
      return <ConnectPanel />;
    case "place":
      return <PlacePanel />;
    case "pattern":
      return <PatternPanel />;
    case "measure":
      return <MeasurePanel />;
    default:
      return null;
  }
}
