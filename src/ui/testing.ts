import type { Model } from "./model.ts";

/** Models for the app's unit tests, which run in Node with no server. */

/**
 * A model with bars b1 and b2 and a copy b26@1, a part p1, a connection c1 and a node n1: only
 * the maps that say what is an entity, so it is no model to draw.
 */
export const SMALL = {
  doc: {
    bars: { b1: {}, b2: {} },
    connections: { c1: { type: "butt" } },
    nodes: { n1: [0, 0, 0] },
  },
  derived: { bars: { b1: {}, b2: {}, "b26@1": {} }, parts: { p1: {} } },
} as unknown as Model;
