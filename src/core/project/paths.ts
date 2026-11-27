/**
 * How a document names a catalog (§3.1): a built-in id, or a folder path relative to the
 * project. Pure, so the commands can tell the two apart; opening either is `open.ts`'s.
 */

/** A catalog entry is a folder path (relative to the project) rather than a built-in id. */
export function isPath(name: string): boolean {
  return name.startsWith(".") || name.includes("/") || name.includes("\\");
}
