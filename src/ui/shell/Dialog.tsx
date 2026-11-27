import type { ComponentChildren, TargetedKeyboardEvent } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { onKey } from "../keys.ts";

/**
 * A dialog over the app (WAI-ARIA's modal dialog pattern): it takes focus when it opens and gives
 * it back when it closes, keeps Tab inside, and closes with Esc or a click outside it (S2.15).
 * The innermost open dialog takes Esc first. Owner: S2.
 */

let depth = 0;

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Dialog({
  title,
  onClose,
  children,
  testid,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ComponentChildren;
  testid?: string;
  wide?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const id = useRef(`dialog-${Math.random().toString(36).slice(2, 8)}`);

  useEffect(() => {
    const before = document.activeElement;
    const level = ++depth;
    const first =
      box.current?.querySelector<HTMLElement>("[data-autofocus]") ??
      box.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? box.current)?.focus();
    const off = onKey(
      "overlay",
      (e) => {
        if (e.key !== "Escape") return false;
        close.current();
        return true;
      },
      100 + level,
    );
    return () => {
      off();
      depth--;
      if (before instanceof HTMLElement && before.isConnected) before.focus();
    };
  }, []);

  /** Tab and Shift+Tab stay inside the dialog. */
  const trap = (e: TargetedKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab" || !box.current) return;
    const all = [...box.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const first = all[0];
    const last = all[all.length - 1];
    if (!first || !last) return;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      class="backdrop"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) close.current();
      }}
    >
      <div
        ref={box}
        class={`dialog${wide ? " wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id.current}
        tabIndex={-1}
        onKeyDown={trap}
        {...(testid ? { "data-testid": testid } : {})}
      >
        <header class="dialog-head">
          <h2 id={id.current}>{title}</h2>
          <button
            type="button"
            class="close"
            aria-label="Close"
            title="Close (Esc)"
            onClick={() => close.current()}
          >
            ×
          </button>
        </header>
        <div class="dialog-body">{children}</div>
      </div>
    </div>
  );
}
