/**
 * Who made a step (design §7.1): the server's log tags each with its source. A client may send
 * `ui`, `cli`, `cli:<name>` or `agent:<name>`; `file` is the watcher's alone. The server checks
 * what a request sends against this rule, and the CLI builds its own with `cliSource` before it
 * sends anything, so the two cannot disagree.
 */

/** A name in a source: letters, digits, `.`, `_` and `-`, at most 64. */
const NAME = "[A-Za-z0-9._-]{1,64}";

/** The sources a client may send. */
export const SOURCE = new RegExp(`^(ui|cli|cli:${NAME}|agent:${NAME})$`);

export const SOURCE_RULE = "ui, cli, cli:<name> or agent:<name> (file is the watcher's)";

/**
 * The source of a CLI process (`--as`, BE-10): `cli` without a name; `agent:<name>` and
 * `cli:<name>` as written, so an agent driving the CLI tags itself `agent:`; a bare name as
 * `cli:<name>`. An error message for anything the server would refuse.
 */
export function cliSource(as: string | undefined): { source: string } | { error: string } {
  if (as === undefined) return { source: "cli" };
  const source = /^(agent|cli):/.test(as) ? as : `cli:${as}`;
  if (SOURCE.test(source)) return { source };
  return {
    error: `--as takes a name (letters, digits, . _ -, at most 64), agent:<name> or cli:<name>, not "${as}"`,
  };
}
