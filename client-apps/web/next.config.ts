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
