import { computed, signal } from "@preact/signals";
import type { CornerRule } from "#core/project/schema.ts";
import type { V3 } from "../../mesh/model.ts";
import { type Axis, type DrawEnd, type DrawPoint, nextRoll } from "../../viewer/draw.ts";
import type { Snap } from "../../viewer/snap.ts";
import { GROUND, type WorkPlane } from "../../viewer/workplane.ts";
import { turnedAnchor } from "../edit/roll.ts";
import { extendHook } from "../hook.ts";

/**
 * The tools of the viewport (design §8, Tools): draw bar, connect, place part, pattern, measure
 * and the box frame; select is no tool. Each turns pointer and key events into one batch of
 * commands (§7.1), sent with source `ui`; the next revision comes back on the event stream. What
 * a tool shows (its state, the hint by the pointer, its prompt, what is typed in the command
 * bar) lives in signals the command bar, the tool forms and the status bar read. The palette
 * they draw and place with is palette.ts's. Owner: S5.
 */

export const TOOLS = [
  "select",
  "move",
  "rotate",
  "draw",
  "connect",
  "place",
  "pattern",
  "measure",
  "frame",
] as const;
export type ToolName = (typeof TOOLS)[number];

/** Each tool's key (D-UX-18): the letter on its cap. */
export const TOOL_KEYS: Readonly<Record<string, ToolName>> = {
  v: "select",
  d: "move",
  q: "rotate",
  b: "draw",
  g: "frame",
  c: "connect",
  p: "place",
  x: "pattern",
  m: "measure",
};

/** Each tool's name, as the rail, the command bar and the help say it. */
export const TOOL_NAMES: Readonly<Record<ToolName, string>> = {
  select: "Select",
  move: "Move",
  rotate: "Rotate",
  draw: "Draw bar",
  frame: "Box frame",
  connect: "Connect",
  place: "Place part",
  pattern: "Pattern",
  measure: "Measure",
};

/** The key a tool's cap shows. */
export function toolKey(t: ToolName): string {
  return (Object.entries(TOOL_KEYS).find(([, x]) => x === t)?.[0] ?? "").toUpperCase();
}

export const activeTool = signal<ToolName>("select");

export interface DrawOptions {
  roll: number;
  anchor: string;
  autoConnect: boolean;
  /** An axis locked with the arrow keys (D-UX-18), until pressed again or the gesture ends. */
  lock?: Axis | undefined;
  /**
   * The corner rule for the joints at the bar's ends (D-UX-9), when the person chose one in the
   * command bar or flipped the previewed joint with Tab; the project's `defaults.corner` when
   * unset.
   */
  prefer?: CornerRule | undefined;
}

export const drawOptions = signal<DrawOptions>({
  roll: 0,
  anchor: "c",
  autoConnect: true,
});

/**
 * R, or the command bar's Roll: a quarter turn that keeps the bar drawn on its anchor's side of
 * the line, the anchor turned with it, as the inspector's Roll does
 * (docs/ux/polish-editing-ui-decisions.md 1).
 */
export function rollDrawn(): void {
  const o = drawOptions.value;
  drawOptions.value = { ...o, roll: nextRoll(o.roll), anchor: turnedAnchor(o.anchor, 1) };
}

/**
 * Pattern's "Draw the bar to repeat" (docs/ux/polish-editing-ui-decisions.md 4): the pattern the
 * next bar drawn is repeated by, in the same step; the draw tool drops it when it is left.
 */
export const drawRepeat = signal<
  { along: string; pitch_mm: number | string; count: number } | undefined
>(undefined);

/** The corner rules, in the order Tab flips through them. */
export const CORNER_RULES: readonly CornerRule[] = ["vertical", "x", "y", "first"];

/** A corner rule in words. */
export const CORNER_WORDS: Readonly<Record<CornerRule, string>> = {
  vertical: "the upright runs through",
  x: "the bar along X runs through",
  y: "the bar along Y runs through",
  first: "the first drawn runs through",
};

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
/**
 * What is typed in the command bar (D-UX-17): a length, a list (`1000, 600`), a point
 * (`[0, 0, H]`), each value an expression with params and units. Enter commits it.
 */
export const typed = signal("");

/**
 * Asks the command bar to put the keyboard in its field (each change does): a tool's gesture
 * key that starts a value (a digit, a sign, `(`, `[`, `=`) hands the rest of the typing to the
 * field, where letters belong to the value (units, params) and not to the shortcuts (U20).
 */
export const fieldWanted = signal(0);
/** Asks the command bar to give the keyboard back (each change does): after a commit. */
export const fieldDone = signal(0);

/**
 * The joint the drawn bar would make where an end closes on another bar (S5.6), from a dry run
 * of the gesture: the words by the end, and the rule it was asked with.
 */
export interface JointPreview {
  /** What the dry run was asked for: the gesture's commands, as JSON. */
  key: string;
  at: V3;
  text: string;
  /** The rule the preview was asked with; the project's own when undefined. */
  prefer?: CornerRule | undefined;
  /** What the arrangement does, to tell two rules that give the same one apart. */
  shape: string;
  /** The dry run's time, ms: for the decisions' note and the test hook. */
  ms: number;
  /** Whether a joint is made, so Tab has something to flip; undefined reads as yes. */
  joins?: boolean;
}
export const jointPreview = signal<JointPreview | undefined>(undefined);

/**
 * What the last thing a tool sent came to, for the result chip in the command bar (S5.6, A R10):
 * the step it made (its words come with the step's `rev` event), or why it was refused or could
 * not be sent, shown where it happened (U30).
 */
export const lastResult = signal<
  | {
      rev: number;
      created: readonly string[];
      error?: string | undefined;
      /** The refusal is "which way?": it holds only until a way is known (review N2). */
      wayNeeded?: true;
    }
  | undefined
>(undefined);

/**
 * A drag gesture on (drag.ts; docs/ux/drag-ends-decisions.md): an end handle dragged, or the
 * selection moved, copied (`duplicate`: Duplicate and Paste), turned, mirrored or aligned
 * (docs/ux/e3-decisions.md). The command bar shows it whatever the tool, with its value field;
 * the selected bar's label reads `reading` while an end is dragged.
 */
export interface Gesture {
  kind: "end" | "move" | "duplicate" | "rotate" | "mirror" | "align";
  /** The command bar's title: "Drag end b3.b". */
  title: string;
  /** What it asks: drag, or type, and Enter. */
  prompt: string;
  /** What it comes to now: "cut 580 mm · length 600". */
  reading: string;
  /** The machine label of where it is: `on b1`, `at b2.a`, `touches b7`, `free`, `typed`. */
  snap: string;
  /** An end drag's bar and end. */
  bar?: string;
  end?: "a" | "b";
}
export const gesture = signal<Gesture | undefined>(undefined);

/**
 * The selected bar's length label being typed into (docs/ux/drag-ends-decisions.md): its bar and
 * the end the typed length moves, which the handles draw larger.
 */
export const labelEdit = signal<{ bar: string; end: "a" | "b" } | undefined>(undefined);

/** Mirror's option (E-UX-8): remove what is mirrored in the same step. The command bar's box. */
export const mirrorOptions = signal<{ remove: boolean }>({ remove: false });

/** The draw tool's gesture, for the panel and the test hook. */
export const drawState = signal<{ start?: DrawPoint; end?: DrawEnd }>({});

/**
 * Whether a length typed in Draw has a way to go: an axis is locked, or the pointer has left the
 * start (review M2, N2). Without one Enter refuses with "Which way?", and that refusal is stale
 * the moment this turns true.
 */
export function wayKnown(
  start: DrawPoint,
  end: DrawEnd | undefined,
  lock: Axis | undefined,
): boolean {
  if (lock) return true;
  return end !== undefined && end.p.some((c, i) => Math.abs(c - (start.p[i] ?? 0)) > 1e-6);
}

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

/**
 * The place tool (D-UX-16): a click commits at the station under the pointer. A distance typed
 * first sets where along the bar, from the end nearer the pointer; `roll` is the command bar's.
 */
export type PlaceStation = FaceStation;
export const placeState = signal<{ station?: PlaceStation; roll: number }>({ roll: 0 });

export const patternState = signal<{
  template: string[];
  along?: string;
  pitch: string;
  count: string;
}>({ template: [], pitch: "150", count: "3" });

export const measureState = signal<{ a?: Snap; b?: Snap }>({});

/** The box frame's "Joined with" when the person joins the corners themselves (review B1). */
export const JOIN_NONE = "-";

/** The box frame's options (D-UX-8, BE-6): its form holds them (review M6). */
export interface FrameOptions {
  rings: { base: boolean; top: boolean };
  /** A shelf ring, its top face this high above the base: typed, empty for none. */
  shelf: string;
  /** Which bar runs through at each corner; the project's `defaults.corner` when unset. */
  corner?: CornerRule | undefined;
  /**
   * How the corners are joined (docs/ux/review-phase4.md B1): a connector's id; `JOIN_NONE`,
   * nothing, said so; or empty, not chosen yet, which is the project's default butt connector
   * when it has one and must be chosen when it has none.
   */
  joint: string;
  /** Connectors per butting end, typed: empty for one. */
  qty: string;
  /** Write W, D and H as params, and the frame's points from them. */
  params: boolean;
}
export const frameOptions = signal<FrameOptions>({
  rings: { base: true, top: true },
  shelf: "",
  joint: "",
  qty: "",
  params: false,
});

/**
 * The box frame being made (S5.7): its corner, then W and D, then H, each from a click or typed
 * (`1000, 600` Enter, then `800` Enter). The form edits the same draft.
 */
export interface FrameDraft {
  /** The corner with the least x, y and z. */
  at?: V3 | undefined;
  /** The footprint and the height, as typed (expressions allowed). */
  w: string;
  d: string;
  h: string;
}
export const frameDraft = signal<FrameDraft>({ w: "", d: "", h: "" });

/**
 * The box frame panel's dry run in a line ("posts 4 × 800 · top ring 2 × 1000, 2 × 520"), which
 * the command bar shows while the frame is drawn (review m9); undefined while there is none.
 */
export const frameNumbers = signal<string | undefined>(undefined);

/** Which value the box frame's gesture asks for next. */
export function frameStage(d: FrameDraft): "corner" | "size" | "height" | "done" {
  if (!d.at) return "corner";
  if (d.w.trim() === "" || d.d.trim() === "") return "size";
  if (d.h.trim() === "") return "height";
  return "done";
}

/**
 * What the active tool asks the person to do next, in words: the command bar and the status bar
 * (S2.7) show it. Empty when the tool asks nothing (select).
 */
export const toolPrompt = computed<string>(() => {
  switch (activeTool.value) {
    case "draw": {
      const { start } = drawState.value;
      if (!start) return "Click a start point, or type [x, y, z].";
      // Short on purpose (review N3): it shares one row with the value and what it comes to. The
      // start and the end under the pointer are in the view's label by the pointer.
      return "Click the end, or type a length.";
    }
    case "frame":
      switch (frameStage(frameDraft.value)) {
        case "corner":
          return "Click the frame's corner, or type [x, y, z].";
        case "size":
          return "Click the far corner, or type W, D.";
        default:
          return "Click the height, or type H.";
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
      return "Click a face or a groove of a bar to place the part there; type a distance first to set it from the nearer end.";
    case "pattern":
      return "Click the bar to repeat along (or type a bar or run).";
    case "measure":
      return measureState.value.a && !measureState.value.b
        ? "Click the second point."
        : "Click a point to measure from.";
    case "move":
      return "Drag the selection or a bar, or click a base point and then where it goes; type x, y, z to move by that. Alt frees what joins it.";
    case "rotate":
      return "Click the centre, or Enter for the selection's centre; then type the angle, or drag a ring. X, Y or Z for the axis.";
    default:
      return "";
  }
});

declare module "../hook.ts" {
  interface AlukitHook {
    /**
     * The active tool, its draw options, the gesture's points, the text by the pointer and the
     * machine label of what the pointer is on (`hint`'s `snap`); what is typed in the command
     * bar, the locked axis, the previewed joint's words and the box frame's next value.
     */
    tool(): {
      name: string;
      anchor: string;
      roll: number;
      start?: string;
      end?: string;
      hint?: string;
      snap?: string;
      typed?: string;
      lock?: string;
      prefer?: string;
      joint?: string;
      /** The joint preview's dry run, ms. */
      jointMs?: number;
      stage?: string;
    };
  }
}

extendHook({
  tool: () => {
    const { start, end } = drawState.value;
    const h = hint.value;
    const o = drawOptions.value;
    const j = jointPreview.value;
    return {
      name: activeTool.value,
      anchor: o.anchor,
      roll: o.roll,
      ...(start ? { start: start.label } : {}),
      ...(end ? { end: end.label } : {}),
      ...(h ? { hint: h.text } : {}),
      ...(h?.snap !== undefined ? { snap: h.snap } : {}),
      ...(typed.value ? { typed: typed.value } : {}),
      ...(o.lock ? { lock: o.lock } : {}),
      ...(o.prefer ? { prefer: o.prefer } : {}),
      ...(j ? { joint: j.text, jointMs: j.ms } : {}),
      ...(activeTool.value === "frame" ? { stage: frameStage(frameDraft.value) } : {}),
    };
  },
});
