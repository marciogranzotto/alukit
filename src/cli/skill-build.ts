import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SKILL_DIR } from "./skill.ts";
import { withReference } from "./skill-reference.ts";

/**
 * `pnpm skill`: rewrites the generated reference in `skills/alukit/SKILL.md` (design §7.5) from
 * the CLI's usage and the commands' schemas. A test fails while the file is behind the code.
 */

const path = join(SKILL_DIR, "SKILL.md");
const before = readFileSync(path, "utf8");
const after = withReference(before);
if (after === before) console.log(`${path}: up to date`);
else {
  writeFileSync(path, after);
  console.log(`${path}: reference regenerated`);
}
