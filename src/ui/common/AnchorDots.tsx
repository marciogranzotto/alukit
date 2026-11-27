import { anchorPoint } from "#core/derive/frame.ts";

/**
 * A section's anchors as dots on its box (U40): the section's bounding box drawn small, a dot at
 * each of its points the bar offers (the centre, the faces' middles, the corners), the chosen one
 * filled; a press on a dot chooses it. A section datum (`mount`, `heel`) is a named button beside
 * the box, its point marked in it. The draw tool's anchor picker and the inspector's anchor rows
 * (one bar, several) show it (docs/ux/e4-decisions.md 8). Styles in tools.css (`.cb-anchor-pad`,
 * `.cb-dot`, `.cb-datum`). Shared; owner: E4, the layout the editing polish's
 * (docs/ux/polish-editing-ui-decisions.md 2).
 *
 * **Every dot can be pressed, on any section.** Each dot is a 24 × 24 px button, WCAG 2.2's
 * minimum target (2.5.8), and the box is laid out so that neighbouring dots are at least that far
 * apart: its short side is drawn 48 px, so the three dots along it sit 24 px apart and their
 * targets touch without overlapping. The long side keeps the section's proportions up to 2 : 1
 * (a 40 × 80 is drawn to scale), and is drawn 2 : 1 beyond (a 20 × 80 too), so the pad stays a
 * size the inspector and a popover can hold. Before, the box was 26 px on its long side whatever
 * the section: a 40 × 80's narrow face put its dots 6.5 px apart, and a press on `-x+y` went to
 * `+y` (docs/ux/integration-editing.md, defect 3).
 */

/** The minimum target, px (WCAG 2.2, 2.5.8). */
export const TARGET = 24;
/** The drawn box's short side: two targets, so its three dots are one target apart. */
const SHORT = 2 * TARGET;
/** The proportion the drawn box keeps up to; a longer section is drawn this long. */
const MAX_ASPECT = 2;

type Box = readonly [readonly [number, number], readonly [number, number]];

/** A dot or a datum's mark: where its centre is drawn on the pad, px from its top left. */
export interface AnchorSpot {
  anchor: string;
  x: number;
  y: number;
}

/** The pad: its size, the box drawn on it, a dot at each box point, a mark at each datum. */
export interface AnchorLayout {
  width: number;
  height: number;
  box: { x: number; y: number; w: number; h: number };
  dots: AnchorSpot[];
  datums: AnchorSpot[];
}

const UNIT: Box = [
  [-1, -1],
  [1, 1],
];
/** A box point's sides along x and y (−1, 0, +1), read by §4.4's own rule on a unit box. */
const sides = (anchor: string) => anchorPoint(anchor, UNIT, {});

/** Where each anchor goes on the pad (above). Pure, so the unit tests measure it. */
export function anchorLayout(
  bbox: Box,
  datums: Readonly<Record<string, readonly [number, number]>>,
  anchors: readonly string[],
): AnchorLayout {
  const [[x0, y0], [x1, y1]] = bbox;
  const w = Math.max(x1 - x0, 1e-9);
  const h = Math.max(y1 - y0, 1e-9);
  const long = SHORT * Math.min(Math.max(w / h, h / w), MAX_ASPECT);
  const bw = w >= h ? long : SHORT;
  const bh = w >= h ? SHORT : long;
  const pad = TARGET / 2;
  const box = { x: pad, y: pad, w: bw, h: bh };
  const dots: AnchorSpot[] = [];
  const marks: AnchorSpot[] = [];
  for (const anchor of anchors) {
    const s = sides(anchor);
    if (s) {
      dots.push({ anchor, x: pad + ((s[0] + 1) / 2) * bw, y: pad + ((1 - s[1]) / 2) * bh });
      continue;
    }
    const p = anchorPoint(anchor, bbox, datums);
    if (p) marks.push({ anchor, x: pad + ((p[0] - x0) / w) * bw, y: pad + ((y1 - p[1]) / h) * bh });
  }
  return { width: bw + 2 * pad, height: bh + 2 * pad, box, dots, datums: marks };
}

export function AnchorDots({
  bbox,
  datums,
  anchors,
  value,
  onPick,
  disabled,
}: {
  bbox: Box;
  datums?: Readonly<Record<string, readonly [number, number]>> | undefined;
  anchors: readonly string[];
  /** The chosen anchor; none filled when it is not one of them ("varies"). */
  value: string;
  onPick: (anchor: string) => void;
  disabled?: boolean;
}) {
  const l = anchorLayout(bbox, datums ?? {}, anchors);
  const button = (a: string, cls: string, style?: Record<string, string>, text?: string) => (
    <button
      type="button"
      key={a}
      class={a === value ? `${cls} on` : cls}
      style={style}
      aria-pressed={a === value}
      aria-label={`anchor ${a}`}
      title={`anchor ${a}`}
      data-anchor={a}
      disabled={disabled}
      onClick={() => onPick(a)}
    >
      {text}
    </button>
  );
  return (
    <span class="cb-anchor-set">
      <span class="cb-anchor-pad" style={{ width: `${l.width}px`, height: `${l.height}px` }}>
        <svg
          width={l.width}
          height={l.height}
          viewBox={`0 0 ${l.width} ${l.height}`}
          aria-hidden="true"
        >
          <rect class="cb-anchor-box" x={l.box.x} y={l.box.y} width={l.box.w} height={l.box.h} />
          {l.datums.map((d) => (
            <path
              key={d.anchor}
              class={d.anchor === value ? "cb-datum-mark on" : "cb-datum-mark"}
              d={`M${d.x - 4} ${d.y}h8M${d.x} ${d.y - 4}v8`}
            />
          ))}
        </svg>
        {l.dots.map((d) =>
          button(d.anchor, "cb-dot", {
            left: `${d.x - TARGET / 2}px`,
            top: `${d.y - TARGET / 2}px`,
          }),
        )}
      </span>
      {l.datums.map((d) => button(d.anchor, "cb-datum", undefined, d.anchor))}
    </span>
  );
}

/**
 * The chosen anchor drawn small, for a summary or a label: the box at its proportions and the
 * point filled. Not pressable (its picker is); hidden from assistive tech, which reads the words
 * beside it.
 */
export function AnchorGlyph({
  bbox,
  datums,
  value,
}: {
  bbox: Box;
  datums?: Readonly<Record<string, readonly [number, number]>> | undefined;
  value: string;
}) {
  const [[x0, y0], [x1, y1]] = bbox;
  const w = Math.max(x1 - x0, 1e-9);
  const h = Math.max(y1 - y0, 1e-9);
  const k = 14 / Math.max(w, h);
  const p = anchorPoint(value, bbox, datums ?? {});
  return (
    <svg class="cb-anchor-glyph" width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
      <rect
        class="cb-anchor-box"
        x={10 - (w * k) / 2}
        y={10 - (h * k) / 2}
        width={w * k}
        height={h * k}
      />
      {p && (
        <circle
          class="cb-anchor-at"
          cx={10 - (w * k) / 2 + (p[0] - x0) * k}
          cy={10 + (h * k) / 2 - (p[1] - y0) * k}
          r="2.5"
        />
      )}
    </svg>
  );
}
