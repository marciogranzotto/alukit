import type { CornerRule } from "#core/project/schema.ts";
import type { V3 } from "../../mesh/model.ts";
import type { Viewer } from "../../viewer/scene.ts";
import { type DryRun, dryRun } from "../client/dryrun.ts";
import { model } from "../store.ts";
import type { JointWords } from "./joint.ts";
import { CORNER_RULES, jointPreview, lastResult } from "./state.ts";

/**
 * The joint preview (S5.6, D-UX-11), for every gesture that may join bars: drawing a bar, dragging
 * a bar's end, typing its length, moving bars. The gesture says what it would commit (its batch,
 * for a corner rule) and where; the preview dry-runs it 60 ms after it snaps onto something or
 * 250 ms after it last changed, only when the batch differs from the last asked, and drops an
 * answer for a gesture that has moved on. Its words go by the gesture's end and into the command
 * bar (`jointPreview`); Tab flips to the next corner rule that gives another arrangement, for that
 * gesture only. The words come from the gesture, so each says what it does in its own terms; the
 * rule of §4.5 stays in the core, which the dry run asks. Owner: S5.
 */

/**
 * How long the pointer rests before a gesture in open space is dry-run, ms; a snap asks sooner.
 * S1 measured a dry run at 144–167 ms on 1,008 bars: it is asked when the gesture rests or snaps,
 * never on every pointer move (S5.6).
 */
export const PAUSE_MS = 250;
export const SNAP_MS = 60;

export type Cmd = { cmd: string; args: Record<string, unknown> };

/** A batch as it is sent: the gate compares what is sent, whatever built it. */
type Batch = readonly { cmd: string; args?: unknown }[];

/** What a gesture would commit now, and how its dry run reads. */
export interface PreviewAsk {
  /** The batch with a corner rule; with `undefined`, the rule the gesture follows now. */
  commands(prefer: CornerRule | undefined): Cmd[] | undefined;
  /** Where the words go: the gesture's end. */
  at: V3;
  /** Snapped onto something: ask after 60 ms rather than 250. */
  soon: boolean;
  /** The words for a dry run's answer, or undefined to say nothing (open space). */
  words(answer: DryRun): JointWords | undefined;
}

export interface JointPreviewer {
  /** The rule Tab flipped to for this gesture, if any. */
  readonly flipped: CornerRule | undefined;
  /** The gesture as it stands now; undefined when there is nothing to ask (open space). */
  ask(a: PreviewAsk | undefined): void;
  /** Tab: the next corner rule that gives another arrangement. */
  flip(): Promise<void>;
  /** Takes the words away and forgets what was asked. */
  clear(): void;
  /** `clear`, and forgets the flipped rule: the gesture ended. */
  reset(): void;
  /**
   * The words of the dry run's refusal when it was of exactly these commands, so a commit the core
   * already refused is not sent (review m3: Enter posted a step the preview knew was refused).
   * The same as `shownRefusal`, which every commit now asks (re-check N4).
   */
  refused(cmds: readonly Cmd[] | undefined): string | undefined;
}

/**
 * A preview's answer as the gate reads it (re-check N4): what it dry-ran, at which revision, and
 * the core's refusal in the words it shows, if it refused.
 */
export interface ShownAnswer {
  /** The commands it dry-ran, as JSON. */
  key: string;
  /** The revision the app held when it asked. */
  rev: number | undefined;
  /** The refusal the preview shows; undefined when the step would be made. */
  refused: string | undefined;
}

/**
 * The refusal a preview shows for exactly these commands, at the revision the app holds now: the
 * one rule every previewed commit asks before it sends (re-check N4; review m3 had it in Move and
 * Duplicate only, so a refused Mirror or Rotate still posted). A preview of other commands, or of
 * an older revision, says nothing about these: they are sent, and the server judges them.
 */
export function refusalOf(
  cmds: Batch | undefined,
  shown: ShownAnswer | undefined,
): string | undefined {
  if (!cmds || !shown || shown.refused === undefined) return undefined;
  if (shown.rev !== model.peek()?.rev) return undefined;
  return shown.key === JSON.stringify(cmds) ? shown.refused : undefined;
}

/**
 * The refusal the joint preview shows for these commands, as `refusalOf` reads it. Every gesture,
 * the draw tool and the length label preview through `createPreviewer`, which writes the one
 * `jointPreview`, so this one check covers them all.
 */
export function shownRefusal(cmds: Batch | undefined): string | undefined {
  const j = jointPreview.peek();
  return refusalOf(
    cmds,
    j && { key: j.key, rev: j.rev, refused: j.shape === "refused" ? j.text : undefined },
  );
}

/**
 * Holds a commit in the command bar when its preview already shows the core refusing it: the
 * refusal becomes Enter's answer, said once (`lastResult.held`: the bar shows it as the result
 * and no longer as the preview; re-check N9), and nothing is sent. True when it held.
 */
export function heldByPreview(cmds: Batch): boolean {
  const why = shownRefusal(cmds);
  if (why === undefined) return false;
  lastResult.value = {
    rev: model.peek()?.rev ?? 0,
    created: [],
    error: why,
    held: JSON.stringify(cmds),
  };
  return true;
}

/**
 * A previewer for one kind of gesture. `live` says whether the gesture is still on (an answer
 * that comes back after it ended is dropped); `rule` is the rule it follows when not flipped: the
 * command bar's, else undefined for the project's own.
 */
export function createPreviewer(
  viewer: Viewer,
  live: () => boolean,
  rule: () => CornerRule | undefined,
): JointPreviewer {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let wanted: string | undefined;
  let flipped: CornerRule | undefined;
  let current: PreviewAsk | undefined;
  const preferNow = () => flipped ?? rule();

  function clear(): void {
    if (timer) clearTimeout(timer);
    timer = undefined;
    wanted = undefined;
    current = undefined;
    if (jointPreview.peek()) jointPreview.value = undefined;
    viewer.setLabel("joint", undefined);
  }

  async function run(key: string, a: PreviewAsk, cmds: Cmd[], prefer: CornerRule | undefined) {
    // The revision asked about: a refusal holds a commit only while the app still holds it.
    const rev = model.peek()?.rev;
    const t0 = performance.now();
    const r = await dryRun(cmds);
    const ms = Math.round(performance.now() - t0);
    // Only the answer for the gesture as it stands now is shown.
    if (key !== wanted || !live() || !r.ok) return;
    const w = a.words(r.value);
    if (!w) return;
    jointPreview.value = {
      key,
      at: a.at,
      text: w.text,
      prefer,
      shape: w.shape,
      ms,
      joins: w.joins,
      rev,
    };
    viewer.setLabel("joint", a.at, w.joins ? `${w.text} · Tab: flip` : w.text);
  }

  return {
    get flipped() {
      return flipped;
    },
    ask(a) {
      const cmds = a?.commands(undefined);
      if (!a || !cmds) {
        clear();
        return;
      }
      current = a;
      const key = JSON.stringify(cmds);
      if (key === wanted) return;
      // What was shown is about another gesture now.
      if (jointPreview.peek()) jointPreview.value = undefined;
      viewer.setLabel("joint", undefined);
      wanted = key;
      if (timer) clearTimeout(timer);
      const prefer = preferNow();
      timer = setTimeout(() => void run(key, a, cmds, prefer), a.soon ? SNAP_MS : PAUSE_MS);
    },
    async flip() {
      const j = jointPreview.peek();
      const a = current;
      if (!j || !a) return;
      const base = (j.prefer ??
        (model.peek()?.defaults.corner as CornerRule | undefined) ??
        "vertical") as CornerRule;
      const from = CORNER_RULES.indexOf(base);
      for (let i = 1; i < CORNER_RULES.length; i++) {
        const r = CORNER_RULES[(from + i) % CORNER_RULES.length] as CornerRule;
        const cmds = a.commands(r);
        if (!cmds) return;
        const answer = await dryRun(cmds);
        if (jointPreview.peek() !== j) return;
        if (!answer.ok || !answer.value.ok) continue;
        const w = a.words(answer.value);
        if (!w || w.shape === j.shape) continue;
        flipped = r;
        wanted = JSON.stringify(a.commands(undefined));
        jointPreview.value = {
          key: wanted,
          at: a.at,
          text: w.text,
          prefer: r,
          shape: w.shape,
          ms: j.ms,
          joins: w.joins,
          rev: model.peek()?.rev,
        };
        viewer.setLabel("joint", a.at, `${w.text} · Tab: flip`);
        return;
      }
      viewer.setLabel("joint", a.at, `${j.text} · no other arrangement here`);
    },
    clear,
    reset() {
      clear();
      flipped = undefined;
    },
    refused: shownRefusal,
  };
}
