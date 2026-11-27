import type { JSX } from "preact";

/**
 * The domain icons (docs/ux/visual-design.md §4.5): 16 px on a 16 px grid, 1.5 px strokes in
 * `currentColor`, drawn from what the tools do rather than taken from a general set. Tools,
 * views and display toggles each have theirs; the viewport's rail and the tool bar (S3, S5) place
 * them, with the word beside the icon from 1440 px and the word and key in the tooltip below
 * (`.icon-word`, base.css). A filled face in a view icon is the face looked at. Owner: S4.
 */

const FACES = {
  // The three faces of a cube seen from a corner: top, front, side.
  top: "M8 1.5l5.5 3L8 7.5 2.5 4.5z",
  front: "M2.5 4.5L8 7.5v7l-5.5-3z",
  side: "M13.5 4.5L8 7.5v7l5.5-3z",
};

const CUBE = <path d="M8 1.5l5.5 3v7l-5.5 3-5.5-3v-7zM2.5 4.5L8 7.5l5.5-3M8 7.5v7" />;

/** Each icon's drawing, by name: the fill (if any) and the strokes. */
const DRAW = {
  // Tools
  select: <path d="M3.5 2l8 5.2-3.4.9 2 3.9-1.6.8-2-3.9L4 11.2z" />,
  draw: (
    <>
      <rect x="1.5" y="9.5" width="3" height="3" fill="currentColor" />
      <path d="M4.5 11h4.5M9 11l4.5-6" />
      <path d="M11.5 3.5l3 3" />
    </>
  ),
  connect: <path d="M2 4h12v3H9.5v7h-3V7H2z" />,
  place: (
    <>
      <path d="M1.5 11h13v2.5h-13z" />
      <path d="M5 11V6h5v5M5 6l2-2.5h3" />
    </>
  ),
  pattern: (
    <>
      <rect x="1.5" y="6" width="3" height="4" />
      <rect x="6.5" y="6" width="3" height="4" />
      <rect x="11.5" y="6" width="3" height="4" />
      <path d="M2 13.5h12M2 13l-.5.5.5.5M14 13l.5.5-.5.5" />
    </>
  ),
  measure: (
    <>
      <path d="M2 13.5V6M14 13.5V6M2 10h12" />
      <path d="M4 8.2L2 10l2 1.8M12 8.2l2 1.8-2 1.8" />
    </>
  ),
  // The Move tool: four arrows out from a centre
  move: (
    <>
      <path d="M8 1.5v13M1.5 8h13" />
      <path d="M6 3.5l2-2 2 2M6 12.5l2 2 2-2M3.5 6l-2 2 2 2M12.5 6l2 2-2 2" />
    </>
  ),
  // The box frame tool (S5.7): a frame's rings and posts, seen from a corner
  frame: (
    <>
      <path d="M2 5.5h9v8H2zM2 5.5l3-3h9l-3 3M14 2.5v8l-3 3" />
      <path d="M5 2.5v8h9M5 10.5l-3 3" opacity="0.5" />
    </>
  ),
  // Views: a cube with the face looked at filled
  iso: CUBE,
  top: (
    <>
      {CUBE}
      <path d={FACES.top} fill="currentColor" />
    </>
  ),
  front: (
    <>
      {CUBE}
      <path d={FACES.front} fill="currentColor" />
    </>
  ),
  side: (
    <>
      {CUBE}
      <path d={FACES.side} fill="currentColor" />
    </>
  ),
  persp: <path d="M2 13.5l3-9h6l3 9zM5 4.5L6.5 13.5M11 4.5L9.5 13.5" />,
  ortho: <rect x="2.5" y="2.5" width="11" height="11" />,
  fit: <path d="M2 5.5V2h3.5M10.5 2H14v3.5M14 10.5V14h-3.5M5.5 14H2v-3.5" />,
  section: (
    <>
      {CUBE}
      <path d="M1 9.5l7-3.2 7 3.2-7 3.2z" fill="currentColor" fill-opacity="0.25" />
    </>
  ),
  // Display toggles
  "colour-by": (
    <>
      <rect x="1.5" y="9" width="4" height="5" fill="currentColor" fill-opacity="0.9" />
      <rect x="6" y="5" width="4" height="9" fill="currentColor" fill-opacity="0.55" />
      <rect x="10.5" y="2" width="4" height="12" fill="currentColor" fill-opacity="0.25" />
    </>
  ),
  problems: <path d="M8 2l6.5 11.5h-13zM8 6.5v3M8 11.2v.3" />,
  // Two bars meeting at a corner, its joint marker filled (S3's joint markers)
  joints: (
    <>
      <path d="M4 1.5V12h10.5" />
      <circle cx="4" cy="12" r="2.5" fill="currentColor" />
    </>
  ),
} satisfies Record<string, JSX.Element>;

export type IconName = keyof typeof DRAW;

/** The names, for a test and for a gallery. */
export const ICON_NAMES = Object.keys(DRAW) as IconName[];

/** A 16 px icon in the current text colour. Decorative: its word sits beside it, or in the tooltip. */
export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg
      class="icon"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {DRAW[name]}
    </svg>
  );
}
