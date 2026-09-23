import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.e2e\.ts/,
  timeout: 120_000,
  use: { headless: true },
  reporter: [["list"]],
});
