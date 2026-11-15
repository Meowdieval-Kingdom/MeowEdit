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
        // These project-wide floors include browser startup and event wiring in main.ts.
        statements: 78,
        branches: 70,
        functions: 84,
        lines: 85,
        "src/main.ts": {
          perFile: { statements: 70, branches: 58, functions: 72, lines: 77 }
        }
      }
    }
  }
});
