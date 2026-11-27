import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyBatch } from "../commands/apply.ts";
import type { RawDoc, State } from "../commands/types.ts";
import { derive } from "../derive/derive.ts";
import { lockHash } from "../lock/pin.ts";
import { LockFile } from "../lock/schema.ts";
import { lockItems } from "../lock/source.ts";
import { problemsAt } from "../problems/problems.ts";
import type { Problem } from "../problems/types.ts";
import { FIXTURES, mergePatch, readJson } from "../testing.ts";
import { checkModel } from "./check.ts";
import { checkedOrder, modelOutputs, outputAccessors } from "./outputs.ts";

/**
 * Butts that name no connector (docs/ux/review-phase4.md B1): a box frame made with no connector
 * and no project default buys nothing to join its corners. The check says so as a note
 * (`butt-no-connector`), the order rule `no-connector` warns by default (a project can make it
 * block, or turn it off), and the problem model shows both as one problem with one fix. Every
 * surface words it alike: `alukit check`, `alukit order` and `alukit problems`.
 */

const AS_OF = "2026-11-26";
const ENV = { today: AS_OF };

/** G01's project with nothing drawn: 40 × 40 test:TS40, anodised, by default; no default butt. */
function empty(): State {
  const dir = join(FIXTURES, "golden-ends", "G01");
  const doc = readJson(join(dir, "alukit.json")) as RawDoc;
  return {
    doc: { ...doc, bars: {}, connections: {} },
    lock: LockFile.parse(readJson(join(dir, "alukit.lock.json"))),
  };
}

function apply(s: State, ...commands: object[]): State {
  const r = applyBatch(s, commands, ENV);
  if (!r.ok) throw new Error(`refused: ${JSON.stringify(r.failed)}`);
  return r.state;
}

/** The state with its document edited by a merge patch, as a hand edit would. */
function edited(s: State, patch: unknown): State {
  return { ...s, doc: mergePatch(s.doc, patch) as RawDoc };
}

function judged(s: State) {
  const items = lockItems(s.lock);
  const derived = derive(s.doc, items);
  const lock = lockHash(s.lock);
  const outputs = modelOutputs(derived, items, { lock });
  const check = checkModel({ raw: s.doc, derived, items, accessors: outputAccessors(outputs) });
  const order = checkedOrder(outputs, check.diagnostics, { asOf: AS_OF, lock });
  const problems = problemsAt(
    { rev: 1, derived, items, check, catalogs: [], outputs, lock },
    AS_OF,
  );
  return { check, order, problems };
}

const FRAME = { cmd: "addFrame", args: { size: [1000, 600, 800] } };
const BUTTS = ["c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8"];
const MESSAGE =
  "8 butts name no connector, and the project names no default butt connector: the order buys nothing to join them (c1, c2, c3 and 5 more)";

describe("a box frame with no connector", () => {
  it("is a note in the check on each butt, so a step names the butts it adds", () => {
    const { check } = judged(apply(empty(), FRAME));
    const found = check.diagnostics.filter((d) => d.code === "butt-no-connector");
    expect(found).toEqual(
      BUTTS.map((c) => ({
        severity: "info",
        code: "butt-no-connector",
        entity: c,
        message: `${c} names no connector, and the project names no default butt connector: the order buys nothing to join its ends`,
      })),
    );
  });

  it("warns in the order by default, which stays ready, with the same words", () => {
    const { order } = judged(apply(empty(), FRAME));
    expect(order.rules["no-connector"]).toBe("warn");
    const reasons = order.suppliers.flatMap((s) =>
      s.reasons.filter((r) => r.rule === "no-connector"),
    );
    expect(reasons.length).toBeGreaterThan(0);
    for (const r of reasons) {
      expect(r).toEqual({
        rule: "no-connector",
        action: "warn",
        message: MESSAGE,
        entities: BUTTS,
      });
    }
    expect(order.suppliers.flatMap((s) => s.reasons.filter((r) => r.action === "block"))).toEqual(
      [],
    );
    expect(order.status).toBe("READY");
  });

  it("blocks the order when the project makes the rule block, and says nothing when it is off", () => {
    const blocking = judged(
      apply(
        empty(),
        { cmd: "setProject", args: { order_rules: { "no-connector": "block" } } },
        FRAME,
      ),
    );
    expect(blocking.order.status).toBe("BLOCKED");
    expect(blocking.problems.order).toMatchObject({ status: "BLOCKED", blocks: 1 });
    const off = judged(
      apply(
        empty(),
        { cmd: "setProject", args: { order_rules: { "no-connector": "off" } } },
        FRAME,
      ),
    );
    expect(off.order.suppliers.flatMap((s) => s.reasons)).toEqual([]);
    // The check still notes each butt: notes, which hold nothing.
    const notes = off.problems.problems.filter((x) => x.code === "butt-no-connector");
    expect(notes.map((x) => [x.group, x.targets, x.from])).toEqual(
      BUTTS.map((c) => ["note", [c], ["check"]]),
    );
    expect(off.problems.order).toEqual({ status: "READY", blocks: 0, warnings: 0 });
  });

  it("is one problem, a warning from the check and the order, with one fix", () => {
    const { problems } = judged(apply(empty(), FRAME));
    const found = problems.problems.filter(
      (p) => p.code === "butt-no-connector" || p.rule === "no-connector",
    );
    expect(found).toHaveLength(1);
    const p = found[0] as Problem;
    expect(p).toMatchObject({
      code: "butt-no-connector",
      rule: "no-connector",
      group: "warning",
      title: "8 butts name no connector: the order buys nothing to join them",
      raw: MESSAGE,
      targets: BUTTS,
      from: ["check", "order"],
    });
    expect(p.fixes).toEqual([
      {
        label: "Set a connector for all 8…",
        kind: "connector",
        butts: BUTTS,
        systems: ["test:s40-c8"],
      },
    ]);
    // The order is ready, with one warning of its own: what the readiness pill reads.
    expect(problems.order).toEqual({ status: "READY", blocks: 0, warnings: 1 });
  });

  it("goes when the project names a default butt connector, as the fix's one step sets it", () => {
    // The catalogs are not open here, so the document is edited as the fix's `setProject` would.
    const fixed = edited(apply(empty(), FRAME), {
      defaults: { butt: { connector: "test:BRK-40", qty: 2 } },
    });
    const { check, order, problems } = judged(fixed);
    expect(check.diagnostics.some((d) => d.code === "butt-no-connector")).toBe(false);
    expect(order.suppliers.flatMap((x) => x.reasons).some((r) => r.rule === "no-connector")).toBe(
      false,
    );
    expect(problems.problems.some((p) => p.code === "butt-no-connector")).toBe(false);
  });

  it("leaves out a butt with its own connector, one another butt holds, and one through a body", () => {
    const s = edited(apply(empty(), FRAME), {
      connections: {
        c1: { connector: "test:BRK-40" },
        c2: { held_by: "c1" },
        c3: { through: { body: "test:BRK-40", at: [0, 0, 0] } },
      },
    });
    const { check } = judged(s);
    const noted = check.diagnostics.filter((x) => x.code === "butt-no-connector");
    expect(noted.map((x) => x.entity)).toEqual(BUTTS.slice(3));
  });

  it("says one butt in the singular", () => {
    const s = apply(empty(), FRAME);
    const own = Object.fromEntries(
      BUTTS.filter((id) => id !== "c5").map((id) => [id, { connector: "test:BRK-40" }]),
    );
    const { problems } = judged(edited(s, { connections: own }));
    const p = problems.problems.find((x) => x.code === "butt-no-connector") as Problem;
    expect(p.title).toBe("c5 names no connector: the order buys nothing to join its ends");
    expect(p.raw).toBe(
      "c5 names no connector, and the project names no default butt connector: the order buys nothing to join its ends",
    );
    expect(p.fixes[0]?.label).toBe("Set a connector for c5…");
  });
});
