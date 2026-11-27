import { cliSource } from "../server/source.ts";
import { parseOptions, usageError } from "./args.ts";
import type { Io } from "./cli.ts";
import { applyToProject } from "./do.ts";
import { usageOf } from "./project-usage.ts";

/**
 * `alukit add bar|point|connection|part|frame <dir> [options]` (design §7.3): one entity, or a
 * box frame (BE-6), as sugar over `alukit do`. Each builds one command and applies it the same
 * way. A point is a node id (`n3`), coordinates `x,y,z` (numbers or expressions), or a station
 * `<bar>:<at_mm>[:<from>]`.
 */

const ADD_USAGE = usageOf("add");

const KINDS = {
  bar: {
    usage:
      "alukit add bar <dir> --a <point> (--b <point> | --len <mm> --dir <+z|x,y,z>) [--item <ref>] [--anchor <a>] [--roll <deg>] [--label <text>] [--tag <t>]...",
    options: ["a", "b", "len", "dir", "item", "anchor", "roll", "label", "tag"],
  },
  point: {
    usage:
      "alukit add point <dir> (--at <x,y,z> | --on <bar>:<at_mm>[:<from>]) [--label <text>] [--tag <t>]...",
    options: ["at", "on", "label", "tag"],
  },
  connection: {
    usage: [
      "alukit add connection <dir> --type butt|miter|splice --end <bar.end>... [--through <bar>] [--connector <ref>] [--qty n] [--label <text>]",
      "alukit add connection <dir> --auto --at <node|x,y,z> [--connector <ref>] [--qty n]",
    ].join("\n"),
    options: ["type", "end", "through", "connector", "qty", "label", "tag", "auto", "at"],
  },
  part: {
    usage:
      "alukit add part <dir> --item <ref> (--on <bar>:<at_mm>[:<from>] [--groove <g> | --face <f>] [--roll <deg>] | --at <x,y,z> [--rot <x,y,z>]) [--label <text>] [--tag <t>]...",
    options: ["item", "on", "groove", "face", "roll", "at", "rot", "label", "tag"],
  },
  frame: {
    usage:
      "alukit add frame <dir> --size <W,D,H> [--at <x,y,z>] [--item <ref>] [--opt <name>=<value>]... [--corner vertical|x|y|first] [--rings base,top] [--shelf <mm>] [--connector <ref>] [--qty n] [--params]",
    options: [
      "size",
      "at",
      "item",
      "opt",
      "corner",
      "rings",
      "shelf",
      "connector",
      "qty",
      "params",
    ],
  },
} as const;

type Kind = keyof typeof KINDS;
const ALL_USAGE = Object.values(KINDS)
  .map((k) => k.usage)
  .join("\n");

/** A number when it reads as one, else an expression. */
function value(s: string): number | string {
  const t = s.trim();
  return /^-?(\d+(\.\d*)?|\.\d+)(e[+-]?\d+)?$/i.test(t) ? Number(t) : t;
}

/** Splits on commas outside parentheses, so `max(a, b),0,H` has three parts. */
function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim());
}

function vec3(s: string, what: string): (number | string)[] {
  const parts = splitTop(s);
  if (parts.length !== 3 || parts.some((p) => p === "")) {
    throw new Error(`${what}: give three comma-separated values, x,y,z`);
  }
  return parts.map(value);
}

/** Three plain numbers, `a,b,c`: a size or a corner, which take no expression. */
function numbers3(s: string, what: string, names: string): number[] {
  const parts = s.split(",").map((p) => p.trim());
  if (parts.length !== 3 || parts.some((p) => !/^-?(\d+(\.\d*)?|\.\d+)$/.test(p))) {
    throw new Error(`${what}: give three comma-separated values, ${names}`);
  }
  return parts.map(Number);
}

/** `--opt finish=anodised --opt colour=red` as `{ finish: "anodised", colour: "red" }`. */
function options(v: string[] | undefined): Record<string, string> | undefined {
  if (!v || v.length === 0) return undefined;
  const out: Record<string, string> = {};
  for (const o of v) {
    const m = /^([^=\s]+)=(.+)$/.exec(o.trim());
    if (!m) throw new Error(`--opt takes <name>=<value>, e.g. finish=anodised: ${o}`);
    out[m[1] as string] = m[2] as string;
  }
  return out;
}

function station(s: string, what: string): Record<string, unknown> {
  const m = /^((?:b|r)\d+):([^:]+)(?::(a|b|a\.cut|b\.cut))?$/.exec(s);
  if (!m) throw new Error(`${what}: a station is <bar>:<at_mm>[:<from>], e.g. b7:120 or b7:40:b`);
  return { bar: m[1], at_mm: value(m[2] as string), ...(m[3] ? { from: m[3] } : {}) };
}

/** A point: a node id, a station, or coordinates. */
function point(s: string, what: string): unknown {
  if (/^n\d+$/.test(s)) return s;
  if (/^(b|r)\d+:/.test(s)) return { on: station(s, what) };
  return vec3(s, what);
}

function direction(s: string): unknown {
  return /^[+-][xyz]$/.test(s) ? s : vec3(s, "--dir");
}

type Values = Record<string, string | boolean | string[] | undefined>;

function common(v: Values): Record<string, unknown> {
  const tags = v.tag as string[] | undefined;
  return {
    ...(v.label !== undefined ? { label: v.label } : {}),
    ...(tags && tags.length > 0 ? { tags } : {}),
  };
}

function need(v: Values, name: string): string {
  const x = v[name];
  if (typeof x !== "string") throw new Error(`--${name} is needed`);
  return x;
}

/** The command an `add` builds. Throws with a message for the user. */
function commandFor(kind: Kind, v: Values): { cmd: string; args: Record<string, unknown> } {
  switch (kind) {
    case "bar": {
      const a = point(need(v, "a"), "--a");
      let b: unknown;
      if (v.b !== undefined) {
        if (v.len !== undefined || v.dir !== undefined)
          throw new Error("give --b, or --len and --dir");
        b = point(v.b as string, "--b");
      } else b = { len_mm: value(need(v, "len")), dir: direction(need(v, "dir")) };
      return {
        cmd: "addBar",
        args: {
          ...(v.item !== undefined ? { item: v.item } : {}),
          a,
          b,
          ...(v.anchor !== undefined ? { anchor: v.anchor } : {}),
          ...(v.roll !== undefined ? { roll_deg: value(v.roll as string) } : {}),
          ...common(v),
        },
      };
    }
    case "point": {
      if ((v.at === undefined) === (v.on === undefined)) throw new Error("give --at or --on");
      const pos =
        v.at !== undefined
          ? { at: vec3(v.at as string, "--at") }
          : { on: station(v.on as string, "--on") };
      return { cmd: "addNode", args: { ...pos, ...common(v) } };
    }
    case "connection": {
      const extra = {
        ...(v.connector !== undefined ? { connector: v.connector } : {}),
        ...(v.qty !== undefined ? { qty: Number(v.qty) } : {}),
      };
      if (v.auto) {
        for (const k of ["type", "end", "through", "label", "tag"]) {
          if (v[k] !== undefined && !(Array.isArray(v[k]) && v[k].length === 0)) {
            throw new Error(`--auto takes --at, --connector and --qty, not --${k}`);
          }
        }
        const at = need(v, "at");
        return {
          cmd: "autoConnect",
          args: { at: /^n\d+$/.test(at) ? at : vec3(at, "--at"), ...extra },
        };
      }
      if (v.at !== undefined) throw new Error("--at goes with --auto");
      const type = need(v, "type");
      const ends = (v.end as string[] | undefined) ?? [];
      if (!["butt", "miter", "splice"].includes(type)) {
        throw new Error(
          `--type ${type}: add takes butt, miter or splice; write others with alukit do`,
        );
      }
      if (type === "butt") {
        return {
          cmd: "addConnection",
          args: { type, through: need(v, "through"), ends, ...extra, ...common(v) },
        };
      }
      if (v.through !== undefined) throw new Error(`--through goes with --type butt`);
      return { cmd: "addConnection", args: { type, ends, ...extra, ...common(v) } };
    }
    case "part": {
      const item = need(v, "item");
      if ((v.on === undefined) === (v.at === undefined)) throw new Error("give --on or --at");
      if (v.on !== undefined) {
        if (v.rot !== undefined) throw new Error("--rot goes with --at");
        if (v.groove !== undefined && v.face !== undefined)
          throw new Error("give --groove or --face");
        const on = {
          ...station(v.on as string, "--on"),
          ...(v.groove !== undefined ? { groove: v.groove } : {}),
          ...(v.face !== undefined ? { face: v.face } : {}),
        };
        return {
          cmd: "addPart",
          args: {
            item,
            on,
            ...(v.roll !== undefined ? { roll_deg: value(v.roll as string) } : {}),
            ...common(v),
          },
        };
      }
      for (const k of ["groove", "face", "roll"]) {
        if (v[k] !== undefined) throw new Error(`--${k} goes with --on`);
      }
      const at = {
        pos: vec3(v.at as string, "--at"),
        ...(v.rot !== undefined ? { rot_deg: vec3(v.rot as string, "--rot") } : {}),
      };
      return { cmd: "addPart", args: { item, at, ...common(v) } };
    }
    case "frame": {
      const opt = options(v.opt as string[] | undefined);
      return {
        cmd: "addFrame",
        args: {
          ...(v.at !== undefined ? { at: numbers3(v.at as string, "--at", "x,y,z") } : {}),
          size: numbers3(need(v, "size"), "--size", "W,D,H"),
          ...(v.item !== undefined ? { item: v.item } : {}),
          ...(opt ? { opt } : {}),
          ...(v.corner !== undefined ? { corner: v.corner } : {}),
          ...(v.rings !== undefined
            ? { rings: (v.rings as string).split(",").map((r) => r.trim()) }
            : {}),
          ...(v.shelf !== undefined ? { shelf_mm: Number(v.shelf) } : {}),
          ...(v.connector !== undefined ? { connector: v.connector } : {}),
          ...(v.qty !== undefined ? { qty: Number(v.qty) } : {}),
          ...(v.params ? { params: true } : {}),
        },
      };
    }
  }
}

export async function addCommand(argv: readonly string[], io: Io): Promise<number> {
  const [what, ...rest] = argv;
  if (what === undefined || what === "--help" || what === "-h") {
    io.out(ALL_USAGE);
    return what === undefined ? 2 : 0;
  }
  if (!Object.hasOwn(KINDS, what)) {
    return usageError(
      "add",
      `cannot add "${what}": add bar, point, connection, part or frame`,
      ADD_USAGE,
      io,
    );
  }
  const kind = what as Kind;
  const usage = KINDS[kind].usage;
  const args = parseOptions(
    "add",
    rest,
    {
      a: { type: "string" },
      b: { type: "string" },
      len: { type: "string" },
      dir: { type: "string" },
      item: { type: "string" },
      anchor: { type: "string" },
      roll: { type: "string" },
      label: { type: "string" },
      tag: { type: "string", multiple: true },
      at: { type: "string" },
      on: { type: "string" },
      type: { type: "string" },
      end: { type: "string", multiple: true },
      through: { type: "string" },
      connector: { type: "string" },
      qty: { type: "string" },
      auto: { type: "boolean" },
      groove: { type: "string" },
      face: { type: "string" },
      rot: { type: "string" },
      size: { type: "string" },
      opt: { type: "string", multiple: true },
      corner: { type: "string" },
      rings: { type: "string" },
      shelf: { type: "string" },
      params: { type: "boolean" },
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
  if (dir === undefined) return usageError("add", "a project folder is needed", usage, io);
  if (extra.length > 0) return usageError("add", `unexpected argument ${extra[0]}`, usage, io);
  const allowed = new Set<string>([...KINDS[kind].options, "json", "as", "help"]);
  const wrong = Object.keys(args.values).find((k) => !allowed.has(k));
  if (wrong) return usageError("add", `add ${kind} does not take --${wrong}`, usage, io);
  let command: { cmd: string; args: Record<string, unknown> };
  try {
    command = commandFor(kind, args.values as Values);
  } catch (e) {
    return usageError("add", e instanceof Error ? e.message : String(e), usage, io);
  }
  const who = cliSource(args.values.as);
  if ("error" in who) return usageError("add", who.error, usage, io);
  return applyToProject(dir, [command], io, {
    json: args.values.json === true,
    source: who.source,
    cmd: "add",
  });
}
