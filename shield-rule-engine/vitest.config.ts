import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = (rel: string): string => fileURLToPath(new URL(rel, import.meta.url));

export default defineConfig({
  test: {
    include: ["packages/**/__tests__/**/*.test.ts", "apps/**/__tests__/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["packages/**/src/**/*.ts"],
    },
  },
  resolve: {
    alias: {
      "@shield/domain": src("./packages/domain/src/index.ts"),
      "@shield/ports": src("./packages/ports/src/index.ts"),
      "@shield/adapters-memory": src("./packages/adapters-memory/src/index.ts"),
      "@shield/adapters-fs": src("./packages/adapters-fs/src/index.ts"),
      "@shield/use-cases": src("./packages/use-cases/src/index.ts"),
    },
  },
});
