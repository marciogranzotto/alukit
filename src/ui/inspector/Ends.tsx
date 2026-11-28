import { useState } from "preact/hooks";
import { EntityChips } from "../common/EntityChip.tsx";
import type { Model } from "../model.ts";
import { busy, problems } from "../store.ts";
import { typedNumber } from "../tools/typed.ts";
import { endPick } from "../tools/wire/ends.ts";
import {
  type Cut,
  detachBatch,
  type End,
  endFields,
  endPatch,
  endStopsNear,
  faceStops,
  planeBatch,
  planeKind,
} from "./endEdits.ts";
import { CommitInput, Row, RowErrors, readOnly, useSend } from "./Fields.tsx";
import { joinVerdict } from "./joints.ts";
import { endWords } from "./words.ts";

/**
 * A bar's ends in the inspector (docs/ux/editing-audit.md E4.1; docs/ux/e4-decisions.md): what
 * claims each end, named even when its joint fails (D2); Join when nothing does; freeing it from
 * the joint that claims it; its cut, declared angle or square; its extension; and its plane: what
 * joins it, stopped at a face, or flush with another end, chosen from the faces and ends nearby or
 * picked in the view. Each change is one step. Owner: E4.
 */

const CUTS: readonly { value: "" | Cut; text: string }[] = [
  { value: "", text: "not declared" },
  { value: "angle", text: "on its plane (angle)" },
  { value: "square", text: "square" },
];

/** The plane's choices: what joins it, a face, an end, or (only when written so) its own. */
const PLANES: Readonly<Record<"joint" | "face" | "end" | "own", string>> = {
  joint: "by what joins it",
  face: "stops at a face",
  end: "flush with an end",
  own: "a plane of its own",
};

function EndRow({ m, id, e }: { m: Model; id: string; e: End }) {
  const { outcome, send, clear } = useSend();
  const w = endWords(m, id, e);
  const f = endFields(m, id, e);
  const written = planeKind(f.plane);
  // The plane being chosen: a face or an end is only written once one is picked. The choice holds
  // for the plane written when it was made, so it is done once that changes (picked, or undone),
  // and a revision that leaves the plane keeps it. (The inspector mounts a row per entity.)
  const [choice, setChoice] = useState<{ over: string; kind: "face" | "end" }>();
  const want = choice?.over === written ? choice.kind : undefined;
  const setWant = (kind: "face" | "end" | undefined) =>
    setChoice(kind ? { over: written, kind } : undefined);
  // A typed extension the field cannot take is said under the row, as a refusal would be.
  const [bad, setBad] = useState<string>();
  const shown = want ?? written;
  const free = detachBatch(m, id, e);
  const pick = endPick.value;
  const picking = pick?.bar === id && pick.end === e;
  const off = readOnly() || busy.value;
  const ref = `${id}.${e}`;
  const join = w.open ? joinVerdict(m, ref, problems.value) : undefined;
  const frees = free ? ` (frees it from ${free.from.join(", ")})` : "";

  const sendPlane = (plane: Record<string, unknown>, angled: boolean, words: string) =>
    void send(planeBatch(m, id, e, plane, angled), `${ref} ${words}`).then((o) => {
      if (o.ok) setWant(undefined);
    });

  const facePlane = f.plane?.face as { bar?: string; face?: string } | undefined;
  const faceNow = facePlane ? `${facePlane.bar} ${facePlane.face}` : "";
  const faces = shown === "face" ? faceStops(m, id, e) : [];
  const endNow = typeof f.plane?.of === "string" ? f.plane.of : "";
  const ends = shown === "end" ? endStopsNear(m, id, e) : [];

  return (
    <>
      <Row label={`End ${e}`} fields={[`ends.${e}`, e]} testid={`row-end-${e}`}>
        <div class="end-words">
          {w.text} {w.refs.length > 0 && <EntityChips ids={w.refs} />}
          {w.open && join?.ok === false ? (
            // The check's own reason the default butt cannot join it here: no Join to refuse.
            <span class="sub" data-testid={`join-end-why-${e}`}>
              {join.why}
            </span>
          ) : (
            w.open && (
              <button
                type="button"
                class="btn"
                data-testid={`join-end-${e}`}
                disabled={off || join === undefined}
                title={
                  join === undefined
                    ? "Checking whether the default butt can join it here"
                    : "Butt it into what meets it there, by the project's corner rule, as one step"
                }
                onClick={() =>
                  void send([{ cmd: "autoConnect", args: { end: ref } }], `join ${ref}`)
                }
              >
                Join
              </button>
            )
          )}
          {free && (
            <button
              type="button"
              class="btn"
              data-testid={`end-detach-${e}`}
              disabled={off}
              title="Leave the end where it is, joined to nothing: its plane is then its own default, square at its point"
              onClick={() => void send(free.commands, `free ${ref} from ${free.from.join(", ")}`)}
            >
              Free from {free.from.join(", ")}
            </button>
          )}
        </div>
        <div class="end-edit">
          <label>
            Cut{" "}
            <select
              class="insp-select"
              data-testid={`end-cut-${e}`}
              value={f.cut ?? ""}
              disabled={off}
              onChange={(ev) => {
                const v = (ev.currentTarget as HTMLSelectElement).value as "" | Cut;
                void send(
                  [endPatch(m, id, e, { cut: v === "" ? null : v })],
                  `${v === "" ? "undeclare" : "declare"} ${ref}'s cut`,
                );
              }}
            >
              {CUTS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.text}
                </option>
              ))}
            </select>
          </label>
          <span>
            Extend{" "}
            <CommitInput
              label={`${ref}: extension, mm; positive is longer`}
              testid={`end-extend-${e}`}
              size={7}
              value={f.extend === undefined ? "0" : String(f.extend)}
              onCommit={(text) => {
                const src = text.trim().replace(/^=\s*/, "");
                setBad(undefined);
                if (src === "" || src === "0") {
                  void send([endPatch(m, id, e, { extend_mm: null })], `extend ${ref}`);
                  return;
                }
                const t = typedNumber(src, m.derived.params);
                if ("why" in t) {
                  setBad(t.why);
                  return;
                }
                void send(
                  [endPatch(m, id, e, { extend_mm: t.written === 0 ? null : t.written })],
                  `extend ${ref}`,
                );
              }}
            />{" "}
            mm
          </span>
        </div>
        <div class="end-edit">
          <label>
            Plane{" "}
            <select
              class="insp-select"
              data-testid={`end-plane-${e}`}
              value={shown}
              disabled={off}
              onChange={(ev) => {
                const v = (ev.currentTarget as HTMLSelectElement).value as keyof typeof PLANES;
                clear();
                if (v === "face" || v === "end") setWant(v);
                else if (v === "joint") {
                  setWant(undefined);
                  if (written !== "joint") {
                    void send(
                      [endPatch(m, id, e, { plane: null })],
                      `${ref} takes its joint's plane`,
                    );
                  }
                }
              }}
            >
              {(["joint", "face", "end"] as const).map((k) => (
                <option key={k} value={k}>
                  {PLANES[k]}
                  {k !== "joint" && k !== written ? frees : ""}
                </option>
              ))}
              {written === "own" && <option value="own">{PLANES.own}</option>}
            </select>
          </label>
          {shown === "face" && (
            <>
              <select
                class="insp-select"
                data-testid={`end-face-${e}`}
                aria-label={`${ref}: the face it stops at`}
                value={faceNow}
                disabled={off}
                onChange={(ev) => {
                  const v = (ev.currentTarget as HTMLSelectElement).value;
                  const s = faces.find((x) => `${x.bar} ${x.face}` === v);
                  if (s) {
                    sendPlane(
                      { face: { bar: s.bar, face: s.face } },
                      s.angled,
                      `stops at ${s.bar}'s face ${s.face}`,
                    );
                  }
                }}
              >
                <option value="">
                  {faces.length > 0 ? "choose a face…" : "no face meets its line"}
                </option>
                {faceNow !== "" && !faces.some((x) => `${x.bar} ${x.face}` === faceNow) && (
                  <option value={faceNow}>{`${facePlane?.bar}'s face ${facePlane?.face}`}</option>
                )}
                {faces.map((s) => (
                  <option key={`${s.bar} ${s.face}`} value={`${s.bar} ${s.face}`}>
                    {s.label}
                  </option>
                ))}
              </select>
              <PickButton id={id} e={e} kind="face" off={off} />
            </>
          )}
          {shown === "end" && (
            <>
              <select
                class="insp-select"
                data-testid={`end-flush-${e}`}
                aria-label={`${ref}: the end it is flush with`}
                value={endNow}
                disabled={off}
                onChange={(ev) => {
                  const v = (ev.currentTarget as HTMLSelectElement).value;
                  const s = ends.find((x) => x.end === v);
                  if (s) sendPlane({ of: s.end }, s.angled, `flush with ${s.end}`);
                }}
              >
                <option value="">choose an end…</option>
                {endNow !== "" && !ends.some((x) => x.end === endNow) && (
                  <option value={endNow}>{endNow}</option>
                )}
                {ends.map((s) => (
                  <option key={s.end} value={s.end}>
                    {s.label}
                  </option>
                ))}
              </select>
              <PickButton id={id} e={e} kind="end" off={off} />
            </>
          )}
        </div>
        {picking && (
          <div class="sub end-pick" role="status" data-testid="end-pick-note">
            {pick.kind === "face"
              ? `Pick in the view: click the face ${ref} stops at`
              : `Pick in the view: click the end ${ref} is flush with`}
            {pick.why ? ` · ${pick.why}` : ""} · Esc cancels{" "}
            <button type="button" class="link" onClick={() => (endPick.value = undefined)}>
              Cancel
            </button>
          </div>
        )}
      </Row>
      <RowErrors outcome={bad !== undefined ? { ok: false, why: bad, errors: [] } : outcome} />
    </>
  );
}

/** Arms a pick in the view for this end: the next click on a bar gives the plane. */
function PickButton({
  id,
  e,
  kind,
  off,
}: {
  id: string;
  e: End;
  kind: "face" | "end";
  off: boolean;
}) {
  const armed = endPick.value;
  const on = armed?.bar === id && armed.end === e && armed.kind === kind;
  return (
    <button
      type="button"
      class="btn"
      data-testid={`end-pick-${e}`}
      aria-pressed={on}
      disabled={off}
      onClick={() => (endPick.value = on ? undefined : { bar: id, end: e, kind })}
    >
      Pick in the view
    </button>
  );
}

/** Both ends' rows. A pick armed for an end is dropped with its bar's selection (wire/ends.ts). */
export function EndRows({ m, id }: { m: Model; id: string }) {
  return (
    <>
      <EndRow m={m} id={id} e="a" />
      <EndRow m={m} id={id} e="b" />
    </>
  );
}
