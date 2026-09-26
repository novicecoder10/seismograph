import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // A dev server and a production server must never share a build directory:
  // `next dev` rewrites .next while `next start` serves from it, and the
  // running site then 400s on every chunk a navigation needs, so links on an
  // already-loaded page silently stop working. `npm run dev` uses .next-dev.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  typescript: { ignoreBuildErrors: false },
  // oxlint runs as its own script; next lint would need a second config.
  eslint: { ignoreDuringBuilds: true },
  // Pages that read data files from disk at request time.
  outputFileTracingIncludes: { "/forecast/[id]": ["./data/oaf/**"], "/event/[id]": ["./data/oaf/**"], "/api/analyst": ["./data/sequences/**", "./data/oaf/**"], "/scoreboard": ["./ledger/**"], "/section/[id]": ["./public/data/slab2.bin"], "/compare/[id]": ["./data/sequences/**"], "/api/v1/forecast/[id]": ["./data/oaf/**"], "/api/v1/scoreboard": ["./ledger/**"] },
};

export default config;
