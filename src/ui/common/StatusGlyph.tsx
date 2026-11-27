/**
 * A status as a shape, a word and a colour (docs/ux/visual-design.md §4.1): four distinct shapes,
 * so it survives greyscale and red-green colour blindness (WCAG 1.4.1). The shape is filled in the
 * status colour with its mark in `--status-ink`; the word is `StatusMark`'s. Owner: S4.
 */

export type Status = "ready" | "blocked" | "warn" | "info";

/** What each status is called, by default. */
export const STATUS_WORD: Readonly<Record<Status, string>> = {
  ready: "Ready",
  blocked: "Blocked",
  warn: "Warning",
  info: "Note",
};

const MARK = {
  stroke: "var(--status-ink)",
  "stroke-linecap": "round",
  "stroke-linejoin": "round",
  fill: "none",
} as const;

/** The shape: a circle and a tick, an octagon, a triangle, a circle and an i. 16 px grid. */
export function StatusGlyph({ status, size = 14 }: { status: Status; size?: number }) {
  return (
    <svg
      class={`glyph ${status}`}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
    >
      {status === "ready" && (
        <>
          <circle cx="8" cy="8" r="7" fill="currentColor" />
          <path d="M4.6 8.3l2.3 2.3 4.5-4.9" stroke-width="1.8" {...MARK} />
        </>
      )}
      {status === "blocked" && (
        <>
          <path d="M5.2 1h5.6L15 5.2v5.6L10.8 15H5.2L1 10.8V5.2z" fill="currentColor" />
          <path d="M5 8h6" stroke-width="2" {...MARK} />
        </>
      )}
      {status === "warn" && (
        <>
          <path
            d="M8 1.2l7 12.6H1z"
            fill="currentColor"
            stroke="currentColor"
            stroke-width="1"
            stroke-linejoin="round"
          />
          <path d="M8 6v3.6M8 11.6v.4" stroke-width="1.8" {...MARK} />
        </>
      )}
      {status === "info" && (
        <>
          <circle cx="8" cy="8" r="7" fill="currentColor" />
          <path d="M8 7.2v4.2M8 4.6v.4" stroke-width="1.8" {...MARK} />
        </>
      )}
    </svg>
  );
}

/** The glyph and a word, in the status colour. `word` overrides the default. */
export function StatusMark({
  status,
  word,
  size,
}: {
  status: Status;
  word?: string;
  size?: number;
}) {
  return (
    <span class={`status-mark ${status}`} data-status={status}>
      <StatusGlyph status={status} {...(size !== undefined ? { size } : {})} />
      <span>{word ?? STATUS_WORD[status]}</span>
    </span>
  );
}
