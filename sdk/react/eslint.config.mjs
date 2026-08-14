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
      // Same posture: the oss#653 sweep converged every <dialog> onto the
      // DialogShell primitive, so this fence starts at zero violations.
      "stigmer/no-handrolled-dialog": "error",
      "stigmer/no-literal-dom-ids": "error",
      "stigmer/no-token-opacity-modifiers": "warn",
      "stigmer/no-main-tokens-in-sidebar": "warn",
      // Error (not warn): the #695 sweep left zero violations — every UI
      // list carries UNSTYLED_LIST and every content list declares its
      // list-* style, so this fence too starts at zero.
      "stigmer/require-list-reset": "error",
    },
  },
  {
    // Tests mount components once and control their own DOM — literal ids
    // there are not a collision class, so the fence stays out of them.
    // Bare lists are likewise legitimate fixtures there (the #695 layout
    // suite renders unreset elements on purpose to assert UA behavior).
    files: ["src/**/__tests__/**", "src/**/*.test.ts", "src/**/*.test.tsx"],
    plugins: { stigmer: stigmerPlugin },
    rules: {
      "stigmer/no-literal-dom-ids": "off",
      "stigmer/require-list-reset": "off",
    },
  },
]);
