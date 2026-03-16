import type { NextConfig } from "next";

const stigmerLibs = [
  "@stigmer/sdk",
  "@stigmer/react",
  "@stigmer/theme",
];

const nextConfig: NextConfig = {
  output: "export",
  devIndicators: false,
  transpilePackages: stigmerLibs,
};

export default nextConfig;
