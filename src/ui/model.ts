import type { Bom } from "#core/bom/bom.ts";
import type { CheckResult } from "#core/check/check.ts";
import type { CutList } from "#core/cutlist/cutlist.ts";
import type { Diagnostic } from "#core/diagnostics.ts";
import type {
  MeshInput,
  PartJson,
  ViewBar,
  ViewFastener,
  ViewPart,
  ViewSection,
} from "../mesh/model.ts";

/**
 * The answers the app reads, as types (type-only imports: nothing of the core is bundled). The
 * view model is the server's `alukit.view/1` (src/server/view.ts).
 */

export type { Diagnostic };

export interface StepInfo {
  rev: number;
  source: string;
  what: string;
}

export type Status =
  | { readOnly: false }
  | { readOnly: true; reason: "file" | "write"; message: string; diagnostics: Diagnostic[] };

/** The `hello` event and the session: what changes without a revision is here. */
export interface Summary {
  rev: number;
  name?: string;
  status: Status;
  undo: StepInfo | null;
  redo: StepInfo | null;
}

export interface LogEntry {
  rev: number;
  source: string;
  what: string;
  of?: number;
}

export interface Model {
  schema: "alukit.view/1";
  rev: number;
  name?: string;
  /** The document as written. */
  doc: Record<string, unknown>;
  derived: {
    nodes: Record<string, [number, number, number]>;
    bars: MeshInput["bars"];
    runs: Record<string, { bars: string[]; len_mm: number }>;
    parts: Record<string, PartJson>;
    fastenings: Record<string, { fastening: string; layers: string[]; stations: unknown[] }>;
    hardware: { item: string; opt: Record<string, string>; source: string; qty: number }[];
    diagnostics: Diagnostic[];
  };
  display: {
    bars: Record<string, ViewBar>;
    sections: Record<string, ViewSection>;
    parts: Record<string, ViewPart>;
    fasteners: ViewFastener[];
  };
  /** Catalog items the model uses, as the lock pins them. */
  items: Record<string, Record<string, unknown>>;
  defaults: Record<string, unknown>;
  check: { diagnostics: Diagnostic[]; checks: CheckResult[] };
  cutlist: CutList;
  bom: Bom;
}

export function meshInput(m: Model): MeshInput {
  return { bars: m.derived.bars, parts: m.derived.parts, display: m.display };
}
