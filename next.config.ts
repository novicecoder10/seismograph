import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  typescript: { ignoreBuildErrors: false },
  // oxlint runs as its own script; next lint would need a second config.
  eslint: { ignoreDuringBuilds: true },
};

export default config;
