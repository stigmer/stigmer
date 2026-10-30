import { defineConfig, globalIgnores } from "eslint/config";
import tsParser from "@typescript-eslint/parser";
import stigmerPlugin from "eslint-plugin-stigmer";

export default defineConfig([
  globalIgnores(["dist/**", "node_modules/**", "src-tauri/**"]),
  {
    files: ["src/**/*.ts", "src/**/*.tsx"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { projectService: false },
    },
    plugins: { stigmer: stigmerPlugin },
    rules: {
      "stigmer/sdk-import-boundaries": "error",
      "stigmer/no-native-title": "error",
      "stigmer/no-token-opacity-modifiers": "warn",
      // Every text size comes from the type scale (--stgm-text-* tokens, 11px floor).
      "stigmer/text-size-from-scale": "error",
      // Error (not warn): the stigmer#1473 sweep left zero --stgm-* fallbacks
      // and zero arbitrary colours, so every colour comes from a theme token
      // and this fence starts at zero.
      "stigmer/colours-from-tokens": "error",
      "stigmer/no-main-tokens-in-sidebar": "warn",
    },
  },
]);
