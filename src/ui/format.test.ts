import { describe, expect, it } from "vitest";
import { money as cliMoney } from "#core/order/format.ts";
import { deg, group, kg, kgPerM, mm, money, qty } from "./format.ts";

/** The app's number formats (format.ts), as the tables write them today: the CLI's. */

describe("format", () => {
  it("writes lengths and angles to two decimals, masses to three", () => {
    expect(mm(860)).toBe("860.00");
    expect(mm(1120.5, { table: true })).toBe("1120.50");
    expect(deg(45)).toBe("45.00");
    expect(kg(12.3456)).toBe("12.346");
    expect(kgPerM(7.356726885756334)).toBe("7.357");
  });

  it("writes money as alukit order does, counts plainly, and groups nothing yet", () => {
    for (const minor of [0, 5, 85_00, 1_443_361, -1_250])
      expect(money(minor)).toBe(cliMoney(minor));
    expect(money(1_443_361)).toBe("14433.61");
    expect(qty(12)).toBe("12");
    expect(group("14433.61")).toBe("14433.61");
  });
});
