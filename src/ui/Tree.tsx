import { useState } from "preact/hooks";
import type { Model } from "./model.ts";
import { model, select, selection } from "./store.ts";

/**
 * The project tree (design §8, left): bars, runs, connections, parts, patterns and nodes, by kind
 * or by tag. It lists the document's entities and derive's pattern copies, so an entity that
 * does not derive is still there to select and fix.
 */

const KINDS = [
  ["bars", "Bars"],
  ["runs", "Runs"],
  ["connections", "Connections"],
  ["parts", "Parts"],
  ["patterns", "Patterns"],
  ["nodes", "Nodes"],
] as const;

type Kind = (typeof KINDS)[number][0];

interface Row {
  id: string;
  text: string;
  tags: string[];
  error: boolean;
  copy: boolean;
}

function idOrder(a: string, b: string): number {
  const split = (s: string) => {
    const m = /^([A-Za-z]+)(\d+)(.*)$/.exec(s);
    return m ? [m[1] as string, Number(m[2]), m[3] as string] : [s, 0, ""];
  };
  const [pa, na, ra] = split(a) as [string, number, string];
  const [pb, nb, rb] = split(b) as [string, number, string];
  return pa < pb ? -1 : pa > pb ? 1 : na - nb || (ra < rb ? -1 : ra > rb ? 1 : 0);
}

function rows(m: Model, kind: Kind): Row[] {
  const written = (m.doc[kind] ?? {}) as Record<string, unknown>;
  const errors = new Set(
    m.check.diagnostics
      .filter((d) => d.severity === "error" && d.entity)
      .map((d) => d.entity?.split(".")[0]),
  );
  const ids = new Set(Object.keys(written));
  if (kind === "bars") for (const id of Object.keys(m.derived.bars)) ids.add(id);
  if (kind === "parts") for (const id of Object.keys(m.derived.parts)) ids.add(id);
  return [...ids].sort(idOrder).map((id) => {
    const v = written[id];
    const o =
      typeof v === "object" && v !== null && !Array.isArray(v)
        ? (v as Record<string, unknown>)
        : {};
    const label = typeof o.label === "string" ? o.label : "";
    let what = "";
    if (kind === "bars")
      what = m.derived.bars[id]?.item ?? (typeof o.item === "string" ? o.item : "");
    else if (kind === "parts") what = m.derived.parts[id]?.item ?? "";
    else if (kind === "connections") what = typeof o.type === "string" ? o.type : "";
    return {
      id,
      text: [label, what].filter((x) => x !== "").join(" · "),
      tags: Array.isArray(o.tags) ? (o.tags as string[]) : [],
      error: errors.has(id),
      copy: id.includes("@"),
    };
  });
}

export function Tree() {
  const m = model.value;
  const [byTag, setByTag] = useState(false);
  const [filter, setFilter] = useState("");
  const [closed, setClosed] = useState<Set<string>>(new Set(["nodes"]));
  if (!m) return <div class="panel-empty">No model yet.</div>;
  const sel = selection.value;
  const f = filter.trim().toLowerCase();
  const match = (r: Row) =>
    f === "" ||
    r.id.toLowerCase().includes(f) ||
    r.text.toLowerCase().includes(f) ||
    r.tags.some((t) => t.includes(f));

  const groups: { key: string; title: string; rows: Row[] }[] = [];
  if (byTag) {
    const all = KINDS.flatMap(([k]) => rows(m, k)).filter(match);
    const tags = new Map<string, Row[]>();
    for (const r of all)
      for (const t of r.tags.length > 0 ? r.tags : ["(untagged)"])
        tags.set(t, [...(tags.get(t) ?? []), r]);
    for (const [t, rs] of [...tags].sort(([a], [b]) => (a < b ? -1 : 1)))
      groups.push({ key: `tag:${t}`, title: t, rows: rs });
  } else {
    for (const [k, title] of KINDS) {
      const rs = rows(m, k).filter(match);
      if (rs.length > 0) groups.push({ key: k, title, rows: rs });
    }
  }

  const toggle = (key: string) => {
    const next = new Set(closed);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setClosed(next);
  };

  return (
    <nav class="tree" data-testid="tree">
      <div class="tree-tools">
        <input
          type="search"
          placeholder="Filter: id, label, item, tag"
          value={filter}
          onInput={(e) => setFilter((e.target as HTMLInputElement).value)}
        />
        <label>
          <input type="checkbox" checked={byTag} onChange={() => setByTag(!byTag)} /> by tag
        </label>
      </div>
      {groups.map((g) => (
        <section key={g.key}>
          <button
            type="button"
            class="group"
            onClick={() => toggle(g.key)}
            aria-expanded={!closed.has(g.key)}
          >
            {closed.has(g.key) ? "▸" : "▾"} {g.title} <span class="count">{g.rows.length}</span>
          </button>
          {!closed.has(g.key) && (
            <ul>
              {g.rows.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    class={`row${sel.has(r.id) ? " selected" : ""}${r.error ? " error" : ""}${r.copy ? " copy" : ""}`}
                    data-id={r.id}
                    onClick={(e) => select([r.id], e.ctrlKey || e.metaKey ? "toggle" : "replace")}
                  >
                    <span class="id">{r.id}</span>
                    <span class="text">{r.text}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </nav>
  );
}
