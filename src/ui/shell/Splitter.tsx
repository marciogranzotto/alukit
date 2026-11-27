import type { TargetedKeyboardEvent, TargetedPointerEvent } from "preact";
import { useRef } from "preact/hooks";

/**
 * A splitter between two regions (docs/ux/plan.md S2.1): drag it, or focus it and press the
 * arrow keys (16 px a press; Home and End to the limits), to resize the region it belongs to.
 * It is a focusable `separator` with its value, as WAI-ARIA's window splitter pattern has it.
 * Owner: S2.
 *
 * `grows` says which way of moving the pointer makes the region bigger: `right` for the left
 * column, `left` for the right column, `up` for the sheets below.
 */
export function Splitter({
  label,
  value,
  min,
  max,
  grows,
  onChange,
  class: cls,
  testid,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  grows: "right" | "left" | "up";
  /** The new size; `done` once the drag or key press ends, when it is worth remembering. */
  onChange: (size: number, done: boolean) => void;
  class?: string;
  testid?: string;
}) {
  const drag = useRef<{ from: number; size: number; last: number } | undefined>(undefined);
  const vertical = grows !== "up";
  const clamp = (x: number) => Math.round(Math.min(max, Math.max(min, x)));
  const sign = grows === "right" ? 1 : -1;
  const at = (e: PointerEvent) => (vertical ? e.clientX : e.clientY);

  const down = (e: TargetedPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { from: at(e), size: value, last: value };
  };
  const move = (e: TargetedPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    d.last = clamp(d.size + sign * (at(e) - d.from));
    onChange(d.last, false);
  };
  const up = () => {
    const d = drag.current;
    drag.current = undefined;
    if (d) onChange(d.last, true);
  };
  const key = (e: TargetedKeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 64 : 16;
    const bigger: Readonly<Record<string, number>> = vertical
      ? { ArrowRight: sign, ArrowLeft: -sign }
      : { ArrowUp: 1, ArrowDown: -1 };
    const d = bigger[e.key];
    let next: number | undefined;
    if (d !== undefined) next = clamp(value + d * step);
    else if (e.key === "Home") next = min;
    else if (e.key === "End") next = max;
    if (next === undefined) return;
    e.preventDefault();
    e.stopPropagation();
    onChange(next, true);
  };

  return (
    // biome-ignore lint/a11y/useSemanticElements: a window splitter is a focusable separator (WAI-ARIA APG); <hr> takes no focus
    <div
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation={vertical ? "vertical" : "horizontal"}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      class={`splitter ${vertical ? "vertical" : "horizontal"}${cls ? ` ${cls}` : ""}`}
      {...(testid ? { "data-testid": testid } : {})}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onKeyDown={key}
    />
  );
}
