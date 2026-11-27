import { useEffect, useState } from "preact/hooks";
import { select, show } from "../focus.ts";
import { model, notice, summary, undo } from "../store.ts";
import { resolveTargets } from "../targets.ts";
import { dismissStepToast, type StepToast, stepToasts, TOAST_MS } from "./presence.ts";

/**
 * The toasts (docs/ux/plan.md S2.8, S2.15), at the viewport's top right: what a step did, and what
 * was refused or done that no form shows in place. A toast never takes the canvas's clicks, only
 * its own buttons do, so one never sits between the pointer and the model. Owner: S2.
 *
 * - A refusal stays until dismissed or the person's next step: its whole text, opened in place
 *   when long, Copy, and "Select the n places" when it names entities (U30, U31).
 * - A notice that something was done (an export) goes after a few seconds.
 * - A step's toast names who and what, with Show and, while it is the step Undo would take back,
 *   Undo it (presence.ts).
 */

/** The text a long refusal shows before "Show all": two lines' worth. */
const SHORT = 160;

function NoticeToast() {
  const n = notice.value;
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  // A done notice goes by itself; a refusal waits for the person.
  useEffect(() => {
    setOpen(false);
    setCopied(false);
    if (!n || n.error) return;
    const t = setTimeout(() => {
      if (notice.peek()?.n === n.n) notice.value = undefined;
    }, TOAST_MS.info);
    return () => clearTimeout(t);
  }, [n?.n]);
  if (!n) return null;
  const m = model.value;
  const places = m && n.refs ? resolveTargets(m, n.refs).ids : [];
  const long = n.text.length > SHORT;
  return (
    <div class={`toast notice${n.error ? " error" : ""}`} data-testid="notice-toast">
      <p class="toast-text">
        <span data-testid="notice">{long && !open ? `${n.text.slice(0, SHORT)}…` : n.text}</span>
      </p>
      <div class="toast-actions">
        {long && (
          <button type="button" class="link" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? "Show less" : "Show all"}
          </button>
        )}
        {n.error && places.length > 0 && (
          <button type="button" class="link" onClick={() => select(places, "replace")}>
            Select the {places.length === 1 ? "place" : `${places.length} places`}
          </button>
        )}
        {n.error && (
          <button
            type="button"
            class="link"
            onClick={() => {
              navigator.clipboard?.writeText(n.text).then(
                () => setCopied(true),
                () => setCopied(false),
              );
            }}
          >
            {copied ? "Copied" : "Copy"}
          </button>
        )}
        <button
          type="button"
          class="toast-close"
          aria-label="Dismiss"
          title="Dismiss"
          onClick={() => {
            notice.value = undefined;
          }}
        >
          ×
        </button>
      </div>
    </div>
  );
}

function StepToastView({ t }: { t: StepToast }) {
  const top = summary.value?.undo;
  const undoable = !t.own && top?.rev === t.rev && summary.value?.status.readOnly !== true;
  return (
    <div
      class={`toast step${t.own ? " own" : " other"}`}
      data-testid="step-toast"
      data-source={t.source}
    >
      <p class="toast-text">
        <strong class="who">{t.who}</strong>: {t.text}
      </p>
      <div class="toast-actions">
        {t.ids.length > 0 && (
          <button type="button" class="link" onClick={() => show({ refs: t.ids })}>
            Show
          </button>
        )}
        {undoable && (
          <button
            type="button"
            class="link"
            data-testid="toast-undo"
            onClick={() => {
              dismissStepToast(t.key);
              void undo();
            }}
          >
            Undo it
          </button>
        )}
        <button
          type="button"
          class="toast-close"
          aria-label="Dismiss"
          title="Dismiss"
          onClick={() => dismissStepToast(t.key)}
        >
          ×
        </button>
      </div>
    </div>
  );
}

export function Toasts() {
  return (
    <div class="toasts" data-testid="toasts">
      <NoticeToast />
      {stepToasts.value.map((t) => (
        <StepToastView key={t.key} t={t} />
      ))}
    </div>
  );
}
