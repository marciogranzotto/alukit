import { defineConfig } from "vitest/config";

// The app is built to dist/ and served by `alukit serve` (src/server). Vite itself runs only
// while AluKit is developed (design §10).
export default defineConfig({
  build: { chunkSizeWarningLimit: 1000, outDir: "dist", emptyOutDir: true, target: "es2023" },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
