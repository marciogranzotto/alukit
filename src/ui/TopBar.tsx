import { signal } from "@preact/signals";
import { useState } from "preact/hooks";
import { compareIds } from "#core/ids.ts";
import {
  busy,
  chooseVariant,
  connection,
  exportGlb,
  model,
  notice,
  type RevisionInfo,
  redo,
  restore,
  revisions,
  saveRevision,
  summary,
  undo,
  type Verification,
  variant,
  verifyRevision,
} from "./store.ts";

/**
 * The top bar (design §8): project, variant, undo and redo naming the step, the revision, the
 * read-only banner's restore, export, and the link.
 */
export function TopBar() {
  const s = summary.value;
  const drawn = model.value?.rev;
  const readOnly = s?.status.readOnly === true;
  const conn = connection.value;
  return (
    <header class="topbar">
      <span class="brand">AluKit</span>
      <span class="project">{s?.name ?? model.value?.name ?? ""}</span>
      <VariantSwitcher />
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
      <Revisions />
      <button
        type="button"
        data-testid="export"
        disabled={!model.value || busy.value}
        title={`Download the model as binary glTF${model.value?.variant ? `, variant ${model.value.variant}` : ""} (alukit export glb)`}
        onClick={() => void exportGlb()}
      >
        Export GLB
      </button>
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

/**
 * The variant every view derives (§4.10): the model, the scene, the drawer's outputs and the
 * export. The default is the document's (or the document as written, when it names none), as
 * the CLI without `--variant`. Shown only when the document lists variants.
 */
function VariantSwitcher() {
  const m = model.value;
  const vs = m?.doc.variants as { default?: unknown; list?: Record<string, unknown> } | undefined;
  const names = Object.keys(vs?.list ?? {}).sort(compareIds);
  if (!m || names.length === 0) return null;
  const def = typeof vs?.default === "string" && names.includes(vs.default) ? vs.default : null;
  return (
    <label
      class="variant"
      title="The variant every view derives; edits go to the document as written"
    >
      variant{" "}
      <select
        data-testid="variant"
        data-drawn={m.variant ?? ""}
        value={variant.value ?? ""}
        onChange={(e) => {
          const v = (e.currentTarget as HTMLSelectElement).value;
          chooseVariant(v === "" ? undefined : v);
        }}
      >
        <option value="">{def ? `default (${def})` : "as written"}</option>
        {names.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
    </label>
  );
}

const revisionsOpen = signal(false);

/** A verification's result in a few words (§4.13): zero drift, or what moved. */
function verifyText(v: Verification | { error: string }): { text: string; ok: boolean } {
  if ("error" in v) return { text: v.error, ok: false };
  if (v.ok) {
    return {
      text: `verified: zero drift${v.version ? ` (re-derived with alukit ${v.version.now})` : ""}`,
      ok: true,
    };
  }
  const parts: string[] = [];
  if (!v.intact) parts.push("the stored document or lock no longer hashes to its stamp");
  for (const m of v.variants.missing) parts.push(`${m} is stored but no longer in the document`);
  for (const m of v.variants.extra) parts.push(`${m} derives but was not stored`);
  for (const d of v.drift) {
    parts.push(
      `${d.variant ?? "(no variant)"} ${d.output}: ${d.changes.length} field${d.changes.length === 1 ? "" : "s"} moved`,
    );
  }
  return { text: `drift: ${parts.join("; ")}`, ok: false };
}

/**
 * The revision (§4.13, §8's top bar): whether what the server holds is a saved revision, and
 * the revisions themselves, saved and verified through the server (`alukit revision save` and
 * `verify` say the same).
 */
function Revisions() {
  const r = revisions.value;
  const at = r?.revisions.find((x) => x.stamp.hash === r.current);
  return (
    <span class="revisions-anchor">
      <button
        type="button"
        data-testid="revision"
        data-saved={at?.name ?? ""}
        aria-expanded={revisionsOpen.value}
        title={
          at
            ? `What the server holds is the saved revision "${at.name}"`
            : "What the server holds is not saved as a revision"
        }
        onClick={() => {
          revisionsOpen.value = !revisionsOpen.value;
        }}
      >
        Revision: {at ? at.name : "unsaved"}
      </button>
      {revisionsOpen.value && <RevisionPanel />}
    </span>
  );
}

function RevisionPanel() {
  const r = revisions.value;
  const readOnly = summary.value?.status.readOnly === true;
  const [name, setName] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [checked, setChecked] = useState<Record<string, { text: string; ok: boolean }>>({});
  const save = async (e: Event) => {
    e.preventDefault();
    const n = name.trim();
    if (n === "") return;
    const why = await saveRevision(n);
    setError(why);
    if (why === undefined) setName("");
  };
  const verify = async (x: RevisionInfo) => {
    setChecked({ ...checked, [x.file]: { text: "verifying…", ok: true } });
    const v = verifyText(await verifyRevision(x.name));
    setChecked((c) => ({ ...c, [x.file]: v }));
  };
  return (
    <div class="popover revisions" data-testid="revisions">
      <form class="tp-row" onSubmit={(e) => void save(e)}>
        <input
          data-testid="revision-name"
          placeholder="a name, e.g. Quote 1"
          value={name}
          onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)}
        />
        <button
          type="submit"
          class="tp-btn"
          data-testid="revision-save"
          disabled={readOnly || busy.value || name.trim() === ""}
        >
          Save revision
        </button>
      </form>
      {error && <p class="msg-error">{error}</p>}
      {r?.problems.map((p) => (
        <p class="warn" key={p}>
          {p}
        </p>
      ))}
      {!r || r.revisions.length === 0 ? (
        <p class="note">No revision saved yet.</p>
      ) : (
        <ul class="revision-list">
          {r.revisions.map((x) => {
            const v = checked[x.file];
            return (
              <li key={x.file} data-revision={x.name}>
                <div>
                  <strong>{x.name}</strong>
                  {x.stamp.hash === r.current && <span class="sub"> (current)</span>}{" "}
                  <span class="sub">
                    as of {x.as_of} · alukit {x.stamp.alukit}
                    {x.stamp.git
                      ? ` · ${x.stamp.git.commit.slice(0, 8)}${x.stamp.git.dirty ? "+" : ""}`
                      : ""}
                  </span>{" "}
                  <button
                    type="button"
                    class="tp-btn"
                    data-testid="revision-verify"
                    onClick={() => void verify(x)}
                  >
                    Verify
                  </button>
                </div>
                {v && (
                  <p class={v.ok ? "note" : "msg-error"} data-testid="revision-verified">
                    {v.text}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
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
