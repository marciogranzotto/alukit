import { defineConfig } from "vitest/config";
import { alukitDev } from "./src/server/dev.ts";

// The app is built to dist/ and served by `alukit serve` (src/server). Vite itself runs only
// while AluKit is developed (design §10): `ALUKIT_PROJECT=<dir> pnpm dev` mounts that project's
// server in it (src/server/dev.ts) and prints the address with its token; a relative <dir> is
// taken from the folder pnpm ran in.
export default defineConfig({
  plugins: [alukitDev({ project: process.env.ALUKIT_PROJECT, cwd: process.env.INIT_CWD })],
  build: { chunkSizeWarningLimit: 1000, outDir: "dist", emptyOutDir: true, target: "es2023" },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
