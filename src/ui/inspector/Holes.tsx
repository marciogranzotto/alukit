import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { Errors } from "../Feedback.tsx";
import type { Model } from "../model.ts";
import { busy } from "../store.ts";
import { holeAsked } from "./barActions.ts";
import { CommitInput, Row, RowErrors, readOnly, useSend } from "./Fields.tsx";
import {
  addHole,
  changeHole,
  FACES,
  type Face,
  FROMS,
  type From,
  fromOf,
  holeOp,
  holesOf,
  holeWords,
  parseLength,
  parseSize,
  removeHole,
  sizeText,
} from "./holes.ts";
import { faceWords } from "./words.ts";

/**
 * A bar's holes in the inspector (docs/ux/editing-audit.md E4.4, E-UX-22): each hole a person
 * added (`ops`) a row of its own, its face, distance, end, size and depth edited in place and
 * Remove; the form that adds one, opened by "Add a hole here" on the view's menu (prefilled with
 * the face and station) or by its button here. Each change is one step. Owner: E4.
 */

type O = Record<string, unknown>;

function HoleRow({ m, id, i, op }: { m: Model; id: string; i: number; op: O }) {
  const { outcome, send } = useSend();
  const [bad, setBad] = useState<string>();
  const off = readOnly() || busy.value;
  const change = (patch: O) => {
    setBad(undefined);
    void send([changeHole(m, id, i, patch)], `change ${id}'s hole ${i + 1}`);
  };
  const length = (text: string, what: string, key: "at_mm" | "depth_mm") => {
    if (key === "depth_mm" && text.trim() === "") return change({ depth_mm: null });
    const v = parseLength(text, m.derived.params, what);
    if ("why" in v) setBad(v.why);
    else change({ [key]: v.v });
  };
  return (
    <>
      <Row label={`Hole ${i + 1}`} fields={[`ops/${i}`]} testid={`hole-${i}`}>
        <div>{holeWords(op)}</div>
        <div class="end-edit">
          <select
            class="insp-select"
            data-testid={`hole-${i}-face`}
            aria-label={`Hole ${i + 1}: face`}
            value={String(op.face)}
            disabled={off}
            onChange={(e) => change({ face: (e.currentTarget as HTMLSelectElement).value })}
          >
            {FACES.map((f) => (
              <option key={f} value={f}>
                {faceWords(m, id, f)}
              </option>
            ))}
          </select>
          <span>
            at{" "}
            <CommitInput
              label={`Hole ${i + 1}: distance, mm`}
              testid={`hole-${i}-at`}
              size={6}
              value={String(op.at_mm)}
              onCommit={(t) => length(t, "distance", "at_mm")}
            />{" "}
            mm from
          </span>
          <select
            class="insp-select"
            data-testid={`hole-${i}-from`}
            aria-label={`Hole ${i + 1}: from end`}
            value={fromOf(op)}
            disabled={off}
            onChange={(e) => change({ from: (e.currentTarget as HTMLSelectElement).value })}
          >
            {FROMS.map((x) => (
              <option key={x.value} value={x.value}>
                {x.label}
              </option>
            ))}
          </select>
          <span>
            size{" "}
            <CommitInput
              label={`Hole ${i + 1}: a drill in mm, or a thread such as M6`}
              testid={`hole-${i}-size`}
              size={6}
              value={sizeText(op)}
              onCommit={(t) => {
                const s = parseSize(t, m.derived.params);
                if ("why" in s) setBad(s.why);
                else change(s);
              }}
            />
          </span>
          <span>
            depth{" "}
            <CommitInput
              label={`Hole ${i + 1}: depth, mm; empty is through`}
              testid={`hole-${i}-depth`}
              size={5}
              value={op.depth_mm === undefined ? "" : String(op.depth_mm)}
              placeholder="through"
              onCommit={(t) => length(t, "depth", "depth_mm")}
            />
          </span>
          <button
            type="button"
            class="btn"
            data-testid={`hole-${i}-remove`}
            disabled={off}
            onClick={() => void send([removeHole(m, id, i)], `remove ${id}'s hole ${i + 1}`)}
          >
            Remove
          </button>
        </div>
      </Row>
      <RowErrors outcome={bad !== undefined ? { ok: false, why: bad, errors: [] } : outcome} />
    </>
  );
}

/**
 * The form that adds a hole: a face, a distance from where it counts (end a's cut unless the menu
 * said otherwise; review M3), a size, a depth (empty: through). It takes the focus once, when it
 * opens, on the distance the menu offered, selected so that typing replaces it (review M2: a ref
 * that focused on every render took each keystroke's focus).
 */
function HoleForm({
  m,
  id,
  face,
  at,
  from: from0,
}: {
  m: Model;
  id: string;
  face: Face;
  at: number;
  from: From;
}) {
  const atField = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    atField.current?.focus();
    atField.current?.select();
  }, []);
  const [f, setF] = useState<Face>(face);
  const [atText, setAt] = useState(String(at));
  const [from, setFrom] = useState<From>(from0);
  const [size, setSize] = useState("");
  const [depth, setDepth] = useState("");
  const [bad, setBad] = useState<string>();
  const { outcome, send } = useSend();
  const close = () => {
    holeAsked.value = undefined;
  };
  return (
    <form
      class="split-form"
      data-testid="hole-form"
      onSubmit={(e) => {
        e.preventDefault();
        const a = parseLength(atText, m.derived.params, "distance");
        const s = parseSize(size, m.derived.params);
        const d = depth.trim() === "" ? undefined : parseLength(depth, m.derived.params, "depth");
        const why = "why" in a ? a.why : "why" in s ? s.why : d && "why" in d ? d.why : undefined;
        setBad(why);
        if (why || "why" in a || "why" in s || (d && "why" in d)) return;
        const op = holeOp({ face: f, at_mm: a.v, from, size: s, depth_mm: d?.v });
        void send([addHole(m, id, op)], `add a hole to ${id}`).then((o) => {
          if (o.ok) close();
        });
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          close();
        }
      }}
    >
      <select
        class="insp-select"
        data-testid="hole-face"
        aria-label="The face it is drilled in"
        value={f}
        onChange={(e) => setF((e.currentTarget as HTMLSelectElement).value as Face)}
      >
        {FACES.map((x) => (
          <option key={x} value={x}>
            {faceWords(m, id, x)}
          </option>
        ))}
      </select>
      <label>
        at{" "}
        <input
          ref={atField}
          class="insp-input"
          data-testid="hole-at"
          aria-label="Distance, mm"
          size={6}
          value={atText}
          onInput={(e) => setAt((e.currentTarget as HTMLInputElement).value)}
        />{" "}
        mm from
      </label>
      <select
        class="insp-select"
        data-testid="hole-from"
        aria-label="Counted from"
        value={from}
        onChange={(e) => setFrom((e.currentTarget as HTMLSelectElement).value as From)}
      >
        {FROMS.map((x) => (
          <option key={x.value} value={x.value}>
            {x.label}
          </option>
        ))}
      </select>
      <label>
        size{" "}
        <input
          class="insp-input"
          data-testid="hole-size"
          aria-label="Size: a drill in mm, or a thread such as M6"
          size={6}
          value={size}
          placeholder="7 or M6"
          onInput={(e) => setSize((e.currentTarget as HTMLInputElement).value)}
        />
      </label>
      <label>
        depth{" "}
        <input
          class="insp-input"
          data-testid="hole-depth"
          aria-label="Depth, mm; empty is through"
          size={5}
          value={depth}
          placeholder="through"
          onInput={(e) => setDepth((e.currentTarget as HTMLInputElement).value)}
        />
      </label>
      <div class="tp-row">
        <button
          type="submit"
          class="btn primary"
          data-testid="hole-add"
          disabled={readOnly() || busy.value}
        >
          Add the hole
        </button>
        <button type="button" class="btn" onClick={close}>
          Cancel
        </button>
      </div>
      <Errors outcome={bad !== undefined ? { ok: false, why: bad, errors: [] } : outcome} />
    </form>
  );
}

/** A bar's holes, then the form or the button that adds one. */
export function HoleRows({ m, id }: { m: Model; id: string }) {
  const ops = holesOf(m, id);
  const asked = holeAsked.value;
  return (
    <>
      {ops.map((op, i) => (
        <HoleRow key={`${i}-${ops.length}`} m={m} id={id} i={i} op={op} />
      ))}
      <tr>
        <th scope="row">{ops.length === 0 ? "Holes" : ""}</th>
        <td>
          {asked?.bar === id ? (
            <HoleForm
              key={`${asked.face} ${asked.at_mm}`}
              m={m}
              id={id}
              face={asked.face}
              at={asked.at_mm}
              from={asked.from}
            />
          ) : (
            <button
              type="button"
              class="btn"
              data-testid="hole-new"
              disabled={readOnly()}
              onClick={() => (holeAsked.value = { bar: id, face: "+x", at_mm: 0, from: "a.cut" })}
            >
              Add a hole…
            </button>
          )}
        </td>
      </tr>
    </>
  );
}
