import { signal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { describeKeys, keyHelp, letterKeys, onKey, setLetterKeys } from "../keys.ts";
import { TOOL_KEYS } from "../tools/state.ts";
import { Dialog } from "./Dialog.tsx";
import { showStart } from "./start.ts";

/**
 * Help (`?`; docs/ux/plan.md S2.13, D-UX-18; U22, U65): every key, as the regions that bind them
 * describe them (keys.ts `describeKeys`), what the snap names by the pointer mean, the guide, the
 * start card again, and the switch that turns single-character shortcuts off (WCAG 2.1.4). The
 * top bar's `?` button opens it too, so it is reachable with the shortcuts off. Owner: S2.
 *
 * Some keys are bound by modules whose owners have not described them yet (the tools' letters,
 * the draw gesture, the views): this module describes them meanwhile, the tools' letters read
 * from `TOOL_KEYS` so the list cannot name a letter that does nothing. Each section goes when
 * its owner describes its own keys (docs/ux/contracts.md, "S2 changes").
 */

export const helpOpen = signal(false);

export const GUIDE_URL = "https://github.com/marciogranzotto/alukit/blob/main/docs/guide.md";

const TOOL_NAMES: Readonly<Record<string, string>> = {
  select: "Select",
  draw: "Draw bar",
  connect: "Connect",
  place: "Place part",
  pattern: "Pattern",
  measure: "Measure",
  frame: "Box frame",
};

/** The keys described here until their owners describe them. */
function describeOthers(): () => void {
  const offs = [
    describeKeys({
      id: "tools",
      title: "Tools",
      order: 10,
      rows: [
        ...Object.entries(TOOL_KEYS).map(([k, t]) => ({
          keys: [k.toUpperCase()],
          does: TOOL_NAMES[t] ?? t,
        })),
        { keys: ["Esc"], does: "Step back: the gesture, then the tool, then the selection" },
      ],
    }),
    describeKeys({
      id: "drawing",
      title: "While drawing a bar",
      order: 20,
      rows: [
        { keys: ["0–9", "Enter"], does: "Type the length, in mm, and draw the bar" },
        { keys: ["Backspace"], does: "Take back the last digit typed" },
        { keys: ["R"], does: "Roll the profile 90°" },
        { keys: ["A"], does: "Next anchor on the section" },
        { keys: ["W"], does: "Pick a face as the work plane" },
        { keys: ["Shift"], does: "Hold to draw off the axes" },
      ],
    }),
    describeKeys({
      id: "view",
      title: "View",
      order: 50,
      rows: [
        { keys: ["F"], does: "Fit the view to the selection, or to everything" },
        { keys: ["O"], does: "Switch between perspective and orthographic" },
      ],
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

function HelpDialog() {
  return (
    <Dialog title="Keys and help" onClose={() => (helpOpen.value = false)} testid="help" wide>
      <div class="help-grid">
        <section aria-labelledby="help-keys">
          <h3 id="help-keys">Keys</h3>
          {keyHelp.value.map((s) => (
            <div key={s.id} class="help-section">
              <h4>{s.title}</h4>
              <table class="help-keys">
                <tbody>
                  {s.rows.map((r) => (
                    <tr key={r.keys.join("+")}>
                      <th scope="row">
                        {r.keys.map((k, i) => (
                          <span key={k}>
                            {i > 0 && " + "}
                            <kbd>{k}</kbd>
                          </span>
                        ))}
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
