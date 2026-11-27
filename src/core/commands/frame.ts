import { z } from "zod";
import { CornerRule, type Expr, ItemRef } from "../project/schema.ts";
import { isObject } from "./doc.ts";
import { autoConnect } from "./geometry.ts";
import { makeContext, runSteps, type Step } from "./helpers.ts";
import { len, plus } from "./numbers.ts";
import { setParam } from "./records.ts";
import { addBar } from "./structure.ts";
import { type CommandDef, done, type RawDoc, refuse } from "./types.ts";

/**
 * `addFrame` (BE-6, D-UX-8): a box frame in one step, the box frame tool's, the start card's and
 * `alukit add frame`'s. Four posts, a base and a top ring (either may be left out) and an
 * optional shelf ring, each rail butted at its corners by `autoConnect` under the corner rule
 * (§4.5), so the rule stays in one place. The typed size is the frame's outside: its footprint
 * W × D from `at`, and its height H; each bar's anchor puts its section inside, as the skill's
 * worked example draws a table, so every outside face is flush with the size.
 *
 * It is made of the commands a person would send (`setParam`, `addBar`, `autoConnect`), run in
 * order inside it, so it predicts no ids, dry-runs like any command, and undo takes it back as
 * one step.
 */

const Size = z.number().positive();
const RINGS = ["base", "top"] as const;

const AddFrame = z.strictObject({
  at: z
    .tuple([z.number(), z.number(), z.number()])
    .optional()
    .describe("the frame's corner with the least x, y and z; [0, 0, 0] when absent"),
  size: z.tuple([Size, Size, Size]).describe("[W, D, H]: the outside size along x, y and z, mm"),
  item: ItemRef.optional().describe("the bars' item; defaults.bar.item when absent"),
  opt: z
    .record(z.string(), z.string())
    .optional()
    .describe("its options, { finish: anodised }; defaults.bar.opt when absent"),
  corner: CornerRule.optional().describe(
    "which bar runs through at each corner: vertical, x, y or first; defaults.corner when absent, else vertical",
  ),
  rings: z
    .array(z.enum(RINGS))
    .min(1)
    .refine((r) => new Set(r).size === r.length, { message: "a ring is named once" })
    .optional()
    .describe('the rings, ["base", "top"] when absent'),
  shelf_mm: Size.optional().describe("a shelf ring, its top face this high above the frame's base"),
  connector: ItemRef.optional().describe(
    "each butt's connector; defaults.butt.connector when absent",
  ),
  qty: z.int().min(1).optional().describe("connectors per butting end"),
  params: z
    .boolean()
    .optional()
    .describe("write W, D and H as params, and the frame's points from them"),
});
type AddFrameArgs = z.infer<typeof AddFrame>;

type Side = "front" | "back" | "left" | "right";
type Ring = (typeof RINGS)[number] | "shelf";

/**
 * Each side's rail: where it starts, its direction (+x or +y, so its section's own x points
 * across it, §4.4), and the half of its anchor that puts the section inside the frame: a bar
 * along +x has its own x along world +y, one along +y along world −x.
 */
const SIDES: readonly { side: Side; from: [0 | 1, 0 | 1]; along: "x" | "y"; inside: string }[] = [
  { side: "front", from: [0, 0], along: "x", inside: "-x" },
  { side: "back", from: [0, 1], along: "x", inside: "+x" },
  { side: "left", from: [0, 0], along: "y", inside: "+x" },
  { side: "right", from: [1, 0], along: "y", inside: "-x" },
];

/** The four posts, at the footprint's corners, each section inside it. */
const POSTS: readonly { at: [0 | 1, 0 | 1]; anchor: string; label: string }[] = [
  { at: [0, 0], anchor: "-x-y", label: "front left" },
  { at: [1, 0], anchor: "+x-y", label: "front right" },
  { at: [0, 1], anchor: "-x+y", label: "back left" },
  { at: [1, 1], anchor: "+x+y", label: "back right" },
];

/** The project's default bar item, when it names one. */
function defaultItem(doc: RawDoc): string | undefined {
  const bar = isObject(doc.defaults) && isObject(doc.defaults.bar) ? doc.defaults.bar : undefined;
  return typeof bar?.item === "string" ? bar.item : undefined;
}

export const addFrame: CommandDef<AddFrameArgs> = {
  name: "addFrame",
  group: "Structure",
  summary:
    "add a box frame as one step: four posts, base and top rings and an optional shelf ring, outside faces flush with the size, butted at every corner by the corner rule",
  args: AddFrame,
  describe(a, d) {
    const bars = d.created.filter((id) => id.startsWith("b")).length;
    const butts = d.created.filter((id) => id.startsWith("c")).length;
    return `add a box frame of ${bars} bars and ${butts} butts${a.params ? ", sized by W, D and H" : ""}`;
  },
  apply(ctx, a) {
    const [x0, y0, z0] = a.at ?? [0, 0, 0];
    const [W, D, H] = a.size;
    const rings = new Set<Ring>(a.rings ?? RINGS);
    const doc = ctx.state.doc;

    if (a.params) {
      const params = isObject(doc.params) ? doc.params : {};
      const taken = ["W", "D", "H"].filter((n) => Object.hasOwn(params, n));
      if (taken.length > 0) {
        return refuse(
          "exists",
          `the project already has ${taken.length === 1 ? "a param" : "params"} ${taken.join(", ")}: add the frame without params, or rename ${taken.length === 1 ? "it" : "them"} first`,
          { field: "params" },
        );
      }
    }

    // A coordinate at the footprint's far side: the param, when the frame is sized by params.
    const far = (base: number, size: number, param: string): Expr =>
      a.params ? plus(param, base) : len(base + size);
    const X = [x0, far(x0, W, "W")] as const;
    const Y = [y0, far(y0, D, "D")] as const;
    const top = far(z0, H, "H");
    // The rings asked for, bottom to top, each at the height of the face that sits on it.
    const levels = (
      [
        ["base", z0],
        ["shelf", a.shelf_mm !== undefined ? len(z0 + a.shelf_mm) : undefined],
        ["top", top],
      ] as [Ring, Expr | undefined][]
    ).filter((l): l is [Ring, Expr] => l[1] !== undefined && (l[0] === "shelf" || rings.has(l[0])));
    const bar = {
      ...(a.item !== undefined ? { item: a.item } : {}),
      ...(a.opt !== undefined ? { opt: a.opt } : {}),
    };

    const steps: Step[] = [];
    if (a.params) {
      for (const [name, value] of [
        ["W", W],
        ["D", D],
        ["H", H],
      ] as const) {
        steps.push({ def: setParam, args: { name, value } });
      }
    }
    for (const p of POSTS) {
      const [x, y] = [X[p.at[0]], Y[p.at[1]]];
      steps.push({
        def: addBar,
        args: {
          ...bar,
          a: [x, y, z0],
          b: [x, y, top],
          anchor: p.anchor,
          label: `post, ${p.label}`,
          tags: ["post"],
        },
      });
    }
    const corners: Expr[][] = [];
    for (const [ring, z] of levels) {
      // The base ring's bottom face on the base, the others' top faces at their height.
      const face = ring === "base" ? "-y" : "+y";
      for (const s of SIDES) {
        const [x, y] = [X[s.from[0]], Y[s.from[1]]];
        const end = s.along === "x" ? [X[1], y, z] : [x, Y[1], z];
        steps.push({
          def: addBar,
          args: {
            ...bar,
            a: [x, y, z],
            b: end,
            anchor: `${s.inside}${face}`,
            label: `${ring} rail, ${s.side}`,
            tags: [ring],
          },
        });
      }
      for (const p of POSTS) corners.push([X[p.at[0]], Y[p.at[1]], z]);
    }
    const join = {
      ...(a.corner !== undefined ? { prefer: a.corner } : {}),
      ...(a.connector !== undefined ? { connector: a.connector } : {}),
      ...(a.qty !== undefined ? { qty: a.qty } : {}),
    };
    for (const at of corners) {
      steps.push({ def: autoConnect, args: { at, ...join } });
    }

    const run = runSteps(ctx.state, ctx.env, steps);
    if (!run.ok) return run;

    // The size must leave every bar a length: a rail that butts loses a profile at each end.
    const ref = a.item ?? defaultItem(doc);
    const found = ref ? makeContext(run.state, ctx.env).items().item(ref) : undefined;
    if (found?.ok && found.bar) {
      const [[bx0, by0], [bx1, by1]] = found.bar.section.bbox_mm;
      const s = len(Math.max(bx1 - bx0, by1 - by0));
      if (Math.min(W, D, H) <= 2 * s) {
        return refuse(
          "geometry",
          `a frame of ${ref} needs W, D and H each over ${len(2 * s)} mm, twice its profile`,
          { field: "size" },
        );
      }
      if (a.shelf_mm !== undefined) {
        const low = (rings.has("base") ? s : 0) + s;
        const high = H - (rings.has("top") ? s : 0);
        if (a.shelf_mm < low || a.shelf_mm > high) {
          return refuse(
            "geometry",
            `the shelf ring's top face must stand from ${len(low)} to ${len(high)} mm above the base, clear of the other rings`,
            { field: "shelf_mm" },
          );
        }
      }
    }

    const created = run.did.flatMap((d) => d.created);
    const bars = created.filter((id) => id.startsWith("b"));
    const ringIds: Partial<Record<Ring, string[]>> = {};
    levels.forEach(([ring], i) => {
      const from = POSTS.length + i * SIDES.length;
      ringIds[ring] = bars.slice(from, from + SIDES.length);
    });
    return done(
      run.state,
      { created, changed: run.did.flatMap((d) => d.changed) },
      {
        posts: bars.slice(0, POSTS.length),
        rings: ringIds,
        connections: created.filter((id) => id.startsWith("c")),
        ...(a.params ? { params: ["W", "D", "H"] } : {}),
      },
    );
  },
};
