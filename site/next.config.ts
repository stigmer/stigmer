import { createMDX } from "fumadocs-mdx/next";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "export",
  images: {
    unoptimized: true,
  },
  transpilePackages: [
    "@stigmer/embed",
    "@stigmer/react-core",
    "@stigmer/react-sdk",
    "@stigmer/client",
    "@stigmer/design-tokens",
    "@stigmer/apis",
  ],
  experimental: {
    // The pricing page, a server component, imports @stigmer/react-sdk's plan
    // vocabulary by name. Without this, importing from the package's barrel
    // makes every client component it re-exports part of that page's bundle.
    optimizePackageImports: ["@stigmer/react-sdk"],
  },
  webpack: (config, { isServer }) => {
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
    };
    if (!isServer) {
      config.resolve.alias["msw/node"] = false;
    }
    return config;
  },
};

const withMDX = createMDX();

export default withMDX(nextConfig);
