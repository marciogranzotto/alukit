import type { SectionCore } from "#catalog/sections/generators/index.ts";
import { compareIds } from "../ids.ts";
import { QUANTUM, quantize } from "../quantum.ts";
import { tapDrill, tapFit, threadPitch } from "../threads.ts";
import { TOL } from "../tolerances.ts";
import type { Ctx } from "./context.ts";
import type { DerivedBar, EndHoleOp, EndTapOp } from "./derive.ts";
import { opText } from "./duplicates.ts";

/** A tap into a bar's end: an end tap, or a tapped end hole. */
type EndTap = EndTapOp | (EndHoleOp & { thread: string });

/**
 * Taps into a bar's end on their section's cores (design §5.5; a finding of the third acceptance
 * run). A tap in a profile's end needs material to cut its thread in, and a T-slot profile has it
 * at its cores: a tap given no position stands at the end's centre, which is no core on an 80x80
 * with four. Each tap into an end, an end tap (a connector's in a butting or a through bar's end,
 * or a splice's) or a tapped end hole (§4.5, G31), must stand on one of its section's cores, its
 * centre within `TOL.len` of the core's; else it is a `machining` error on the bar naming the
 * end, the place and the nearest cores (each of those at the least distance), one for each place,
 * with the connections that made the taps there. On a core, the tap must fit it (`fit`, below):
 * an M16 on an 80x80's Ø5 corner hole is on a core and still an error. A drilled end hole is not a
 * tap and is not checked.
 *
 * A section's cores are a `tslot` generator's `bores` or a drawn section's `cores` (§3.5). A
 * section that gives none, a box, a generator given no bores or a drawn section that names none,
 * cannot be checked: an info on the bar names its tapped ends. A pattern copy's bar is its
 * template's, which reports.
 */
export function coreTaps(ctx: Ctx, bars: ReadonlyMap<string, DerivedBar>): void {
  for (const id of [...bars.keys()].sort(compareIds)) {
    const b = bars.get(id) as DerivedBar;
    if (b.placed.copy) continue;
    const taps = b.ops.filter(
      (o): o is EndTap => o.op === "end-tap" || (o.op === "end-hole" && o.thread !== undefined),
    );
    if (taps.length === 0) continue;
    const { section, sectionId } = b.placed.item;
    if (!section.cores) {
      const ends = [...new Set(taps.map((t) => t.from))].sort();
      const by = [...new Set(taps.map((t) => t.by))].sort(compareIds);
      ctx.d.info(
        "machining",
        id,
        `${sectionId} gives no core positions: the taps in ${ends.map((e) => `end ${e}`).join(" and ")} (${by.join(", ")}) are not checked against its cores`,
        { refs: by },
      );
      continue;
    }
    // The cores from the section's box centre, the frame an end tap's place is given in.
    const [[x0, y0], [x1, y1]] = section.bbox_mm;
    const cores = section.cores.map(
      (c) => [c.at_mm[0] - (x0 + x1) / 2, c.at_mm[1] - (y0 + y1) / 2] as const,
    );
    const places = new Map<string, EndTap[]>();
    for (const t of taps) {
      const k = JSON.stringify([t.from, ...(t.off ?? [0, 0]).map(q), t.op, t.thread]);
      places.set(k, [...(places.get(k) ?? []), t]);
    }
    for (const group of places.values()) {
      const t = group[0] as EndTap;
      const [x, y] = t.off ?? [0, 0];
      const far = cores.map(([cx, cy]) => Math.hypot(x - cx, y - cy));
      const least = Math.min(...far);
      const by = [...new Set(group.map((o) => o.by))].sort(compareIds);
      if (least <= TOL.len) {
        const core = section.cores[far.indexOf(least)] as SectionCore;
        fit(ctx, id, sectionId, opText(b, t), by, t.thread, core.d_mm);
        continue;
      }
      const nearest = cores
        .filter((_, i) => (far[i] as number) - least <= TOL.len)
        .sort((a, c) => a[0] - c[0] || a[1] - c[1])
        .map(([cx, cy]) => `x ${mm(cx)}, y ${mm(cy)}`);
      const where =
        cores.length === 0
          ? ": it has none"
          : `; the nearest, ${mm(least)} off: ${nearest.join("; ")} from the centre`;
      ctx.d.error(
        "machining",
        id,
        `${opText(b, t)} (${by.join(", ")}) is on no core of ${sectionId}${where}`,
        { refs: by },
      );
    }
  }
}

/**
 * A tap on a core must fit it (`tapFit`): a core wider than the thread's largest minor diameter
 * (6H) leaves a shallow thread, and a tap drill more than one pitch over the core drills away wall
 * the section does not state. Either is a `machining` error; a thread with no tap drill or 6H
 * tolerance here is an info, its place checked and its fit not.
 */
function fit(
  ctx: Ctx,
  bar: string,
  sectionId: string,
  what: string,
  by: string[],
  thread: string,
  d: number,
): void {
  const f = tapFit(thread, d);
  const core = `the Ø${mm(d)} core of ${sectionId}`;
  if (f === undefined) {
    ctx.d.info(
      "machining",
      bar,
      `${what} (${by.join(", ")}) is on ${core}; its fit is not checked: AluKit has no tap drill and 6H tolerance for ${thread}`,
      { refs: by },
    );
    return;
  }
  if (f.fits) return;
  const why =
    f.why === "core-wide"
      ? `the core is wider than ${thread}'s largest minor diameter, ${f.limit_mm.toFixed(3)} (6H), so the thread would be shallow`
      : `${thread}'s tap drill, ${mm(tapDrill(thread) as number)}, would drill it up ${mm((tapDrill(thread) as number) - d)}, more than one pitch (${mm(threadPitch(thread) as number)})`;
  ctx.d.error("machining", bar, `${what} (${by.join(", ")}) does not fit ${core} it is on: ${why}`, {
    refs: by,
  });
}

const q = (x: number) => quantize(x, QUANTUM.len_mm);
const mm = (x: number) => q(x).toFixed(2);
