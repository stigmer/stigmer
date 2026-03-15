import type { NextConfig } from "next";

const stigmerLibs = [
  "@stigmer/rpc-client",
  "@stigmer/theme",
  "@stigmer/agent-execution",
  "@stigmer/agent",
  "@stigmer/mcp-server",
  "@stigmer/session",
  "@stigmer/skill",
];

const nextConfig: NextConfig = {
  output: "export",
  devIndicators: false,
  transpilePackages: stigmerLibs,
};

export default nextConfig;
