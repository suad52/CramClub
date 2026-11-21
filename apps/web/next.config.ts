import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The library's bottom-left corner holds the lesson preview; keep the dev badge out of its way.
  devIndicators: { position: "bottom-right" },
  // @ovr/shared ships TypeScript source from the monorepo.
  transpilePackages: ["@ovr/shared"],
};

export default nextConfig;
