import type { ToolHandler, ToolPointer } from "../../../viewer/scene.ts";
import type { Snap, SnapTargets } from "../../../viewer/snap.ts";
import { palette } from "../../palette.ts";
import { model, sendCommands } from "../../store.ts";
import { placeCommand, placeFrom } from "../commands.ts";
import { hint, placeState, typed } from "../state.ts";
import { typedWords } from "../typed.ts";
import { markerOf, noteResult, refuse, type Wire, type WireContext } from "./common.ts";

/**
 * Place part, `P` (D-UX-16): the armed part lands on the face or groove station under the
 * pointer, or at a distance typed from the nearer end, on the click or Enter, one step. Owner: E5.
 */

/** A part lands on a face or a groove (§4.7): only those stations snap. */
const onFaces = (t: SnapTargets): SnapTargets => ({
  points: t.points.filter((p) => p.ref.kind === "station" && p.ref.face !== undefined),
  lines: t.lines.filter((l) => l.face !== undefined || l.groove !== undefined),
});

type Station = NonNullable<typeof placeState.value.station>;

export function createPlaceTool(ctx: WireContext): Wire {
  const { viewer, show, used, typedNow, snapAt } = ctx;

  /** The station under the pointer, or why a click there places nothing. */
  function placeAt(
    e: ToolPointer,
  ): { snap: Snap; st: Station } | { why: string; snap?: Snap } | undefined {
    const snap = snapAt(e, onFaces);
    if (snap?.ref.kind !== "station") return undefined;
    const r = snap.ref;
    // A pattern copy is derived from its template: it takes no parts of its own (U37).
    if (r.bar.includes("@")) {
      return { why: `copies take no parts: use ${r.bar.split("@")[0]}, the template`, snap };
    }
    return {
      snap,
      st: {
        bar: r.bar,
        at_mm: r.at_mm,
        ...(r.groove ? { groove: r.groove } : r.face ? { face: r.face } : {}),
        p: snap.p,
      },
    };
  }

  /** Where the part would go: the station's distance, or the typed one from the nearer end. */
  function placeWhere(
    st: Station,
  ): { from: "a" | "b"; at: number | string; words?: string } | { why: string } {
    const t = typedNow();
    if (t.kind === "empty") return { from: "a", at: st.at_mm };
    if (t.kind !== "value") return { why: t.kind === "error" ? t.why : "type one distance" };
    const bar = model.peek()?.derived.bars[st.bar];
    const from = bar ? placeFrom(st, bar.len_mm) : "a";
    return { from, at: t.written, words: `${typedWords(t)} from end ${from} of ${st.bar}` };
  }

  async function commitPlace(st: Station): Promise<void> {
    const part = palette.peek().part;
    if (!part) {
      refuse("no part armed: arm one in the parts bin or the catalog");
      return;
    }
    const w = placeWhere(st);
    if ("why" in w) {
      refuse(w.why);
      return;
    }
    used();
    const o = await sendCommands(
      [placeCommand(part, st, w.from, placeState.peek().roll, w.at)],
      "place part",
      { inline: true },
    );
    noteResult(o);
  }

  const handler: ToolHandler = {
    move(e) {
      ctx.track(e);
      const at = placeAt(e);
      if (!at || "why" in at) {
        placeState.value = { ...placeState.value, station: undefined };
        viewer.setOverlay({});
        show(e, at?.why, at?.snap?.label);
        return;
      }
      placeState.value = { ...placeState.value, station: at.st };
      viewer.setOverlay({ marker: { p: at.snap.p, kind: markerOf(at.snap) } });
      const w = placeWhere(at.st);
      show(
        e,
        "why" in w
          ? `${at.snap.label} · ${w.why}`
          : w.words
            ? `${at.snap.label} · ${w.words}`
            : at.snap.label,
        at.snap.label,
      );
    },
    click(e) {
      const at = placeAt(e);
      if (!at || "why" in at) return;
      void commitPlace(at.st);
    },
    leave() {
      hint.value = undefined;
      placeState.value = { ...placeState.value, station: undefined };
    },
  };

  return {
    handler,
    /** Enter in Place: the part at the station under the pointer, or at the typed distance. */
    enter() {
      const st = placeState.peek().station;
      if (!st) {
        if (typed.peek()) refuse("point at a face of a bar, then press Enter");
        return typed.peek() !== "";
      }
      void commitPlace(st);
      return true;
    },
    takesValue: (ch) => ch !== "[",
    switched(next) {
      if (next !== "place") placeState.value = { ...placeState.value, station: undefined };
    },
  };
}
