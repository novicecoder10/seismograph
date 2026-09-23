import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.e2e\.ts/,
  timeout: 600_000,
  use: {
    headless: true,
    // Ask for hardware GL. Headless Chromium falls back to SwiftShader when the
    // host has no usable GPU; __spike.renderer records which one actually ran.
    launchOptions: {
      // --use-angle=vulkan is the only backend that reaches the host GPU here;
      // --use-gl=egl and --use-angle=gl-egl both fall back to SwiftShader, whose
      // fill-rate collapse under additive blending makes its numbers meaningless.
      args: [
        "--use-angle=vulkan",
        "--enable-gpu",
        "--ignore-gpu-blocklist",
        "--enable-features=Vulkan",
      ],
    },
  },
  reporter: [["list"]],
});
