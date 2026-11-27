import type { z } from "zod";
import { Connection, Part, Pattern } from "../project/schema.ts";
import { create, patch, SetArgs } from "./helpers.ts";
import type { CommandDef } from "./types.ts";
import { changed, over } from "./words.ts";

/** Connections, parts and patterns (design §6): adding and changing them. */

export const addConnection: CommandDef<z.infer<typeof Connection>> = {
  name: "addConnection",
  group: "Connections",
  summary: "add a butt, miter, splice, pivot or face connection (§4.5)",
  args: Connection,
  describe: (a, d) => over("add", a.type, d.created),
  apply: (ctx, a) => create(ctx, "c", a),
};

export const setConnection: CommandDef<z.infer<typeof SetArgs>> = {
  name: "setConnection",
  group: "Connections",
  summary: "change a connection's fields; its type may change when the result is valid",
  args: SetArgs,
  describe: (a) => changed(a.id, a.set),
  apply: (ctx, a) => patch(ctx, a.id, a.set, "connections"),
};

export const addPart: CommandDef<z.infer<typeof Part>> = {
  name: "addPart",
  group: "Parts and patterns",
  summary: "place a part on a station or at a world pose, or add an unplaced line (§4.7)",
  args: Part,
  describe: (_a, d) => over("add", "part", d.created),
  apply: (ctx, a) => create(ctx, "p", a),
};

export const setPart: CommandDef<z.infer<typeof SetArgs>> = {
  name: "setPart",
  group: "Parts and patterns",
  summary: "change a part's fields",
  args: SetArgs,
  describe: (a) => changed(a.id, a.set),
  apply: (ctx, a) => patch(ctx, a.id, a.set, "parts"),
};

export const addPattern: CommandDef<z.infer<typeof Pattern>> = {
  name: "addPattern",
  group: "Parts and patterns",
  summary: "repeat entities along a bar, a run or a direction; copies stay live (§4.7)",
  args: Pattern,
  describe: (_a, d) => over("add", "pattern", d.created),
  apply: (ctx, a) => create(ctx, "pt", a),
};

export const setPattern: CommandDef<z.infer<typeof SetArgs>> = {
  name: "setPattern",
  group: "Parts and patterns",
  summary: "change a pattern: pitch, count, offsets, skips, template",
  args: SetArgs,
  describe: (a) => changed(a.id, a.set),
  apply: (ctx, a) => patch(ctx, a.id, a.set, "patterns"),
};
