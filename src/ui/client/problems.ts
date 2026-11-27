import type { ProblemsAnswer } from "#core/problems/types.ts";
import { get } from "../api.ts";
import type { ClientAnswer } from "./answer.ts";

/**
 * The problems of the project (BE-3, D-UX-12): `GET /api/problems?variant=&as_of=`, the answer
 * `alukit problems --json` prints, `alukit.problems/1` (src/core/problems/types.ts): the check's
 * diagnostics, the order's reasons and the open items as one list, grouped by consequence, each
 * in words with its targets and fixes. The tab asks for the drawn revision's, in its variant and
 * at the order's date; the answer names its revision (`rev`). Owner: S1.
 */

export interface ProblemsQuery {
  /** The variant, as the tab derives it; the document's default when absent. */
  variant?: string;
  /** The order's date (`as_of`); the server's today when absent. */
  asOf?: string;
}

/** The query string of a problems request, its fields in a fixed order. */
export function problemsParams(q: ProblemsQuery): string {
  const p = new URLSearchParams();
  if (q.variant !== undefined) p.set("variant", q.variant);
  if (q.asOf !== undefined) p.set("as_of", q.asOf);
  return p.toString();
}

export async function fetchProblems(q: ProblemsQuery = {}): Promise<ClientAnswer<ProblemsAnswer>> {
  const params = problemsParams(q);
  try {
    return {
      ok: true,
      value: await get<ProblemsAnswer>(`/api/problems${params ? `?${params}` : ""}`),
    };
  } catch (e) {
    return { ok: false, why: e instanceof Error ? e.message : String(e) };
  }
}
