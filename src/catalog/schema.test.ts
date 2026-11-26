import { describe, expect, it } from "vitest";
import { unitOf } from "#core/units.ts";
import { SCHEMA_NAMES_FOR_USAGE } from "../cli/catalog-usage.ts";
import { parseJson } from "./json.ts";
import { jsonSchema, SCHEMA_NAMES } from "./json-schema.ts";
import { RATINGS, ratingKeys, ratingsSchema } from "./ratings.ts";
import { KINDS, LocalId, Ref, Valued } from "./schema/common.ts";
import { Item } from "./schema/items.ts";
import { Offer } from "./schema/offers.ts";
import { SectionFile } from "./schema/section.ts";

type Json = Record<string, unknown>;

/** Every object property in a JSON Schema, with the schema of its value. */
function properties(node: unknown, out: [string, Json][] = []): [string, Json][] {
  if (Array.isArray(node)) {
    for (const n of node) properties(n, out);
  } else if (node && typeof node === "object") {
    const o = node as Json;
    if (o.properties && typeof o.properties === "object") {
      for (const [k, v] of Object.entries(o.properties as Json)) out.push([k, v as Json]);
    }
    for (const v of Object.values(o)) properties(v, out);
  }
  return out;
}

/** True for the JSON Schema of a valued field: a number, or an object with a numeric `v`. */
function isValuedSchema(s: Json): boolean {
  const any = s.anyOf as Json[] | undefined;
  return (
    Array.isArray(any) &&
    any.some((x) => x.type === "number") &&
    any.some((x) => (x.properties as Json | undefined)?.v !== undefined)
  );
}

/** Valued fields that are dimensionless by nature (design §3.3, §3.4). */
const DIMENSIONLESS = new Set(["nu", "mu", "K", "safety_factor"]);

describe("JSON Schema export (design §7.4)", () => {
  it("exports every file's schema with io: input", () => {
    for (const name of SCHEMA_NAMES) {
      const s = jsonSchema(name);
      expect(s.$schema, name).toBe("https://json-schema.org/draft/2020-12/schema");
      expect(s.title).toBe(`alukit ${name}`);
    }
  });

  it("makes fields with defaults optional for a writer", () => {
    const offer = JSON.stringify(jsonSchema("offers"));
    expect(offer).toContain('"sale_minor":{"default":null');
    const price = (properties(jsonSchema("offers")).find(([k]) => k === "price")?.[1] ??
      {}) as Json;
    expect(price.required).toEqual(["regular_minor", "per", "read", "src"]);
  });

  it("lists the same schema names as the CLI usage", () => {
    expect([...SCHEMA_NAMES]).toEqual([...SCHEMA_NAMES_FOR_USAGE]);
  });
});

describe("units by suffix (design §2)", () => {
  it("every valued field of an item, material or groove names its unit, or is dimensionless", () => {
    const names = new Set<string>();
    for (const name of ["item", "catalog"] as const) {
      for (const [key, schema] of properties(jsonSchema(name))) {
        if (isValuedSchema(schema)) names.add(key);
      }
    }
    expect(names.size).toBeGreaterThan(20);
    const bad = [...names].filter((k) => !DIMENSIONLESS.has(k) && unitOf(k) === undefined);
    expect(bad).toEqual([]);
  });

  it("rejects a quantity key with an unknown suffix", () => {
    const carriage = {
      kind: "carriage",
      name: "x",
      rail_system: "r",
      prov: { src: "est" },
      dims: { H_in: 2 },
    };
    expect(Item.safeParse(carriage).success).toBe(false);
    expect(Item.safeParse({ ...carriage, dims: { H_mm: 2 } }).success).toBe(true);
  });
});

describe("the ratings vocabulary (design §3.4)", () => {
  it("names each key's unit in its suffix", () => {
    for (const [key, def] of Object.entries(RATINGS)) {
      const u = unitOf(key);
      if (def.unit === "1" || def.unit === "-") expect(u, key).toBeUndefined();
      else expect(u?.suffix, key).toBe(def.unit);
    }
  });

  it("applies each key to known kinds, and every kind has a bag", () => {
    for (const def of Object.values(RATINGS)) {
      for (const k of def.kinds) expect(KINDS).toContain(k);
    }
    expect(ratingKeys("carriage")).toContain("C_N");
    expect(ratingKeys("connector")).toContain("F_N.x");
  });

  it("refuses unknown keys and keys of another kind", () => {
    expect(ratingsSchema("connector").safeParse({ "F_N.x": 100 }).success).toBe(true);
    expect(ratingsSchema("connector").safeParse({ C_N: 100 }).success).toBe(false);
    expect(ratingsSchema("connector").safeParse({ strength: 100 }).success).toBe(false);
    expect(ratingsSchema("accessory").safeParse({ load_N: "not published" }).success).toBe(true);
    expect(ratingsSchema("accessory").safeParse({ load_N: "unknown" }).success).toBe(false);
  });
});

describe("ids and values (design §2)", () => {
  it("accepts codes and SKUs, never integer-like keys, colons, slashes or spaces", () => {
    for (const ok of ["PF40-01", "PF40-01-pp-c7", "HGH25-01CA-1", "6063-T5", "s40-c8", "007"]) {
      expect(LocalId.safeParse(ok).success, ok).toBe(true);
    }
    for (const bad of ["12", "0", "a:b", "a/b", "a b", "", "-x"]) {
      expect(LocalId.safeParse(bad).success, bad).toBe(false);
    }
    expect(Ref.safeParse("forseti:PF40-01").success).toBe(true);
    expect(Ref.safeParse("PF40-01").success).toBe(true);
    expect(Ref.safeParse("project:plate-a").success).toBe(false);
    expect(Ref.safeParse("a:b:c").success).toBe(false);
  });

  it("accepts a bare number or a valued object with a consistent range", () => {
    expect(Valued.safeParse(5).success).toBe(true);
    expect(Valued.safeParse({ v: 5, src: "est", low: 4, high: 6 }).success).toBe(true);
    expect(Valued.safeParse({ v: 5, low: 6 }).success).toBe(false);
    expect(Valued.safeParse({ v: 5, src: "guess" }).success).toBe(false);
    expect(Valued.safeParse({ v: 5, read: "26/11/2026" }).success).toBe(false);
  });

  it("an offer is a pack or a kit, not both", () => {
    const price = { regular_minor: 100, per: "unit", read: "2026-11-26", src: "src" };
    expect(Offer.safeParse({ item: "x", pack: 10, price }).success).toBe(true);
    expect(
      Offer.safeParse({ item: "x", pack: 10, kit: [{ item: "x", qty: 1 }], price }).success,
    ).toBe(false);
    expect(Offer.safeParse({ item: "x", price: { ...price, regular_minor: 1.5 } }).success).toBe(
      false,
    );
  });
});

describe("section files (design §3.5)", () => {
  const head = { schema: "alukit.section/1", id: "S" };
  it("takes each fidelity's own fields", () => {
    expect(
      SectionFile.safeParse({
        ...head,
        fidelity: "box",
        props_ok: false,
        bbox_mm: [
          [-1, -1],
          [1, 1],
        ],
      }).success,
    ).toBe(true);
    expect(
      SectionFile.safeParse({
        ...head,
        fidelity: "box",
        props_ok: true,
        bbox_mm: [
          [-1, -1],
          [1, 1],
        ],
      }).success,
    ).toBe(false);
    expect(
      SectionFile.safeParse({
        ...head,
        fidelity: "parametric",
        props_ok: true,
        generator: "rod",
        params: { d_mm: 10 },
      }).success,
    ).toBe(true);
    expect(
      SectionFile.safeParse({
        ...head,
        fidelity: "parametric",
        props_ok: true,
        generator: "rod",
        params: { d_mm: -1 },
      }).success,
    ).toBe(false);
    expect(
      SectionFile.safeParse({
        ...head,
        fidelity: "parametric",
        props_ok: true,
        generator: "channel",
        params: {},
      }).success,
    ).toBe(false);
    const ring = [
      [0, 0],
      [1, 0],
      [0, 1],
    ];
    const exact = {
      ...head,
      fidelity: "exact",
      props_ok: true,
      outline: ring,
      bbox_mm: [
        [0, 0],
        [1, 1],
      ],
    };
    expect(SectionFile.safeParse(exact).success).toBe(true);
    expect(SectionFile.safeParse({ ...exact, datums: { c: [0, 0] } }).success).toBe(false);
    expect(SectionFile.safeParse({ ...exact, datums: { heel: [0, 0] } }).success).toBe(true);
    expect(SectionFile.safeParse({ ...exact, outline: ring.slice(0, 2) }).success).toBe(false);
  });
});

describe("strict JSON", () => {
  it("reports duplicate keys with their path and line", () => {
    const r = parseJson('{\n  "a": 1,\n  "b": { "x": [ { "k": 1, "k": 2 } ] },\n  "a": 3\n}');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problems.map((p) => [p.message, p.line])).toEqual([
      ['duplicate key "k" in /b/x/0', 3],
      ['duplicate key "a" in /', 4],
    ]);
  });

  it("is not fooled by keys inside strings, escapes, or equal keys in sibling objects", () => {
    const r = parseJson(
      '{ "a": "\\"a\\": 1", "b": [ { "a": 1 }, { "a": 2 } ], "c\\"": 1, "c": 2 }',
    );
    expect(r.ok).toBe(true);
  });

  it("passes the parser's message for invalid JSON, and skips a byte-order mark", () => {
    const bad = parseJson("{ nope }");
    expect(bad.ok).toBe(false);
    expect(parseJson('﻿{ "a": 1 }')).toEqual({ ok: true, value: { a: 1 } });
  });
});
