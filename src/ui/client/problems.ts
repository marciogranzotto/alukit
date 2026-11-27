import type { ProblemsAnswer } from "#core/problems/types.ts";
import { type ClientAnswer, notYet } from "./answer.ts";

/**
 * The problems of the project (BE-3, D-UX-12): `GET /api/problems?variant=&as_of=`, the answer
 * `alukit problems --json` prints, `alukit.problems/1` (src/core/problems/types.ts). The tab asks
 * for the drawn revision's, in its variant and at the order's date. Owner: S1, which replaces the
 * stub with the call in S1.6; until then it answers "not available yet", and the UI streams build
 * against tests/fixtures/ux/problems-cart.json.
 */

export interface ProblemsQuery {
  /** The variant, as the tab derives it; the document's default when absent. */
  variant?: string;
  /** The order's date (`as_of`); the server's today when absent. */
  asOf?: string;
}

export async function fetchProblems(_q: ProblemsQuery = {}): Promise<ClientAnswer<ProblemsAnswer>> {
  return notYet("GET /api/problems", "BE-3, S1.6");
}
