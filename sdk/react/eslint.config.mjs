import { defineConfig, globalIgnores } from "eslint/config";
import tsParser from "@typescript-eslint/parser";
import stigmerPlugin from "eslint-plugin-stigmer";

export default defineConfig([
  globalIgnores(["dist/**", "node_modules/**"]),
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
      // Error (not warn): the oss#373 sweep left zero violations, so the
      // fence can hold the line from day one.
      "stigmer/no-hardcoded-backdrop": "error",
      "stigmer/no-token-opacity-modifiers": "warn",
      "stigmer/no-main-tokens-in-sidebar": "warn",
    },
  },
]);
