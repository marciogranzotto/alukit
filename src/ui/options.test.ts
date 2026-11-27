import { describe, expect, it } from "vitest";
import { beyondDefaults, optionFields, optionsText, pickedOptions } from "./options.ts";

/** An item's options as the app offers them (options.ts): U2's root cause and its fix. */

const FINISH = { finish: ["raw", "anodised", "black"] };
const offer = (options: Record<string, string>) => ({ options });

describe("optionFields", () => {
  it("offers no project default the project does not have, and preselects a sold value (U2)", () => {
    // forseti's PF40-01 as the README's first run met it: sold only anodised or black.
    const [f] = optionFields(
      FINISH,
      [offer({ finish: "anodised" }), offer({ finish: "black" })],
      {},
    );
    expect(f?.choices.map((c) => c.value)).toEqual(["raw", "anodised", "black"]);
    expect(f?.chosen).toBe("anodised");
    expect(f?.choices.find((c) => c.value === "raw")?.sold).toBe(false);
  });

  it("offers the project's default when it gives one the item has, and preselects it if sold", () => {
    const [f] = optionFields(FINISH, [offer({ finish: "black" })], { finish: "black" });
    expect(f?.choices[0]).toEqual({ value: "", label: "project default: black", sold: true });
    expect(f?.chosen).toBe("");
  });

  it("passes over a default no offer sells, for a value one does", () => {
    const [f] = optionFields(FINISH, [offer({ finish: "black" })], { finish: "raw" });
    expect(f?.choices[0]).toMatchObject({ value: "", sold: false });
    expect(f?.chosen).toBe("black");
  });

  it("ignores a default that is not one of the item's values", () => {
    const [f] = optionFields(FINISH, [], { finish: "gold" });
    expect(f?.choices.map((c) => c.value)).toEqual(["raw", "anodised", "black"]);
    expect(f?.chosen).toBe("raw");
  });

  it("chooses options together: each against the offers that sell those chosen before", () => {
    const options = { finish: ["anodised", "black"], length: ["3000", "6000"] };
    const offers = [
      offer({ finish: "anodised", length: "6000" }),
      offer({ finish: "black", length: "3000" }),
    ];
    const fields = optionFields(options, offers, undefined);
    expect(fields.map((f) => [f.name, f.chosen])).toEqual([
      ["finish", "anodised"],
      ["length", "6000"],
    ]);
  });

  it("takes an offer that leaves an option open as selling every value of it", () => {
    const [f] = optionFields(FINISH, [offer({})], {});
    expect(f?.choices.every((c) => c.sold)).toBe(true);
    expect(f?.chosen).toBe("raw");
  });
});

describe("pickedOptions and beyondDefaults", () => {
  it("leaves the project's default out of what is written", () => {
    expect(pickedOptions({ finish: "", length: "3000" })).toEqual({ length: "3000" });
    expect(beyondDefaults({ finish: "anodised", length: "3000" }, { finish: "anodised" })).toEqual({
      length: "3000",
    });
    expect(optionsText({ length: "3000", finish: "black" })).toBe("finish black, length 3000");
  });
});
