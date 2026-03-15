import type { NextConfig } from "next";

const stigmerLibs = [
  "@stigmer/rpc-client",
  "@stigmer/theme",
  "@stigmer/agent-execution-ui",
];

const nextConfig: NextConfig = {
  output: "export",
  devIndicators: false,
  transpilePackages: stigmerLibs,
};

export default nextConfig;
