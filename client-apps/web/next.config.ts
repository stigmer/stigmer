import type { NextConfig } from "next";

const stigmerLibs = [
  "@stigmer/apis",
  "@stigmer/client",
  "@stigmer/react-core",
  "@stigmer/react-sdk",
  "@stigmer/design-tokens",
  "@stigmer/embed",
  "@stigmer/plugin-package",
  "@stigmer/session-log",
  "@stigmer/tool-vocabulary",
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
