import type { CutGroup, EndCut, Machining, PieceRail, StockBar } from "#core/cutlist/cutlist.ts";
import { endText, machiningText, railText } from "#core/cutlist/format.ts";
import { ItemSwatch, swatches } from "../common/ItemSwatch.tsx";
import { mm } from "../format.ts";
import { swatchCss } from "../theme/tokens.ts";

/**
 * What the cut list draws: a piece's two ends as cut, its machining as pills, and the stock bar
 * a group is cut from, to scale (docs/ux/visual-design.md §6.2). Each is a picture of data the
 * cut list already has; the words stay beside them. Owner: S4.
 */

const W = 64;
const H = 14;
const X0 = 6;
const X1 = W - 6;
const TOP = 3;
const BOT = H - 3;
const SLANT = 4;

/**
 * The piece in plan, 64 × 14: a square end is a plain edge, a mitred end slants, a bevelled end
 * is dashed. Angled ends are drawn heavier in `--text-1`, never in the selection's amber.
 */
export function EndsPictogram({ a, b }: { a: EndCut; b: EndCut }) {
  const slant = (e: EndCut) => (e !== "square" && e.mitre_deg !== 0 ? SLANT : 0);
  const sa = slant(a);
  const sb = slant(b);
  const body = `${X0 + sa},${TOP} ${X1 - sb},${TOP} ${X1},${BOT} ${X0},${BOT}`;
  // Each end's edge: a slanted line for a mitre, a vertical one for the rest; heavy when angled.
  const edge = (e: EndCut, x: number, s: number, dir: 1 | -1) => {
    const angled = e !== "square";
    const bevel = e !== "square" && e.bevel_deg !== 0;
    const lean = s * dir;
    return (
      <line
        x1={x + lean}
        y1={TOP}
        x2={x}
        y2={BOT}
        class={angled ? "end heavy" : "end"}
        {...(bevel ? { "stroke-dasharray": "2 1.5" } : {})}
      />
    );
  };
  return (
    <svg
      class="ends-pictogram"
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`ends ${endText(a)} and ${endText(b)}`}
    >
      <polygon points={body} class="piece" />
      {edge(a, X0, sa, 1)}
      {edge(b, X1, sb, -1)}
    </svg>
  );
}

/** A number for a pill: `11` for 11.00, `8.5` for 8.5. */
const short = (x: number) => String(Number(x.toFixed(2)));

interface Pill {
  key: string;
  count: number;
  label: string;
  detail: string;
}

/**
 * A piece's machining as pills, one per kind of operation with its count: `4 × Ø11`, with where
 * in a second, dimmer part (`face −y, at 100 and 200 from a`). The whole sentence of each
 * operation is `machiningText`'s, in the row's details.
 */
export function pills(machining: readonly Machining[], rail: PieceRail | undefined): Pill[] {
  const out = new Map<string, Pill & { at: number[] }>();
  const add = (key: string, label: string, detail: string, at?: number) => {
    const p = out.get(key) ?? { key, count: 0, label, detail, at: [] };
    p.count += 1;
    if (at !== undefined) p.at.push(at);
    out.set(key, p);
  };
  if (rail) add("rail", "rail holes", `${rail.holes} at ${short(rail.pitch_mm)}`);
  for (const m of machining) {
    if (m.op === "hole") {
      const what = m.thread ? `tap ${m.thread}` : `Ø${m.d_mm === undefined ? "?" : short(m.d_mm)}`;
      const across = m.across_mm === undefined ? "" : `, ${short(m.across_mm)} across`;
      add(
        `hole|${what}|${m.face}|${m.from}|${across}`,
        what,
        `face ${m.face}${across}, from ${m.from}`,
        m.at_mm,
      );
    } else if (m.op === "end-tap") {
      add(`tap|${m.thread}|${m.from}`, `tap ${m.thread}`, `end ${m.from}`);
    } else {
      const what = m.thread ? `tap ${m.thread}` : `Ø${m.d_mm === undefined ? "?" : short(m.d_mm)}`;
      add(`endhole|${what}|${m.from}|${m.angle_deg ?? 0}`, `${what} end hole`, `end ${m.from}`);
    }
  }
  return [...out.values()].map(({ at, ...p }) => ({
    ...p,
    detail: at.length > 0 ? `${p.detail}, at ${at.map(short).join(" and ")}` : p.detail,
  }));
}

/** The pills of a piece, and the full sentences behind them in an opening `details`. */
export function MachiningCell({
  machining,
  rail,
}: {
  machining: readonly Machining[];
  rail: PieceRail | undefined;
}) {
  const list = pills(machining, rail);
  if (list.length === 0) return <span class="none">None</span>;
  const full = [...(rail ? [railText(rail)] : []), ...machining.map(machiningText)];
  return (
    <details class="mach">
      <summary>
        {list.map((p) => (
          <span class="pill" key={p.key}>
            <b>
              {p.count} × {p.label}
            </b>
            <span class="pill-d">{p.detail}</span>
          </span>
        ))}
      </summary>
      <ul class="mach-full">
        {full.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
    </details>
  );
}

/**
 * One stock bar to scale: each piece a segment in its item's colour (the kerf a gap, the trim at
 * the start) and the offcut hatched, with `used` and `offcut` beside it.
 */
export function StockDiagram({ g, bar }: { g: CutGroup; bar: StockBar }) {
  const L = bar.length_mm;
  const pct = (x: number) => `${(x / L) * 100}%`;
  const kerf = g.kerf_mm ?? 0;
  const sw = swatches.value.get(g.item);
  const colour = sw === undefined ? {} : { background: swatchCss(sw) };
  return (
    <div class="stock">
      <div class="stock-bar" role="img" aria-label={`stock bar ${mm(L, { table: true })} mm`}>
        {g.trim_mm ? <span class="trim" style={{ width: pct(g.trim_mm) }} /> : null}
        {bar.pieces.map((p) => (
          <span
            key={p.source}
            class="seg"
            style={{ width: pct((p.span_mm ?? p.cut_mm) + kerf) }}
            title={`${p.source}: ${mm(p.cut_mm)} mm`}
          >
            <span class="seg-fill" style={colour} />
            <span class="seg-label">{mm(p.cut_mm, { table: true })}</span>
          </span>
        ))}
        <span class="offcut" style={{ width: pct(bar.offcut_mm) }} />
      </div>
      <span class="stock-text">
        Stock {mm(L, { table: true })} mm, used {mm(bar.used_mm, { table: true })}, offcut{" "}
        {mm(bar.offcut_mm, { table: true })} mm
      </span>
    </div>
  );
}

/** The group's swatch and code, used by its head. */
export function GroupTitle({ g }: { g: Pick<CutGroup, "item" | "name"> }) {
  return (
    <>
      <ItemSwatch item={g.item} />
      <span class="figure">{g.item}</span>
      <span class="sub">{g.name}</span>
    </>
  );
}
