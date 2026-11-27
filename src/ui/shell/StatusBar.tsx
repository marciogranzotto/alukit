import { signal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { shown } from "../focus.ts";
import { problemList } from "../problems/source.ts";
import { ago, who, whoWhat } from "../steps.ts";
import { connection, heardAt, log, model, notice, summary } from "../store.ts";
import { toolPrompt } from "../tools/state.ts";
import { presence, stepToasts } from "./presence.ts";

/**
 * The status bar under the viewport (docs/ux/plan.md S2.7, D-UX-3, B §5.5): the state that
 * persists, in one line. The connection (live, reconnecting, read-only), the step the project is
 * at and who made it ("Step 14 · claude: add bar b13 · 40 s ago"; D-UX-20 says Step, not rev),
 * what Show is showing and how to leave it, what the active tool asks for next, who else is
 * editing, and the units. The order's state is the top bar's pill, not repeated here. Owner: S2.
 *
 * The live region beside it announces what the toasts say (a refusal, an export, another
 * source's step), politely, so a screen reader hears outcomes (WCAG 4.1.3, U54).
 */

/** Now, ticking every few seconds, for "40 s ago". */
const now = signal(Date.now());

function connectionText(): { text: string; state: string } {
  if (summary.value?.status.readOnly) return { text: "read-only", state: "read-only" };
  switch (connection.value) {
    case "live":
      return { text: "live", state: "live" };
    case "connecting":
      return { text: "connecting", state: "connecting" };
    case "lost":
      return { text: "reconnecting", state: "lost" };
    default:
      return { text: "no access", state: "refused" };
  }
}

/** What Show is showing, and how to leave it. */
function showingText(): string | undefined {
  const s = shown.value;
  if (!s) return undefined;
  if (s.problem !== undefined) {
    const list = problemList.value?.answer.problems ?? [];
    const i = list.findIndex((p) => p.id === s.problem);
    if (i >= 0) return `Showing problem ${i + 1} of ${list.length} · Esc to leave`;
    return "Showing a problem · Esc to leave";
  }
  const refs =
    s.refs.length <= 3
      ? s.refs.join(", ")
      : `${s.refs.slice(0, 2).join(", ")} and ${s.refs.length - 2} more`;
  return `Showing ${refs} · Esc to leave`;
}

export function StatusBar() {
  useEffect(() => {
    const t = setInterval(() => {
      now.value = Date.now();
    }, 5000);
    return () => clearInterval(t);
  }, []);
  const s = summary.value;
  const drawn = model.value?.rev;
  const conn = connectionText();
  const step = s ? log.value.find((e) => e.rev === s.rev) : undefined;
  const at = s ? heardAt(s.rev) : undefined;
  const showing = showingText();
  const prompt = toolPrompt.value;
  const others = presence.value;
  return (
    <div class="statusbar" data-testid="statusbar">
      <span class={`conn ${conn.state}`} data-testid="connection" title="The server's event stream">
        {conn.text}
      </span>
      {s && (
        <span class="step">
          <span
            data-testid="rev"
            data-rev={s.rev}
            data-drawn={drawn ?? ""}
            title={
              drawn !== undefined && drawn !== s.rev
                ? `Drawing step ${drawn}`
                : "The project's step"
            }
          >
            Step {s.rev}
          </span>
          {step && step.rev > 0 && (
            <span class="step-what" data-testid="last-step">
              {" · "}
              {whoWhat(step)}
              {at !== undefined && ` · ${ago(now.value - at)}`}
            </span>
          )}
        </span>
      )}
      {showing && (
        <span class="showing" data-testid="showing">
          {showing}
        </span>
      )}
      {prompt && !showing && (
        <span class="prompt" data-testid="tool-prompt">
          {prompt}
        </span>
      )}
      <span class="spacer" />
      {others.map((o) => (
        <span
          key={o.source}
          class="presence"
          data-testid="presence"
          title={`${o.source}, ${ago(now.value - o.at)}`}
        >
          {who(o.source)} · {ago(now.value - o.at)}
        </span>
      ))}
      <span class="units" title="Lengths are in millimetres">
        mm
      </span>
      <LiveRegion />
    </div>
  );
}

/** What the toasts say, for assistive technology. */
function LiveRegion() {
  const n = notice.value;
  const t = stepToasts.value[stepToasts.value.length - 1];
  const text = n ? n.text : t ? `${t.who}: ${t.text}` : "";
  return (
    <div class="sr-only" role="status" aria-live="polite" data-testid="live-region">
      {text}
    </div>
  );
}
