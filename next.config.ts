import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  typescript: { ignoreBuildErrors: false },
  // oxlint runs as its own script; next lint would need a second config.
  eslint: { ignoreDuringBuilds: true },
  // Pages that read data files from disk at request time.
  outputFileTracingIncludes: { "/forecast/[id]": ["./data/oaf/**"], "/scoreboard": ["./ledger/**"], "/section/[id]": ["./public/data/slab2.bin"], "/compare/[id]": ["./data/sequences/**"], "/api/analyst": ["./data/sequences/**"], "/api/v1/forecast/[id]": ["./data/oaf/**"], "/api/v1/scoreboard": ["./ledger/**"] },
};

export default config;
