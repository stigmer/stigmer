import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postcss, { type Root } from "postcss";
import tailwindcss from "@tailwindcss/postcss";
import { scopeUnprefixedSelectors } from "../../../scripts/lib/scope-unprefixed.js";

/**
 * Compile `src/styles.css` through the exact pipeline `scripts/build-styles.ts`
 * ships: a standalone Tailwind compile (the SDK stylesheet is a self-contained
 * artifact since #454 — client apps and hosts consume the COMPILED file, never
 * the source) followed by the `:where(.stgm, .stgm *)` scoping pass for the
 * selectors the `stg:` prefix cannot cover.
 *
 * Tests that assert on the shipped stylesheet's structure compile it here
 * instead of reading `dist/` so the default unit suite stays hermetic —
 * it must not depend on a prior `npm run build`.
 */
export async function compileSdkStylesheet(): Promise<Root> {
  // The directory of `styles.css` — `@source` globs and relative `@import`s
  // inside it resolve from here, exactly as they do in the shipped build.
  const srcDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const result = await postcss([tailwindcss({ base: srcDir })]).process(
    `@import "./styles.css";`,
    {
      // A virtual entry inside src/ so `@import "./styles.css"` resolves to
      // the real SDK stylesheet under test.
      from: resolve(srcDir, "__styles-probe__.css"),
    },
  );
  const root = postcss.parse(result.css);
  scopeUnprefixedSelectors(root);
  return root;
}
