import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { V3 } from "../../mesh/model.ts";
import { endBatch } from "../edit/batches.ts";
import { mm } from "../format.ts";
import type { Model } from "../model.ts";
import { pointParam } from "../records/Params.tsx";
import { sendCommands } from "../store.ts";
import { viewer } from "../viewport/viewer.ts";
import { endAxis, endStops, labelEnd, typedCut, typedLanding } from "./ends.ts";
import { createPreviewer, type JointPreviewer } from "./preview.ts";
import { drawOptions, gesture, jointPreview, labelEdit } from "./state.ts";
import { endGhost, endNote, endWords } from "./wire/ends.ts";

/**
 * The selected bar's length label, and typing a new length into it (docs/ux/drag-ends-decisions.md;
 * Fusion's and Onshape's "click the dimension, type the value"). The label says the cut length, the
 * number a builder measures and the cut list prints, so that is what a click edits: "cut 569.88
 * mm". The typed value (an expression, params and units, D-UX-17; `+50` from the cut now) moves
 * the end `labelEnd` picks, which the handles draw larger while the field is open, and lands as one
 * step: `moveEnd` with `cut_mm`, then `autoConnect`, so an end that lands on a bar joins it, which
 * the joint preview says first (Tab flips it). Enter commits, Esc cancels. Owner: S5.
 */

const num = (x: number) => mm(x).replace(/\.00$/, "");

/** The label's text: the cut, and each end square or at its angle. */
export function LengthLabel({ m, id, ends }: { m: Model; id: string; ends: string }) {
  const bar = m.derived.bars[id];
  const g = gesture.value;
  const [open, setOpen] = useState<"edit" | "note" | undefined>();
  useEffect(() => setOpen(undefined), [id, m.rev]);
  if (!bar) return null;
  if (g?.kind === "end" && g.bar === id) {
    return <span data-testid="length-reading">{g.reading}</span>;
  }
  const choice = labelEnd(m, id);
  if (open === "edit" && "end" in choice) {
    return <LengthField m={m} id={id} end={choice.end} onClose={() => setOpen(undefined)} />;
  }
  return (
    <>
      <button
        type="button"
        class="sel-len"
        data-testid="length-label"
        title="The cut length: click to type a new one"
        onClick={() => setOpen("end" in choice ? "edit" : open === "note" ? undefined : "note")}
      >
        cut {mm(bar.cut_mm)} mm
      </button>
      {`  ${ends}`}
      {open === "note" && !("end" in choice) && (
        <div class="sel-note" role="status" data-testid="length-note">
          {"driven" in choice ? (
            <>
              driven by {choice.driven.params.join(", ")}:{" "}
              {choice.driven.params.map((p) => (
                <button
                  key={p}
                  type="button"
                  class="link"
                  data-testid={`label-edit-param-${p}`}
                  onClick={() => pointParam(p)}
                >
                  edit {p}
                </button>
              ))}
            </>
          ) : (
            choice.why
          )}
        </div>
      )}
    </>
  );
}

function LengthField({
  m,
  id,
  end,
  onClose,
}: {
  m: Model;
  id: string;
  end: "a" | "b";
  onClose: () => void;
}) {
  const bar = m.derived.bars[id];
  const axis = useMemo(() => endAxis(m, id, end), [m, id, end]);
  const ref = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(bar ? num(bar.cut_mm) : "");
  const [error, setError] = useState<string>();
  const preview = useRef<JointPreviewer | undefined>(undefined);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    labelEdit.value = { bar: id, end };
    const v = viewer.peek();
    if (v) {
      preview.current = createPreviewer(
        v,
        () => labelEdit.peek()?.bar === id,
        () => drawOptions.peek().prefer,
      );
    }
    ref.current?.focus();
    ref.current?.select();
    return () => {
      alive.current = false;
      labelEdit.value = undefined;
      preview.current?.reset();
      viewer.peek()?.setOverlay({});
    };
  }, [id, end]);

  const ref_ = `${id}.${end}`;
  const stops = useMemo(() => (axis ? endStops(m, axis) : []), [m, axis]);
  /** The rule the joint follows: Tab's, else the command bar's, else the project's. */
  const rule = () => preview.current?.flipped ?? drawOptions.peek().prefer;

  // The preview of what the typed length would do, once typing rests.
  useEffect(() => {
    if (!axis || !preview.current) return;
    const c = typedCut(text, axis.cut, m.derived.params);
    if (!("cut" in c) || Math.abs(c.cut - axis.cut) < 0.005) {
      preview.current.ask(undefined);
      viewer.peek()?.setOverlay({});
      return;
    }
    const l = typedLanding(axis, stops, c.cut, c.written);
    const s = l.face;
    const at: V3 = [
      axis.Q[0] + axis.u[0] * s,
      axis.Q[1] + axis.u[1] * s,
      axis.Q[2] + axis.u[2] * s,
    ];
    // The bar at the length typed, so the end that moves shows before Enter.
    viewer.peek()?.setOverlay(endGhost(m, id, end, at, l.stop));
    preview.current.ask({
      commands: (prefer) => endBatch(ref_, l, false, prefer ?? rule()),
      at,
      soon: false,
      words: (r) => endWords(r, id, l.stop),
    });
  }, [text, axis]);

  async function commit(): Promise<void> {
    if (!axis) return;
    const c = typedCut(text, axis.cut, m.derived.params);
    if (!("cut" in c)) {
      setError(c.why);
      return;
    }
    if (Math.abs(c.cut - axis.cut) < 0.005) {
      onClose();
      return;
    }
    const l = typedLanding(axis, stops, c.cut, c.written);
    const o = await sendCommands(endBatch(ref_, l, false, rule()), `set ${id}'s cut length`, {
      inline: true,
    });
    if (!alive.current) return;
    if (o.ok) onClose();
    else setError(o.why);
  }

  const j = jointPreview.value;
  return (
    <span class="sel-edit" data-testid="length-edit">
      <label>
        cut{" "}
        <input
          ref={ref}
          class="sel-field"
          data-testid="length-field"
          aria-label={`${id}: cut length, mm; moves end ${end}`}
          spellcheck={false}
          autocomplete="off"
          value={text}
          size={9}
          onInput={(e) => {
            setText((e.currentTarget as HTMLInputElement).value);
            setError(undefined);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              onClose();
            } else if (e.key === "Tab" && !e.shiftKey && jointPreview.peek()) {
              e.preventDefault();
              void preview.current?.flip();
            }
          }}
          onBlur={() => {
            // A click elsewhere leaves the length as it was.
            setTimeout(() => {
              if (alive.current && document.activeElement !== ref.current) onClose();
            }, 0);
          }}
        />{" "}
        mm
      </label>
      <span class="sel-sub" data-testid="length-end">
        moves end {end}
      </span>
      {(error || j) && (
        <span
          class={error ? "sel-sub error" : "sel-sub"}
          data-testid={error ? "length-error" : "length-preview"}
        >
          {error ?? `${j?.text}${j && j.joins !== false ? " · Tab: flip" : ""}`}
        </span>
      )}
    </span>
  );
}

/** A locked handle pressed: what holds that end, by the handle, until the selection changes. */
export function EndNoteView() {
  const n = endNote.value;
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const v = viewer.peek();
    const el = host.current;
    if (!v || !el || !n) return;
    const place = () => {
      const s = v.project(n.at);
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
  }, [n]);
  if (!n) return null;
  return (
    <div class="end-note anchored" ref={host} role="status" data-testid="end-note">
      {n.text}
      {n.params.map((p) => (
        <button
          key={p}
          type="button"
          class="link"
          data-testid={`end-note-param-${p}`}
          onClick={() => pointParam(p)}
        >
          {" "}
          edit {p}
        </button>
      ))}
    </div>
  );
}
