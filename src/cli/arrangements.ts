import { resolve } from "node:path";
import type { State } from "#core/commands/types.ts";
import {
  type Arrangements,
  arrange,
  arrangementsText,
  arrangeQuery,
  type JointArrangement,
  type JointKind,
  type RuleArrangement,
} from "#core/corners/arrange.ts";
import { localDate } from "#core/dates.ts";
import { derive } from "#core/derive/derive.ts";
import { catalogPlaces, openLiveCatalogs } from "#core/project/open.ts";
import { loadProject } from "#core/project/store.ts";
import type { V3 } from "#core/vec.ts";
import { call, findServer } from "../server/client.ts";
import { parseOptions, usageError } from "./args.ts";
import type { Io } from "./cli.ts";
import { diagnosticLine } from "./project.ts";
import { usageOf } from "./project-usage.ts";

/**
 * `alukit arrangements <dir> --at x,y,z [--at …] [--rule r]… [--json]` (S5.5, D-UX-9): where
 * bar ends meet at those points, every corner rule's arrangement: which bar runs through, which
 * ends butt, and the cut lengths each gives, from dry runs that write nothing; then a miter's and
 * a splice's, where the corner's two ends can take one, or why not (*2.3*, E1.4). The corner
 * inspector's arrangements, for an agent or a script; the batch each answers is what
 * `alukit do` would apply. `--rule miter` and `--rule splice` name a joint as a rule is named.
 *
 * With a server running, it asks the server, whose revision it reports; without one it runs the
 * same core in-process, at revision 0, as a server just opened on the files would say. Either way
 * the JSON is what `GET /api/arrangements` answers.
 */

const USAGE = usageOf("arrangements");

const pointText = (p: V3) => `(${p.join(", ")})`;

/** What a rule comes to at each corner, and the cuts it moves. */
function ruleLines(r: RuleArrangement): string[] {
  if (!r.ok) {
    const { index, cmd, errors } = r.failed;
    return [
      `${r.rule}: refused at command ${index + 1}${cmd ? ` (${cmd})` : ""}: ${errors.map((e) => e.message).join("; ")}`,
    ];
  }
  const plans = r.plans.map(
    (p) =>
      `${pointText(p.at)} ${p.through} runs through, ${p.ends.join(", ")} butt${p.ends.length === 1 ? "s" : ""}`,
  );
  const cuts = Object.entries(r.effects.cuts).map(([bar, [was, now]]) => `${bar} ${was} → ${now}`);
  return [
    `${r.rule}: ${plans.join("; ")}`,
    `  ${cuts.length > 0 ? `cut ${cuts.join(", ")}` : "no cut moves"}`,
  ];
}

/** What a miter or a splice comes to at each corner, and the cuts it moves; or why there is none. */
function jointLines(j: JointArrangement): string[] {
  if (!j.ok) return [`${j.kind}: refused: ${j.why}`];
  const plans = j.plans.map((p) => `${pointText(p.at)} ${p.ends.join(" and ")}`);
  const cuts = Object.entries(j.effects.cuts).map(([bar, [was, now]]) => `${bar} ${was} → ${now}`);
  return [
    `${j.kind}: ${plans.join("; ")}`,
    `  ${cuts.length > 0 ? `cut ${cuts.join(", ")}` : "no cut moves"}`,
  ];
}

/** The human form: the corners, each rule's arrangement, then a line of what it came to. */
function humanText(rev: number, a: Arrangements): string[] {
  const corners = a.corners.map(
    (c) =>
      `corner ${pointText(c.at)}: ${c.ends.length > 0 ? `ends ${c.ends.join(", ")}` : "no bar end here"}${c.butts.length > 0 ? `; butt${c.butts.length === 1 ? "" : "s"} ${c.butts.join(", ")}` : ""}${c.joints ? `; ${c.joints.join(", ")}` : ""}`,
  );
  const distinct = new Set(
    a.rules.flatMap((r) => (r.ok ? [JSON.stringify([r.plans, r.effects.cuts])] : [])),
  ).size;
  const joints = a.joints.filter((j) => j.ok).length;
  return [
    ...corners,
    ...a.rules.flatMap(ruleLines),
    ...a.joints.flatMap(jointLines),
    `arrangements on rev ${rev}: ${distinct} distinct of ${a.rules.length} rule${a.rules.length === 1 ? "" : "s"}, ${joints} of ${a.joints.length} joint${a.joints.length === 1 ? "" : "s"}; nothing was written`,
  ];
}

/** The arrangements from the project's files, in-process: what a server just opened answers. */
async function headless(
  dir: string,
  q: {
    at: V3[];
    rules?: readonly ("vertical" | "x" | "y" | "first")[];
    joints?: readonly JointKind[];
  },
  io: Io,
): Promise<Arrangements | undefined> {
  const project = await loadProject(dir);
  for (const n of project.notices) io.err(`notice: ${n}`);
  if (project.raw === undefined || project.lock === undefined) {
    for (const d of project.diagnostics) io.err(diagnosticLine(d));
    return undefined;
  }
  const state: State = { doc: project.raw as State["doc"], lock: project.lock };
  const live = await openLiveCatalogs(dir, project.raw);
  return arrange({
    state,
    derived: derive(project.raw, project.items),
    at: q.at,
    ...(q.rules ? { rules: q.rules } : {}),
    ...(q.joints ? { joints: q.joints } : {}),
    env: { today: localDate(), live: live.set, catalogs: await catalogPlaces(dir) },
    open: async (catalogs) => (await openLiveCatalogs(dir, { catalogs })).set,
  });
}

export async function arrangementsCommand(argv: readonly string[], io: Io): Promise<number> {
  const args = parseOptions(
    "arrangements",
    argv,
    {
      json: { type: "boolean" },
      at: { type: "string", multiple: true },
      rule: { type: "string", multiple: true },
    },
    USAGE,
    io,
  );
  if (args === 2) return 2;
  const [dir, ...extra] = args.positionals;
  if (dir === undefined) return usageError("arrangements", "a project folder is needed", USAGE, io);
  if (extra.length > 0) {
    return usageError("arrangements", `unexpected argument ${extra[0]}`, USAGE, io);
  }
  const q = arrangeQuery(args.values.at ?? [], args.values.rule ?? []);
  if ("error" in q) {
    return usageError(
      "arrangements",
      q.error.replace(/^at=/, "--at ").replace(/^rule=/, "--rule "),
      USAGE,
      io,
    );
  }
  const root = resolve(dir);

  let rev = 0;
  let answer: Arrangements | undefined;
  const link = await findServer(root);
  if (link) {
    const params = new URLSearchParams([
      ...q.at.map((p) => ["at", p.join(",")]),
      ...[...(q.rules ?? []), ...(q.joints ?? [])].map((r) => ["rule", r]),
    ]);
    const r = await call(link, "GET", `/api/arrangements?${params}`);
    const body = r.body as {
      rev?: number;
      message?: string;
      status?: { message?: string };
    } & Partial<Arrangements>;
    if (r.status !== 200 || !body.corners || !body.rules || !body.joints) {
      const why = body.status?.message
        ? `the project is read-only: ${body.status.message}`
        : (body.message ?? `the server answered ${r.status}`);
      io.err(`alukit arrangements: ${why}`);
      return 1;
    }
    rev = body.rev ?? 0;
    answer = { corners: body.corners, rules: body.rules, joints: body.joints };
  } else answer = await headless(root, q, io);
  if (!answer) return 1;

  if (args.values.json) io.out(arrangementsText(rev, answer).trimEnd());
  else for (const line of humanText(rev, answer)) io.out(line);
  return 0;
}
