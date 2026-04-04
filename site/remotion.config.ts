import { Config } from "@remotion/cli/config";
import { webpackOverride } from "./video/webpack";

Config.overrideWebpackConfig(webpackOverride);
