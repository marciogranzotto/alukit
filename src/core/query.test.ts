import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { RawDoc } from "./commands/types.ts";
import { derive } from "./derive/derive.ts";
import { LockFile } from "./lock/schema.ts";
import { lockItems } from "./lock/source.ts";
import { connectedTo, select, similarTo } from "./query.ts";
import { FIXTURES, readJson } from "./testing.ts";

/**
 * The selection verbs' core (E1.5, editing audit §7.5): what is like an entity and what is joined
 * to it, as the app's "select similar" and "select connected" and `alukit query`'s `like:` and
 * `connected:` read them, on the cart.
 */

const CART = join(FIXTURES, "cart");
const doc = readJson(join(CART, "alukit.json")) as RawDoc;
const derived = derive(doc, lockItems(LockFile.parse(readJson(join(CART, "alukit.lock.json")))));

const range = (p: string, from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => `${p}${from + i}`);

describe("similarTo", () => {
  it("takes a bar's item and options as it derives them, the default bar's included", () => {
    // b1–b4 name no item: they are the default bar, as are the rails and braces that name none.
    expect(similarTo(doc, derived, "b1", "item")).toEqual([
      ...range("b", 1, 4),
      ...range("b", 7, 17),
      ...range("b", 26, 32),
    ]);
    expect(similarTo(doc, derived, "b5", "item")).toEqual(["b5", "b6"]);
    // The 50 × 10 flats, not the 50 × 20 packers.
    expect(similarTo(doc, derived, "b20", "item")).toEqual(["b19", "b20", "b23", "b24", "b25"]);
  });

  it("keeps a connection to its own type", () => {
    // The butts with no connector, not the splice c34 that names none either.
    const butts = similarTo(doc, derived, "c1", "item");
    expect(butts).toContain("c32");
    expect(butts).not.toContain("c34");
    expect(butts).not.toContain("c33"); // a butt with a connector
    expect(similarTo(doc, derived, "c9", "item")).toEqual(["c9"]);
  });

  it("takes every tag an entity carries, within its kind", () => {
    expect(similarTo(doc, derived, "b2", "tag")).toEqual(range("b", 1, 4));
    expect(similarTo(doc, derived, "b27", "tag")).toEqual(range("b", 27, 30));
    // An entity with no tags is like nothing but itself.
    expect(similarTo(doc, derived, "b5", "tag")).toEqual(["b5"]);
    expect(similarTo(doc, derived, "b99", "item")).toEqual([]);
  });
});

describe("connectedTo", () => {
  it("joins the bars of every connection that names a bar", () => {
    // b9 (the front base rail): butted into b1 and b2 (c5, c6), the hinged braces b14 and b15 on
    // it (c14, c16), the beam b18 (c21) and the slat b26 (c26) butted into it.
    expect(connectedTo(doc, ["b9"])).toEqual(["b1", "b2", "b9", "b14", "b15", "b18", "b26"]);
  });

  it("takes a connection's bars, a run's bars, and what a part names", () => {
    // A pivot joins its base bar and its end's bar.
    expect(connectedTo(doc, ["c13"])).toEqual(["b1", "b14", "c13"]);
    expect(connectedTo(doc, ["r1"])).toEqual(["b11", "b12", "r1"]);
    // A face connection whose layers are runs joins their bars.
    expect(connectedTo(doc, ["c35"])).toEqual(["b11", "b12", "b33", "b34", "c35"]);
  });

  it("follows the joints to the whole assembly when transitive", () => {
    const all = connectedTo(doc, ["b9"], { transitive: true });
    // Every bar but the cover strip b19, which lies on the beam with no connection.
    expect(all).toEqual([...range("b", 1, 18), ...range("b", 20, 34)]);
    expect(connectedTo(doc, ["b18"], { transitive: true })).toEqual(all);
    // b19 sits on the beam by its points, with no connection: nothing joins it.
    expect(connectedTo(doc, ["b19"], { transitive: true })).toEqual(["b19"]);
  });

  it("does not join a bar a connection's expression only reads", () => {
    const edited = structuredClone(doc) as { connections: Record<string, { base: object }> };
    const c14 = edited.connections.c14 as { base: Record<string, unknown> };
    c14.base = { ...c14.base, at_mm: "len(b5) - 600" };
    expect(connectedTo(edited as unknown as RawDoc, ["c14"])).toEqual(["b9", "b14", "c14"]);
  });
});

describe("select's like: and connected:", () => {
  it("selects what is like an entity, reading the derived model", () => {
    expect(select(doc, "like:b5", () => derived)).toEqual({ ok: true, ids: ["b5", "b6"] });
    expect(select(doc, "like:b99", () => derived)).toEqual({
      ok: false,
      message: "there is no entity b99",
    });
    expect(select(doc, "like:", () => derived).ok).toBe(false);
  });

  it("selects the bars joined to a list of ids, or the whole assembly with connected*", () => {
    expect(select(doc, "connected:c13,r1")).toEqual({
      ok: true,
      ids: ["b1", "b11", "b12", "b14", "c13", "r1"],
    });
    const all = select(doc, "connected*:b9");
    expect(all.ok && all.ids).toHaveLength(33);
    expect(select(doc, "connected:b9,b77")).toEqual({
      ok: false,
      message: "there is no entity b77",
    });
  });
});
