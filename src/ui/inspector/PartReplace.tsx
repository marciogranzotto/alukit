import { useEffect, useState } from "preact/hooks";
import type { ListedEntry } from "../../server/catalog.ts";
import { OptionSelects, useOptions } from "../catalog/Card.tsx";
import { fetchCatalogItems } from "../client/catalog.ts";
import { Errors } from "../Feedback.tsx";
import { plural } from "../format.ts";
import type { Model } from "../model.ts";
import { useCard } from "./BarFields.tsx";
import { useSend } from "./Fields.tsx";
import { replaceBatch } from "./replace.ts";
import { editOff } from "./rows.tsx";
import { isObject, written } from "./words.ts";

/**
 * Replace a part from its inspector (docs/ux/editing-audit.md E5.4): another catalog item of the
 * same kind, the same family listed first (a T-nut for a T-nut), its options from the values
 * sold, for this part or every part like it (the same item and options), as one step. The
 * catalog card's Replace did this from the other side; the batch is the same (`replaceBatch`, a
 * `setPart` each). Owner: E5.
 */

/** Options as one comparable string: `finish=black`. */
function optKey(opt: unknown): string {
  const o = isObject(opt) ? opt : {};
  return Object.keys(o)
    .sort()
    .map((k) => `${k}=${String(o[k])}`)
    .join(",");
}

/** The document's placed parts like this one: the same item and options as written, in id order. */
export function partsLike(m: Model, id: string): string[] {
  const me = written(m, id);
  if (!isObject(me) || typeof me.item !== "string") return [];
  const key = `${me.item}|${optKey(me.opt)}`;
  const parts = isObject(m.doc.parts) ? m.doc.parts : {};
  return Object.entries(parts)
    .filter(([, p]) => isObject(p) && !p.unplaced && `${String(p.item)}|${optKey(p.opt)}` === key)
    .map(([pid]) => pid);
}

export function PartReplaceForm({
  m,
  id,
  item,
  onDone,
}: {
  m: Model;
  id: string;
  item: string;
  onDone: () => void;
}) {
  const current = useCard(item);
  const kind = current?.entry.kind;
  const family = current?.entry.family;
  const [q, setQ] = useState("");
  const [found, setFound] = useState<ListedEntry[]>([]);
  const [why, setWhy] = useState<string>();
  const [chosen, setChosen] = useState<string>();
  useEffect(() => {
    if (!kind) return;
    let live = true;
    const t = setTimeout(() => {
      // Its own family first, as the catalog lists it; a search looks through the whole kind.
      void fetchCatalogItems({ kind, ...(q.trim() === "" ? { family } : { q }), limit: 50 }).then(
        (r) => {
          if (!live) return;
          if (r.ok) {
            setFound(r.value.items.filter((e) => e.kind === kind));
            setWhy(undefined);
          } else setWhy(r.why);
        },
      );
    }, 150);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [kind, family, q]);
  const pick = chosen ?? found.find((e) => e.id !== item)?.id;
  const card = useCard(pick);
  const opts = useOptions(card);
  const like = partsLike(m, id);
  const [scope, setScope] = useState<"this" | "like">("this");
  const targets = scope === "like" ? like : [id];
  const { outcome, send } = useSend();
  return (
    <form
      class="replace-form"
      data-testid="part-replace-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!pick) return;
        void send(
          replaceBatch(m, targets, pick, opts.values),
          `replace ${targets.length === 1 ? targets[0] : `${targets.length} parts`} with ${pick}`,
        ).then((o) => {
          if (o.ok) onDone();
        });
      }}
    >
      <label class="cd-row">
        <span>Find</span>
        <input
          class="insp-input"
          data-testid="part-replace-query"
          value={q}
          placeholder={family ? `another ${family}, or a code or name` : "a code or a name"}
          onInput={(e) => setQ((e.currentTarget as HTMLInputElement).value)}
        />
      </label>
      <label class="cd-row">
        <span>Item</span>
        <select
          class="insp-select"
          data-testid="part-replace-item"
          value={pick ?? ""}
          onChange={(e) => setChosen((e.currentTarget as HTMLSelectElement).value)}
        >
          {found.length === 0 && <option value="">{kind ? "Nothing matches" : "Reading…"}</option>}
          {found.map((e) => (
            <option key={e.id} value={e.id} disabled={e.id === item}>
              {e.code ?? e.id} · {e.name}
              {e.id === item ? " (now)" : ""}
            </option>
          ))}
        </select>
      </label>
      {why && <p class="warn">{why}</p>}
      <OptionSelects fields={opts.fields} picked={opts.values} onPick={opts.pick} />
      {like.length > 1 && (
        <fieldset class="replace-scope">
          <legend>Replace</legend>
          <label>
            <input
              type="radio"
              name="part-replace-scope"
              checked={scope === "this"}
              onChange={() => setScope("this")}
            />{" "}
            this part, {id}
          </label>
          <label>
            <input
              type="radio"
              name="part-replace-scope"
              data-testid="part-replace-like"
              checked={scope === "like"}
              onChange={() => setScope("like")}
            />{" "}
            all {like.length} like it ({item})
          </label>
        </fieldset>
      )}
      <div class="tp-row">
        <button
          type="submit"
          class="btn primary"
          data-testid="part-replace-apply"
          disabled={!pick || editOff()}
        >
          Replace {plural(targets.length, "part")}
        </button>
        <button type="button" class="btn" onClick={onDone}>
          Cancel
        </button>
      </div>
      <Errors outcome={outcome} />
    </form>
  );
}
