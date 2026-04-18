import { createMDX } from "fumadocs-mdx/next";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "export",
  images: {
    unoptimized: true,
  },
  transpilePackages: [
    "@stigmer/react",
    "@stigmer/sdk",
    "@stigmer/theme",
    "@stigmer/protos",
  ],
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.alias["msw/node"] = false;
    }
    return config;
  },
};

const withMDX = createMDX();

export default withMDX(nextConfig);
