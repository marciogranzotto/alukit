import { describe, expect, it } from "vitest";
import { compareIds, isIntegerLike } from "./ids.ts";
import { QUANTUM, quantize, roundHalfAway, snapCeil, snapFloor } from "./quantum.ts";
import { cosDeg, reduceDeg, sinDeg } from "./trig.ts";
import { mFromMm, mmFromM, SUFFIXED_KEY, toBase, UNITS, unitOf } from "./units.ts";

describe("units by suffix (design §2)", () => {
  it("converts between mm and m", () => {
    expect(mmFromM(1.5)).toBe(1500);
    expect(mFromMm(2500)).toBe(2.5);
  });

  it("picks the longest suffix", () => {
    expect(unitOf("Ix_mm4")?.suffix).toBe("mm4");
    expect(unitOf("mass_kg_per_m")?.suffix).toBe("kg_per_m");
    expect(unitOf("density_kg_per_m3")?.suffix).toBe("kg_per_m3");
    expect(unitOf("torque_Nm")?.suffix).toBe("Nm");
    expect(unitOf("M_Nmm.x")?.suffix).toBe("Nmm");
    expect(unitOf("C_basis_km")?.suffix).toBe("km");
    expect(unitOf("straightness_mm_per_m")?.suffix).toBe("mm_per_m");
    expect(unitOf("regular_minor")?.suffix).toBe("minor");
  });

  it("finds no unit in dimensionless or unsuffixed names", () => {
    for (const name of ["nu", "mu", "K", "safety_factor", "preload_class", "qty", "mm", "_mm"]) {
      expect(unitOf(name), name).toBeUndefined();
    }
  });

  it("converts to base units", () => {
    expect(toBase("torque_Nm", 25)).toBe(25000);
    expect(toBase("load_kN", 2)).toBe(2000);
    expect(toBase("energy_J", 3)).toBe(3000);
    expect(toBase("len_m", 1.2)).toBe(1200);
    expect(() => toBase("length_in", 1)).toThrow(/no unit suffix/);
  });

  it("accepts only known suffixes as quantity keys", () => {
    expect(SUFFIXED_KEY.test("H_mm")).toBe(true);
    expect(SUFFIXED_KEY.test("N_Rk_kN")).toBe(true);
    expect(SUFFIXED_KEY.test("x_N_per_mm")).toBe(true);
    expect(SUFFIXED_KEY.test("H_in")).toBe(false);
    expect(SUFFIXED_KEY.test("height")).toBe(false);
  });

  it("has unique suffixes", () => {
    expect(new Set(UNITS.map((u) => u.suffix)).size).toBe(UNITS.length);
  });
});

describe("quantum (design §2, §5.2)", () => {
  it("rounds to the quantum, half away from zero", () => {
    expect(quantize(1.23456, QUANTUM.len_mm)).toBe(1.23);
    expect(quantize(0.125, QUANTUM.len_mm)).toBe(0.13);
    expect(quantize(-0.125, QUANTUM.len_mm)).toBe(-0.13);
    expect(quantize(0.1 + 0.2, QUANTUM.len_mm)).toBe(0.3);
  });

  it("treats a last-bit neighbour of a tie as the tie", () => {
    // 250.125 is not exact in binary; the tie must not depend on which neighbour we hold.
    const tie = 250.125;
    const below = tie - 2 ** -44;
    expect(quantize(tie, QUANTUM.len_mm)).toBe(250.13);
    expect(quantize(below, QUANTUM.len_mm)).toBe(250.13);
  });

  it("never returns -0", () => {
    expect(Object.is(quantize(-0.001, QUANTUM.len_mm), 0)).toBe(true);
    expect(Object.is(roundHalfAway(-0.4), 0)).toBe(true);
  });

  it("snaps before floor and ceil", () => {
    expect(snapFloor(2.9999999999999996)).toBe(3);
    expect(snapCeil(3.0000000000000004)).toBe(3);
    expect(snapFloor(2.5)).toBe(2);
  });

  it("refuses non-finite values and bad quanta", () => {
    expect(() => quantize(Number.NaN, 100)).toThrow();
    expect(() => quantize(1, 0.01)).toThrow();
  });
});

describe("trig in degrees (design §5.2)", () => {
  it("is exact at multiples of 30°", () => {
    expect(sinDeg(30)).toBe(0.5);
    expect(cosDeg(60)).toBe(0.5);
    expect(sinDeg(90)).toBe(1);
    expect(cosDeg(90)).toBe(0);
    expect(sinDeg(180)).toBe(0);
    expect(cosDeg(180)).toBe(-1);
    expect(sinDeg(-90)).toBe(-1);
    expect(cosDeg(270)).toBe(0);
    expect(sinDeg(720 + 210)).toBe(-0.5);
    expect(cosDeg(90 + 1e-12)).toBe(0);
  });

  it("reduces angles exactly", () => {
    expect(reduceDeg(-90)).toBe(270);
    expect(reduceDeg(360)).toBe(0);
    expect(reduceDeg(-360)).toBe(0);
  });

  it("uses Math elsewhere", () => {
    expect(sinDeg(45)).toBeCloseTo(Math.SQRT1_2, 15);
  });
});

describe("id order (design §2)", () => {
  it("orders the design's example", () => {
    const ids = ["c1", "b10@2", "b2", "b10@1", "b10"];
    expect([...ids].sort(compareIds)).toEqual(["b2", "b10", "b10@1", "b10@2", "c1"]);
  });

  it("orders catalog codes by number, not by character", () => {
    const ids = ["PF45-01", "PF40-02", "PF40-01", "PF4-99", "PF40-01-c7"];
    expect([...ids].sort(compareIds)).toEqual([
      "PF4-99",
      "PF40-01",
      "PF40-01-c7",
      "PF40-02",
      "PF45-01",
    ]);
  });

  it("is total: ids equal by value fall back to code points", () => {
    expect(compareIds("a01", "a1")).not.toBe(0);
    expect(Math.sign(compareIds("a01", "a1"))).toBe(-Math.sign(compareIds("a1", "a01")));
  });

  it("recognises integer-like keys", () => {
    expect(isIntegerLike("12")).toBe(true);
    expect(isIntegerLike("0")).toBe(true);
    expect(isIntegerLike("012")).toBe(false);
    expect(isIntegerLike("b12")).toBe(false);
  });
});
