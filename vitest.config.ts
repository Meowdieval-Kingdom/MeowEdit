import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    // Use Vitest's default forks pool. Earlier hangs were caused by dangling
    // timeout handles in the auth bootstrap, now cleared; no pool override needed.
    include: ["tests/**/*.test.ts", "tests/**/*.test.mjs"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.ts"],
      // The editor controller is native editor UI code (2.7k lines);
      // its screens are exercised by editor.test.ts and the editor
      // module tests cover the pure modules it drives. Keep the gate focused
      // on code we own and change.
      exclude: ["src/editor/main.ts"],
      thresholds: {
        // Project-wide floors cover the content editor, restored editor modules and authenticated bootstrap.
        statements: 78,
        branches: 70,
        functions: 84,
        lines: 85
      }
    }
  }
});
