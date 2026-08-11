/**
 * Builds `dist/styles.css` — the published, host-isolated SDK stylesheet
 * (stigmer/stigmer#454).
 *
 * Two stages:
 *
 * 1. The Tailwind CLI compiles `src/styles.css` (minified). The `prefix(stg)`
 *    on the Tailwind imports makes every utility class and theme variable
 *    collision-free by NAME (`.stg\:flex`, `--stg-color-*`).
 * 2. `scripts/lib/scope-unprefixed.ts` scopes what the prefix cannot cover
 *    (the unlayered xyflow stylesheet and the `@layer properties` `--tw-*`
 *    initial-value block) under `:where(.stgm, .stgm *)` — see that module
 *    for the full rationale.
 *
 * The output contract — every selector is `stg:`-prefixed, `.stgm`-scoped,
 * `stgm-`-prefixed, or in a named allowlist — is enforced independently by
 * `src/__tests__/styles-dist-isolation.test.ts`.
 *
 * Dev note: `npm run build:css:watch` runs the raw Tailwind CLI without
 * stage 2 (fine for iteration: stage 2 only affects xyflow edge cascade and
 * cross-version `--tw-*` hygiene). Run `npm run build:css` for the shippable
 * artifact.
 */

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postcss from "postcss";
import { scopeUnprefixedSelectors } from "./lib/scope-unprefixed.js";

const sdkRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distFile = join(sdkRoot, "dist", "styles.css");

const cli = spawnSync(
  "npx",
  ["tailwindcss", "-i", "src/styles.css", "-o", "dist/styles.css", "--minify"],
  { cwd: sdkRoot, stdio: "inherit" },
);
if (cli.status !== 0) process.exit(cli.status ?? 1);

const root = postcss.parse(readFileSync(distFile, "utf8"));
scopeUnprefixedSelectors(root);
writeFileSync(distFile, root.toString());
console.log(`build-styles: wrote ${distFile}`);
