import type { NextConfig } from "next";

const stigmerLibs = [
  "@stigmer/sdk",
  "@stigmer/react",
  "@stigmer/theme",
];

const isProduction = process.env.NODE_ENV === "production";

const nextConfig: NextConfig = {
  output: isProduction ? "export" : undefined,
  devIndicators: false,
  transpilePackages: stigmerLibs,
};

export default nextConfig;
