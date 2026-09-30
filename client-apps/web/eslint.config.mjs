import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import stigmerPlugin from "eslint-plugin-stigmer";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "**/dist/**",
    "next-env.d.ts",
    // Build artifact copied from @stigmer/embed by scripts/copy-embed-loader.ts.
    "public/embed.js",
  ]),
  {
    files: ["**/*.ts", "**/*.tsx", "**/*.mts"],
    plugins: { stigmer: stigmerPlugin },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "stigmer/no-main-tokens-in-sidebar": "warn",
      "stigmer/no-native-title": "error",
      "stigmer/no-token-opacity-modifiers": "warn",
      "stigmer/sdk-import-boundaries": "error",
    },
  },
  {
    files: ["src/**/*.ts", "src/**/*.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "next/font/google",
              message:
                "next/font/google downloads the font from Google during every build, so a failed fetch fails the build (stigmer#1508). Vendor the files into src/app/fonts and load them with next/font/local in src/app/fonts/fonts.ts.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["_libs/**/*.ts", "_libs/**/*.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/*"],
              message:
                "Library packages must not import from the console via @/ paths. Use @stigmer/* package imports instead.",
            },
          ],
        },
      ],
      "@next/next/no-img-element": "off",
    },
  },
]);

export default eslintConfig;
