import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  typescript: { ignoreBuildErrors: false },
  // oxlint runs as its own script; next lint would need a second config.
  eslint: { ignoreDuringBuilds: true },
  // The forecast page reads the tectonic regime table from disk at request time.
  outputFileTracingIncludes: { "/forecast/[id]": ["./data/oaf/**"] },
};

export default config;
