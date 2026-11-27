import { signal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { helpSections } from "../actions/registry.ts";
import { describeKeys, type KeyHelpRow, letterKeys, onKey, setLetterKeys } from "../keys.ts";
import { Dialog } from "./Dialog.tsx";
import { showStart } from "./start.ts";

/**
 * Help (`?`; docs/ux/plan.md S2.13, D-UX-18; U22, U65): every key, from the action registry (each
 * action's keys, then the keys the regions describe that are not actions: a gesture's, a tool's
 * letter; src/ui/actions/registry.ts `helpSections`), what the snap names by the pointer mean,
 * the guide, the start card again, and the switch that turns single-character shortcuts off
 * (WCAG 2.1.4). The top bar's `?` button opens it too, so it is reachable with the shortcuts off.
 * Owner: E2.
 *
 * Some keys are bound by modules whose owners have not described them yet (O, undo, help): this
 * module describes them meanwhile. Each line goes when its key becomes an action or its owner
 * describes it (docs/ux/contracts.md, "S2 changes"); F is the `fit` action's.
 */

export const helpOpen = signal(false);

export const GUIDE_URL = "https://github.com/marciogranzotto/alukit/blob/main/docs/guide.md";

/** The keys described here until their owners describe them. */
function describeOthers(): () => void {
  const offs = [
    describeKeys({
      id: "view",
      title: "View",
      order: 50,
      rows: [{ keys: ["O"], does: "Switch between perspective and orthographic" }],
    }),
    describeKeys({
      id: "app",
      title: "Everywhere",
      order: 60,
      rows: [
        { keys: ["Ctrl", "Z"], does: "Undo the last step (it says whose step it is)" },
        { keys: ["Ctrl", "Shift", "Z"], does: "Redo" },
        { keys: ["?"], does: "This help" },
        { keys: ["Esc"], does: "Leave Show, close a dialog or the catalog" },
      ],
    }),
  ];
  return () => {
    for (const off of offs) off();
  };
}

/** What the snap names by the pointer mean (the hint's words; the 3D view's markers). */
const SNAPS: readonly [string, string][] = [
  ["end b1.b", "the end of a bar: a click starts or ends a bar there"],
  ["node n3", "a named point of the project"],
  ["b9 +y face centre", "the middle of a bar's face"],
  ["on b1 at 100", "a point along a bar, 100 mm from its end a"],
  ["+z 450", "along an axis from where the bar starts"],
  ["grid (0, 0, 0)", "the ground's grid, every 10 mm"],
  ["p8 origin", "a part's datum"],
  ["free", "nowhere in particular: Shift-drawing, or nothing near"],
];

/** A row's keys: each chord's caps joined by +, its alternatives after "or". */
function Caps({ row }: { row: KeyHelpRow }) {
  const chord = (keys: readonly string[]) =>
    keys.map((k, i) => (
      <span key={k}>
        {i > 0 && " + "}
        <kbd>{k}</kbd>
      </span>
    ));
  return (
    <>
      {chord(row.keys)}
      {(row.or ?? []).map((keys) => (
        <span key={keys.join("+")}> or {chord(keys)}</span>
      ))}
    </>
  );
}

function HelpDialog() {
  return (
    <Dialog title="Keys and help" onClose={() => (helpOpen.value = false)} testid="help" wide>
      <div class="help-grid">
        <section aria-labelledby="help-keys">
          <h3 id="help-keys">Keys</h3>
          {helpSections.value.map((s) => (
            <div key={s.id} class="help-section">
              <h4>{s.title}</h4>
              <table class="help-keys">
                <tbody>
                  {s.rows.map((r) => (
                    <tr key={r.keys.join("+")}>
                      <th scope="row">
                        <Caps row={r} />
                      </th>
                      <td>{r.does}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
          <label class="help-switch">
            <input
              type="checkbox"
              data-testid="letter-keys"
              checked={letterKeys.value}
              onChange={(e) => setLetterKeys((e.currentTarget as HTMLInputElement).checked)}
            />{" "}
            Single-key shortcuts (a letter, a digit, <kbd>/</kbd>, <kbd>?</kbd>). Off, only the
            buttons and the keys with Ctrl or Cmd act; typing into a tool still works.
          </label>
        </section>
        <section aria-labelledby="help-snaps">
          <h3 id="help-snaps">What the pointer snaps to</h3>
          <table class="help-keys">
            <tbody>
              {SNAPS.map(([name, means]) => (
                <tr key={name}>
                  <th scope="row">
                    <code>{name}</code>
                  </th>
                  <td>{means}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3>More</h3>
          <p>
            <a href={GUIDE_URL} target="_blank" rel="noopener noreferrer">
              The user guide
            </a>
            : the document, drawing, the outputs, locks, revisions.
          </p>
          <p>
            <button
              type="button"
              class="btn"
              data-testid="show-start"
              onClick={() => {
                helpOpen.value = false;
                showStart();
              }}
            >
              Show the start card
            </button>
          </p>
        </section>
      </div>
    </Dialog>
  );
}

export function Help() {
  useEffect(() => {
    const offs = [
      describeOthers(),
      onKey("app", (e) => {
        if (e.key !== "?" || e.ctrlKey || e.metaKey || e.altKey) return false;
        helpOpen.value = !helpOpen.value;
        return true;
      }),
    ];
    return () => {
      for (const off of offs) off();
    };
  }, []);
  return helpOpen.value ? <HelpDialog /> : null;
}
