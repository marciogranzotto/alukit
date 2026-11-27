import { useState } from "preact/hooks";
import { EntityChips } from "../common/EntityChip.tsx";
import type { Model } from "../model.ts";
import { faceEditCommand, faceOptionsOf } from "../tools/commands.ts";
import { BinList, FaceForm, startRelayer } from "../tools/forms/FaceForm.tsx";
import type { FaceOptions } from "../tools/state.ts";
import { Row } from "./Fields.tsx";
import { EditErrors, editOff, useEdit } from "./rows.tsx";
import { listWords } from "./words.ts";

/**
 * Editing a face connection (docs/ux/editing-audit.md E5.1, E-UX-14): the Connect tool's face
 * form, filled from the joint, sends one `setConnection` of what changed; a field written in a
 * form the form cannot show (a sleeve in the stack) is shown in words and kept as written. The
 * layers are changed by re-picking them in Connect, which then offers to replace this joint's.
 * Owner: E5.
 */

type O = Record<string, unknown>;

export function FaceEdit({ m, id, w }: { m: Model; id: string; w: O }) {
  const filled = faceOptionsOf(w);
  const written = JSON.stringify(w);
  // The draft belongs to the joint as written when it was typed: a new revision of the joint (an
  // undo, a CLI edit) shows the form filled from it again. Compared during render, not reset in an
  // effect, which runs after paint and would overwrite what was typed before it ran.
  const [typed, setTyped] = useState<{ of: string; options: FaceOptions } | undefined>(undefined);
  const draft = typed?.of === written ? typed.options : filled.options;
  const setDraft = (options: FaceOptions) => setTyped({ of: written, options });
  const c = faceEditCommand(id, w, draft);
  const { outcome, edit } = useEdit();
  const layers = Array.isArray(w.bars) ? (w.bars as string[]) : [];
  const off = editOff();
  return (
    <>
      <Row label="Layers" fields={["bars"]} testid="row-layers">
        {listWords(layers)}, head to nut <EntityChips ids={layers} />{" "}
        <button
          type="button"
          class="btn"
          data-testid="face-relayer"
          disabled={off}
          title="Pick the layers again in Connect, which then replaces this joint's"
          onClick={() => startRelayer(m, id, layers, draft)}
        >
          Change layers…
        </button>
      </Row>
      <tr class="face-edit-row">
        <td colSpan={2}>
          <div class="face-edit" data-testid="face-edit">
            <FaceForm
              value={draft}
              onChange={setDraft}
              listId="face-edit-bin"
              fixed={filled.fixed}
              disabled={off}
            />
            <BinList id="face-edit-bin" />
            <div class="tp-row">
              <button
                type="button"
                class="btn primary"
                data-testid="face-apply"
                disabled={off || !("cmd" in c)}
                onClick={() => "cmd" in c && void edit({ commands: [c] }, `change ${id}`)}
              >
                Apply
              </button>
              <button
                type="button"
                class="btn"
                data-testid="face-reset"
                disabled={"same" in c}
                onClick={() => setTyped(undefined)}
              >
                Reset
              </button>
            </div>
            {"why" in c && (
              <p class="hint-text" data-testid="face-why">
                {c.why}
              </p>
            )}
          </div>
        </td>
      </tr>
      <EditErrors outcome={outcome} name="face" />
    </>
  );
}
