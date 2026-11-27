import { describe, expect, it } from "vitest";
import type { ListedEntry } from "../../server/catalog.ts";
import { bySize, profileOrder, shortNames } from "./StartCard.tsx";

/**
 * The start card's profiles (docs/ux/review-phase4.md M8): linear guides are not frame profiles,
 * the commonest profile of a size comes first, and the names lead with what differs.
 */

const bar = (code: string, extra: Partial<ListedEntry>): ListedEntry =>
  ({
    id: `forseti:${code}`,
    code,
    kind: "bar",
    name: code,
    size_mm: [40, 40],
    ...extra,
  }) as ListedEntry;

const V_SLOT = bar("PF20-15", {
  system: "forseti:s20-c6",
  fidelity: "exact",
  offers: 1,
  name: "Perfil Estrutural em Alumínio 40×40 V-Slot – Canal 6",
});
const LEVE = bar("PF40-00", {
  system: "forseti:s40-c8",
  fidelity: "exact",
  offers: 1,
  name: "Perfil Estrutural em Alumínio 40×40 Leve – Canal 8",
});
const BASICO = bar("PF40-01", {
  system: "forseti:s40-c8",
  fidelity: "exact",
  offers: 2,
  name: "Perfil Estrutural em Alumínio 40×40 Básico – Canal 8",
});
const PARAMETRIC = bar("PF40-09", { system: "forseti:s40-c8", fidelity: "parametric", offers: 3 });
const GUIDE = bar("MGN15", { shape: "rail", size_mm: [15, 10] });

describe("the start card's profiles", () => {
  it("leaves linear guides out of the sizes", () => {
    expect(bySize([GUIDE, BASICO, V_SLOT]).map((g) => [g.size, g.items.length])).toEqual([
      ["40 × 40", 2],
    ]);
  });

  it("lists the commonest first: the system most connectors fit, exact, sold in the most ways", () => {
    const fits = new Map([
      ["forseti:s40-c8", 29],
      ["forseti:s20-c6", 6],
    ]);
    expect(profileOrder([V_SLOT, PARAMETRIC, LEVE, BASICO], fits).map((e) => e.code)).toEqual([
      "PF40-01",
      "PF40-00",
      "PF40-09",
      "PF20-15",
    ]);
  });

  it("names them by what differs, after the words they share", () => {
    expect(shortNames([BASICO.name, LEVE.name, V_SLOT.name])).toEqual([
      "Básico – Canal 8",
      "Leve – Canal 8",
      "V-Slot – Canal 6",
    ]);
    expect(shortNames(["only one"])).toEqual(["only one"]);
  });
});
