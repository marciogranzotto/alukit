import { angle } from "./angle.ts";
import { flat, rail } from "./flat.ts";
import { rhs } from "./rhs.ts";
import { rod, threadedRod, tube } from "./round.ts";
import { tslot } from "./tslot.ts";
import type { Generator } from "./types.ts";

export type { GeneratedSection, GeneratorContext, GrooveDims, SectionCore } from "./types.ts";
export { NO_CONTEXT } from "./types.ts";

/**
 * Every generator, by name (design §3.5). `channel` and the rolled `beam` shapes have none yet:
 * until they do, such bars use an `exact`, `traced` or `box` section.
 */
// biome-ignore lint/suspicious/noExplicitAny: each entry is checked against its own params schema
export const GENERATORS: Readonly<Record<string, Generator<any>>> = {
  tslot,
  rhs,
  tube,
  rod,
  "threaded-rod": threadedRod,
  flat,
  angle,
  rail,
};

export { angle, flat, rail, rhs, rod, threadedRod, tslot, tube };
