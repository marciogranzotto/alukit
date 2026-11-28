import { effect, signal } from "@preact/signals";
import type { V3 } from "../../../mesh/model.ts";
import type { ToolHandler } from "../../../viewer/scene.ts";
import { type DryRun, dryRun } from "../../client/dryrun.ts";
import { ghostsOf, translation } from "../../edit/geometry.ts";
import { selection } from "../../focus.ts";
import { extendHook } from "../../hook.ts";
import type { Model } from "../../model.ts";
import { model } from "../../store.ts";
import { patternCommand } from "../commands.ts";
import type { ShownAnswer } from "../preview.ts";
import { activeTool, hint, patternState } from "../state.ts";
import { typedNumber } from "../typed.ts";
import type { Wire, WireContext } from "./common.ts";

/**
 * Pattern, `X`: the selection is the template, a click picks the bar to repeat along; the tool's
 * form in the right column takes the pitch and count and sends the pattern. While the form holds a
 * pattern it can make, the copies are drawn as ghosts and the pattern is dry-run, its reading by
 * Create (review m8: nothing previewed before Create), as Duplicate's `4x` shows its copies.
 * Owner: E5.
 */

/** The ghost bars Pattern draws now: its copies of the template's bars (the hook's `patternGhosts`). */
let ghostsDrawn = 0;

declare module "../../hook.ts" {
  interface AlukitHook {
    /** The ghost bars the Pattern tool draws for its copies (review m8). */
    patternGhosts(): number;
  }
}
extendHook({ patternGhosts: () => (activeTool.peek() === "pattern" ? ghostsDrawn : 0) });

/**
 * What Create would make, in words, and how many copies the view draws: by the form. `shown` is
 * the answer as the commit gate reads it (`refusalOf`, re-check N4): the command it dry-ran, at
 * which revision, and the core's refusal, so Create is not offered for a step the core refuses.
 */
export const patternPreview = signal<
  { text: string; error: boolean; ghosts: number; shown?: ShownAnswer } | undefined
>(undefined);

/** The unit direction a pattern repeats along: its bar's, a to b, or a run's first bar's. */
function alongDir(m: Model, along: string): V3 | undefined {
  const id = along.startsWith("r") ? m.derived.runs[along]?.bars[0] : along;
  const b = id ? m.derived.bars[id] : undefined;
  if (!b) return undefined;
  const d: V3 = [b.b[0] - b.a[0], b.b[1] - b.a[1], b.b[2] - b.a[2]];
  const n = Math.hypot(d[0], d[1], d[2]);
  return n > 0 ? [d[0] / n, d[1] / n, d[2] / n] : undefined;
}

/**
 * A pattern's dry run in words, as Create would make it: the copies and what they add, the cuts
 * that move and the problems it would raise; or the refusal, in the core's words.
 */
export function patternWords(r: DryRun, count: number): { text: string; error: boolean } {
  if (!r.ok) return { text: r.errors[0]?.message ?? r.why, error: true };
  const bars = Object.keys(r.effects.added).length;
  const parts = Object.keys(r.effects.parts).length;
  const adds = [
    ...(bars > 0 ? [`${bars} bar${bars === 1 ? "" : "s"}`] : []),
    ...(parts > 0 ? [`${parts} part${parts === 1 ? "" : "s"}`] : []),
  ];
  const cuts = Object.entries(r.effects.cuts).map(([b, [a, c]]) => `${b} ${a} → ${c}`);
  const raised = r.diagnostics.filter((d) => d.severity !== "info").length;
  return {
    text: [
      `makes ${count - 1} cop${count === 2 ? "y" : "ies"}${adds.length > 0 ? `: ${adds.join(" and ")} more` : ""}`,
      ...(cuts.length > 0
        ? [`cut ${cuts.slice(0, 3).join(", ")}${cuts.length > 3 ? " …" : ""}`]
        : []),
      ...(raised > 0 ? [`${raised} new problem${raised === 1 ? "" : "s"}`] : []),
    ].join(" · "),
    error: false,
  };
}

export function createPatternTool(ctx: WireContext): Wire {
  const { show, viewer } = ctx;
  const handler: ToolHandler = {
    move(e) {
      ctx.track(e);
      const hit = ctx.pickAt(e);
      const copy = hit?.id.includes("@") ? hit.id : undefined;
      const along = hit && !copy && hit.id.startsWith("b") ? hit.id : undefined;
      show(
        e,
        along
          ? `along ${along}`
          : copy
            ? `${copy} is a copy: repeat along ${copy.split("@")[0]}, its template`
            : undefined,
        along ? `bar ${along}` : undefined,
      );
    },
    click(e) {
      const hit = ctx.pickAt(e);
      if (!hit || hit.id.includes("@") || !hit.id.startsWith("b")) return;
      patternState.value = { ...patternState.value, along: hit.id };
    },
    leave() {
      hint.value = undefined;
    },
  };

  // The preview, whenever the form or the model changes while Pattern is the tool.
  let asked = "";
  const off = effect(() => {
    const s = patternState.value;
    const m = model.value;
    if (activeTool.value !== "pattern" || !m) {
      asked = "";
      patternPreview.value = undefined;
      return;
    }
    const cmd = patternCommand(s, m.derived.params);
    const pitch = typedNumber(s.pitch, m.derived.params);
    const u = s.along ? alongDir(m, s.along) : undefined;
    if ("why" in cmd || "why" in pitch || !u) {
      asked = "";
      viewer.setOverlay({});
      ghostsDrawn = 0;
      patternPreview.value = undefined;
      return;
    }
    const bars = s.template.filter((id) => m.derived.bars[id]);
    const count = cmd.args.count as number;
    // Copy k sits k pitches along the bar, as the pattern places it (§4.5).
    const ghosts = Array.from({ length: Math.min(count - 1, 24) }, (_, i) => {
      const k = pitch.value * (i + 1);
      return ghostsOf(m, bars, translation([u[0] * k, u[1] * k, u[2] * k]), 48);
    }).flat();
    viewer.setOverlay({ ghosts: ghosts.slice(0, 96) });
    ghostsDrawn = Math.min(ghosts.length, 96);
    const key = `${m.rev} ${JSON.stringify(cmd)}`;
    if (key === asked) return;
    asked = key;
    void dryRun([cmd]).then((r) => {
      if (asked !== key) return;
      if (!r.ok) {
        // The dry run did not answer: not the core's refusal, so Create stays the server's to judge.
        patternPreview.value = { text: r.why, error: true, ghosts: ghosts.length };
        return;
      }
      const w = patternWords(r.value, count);
      patternPreview.value = {
        ...w,
        ghosts: ghosts.length,
        shown: { key: JSON.stringify([cmd]), rev: m.rev, refused: w.error ? w.text : undefined },
      };
    });
  });

  return {
    handler,
    switched(next) {
      if (next === "pattern")
        patternState.value = { ...patternState.value, template: [...selection.value].sort() };
    },
    dispose() {
      off();
    },
  };
}
