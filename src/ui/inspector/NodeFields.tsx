import { useState } from "preact/hooks";
import { EntityChips } from "../common/EntityChip.tsx";
import type { Model } from "../model.ts";
import { busy } from "../store.ts";
import { typedNumber } from "../tools/typed.ts";
import { LabelRows } from "./BarFields.tsx";
import { CommitInput, Row, RowErrors, readOnly, useSend } from "./Fields.tsx";
import { moveNodeAt, moveNodeOn, nodePlace, nodeUsers } from "./node.ts";
import { isObject, listWords, pointWords } from "./words.ts";

/**
 * A node's fields (docs/ux/editing-audit.md E4.7): what uses it; where it is, a point's x, y and z
 * or a station's bar, distance, end and face, each edited in place as one `moveNode`, so every
 * bar end at it follows (§6); its label and tags. A pivot's point is said, not edited: its pivot
 * sets it. Owner: E4.
 */

type O = Record<string, unknown>;

const FROM = ["a", "b", "a.cut", "b.cut"] as const;
const FACE = ["", "+x", "-x", "+y", "-y"] as const;

export function NodeFields({ m, id }: { m: Model; id: string }) {
  const { outcome, send } = useSend();
  const [bad, setBad] = useState<string>();
  const place = nodePlace(m, id);
  const users = nodeUsers(m, id);
  const derived = m.derived.nodes[id];
  const off = readOnly() || busy.value;
  const go = (step: ReturnType<typeof moveNodeAt>) => {
    if ("why" in step) setBad(step.why);
    else {
      setBad(undefined);
      void send([step], `move point ${id}`);
    }
  };
  const typed = (text: string, then: (v: number | string) => void) => {
    const t = typedNumber(text.trim().replace(/^=\s*/, ""), m.derived.params);
    if ("why" in t) setBad(t.why);
    else then(t.written);
  };
  return (
    <section>
      <h3>Point</h3>
      <table class="kv fields" data-testid="fields">
        <tbody>
          <Row label="Used by" testid="row-node-users">
            {users.length > 0 ? (
              <>
                {listWords(users)}{" "}
                <EntityChips ids={[...new Set(users.map((u) => u.split(".")[0] as string))]} />
              </>
            ) : (
              <span class="sub">nothing uses it</span>
            )}
          </Row>
          {place.kind === "at" && (
            <Row label="At" fields={["at"]} testid="row-node-at">
              <span class="end-edit">
                {(["x", "y", "z"] as const).map((axis, i) => (
                  <span key={axis}>
                    {axis}{" "}
                    <CommitInput
                      label={`${id}: ${axis}, mm`}
                      testid={`field-node-${axis}`}
                      size={7}
                      value={String(place.at[i])}
                      onCommit={(text) =>
                        typed(text, (v) => go(moveNodeAt(m, id, i as 0 | 1 | 2, v)))
                      }
                    />
                  </span>
                ))}
              </span>
            </Row>
          )}
          {place.kind === "on" && (
            <Row label="On" fields={["on"]} testid="row-node-on">
              <span class="end-edit">
                <span>
                  bar{" "}
                  <select
                    class="insp-select"
                    data-testid="field-node-bar"
                    aria-label={`${id}: the bar it is on`}
                    value={String(place.on.bar)}
                    disabled={off}
                    onChange={(e) =>
                      go(moveNodeOn(m, id, { bar: (e.currentTarget as HTMLSelectElement).value }))
                    }
                  >
                    {Object.keys(isObject(m.doc.bars) ? m.doc.bars : {}).map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>
                </span>
                <span>
                  at{" "}
                  <CommitInput
                    label={`${id}: distance along the bar, mm`}
                    testid="field-node-at"
                    size={7}
                    value={String(place.on.at_mm)}
                    onCommit={(text) => typed(text, (v) => go(moveNodeOn(m, id, { at_mm: v })))}
                  />{" "}
                  mm from
                </span>
                <select
                  class="insp-select"
                  data-testid="field-node-from"
                  aria-label={`${id}: counted from`}
                  value={String(place.on.from ?? "a")}
                  disabled={off}
                  onChange={(e) =>
                    go(moveNodeOn(m, id, { from: (e.currentTarget as HTMLSelectElement).value }))
                  }
                >
                  {FROM.map((f) => (
                    <option key={f} value={f}>
                      {f.endsWith(".cut") ? `end ${f[0]}'s cut` : `end ${f}`}
                    </option>
                  ))}
                </select>
                <select
                  class="insp-select"
                  data-testid="field-node-face"
                  aria-label={`${id}: on a face`}
                  value={String((place.on as O).face ?? "")}
                  disabled={off}
                  onChange={(e) =>
                    go(moveNodeOn(m, id, { face: (e.currentTarget as HTMLSelectElement).value }))
                  }
                >
                  {FACE.map((f) => (
                    <option key={f} value={f}>
                      {f === "" ? "on its line" : `face ${f}`}
                    </option>
                  ))}
                </select>
              </span>
            </Row>
          )}
          {place.kind === "pivot" && (
            <Row label="At" testid="row-node-pivot">
              the point of pivot {place.pivot}, which sets it <EntityChips ids={[place.pivot]} />
            </Row>
          )}
          {derived && (
            <Row label="Where" testid="row-node-where">
              {pointWords(derived)}
            </Row>
          )}
          <RowErrors outcome={bad !== undefined ? { ok: false, why: bad, errors: [] } : outcome} />
          <LabelRows m={m} id={id} />
        </tbody>
      </table>
    </section>
  );
}
