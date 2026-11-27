import type { Thumb } from "../../server/catalog.ts";

/**
 * A section that is only its box: four corners, no holes. A parametric bar with no drawn section
 * (a linear guide) has this, and drawn as a solid it reads as a black block, in the light theme
 * above all; it is drawn as the box it is (review N6).
 */
export function isPlainBox(s: Pick<Thumb, "outline" | "holes">): boolean {
  if (s.holes.length > 0) return false;
  const o = s.outline;
  const closed =
    o.length > 1 && o[0]?.[0] === o[o.length - 1]?.[0] && o[0]?.[1] === o[o.length - 1]?.[1];
  const corners = closed ? o.length - 1 : o.length;
  if (corners !== 4) return false;
  const xs = new Set(o.map((p) => p[0]));
  const ys = new Set(o.map((p) => p[1]));
  return xs.size === 2 && ys.size === 2;
}

/** A section drawn small, y up, fitted to its box: the catalog's lists and cards. Owner: S2. */
export function SectionThumb({
  s,
  size = 44,
}: {
  s: Pick<Thumb, "outline" | "holes" | "bbox">;
  size?: number;
}) {
  const [[x0, y0], [x1, y1]] = s.bbox;
  const w = x1 - x0;
  const h = y1 - y0;
  const pad = Math.max(w, h) * 0.06;
  const path = (r: readonly (readonly [number, number])[]) =>
    `${r.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x} ${-y}`).join(" ")} Z`;
  return (
    <svg
      class={isPlainBox(s) ? "thumb plain" : "thumb"}
      width={size}
      height={size}
      viewBox={`${x0 - pad} ${-y1 - pad} ${w + 2 * pad} ${h + 2 * pad}`}
      role="img"
      aria-label={`section, ${Math.round(w)} × ${Math.round(h)} mm`}
    >
      <path d={[s.outline, ...s.holes].map(path).join(" ")} fill-rule="evenodd" />
    </svg>
  );
}

/** A bar's own size, W × H in whole millimetres: the catalog's (BE-8) or its thumbnail's box. */
export function sizeOf(e: {
  size_mm?: readonly [number, number];
  thumb?: Pick<Thumb, "bbox">;
}): [number, number] | undefined {
  if (e.size_mm) return [Math.round(e.size_mm[0]), Math.round(e.size_mm[1])];
  if (!e.thumb) return undefined;
  const [[x0, y0], [x1, y1]] = e.thumb.bbox;
  return [Math.round(x1 - x0), Math.round(y1 - y0)];
}
