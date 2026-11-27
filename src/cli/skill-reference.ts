import { z } from "zod";
import { COMMAND_LIST } from "#core/commands/registry.ts";
import { branches, isExprSchema, type JsonSchema } from "#core/schema-walk.ts";
import { CATALOG_USAGE } from "./catalog-usage.ts";
import { EDIT_USAGE, PROJECT_USAGE } from "./project-usage.ts";
import { PUBLISH_USAGE } from "./publish-usage.ts";
import { SERVER_USAGE } from "./server-usage.ts";

/**
 * The skill's reference (design §7.5), generated so it cannot go stale: the CLI's usage, from the
 * same text `--help` prints, and every edit command with its arguments, from the commands' Zod
 * schemas (exported with `io: "input"`, §7.4). `pnpm skill` writes it into
 * `skills/alukit/SKILL.md` between the markers; a test fails when the file is behind.
 */

export const BEGIN =
  "<!-- generated reference: do not edit by hand; `pnpm skill` rewrites it from the code -->";
export const END = "<!-- end of the generated reference -->";

const isObject = (x: unknown): x is JsonSchema =>
  typeof x === "object" && x !== null && !Array.isArray(x);

/** A short type: `expr`, `"butt"`, `[expr, expr, expr]`, `{bar, at_mm, from?}`, unions. */
function typeText(s: JsonSchema, depth = 0): string {
  if (isExprSchema(s)) return "expr";
  const alts = branches(s);
  if (alts.length > 1) return [...new Set(alts.map((b) => typeText(b, depth)))].join(" | ");
  if ("const" in s) return JSON.stringify(s.const);
  if (Array.isArray(s.enum)) return s.enum.map((v) => JSON.stringify(v)).join(" | ");
  // Zod writes a nullable primitive as a list of types: `{ "type": ["string", "null"] }`.
  if (Array.isArray(s.type)) {
    return (s.type as string[]).map((t) => typeText({ ...s, type: t }, depth)).join(" | ");
  }
  switch (s.type) {
    case "string":
      return typeof s.description === "string" && typeof s.pattern === "string"
        ? `<${s.description}>`
        : "string";
    case "integer":
      return "integer";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "null":
      return "null";
    case "array": {
      if (Array.isArray(s.prefixItems)) {
        return `[${(s.prefixItems as JsonSchema[]).map((p) => typeText(p, depth + 1)).join(", ")}]`;
      }
      return `[${isObject(s.items) ? typeText(s.items, depth + 1) : "any"}, …]`;
    }
    case "object": {
      const props = isObject(s.properties) ? s.properties : {};
      const keys = Object.keys(props);
      if (keys.length === 0) {
        const value = isObject(s.additionalProperties)
          ? typeText(s.additionalProperties, depth + 1)
          : "any";
        return `{ <key>: ${value} }`;
      }
      const required = new Set((s.required as string[] | undefined) ?? []);
      if (depth > 1) return `{${keys.map((k) => (required.has(k) ? k : `${k}?`)).join(", ")}}`;
      return `{ ${keys
        .map(
          (k) =>
            `${k}${required.has(k) ? "" : "?"}: ${typeText(props[k] as JsonSchema, depth + 1)}`,
        )
        .join(", ")} }`;
    }
    default:
      return "any";
  }
}

/** One command: its summary, then each argument with its type and description. */
function commandText(c: (typeof COMMAND_LIST)[number]): string[] {
  const schema = z.toJSONSchema(c.args as z.ZodType, { io: "input" }) as JsonSchema;
  const props = isObject(schema.properties) ? schema.properties : {};
  const required = new Set((schema.required as string[] | undefined) ?? []);
  const out = [`- **\`${c.name}\`** (${c.group.toLowerCase()}): ${c.summary}`];
  // A union of forms (a connection's types, a part's placements): each form whole.
  if (Object.keys(props).length === 0) {
    for (const b of branches(schema)) out.push(`  - \`${typeText(b)}\``);
    return out;
  }
  for (const [k, v] of Object.entries(props)) {
    const p = v as JsonSchema;
    const desc = typeof p.description === "string" ? ` — ${p.description}` : "";
    const type = typeText({ ...p, description: undefined });
    out.push(`  - \`${k}\`${required.has(k) ? "" : " (optional)"}: \`${type}\`${desc}`);
  }
  return out;
}

export function skillReference(): string {
  const usage = [SERVER_USAGE, PROJECT_USAGE, EDIT_USAGE, PUBLISH_USAGE, CATALOG_USAGE].join("\n");
  return [
    BEGIN,
    "",
    "### CLI",
    "",
    "```text",
    usage,
    "```",
    "",
    "### Edit commands",
    "",
    'Each is `{ "cmd": "<name>", "args": { … } }` in `alukit do`. A `set…` command\'s `set`',
    "is a merge patch (`null` removes a field). Types: `expr` is a number or an expression",
    "string; `<…>` is a string of that form; `?` marks an optional field.",
    "",
    ...COMMAND_LIST.flatMap(commandText),
    "",
    END,
  ].join("\n");
}

/** `text` with its generated reference replaced by the current one. */
export function withReference(text: string): string {
  const a = text.indexOf(BEGIN);
  const b = text.indexOf(END);
  if (a < 0 || b < a) throw new Error("the skill has no generated-reference markers");
  return `${text.slice(0, a)}${skillReference()}${text.slice(b + END.length)}`;
}
