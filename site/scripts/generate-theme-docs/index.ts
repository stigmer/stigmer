/**
 * Theme Token Reference Docs Generator
 *
 * Parses the canonical `--stgm-*` token contract from
 * sdk/theme/src/tokens.css (+ the preset CSS files) and produces Fumadocs
 * MDX reference pages under docs/sdk/theme/.
 *
 * The parser is shared with the theme package's contrast-audit suite
 * (sdk/theme/src/contract/) so the docs and the CI contrast gate always
 * read the contract identically.
 *
 * Usage: tsx scripts/generate-theme-docs/index.ts
 * Runs as part of: make gen-theme-docs
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parseThemeCss } from "../../../sdk/theme/src/contract/parse";
import { THEME_PRESETS } from "../../../sdk/theme/src/presets/index";
import { renderPresetsPage, renderTokensPage, type PresetDoc } from "./renderer";

const THEME_SRC_DIR = path.resolve(process.cwd(), "..", "sdk", "theme", "src");

const OUTPUT_DIR =
  process.env.THEME_DOCS_OUTPUT_DIR ??
  path.resolve(process.cwd(), "..", "docs", "sdk", "theme");

async function main(): Promise<void> {
  console.log("[theme-docs] Generating theme token reference documentation...");

  const tokensCss = await fs.readFile(
    path.join(THEME_SRC_DIR, "tokens.css"),
    "utf-8",
  );
  const defaults = parseThemeCss(tokensCss);

  if (defaults.light.size === 0) {
    console.error("[theme-docs] Error: no tokens parsed from tokens.css.");
    process.exit(1);
  }
  const undocumented = [...defaults.light.values()].filter((t) => !t.group);
  if (undocumented.length > 0) {
    console.error(
      `[theme-docs] Error: tokens missing a @group header in tokens.css: ` +
        undocumented.map((t) => t.name).join(", "),
    );
    process.exit(1);
  }

  const presets: PresetDoc[] = [];
  for (const preset of THEME_PRESETS) {
    if (preset.id === "default") continue;
    const css = await fs.readFile(
      path.join(THEME_SRC_DIR, "presets", `${preset.id}.css`),
      "utf-8",
    );
    presets.push({ meta: preset, tokens: parseThemeCss(css) });
  }

  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await fs.writeFile(
    path.join(OUTPUT_DIR, "tokens.mdx"),
    renderTokensPage(defaults),
    "utf-8",
  );
  await fs.writeFile(
    path.join(OUTPUT_DIR, "presets.mdx"),
    renderPresetsPage(defaults, presets),
    "utf-8",
  );

  console.log(
    `[theme-docs] ${defaults.light.size} tokens, ${presets.length} presets — ` +
      `written tokens.mdx + presets.mdx → ${OUTPUT_DIR}`,
  );
}

main().catch((err: unknown) => {
  console.error("[theme-docs] Fatal error:", err);
  process.exit(1);
});
