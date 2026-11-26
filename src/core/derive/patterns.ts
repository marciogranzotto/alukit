import {
  type Bar,
  type Connection,
  type EndSpec,
  type FreeEnd,
  isPose,
  type Node,
  type Part,
  type Pattern,
  type Point,
  type Station,
} from "../project/schema.ts";
import { unit, type V3 } from "../vec.ts";
import type { Ctx } from "./context.ts";
import type { Copy } from "./types.ts";

/**
 * Patterns (design §4.7): the template is real entities at the first station; copies
 * k = 1 … count − 1 get ids `<id>@<k>` and are translated by k × pitch_mm along the `along`
 * bar's or run's axis, or a `{ dir }`, or by `offsets_mm`. References inside the template are
 * remapped in each copy; references outside it are kept.
 *
 * Expansion here is structural: copies are new entities with remapped references and a `Copy`
 * record. Their translation is applied when points resolve (place.ts), since the axis comes from
 * a placed bar.
 */

export function expandPatterns(ctx: Ctx): void {
  const { doc } = ctx;
  for (const [id, spec] of Object.entries(doc.nodes)) ctx.nodes.set(id, { spec });
  for (const [id, spec] of Object.entries(doc.bars)) ctx.bars.set(id, { spec });
  for (const [id, spec] of Object.entries(doc.connections)) ctx.conns.set(id, { spec });
  for (const [id, spec] of Object.entries(doc.parts)) ctx.parts.set(id, { spec });

  const used = new Map<string, string>();
  for (const [pid, pt] of Object.entries(doc.patterns)) {
    const plan = planPattern(ctx, pid, pt, used);
    if (!plan) continue;
    const { template, steps } = plan;
    for (const [k, step] of steps) {
      const copy: Copy = {
        pattern: pid,
        k,
        step,
        ...(plan.along !== undefined ? { along: plan.along } : {}),
        ...(plan.dir !== undefined ? { dir: plan.dir } : {}),
      };
      const re = new Remap(template, k);
      for (const tid of template) {
        const cid = `${tid}@${k}`;
        const node = doc.nodes[tid];
        if (node !== undefined) ctx.nodes.set(cid, { spec: re.node(node), copy });
        const bar = doc.bars[tid];
        if (bar !== undefined) ctx.bars.set(cid, { spec: re.bar(bar), copy });
        const conn = doc.connections[tid];
        if (conn !== undefined) ctx.conns.set(cid, { spec: re.conn(conn), copy });
        const part = doc.parts[tid];
        if (part !== undefined) ctx.parts.set(cid, { spec: re.part(part), copy });
      }
    }
  }
}

interface Plan {
  template: Set<string>;
  steps: [number, number][];
  along?: string;
  dir?: V3;
}

function planPattern(
  ctx: Ctx,
  pid: string,
  pt: Pattern,
  used: Map<string, string>,
): Plan | undefined {
  const { doc, d } = ctx;
  let ok = true;
  const template = new Set<string>();
  for (const tid of pt.template) {
    const exists =
      Object.hasOwn(doc.nodes, tid) ||
      Object.hasOwn(doc.bars, tid) ||
      Object.hasOwn(doc.connections, tid) ||
      Object.hasOwn(doc.parts, tid);
    if (!exists) {
      d.error("ref", pid, `template: no entity ${tid}`, { field: "template", refs: [tid] });
      ok = false;
      continue;
    }
    const other = used.get(tid);
    if (other !== undefined) {
      d.error("pattern", pid, `template: ${tid} is already in the template of ${other}`, {
        field: "template",
        refs: [tid, other],
      });
      ok = false;
      continue;
    }
    template.add(tid);
  }

  let along: string | undefined;
  let dir: V3 | undefined;
  if (typeof pt.along === "string") {
    const known = pt.along.startsWith("r")
      ? Object.hasOwn(doc.runs, pt.along)
      : Object.hasOwn(doc.bars, pt.along);
    if (!known) {
      d.error("ref", pid, `along: no ${pt.along}`, { field: "along", refs: [pt.along] });
      ok = false;
    } else if (template.has(pt.along)) {
      d.error("pattern", pid, `along: ${pt.along} is in the template it moves`, {
        field: "along",
      });
      ok = false;
    } else along = pt.along;
  } else {
    const v = ctx.vec(pid, "along/dir", pt.along.dir);
    const u = v && unit(v);
    if (!u) {
      if (v) d.error("pattern", pid, "along: dir is a zero vector", { field: "along/dir" });
      ok = false;
    } else dir = u;
  }

  if (pt.rail_holes !== undefined) {
    for (const tid of template) used.set(tid, pid);
    if (ok && along !== undefined) planRailPattern(ctx, pid, pt, [...template], along);
    else if (ok) {
      d.error("pattern", pid, "rail_holes: the pattern runs along a rail or a run, not a dir", {
        field: "along",
      });
    }
    return undefined;
  }

  const steps: [number, number][] = [];
  if (pt.offsets_mm !== undefined) {
    if (pt.pitch_mm !== undefined || pt.count !== undefined) {
      d.error("pattern", pid, "give offsets_mm, or pitch_mm and count, not both");
      ok = false;
    }
    pt.offsets_mm.forEach((o, i) => {
      const v = ctx.num(pid, `offsets_mm[${i}]`, o);
      if (v === undefined) ok = false;
      else steps.push([i + 1, v]);
    });
  } else if (pt.pitch_mm !== undefined && pt.count !== undefined) {
    const pitch = ctx.num(pid, "pitch_mm", pt.pitch_mm);
    if (pitch === undefined) ok = false;
    else for (let k = 1; k < pt.count; k++) steps.push([k, k * pitch]);
  } else {
    d.error("pattern", pid, "a pattern needs pitch_mm and count, or offsets_mm");
    ok = false;
  }
  const skip = new Set(pt.skip ?? []);
  for (const k of skip) {
    if (!steps.some(([j]) => j === k)) {
      d.warn("pattern", pid, `skip: there is no copy ${k}`, { field: "skip" });
    }
  }

  for (const tid of template) used.set(tid, pid);
  if (!ok) return undefined;
  const plan: Plan = {
    template,
    steps: steps.filter(([k]) => !skip.has(k)),
    ...(along !== undefined ? { along } : {}),
    ...(dir !== undefined ? { dir } : {}),
  };
  ctx.patternPlans.set(pid, plan);
  return plan;
}

/**
 * A pattern at a rail's holes (§4.7). Holes follow the cut, so its copies are placed in stage 4,
 * and only parts may be in its template: each part on a station of the pattern's `along`, whose
 * `at_mm` is then measured from each selected hole (0 puts the part on the hole). The template is
 * the copy at the first selected hole.
 */
function planRailPattern(
  ctx: Ctx,
  pid: string,
  pt: Pattern,
  template: string[],
  along: string,
): void {
  const { doc, d } = ctx;
  let ok = true;
  if (pt.pitch_mm !== undefined || pt.count !== undefined || pt.offsets_mm !== undefined) {
    d.error("pattern", pid, "a pattern at rail holes takes no pitch_mm, count or offsets_mm", {
      field: "rail_holes",
    });
    ok = false;
  }
  const sel = pt.rail_holes as NonNullable<Pattern["rail_holes"]>;
  if (sel !== true && sel.along !== along) {
    d.error(
      "pattern",
      pid,
      `rail_holes: selects along ${sel.along}, the pattern runs along ${along}`,
      {
        field: "rail_holes/along",
        refs: [sel.along, along],
      },
    );
    ok = false;
  }
  for (const tid of template) {
    const part = doc.parts[tid];
    if (part === undefined || !("on" in part)) {
      d.error(
        "pattern",
        pid,
        `template: ${tid} is not a part on a station; a pattern at rail holes places parts only`,
        { field: "template", refs: [tid] },
      );
      ok = false;
      continue;
    }
    if (part.on.bar !== along) {
      d.error("pattern", pid, `template: ${tid} stands on ${part.on.bar}, not on ${along}`, {
        field: "template",
        refs: [tid],
      });
      ok = false;
    }
    if (part.on.from !== undefined && part.on.from !== "a") {
      d.error(
        "pattern",
        pid,
        `template: ${tid}'s at_mm is measured from each hole, so it takes no "from"`,
        { field: "template", refs: [tid] },
      );
      ok = false;
    }
  }
  const skip = new Set(pt.skip ?? []);
  if (ok) ctx.railPatterns.set(pid, { template, along, sel, skip });
}

/** Rewrites references to template entities into references to copy k. */
class Remap {
  private readonly template: ReadonlySet<string>;
  private readonly k: number;
  constructor(template: ReadonlySet<string>, k: number) {
    this.template = template;
    this.k = k;
  }

  id<T extends string>(id: T): T {
    return (this.template.has(id) ? `${id}@${this.k}` : id) as T;
  }

  end(ref: string): string {
    const [bar, end] = ref.split(".") as [string, string];
    return `${this.id(bar)}.${end}`;
  }

  station(st: Station): Station {
    return { ...st, bar: this.id(st.bar) };
  }

  point(p: Point): Point {
    if (typeof p === "string") return this.id(p);
    if (Array.isArray(p)) return p;
    if ("on" in p) return { on: this.station(p.on) };
    return { pivot: this.id(p.pivot) };
  }

  node(n: Node): Node {
    if (Array.isArray(n)) return n;
    if ("on" in n) return { ...n, on: this.station(n.on) };
    if ("pivot" in n) return { ...n, pivot: this.id(n.pivot) };
    return n;
  }

  private endSpec(e: EndSpec | undefined): EndSpec | undefined {
    if (!e?.plane) return e;
    const pl = e.plane;
    if ("point" in pl) {
      const normal = typeof pl.normal === "string" ? this.id(pl.normal) : pl.normal;
      return { ...e, plane: { point: this.point(pl.point), normal } };
    }
    if ("face" in pl) return { ...e, plane: { face: { ...pl.face, bar: this.id(pl.face.bar) } } };
    return { ...e, plane: { of: this.end(pl.of) } };
  }

  bar(b: Bar): Bar {
    const isFree = typeof b.b === "object" && !Array.isArray(b.b) && "len_mm" in b.b;
    const out: Bar = {
      ...b,
      a: this.point(b.a),
      b: isFree ? (b.b as FreeEnd) : this.point(b.b as Point),
    };
    if (b.ends) {
      const a = this.endSpec(b.ends.a);
      const e = this.endSpec(b.ends.b);
      out.ends = { ...(a ? { a } : {}), ...(e ? { b: e } : {}) };
    }
    return out;
  }

  conn(c: Connection): Connection {
    switch (c.type) {
      case "butt": {
        let through = c.through;
        if (typeof through === "string") {
          through = through.includes(".") ? this.end(through) : this.id(through);
        } else if (!isPose(through.at)) {
          through = { ...through, at: this.point(through.at) };
        }
        return { ...c, through, ends: c.ends.map((e) => this.end(e)) };
      }
      case "miter":
      case "splice":
        return { ...c, ends: [this.end(c.ends[0]), this.end(c.ends[1])] };
      case "pivot":
        return { ...c, base: this.station(c.base), ends: c.ends.map((e) => this.end(e)) };
      case "face":
        return {
          ...c,
          bars: c.bars.map((b) => this.id(b)),
          ...(c.stack
            ? {
                stack: c.stack.map((s) =>
                  typeof s === "object" && "inside" in s ? { ...s, inside: this.id(s.inside) } : s,
                ),
              }
            : {}),
        };
    }
  }

  part(p: Part): Part {
    return "on" in p ? { ...p, on: this.station(p.on) } : p;
  }
}
