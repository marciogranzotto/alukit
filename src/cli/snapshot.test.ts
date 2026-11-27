import { describe, expect, it } from "vitest";
import { snapshotUrl } from "./snapshot.ts";
import { capture } from "./testing.ts";

/**
 * `alukit snapshot`'s theme (BE-11, D-UX-21): dark unless `--theme light`, asked of the page as
 * `&theme=`. The rendering itself is an end-to-end test (tests/e2e/snapshot.spec.ts), which needs
 * the built app.
 */

describe("alukit snapshot --theme", () => {
  it("asks the page for the view and the theme, the token in the hash", () => {
    expect(
      snapshotUrl({ url: "http://127.0.0.1:5000/", token: "t0k", view: "iso", theme: "dark" }),
    ).toBe("http://127.0.0.1:5000/?snapshot=iso&theme=dark#t=t0k");
    expect(
      snapshotUrl({ url: "http://127.0.0.1:5000/", token: "t", view: "my view", theme: "light" }),
    ).toBe("http://127.0.0.1:5000/?snapshot=my+view&theme=light#t=t");
  });

  it("takes dark or light, and says so with its usage", async () => {
    const bad = await capture(["snapshot", ".", "-o", "x.png", "--theme", "sepia"]);
    expect(bad.code).toBe(2);
    expect(bad.err).toContain("invalid --theme sepia: dark or light");
    expect(bad.err).toContain("[--theme dark|light]");
  });
});
