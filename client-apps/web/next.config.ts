import type { NextConfig } from "next";

const stigmerLibs = [
  "@stigmer/protos",
  "@stigmer/sdk",
  "@stigmer/react",
  "@stigmer/theme",
];

const isProduction = process.env.NODE_ENV === "production";

const nextConfig: NextConfig = {
  output: isProduction ? "export" : undefined,
  devIndicators: false,
  transpilePackages: stigmerLibs,
  turbopack: {
    rules: {
      "*.ts": [{ loaders: ["./turbopack-js-to-ts-loader.js"] }],
      "*.tsx": [{ loaders: ["./turbopack-js-to-ts-loader.js"] }],
    },
  },
};

export default nextConfig;
