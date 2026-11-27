import { useEffect } from "preact/hooks";
import type { SectionPlane, Viewer } from "../../viewer/scene.ts";
import { STANDARD_VIEWS } from "../../viewer/views.ts";
import { selection } from "../focus.ts";
import { chord, onKey } from "../keys.ts";
import { model } from "../store.ts";
import { projection, sectionPlane, viewer } from "./viewer.ts";

/**
 * The view controls over the viewport (design §8): standard views, perspective or orthographic,
 * fit to the selection, and the section plane, with their keys (F fits, O switches the
 * projection). They change the view only, never the document. Owner: S3.
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

export function ViewControls() {
  const v = viewer.value;
  useEffect(() => onKey("app", viewKey), []);
  return (
    <>
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
        onClick={() => toggleProjection(v)}
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
    </>
  );
}
