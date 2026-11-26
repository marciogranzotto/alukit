import { useState } from "preact/hooks";
import { endText, machiningText, railText } from "#core/cutlist/format.ts";
import type { Model } from "./model.ts";
import { log, model, select, selection } from "./store.ts";

/**
 * The bottom drawer (design §8): cut list, BOM, checks and the log. The order list, costs, open
 * items, params and decisions join it when they are built (M3b's order part, M5).
 */

const TABS = ["Cut list", "BOM", "Checks", "Log"] as const;
type Tab = (typeof TABS)[number];

const mm = (x: number) => x.toFixed(2);
const optText = (opt: Readonly<Record<string, string>>) =>
  Object.keys(opt)
    .sort()
    .map((k) => `${k} ${opt[k]}`)
    .join(", ");

function Sources({ ids }: { ids: readonly string[] }) {
  const sel = selection.value;
  return (
    <span class="sources">
      {ids.map((id) => (
        <button
          type="button"
          key={id}
          class={`link${sel.has(id) ? " selected" : ""}`}
          onClick={(e) => select([id], e.ctrlKey || e.metaKey ? "toggle" : "replace")}
        >
          {id}
        </button>
      ))}
    </span>
  );
}

function CutListTab({ m }: { m: Model }) {
  const cl = m.cutlist;
  if (cl.groups.length === 0) return <p class="panel-empty">No pieces.</p>;
  return (
    <div data-testid="cutlist">
      {cl.groups.map((g) => (
        <section key={`${g.item}${optText(g.opt)}`}>
          <h4>
            {g.item} <span class="sub">{g.name}</span>{" "}
            {optText(g.opt) && <span class="sub">({optText(g.opt)})</span>}
            <span class="sub">
              {" "}
              · {g.pieces} piece{g.pieces === 1 ? "" : "s"}, {mm(g.total_mm)} mm ·{" "}
              {g.mode === "cut"
                ? `cut to order (${g.offer})`
                : g.mode === "stock"
                  ? `from stock bars`
                  : "no offer by length"}
            </span>
          </h4>
          <table class="grid">
            <thead>
              <tr>
                <th>count</th>
                <th>cut mm</th>
                <th>centre mm</th>
                <th>ends a / b</th>
                <th>machining</th>
                <th>pieces</th>
              </tr>
            </thead>
            <tbody>
              {g.lines.map((l) => (
                <tr key={l.sources.join(",")}>
                  <td class="n">{l.count}</td>
                  <td class="n">{mm(l.cut_mm)}</td>
                  <td class="n">{l.centre_mm === undefined ? "" : mm(l.centre_mm)}</td>
                  <td>
                    {endText(l.ends.a)} / {endText(l.ends.b)}
                  </td>
                  <td>
                    {[
                      ...(l.rail ? [railText(l.rail)] : []),
                      ...l.machining.map(machiningText),
                    ].join("; ")}
                  </td>
                  <td>
                    <Sources ids={l.sources} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {g.stock && (
            <p class="sub">
              {g.stock.length} stock bar{g.stock.length === 1 ? "" : "s"}:{" "}
              {g.stock.map((s) => `${s.length_mm} (offcut ${mm(s.offcut_mm)})`).join(", ")}
            </p>
          )}
        </section>
      ))}
    </div>
  );
}

function BomTab({ m }: { m: Model }) {
  const b = m.bom;
  return (
    <div data-testid="bom">
      <p class="sub">
        Total mass {b.mass_kg.toFixed(3)} kg
        {b.mass_unknown.length > 0 && `, without ${b.mass_unknown.join(", ")} (no mass given)`}
      </p>
      {b.groups.map((g) => (
        <section key={g.kind}>
          <h4>
            {g.kind} <span class="sub">· {g.mass_kg.toFixed(3)} kg</span>
          </h4>
          <table class="grid">
            <thead>
              <tr>
                <th>item</th>
                <th>name</th>
                <th>options</th>
                <th>qty</th>
                <th>length mm</th>
                <th>mass kg</th>
                <th>used by</th>
              </tr>
            </thead>
            <tbody>
              {g.lines.map((l) => (
                <tr key={`${l.item}${optText(l.opt)}`}>
                  <td>{l.item}</td>
                  <td>{l.name}</td>
                  <td>{optText(l.opt)}</td>
                  <td class="n">{l.qty}</td>
                  <td class="n">{l.length_mm === undefined ? "" : mm(l.length_mm)}</td>
                  <td class="n" title={l.mass_src ? `mass: ${l.mass_src}` : "no mass"}>
                    {l.mass_kg === undefined ? "" : l.mass_kg.toFixed(3)}
                  </td>
                  <td>
                    <Sources ids={l.sources} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}

function ChecksTab({ m }: { m: Model }) {
  const ds = m.check.diagnostics;
  const count = (s: string) => ds.filter((d) => d.severity === s).length;
  return (
    <div data-testid="checks">
      <p class="sub">
        {count("error")} error{count("error") === 1 ? "" : "s"}, {count("warn")} warning
        {count("warn") === 1 ? "" : "s"}, {count("info")} note{count("info") === 1 ? "" : "s"}
      </p>
      {m.check.checks.length > 0 && (
        <table class="grid">
          <thead>
            <tr>
              <th>check</th>
              <th>text</th>
              <th>result</th>
              <th>margin</th>
            </tr>
          </thead>
          <tbody>
            {m.check.checks.map((c) => (
              <tr key={c.id} class={c.pass === false ? c.severity : ""}>
                <td>{c.id}</td>
                <td>{c.text ?? ""}</td>
                <td>
                  {c.pending
                    ? "pending"
                    : c.pass === undefined
                      ? (c.problem ?? "?")
                      : c.pass
                        ? "pass"
                        : "fail"}
                </td>
                <td class="n">{c.margin ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <ul class="diagnostics">
        {ds.map((d) => (
          <li key={`${d.severity}${d.code}${d.entity}${d.field}${d.message}`} class={d.severity}>
            <span class="sev">{d.severity}</span> <span class="code">{d.code}</span>{" "}
            {d.entity && <Sources ids={[d.entity.split(".")[0] as string]} />} {d.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

function LogTab() {
  const entries = log.value;
  if (entries.length === 0) return <p class="panel-empty">No steps since the server started.</p>;
  return (
    <table class="grid" data-testid="log">
      <thead>
        <tr>
          <th>rev</th>
          <th>source</th>
          <th>what</th>
        </tr>
      </thead>
      <tbody>
        {[...entries].reverse().map((e) => (
          <tr key={e.rev}>
            <td class="n">{e.rev}</td>
            <td>{e.source}</td>
            <td>{e.what}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Drawer() {
  const [tab, setTab] = useState<Tab>("Cut list");
  const [open, setOpen] = useState(true);
  const m = model.value;
  const errors = m?.check.diagnostics.filter((d) => d.severity === "error").length ?? 0;
  return (
    <section class={`drawer${open ? " open" : ""}`}>
      <div class="tabs" role="tablist">
        {TABS.map((t) => (
          <button
            type="button"
            role="tab"
            class="tab"
            key={t}
            aria-selected={open && tab === t}
            onClick={() => {
              if (open && tab === t) setOpen(false);
              else {
                setTab(t);
                setOpen(true);
              }
            }}
          >
            {t}
            {t === "Checks" && errors > 0 && <span class="badge">{errors}</span>}
          </button>
        ))}
      </div>
      {open && m && (
        <div class="drawer-body">
          {tab === "Cut list" && <CutListTab m={m} />}
          {tab === "BOM" && <BomTab m={m} />}
          {tab === "Checks" && <ChecksTab m={m} />}
          {tab === "Log" && <LogTab />}
        </div>
      )}
    </section>
  );
}
