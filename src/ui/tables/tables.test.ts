import { describe, expect, it } from "vitest";
import type { Model } from "../model.ts";
import { sourceText, undoneBy } from "../records/History.tsx";
import { contrast } from "../theme/contrast.ts";
import { COLOURS, itemSwatches, swatchCss } from "../theme/tokens.ts";
import { pills } from "./pictograms.tsx";

/** What the sheets compute before they draw: swatches, the history's words, machining pills. */

const model = (groups: { kind: string; lines: { item: string; qty: number }[] }[]) =>
  ({ bom: { groups } }) as unknown as Model;

describe("itemSwatches", () => {
  const m = model([
    { kind: "fastener", lines: [{ item: "std:M5", qty: 120 }] },
    {
      kind: "bar",
      lines: [
        { item: "forseti:PF40", qty: 27 },
        { item: "forseti:PF80", qty: 2 },
      ],
    },
    { kind: "connector", lines: [{ item: "std:ANG", qty: 12 }] },
  ]);

  it("gives bars the first hues, then the rest by how many are used", () => {
    const s = itemSwatches(m);
    expect([...s.keys()]).toEqual(["forseti:PF40", "forseti:PF80", "std:M5", "std:ANG"]);
    expect(swatchCss(s.get("forseti:PF40") as number)).toBe("#86aee0");
    expect(new Set(s.values()).size).toBe(4);
  });

  it("shares one neutral past the eighth item, and keeps amber and cyan out of the hues", () => {
    const many = model([
      {
        kind: "bar",
        lines: Array.from({ length: 11 }, (_, i) => ({ item: `i${i}`, qty: 20 - i })),
      },
    ]);
    const s = [...itemSwatches(many).values()];
    expect(new Set(s.slice(8))).toEqual(new Set([0x9aa1a8]));
    const hue = (n: number) => {
      const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map((x) => (x as number) / 255) as [
        number,
        number,
        number,
      ];
      const max = Math.max(r, g, b);
      const d = max - Math.min(r, g, b);
      if (d === 0) return -1;
      const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      return (h * 60 + 360) % 360;
    };
    for (const n of s.slice(0, 8)) {
      expect(Math.abs(hue(n) - 36), "amber").toBeGreaterThan(8); // the selection's #ffa133 is at 32 to 36
      expect(Math.abs(hue(n) - 190), "cyan").toBeGreaterThan(8); // the tool's cyan
    }
  });

  it("draws the light theme's swatches darker, and keeps the label on each readable", () => {
    const dark = itemSwatches(m, "dark");
    const light = itemSwatches(m, "light");
    for (const [item, n] of dark) expect(light.get(item)).not.toBe(n);
    // Text on a swatch (a stock segment's label) is `--status-ink`, which flips with the theme.
    const hex = (n: number) => `#${n.toString(16).padStart(6, "0")}`;
    for (const t of ["dark", "light"] as const) {
      const ink = hex(t === "dark" ? 0x14171b : 0xffffff);
      const all = [
        ...itemSwatches(
          model([
            {
              kind: "bar",
              lines: Array.from({ length: 9 }, (_, i) => ({ item: `i${i}`, qty: 9 - i })),
            },
          ]),
          t,
        ).values(),
      ];
      for (const n of all)
        expect(contrast(ink, hex(n)), `${t} ${hex(n)}`).toBeGreaterThanOrEqual(4.5);
    }
    expect(COLOURS.dark["bg-panel"]).not.toBe(COLOURS.light["bg-panel"]);
  });
});

describe("the history's words", () => {
  it("names who made a step", () => {
    expect(sourceText("ui")).toBe("You, in the app");
    expect(sourceText("agent:claude")).toBe("Agent claude");
    expect(sourceText("cli:alukit")).toBe("The CLI (alukit)");
    expect(sourceText("file")).toBe("An edit to the file");
  });

  it("finds the steps that stay undone, and brings back one that was redone", () => {
    const log = [
      { rev: 1, source: "cli:a", what: "addNode" },
      { rev: 2, source: "ui", what: "undo addNode", of: 1 },
      { rev: 3, source: "ui", what: "redo addNode", of: 1 },
      { rev: 4, source: "ui", what: "addBar" },
      { rev: 5, source: "ui", what: "undo addBar", of: 4 },
    ];
    expect([...undoneBy(log)]).toEqual([[4, 5]]);
  });
});

describe("machining pills", () => {
  it("counts each kind of operation and says where, for a person to read at a glance", () => {
    const hole = (at_mm: number) =>
      ({ op: "hole", face: "-y", from: "a", at_mm, d_mm: 11 }) as const;
    const list = pills(
      [hole(100), hole(200), { op: "end-tap", from: "a", thread: "M8", depth_mm: 20 }],
      undefined,
    );
    expect(list.map((p) => [p.count, p.label])).toEqual([
      [2, "Ø11"],
      [1, "tap M8"],
    ]);
    expect(list[0]?.detail).toBe("face -y, from a, at 100 and 200");
    expect(list[1]?.detail).toBe("end a");
    expect(pills([], { holes: 20, pitch_mm: 60, E_a_mm: 30, E_b_mm: 30 })[0]).toMatchObject({
      count: 1,
      label: "rail holes",
      detail: "20 at 60",
    });
  });
});
