import { defineWorkspaceTestConfig } from "../../vitest.shared.js";

export default defineWorkspaceTestConfig({
  test: {
    silent: "passed-only",
    name: "bb-plugin-computer-use",
    include: ["**/*.test.ts", "**/*.test.tsx"],
    exclude: ["node_modules/**"],
  },
});
