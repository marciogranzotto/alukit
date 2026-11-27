import {
  addConnection,
  addPart,
  addPattern,
  setConnection,
  setPart,
  setPattern,
} from "./entities.ts";
import { autoConnect, reverseBar, splitBar } from "./geometry.ts";
import { mirror } from "./mirror.ts";
import { array, explodePattern } from "./patterns.ts";
import { setProject } from "./project.ts";
import {
  addCheck,
  addCost,
  addDecision,
  addItem,
  addOpen,
  addVariant,
  chooseOffer,
  label,
  lockUpdate,
  resolveOpen,
  saveView,
  setCost,
  setItem,
  setParam,
  setPriceBands,
  setVariant,
  tag,
} from "./records.ts";
import { addBar, addNode, addRun, moveNode, removeEntity, setBar, setRun } from "./structure.ts";
import type { CommandDef } from "./types.ts";

/** Every command (design §6), in the order of §6's table. */
export const COMMAND_LIST: readonly CommandDef<never>[] = [
  setProject,
  addNode,
  moveNode,
  addBar,
  setBar,
  reverseBar,
  splitBar,
  addRun,
  setRun,
  removeEntity,
  addConnection,
  setConnection,
  autoConnect,
  addPart,
  setPart,
  addPattern,
  setPattern,
  explodePattern,
  mirror,
  array,
  addItem,
  setItem,
  setParam,
  addCost,
  setCost,
  setPriceBands,
  chooseOffer,
  tag,
  label,
  addVariant,
  setVariant,
  addCheck,
  addOpen,
  resolveOpen,
  addDecision,
  saveView,
  lockUpdate,
] as unknown as readonly CommandDef<never>[];

export const COMMANDS: ReadonlyMap<string, CommandDef<unknown>> = new Map(
  COMMAND_LIST.map((c) => [c.name, c as unknown as CommandDef<unknown>]),
);
