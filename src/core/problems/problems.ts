import type { CheckOutput } from "../check/check.ts";
import { buttSystems } from "../check/joints.ts";
import { checkedOrder, type ModelOutputs } from "../check/outputs.ts";
import { type JoinAnswer, planJoin } from "../commands/join.ts";
import { idList } from "../commands/words.ts";
import { offerMatches } from "../cutlist/cutlist.ts";
import type { Derived } from "../derive/derive.ts";
import { jsonText } from "../derive/output.ts";
import { type Diagnostic, type Severity, sortDiagnostics } from "../diagnostics.ts";
import { compareIds } from "../ids.ts";
import type { ItemSource } from "../items.ts";
import type { Order, Reason } from "../order/order.ts";
import { daysBetween } from "../order/rules.ts";
import { cmp, optKey, optText, soldOptionsText } from "../order/types.ts";
import { PROJECT_ITEM } from "../project/parse.ts";
import type { Fix, Problem, ProblemGroup, ProblemsAnswer, Ref } from "./types.ts";
import { capital, checkTitle, sentence, supplierWords } from "./words.ts";

/**
 * The problem model (D-UX-12, BE-3): one list of what stands between the project and a sound
 * build and a sendable order, `alukit.problems/1`, merged from the check's diagnostics, the
 * order's reasons and the open items, grouped by consequence: what blocks the order, then
 * errors, warnings and notes. The unconnected ends are among the check's diagnostics. Nothing is
 * judged again here: the severities are the check's and the actions the order rules', so
 * `alukit check` and `alukit order` keep their meaning, and each problem keeps the message the
 * CLI prints as `raw`.
 *
 * - A diagnostic is one problem, in its severity's group.
 * - An order reason is one problem over every supplier it holds (`suppliers`), blocking the
 *   order or warning. A `check-error` reason is the error it repeats, which then blocks.
 * - An open item is the `open-item` reason it causes, or a note while it holds nothing.
 *
 * Each problem has plain words keyed by its code or rule (`words.ts` and below), its targets to
 * show and select, and its fixes, the likeliest first: a batch of commands (one step), or a form
 * the app opens.
 */

export interface ProblemsInput {
  /** The revision the problems are of. */
  rev: number;
  derived: Derived;
  /** The items derive read (the lock's): their names and offers. */
  items: ItemSource;
  /** What `GET /api/check` lists: the catalogs' problems and the model's checks, sorted. */
  diagnostics: readonly Diagnostic[];
  /** The order after the checks (`checkedOrder`), at its date. */
  order: Order;
}

/** What a revision's problems are made from, as the server's snapshot and the CLI hold it. */
export interface ModelState {
  rev: number;
  derived: Derived;
  items: ItemSource;
  /** The model's checks (§5.5), whose `mass()` and `cost()` read the outputs. */
  check: CheckOutput;
  /** Problems with the catalogs the document names, as opened. */
  catalogs: readonly Diagnostic[];
  outputs: ModelOutputs;
  /** The content hash of the lock it derives from, which the order states (§4.13). */
  lock?: string;
}

/**
 * The problems of a revision at an order's date: what `GET /api/problems` answers and
 * `alukit problems --json` prints, from the check's list as `GET /api/check` gives it and the
 * order as `alukit order` gives it.
 */
export function problemsAt(m: ModelState, asOf: string): ProblemsAnswer {
  const order = checkedOrder(m.outputs, m.check.diagnostics, {
    asOf,
    ...(m.lock !== undefined ? { lock: m.lock } : {}),
  });
  return problemsOf({
    rev: m.rev,
    derived: m.derived,
    items: m.items,
    diagnostics: sortDiagnostics([...m.catalogs, ...m.check.diagnostics]),
    order,
  });
}

/** The answer as JSON text, as the CLI prints it and the server sends it, byte for byte. */
export function problemsText(answer: ProblemsAnswer): string {
  return jsonText(answer);
}

const GROUPS: readonly ProblemGroup[] = ["blocks-order", "error", "warning", "note"];
const SEVERITY: Readonly<Record<Severity, ProblemGroup>> = {
  error: "error",
  warn: "warning",
  info: "note",
};

/** A problem while it is built. */
interface Draft extends Problem {
  /** The order holds it as a warning: it counts in `order.warnings`. */
  warns?: boolean;
  /** Its detail, once the suppliers it holds are known. */
  detailFor?: (suppliers: string) => string;
}

interface Ctx {
  derived: Derived;
  items: ItemSource;
  order: Order;
  params: ReadonlySet<string>;
}

export function problemsOf(input: ProblemsInput): ProblemsAnswer {
  const { derived, order } = input;
  const ctx: Ctx = {
    derived,
    items: input.items,
    order,
    params: new Set(Object.keys(derived.doc.params)),
  };
  const drafts: Draft[] = [];

  // 1. The check's diagnostics, in its order. A `check-error` reason quotes an error this way;
  // a `no-connector` reason names the butts the check notes one by one.
  const quoted = new Map<string, Draft>();
  const noted = new Map<string, Draft>();
  for (const d of input.diagnostics) {
    const p = fromDiagnostic(d, ctx);
    drafts.push(p);
    const as = `${d.code}${d.entity ? ` ${d.entity}` : ""}: ${d.message}`;
    if (d.severity === "error" && !quoted.has(as)) quoted.set(as, p);
    if (d.code === "butt-no-connector" && d.entity) noted.set(d.entity, p);
  }

  // 2. The order's reasons, by supplier as the order lists them, each one problem.
  const reasons = new Map<string, Draft>();
  for (const s of order.suppliers) {
    for (const r of s.reasons) {
      const key = `${r.rule}\u0000${r.message}`;
      let p = r.rule === "check-error" ? quoted.get(r.message) : reasons.get(key);
      if (!p) {
        p = fromReason(r, ctx);
        if (r.rule === "no-connector") foldNotes(p, r.entities ?? [], noted, drafts);
        else drafts.push(p);
      }
      reasons.set(key, p);
      p.rule = r.rule;
      p.suppliers = [...(p.suppliers ?? []), s.supplier];
      if (!p.from.includes("order")) p.from = [...p.from, "order"];
      // Blocking wins; an error the order only warns about stays an error, and a note it warns
      // about is a warning.
      if (r.action === "block") p.group = "blocks-order";
      else {
        p.warns = true;
        if (p.group === "note") p.group = "warning";
      }
    }
  }

  // 3. The open items: the reason each causes, or a note while it holds nothing (§4.12).
  for (const o of derived.doc.open) {
    const p = drafts.find((x) => x.rule === "open-item" && x.raw === `${o.id}: ${o.text}`);
    if (p) {
      p.from = [...p.from, "open"];
      continue;
    }
    drafts.push({
      ...openItem(o.id, o.text, o.scope ?? [], []),
      id: "",
      code: "open-item",
      group: "note",
      detail:
        o.blocks === "order"
          ? "It would hold the order, but the order rule open-item is off."
          : "It holds nothing; resolve it once it is settled.",
      raw: `${o.id}: ${o.text}`,
      from: ["open"],
    });
  }

  for (const p of drafts) finish(p);
  const problems = drafts
    .map((p, i) => ({ p, i }))
    .sort((a, b) => GROUPS.indexOf(a.p.group) - GROUPS.indexOf(b.p.group) || a.i - b.i)
    .map(({ p }) => p);
  uniqueIds(problems);

  const nothing = order.suppliers.every((s) => s.lines.length === 0 && s.costs.length === 0);
  return {
    schema: "alukit.problems/1",
    rev: input.rev,
    variant: derived.variant ?? null,
    as_of: order.as_of,
    order: {
      status: nothing ? "EMPTY" : order.status,
      blocks: problems.filter((p) => p.group === "blocks-order").length,
      warnings: problems.filter((p) => p.warns === true).length,
    },
    problems: problems.map(output),
  };
}

/**
 * The order's `no-connector` reason, which names the butts the check notes one by one: one
 * problem in the first note's place, from the check and the order, the notes it names folded in.
 */
function foldNotes(
  p: Draft,
  butts: readonly string[],
  noted: ReadonlyMap<string, Draft>,
  drafts: Draft[],
): void {
  const notes = new Set(butts.flatMap((b) => noted.get(b) ?? []));
  const at = drafts.findIndex((x) => notes.has(x));
  if (at < 0) {
    drafts.push(p);
    return;
  }
  p.from = ["check"];
  drafts.splice(at, 1, p);
  for (let i = drafts.length - 1; i > at; i--) {
    if (notes.has(drafts[i] as Draft)) drafts.splice(i, 1);
  }
}

// ---------------------------------------------------------------------------------------------
// The check's diagnostics

function fromDiagnostic(d: Diagnostic, ctx: Ctx): Draft {
  const names = [...(d.entity ? [d.entity] : []), ...(d.refs ?? [])];
  const where = d.entity && !ctx.params.has(d.entity) ? [d.entity] : [];
  const p: Draft = {
    id: "",
    code: d.code,
    group: SEVERITY[d.severity],
    title: checkTitle(d.code, where),
    detail: sentence(d.message),
    raw: d.message,
    targets: refsOf(names, ctx),
    fixes: names
      .filter((n) => ctx.params.has(n))
      .map((param): Fix => ({ label: `Edit ${param}…`, kind: "param", param })),
    from: ["check"],
  };
  if (d.code === "unconnected" && d.entity) {
    const others = (d.refs ?? []).filter((r) => r !== d.entity);
    p.title = `Open corner: ${d.entity} meets ${idList(others)} with no connection`;
    // The fix is offered only where autoConnect would make it: the same rule decides (E-UX-12).
    const join = joinAtEnd(d.entity, ctx);
    if (join.ok) {
      p.detail = "The ends meet with nothing to join them: add a connection there.";
      p.fixes.push({
        label: "Join with the default butt",
        kind: "commands",
        commands: [{ cmd: "autoConnect", args: { end: d.entity } }],
      });
    } else {
      p.detail = `The ends meet with nothing to join them, and the default butt cannot join them here (${join.why}): add a connection there.`;
    }
  }
  if (d.code === "angled-end" && d.entity) Object.assign(p, angledWords(d, d.entity));
  if (d.code === "butt-no-connector") Object.assign(p, connectorWords(names, ctx));
  if (d.code === "no-offer" && d.entity) {
    const asked = askedOf(d.refs ?? [], d.entity, ctx);
    const opt = asked ? optText(asked) : "";
    p.title = `Nothing sells ${nameOf(d.entity, ctx)} by length${opt ? ` with ${opt}` : ""}`;
    // Sold, but only in other options: the same fixes as the order's option-not-sold.
    const offers = ctx.items.offers(d.entity);
    if (asked && offers.length > 0 && !offers.some((o) => offerMatches(o, asked))) {
      const { title: _, ...words } = optionWords(d.entity, asked, d.refs ?? [], ctx);
      Object.assign(p, words);
    }
  }
  return p;
}

/** What `autoConnect { end }` would do at an end: the shared plan, or why it would refuse. */
function joinAtEnd(end: string, ctx: Ctx): JoinAnswer {
  const [bar, e] = end.split(".") as [string, "a" | "b"];
  const b = ctx.derived.bars.get(bar)?.placed;
  const P = e === "a" ? b?.A : b?.B;
  if (!P) return { ok: false, why: `${bar} does not derive` };
  return planJoin(ctx.derived, P, ctx.derived.doc.defaults.corner ?? "vertical");
}

/**
 * An end its provider cuts at an angle, with no cut declared (§4.5, D3): which joint cuts it and
 * at what angle, and the two cuts it may declare, each one step on the bar that owns the end (a
 * pattern copy's template).
 */
function angledWords(d: Diagnostic, end: string): Pick<Problem, "title" | "detail" | "fixes"> {
  const [ref, e] = end.split(".") as [string, string];
  const bar = ref.split("@")[0] as string;
  const angle = / is cut at ([\d.]+)° by /.exec(d.message)?.[1];
  const by = d.refs?.[0];
  const cut = (label: string, value: "angle" | "square"): Fix => ({
    label,
    kind: "commands",
    commands: [{ cmd: "setBar", args: { id: bar, set: { ends: { [e]: { cut: value } } } } }],
  });
  return {
    title: `${end} is cut at an angle it does not declare`,
    detail: `${by ?? "Its joint"} cuts it${angle ? ` at ${angle}°` : " at an angle"}: say how it is cut, on the face at that angle or square across the bar. Until then it is drawn square at its design point.`,
    fixes: [cut("Cut it on the face", "angle"), cut("Cut it square", "square")],
  };
}

// ---------------------------------------------------------------------------------------------
// The order's reasons

function fromReason(r: Reason, ctx: Ctx): Draft {
  const entities = r.entities ?? [];
  const item = entities[0] ?? "";
  const name = item ? nameOf(item, ctx) : "";
  const p: Draft = {
    id: "",
    code: r.rule,
    rule: r.rule,
    group: r.action === "block" ? "blocks-order" : "warning",
    title: sentence(r.message),
    detail: "",
    raw: r.message,
    targets: refsOf(entities, ctx),
    fixes: [],
    from: [],
  };
  switch (r.rule) {
    case "open-item": {
      const o = ctx.derived.doc.open.find((x) => r.message === `${x.id}: ${x.text}`);
      if (o) {
        Object.assign(p, openItem(o.id, o.text, o.scope ?? [], entities));
        p.detailFor = (s) => `It holds the order from ${s} until it is resolved.`;
        return p;
      }
      const cost = ctx.derived.doc.costs.find((c) => entities.includes(c.id));
      if (cost) {
        p.title = `Cost line ${cost.id} (${cost.label}) holds the order`;
        p.detailFor = (s) => `It holds the order from ${s} until it is released.`;
        p.fixes.push({
          label: `Release ${cost.id}`,
          kind: "commands",
          commands: [{ cmd: "setCost", args: { id: cost.id, set: { blocks: null } } }],
        });
      }
      return p;
    }
    case "missing-price": {
      const rate = /: no exchange rate for (\S+)$/.exec(r.message)?.[1];
      if (rate) {
        p.title = `No exchange rate for ${rate}`;
        p.detail = `Prices in ${rate} cannot be converted into the project's currency: add the rate (fx) in the project's settings.`;
      } else if (r.message.endsWith(": no price")) {
        p.title = `No price for ${name}`;
        p.detailFor = (s) => `The order from ${s} waits for its price.`;
        p.fixes.push(setPrice(item));
      } else if (r.message.endsWith(": no offer sells it by length")) {
        p.title = `Nothing sells ${name} by length`;
        p.detail = "It is sold, but neither cut to length nor in stock lengths.";
      } else {
        p.title = `No supplier sells ${name}`;
        p.detail = "No catalog offers it, so it has no price and no supplier to order from.";
        p.fixes.push(setPrice(item));
      }
      return p;
    }
    case "est-price":
      p.title = `The price of ${name} is an estimate`;
      p.detailFor = (s) => `The order from ${s} waits for a price read from a source.`;
      p.fixes.push({ ...setPrice(item), label: "Set a sourced price…" });
      return p;
    case "placeholder":
      p.title = `${capital(name)} is a placeholder, not a part to order`;
      p.detail = "Replace it with a catalog item, or order it by hand and leave it out.";
      return p;
    case "out-of-stock":
      p.title = `${capital(name)} is out of stock`;
      p.detail = "Choose another offer, or update the lock once the catalog has it again.";
      p.fixes.push(lockUpdate(item));
      return p;
    case "option-not-sold":
      return Object.assign(
        p,
        optionWords(item, askedOf(entities.slice(1), item, ctx) ?? {}, entities.slice(1), ctx),
      );
    case "no-connector":
      // The check's note is the same problem, which the reason joins (above); alone, it reads so.
      return Object.assign(p, { code: "butt-no-connector" }, connectorWords(entities, ctx));
    case "stale-price": {
      const read = /price read (\d{4}-\d{2}-\d{2})/.exec(r.message)?.[1];
      if (read) {
        const days = daysBetween(read, ctx.order.as_of);
        p.title = `The price of ${name} was read ${days} days before the order`;
        p.detailFor = (s) => `Read on ${read}: check it before sending the order to ${s}.`;
      }
      p.fixes.push(lockUpdate(item));
      return p;
    }
    default:
      return p;
  }
}

function openItem(id: string, text: string, scope: readonly string[], named: readonly string[]) {
  return {
    title: `Open item ${id}: ${text}`,
    targets: [id, ...new Set([...scope, ...named])],
    fixes: [{ label: `Resolve ${id}…`, kind: "resolve-open", open: id } as Fix],
  };
}

/**
 * Butts that name no connector (review B1, `check/joints.ts`): how many, what follows, and one
 * fix choosing a connector that fits their bars, as the project's default butt connector.
 */
function connectorWords(
  butts: readonly string[],
  ctx: Ctx,
): Pick<Problem, "title" | "detail" | "fixes"> {
  const one = butts.length === 1;
  return {
    title: one
      ? `${butts[0]} names no connector: the order buys nothing to join its ends`
      : `${butts.length} butts name no connector: the order buys nothing to join them`,
    detail: `Neither ${one ? "the butt" : "these butts"} nor the project name a connector, so nothing is bought or machined to hold the ends. Choose one, which becomes the project's default butt connector, or one per butt in the inspector.`,
    fixes: [
      {
        label: one
          ? `Set a connector for ${butts[0]}…`
          : `Set a connector for all ${butts.length}…`,
        kind: "connector",
        butts: [...butts],
        systems: buttSystems(ctx.derived, butts),
      },
    ],
  };
}

const setPrice = (item: string): Fix => ({ label: "Set a price…", kind: "set-price", item });
const lockUpdate = (item: string): Fix => ({
  label: "Update the price…",
  kind: "lock-update",
  item,
});

// ---------------------------------------------------------------------------------------------
// Options (BE-7, U2)

/**
 * The options the named bars and parts ask of `item`: those of the first that uses it (a line
 * is one item in one set of options, so they share them). Undefined when none does.
 */
function askedOf(
  names: readonly string[],
  item: string,
  ctx: Ctx,
): Readonly<Record<string, string>> | undefined {
  for (const n of names) {
    const bar = ctx.derived.bars.get(n);
    if (bar?.placed.item.id === item) return bar.placed.opt;
    const part = ctx.derived.parts.get(n);
    if (part?.item === item) return part.opt;
  }
  return undefined;
}

/**
 * An item asked for in options none of its offers sells: what is sold, in words, and a fix per
 * set of options sold, setting it on every bar and part that asks, as one step; and, when every
 * one of them takes those options from `defaults.bar`, one making that set the default.
 */
function optionWords(
  item: string,
  asked: Readonly<Record<string, string>>,
  names: readonly string[],
  ctx: Ctx,
): Pick<Problem, "title" | "detail" | "fixes" | "targets" | "field"> {
  const offers = ctx.items.offers(item);
  const sets = new Map(offers.map((o) => [optKey(o.options), o.options]));
  const sold = [...sets.keys()]
    .sort(cmp)
    .map((k) => sets.get(k) as Readonly<Record<string, string>>);
  const keys = [...new Set(sold.flatMap((o) => Object.keys(o)))].sort(cmp);
  const words = (set: Readonly<Record<string, string>>) =>
    keys.length === 1 ? (set[keys[0] as string] as string) : optText(set);
  // The document's own bars and parts: a pattern copy changes through its template.
  const asking = [...new Set(names.map((n) => n.split("@")[0] as string))]
    .filter((n) => askedBy(n, item, asked, ctx))
    .sort(compareIds);
  const name = nameOf(item, ctx);
  const fixes: Fix[] = [];
  if (asking.length > 0) {
    for (const set of sold) {
      fixes.push({
        label: `Set ${words(set)}`,
        kind: "commands",
        commands: asking.map((id) => ({
          cmd: ctx.derived.bars.has(id) ? "setBar" : "setPart",
          args: { id, set: { opt: set } },
        })),
      });
    }
    const own = (id: string) => ctx.derived.doc.bars[id]?.opt ?? {};
    if (asking.every((id) => ctx.derived.bars.has(id) && keys.every((k) => !(k in own(id))))) {
      for (const set of sold) {
        fixes.push({
          label: `Make ${words(set)} the default`,
          kind: "commands",
          commands: [{ cmd: "setProject", args: { defaults: { bar: { opt: set } } } }],
        });
      }
    }
  }
  return {
    title:
      Object.keys(asked).length === 0
        ? `No ${idList(keys, keys.length)} chosen for ${asking.length > 0 ? idList(asking) : name}`
        : `${capital(name)} is not sold with ${optText(asked)}`,
    detail: `${capital(name)} is sold only with ${soldOptionsText(offers)}.`,
    fixes,
    targets: [...asking, item],
    ...(keys.length > 0 ? { field: keys.length === 1 ? `opt.${keys[0]}` : "opt" } : {}),
  };
}

/** Whether a document bar or part asks for `item` in exactly the options `asked`. */
function askedBy(
  id: string,
  item: string,
  asked: Readonly<Record<string, string>>,
  ctx: Ctx,
): boolean {
  const bar = ctx.derived.bars.get(id);
  if (bar) return bar.placed.item.id === item && optKey(bar.placed.opt) === optKey(asked);
  const part = ctx.derived.parts.get(id);
  return part !== undefined && part.item === item && optKey(part.opt) === optKey(asked);
}

// ---------------------------------------------------------------------------------------------

/** An item as a person names it: its name, then its id. */
function nameOf(ref: string, ctx: Ctx): string {
  if (ref.startsWith(PROJECT_ITEM)) {
    const own = ctx.derived.doc.items[ref.slice(PROJECT_ITEM.length)];
    return own?.name ? `${own.name} (${ref})` : ref;
  }
  const found = ctx.items.item(ref);
  return found.ok && found.item.name ? `${found.item.name} (${ref})` : ref;
}

/** What a problem names, to show and select: entities, ends, items; a param is not one. */
function refsOf(names: readonly string[], ctx: Ctx): Ref[] {
  return [...new Set(names.filter((n) => !ctx.params.has(n)))];
}

/** The detail that waits for the suppliers a problem holds, once they are all known. */
function finish(p: Draft): void {
  const s = supplierWords(p.suppliers ?? []);
  if (p.detailFor) p.detail = p.detailFor(s);
  else if (p.detail === "") {
    p.detail =
      p.group === "blocks-order"
        ? `It holds the order from ${s}.`
        : `The order from ${s} can go, but check this first.`;
  } else if (p.from.includes("check") && p.group === "blocks-order") {
    p.detail = `${p.detail} It holds the order from ${s}.`;
  }
}

/**
 * Ids, stable while a problem lasts: its code, what it is about (a diagnostic's entity, a
 * reason's targets) and the suppliers it holds. A second problem of the same three gains `~2`.
 */
function uniqueIds(problems: Draft[]): void {
  const seen = new Map<string, number>();
  for (const p of problems) {
    const what = p.from.includes("check") ? (p.targets[0] ?? "") : p.targets.join(",");
    const who = p.suppliers ? `/${p.suppliers.map((s) => s ?? "-").join(",")}` : "";
    const id = `${p.code}/${what}${who}`;
    const n = (seen.get(id) ?? 0) + 1;
    seen.set(id, n);
    p.id = n === 1 ? id : `${id}~${n}`;
  }
}

/** A problem in its schema's key order, without what only building it needed. */
function output(p: Draft): Problem {
  return {
    id: p.id,
    code: p.code,
    ...(p.rule !== undefined ? { rule: p.rule } : {}),
    group: p.group,
    title: p.title,
    detail: p.detail,
    raw: p.raw,
    ...(p.suppliers !== undefined ? { suppliers: p.suppliers } : {}),
    targets: p.targets,
    ...(p.field !== undefined ? { field: p.field } : {}),
    fixes: p.fixes,
    from: p.from,
  };
}
