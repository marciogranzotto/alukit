import type { Thumb } from "../../server/catalog.ts";

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
      class="thumb"
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
