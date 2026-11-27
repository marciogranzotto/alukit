import { signal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import type { V3 } from "../../mesh/model.ts";
import { ItemSwatch } from "../common/ItemSwatch.tsx";
import { clearShow, hover, selection, show, shown } from "../focus.ts";
import { ProblemList, ProblemRow } from "../problems/ProblemRow.tsx";
import { problemList } from "../problems/source.ts";
import { model } from "../store.ts";
import { resolveTargets, type Targets } from "../targets.ts";
import { theme } from "../theme/theme.ts";
import { viewTheme } from "../theme/tokens.ts";
import { LengthLabel } from "../tools/LengthEdit.tsx";
import { colourBy, drawnCorners, ghostsRest, viewer } from "./viewer.ts";
import { endsWords, hoverWords, itemCode, legendItems } from "./words.ts";

/**
 * What the viewport draws in the page over the canvas (docs/ux/visual-design.md §5.3; plan
 * §5.3): the hover label by the pointer, the selected bar's label at its middle, Show's callout
 * at its target, the colour-by-item legend, and the orientation gizmo. Each follows the scene
 * after every frame (`Viewer.onRender`). None is drawn in snapshot mode. Owner: S3.
 */

const css = (c: number) => `#${c.toString(16).padStart(6, "0")}`;

/** Keeps an element at a world point's place in the viewport, after every frame. */
function useAnchor(at: V3 | undefined, host: { current: HTMLElement | null }) {
  useEffect(() => {
    const v = viewer.value;
    const el = host.current;
    if (!v || !el || !at) return;
    const place = () => {
      const s = v.project(at);
      const parent = el.offsetParent as HTMLElement | null;
      if (!s || !parent) {
        el.style.visibility = "hidden";
        return;
      }
      const r = parent.getBoundingClientRect();
      el.style.visibility = "";
      el.style.transform = `translate(${Math.round(s[0] - r.left)}px, ${Math.round(s[1] - r.top)}px)`;
    };
    place();
    return v.onRender(place);
  }, [at?.[0], at?.[1], at?.[2], viewer.value]);
}

/** The pointer over the viewport, for the hover label. */
const pointer = signal<{ x: number; y: number } | undefined>(undefined);

/** Follows the pointer over an element (the viewport), while it is there. */
export function usePointer(host: { current: HTMLElement | null }) {
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const move = (e: PointerEvent) => {
      pointer.value = { x: e.clientX, y: e.clientY };
    };
    const leave = () => {
      pointer.value = undefined;
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerleave", leave);
    return () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerleave", leave);
    };
  }, []);
}

/** C §5.3: by the pointer, what a click would select, in words. */
export function HoverLabel() {
  const h = hover.value;
  const m = model.value;
  const p = pointer.value;
  const id = h?.from === "view" ? h.ids[0] : undefined;
  if (id === undefined || !m || !p) return null;
  const lines = hoverWords(m, id, drawnCorners.value);
  return (
    <div
      class="hover-label"
      data-testid="hover-label"
      style={{ left: `${p.x + 14}px`, top: `${p.y + 14}px` }}
    >
      {lines.map((l, i) => (
        <div key={i} class={i === 0 ? "first" : undefined}>
          {l}
        </div>
      ))}
    </div>
  );
}

/** C §5.3: one bar selected, its cut length and both ends at its middle. */
export function SelectionLabel() {
  const host = useRef<HTMLDivElement>(null);
  const m = model.value;
  const ids = [...selection.value];
  const id = ids.length === 1 ? ids[0] : undefined;
  const bar = id ? m?.derived.bars[id] : undefined;
  const at: V3 | undefined = bar && [
    (bar.a[0] + bar.b[0]) / 2,
    (bar.a[1] + bar.b[1]) / 2,
    (bar.a[2] + bar.b[2]) / 2,
  ];
  useAnchor(at, host);
  if (!m || !id || !bar) return null;
  // The cut is a button: a click types a new length into it (S5's LengthLabel).
  return (
    <div class="sel-label anchored" ref={host} data-testid="selection-label">
      <LengthLabel m={m} id={id} ends={endsWords(m, id) ?? ""} />
    </div>
  );
}

/** Show's state: the request, its targets, and which of them the callout is at. */
const step = signal(0);

/**
 * Show in 3D (B §5.3): the camera frames the targets keeping its direction, they pulse three
 * times, and everything else is ghosted until Esc for a problem or when asked (`ghostsRest`).
 * This callout sits at the first target with the problem's row (S4's `ProblemRow`, its fixes
 * with it) and steps through the targets, framing and pulsing each.
 */
export function Callout() {
  const host = useRef<HTMLDivElement>(null);
  const s = shown.value;
  const m = model.value;
  const t: Targets | undefined = s && m ? resolveTargets(m, s.refs) : undefined;
  const n = t ? t.ids.length : 0;
  const k = Math.min(step.value, Math.max(n - 1, 0));
  const current = t && n > 1 && step.value > 0 && m ? resolveTargets(m, [t.ids[k] as string]) : t;
  useAnchor(current?.points[0] ?? centre(current), host);
  useEffect(() => {
    step.value = 0;
  }, [s?.n]);
  if (!s || !m || !t) return null;
  // The problem as the Problems sheet lists it (S4's source: the served answer, or the check's
  // diagnostics until it is served). An order reason is not in it until then: its refs show.
  const problem = s.problem
    ? problemList.value?.answer.problems.find((p) => p.id === s.problem)
    : undefined;
  const go = (d: number) => {
    const next = (k + d + n) % n;
    step.value = next;
    const one = resolveTargets(m, [t.ids[next] as string]);
    const v = viewer.value;
    if (one.box) v?.fitBox(one.box);
    v?.pulse(new Set(one.bodies));
  };
  return (
    <div class="callout anchored" ref={host} data-testid="callout">
      <div class="callout-head">
        {n > 1 && (
          <span class="callout-steps">
            <button type="button" aria-label="Previous target" onClick={() => go(-1)}>
              ◀
            </button>
            {/* The targets' stepper, named so it is not read as the problems' (review m7). */}
            <span data-testid="callout-step">
              target {k + 1} of {n}
            </span>
            <button type="button" aria-label="Next target" onClick={() => go(1)}>
              ▶
            </button>
          </span>
        )}
        <span class="callout-what">{n > 0 ? t.ids[k] : "the whole model"}</span>
        <button type="button" class="callout-close" aria-label="Stop showing" onClick={clearShow}>
          ×
        </button>
      </div>
      {problem ? (
        <div class="callout-problem">
          <ProblemList label="The problem shown">
            <ProblemRow p={problem} compact inCallout />
          </ProblemList>
        </div>
      ) : (
        <p class="callout-refs">{s.refs.join(", ")}</p>
      )}
      {ghostsRest(s) && <p class="callout-hint">Others dimmed · Esc to leave</p>}
    </div>
  );
}

function centre(t: Targets | undefined): V3 | undefined {
  if (!t?.box) return undefined;
  const [a, b] = t.box;
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
}

/** S3.10: with the view coloured by item, the items and their colours; an entry isolates its item. */
export function Legend() {
  const m = model.value;
  if (colourBy.value !== "item" || !m) return null;
  return (
    <div class="legend" data-testid="legend">
      {legendItems(m).map(({ item, name }) => (
        <button
          type="button"
          key={item}
          class="legend-item"
          data-item={item}
          title={`${item}: show what uses it, the rest dimmed`}
          onClick={() => show({ refs: [item], isolate: true })}
        >
          <ItemSwatch item={item} />
          <span class="code">{itemCode(m, item)}</span> <span class="name">{name}</span>
        </button>
      ))}
    </div>
  );
}

/** The world axes as the gizmo draws them, and the standard view each end looks from. */
const AXES = [
  { axis: "x", dir: [1, 0, 0], pos: "right", neg: "left" },
  { axis: "y", dir: [0, 1, 0], pos: "back", neg: "front" },
  { axis: "z", dir: [0, 0, 1], pos: "top", neg: "bottom" },
] as const;

const GIZMO = { size: 72, len: 26 } as const;

/** A view's name with a capital, as a button's title says it. */
const title = (view: string) => `${view[0]?.toUpperCase()}${view.slice(1)} view`;

/**
 * C §5.1: a 72 px axes gizmo, bottom left, Z up, each axis in its colour. The lines are drawn;
 * the ends are buttons that turn the view to look along their axis (the labelled end from it,
 * the other from the opposite side), the nearest axis on top.
 */
export function Gizmo() {
  const host = useRef<HTMLDivElement>(null);
  const t = viewTheme(theme.value).overlay.axis;
  useEffect(() => {
    const v = viewer.value;
    const root = host.current;
    if (!v || !root) return;
    const place = () => {
      const c = v.camera();
      const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      const back: V3 = [
        c.position[0] - c.target[0],
        c.position[1] - c.target[1],
        c.position[2] - c.target[2],
      ];
      const half = GIZMO.size / 2;
      for (const a of AXES) {
        const x = dot(a.dir, c.right) * GIZMO.len;
        const y = -dot(a.dir, c.up) * GIZMO.len;
        const depth = dot(a.dir, back) / Math.hypot(...back);
        const line = root.querySelector(`line[data-axis="${a.axis}"]`);
        line?.setAttribute("x1", String(half - x));
        line?.setAttribute("y1", String(half - y));
        line?.setAttribute("x2", String(half + x));
        line?.setAttribute("y2", String(half + y));
        for (const [end, s] of [
          ["pos", 1],
          ["neg", -1],
        ] as const) {
          const b = root.querySelector(`button[data-end="${a.axis}-${end}"]`) as HTMLElement | null;
          if (!b) continue;
          b.style.transform = `translate(${half + s * x}px, ${half + s * y}px)`;
          b.style.zIndex = String(Math.round(10 + s * depth * 5));
        }
      }
    };
    place();
    return v.onRender(place);
  }, [viewer.value]);
  const v = viewer.value;
  return (
    <div class="gizmo" data-testid="gizmo" ref={host}>
      <svg
        width={GIZMO.size}
        height={GIZMO.size}
        viewBox={`0 0 ${GIZMO.size} ${GIZMO.size}`}
        aria-hidden="true"
      >
        {AXES.map((a) => (
          <line key={a.axis} data-axis={a.axis} stroke={css(t[a.axis])} stroke-width={2} />
        ))}
      </svg>
      {AXES.flatMap((a) =>
        (["pos", "neg"] as const).map((end) => (
          <button
            type="button"
            key={`${a.axis}-${end}`}
            class={`gizmo-end ${end}`}
            data-end={`${a.axis}-${end}`}
            style={{ color: css(t[a.axis]) }}
            title={title(a[end])}
            aria-label={title(a[end])}
            onClick={() => v?.setView(a[end], undefined, true)}
          >
            {end === "pos" ? a.axis.toUpperCase() : ""}
          </button>
        )),
      )}
    </div>
  );
}
