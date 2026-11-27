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
//
// The chunks (docs/ux/integration-decisions.md): three.js and camera-controls, the viewer's
// libraries, in two chunks of their own, `three-core` and `three`, which the page preloads beside
// the app's; and the parts only some flows need (a sheet other than the cut list, project
// settings, the corner inspector, the start card's example, the schema behind did-you-mean) in
// chunks that load when the flow opens (`src/ui/lazy.tsx`, `import()`). Every chunk stays under Vite's default size
// advice (500 kB), so the build sets no `chunkSizeWarningLimit`: a warning means a chunk to split.
export default defineConfig({
  plugins: [alukitDev({ project: process.env.ALUKIT_PROJECT, cwd: process.env.INIT_CWD })],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2023",
    assetsInlineLimit: (file) => (file.endsWith(".woff2") ? false : undefined),
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            // three's own build is two files: three.core.js (shared with its WebGPU renderer) and
            // three.module.js (the WebGL renderer and its shader library); a chunk each.
            {
              name: "three-core",
              test: /[\\/]node_modules[\\/]three[\\/]build[\\/]three\.core\./,
              priority: 3,
            },
            {
              name: "three",
              test: /[\\/]node_modules[\\/](three|camera-controls)[\\/]/,
              priority: 2,
            },
            // Everything else the page imports statically stays in the entry's chunk. Once any
            // group is set, rolldown no longer merges the modules the entry shares with a lazy
            // chunk into the entry, and leaves them in seven small chunks of their own (measured).
            { name: "index", tags: ["$initial"], priority: 1 },
          ],
        },
      },
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
