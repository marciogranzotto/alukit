import type { Arrangements, JointKind } from "#core/corners/arrange.ts";
import type { CornerRule } from "#core/project/schema.ts";
import type { V3 } from "#core/vec.ts";
import { ApiError, get } from "../api.ts";
import type { ClientAnswer } from "./answer.ts";

/**
 * A corner's arrangements (S5.5, D-UX-9): `GET /api/arrangements?at=x,y,z[&rule=…]`, the answer
 * `alukit arrangements --json` prints (`alukit.arrangements/1`, src/core/corners/arrange.ts):
 * every corner rule's arrangement of the corners at those points, from one request in the
 * server's queue that shares the derive between the rules. The corner inspector asks it, for
 * the corner selected; the answer names its revision (`rev`). Owner: S1.
 */

/** The answer: the corners, every rule's arrangement, and the revision they ran against. */
export type ArrangementsAnswer = Arrangements & { rev: number };

/**
 * The query string of an arrangements request: each corner's point, then the rules; a miter or a
 * splice is named as a rule is (E1.4).
 */
export function arrangementsParams(
  at: readonly V3[],
  rules: readonly (CornerRule | JointKind)[] = [],
): string {
  return new URLSearchParams([
    ...at.map((p) => ["at", p.join(",")]),
    ...rules.map((r) => ["rule", r]),
  ]).toString();
}

export async function fetchArrangements(
  at: readonly V3[],
  rules?: readonly (CornerRule | JointKind)[],
): Promise<ClientAnswer<ArrangementsAnswer>> {
  try {
    return {
      ok: true,
      value: await get<ArrangementsAnswer>(`/api/arrangements?${arrangementsParams(at, rules)}`),
    };
  } catch (e) {
    // A read-only project is a 409 whose status says why.
    const status = e instanceof ApiError ? (e.body as { status?: { message?: string } }) : {};
    const why = status?.status?.message
      ? `the project is read-only: ${status.status.message}`
      : e instanceof Error
        ? e.message
        : String(e);
    return { ok: false, why };
  }
}
