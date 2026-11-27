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
  /** The commands' names, as the log has always written them: `addBar, autoConnect`. */
  what: string;
  /** The step in words (BE-4): `add bar b35`; absent from a server before BE-4. */
  text?: string;
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
  /** The step in words (BE-4); absent from a server before BE-4. */
  text?: string;
  of?: number;
}

/** A `rev` event (design §7.1): the step that made a revision, as the server broadcast it. */
export interface RevEvent {
  rev: number;
  source: string;
  what: string;
  text?: string;
  /** For an undo or redo: the revision of the step taken back or applied again. */
  of?: number;
  changes?: { created: string[]; removed: string[]; changed: string[] };
  diagnostics?: { new: Diagnostic[]; resolved: Diagnostic[] };
  undo: StepInfo | null;
  redo: StepInfo | null;
}

export interface Model {
  schema: "alukit.view/1";
  rev: number;
  name?: string;
  /** The variant derived (§4.10): the one asked for, else the default; null for none. */
  variant: string | null;
  /** The document as written. */
  doc: Record<string, unknown>;
  derived: {
    /** Each param's value, in the variant derived. */
    params: Record<string, number>;
    nodes: Record<string, [number, number, number]>;
    bars: MeshInput["bars"];
    runs: Record<string, { bars: string[]; len_mm: number }>;
    parts: Record<string, PartJson>;
    fastenings: Record<string, { fastening: string; layers: string[]; stations: unknown[] }>;
    hardware: { item: string; opt: Record<string, string>; source: string; qty: number }[];
    diagnostics: Diagnostic[];
  };
  /**
   * Per bar end (`b2.a`), every provider that claims it (`c1`, `b2.ends.a.plane`), whether or not
   * its plane resolved: derive's claims, which `alukit.derived/1` leaves out. An end no provider
   * claims is open, by the rule `autoConnect` applies (e1 2).
   */
  claims: Record<string, string[]>;
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
