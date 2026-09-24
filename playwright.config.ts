import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "test/e2e",
  testMatch: /.*\.e2e\.ts/,
  timeout: 120_000,
  reporter: [["list"]],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 180_000,
  },
  use: {
    baseURL: "http://localhost:3000",
    headless: true,
    // Phase 0: only --use-angle=vulkan reaches the host GPU. Both --use-gl=egl
    // and --use-angle=gl-egl silently fall back to SwiftShader, whose software
    // fill rate makes any WebGL measurement meaningless.
    launchOptions: {
      args: [
        "--use-angle=vulkan",
        "--enable-gpu",
        "--ignore-gpu-blocklist",
        "--enable-features=Vulkan",
      ],
    },
  },
});
