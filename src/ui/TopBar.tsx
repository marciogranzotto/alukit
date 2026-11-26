import { busy, connection, model, notice, redo, restore, summary, undo } from "./store.ts";

/** The top bar (design §8): project, undo and redo naming the step, the revision, the link. */
export function TopBar() {
  const s = summary.value;
  const drawn = model.value?.rev;
  const readOnly = s?.status.readOnly === true;
  const conn = connection.value;
  return (
    <header class="topbar">
      <span class="brand">AluKit</span>
      <span class="project">{s?.name ?? model.value?.name ?? ""}</span>
      <button
        type="button"
        data-testid="undo"
        disabled={!s?.undo || readOnly || busy.value}
        title={
          s?.undo ? `Undo rev ${s.undo.rev}: ${s.undo.what} (${s.undo.source})` : "Nothing to undo"
        }
        onClick={() => void undo()}
      >
        Undo{s?.undo ? ` ${s.undo.what}` : ""}
      </button>
      <button
        type="button"
        data-testid="redo"
        disabled={!s?.redo || readOnly || busy.value}
        title={
          s?.redo ? `Redo rev ${s.redo.rev}: ${s.redo.what} (${s.redo.source})` : "Nothing to redo"
        }
        onClick={() => void redo()}
      >
        Redo{s?.redo ? ` ${s.redo.what}` : ""}
      </button>
      <span class="spacer" />
      {notice.value && (
        <span class={notice.value.error ? "notice error" : "notice"} data-testid="notice">
          {notice.value.text}
        </span>
      )}
      <span
        class="rev"
        data-testid="rev"
        data-rev={s?.rev ?? ""}
        data-drawn={drawn ?? ""}
        title={drawn !== undefined && s && drawn !== s.rev ? `drawing rev ${drawn}` : "revision"}
      >
        {s ? `rev ${s.rev}` : ""}
      </span>
      <span class={`conn ${conn}`} data-testid="connection" title="the server's event stream">
        {conn === "live"
          ? "live"
          : conn === "connecting"
            ? "connecting"
            : conn === "lost"
              ? "reconnecting"
              : "no access"}
      </span>
      {readOnly && (
        <button type="button" class="restore" onClick={() => void restore()} disabled={busy.value}>
          Restore last good
        </button>
      )}
    </header>
  );
}

/** Why the project is read-only (§7.1): every tab shows it, until the file is valid again. */
export function ReadOnlyBanner() {
  const st = summary.value?.status;
  if (!st?.readOnly) return null;
  return (
    <div class="banner" data-testid="read-only" role="alert">
      <strong>Read-only.</strong> {st.message}
      {st.diagnostics.length > 1 && (
        <ul>
          {st.diagnostics.slice(0, 8).map((d) => (
            <li key={`${d.code}${d.entity}${d.message}`}>
              {d.entity ? `${d.entity}: ` : ""}
              {d.message}
            </li>
          ))}
        </ul>
      )}
      <span class="hint">
        {st.reason === "file"
          ? "Fix the file, or restore the last good state the server holds."
          : "Free the disk or fix the folder's permissions, then restore."}
      </span>
    </div>
  );
}

/** What a tab shows when it has no token: the address `alukit serve` printed carries it. */
export function NoAccess() {
  const conn = connection.value;
  if (conn !== "no-token" && conn !== "refused") return null;
  return (
    <div class="banner" role="alert" data-testid="no-access">
      {conn === "no-token"
        ? "This tab has no access token. Open the address that alukit serve printed: it carries one."
        : "The server refused this tab's token: it has restarted. Open the address it printed."}
    </div>
  );
}
