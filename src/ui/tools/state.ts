import { computed, signal } from "@preact/signals";
import type { V3 } from "../../mesh/model.ts";
import type { DrawEnd, DrawPoint } from "../../viewer/draw.ts";
import type { Snap } from "../../viewer/snap.ts";
import { GROUND, type WorkPlane } from "../../viewer/workplane.ts";
import { extendHook } from "../hook.ts";

/**
 * The tools of the viewport (design §8, Tools): draw bar, connect, place part, pattern and
 * measure; select is no tool. Each turns pointer and key events into one batch of commands
 * (§7.1), sent with source `ui`; the next revision comes back on the event stream. What a tool
 * shows (its state, the hint by the pointer, its prompt) lives in signals the panels read. The
 * palette they draw and place with is palette.ts's.
 */

export const TOOLS = ["select", "draw", "connect", "place", "pattern", "measure"] as const;
export type ToolName = (typeof TOOLS)[number];

export const TOOL_KEYS: Readonly<Record<string, ToolName>> = {
  v: "select",
  b: "draw",
  c: "connect",
  p: "place",
  m: "measure",
};

export const activeTool = signal<ToolName>("select");

export const drawOptions = signal<{ roll: number; anchor: string; autoConnect: boolean }>({
  roll: 0,
  anchor: "c",
  autoConnect: true,
});

/** The work plane (§8): the ground, or a face picked with W. */
export const workPlane = signal<WorkPlane>(GROUND);
/** Waiting for a click on a face to set the work plane. */
export const pickingPlane = signal(false);

/**
 * The text by the pointer: what it snaps to, the length, what is typed. `snap` is the machine
 * label of what the pointer is on, as the active tool resolves it, which the text words for the
 * person and may change; tests and agents read `snap` (`__alukit.tool().snap`):
 *
 * - draw: the point or end under the pointer: `grid (0, 0, 0)`, `end b1.b`, `on b1 at 100`,
 *   `b9 +y face centre`, `+z 450` (along an axis from the start), `typed 900`, `free in …`;
 * - connect: the pick a click makes, `bar b5`, `end b1.b`, `part p6`; a pivot's base station;
 * - place and measure: the station or point, `b9 +y face at 300`, `p8 origin`;
 * - pattern: the bar to repeat along, `bar b9`.
 */
export const hint = signal<{ x: number; y: number; text: string; snap?: string } | undefined>(
  undefined,
);
/** A length being typed (§8: type a length and press Enter). */
export const typed = signal("");

/** The draw tool's gesture, for the panel and the test hook. */
export const drawState = signal<{ start?: DrawPoint; end?: DrawEnd }>({});

export type ConnectType = "butt" | "miter" | "splice" | "pivot" | "face";
export interface ConnectPick {
  /**
   * A bar (`b5`), a bar end (`b1.b`), or, as a face connection's layer, a part holding a plate
   * (`p6`) or the run a picked bar belongs to (`r1`).
   */
  ref: string;
  kind: "bar" | "end" | "part" | "run";
  p: V3;
}
export const connectPicks = signal<ConnectPick[]>([]);
export const connectType = signal<ConnectType>("butt");

/** A face station, as the place tool and a pivot's base take one (§4.3). */
export interface FaceStation {
  bar: string;
  at_mm: number;
  face?: string;
  groove?: string;
  p: V3;
}

/** A pivot's own fields (§4.5): its base station, the hinge axis and its connector. */
export interface PivotOptions {
  base?: FaceStation;
  /** The end of the base bar `at_mm` is counted from. */
  from: "a" | "b";
  axis: "along" | "across";
  connector: string;
}
export const pivotOptions = signal<PivotOptions>({ from: "a", axis: "across", connector: "" });

/**
 * A face connection's own fields (§4.5), as typed: the fastening; the fastener, an item or a
 * rod cut from bar stock to a length; the stack; the stations, at distances along the first
 * layer (and across it) or at its rail's holes; the gaps between layers; a screw's tap depth.
 * Lists are comma-separated numbers or expressions.
 */
export interface FaceOptions {
  fastening: "none" | "bolt" | "tnut" | "screw" | "blind";
  fastener: string;
  /** The fastener is a rod cut from `fastener`'s bar stock, `rodLen` long. */
  rod: boolean;
  rodLen: string;
  stack: string;
  at: string;
  across: string;
  railHoles: boolean;
  gaps: string;
  tapDepth: string;
}
export const faceOptions = signal<FaceOptions>({
  fastening: "none",
  fastener: "",
  rod: false,
  rodLen: "",
  stack: "",
  at: "",
  across: "",
  railHoles: false,
  gaps: "",
  tapDepth: "",
});

export type PlaceStation = FaceStation;
export const placeState = signal<{ station?: PlaceStation; from: "a" | "b"; roll: number }>({
  from: "a",
  roll: 0,
});

export const patternState = signal<{
  template: string[];
  along?: string;
  pitch: string;
  count: string;
}>({ template: [], pitch: "150", count: "3" });

export const measureState = signal<{ a?: Snap; b?: Snap }>({});

/**
 * What the active tool asks the person to do next, in words: the tool panels show it today, the
 * status bar (S2.7) will. Empty when the tool asks nothing (select, measure).
 */
export const toolPrompt = computed<string>(() => {
  switch (activeTool.value) {
    case "draw": {
      const { start, end } = drawState.value;
      if (!start) return "click a start point";
      return `from ${start.label}${end ? ` to ${end.label}` : ""}${typed.value ? ` · length ${typed.value}` : ""}`;
    }
    case "connect":
      return `${
        connectType.value === "pivot"
          ? "Click a face for the base, then near each end the pivot carries."
          : connectType.value === "face"
            ? "Click the layers in order, head to nut: bars along their middle, or plates."
            : "Click a bar near an end to pick that end, along its middle to pick the bar."
      } Click again to drop a pick.`;
    case "place":
      return "Click a face or a groove of a bar; then set the distance from an end.";
    case "pattern":
      return "Click the bar to repeat along (or type a bar or run).";
    default:
      return "";
  }
});

declare module "../hook.ts" {
  interface AlukitHook {
    /**
     * The active tool, its draw options, the gesture's points, the text by the pointer and the
     * machine label of what the pointer is on (`hint`'s `snap`).
     */
    tool(): {
      name: string;
      anchor: string;
      roll: number;
      start?: string;
      end?: string;
      hint?: string;
      snap?: string;
    };
  }
}

extendHook({
  tool: () => {
    const { start, end } = drawState.value;
    const h = hint.value;
    return {
      name: activeTool.value,
      anchor: drawOptions.value.anchor,
      roll: drawOptions.value.roll,
      ...(start ? { start: start.label } : {}),
      ...(end ? { end: end.label } : {}),
      ...(h ? { hint: h.text } : {}),
      ...(h?.snap !== undefined ? { snap: h.snap } : {}),
    };
  },
});
