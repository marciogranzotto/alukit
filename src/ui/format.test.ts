import { describe, expect, it } from "vitest";
import { money as cliMoney } from "#core/order/format.ts";
import {
  deg,
  group,
  kg,
  kgPerM,
  mm,
  money,
  NBSP,
  plain,
  qty,
  splitNumber,
  THIN,
  withUnit,
} from "./format.ts";

/** The app's number formats (format.ts): the CLI's digits, grouped with U+202F. */

describe("format", () => {
  it("writes lengths and angles to two decimals, masses to three", () => {
    expect(mm(860)).toBe("860.00");
    expect(deg(45)).toBe("45.00");
    expect(kg(12.3456)).toBe("12.346");
    expect(kgPerM(7.356726885756334)).toBe("7.357");
  });

  it("groups thousands with U+202F from four digits in a table and five in running text", () => {
    expect(mm(1120.5, { table: true })).toBe(`1${THIN}120.50`);
    expect(mm(1120.5)).toBe("1120.50");
    expect(mm(14433.61)).toBe(`14${THIN}433.61`);
    expect(mm(999.5, { table: true })).toBe("999.50");
    expect(group("1234567", { table: true })).toBe(`1${THIN}234${THIN}567`);
    expect(group("-1234.5", { table: true })).toBe(`-1${THIN}234.5`);
    expect(group("−12345.5")).toBe(`−12${THIN}345.5`);
    expect(group("no number")).toBe("no number");
  });

  it("writes money as alukit order does, after removing the grouping", () => {
    for (const minor of [0, 5, 85_00, 123_456, 1_443_361, -1_250]) {
      expect(plain(money(minor, { table: true }))).toBe(cliMoney(minor));
      expect(plain(money(minor))).toBe(cliMoney(minor));
    }
    expect(money(1_443_361)).toBe(`14${THIN}433.61`);
    expect(money(123_456, { table: true })).toBe(`1${THIN}234.56`);
    expect(qty(12)).toBe("12");
  });

  it("splits a trailing .00 for dimming, and only that", () => {
    expect(splitNumber(`1${THIN}120.00`)).toEqual({ main: `1${THIN}120`, dim: ".00" });
    expect(splitNumber("860.50")).toEqual({ main: "860.50", dim: "" });
    expect(splitNumber("0.000")).toEqual({ main: "0", dim: ".000" });
    expect(splitNumber("12")).toEqual({ main: "12", dim: "" });
  });

  it("keeps a number and its unit on one line", () => {
    expect(withUnit("860", "mm")).toBe(`860${NBSP}mm`);
  });
});
