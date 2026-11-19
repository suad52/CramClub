import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // @ovr/shared ships TypeScript source from the monorepo.
  transpilePackages: ["@ovr/shared"],
};

export default nextConfig;
