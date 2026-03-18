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
  async rewrites() {
    return [
      {
        source: "/api/fs/:path*",
        destination: "http://localhost:8234/api/fs/:path*",
      },
    ];
  },
};

export default nextConfig;
