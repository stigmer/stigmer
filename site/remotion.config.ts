import { Config } from "@remotion/cli/config";
import { enableTailwind } from "@remotion/tailwind-v4";
import TsconfigPathsPlugin from "tsconfig-paths-webpack-plugin";

Config.overrideWebpackConfig((config) => {
  const withTailwind = enableTailwind(config);
  return {
    ...withTailwind,
    resolve: {
      ...withTailwind.resolve,
      plugins: [
        ...(withTailwind.resolve?.plugins ?? []),
        new TsconfigPathsPlugin(),
      ],
    },
  };
});
