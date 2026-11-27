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

/** Each subcommand's usage line and what it does, in the order `--help` lists them. */
export const CATALOG_USAGES = {
  check: [
    "alukit catalog check <path|id> [--catalog <dir>]... [--json]",
    "    computed against published, references, overrides, family collisions, offers",
  ],
  show: [
    "alukit catalog show <catalog>:<item> [--catalog <dir>]...",
    "    the merged item as JSON: fields with their sources, corrections, section, offers",
  ],
  search: [
    "alukit catalog search <query> [--kind <kind>] [--prefer <kind>] [--catalog <id|dir>]... [--limit n] [--json]",
    "    items whose id, code, name or family hold every word, ranked: exact id or code first,",
    "    then bars of a size the query writes (40x40), then whole words; --prefer ranks a kind",
    "    first within each; every built-in catalog unless --catalog names some; 20 items unless",
    "    --limit (200 at most)",
  ],
  schema: [
    `alukit catalog schema [${SCHEMA_NAMES_FOR_USAGE.join("|")}]`,
    "    the JSON Schema of a catalog file (all of them without a name)",
  ],
  import: [
    "alukit catalog import forseti [--snapshot <dir>] [--pdf <file>] [--python <path>] [--out <dir>] [--fetch]",
    "    run the vendor's importer on a shop snapshot and its catalogue PDF (importers/forseti);",
    "    says what is missing instead; reads the network only with --fetch (a new snapshot)",
  ],
} as const;

export const CATALOG_USAGE = Object.values(CATALOG_USAGES)
  .flatMap((lines) => [...lines])
  .join("\n");
