import { useEffect, useState } from "preact/hooks";
import { fetchArrangements } from "../client/arrangements.ts";
import { EntityChips } from "../common/EntityChip.tsx";
import { StatusGlyph } from "../common/StatusGlyph.tsx";
import type { Corner } from "../corners.ts";
import { Errors } from "../Feedback.tsx";
import { mm, plural } from "../format.ts";
import type { Model } from "../model.ts";
import { busy, type CommandOutcome, sendCommands } from "../store.ts";
import { drawnCorners } from "../viewport/viewer.ts";
import {
  type Arrangement,
  arrangeBatch,
  arrangementsOf,
  type CornerRule,
  cannotArrange,
  directionRule,
  joinOpenBatch,
  lostFields,
  matchingCorners,
  nextArrangement,
} from "./arrangements.ts";
import { readOnly } from "./Fields.tsx";
import { barRole, connectionType, isObject, labelOf, listWords, pointWords } from "./words.ts";

/**
 * The corner inspector (docs/ux/plan.md S5.5, F3, D-UX-9): what meets at a corner, the
 * connections there and their connector, and the arrangements, each with the cut lengths it gives,
 * from one request that dry-runs every corner rule (`GET /api/arrangements`). Apply to this
 * corner, or to every corner made like it, as one step; Flip to the next arrangement; join every
 * open corner at once. The request goes out when a corner is selected (and again when the drawn
 * revision moves), never per render, and an answer about another revision is dropped. Owner: S5.
 */

type O = Record<string, unknown>;

const STATE_WORDS: Readonly<Record<Corner["state"], string>> = {
  joined: "joined: every end here is held",
  open: "open: an end here is held by nothing",
  failed: "failed: a connection here has an error",
};

const STATUS = { joined: "ready", open: "warn", failed: "blocked" } as const;

/** What the corner's dry runs came to, for the revision they ran against. */
type Arrangements =
  | { state: "asking" }
  | {
      state: "done";
      rev: number;
      list: Arrangement[];
      refused: { rule: CornerRule; why: string }[];
      ms: number;
    }
  | { state: "error"; why: string };

/**
 * The arrangements of a corner at the drawn revision: one request for every rule
 * (`GET /api/arrangements`), sent when the corner or the revision changes. An answer that ran
 * against another revision than the one drawn is dropped (the next revision asks again).
 */
function useArrangements(m: Model, corner: Corner, offered: boolean): Arrangements {
  const [a, setA] = useState<Arrangements>({ state: "asking" });
  useEffect(() => {
    if (!offered) return;
    let live = true;
    setA({ state: "asking" });
    const t0 = performance.now();
    void fetchArrangements([corner.at]).then((r) => {
      if (!live) return;
      if (!r.ok) {
        setA({ state: "error", why: r.why });
        return;
      }
      // About another revision than the one drawn: wait for that one's own answer.
      if (r.value.rev !== m.rev) return;
      const { list, refused } = arrangementsOf(m, corner, r.value.rules);
      setA({ state: "done", rev: m.rev, list, refused, ms: Math.round(performance.now() - t0) });
    });
    return () => {
      live = false;
    };
  }, [corner.key, m.rev, offered]);
  return a;
}

/** A connection at the corner, in words: its type, what runs through, its connector. */
function ConnectionLine({ m, id }: { m: Model; id: string }) {
  const conns = (isObject(m.doc.connections) ? m.doc.connections : {}) as Record<string, O>;
  const w = conns[id.split("@")[0] as string];
  const type = connectionType(m, id) ?? "connection";
  const through = isObject(w) && typeof w.through === "string" ? w.through : undefined;
  const connector = isObject(w) && typeof w.connector === "string" ? w.connector : undefined;
  const hw = m.derived.hardware.filter((h) => h.source === id);
  const name = connector ? m.items[connector]?.name : undefined;
  const qty = hw.find((h) => h.item === connector)?.qty;
  return (
    <li data-connection={id}>
      <EntityChips ids={[id]} /> {type}
      {through && <> through {through}</>}
      {connector ? (
        <>
          {" "}
          · <code>{connector}</code>
          {typeof name === "string" && ` ${name}`}
          {qty !== undefined && ` × ${qty}`}
        </>
      ) : (
        <span class="sub"> · no connector named</span>
      )}
    </li>
  );
}

function ArrangementCard({
  a,
  chosen,
  onChoose,
}: {
  a: Arrangement;
  chosen: boolean;
  onChoose: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        class={`arrangement${chosen ? " chosen" : ""}${a.current ? " current" : ""}`}
        aria-pressed={chosen}
        data-testid="arrangement"
        data-through={a.through}
        data-rules={a.rules.join(" ")}
        onClick={onChoose}
      >
        <span class="arrangement-title">
          {a.title}
          {a.current && <span class="sub"> (now)</span>}
        </span>
        <span class="arrangement-cuts" data-testid="arrangement-cuts">
          {a.cuts.map((c) => (
            <span
              key={c.bar}
              class={c.cut !== c.was ? "moved" : undefined}
              data-bar={c.bar}
              data-cut={c.cut}
              title={c.cut !== c.was ? `now ${mm(c.was)} mm` : "unchanged"}
            >
              {c.bar} {mm(c.cut)}
            </span>
          ))}
        </span>
        <span class="sub">{a.detail}</span>
      </button>
    </li>
  );
}

export function CornerInspector({ m, corner }: { m: Model; corner: Corner }) {
  const why = cannotArrange(m, corner);
  const found = useArrangements(m, corner, why === undefined);
  const [choice, setChoice] = useState<string | undefined>();
  const [outcome, setOutcome] = useState<CommandOutcome>();
  useEffect(() => {
    setChoice(undefined);
    setOutcome(undefined);
  }, [corner.key]);
  const all = drawnCorners.value;
  const list = found.state === "done" ? found.list : [];
  const chosen = list.find((a) => a.through === choice) ?? list.find((a) => !a.current) ?? list[0];
  const matching = chosen ? matchingCorners(m, all, corner, chosen) : [];
  const flip = nextArrangement(list);
  const open = all.filter((c) => c.state === "open");
  const lost = lostFields(m, [corner]);
  const off = readOnly() || busy.value;
  const send = async (commands: { cmd: string; args?: unknown }[], what: string) => {
    setOutcome(undefined);
    setOutcome(await sendCommands(commands, what, { strict: true, inline: true }));
  };
  /** Arranges corners by a rule: the batch the arrangements were dry-run with, as one step. */
  const apply = (corners: readonly Corner[], rule: CornerRule, what: string) =>
    void send(arrangeBatch(m, corners, rule), what);

  return (
    <div class="props corner" data-testid="properties" data-corner={corner.key}>
      <h2>
        Corner {pointWords(corner.at)}
        <span class="sub"> {plural(corner.ends.length, "end")}</span>
      </h2>
      <p class="corner-state" data-state={corner.state}>
        <StatusGlyph status={STATUS[corner.state]} /> {STATE_WORDS[corner.state]}
      </p>
      <section>
        <h3>What meets here</h3>
        <ul class="corner-ends" data-testid="corner-ends">
          {corner.bars.map((b) => {
            const ends = corner.ends.filter((e) => e.startsWith(`${b}.`));
            const label = labelOf(m, b);
            return (
              <li key={b}>
                <EntityChips ids={[b]} /> {barRole(m, b)}
                {label && <span class="sub"> {label}</span>}
                {ends.length > 0 ? (
                  <span class="sub"> · its end {ends.map((e) => e.split(".")[1]).join(", ")}</span>
                ) : (
                  <span class="sub"> · passes through</span>
                )}
              </li>
            );
          })}
        </ul>
      </section>
      <section>
        <h3>Connections</h3>
        {corner.connections.length > 0 ? (
          <ul class="corner-connections" data-testid="corner-connections">
            {corner.connections.map((c) => (
              <ConnectionLine key={c} m={m} id={c} />
            ))}
          </ul>
        ) : (
          <p class="sub">None: the ends here are open.</p>
        )}
      </section>
      <section data-testid="arrangements">
        <h3>Arrangements</h3>
        {why !== undefined ? (
          <p class="sub">{why}.</p>
        ) : found.state === "asking" ? (
          <p class="sub" aria-busy="true">
            Working out the cut lengths…
          </p>
        ) : found.state === "error" ? (
          <p class="warn">{found.why}</p>
        ) : (
          <>
            <p class="sub">The cut lengths each one gives, before anything is applied.</p>
            <ul class="arrangements" data-ms={found.ms}>
              {list.map((a) => (
                <ArrangementCard
                  key={a.through}
                  a={a}
                  chosen={a === chosen}
                  onChoose={() => setChoice(a.through)}
                />
              ))}
            </ul>
            {found.refused.length > 0 && list.length === 0 && (
              <p class="warn">{found.refused[0]?.why}</p>
            )}
            {lost.length > 0 && (
              <p class="sub">
                Applying replaces {listWords(lost.map((l) => l.id))}; not carried over:{" "}
                {listWords([...new Set(lost.flatMap((l) => l.fields))])}.
              </p>
            )}
            <div class="tp-row">
              <button
                type="button"
                class="btn primary"
                data-testid="arrangement-apply"
                disabled={off || !chosen || chosen.current}
                title="Rebuild this corner's butt by the arrangement chosen, as one step"
                onClick={() =>
                  chosen &&
                  apply(
                    [corner],
                    chosen.rules[0] as CornerRule,
                    `${chosen.title.toLowerCase()} at ${corner.key}`,
                  )
                }
              >
                Apply to this corner
              </button>
              <button
                type="button"
                class="btn"
                data-testid="arrangement-apply-all"
                disabled={off || !chosen || matching.length === 0}
                title={
                  chosen && directionRule(m, chosen) === undefined
                    ? "This arrangement follows bar ids, not a direction, so it has no match"
                    : "Every corner where the same bars meet the same way, as one step"
                }
                onClick={() => {
                  const rule = chosen ? directionRule(m, chosen) : undefined;
                  if (chosen && rule) {
                    apply(
                      matching,
                      rule,
                      `${chosen.title.toLowerCase()} at ${matching.length} corners`,
                    );
                  }
                }}
              >
                Apply to {plural(matching.length, "matching corner")}
              </button>
              <button
                type="button"
                class="btn"
                data-testid="arrangement-flip"
                disabled={off || !flip}
                title="The next arrangement, as one step"
                onClick={() =>
                  flip &&
                  apply([corner], flip.rules[0] as CornerRule, `flip the corner at ${corner.key}`)
                }
              >
                Flip
              </button>
            </div>
          </>
        )}
      </section>
      {open.length > 0 && (
        <section>
          <h3>Open corners</h3>
          <div class="tp-row">
            <button
              type="button"
              class="btn"
              data-testid="join-open"
              disabled={off}
              title="One butt at each open corner, by the project's corner rule, as one step"
              onClick={() =>
                void send(joinOpenBatch(open), `join ${plural(open.length, "open corner")}`)
              }
            >
              Join {plural(open.length, "open corner")}
            </button>
          </div>
        </section>
      )}
      <Errors outcome={outcome} />
    </div>
  );
}
