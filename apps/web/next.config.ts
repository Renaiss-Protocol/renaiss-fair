import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Fully static site — every route prerenders, so export to plain HTML.
  // The deploy workflow publishes the exported `out/` to GitHub Pages.
  output: "export",
  images: { unoptimized: true },
  // Workspace packages ship TypeScript source (JIT), so Next must transpile
  // them like app code rather than treating them as prebuilt node_modules.
  transpilePackages: ["@renaiss/ecvrf", "@renaiss/algorithms", "@renaiss/replay-fair-set", "@renaiss/verifiable-draw"],
  // The site is served from the root of its custom domain (fair.renaiss.xyz),
  // so no base path by default. Set NEXT_BASE_PATH=/renaiss-fair to build for
  // the bare project-page URL (renaiss-protocol.github.io/renaiss-fair).
  ...(process.env["NEXT_BASE_PATH"]
    ? { basePath: process.env["NEXT_BASE_PATH"] }
    : {}),
  typescript: {
    // next build skips type validation — CI runs the dedicated typecheck task.
    ignoreBuildErrors: true,
  },
  experimental: {
    // TypeScript 7 (native) has no JS compiler API; use its CLI instead.
    useTypeScriptCli: true,
  },
};

export default nextConfig;
