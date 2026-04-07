import { enableTailwind } from "@remotion/tailwind-v4";
import TsconfigPathsPlugin from "tsconfig-paths-webpack-plugin";
import webpack from "webpack";
import type { WebpackOverrideFn } from "@remotion/bundler";

/**
 * Shared webpack override used by both the Remotion CLI
 * (`remotion.config.ts`) and the programmatic render script
 * (`scripts/render-videos.ts`).
 *
 * Adds four things to the default Remotion webpack config:
 * 1. Tailwind v4 CSS processing
 * 2. tsconfig path aliases (so `@/` imports resolve)
 * 3. ESM module resolution fix for `@stigmer/theme` extensionless imports
 * 4. ProvidePlugin for React — Remotion's esbuild loader compiles JSX
 *    to React.createElement() but the built-in react-shim entry runs
 *    after user modules load, so modules that reference React during
 *    initialization fail with "React is not defined".
 */
export const webpackOverride: WebpackOverrideFn = (config) => {
  const withTailwind = enableTailwind(config);
  return {
    ...withTailwind,
    plugins: [
      ...(withTailwind.plugins ?? []),
      new webpack.ProvidePlugin({
        React: "react",
      }),
    ],
    resolve: {
      ...withTailwind.resolve,
      plugins: [
        ...(withTailwind.resolve?.plugins ?? []),
        new TsconfigPathsPlugin(),
      ],
    },
    module: {
      ...withTailwind.module,
      rules: [
        ...(withTailwind.module?.rules ?? []),
        {
          test: /\.m?js$/,
          resolve: { fullySpecified: false },
        },
      ],
    },
  };
};
