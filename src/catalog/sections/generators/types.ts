import type { z } from "zod";
import type { Region, Ring, Vec2 } from "#core/section-properties.ts";
import type { Face } from "../../schema/common.ts";
import type { ClosedForm } from "../closed-form.ts";

/** A groove's dimensions, from its groove type (design §3.3). */
export interface GrooveDims {
  opening_mm: number;
  lip_mm: number;
  depth_mm: number;
  undercut_mm: number;
  /** A chamber that narrows: from this depth, to `bottom_mm` wide at `depth_mm`. */
  taper_from_mm?: number;
  bottom_mm?: number;
}

/** What a generator may look up: groove types by the reference its params use. */
export interface GeneratorContext {
  groove(ref: string): GrooveDims | undefined;
}

export const NO_CONTEXT: GeneratorContext = { groove: () => undefined };

export interface GeneratedGroove {
  face: Face;
  at_mm: number;
  /** The groove type reference, as the params wrote it. */
  type?: string;
}

/** A core of a section: a bore an end tap is cut in (design §3.5, §5.5). */
export interface SectionCore {
  /** Its centre, in section coordinates. */
  at_mm: Vec2;
  d_mm: number;
}

/** A parametric section, in mm, about its nominal centre (design §3.5). */
export interface GeneratedSection {
  /** For drawing. */
  outline: Ring;
  holes: Ring[];
  /** For properties, when it differs from the drawn shape (a threaded rod's stress area). */
  props?: Region;
  bbox_mm: readonly [Vec2, Vec2];
  grooves: GeneratedGroove[];
  datums: Record<string, Vec2>;
  /** Its cores, where the params give them (a `tslot`'s `bores`); absent when not known. */
  cores?: SectionCore[];
}

/**
 * A section generator (design §3.5): a params schema, a validity check that names each problem,
 * the outline, and the closed-form properties that test it.
 */
export interface Generator<P> {
  readonly name: string;
  readonly params: z.ZodType<P>;
  /** Problems that make the params unbuildable; empty when they are fine. */
  problems(params: P, ctx: GeneratorContext): string[];
  generate(params: P, ctx: GeneratorContext): GeneratedSection;
  closedForm(params: P, ctx: GeneratorContext): ClosedForm;
}

export function box2(w: number, h: number): readonly [Vec2, Vec2] {
  return [
    [-w / 2, -h / 2],
    [w / 2, h / 2],
  ];
}
