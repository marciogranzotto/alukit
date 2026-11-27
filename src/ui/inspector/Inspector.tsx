import { useState } from "preact/hooks";
import { compareIds } from "#core/ids.ts";
import type { Problem } from "#core/problems/types.ts";
import { EntityChips } from "../common/EntityChip.tsx";
import { cornerKey } from "../corners.ts";
import { select, selection } from "../focus.ts";
import { plural } from "../format.ts";
import type { Model } from "../model.ts";
import { ProblemList, ProblemRow } from "../problems/ProblemRow.tsx";
import { problemList } from "../problems/source.ts";
import { ProjectPanel } from "../shell/ProjectPanel.tsx";
import { model } from "../store.ts";
import { resolveTargets } from "../targets.ts";
import { drawnCorners } from "../viewport/viewer.ts";
import { BarFields, ReplaceForm } from "./BarFields.tsx";
import { CornerInspector } from "./CornerInspector.tsx";
import { DeleteButton, DeleteFlow } from "./Delete.tsx";
import { BarDerived, Item, OtherDerived, ProjectItem } from "./Derived.tsx";
import { PointedField, pointedFor } from "./Fields.tsx";
import { ConnectionFields, PartFields, PlainFields } from "./OtherFields.tsx";
import { copyMembers } from "./remove.ts";
import { copyOf, entityName, labelOf, NOUN, patternOf, type RefKind, refKind } from "./words.ts";

/**
 * The inspector (design §8, right; docs/ux/plan.md S5.3–S5.5): what is selected, edited in place.
 * Problems on the selection come first, the field a problem's Show points at is lit; then the
 * entity's fields, each edit one step; then what derive says, read-only, every number with its
 * provenance; then its catalog item. A corner gets the corner inspector, a pattern copy says what
 * makes it, an item ref is an item (never "a pattern copy", U12). With nothing selected it shows
 * the project panel (D-UX-4). Delete is here too, with its key and its dialog. Owner: S5.
 */

/** The problems about the selection: those whose targets are, or stand for, what is selected. */
function problemsOn(m: Model, ids: readonly string[]): Problem[] {
  const answer = problemList.value?.answer;
  if (!answer) return [];
  const sel = new Set(ids);
  const corner = ids.map(cornerKey).find((k) => k !== undefined);
  const at = corner ? drawnCorners.value.find((c) => c.key === corner) : undefined;
  if (at) for (const x of [...at.ends, ...at.connections]) sel.add(x);
  return answer.problems.filter((p) => {
    if (p.targets.some((t) => sel.has(t) || sel.has(t.split(".")[0] as string))) return true;
    return resolveTargets(m, p.targets).ids.some((id) => sel.has(id));
  });
}

function SelectionProblems({ m, ids }: { m: Model; ids: readonly string[] }) {
  const list = problemsOn(m, ids);
  if (list.length === 0) return null;
  return (
    <section class="insp-problems" data-testid="selection-problems">
      <h3>{plural(list.length, "problem")}</h3>
      <ProblemList label="Problems on the selection">
        {list.map((p) => (
          <ProblemRow key={p.id} p={p} compact />
        ))}
      </ProblemList>
    </section>
  );
}

/** The heading: the id, its label, and the actions on it. */
function Head({ m, id, kind }: { m: Model; id: string; kind: RefKind }) {
  const label = labelOf(m, id);
  const deletable = ["bar", "part", "connection", "node", "run", "pattern", "copy"].includes(kind);
  return (
    <div class="insp-head">
      <h2>
        {id}
        {label && <span class="sub"> {label}</span>}
      </h2>
      <span class="insp-kind">{kind === "connection" ? "connection" : NOUN[kind]}</span>
      {deletable && <DeleteButton label={kind === "copy" ? "Leave out" : "Delete"} />}
    </div>
  );
}

/** A pattern copy: what makes it, and where to change it. */
function CopyBody({ m, id }: { m: Model; id: string }) {
  const c = copyOf(id);
  const pattern = patternOf(m, id);
  if (!c) return null;
  return (
    <section>
      <p data-testid="copy-of">
        Copy {c.k} of pattern {pattern ?? "?"}, made from {c.template}: change{" "}
        <button type="button" class="link" onClick={() => select([c.template], "replace")}>
          {c.template}
        </button>{" "}
        and every copy follows.
      </p>
      {pattern && (
        <p class="sub">
          Leaving it out takes {copyMembers(m, { id, pattern, k: c.k }).join(", ")} with it.
        </p>
      )}
    </section>
  );
}

/** An item named in the selection (a problem's chip, a BOM row): what it is and what uses it. */
function ItemBody({ m, id }: { m: Model; id: string }) {
  const users = [
    ...Object.entries(m.derived.bars)
      .filter(([, b]) => b.item === id)
      .map(([b]) => b),
    ...Object.entries(m.derived.parts)
      .filter(([, p]) => p.item === id)
      .map(([p]) => p),
  ].sort(compareIds);
  return (
    <>
      <section>
        <p data-testid="item-of">
          {users.length > 0 ? (
            <>
              An item, used by {plural(users.length, "entity", "entities")}:{" "}
              <EntityChips ids={users} max={8} />
            </>
          ) : (
            "An item the project does not use."
          )}
        </p>
      </section>
      <Item m={m} id={id} />
      {id.startsWith("project:") && <ProjectItem m={m} id={id} />}
    </>
  );
}

const OTHER_WORDS: Partial<Record<RefKind, string>> = {
  "open-item": "An open item: resolve it in Problems.",
  supplier: "A supplier of the order: its card is on the Order & costs sheet.",
  record: "A record of the project: see Records.",
  unknown: "Nothing in the project is called this now: it may have been removed.",
};

function One({ m, id }: { m: Model; id: string }) {
  const key = cornerKey(id);
  if (key !== undefined) {
    const corner = drawnCorners.value.find((c) => c.key === key);
    return corner ? (
      <CornerInspector m={m} corner={corner} />
    ) : (
      <div class="props" data-testid="properties">
        <h2>Corner ({key.replaceAll(",", ", ")})</h2>
        <p class="sub">Nothing meets here now.</p>
      </div>
    );
  }
  const kind = refKind(m, id);
  const end = kind === "end" ? (id.split(".")[0] as string) : undefined;
  const barItem = m.derived.bars[id]?.item ?? m.derived.parts[id]?.item;
  return (
    <PointedField.Provider value={pointedFor(m, id)}>
      <EntityBody m={m} id={id} kind={kind} end={end} barItem={barItem} />
    </PointedField.Provider>
  );
}

/** One entity, ref or copy: its heading, problems, fields, derived values and item. */
function EntityBody({
  m,
  id,
  kind,
  end,
  barItem,
}: {
  m: Model;
  id: string;
  kind: RefKind;
  end: string | undefined;
  barItem: string | undefined;
}) {
  return (
    <div class="props" data-testid="properties" data-kind={kind}>
      <Head m={m} id={id} kind={kind} />
      <SelectionProblems m={m} ids={[id]} />
      {kind === "bar" && <BarFields m={m} id={id} />}
      {kind === "part" && <PartFields m={m} id={id} />}
      {kind === "connection" && <ConnectionFields m={m} id={id} />}
      {kind === "node" && <PlainFields m={m} id={id} title="Point" />}
      {kind === "run" && <PlainFields m={m} id={id} title="Run" />}
      {kind === "pattern" && <PlainFields m={m} id={id} title="Pattern" />}
      {kind === "copy" && <CopyBody m={m} id={id} />}
      {kind === "item" && <ItemBody m={m} id={id} />}
      {end && (
        <p>
          An end of{" "}
          <button type="button" class="link" onClick={() => select([end], "replace")}>
            {entityName(m, end)}
          </button>
          .
        </p>
      )}
      {OTHER_WORDS[kind] && <p class="sub">{OTHER_WORDS[kind]}</p>}
      {m.derived.bars[id] ? (
        <BarDerived m={m} id={id} ends={kind !== "bar"} />
      ) : (
        <OtherDerived m={m} id={id} />
      )}
      {kind !== "item" && barItem && <Item m={m} id={barItem} />}
      {kind !== "item" && barItem?.startsWith("project:") && (
        <ProjectItem m={m} id={barItem} part={id} />
      )}
    </div>
  );
}

/** Several selected: how many of what, their problems, Delete, and Replace when all are bars. */
function Many({ m, ids }: { m: Model; ids: string[] }) {
  const kinds = new Map<RefKind, number>();
  for (const id of ids) {
    const k = refKind(m, id);
    kinds.set(k, (kinds.get(k) ?? 0) + 1);
  }
  const bars = ids.filter((id) => refKind(m, id) === "bar");
  const item = bars.length === ids.length ? m.derived.bars[bars[0] as string]?.item : undefined;
  return (
    <div class="props" data-testid="properties">
      <div class="insp-head">
        <h2>{ids.length} selected</h2>
        <DeleteButton />
      </div>
      <p class="sub">
        {[...kinds.entries()]
          .map(([k, n]) => plural(n, NOUN[k], k === "copy" ? "pattern copies" : undefined))
          .join(", ")}
      </p>
      <p class="ids">
        <EntityChips ids={ids} max={12} />
      </p>
      <SelectionProblems m={m} ids={ids} />
      {item && <ReplaceMany m={m} bars={bars} item={item} />}
    </div>
  );
}

/** Replace for several bars of one item: the form opens on demand (it asks the catalog). */
function ReplaceMany({ m, bars, item }: { m: Model; bars: string[]; item: string }) {
  const [open, setOpen] = useState(false);
  return (
    <section>
      <h3>Profile</h3>
      <p>
        <code>{item}</code>{" "}
        <button
          type="button"
          class="btn"
          data-testid="replace-open"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          Replace…
        </button>
      </p>
      {open && <ReplaceForm m={m} ids={bars} item={item} onDone={() => setOpen(false)} />}
    </section>
  );
}

export function Inspector() {
  const m = model.value;
  const sel = [...selection.value];
  return (
    <>
      <DeleteFlow />
      {!m ? (
        <div class="panel-empty">No model yet.</div>
      ) : sel.length === 0 ? (
        // Nothing selected: the project panel (D-UX-4), S2's, in the inspector's place.
        <ProjectPanel />
      ) : sel.length > 1 ? (
        <Many m={m} ids={sel} />
      ) : (
        <One key={sel[0]} m={m} id={sel[0] as string} />
      )}
    </>
  );
}
