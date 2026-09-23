import { defineConfig } from "vite";
export default defineConfig({
  root: "waveform",
  // publicDir must be the fixtures directory, not ".": setting it to the root
  // makes Vite serve main.ts verbatim as a static asset instead of transforming
  // it, and the page dies on the first `type` import.
  publicDir: "fixtures",
  server: { port: 5182 },
});
