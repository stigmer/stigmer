import { createMDX } from "fumadocs-mdx/next";
import type { NextConfig } from "next";
import { resolve } from "path";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "export",
  images: {
    unoptimized: true,
  },
  outputFileTracingRoot: resolve(__dirname, ".."),
};

const withMDX = createMDX();

export default withMDX(nextConfig);
