import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.ts", "tests/**/*.test.mjs"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.ts"],
      thresholds: {
        // Project-wide floors cover the v2-only editor and the authenticated bootstrap.
        statements: 78,
        branches: 70,
        functions: 84,
        lines: 85
      }
    }
  }
});
