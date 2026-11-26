import { readFileSync } from "node:fs";

/**
 * AluKit's version, from the checkout's package.json (Node only): what stamps carry (design
 * §4.13, §9). The CLI and the server read it from here, so an export or a revision saved through
 * either says the same.
 */
export function packageVersion(): string {
  const url = new URL("../../package.json", import.meta.url);
  const pkg = JSON.parse(readFileSync(url, "utf8")) as { version: string };
  return pkg.version;
}
