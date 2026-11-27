import { cliSource } from "../server/source.ts";
import { numbers3, vec3 } from "./add.ts";
import { parseOptions, usageError } from "./args.ts";
import type { Io } from "./cli.ts";
import { applyToProject } from "./do.ts";
import { usageOf } from "./project-usage.ts";

/**
 * `alukit move` and `alukit rotate` (design §7.3; the editing audit's E-UX-3): sugar over
 * `alukit do` for one `transform`. `move` takes an offset, each value a number or an expression
 * over params; `rotate` a world axis, an angle and a point the axis passes through. Joined ends
 * follow unless `--detach` frees them. `--dry-run` says what the step would do and writes nothing.
 */

/** The `transform` a `move` or `rotate` builds. Throws with a message for the user. */
export function transformOf(
  cmd: "move" | "rotate",
  v: Record<string, string | boolean | undefined>,
): { cmd: "transform"; args: Record<string, unknown> } {
  const need = (name: string): string => {
    const x = v[name];
    if (typeof x !== "string") throw new Error(`--${name} is needed`);
    return x;
  };
  const ids = need("ids")
    .split(",")
    .map((x) => x.trim())
    .filter((x) => x !== "");
  if (ids.length === 0) throw new Error("--ids names what to move: b3,b4");
  const joined = v.detach ? { joined: "detach" } : {};
  if (cmd === "move") {
    for (const k of ["axis", "deg", "about"]) {
      if (v[k] !== undefined) throw new Error(`--${k} goes with alukit rotate`);
    }
    return { cmd: "transform", args: { ids, by: vec3(need("by"), "--by"), ...joined } };
  }
  if (v.by !== undefined) throw new Error("--by goes with alukit move");
  const axis = need("axis");
  if (!["x", "y", "z"].includes(axis)) throw new Error(`--axis ${axis}: give x, y or z`);
  const deg = Number(need("deg"));
  if (!Number.isFinite(deg)) throw new Error(`--deg ${v.deg as string}: give a number of degrees`);
  const about = numbers3(need("about"), "--about", "x,y,z");
  return { cmd: "transform", args: { ids, rotate: { axis, deg, about }, ...joined } };
}

export async function transformCommand(
  cmd: "move" | "rotate",
  argv: readonly string[],
  io: Io,
): Promise<number> {
  const usage = usageOf(cmd);
  const args = parseOptions(
    cmd,
    argv,
    {
      ids: { type: "string" },
      by: { type: "string" },
      axis: { type: "string" },
      deg: { type: "string" },
      about: { type: "string" },
      detach: { type: "boolean" },
      "dry-run": { type: "boolean" },
      json: { type: "boolean" },
      as: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    usage,
    io,
  );
  if (args === 2) return 2;
  if (args.values.help) {
    io.out(usage);
    return 0;
  }
  const [dir, ...extra] = args.positionals;
  if (dir === undefined) return usageError(cmd, "a project folder is needed", usage, io);
  if (extra.length > 0) return usageError(cmd, `unexpected argument ${extra[0]}`, usage, io);
  let command: ReturnType<typeof transformOf>;
  try {
    command = transformOf(cmd, args.values);
  } catch (e) {
    return usageError(cmd, e instanceof Error ? e.message : String(e), usage, io);
  }
  const who = cliSource(args.values.as);
  if ("error" in who) return usageError(cmd, who.error, usage, io);
  return applyToProject(dir, [command], io, {
    json: args.values.json === true,
    dry: args.values["dry-run"] === true,
    source: who.source,
    cmd,
  });
}
