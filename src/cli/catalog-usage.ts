/**
 * The `alukit catalog` usage, apart from the command itself so that `--help` and `--version`
 * load no schemas. The schema names are repeated here; a test holds them to the export's list.
 */
export const SCHEMA_NAMES_FOR_USAGE = [
  "catalog",
  "offers",
  "section",
  "family",
  "overrides",
  "item",
] as const;

export const CATALOG_USAGE = [
  "alukit catalog check <path|id> [--catalog <dir>]... [--json]",
  "    computed against published, references, overrides, family collisions, offers",
  "alukit catalog show <catalog>:<item> [--catalog <dir>]...",
  "    the merged item as JSON: fields with their sources, corrections, section, offers",
  `alukit catalog schema [${SCHEMA_NAMES_FOR_USAGE.join("|")}]`,
  "    the JSON Schema of a catalog file (all of them without a name)",
].join("\n");
