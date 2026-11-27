import { signal } from "@preact/signals";
import type { Projection, SectionPlane, Viewer } from "../viewer/scene.ts";
import { STANDARD_VIEWS } from "../viewer/views.ts";
import { GROUND } from "../viewer/workplane.ts";
import { Diagnostics, Errors, newDiagnostics } from "./Feedback.tsx";
import {
  applyCommands,
  busy,
  type CommandOutcome,
  model,
  selection,
  sendCommands,
  summary,
} from "./store.ts";
import {
  activeTool,
  type ConnectPick,
  type ConnectType,
  connectionCommand,
  connectPicks,
  connectType,
  drawOptions,
  drawState,
  type FaceOptions,
  faceOptions,
  hint,
  measured,
  measureState,
  type PivotOptions,
  palette,
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
  typed,
  workPlane,
} from "./tools.ts";

/**
 * The tool bar over the viewport (design §8: tools; standard views, perspective or orthographic,
 * fit to selection) and the active tool's panel, above the properties.
 */

/** The viewer, once the viewport has made it: the tool bar's view buttons drive its camera. */
export const viewer = signal<Viewer | undefined>(undefined);
export const projection = signal<Projection>("perspective");
/** The section clipping plane (§8), when it is on. */
export const sectionPlane = signal<SectionPlane | undefined>(undefined);
/** The plane as last set, so turning the section on again puts it back. */
let lastSection: SectionPlane | undefined;

function setSection(s: SectionPlane | undefined): void {
  if (s) lastSection = s;
  sectionPlane.value = s;
  viewer.value?.setSection(s);
}

/** A plane across the middle of the model, square to an axis, on the whole millimetre. */
function middleSection(v: Viewer, axis: SectionPlane["axis"], flip = false): SectionPlane {
  const [lo, hi] = v.extent(axis);
  return { axis, at_mm: Math.round((lo + hi) / 2), flip };
}

/**
 * The section plane's controls: on or off, the axis it is square to, where along it (dragging
 * the slider moves the cut), and which side it keeps. It changes the view only.
 */
function SectionTools() {
  const v = viewer.value;
  const s = sectionPlane.value;
  // Re-rendered with each model, whose box gives the slider's range.
  void model.value;
  return (
    <>
      <button
        type="button"
        class={s ? "tb on" : "tb"}
        data-testid="section"
        aria-pressed={s !== undefined}
        title="Section plane: cut the view square to an axis (the document is unchanged)"
        disabled={!v}
        onClick={() => {
          if (!v) return;
          if (s) setSection(undefined);
          else setSection(lastSection ?? middleSection(v, "x"));
        }}
      >
        Section
      </button>
      {s && v && (
        <span class="section-tools" data-testid="section-tools">
          {(["x", "y", "z"] as const).map((a) => (
            <button
              type="button"
              key={a}
              class={s.axis === a ? "tb on" : "tb"}
              data-testid={`section-${a}`}
              title={`Square to ${a.toUpperCase()}`}
              onClick={() => setSection(middleSection(v, a, s.flip))}
            >
              {a.toUpperCase()}
            </button>
          ))}
          <SectionSlider v={v} s={s} />
          <button
            type="button"
            class="tb"
            data-testid="section-flip"
            title="Keep the other side"
            onClick={() => setSection({ ...s, flip: !s.flip })}
          >
            Flip
          </button>
        </span>
      )}
    </>
  );
}

function SectionSlider({ v, s }: { v: Viewer; s: SectionPlane }) {
  const [lo, hi] = v.extent(s.axis);
  const min = Math.floor(Math.min(lo, s.at_mm));
  const max = Math.ceil(Math.max(hi, s.at_mm));
  return (
    <label class="tb section-at" title={`Where the plane cuts, along ${s.axis.toUpperCase()}`}>
      <input
        type="range"
        class="section-range"
        data-testid="section-at"
        min={min}
        max={max}
        step={1}
        value={s.at_mm}
        onInput={(e) =>
          setSection({ ...s, at_mm: Number((e.currentTarget as HTMLInputElement).value) })
        }
      />{" "}
      <span class="num">
        {s.axis} {s.at_mm} mm
      </span>
    </label>
  );
}

const TOOL_TEXT: Readonly<Record<ToolName, [string, string]>> = {
  select: ["Select", "V"],
  draw: ["Draw bar", "B"],
  connect: ["Connect", "C"],
  place: ["Place part", "P"],
  pattern: ["Pattern", ""],
  measure: ["Measure", "M"],
};

const VIEW_TEXT: Readonly<Record<string, string>> = {
  iso: "Iso",
  top: "Top",
  front: "Front",
  right: "Side",
  left: "Left",
  back: "Back",
  bottom: "Bottom",
};

export function Toolbar() {
  const v = viewer.value;
  const readOnly = summary.value?.status.readOnly === true;
  return (
    <div class="toolbar" data-testid="toolbar">
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
      <span class="sep" />
      {STANDARD_VIEWS.filter((n) => ["iso", "top", "front", "right"].includes(n)).map((n) => (
        <button
          type="button"
          class="tb"
          key={n}
          data-testid={`view-${n}`}
          title={`${VIEW_TEXT[n]} view`}
          onClick={() => v?.setView(n, undefined, true)}
        >
          {VIEW_TEXT[n]}
        </button>
      ))}
      <button
        type="button"
        class="tb"
        data-testid="projection"
        title="Perspective or orthographic (O)"
        onClick={() => {
          const next = projection.value === "perspective" ? "orthographic" : "perspective";
          v?.setProjection(next);
          projection.value = next;
        }}
      >
        {projection.value === "perspective" ? "Persp" : "Ortho"}
      </button>
      <button
        type="button"
        class="tb"
        data-testid="fit"
        title="Fit to the selection, or to everything (F)"
        onClick={() => v?.fitSelection(selection.value)}
      >
        Fit
      </button>
      <span class="sep" />
      <SectionTools />
    </div>
  );
}

/** The text by the pointer: what it snaps to, the length, what is typed. */
export function Hint() {
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
  const { start, end } = drawState.value;
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
        {!start
          ? "click a start point"
          : `from ${start.label}${end ? ` to ${end.label}` : ""}${typed.value ? ` · length ${typed.value}` : ""}`}
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
            "screw: tapped into the last layer; blind: set from one side, gripping in the " +
            "last layer's bore or behind it"
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
            <option value="blind">blind</option>
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
      <p class="hint-text">
        {type === "pivot"
          ? "Click a face for the base, then near each end the pivot carries."
          : type === "face"
            ? "Click the layers in order, head to nut: bars along their middle, or plates."
            : "Click a bar near an end to pick that end, along its middle to pick the bar."}{" "}
        Click again to drop a pick.
      </p>
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
      <p class="hint-text">Click a face or a groove of a bar; then set the distance from an end.</p>
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
      <p class="hint-text">Click the bar to repeat along (or type a bar or run).</p>
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
