import type { V3 } from "../../../mesh/model.ts";
import type { ToolHandler, ToolPointer } from "../../../viewer/scene.ts";
import type { SnapTargets } from "../../../viewer/snap.ts";
import type { Model } from "../../model.ts";
import { model } from "../../store.ts";
import { pickRefusal, runOf } from "../commands.ts";
import {
  activeTool,
  type ConnectPick,
  connectPicks,
  connectType,
  hint,
  pivotOptions,
} from "../state.ts";
import { markerOf, type Wire, type WireContext } from "./common.ts";

/**
 * Connect, `C` (design §8, Tools): clicks pick the bars, ends or plates a connection joins (a
 * pivot's base is a station picked on a face); the tool's form in the right column says what is
 * picked and sends the connection. Owner: E5.
 */

/** A connection's text for what a pick would be: the bar, or its end nearer the pointer. */
function barPick(m: Model, id: string, p: V3): ConnectPick | undefined {
  const bar = m.derived.bars[id];
  if (!bar || id.includes("@")) return undefined;
  const t = bar.frame.z;
  const s = (p[0] - bar.a[0]) * t[0] + (p[1] - bar.a[1]) * t[1] + (p[2] - bar.a[2]) * t[2];
  const L = bar.len_mm;
  // The outer quarters pick an end, the middle half the bar itself.
  if (s < L / 4) return { ref: `${id}.a`, kind: "end", p: bar.a };
  if (s > (3 * L) / 4) return { ref: `${id}.b`, kind: "end", p: bar.b };
  return { ref: id, kind: "bar", p };
}

/** A pivot's base is a station on a face, not in a groove (§4.5): only those snap. */
const onFaceOnly = (t: SnapTargets): SnapTargets => ({
  points: t.points.filter((p) => p.ref.kind === "station" && p.ref.face !== undefined),
  lines: t.lines.filter((l) => l.face !== undefined && l.groove === undefined),
});

export function createConnectTool(ctx: WireContext): Wire {
  const { viewer, show, snapAt } = ctx;

  /** Whether the next click picks the pivot's base: a pivot with no base yet. */
  const pickingBase = () => connectType.value === "pivot" && !pivotOptions.value.base;

  /** What a click on the body under the pointer picks: a bar or its end; a plate as a layer. */
  function connectPickAt(e: ToolPointer): ConnectPick | undefined {
    const m = model.value;
    const hit = ctx.pickAt(e);
    if (!m || !hit) return undefined;
    if (m.derived.bars[hit.id]) return barPick(m, hit.id, hit.p);
    // A part holding a plate is a face connection's layer (§4.5); a copy is not an entity.
    if (connectType.value === "face" && m.derived.parts[hit.id] && !hit.id.includes("@"))
      return { ref: hit.id, kind: "part", p: hit.p };
    return undefined;
  }

  const pins = () => [
    ...connectPicks.value.filter((p) => p.kind === "end").map((p) => p.p),
    ...(connectType.value === "pivot" && pivotOptions.value.base
      ? [pivotOptions.value.base.p]
      : []),
  ];

  const handler: ToolHandler = {
    move(e) {
      ctx.track(e);
      if (pickingBase()) {
        const snap = snapAt(e, onFaceOnly);
        viewer.setOverlay({
          pins: pins(),
          marker: snap ? { p: snap.p, kind: markerOf(snap) } : undefined,
        });
        show(
          e,
          snap ? `base: ${snap.tip ?? snap.label}` : "click a face for the pivot's base",
          snap?.label,
        );
        return;
      }
      const pick = connectPickAt(e);
      const refused = pick ? pickRefusal(connectType.value, connectPicks.value, pick) : undefined;
      viewer.setOverlay({
        pins: pins(),
        marker: pick && !refused ? { p: pick.p, kind: "pick" } : undefined,
      });
      const picked = pick ? `${pick.kind} ${pick.ref}` : undefined;
      show(e, picked && refused ? `${picked}: ${refused}` : picked, picked);
    },
    click(e) {
      if (pickingBase()) {
        const snap = snapAt(e, onFaceOnly);
        if (snap?.ref.kind !== "station" || snap.ref.face === undefined) return;
        const r = snap.ref;
        pivotOptions.value = {
          ...pivotOptions.value,
          from: "a",
          base: { bar: r.bar, at_mm: r.at_mm, face: r.face, p: snap.p },
        };
        handler.move?.(e);
        return;
      }
      const pick = connectPickAt(e);
      if (!pick) return;
      const cur = connectPicks.value;
      // A pick the connection cannot take is left out; the tip by the pointer says why.
      if (pickRefusal(connectType.value, cur, pick)) return;
      connectPicks.value = cur.some((p) => p.ref === pick.ref)
        ? cur.filter((p) => p.ref !== pick.ref)
        : [...cur, pick];
      handler.move?.(e);
    },
    leave() {
      hint.value = undefined;
    },
  };

  const offPicks = connectPicks.subscribe((picks) => {
    const m = model.value;
    // A run's layer lights its pieces; a part its body.
    const lit = picks.flatMap((p) =>
      p.kind === "end"
        ? []
        : p.kind === "run" && m
          ? Object.keys(m.derived.bars).filter((b) => runOf(m.doc, b) === p.ref)
          : [p.ref],
    );
    viewer.setHighlight(new Set(lit));
    if (activeTool.value === "connect") viewer.setOverlay({ pins: pins() });
  });
  const offPivot = pivotOptions.subscribe(() => {
    if (activeTool.value === "connect") viewer.setOverlay({ pins: pins() });
  });

  return {
    handler,
    /** Esc in Connect, one level: the last pick, then the pivot's base. */
    back() {
      const picks = connectPicks.value;
      if (picks.length > 0) {
        connectPicks.value = picks.slice(0, -1);
        return true;
      }
      if (pivotOptions.value.base) {
        pivotOptions.value = { ...pivotOptions.value, base: undefined };
        return true;
      }
      return false;
    },
    switched(next) {
      if (next !== "connect") {
        connectPicks.value = [];
        if (pivotOptions.value.base)
          pivotOptions.value = { ...pivotOptions.value, base: undefined };
      }
    },
    dispose() {
      offPicks();
      offPivot();
    },
  };
}
