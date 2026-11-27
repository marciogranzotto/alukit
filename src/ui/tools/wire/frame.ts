import { len } from "#core/commands/numbers.ts";
import type { V3 } from "../../../mesh/model.ts";
import { AXES } from "../../../viewer/draw.ts";
import type { ToolHandler, ToolPointer } from "../../../viewer/scene.ts";
import { q, rayLineParams, type Snap } from "../../../viewer/snap.ts";
import { GROUND, gridSnap, onGrid, rayPlane, through } from "../../../viewer/workplane.ts";
import { palette } from "../../palette.ts";
import { model, sendCommands } from "../../store.ts";
import { frameBatch } from "../commands.ts";
import { activeTool, frameDraft, frameOptions, frameStage, hint, workPlane } from "../state.ts";
import { parseTyped } from "../typed.ts";
import { fmt, markerOf, noteResult, refuse, type Wire, type WireContext } from "./common.ts";

/**
 * Box frame, `G` (S5.7): a corner, then the footprint (W and D), then the height, each clicked
 * or typed in the command bar; the step is the frame's `addFrame`, after the project's defaults
 * the form chose. Owner: E3.
 */
export function createFrameTool(ctx: WireContext): Wire {
  const { viewer, show, refresh, used, typedNow, snapAt, rayAt, params } = ctx;

  /** The snap under the pointer, while the frame asks for its corner. */
  let current: Snap | undefined;
  /** The footprint or height under the pointer, while the frame asks for one. */
  let framePointer: { w?: number; d?: number; h?: number } = {};

  function framePreview(e: ToolPointer | undefined): void {
    const d = frameDraft.value;
    const stage = frameStage(d);
    const at = d.at;
    if (stage === "corner" || !at) {
      viewer.setOverlay({
        marker: current ? { p: current.p, kind: markerOf(current) } : undefined,
      });
      viewer.setLabel("frame", undefined);
      show(e, current ? `corner: ${current.label}` : undefined, current?.label);
      return;
    }
    const t = typedNow();
    if (stage === "size") {
      const list = t.kind === "list" && t.items.length === 2 ? t.items : undefined;
      const w = list ? list[0]?.value : framePointer.w;
      const dd = list ? list[1]?.value : framePointer.d;
      const far: V3 | undefined =
        w !== undefined && dd !== undefined ? [at[0] + w, at[1] + dd, at[2]] : undefined;
      viewer.setOverlay({
        pins: [at],
        line: far ? { a: at, b: far } : undefined,
        marker: far ? { p: far, kind: "free" } : undefined,
      });
      viewer.setLabel(
        "frame",
        far,
        far ? `W ${fmt(Math.abs(w as number))} × D ${fmt(Math.abs(dd as number))}` : undefined,
      );
      show(
        e,
        far ? `${fmt(Math.abs(w as number))} × ${fmt(Math.abs(dd as number))} mm` : undefined,
        far ? `size ${fmt(w as number)}, ${fmt(dd as number)}` : undefined,
      );
      return;
    }
    const W = parseTyped(d.w, params());
    const D = parseTyped(d.d, params());
    const wv = W.kind === "value" ? W.value : 0;
    const dv = D.kind === "value" ? D.value : 0;
    const h = t.kind === "value" ? t.value : framePointer.h;
    const corner: V3 = [at[0] + wv, at[1] + dv, at[2]];
    const top: V3 | undefined = h !== undefined ? [corner[0], corner[1], at[2] + h] : undefined;
    viewer.setOverlay({
      pins: [at, corner],
      line: top ? { a: corner, b: top } : undefined,
      guide: { through: corner, axis: "z" },
      marker: top ? { p: top, kind: "free" } : undefined,
    });
    viewer.setLabel("frame", top, top ? `H ${fmt(h as number)}` : undefined);
    show(
      e,
      top ? `H ${fmt(h as number)} mm` : undefined,
      top ? `height ${fmt(h as number)}` : undefined,
    );
  }

  /**
   * Sends the frame when the draft is whole: one step, its `addFrame` after the default butt
   * connector the form's Joined with chose (review B1); while none is chosen, it says so.
   */
  async function commitFrame(): Promise<void> {
    const m = model.peek();
    const butt = m?.defaults.butt as { connector?: unknown } | undefined;
    const c = frameBatch(
      frameDraft.peek(),
      frameOptions.peek(),
      palette.peek().bar,
      {
        hasDefaultBar:
          typeof (m?.defaults.bar as { item?: unknown } | undefined)?.item === "string",
        defaultButt: typeof butt?.connector === "string" ? butt.connector : undefined,
      },
      params(),
    );
    if ("why" in c) {
      refuse(c.why);
      return;
    }
    const o = await sendCommands(c.commands, "box frame", { inline: true });
    noteResult(o);
    if (o.ok) {
      frameDraft.value = { w: "", d: "", h: "" };
      framePointer = {};
      viewer.setOverlay({});
      viewer.setLabel("frame", undefined);
    }
  }

  const handler: ToolHandler = {
    move(e) {
      ctx.track(e);
      const d = frameDraft.value;
      const stage = frameStage(d);
      const at = d.at;
      if (stage === "corner" || !at) current = snapAt(e) ?? gridSnap(rayAt(e), workPlane.value);
      else if (stage === "size") {
        const plane = through(GROUND, at);
        const hit = rayPlane(rayAt(e), plane);
        const p = hit ? onGrid(plane, hit) : undefined;
        framePointer = p ? { w: q(p[0] - at[0]), d: q(p[1] - at[1]) } : {};
      } else {
        const W = parseTyped(d.w, params());
        const D = parseTyped(d.d, params());
        const corner: V3 = [
          at[0] + (W.kind === "value" ? W.value : 0),
          at[1] + (D.kind === "value" ? D.value : 0),
          at[2],
        ];
        const s = Math.round(rayLineParams(rayAt(e), corner, AXES.z).s / 10) * 10;
        framePointer = s > 0 ? { h: s } : {};
      }
      framePreview(e);
    },
    click(e) {
      handler.move?.(e);
      const d = frameDraft.value;
      const stage = frameStage(d);
      if (stage === "corner") {
        if (!current) return;
        frameDraft.value = { ...d, at: current.p.map((x) => len(x)) as unknown as V3 };
      } else if (stage === "size" && d.at) {
        const { w, d: dd } = framePointer;
        if (!w || !dd) return;
        // A far corner below or left of the first: the frame's corner is the least of the two.
        frameDraft.value = {
          ...d,
          at: [Math.min(d.at[0], d.at[0] + w), Math.min(d.at[1], d.at[1] + dd), d.at[2]].map((x) =>
            len(x),
          ) as unknown as V3,
          w: String(Math.abs(w)),
          d: String(Math.abs(dd)),
        };
      } else if (stage === "height") {
        if (!framePointer.h) return;
        frameDraft.value = { ...d, h: String(framePointer.h) };
        void commitFrame();
        return;
      }
      framePreview(e);
    },
    leave() {
      hint.value = undefined;
    },
  };

  /** Enter in Box frame: the typed corner, W and D, or H; the frame when it is whole. */
  function enter(): boolean {
    const d = frameDraft.peek();
    const stage = frameStage(d);
    const t = typedNow();
    const fail = (why: string) => {
      refuse(why);
      return true;
    };
    if (t.kind === "error") return fail(t.why);
    if (stage === "corner") {
      if (t.kind !== "point")
        return t.kind === "empty" ? false : fail("type the corner as [x, y, z]");
      frameDraft.value = { ...d, at: t.items.map((x) => len(x.value)) as unknown as V3 };
    } else if (stage === "size") {
      const [w, dd] = t.kind === "list" && t.items.length === 2 ? t.items : [];
      if (!w || !dd) return t.kind === "empty" ? false : fail("type the width and the depth: W, D");
      frameDraft.value = { ...d, w: String(w.written), d: String(dd.written) };
    } else if (stage === "height") {
      if (t.kind !== "value") return t.kind === "empty" ? false : fail("type the height H");
      frameDraft.value = { ...d, h: String(t.written) };
    }
    used();
    if (frameStage(frameDraft.peek()) === "done") void commitFrame();
    else refresh();
    return true;
  }

  /** Esc in Box frame, one level: the height, then the size, then the corner. */
  function back(): boolean {
    const d = frameDraft.value;
    const stage = frameStage(d);
    if (stage === "height") frameDraft.value = { ...d, w: "", d: "" };
    else if (stage === "size") frameDraft.value = { ...d, at: undefined };
    else return false;
    refresh();
    return true;
  }

  const offFrame = frameDraft.subscribe(() => {
    if (activeTool.peek() === "frame") framePreview(ctx.pointer());
  });

  return {
    handler,
    preview: () => framePreview(undefined),
    back,
    enter,
    takesValue: (ch) =>
      frameStage(frameDraft.peek()) === "corner" ? ch === "[" || ch === "=" : ch !== "[",
    reset() {
      current = undefined;
      framePointer = {};
    },
    switched(next) {
      if (next !== "frame") frameDraft.value = { w: "", d: "", h: "" };
    },
    dispose() {
      offFrame();
    },
  };
}
