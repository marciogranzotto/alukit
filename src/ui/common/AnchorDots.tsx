import { anchorPoint } from "#core/derive/frame.ts";

/**
 * A section's anchors as dots on its box (U40): the section's bounding box drawn small, a dot at
 * each anchor point it offers, the chosen one filled; a click on a dot chooses it. The draw tool's
 * command bar and the inspector's anchor row both show it (docs/ux/e4-decisions.md). Styles in
 * tools.css (`.cb-anchor-pad`, `.cb-dot`). Shared; owner: E4.
 */
export function AnchorDots({
  bbox,
  datums,
  anchors,
  value,
  onPick,
  disabled,
  size = 34,
}: {
  bbox: readonly [readonly [number, number], readonly [number, number]];
  datums?: Readonly<Record<string, readonly [number, number]>> | undefined;
  anchors: readonly string[];
  value: string;
  onPick: (anchor: string) => void;
  disabled?: boolean;
  size?: number;
}) {
  const [[x0, y0], [x1, y1]] = bbox;
  const w = x1 - x0;
  const h = y1 - y0;
  const k = (size - 8) / Math.max(w, h, 1);
  const at = (a: string) => {
    const p = anchorPoint(a, bbox, datums ?? {});
    return p ? [4 + (p[0] - x0) * k, size - 4 - (p[1] - y0) * k] : undefined;
  };
  return (
    <span class="cb-anchor-pad" style={{ width: `${size}px`, height: `${size}px` }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <rect class="cb-anchor-box" x={4} y={size - 4 - h * k} width={w * k} height={h * k} />
      </svg>
      {anchors.map((a) => {
        const p = at(a);
        if (!p) return null;
        return (
          <button
            type="button"
            key={a}
            class={a === value ? "cb-dot on" : "cb-dot"}
            style={{ left: `${p[0]}px`, top: `${p[1]}px` }}
            aria-pressed={a === value}
            aria-label={`anchor ${a}`}
            title={`anchor ${a}`}
            data-anchor={a}
            disabled={disabled}
            onClick={() => onPick(a)}
          />
        );
      })}
    </span>
  );
}
