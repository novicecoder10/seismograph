import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: {
    globals: true,
    environment: "node",
    include: ["{app,components,lib,test}/**/*.test.{ts,tsx}"],
    exclude: ["spikes/**", "node_modules/**", ".next/**"],
  },
});
