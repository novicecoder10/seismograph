import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  // tsconfig sets jsx: "preserve" for Next's compiler; Vitest's esbuild needs an
  // actual runtime, or .tsx tests fail with "React is not defined".
  esbuild: { jsx: "automatic" },
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: {
    globals: true,
    environment: "node",
    include: ["{app,components,lib,test}/**/*.test.{ts,tsx}"],
    exclude: ["spikes/**", "node_modules/**", ".next/**"],
  },
});
