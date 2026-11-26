import { signal } from "@preact/signals";
import type { Projection, Viewer } from "../viewer/scene.ts";
import { STANDARD_VIEWS } from "../viewer/views.ts";
import { GROUND } from "../viewer/workplane.ts";
import { applyCommands, busy, model, selection, summary } from "./store.ts";
import {
  activeTool,
  type ConnectType,
  connectionCommand,
  connectPicks,
  connectType,
  drawOptions,
  drawState,
  hint,
  measured,
  measureState,
  palette,
  patternCommand,
  patternState,
  pickingPlane,
  placeCommand,
  placeState,
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

function ConnectPanel() {
  const picks = connectPicks.value;
  const type = connectType.value;
  const c = connectionCommand(picks, type);
  return (
    <div class="tool-panel" data-testid="panel-connect">
      <h3>Connect</h3>
      <p class="hint-text">
        Click a bar near an end to pick that end, along its middle to pick the bar. Click again to
        drop it.
      </p>
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
      <div class="tp-row">
        <select
          data-testid="connect-type"
          value={type}
          onChange={(e) => {
            connectType.value = (e.target as HTMLSelectElement).value as ConnectType;
          }}
        >
          <option value="butt">butt</option>
          <option value="miter">miter</option>
          <option value="splice">splice</option>
          <option value="face">face (resting)</option>
        </select>
        <button
          type="button"
          class="tp-btn"
          data-testid="connect-apply"
          disabled={"why" in c || busy.value}
          onClick={async () => {
            if ("why" in c) return;
            if (await applyCommands([c], "connect")) connectPicks.value = [];
          }}
        >
          Apply
        </button>
      </div>
      {"why" in c && picks.length > 0 && <p class="hint-text">{c.why}</p>}
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
