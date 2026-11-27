import { defineConfig } from "vitest/config";
import { alukitDev } from "./src/server/dev.ts";

// The app is built to dist/ and served by `alukit serve` (src/server). Vite itself runs only
// while AluKit is developed (design §10): `ALUKIT_PROJECT=<dir> pnpm dev` mounts that project's
// server in it (src/server/dev.ts) and prints the address with its token; a relative <dir> is
// taken from the folder pnpm ran in.
//
// The fonts (src/ui/fonts, IBM Plex) are emitted as files, never inlined as `data:` URIs: the
// server's CSP is `default-src 'self'` with no `font-src`, and `default-src 'self'` refuses data:
// (docs/ux/plan.md D-UX-22). Vite's default would inline any asset under 4 KiB; `false` here means
// "emit a file", and `undefined` leaves the default for every other asset.
export default defineConfig({
  plugins: [alukitDev({ project: process.env.ALUKIT_PROJECT, cwd: process.env.INIT_CWD })],
  build: {
    chunkSizeWarningLimit: 1000,
    outDir: "dist",
    emptyOutDir: true,
    target: "es2023",
    assetsInlineLimit: (file) => (file.endsWith(".woff2") ? false : undefined),
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
