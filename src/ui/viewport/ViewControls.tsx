import { useEffect } from "preact/hooks";
import type { SectionPlane, Viewer } from "../../viewer/scene.ts";
import type { StandardView } from "../../viewer/views.ts";
import { selection } from "../focus.ts";
import { Icon, type IconName } from "../icons/Icons.tsx";
import { chord, onKey } from "../keys.ts";
import { model } from "../store.ts";
import { viewActions } from "./actions.ts";
import {
  colourBy,
  type JointMarkers,
  jointMarkers,
  projection,
  sectionPlane,
  showProblems,
  viewer,
} from "./viewer.ts";

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

/** O switches the projection. F, which fits, is the `fit` action's (viewport/actions.ts). */
function viewKey(e: KeyboardEvent): boolean {
  if (chord(e) || e.key.toLowerCase() !== "o") return false;
  const v = viewer.value;
  if (v) toggleProjection(v);
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
        aria-label="Section"
        title="Section plane: cut the view square to an axis (the document is unchanged)"
        disabled={!v}
        onClick={() => {
          if (!v) return;
          if (s) setSection(undefined);
          else setSection(lastSection ?? middleSection(v, "x"));
        }}
      >
        <Labelled icon="section" word="Section" />
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

/** The views the bar offers, their words and S4's icons (a cube, the face looked at filled). */
const VIEWS: readonly { name: StandardView; word: string; icon: IconName }[] = [
  { name: "iso", word: "Iso", icon: "iso" },
  { name: "top", word: "Top", icon: "top" },
  { name: "front", word: "Front", icon: "front" },
  { name: "right", word: "Side", icon: "side" },
];

/**
 * S4's icon, and its word beside it from 1440 px (`.icon-word`); below that the button's label
 * and its title say the word.
 */
function Labelled({ icon, word }: { icon: IconName; word: string }) {
  return (
    <>
      <Icon name={icon} />
      <span class="icon-word">{word}</span>
    </>
  );
}

/** A display toggle: pressed while what it shows is drawn. */
/** The Joints button's three states, in the order a press steps through them (review m8). */
const NEXT_JOINTS: Readonly<Record<JointMarkers, JointMarkers>> = {
  problems: "off",
  off: "all",
  all: "problems",
};
const JOINT_TITLES: Readonly<Record<JointMarkers, string>> = {
  problems:
    "Joint markers at the open (ring) and failed (cross) corners; a joined one (dot) when hovered or selected. Press: none",
  off: "No joint markers. Press: a marker at every corner",
  all: "A joint marker at every corner: dot joined, ring open, cross failed. Press: the open and failed only",
};

function Toggle({
  on,
  testid,
  icon,
  word,
  title,
  state,
  onClick,
}: {
  on: boolean;
  testid: string;
  icon: IconName;
  word: string;
  title: string;
  state?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      class={on ? "tb on" : "tb"}
      data-testid={testid}
      data-state={state}
      aria-pressed={on}
      aria-label={word}
      title={title}
      onClick={onClick}
    >
      <Labelled icon={icon} word={word} />
    </button>
  );
}

/**
 * Three groups (S3.11): the views (standard views, orthographic, fit), the section plane, and
 * what the view shows (joint markers, problem badges, colour by item). Toggles say what they
 * turn on and show their state with `aria-pressed`, so the projection button names the action
 * (U58). Each shows S4.10's icon, and its word beside it from 1440 px; the word is its label.
 */
export function ViewControls() {
  const v = viewer.value;
  useEffect(() => {
    const offs = [onKey("app", viewKey), viewActions()];
    return () => {
      for (const off of offs) off();
    };
  }, []);
  return (
    <>
      <fieldset class="tb-group" aria-label="View">
        {VIEWS.map((x) => (
          <button
            type="button"
            class="tb"
            key={x.name}
            data-testid={`view-${x.name}`}
            aria-label={`${x.word} view`}
            title={`${x.word} view`}
            onClick={() => v?.setView(x.name, undefined, true)}
          >
            <Labelled icon={x.icon} word={x.word} />
          </button>
        ))}
        <Toggle
          on={projection.value === "orthographic"}
          testid="projection"
          icon="ortho"
          word="Orthographic"
          title="Orthographic projection: no perspective (O)"
          onClick={() => toggleProjection(v)}
        />
        <button
          type="button"
          class="tb"
          data-testid="fit"
          aria-label="Fit"
          title="Fit to the selection, or to everything (F)"
          onClick={() => v?.fitSelection(selection.value)}
        >
          <Labelled icon="fit" word="Fit" />
        </button>
      </fieldset>
      <fieldset class="tb-group" aria-label="Section">
        <SectionTools />
      </fieldset>
      <fieldset class="tb-group" aria-label="Show">
        <Toggle
          on={jointMarkers.value !== "off"}
          testid="toggle-joints"
          icon="joints"
          word={jointMarkers.value === "all" ? "Joints: all" : "Joints"}
          title={JOINT_TITLES[jointMarkers.value]}
          state={jointMarkers.value}
          onClick={() => {
            jointMarkers.value = NEXT_JOINTS[jointMarkers.value];
          }}
        />
        <Toggle
          on={showProblems.value}
          testid="toggle-problems"
          icon="problems"
          word="Problems"
          title="Problems drawn on their parts: an octagon and a red outline blocks or errs, a triangle warns"
          onClick={() => {
            showProblems.value = !showProblems.value;
          }}
        />
        <Toggle
          on={colourBy.value === "item"}
          testid="colour-by"
          icon="colour-by"
          word="Colour by item"
          title="Colour by item, with a legend; off: by finish"
          onClick={() => {
            colourBy.value = colourBy.value === "item" ? "finish" : "item";
          }}
        />
      </fieldset>
    </>
  );
}
