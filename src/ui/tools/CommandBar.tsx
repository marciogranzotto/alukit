import { useEffect, useLayoutEffect, useRef } from "preact/hooks";
import type { CornerRule } from "#core/project/schema.ts";
import { GROUND } from "../../viewer/workplane.ts";
import { AnchorDots, AnchorGlyph } from "../common/AnchorDots.tsx";
import { Icon } from "../icons/Icons.tsx";
import { anchorWords } from "../inspector/BarFields.tsx";
import { optionsText } from "../options.ts";
import type { PaletteItem } from "../palette.ts";
import { palette } from "../palette.ts";
import { heard, model } from "../store.ts";
import { measured } from "./commands.ts";
import {
  activeTool,
  CORNER_RULES,
  CORNER_WORDS,
  drawOptions,
  drawRepeat,
  drawState,
  fieldDone,
  fieldWanted,
  frameDraft,
  frameNumbers,
  frameStage,
  type Gesture,
  gesture,
  hint,
  jointPreview,
  lastResult,
  measureState,
  mirrorOptions,
  pickingPlane,
  placeState,
  rollDrawn,
  TOOL_NAMES,
  type ToolName,
  toolPrompt,
  typed,
  wayKnown,
  workPlane,
} from "./state.ts";
import { parseTyped, typedWords } from "./typed.ts";
import { toolFieldKey } from "./wiring.ts";

/**
 * The command bar at the canvas foot (D-UX-5, S5.2; SketchUp's Measurements box): the tool, what
 * it asks next, the value typed with what it comes to ("W / 2 + 20 = 620 mm, from end b1.b, along
 * +X"), the tool's frequent options in one line, and what the last step came to. The value is a
 * real field: a digit, a sign, `(`, `[` or `=` pressed over the view hands the keyboard to it
 * (wiring.ts), and Enter, Esc and Tab in it go to the tool. Also the tip by the pointer. Owner:
 * S5.
 */

/** The tools that take a typed value. */
const TAKES_VALUE: ReadonlySet<ToolName> = new Set(["draw", "place", "frame"]);

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

/** What the draw or place tool works with: the armed item, or how to arm one. */
function Armed({ which }: { which: "bar" | "part" }) {
  const p = palette.value[which];
  if (!p)
    return (
      <span class="cb-armed cb-missing" data-testid={`palette-${which}-empty`}>
        no {which} armed: pick one in the parts bin
      </span>
    );
  const opt = optionsText(p.opt);
  return (
    <span class="cb-armed" data-testid={`palette-${which}`} data-id={p.id} title={p.id}>
      {p.name}
      {opt ? <span class="sub"> {opt}</span> : null}
    </span>
  );
}

/** A disclosure in the command bar closes on a press anywhere else, so it never stays over the view. */
function useClosesOutside() {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (e: PointerEvent) => {
      const d = ref.current;
      if (d?.open && !d.contains(e.target as Node)) d.open = false;
    };
    document.addEventListener("pointerdown", close, true);
    return () => document.removeEventListener("pointerdown", close, true);
  }, []);
  return ref;
}

/**
 * The anchor picker on the section's own dots (U40): its summary names the anchor and draws it
 * small; it opens on the section's box, a dot at each anchor the bar offers, the chosen one
 * filled, each a 24 px target (AnchorDots). It opens above the bar, as the Options do, since a
 * pad whose dots can all be pressed is taller than the bar's one row
 * (docs/ux/polish-editing-ui-decisions.md 2). A pick closes it. `A` cycles the anchors too.
 */
function AnchorPicker({ bar }: { bar: PaletteItem }) {
  const o = drawOptions.value;
  const ref = useClosesOutside();
  const s = bar.section;
  if (!s) return null;
  return (
    <details class="cb-more cb-anchor" data-testid="draw-anchor" data-anchor={o.anchor} ref={ref}>
      <summary
        data-testid="draw-anchor-open"
        title="Where the bar's line runs through its section (A cycles)"
      >
        <AnchorGlyph bbox={s.bbox} datums={s.datums} value={o.anchor} />
        Anchor: {anchorWords(o.anchor)}
      </summary>
      <fieldset class="cb-more-panel cb-anchor-panel">
        <legend class="sr-only">The bar's anchor on its section</legend>
        <AnchorDots
          bbox={s.bbox}
          datums={s.datums}
          anchors={bar.anchors ?? ["c"]}
          value={o.anchor}
          onPick={(a) => {
            drawOptions.value = { ...drawOptions.value, anchor: a };
            const d = ref.current;
            if (d) {
              d.open = false;
              d.querySelector("summary")?.focus();
            }
          }}
        />
      </fieldset>
    </details>
  );
}

/** The corner rule for the joints this tool makes; the project's own when unset. */
function CornerSelect({
  value,
  onChange,
  testid,
}: {
  value: CornerRule | undefined;
  onChange: (v: CornerRule | undefined) => void;
  testid: string;
}) {
  const own = (model.value?.defaults.corner as CornerRule | undefined) ?? "vertical";
  // Short words in the select, so it is never cut; the long ones in each option's title (m3).
  return (
    <label class="cb-opt" title="At a corner, which bar runs through; the other butts on it">
      Corners{" "}
      <select
        data-testid={testid}
        value={value ?? ""}
        title={CORNER_WORDS[value ?? own]}
        onChange={(e) => {
          const v = (e.currentTarget as HTMLSelectElement).value;
          onChange(v === "" ? undefined : (v as CornerRule));
        }}
      >
        <option value="" title={`the project's rule: ${CORNER_WORDS[own]}`}>
          project's: {CORNER_SHORT[own]}
        </option>
        {CORNER_RULES.map((r) => (
          <option key={r} value={r} title={CORNER_WORDS[r]}>
            {CORNER_SHORT[r]}
          </option>
        ))}
      </select>
    </label>
  );
}

/** The corner rules in a word or two, for the command bar's select (review m3). */
const CORNER_SHORT: Readonly<Record<CornerRule, string>> = {
  vertical: "post through",
  x: "X bar through",
  y: "Y bar through",
  first: "first through",
};

function DrawOptions() {
  const o = drawOptions.value;
  const bar = palette.value.bar;
  const repeat = drawRepeat.value;
  const more = useClosesOutside();
  return (
    <>
      <Armed which="bar" />
      {repeat && (
        <span
          class="cb-opt cb-chip"
          data-testid="draw-repeat"
          title="Pattern's repeat: the bar drawn next and its pattern are one step; Esc drops it"
        >
          then {repeat.count} along {repeat.along}, pitch {String(repeat.pitch_mm)}
        </span>
      )}
      {bar && <AnchorPicker bar={bar} />}
      <button
        type="button"
        class="cb-btn"
        data-testid="draw-roll"
        data-roll={o.roll}
        title="Roll the profile a quarter turn, keeping its anchor's side: the anchor turns too (R)"
        onClick={rollDrawn}
      >
        Roll {o.roll}°
      </button>
      {o.lock && (
        <span class="cb-opt cb-lock" data-testid="draw-lock">
          locked to {o.lock.toUpperCase()}
        </span>
      )}
      {/* The less frequent options, so the bar keeps to one row (review M5). */}
      <details class="cb-more" ref={more}>
        <summary data-testid="draw-options" title="The work plane, joining ends, the corner rule">
          Options{workPlane.value !== GROUND || !o.autoConnect ? " •" : ""}
        </summary>
        <div class="cb-more-panel">
          <span class="cb-opt" title="The plane a free line (Shift) draws in; W picks a face">
            Plane{" "}
            <span data-testid="draw-plane">
              {pickingPlane.value ? "click a face…" : workPlane.value.label}
            </span>
            {workPlane.value !== GROUND && (
              <button type="button" class="cb-btn" onClick={() => (workPlane.value = GROUND)}>
                ground
              </button>
            )}
          </span>
          <label class="cb-opt" title="Butt the bar's ends where they close on other bars">
            <input
              type="checkbox"
              data-testid="draw-autoconnect"
              checked={o.autoConnect}
              onChange={() => {
                drawOptions.value = { ...o, autoConnect: !o.autoConnect };
              }}
            />{" "}
            Join ends
          </label>
          {o.autoConnect && (
            <CornerSelect
              testid="draw-corner"
              value={o.prefer}
              onChange={(v) => {
                drawOptions.value = { ...drawOptions.value, prefer: v };
              }}
            />
          )}
        </div>
      </details>
    </>
  );
}

function PlaceOptions() {
  const s = placeState.value;
  return (
    <>
      <Armed which="part" />
      <label class="cb-opt">
        Roll{" "}
        <select
          data-testid="place-roll"
          value={s.roll}
          onChange={(e) => {
            placeState.value = {
              ...placeState.value,
              roll: Number((e.currentTarget as HTMLSelectElement).value),
            };
          }}
        >
          {[0, 90, 180, 270].map((r) => (
            <option key={r} value={r}>
              {r}°
            </option>
          ))}
        </select>
      </label>
    </>
  );
}

function MeasureResult() {
  const { a, b } = measureState.value;
  if (!a || !b) return null;
  const m = measured(a.p, b.p);
  const f = (x: number) => (Math.round(x * 100) / 100).toFixed(2);
  return (
    <output class="cb-result" data-testid="measure-result">
      <strong>{f(m.d)} mm</strong> from {a.label} to {b.label} (dx {f(m.dx)}, dy {f(m.dy)}, dz{" "}
      {f(m.dz)})
    </output>
  );
}

/** What the typed value comes to, in words, for the tool that takes it. */
function valueWords(tool: ToolName): { text: string; error: boolean } | undefined {
  const t = parseTyped(typed.value, model.value?.derived.params ?? {});
  if (t.kind === "empty") return undefined;
  if (t.kind === "error") return { text: t.why, error: true };
  if (t.kind === "point")
    return {
      text: `point [${t.items.map((x) => x.written).join(", ")}] = (${t.items.map((x) => x.value).join(", ")})`,
      error: false,
    };
  if (t.kind === "list")
    return { text: t.items.map((x) => typedWords(x)).join(" × "), error: false };
  const words = typedWords(t);
  if (tool === "draw") {
    const { start, end } = drawState.value;
    const axis = drawOptions.value.lock ?? end?.axis;
    if (!start) return { text: `${words}: click a start point first`, error: false };
    // No way to go yet (review M2): the pointer has not left the start, and no axis is locked.
    if (!wayKnown(start, end, drawOptions.value.lock))
      return { text: `${words}: point the way`, error: false };
    const k = axis ? { x: 0, y: 1, z: 2 }[axis] : undefined;
    const sign =
      k !== undefined && end ? ((end.p[k] as number) >= (start.p[k] as number) ? 1 : -1) : 1;
    const dir = axis
      ? `, along ${(sign * Math.sign(t.value || 1) > 0 ? "+" : "-") + axis.toUpperCase()}`
      : "";
    return { text: `${words}${dir}`, error: false };
  }
  if (tool === "place") {
    const st = placeState.value.station;
    return { text: st ? `${words} from the nearer end of ${st.bar}` : words, error: false };
  }
  if (tool === "frame") {
    const stage = frameStage(frameDraft.value);
    return {
      text: `${stage === "height" ? "H" : stage === "size" ? "W, D" : ""} ${words}`.trim(),
      error: false,
    };
  }
  return { text: words, error: false };
}

/** What the last step a tool sent came to: its words, or why it was refused. */
function Result() {
  const r = lastResult.value;
  if (!r) return null;
  // "Which way?" is answered once the pointer shows the way, or an axis is locked (review N2).
  const { start, end } = drawState.value;
  if (r.wayNeeded && (!start || wayKnown(start, end, drawOptions.value.lock))) return null;
  if (r.error)
    return (
      <output class="cb-chip error" data-testid="tool-result" data-error="true" title={r.error}>
        {r.error}
      </output>
    );
  const step = heard.value.find((s) => s.rev === r.rev);
  const text = step?.text ?? (r.created.length > 0 ? `made ${r.created.join(", ")}` : "done");
  return (
    <output class="cb-chip" data-testid="tool-result" title={text}>
      {text}
    </output>
  );
}

/** The last request for the keyboard (`fieldWanted`) the field has served. */
let focusServed = 0;

/**
 * The value field: what is typed, with what it comes to beside it. A drag gesture gives its own
 * reading and placeholder, and shows the joint preview as the draw tool does, and its own name for
 * a screen reader ("Move b2: distance", review m4), never the draw tool's.
 */
function ValueField({
  tool,
  reading,
  placeholder,
  name,
}: {
  tool: ToolName;
  reading?: string | undefined;
  placeholder?: string | undefined;
  name?: string | undefined;
}) {
  const ref = useRef<HTMLInputElement>(null);
  // A layout effect: wired when the field is in the DOM, before the next key can arrive.
  useLayoutEffect(() => {
    let done = fieldDone.peek();
    const offs = [
      // A request made before the field was there (the key that started the value came with
      // the tool's first render) is served when it mounts.
      fieldWanted.subscribe((n) => {
        if (n === focusServed) return;
        const el = ref.current;
        if (!el) return;
        focusServed = n;
        el.value = typed.peek();
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }),
      fieldDone.subscribe((n) => {
        if (n === done) return;
        done = n;
        if (ref.current && document.activeElement === ref.current) ref.current.blur();
      }),
    ];
    return () => {
      for (const off of offs) off();
    };
  }, []);
  const words = reading !== undefined ? { text: reading, error: false } : valueWords(tool);
  const j = tool === "draw" || reading !== undefined ? jointPreview.value : undefined;
  return (
    <>
      <label class="cb-value">
        <span class="sr-only">{name ?? `${TOOL_NAMES[tool]}: value`}</span>
        <input
          class="cb-field"
          ref={ref}
          data-testid="command-value"
          spellcheck={false}
          autocomplete="off"
          placeholder={placeholder ?? (tool === "frame" ? "1000, 600" : "length")}
          aria-describedby="command-result"
          value={typed.value}
          onInput={(e) => {
            typed.value = (e.currentTarget as HTMLInputElement).value;
          }}
          onKeyDown={(e) => {
            if (e.key !== "Enter" && e.key !== "Escape" && e.key !== "Tab") return;
            const took = toolFieldKey(e as unknown as KeyboardEvent);
            if (took || e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
            }
            if (e.key === "Escape") (e.currentTarget as HTMLInputElement).blur();
          }}
        />
      </label>
      <output
        id="command-result"
        class={words?.error ? "cb-eval error" : "cb-eval"}
        data-testid="command-result"
        title={words?.text}
      >
        {words?.text ?? ""}
      </output>
      {j && (
        <output class="cb-joint" data-testid="joint-preview">
          {j.joins === false ? j.text : `${j.text} · Tab: flip`}
        </output>
      )}
    </>
  );
}

/**
 * The bar is a row of the canvas column under the 3D view, not over it (review M5): the view
 * never runs under it, and Fit frames into what is left. In Select it holds the view's keys, so
 * the view keeps its height when a tool turns on. One row at 1280 px and wider; the prompt is
 * cut short with its words in the title, and announced, since the status bar no longer repeats
 * it (m2). The box frame's options are its form's alone (M6).
 */
/**
 * A drag gesture's bar (drag.ts): an end handle or Move, whatever the tool. What it comes to is the
 * gesture's own reading; a value typed is its length or offset; the joint preview and the result
 * as the draw tool shows them.
 */
function GestureBar({ g }: { g: Gesture }) {
  const how = GESTURE_LOOK[g.kind];
  return (
    <section
      class="command-row command-bar"
      data-testid="command-bar"
      data-tool={g.kind === "end" ? "drag-end" : g.kind}
      aria-label={`${g.title}: command bar`}
    >
      <span class="cb-tool">
        <Icon name={how.icon} /> {g.title}
      </span>
      <span class="cb-prompt" data-testid="command-prompt" title={g.prompt} aria-live="polite">
        {g.prompt}
      </span>
      <ValueField
        tool="draw"
        reading={g.reading}
        placeholder={how.placeholder}
        name={`${g.title}: ${how.placeholder}`}
      />
      {g.kind === "mirror" && <MirrorOptions />}
      <Result />
    </section>
  );
}

/** Each gesture's icon and what its value field takes (docs/ux/e3-decisions.md). */
const GESTURE_LOOK: Readonly<
  Record<Gesture["kind"], { icon: "select" | "move" | "rotate"; placeholder: string }>
> = {
  end: { icon: "select", placeholder: "cut length" },
  move: { icon: "move", placeholder: "distance" },
  duplicate: { icon: "move", placeholder: "offset, then 4x or /4" },
  rotate: { icon: "rotate", placeholder: "angle, degrees" },
  mirror: { icon: "move", placeholder: "where the plane crosses" },
  align: { icon: "move", placeholder: "pick a face" },
};

/** Mirror's option (E-UX-8): remove the originals in the same step. */
function MirrorOptions() {
  const o = mirrorOptions.value;
  return (
    <label class="cb-opt" data-testid="mirror-remove">
      <input
        type="checkbox"
        checked={o.remove}
        onChange={() => {
          mirrorOptions.value = { remove: !o.remove };
        }}
      />{" "}
      Remove the originals
    </label>
  );
}

export function CommandBar() {
  const tool = activeTool.value;
  const prompt = toolPrompt.value;
  const g = gesture.value;
  if (g && model.value) {
    return (
      <>
        <Hint />
        <GestureBar g={g} />
      </>
    );
  }
  return (
    <>
      <Hint />
      {/* The row is there before the model too, so the view never changes height under it. */}
      {tool === "select" || !model.value ? (
        <div class="command-row viewport-help" data-testid="viewport-help">
          drag: orbit · right-drag: pan · wheel: zoom · Shift-drag: box select · Delete: remove the
          selection · ?: keys
        </div>
      ) : (
        <section
          class="command-row command-bar"
          data-testid="command-bar"
          data-tool={tool}
          aria-label={`${TOOL_NAMES[tool]}: command bar`}
        >
          <span class="cb-tool">
            <Icon name={tool} /> {TOOL_NAMES[tool]}
          </span>
          <span class="cb-prompt" data-testid="command-prompt" title={prompt} aria-live="polite">
            {prompt}
          </span>
          {TAKES_VALUE.has(tool) && <ValueField tool={tool} />}
          {tool === "draw" && <DrawOptions />}
          {tool === "place" && <PlaceOptions />}
          {tool === "measure" && <MeasureResult />}
          {tool === "frame" && frameNumbers.value && (
            <output class="cb-chip" data-testid="frame-result" title={frameNumbers.value}>
              {frameNumbers.value}
            </output>
          )}
          <Result />
        </section>
      )}
    </>
  );
}
