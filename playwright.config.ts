import { defineConfig } from "@playwright/test";

// Each test serves its own scratch copy of a fixture project through `alukit serve` (see
// tests/e2e/helpers.ts), the way users get the app, so `pnpm build` must run first. One worker
// keeps the machine calm; the tests are few.
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? "github" : "list",
  use: {
    browserName: "chromium",
    viewport: { width: 1280, height: 800 },
    launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] },
  },
});
