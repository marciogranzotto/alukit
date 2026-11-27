import { useEffect } from "preact/hooks";
import type { SectionPlane, Viewer } from "../../viewer/scene.ts";
import { STANDARD_VIEWS } from "../../viewer/views.ts";
import { selection } from "../focus.ts";
import { chord, onKey } from "../keys.ts";
import { model } from "../store.ts";
import { colourBy, projection, sectionPlane, showJoints, showProblems, viewer } from "./viewer.ts";

/**
 * The view controls over the viewport (design §8): standard views, perspective or orthographic,
 * fit to the selection, the section plane, with their keys (F fits, O switches the projection),
 * and the display toggles. They change the view only, never the document. Owner: S3.
 */

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

function toggleProjection(v: Viewer | undefined): void {
  const next = projection.value === "perspective" ? "orthographic" : "perspective";
  v?.setProjection(next);
  projection.value = next;
}

/** F fits the selection (or everything), O switches the projection. */
function viewKey(e: KeyboardEvent): boolean {
  if (chord(e)) return false;
  const k = e.key.toLowerCase();
  if (k !== "f" && k !== "o") return false;
  const v = viewer.value;
  if (k === "f") v?.fitSelection(selection.value);
  else if (v) toggleProjection(v);
  return true;
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

const VIEW_TEXT: Readonly<Record<string, string>> = {
  iso: "Iso",
  top: "Top",
  front: "Front",
  right: "Side",
  left: "Left",
  back: "Back",
  bottom: "Bottom",
};

/** A display toggle: pressed while what it shows is drawn. */
function Toggle({
  on,
  testid,
  title,
  onClick,
  children,
}: {
  on: boolean;
  testid: string;
  title: string;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      class={on ? "tb on" : "tb"}
      data-testid={testid}
      aria-pressed={on}
      title={title}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/**
 * Three groups (S3.11): the views (standard views, orthographic, fit), the section plane, and
 * what the view shows (joint markers, problem badges, colour by item). Toggles say what they
 * turn on and show their state with `aria-pressed`, so the projection button names the action
 * (U58). S4.10's icons take the words' place below 1440 px when they land.
 */
export function ViewControls() {
  const v = viewer.value;
  useEffect(() => onKey("app", viewKey), []);
  return (
    <>
      <fieldset class="tb-group" aria-label="View">
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
        <Toggle
          on={projection.value === "orthographic"}
          testid="projection"
          title="Orthographic projection: no perspective (O)"
          onClick={() => toggleProjection(v)}
        >
          Orthographic
        </Toggle>
        <button
          type="button"
          class="tb"
          data-testid="fit"
          title="Fit to the selection, or to everything (F)"
          onClick={() => v?.fitSelection(selection.value)}
        >
          Fit
        </button>
      </fieldset>
      <fieldset class="tb-group" aria-label="Section">
        <SectionTools />
      </fieldset>
      <fieldset class="tb-group" aria-label="Show">
        <Toggle
          on={showJoints.value}
          testid="toggle-joints"
          title="Joint markers at every corner: filled joined, ring open, cross failed"
          onClick={() => {
            showJoints.value = !showJoints.value;
          }}
        >
          Joints
        </Toggle>
        <Toggle
          on={showProblems.value}
          testid="toggle-problems"
          title="Problems drawn on their parts: octagon blocks or errs, triangle warns"
          onClick={() => {
            showProblems.value = !showProblems.value;
          }}
        >
          Problems
        </Toggle>
        <Toggle
          on={colourBy.value === "item"}
          testid="colour-by"
          title="Colour by item, with a legend; off: by finish"
          onClick={() => {
            colourBy.value = colourBy.value === "item" ? "finish" : "item";
          }}
        >
          Colour by item
        </Toggle>
      </fieldset>
    </>
  );
}
