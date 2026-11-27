import { signal } from "@preact/signals";
import type { ComponentChildren, RefObject } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { compareIds } from "#core/ids.ts";
import { StatusGlyph } from "./common/StatusGlyph.tsx";
import { onKey } from "./keys.ts";
import { openSheet } from "./sheets/registry.ts";
import { helpOpen } from "./shell/Help.tsx";
import { readiness } from "./shell/readiness.ts";
import { settingsOpen } from "./shell/Settings.tsx";
import { showStart } from "./shell/start.ts";
import { requestRedo, requestUndo, stepLabel } from "./shell/Undo.tsx";
import {
  busy,
  chooseVariant,
  exportGlb,
  model,
  type RevisionInfo,
  revisions,
  saveRevision,
  summary,
  type Verification,
  variant,
  verifyRevision,
} from "./store.ts";
import { ThemeSwitch } from "./theme/ThemeSwitch.tsx";

/**
 * The top bar (design §8, D-UX-3, D-UX-14, D-UX-19, D-UX-20; S2.6): the Project menu (settings,
 * revisions, export, help, the start card), the variant, Undo and Redo naming whose step they
 * take back, the order's readiness, whether what the server holds is saved as a revision, the
 * theme and help. The connection and the step counter are the status bar's (S2.7); the
 * read-only banner and its restore are shell/ReadOnly.tsx's. Owner: S2.
 */

/** Why the history buttons are off, in words (S2.14: a disabled control says why). */
function historyWhy(kind: "undo" | "redo"): string | undefined {
  const s = summary.value;
  if (s?.status.readOnly) return "Read-only: fix the file, or restore the last good state";
  if (busy.value) return "Waiting for the server's answer";
  if (!(kind === "undo" ? s?.undo : s?.redo))
    return kind === "undo" ? "Nothing to undo" : "Nothing to redo";
  return undefined;
}

export function TopBar() {
  const s = summary.value;
  const undoWhy = historyWhy("undo");
  const redoWhy = historyWhy("redo");
  return (
    <header class="topbar">
      <span class="brand">AluKit</span>
      <ProjectMenu />
      <VariantSwitcher />
      <button
        type="button"
        class="undo-btn"
        data-testid="undo"
        disabled={undoWhy !== undefined}
        title={
          undoWhy ??
          (s?.undo ? `Undo step ${s.undo.rev}, ${stepLabel(s.undo)} (Ctrl+Z)` : undefined)
        }
        onClick={requestUndo}
      >
        Undo{s?.undo ? ` · ${stepLabel(s.undo)}` : ""}
      </button>
      <button
        type="button"
        class="redo-btn"
        data-testid="redo"
        disabled={redoWhy !== undefined}
        title={
          redoWhy ??
          (s?.redo ? `Redo step ${s.redo.rev}, ${stepLabel(s.redo)} (Ctrl+Shift+Z)` : undefined)
        }
        onClick={requestRedo}
      >
        Redo{s?.redo ? ` · ${stepLabel(s.redo)}` : ""}
      </button>
      <span class="spacer" />
      <ReadinessPill />
      <Revisions />
      <ThemeSwitch />
      <button
        type="button"
        class="help-btn"
        data-testid="help-open"
        aria-label="Keys and help"
        title="Keys and help (?)"
        onClick={() => {
          helpOpen.value = true;
        }}
      >
        ?
      </button>
    </header>
  );
}

// ---------------------------------------------------------------------------------------------
// Popovers: a menu and the revisions, each closing on a click outside it and on Esc (S2.15)

/** Closes a popover on a pointer press outside `anchor` and on Esc, while it is open. */
function useDismiss(open: boolean, close: () => void, anchor: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (anchor.current && !anchor.current.contains(e.target as Node)) close();
    };
    document.addEventListener("pointerdown", outside, true);
    const off = onKey(
      "overlay",
      (e) => {
        if (e.key !== "Escape") return false;
        close();
        anchor.current?.querySelector<HTMLElement>("[aria-expanded]")?.focus();
        return true;
      },
      50,
    );
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      off();
    };
  }, [open]);
}

function Popover({
  open,
  setOpen,
  label,
  button,
  children,
  class: cls,
  testid,
}: {
  open: boolean;
  setOpen: (v: boolean) => void;
  label: ComponentChildren;
  button: { class?: string; testid: string; title?: string; data?: Record<string, string> };
  children: ComponentChildren;
  class: string;
  testid: string;
}) {
  const anchor = useRef<HTMLSpanElement>(null);
  useDismiss(open, () => setOpen(false), anchor);
  return (
    <span class="menu-anchor" ref={anchor}>
      <button
        type="button"
        class={button.class}
        data-testid={button.testid}
        title={button.title}
        aria-expanded={open}
        aria-haspopup="true"
        {...(button.data ?? {})}
        onClick={() => setOpen(!open)}
      >
        {label}
      </button>
      {open && (
        <div class={`popover ${cls}`} data-testid={testid}>
          {children}
        </div>
      )}
    </span>
  );
}

const menuOpen = signal(false);
const revisionsOpen = signal(false);

/** The Project menu: the project's name opens it. */
function ProjectMenu() {
  const s = summary.value;
  const name = s?.name ?? model.value?.name ?? "Project";
  const pick = (f: () => void) => () => {
    menuOpen.value = false;
    f();
  };
  return (
    <Popover
      open={menuOpen.value}
      setOpen={(v) => {
        menuOpen.value = v;
      }}
      label={
        <>
          {name} <span aria-hidden="true">▾</span>
        </>
      }
      button={{
        class: "menu-btn project",
        testid: "project-menu",
        title: "The project: settings, revisions, export",
      }}
      class="menu"
      testid="project-menu-list"
    >
      <button
        type="button"
        data-testid="menu-settings"
        onClick={pick(() => {
          settingsOpen.value = true;
        })}
      >
        Project settings…
      </button>
      <button
        type="button"
        data-testid="menu-revisions"
        onClick={pick(() => {
          revisionsOpen.value = true;
        })}
      >
        Revisions…
      </button>
      <button
        type="button"
        data-testid="export"
        disabled={!model.value || busy.value}
        title={`Download the model as binary glTF${model.value?.variant ? `, variant ${model.value.variant}` : ""} (alukit export glb)`}
        onClick={pick(() => void exportGlb())}
      >
        Export GLB
      </button>
      <hr />
      <button
        type="button"
        onClick={pick(() => {
          helpOpen.value = true;
        })}
      >
        Keys and help <kbd>?</kbd>
      </button>
      <button type="button" data-testid="menu-start" onClick={pick(showStart)}>
        Show the start card
      </button>
    </Popover>
  );
}

// ---------------------------------------------------------------------------------------------
// The order's readiness (D-UX-3)

/** The pill: always in sight; it opens Order & costs, where the blockers are listed. */
function ReadinessPill() {
  const r = readiness();
  if (!r) return null;
  return (
    <button
      type="button"
      class={`pill${r.stale ? " stale" : ""}`}
      data-testid="readiness"
      data-status={r.status}
      title={`The order: ${r.text}${r.stale ? " (being checked again)" : ""}. Opens Order & costs`}
      onClick={() => openSheet("order")}
    >
      {r.glyph && <StatusGlyph status={r.glyph} size={12} />}
      {r.text}
    </button>
  );
}

// ---------------------------------------------------------------------------------------------
// Variants (§4.10, D-UX-19)

/**
 * The variant every view derives (§4.10): the model, the scene, the sheets' outputs and the
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
      Variant{" "}
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

/**
 * The strip under the top bar while the tab shows a variant the person picked (D-UX-19): edits
 * still go to the document as written, which the strip says, with the way back.
 */
export function VariantStrip() {
  const m = model.value;
  const v = variant.value;
  if (!m || v === undefined || m.variant !== v) return null;
  return (
    <div class="variant-strip" data-testid="variant-strip" role="status">
      <span>
        Viewing <strong>{v}</strong>. Edits go to the base document.
      </span>
      <button type="button" class="btn" onClick={() => chooseVariant(undefined)}>
        Back to the default
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Revisions (§4.13, D-UX-20)

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
 * Whether what the server holds is a saved revision, "Saved as Quote 1" or "Not saved" (D-UX-20),
 * and the revisions themselves, saved and verified through the server (`alukit revision save`
 * and `verify` say the same).
 */
function Revisions() {
  const r = revisions.value;
  const at = r?.revisions.find((x) => x.stamp.hash === r.current);
  return (
    <Popover
      open={revisionsOpen.value}
      setOpen={(v) => {
        revisionsOpen.value = v;
      }}
      label={at ? `Saved as ${at.name}` : "Not saved"}
      button={{
        class: "saved",
        testid: "revision",
        title: at
          ? `What the server holds is the saved revision "${at.name}"`
          : "What the server holds is not saved as a named revision",
        data: { "data-saved": at?.name ?? "" },
      }}
      class="revisions"
      testid="revisions"
    >
      <RevisionPanel />
    </Popover>
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
    <>
      <form class="tp-row" onSubmit={(e) => void save(e)}>
        <input
          data-testid="revision-name"
          aria-label="The revision's name"
          placeholder="a name, e.g. Quote 1"
          value={name}
          onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)}
        />
        <button
          type="submit"
          class="btn"
          data-testid="revision-save"
          disabled={readOnly || busy.value || name.trim() === ""}
          title={readOnly ? "Read-only: fix the file, or restore the last good state" : undefined}
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
                    class="btn"
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
    </>
  );
}
