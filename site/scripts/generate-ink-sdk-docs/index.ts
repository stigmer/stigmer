/**
 * Ink SDK Reference Docs Generator
 *
 * Reads TypeDoc JSON from @stigmer/ink and produces a single Fumadocs
 * MDX reference page under docs/sdk/ink/.
 *
 * Usage: tsx scripts/generate-ink-sdk-docs/index.ts
 * Runs as part of: make gen-ink-sdk-docs
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parseTypeDocJson } from "./parser";
import { renderReferencePage, renderMetaJson } from "./renderer";

const API_JSON_PATH = path.resolve(
  process.cwd(),
  "..",
  "sdk",
  "ink",
  "dist",
  "api.json",
);

const OUTPUT_DIR =
  process.env.INK_SDK_DOCS_OUTPUT_DIR ??
  path.resolve(process.cwd(), "..", "docs", "sdk", "ink");

async function main(): Promise<void> {
  console.log("[ink-sdk-docs] Generating Ink SDK reference documentation...");

  try {
    await fs.access(API_JSON_PATH);
  } catch {
    console.error(`[ink-sdk-docs] Error: ${API_JSON_PATH} does not exist.`);
    console.error(
      "[ink-sdk-docs] Run 'cd sdk/ink && npm run typedoc:json' first.",
    );
    process.exit(1);
  }

  const { reference, warnings } = await parseTypeDocJson(API_JSON_PATH);

  if (reference.exports.length === 0) {
    console.error("[ink-sdk-docs] Error: no exports found in TypeDoc output.");
    process.exit(1);
  }

  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const mdx = renderReferencePage(reference);
  await fs.writeFile(path.join(OUTPUT_DIR, "reference.mdx"), mdx, "utf-8");

  const metaJson = renderMetaJson();
  await fs.writeFile(path.join(OUTPUT_DIR, "meta.json"), metaJson, "utf-8");

  const byCategory = new Map<string, number>();
  for (const exp of reference.exports) {
    byCategory.set(exp.category, (byCategory.get(exp.category) ?? 0) + 1);
  }

  console.log(
    `[ink-sdk-docs] ${reference.exports.length} exports — ` +
      [...byCategory.entries()]
        .map(([cat, count]) => `${count} ${cat}`)
        .join(", "),
  );

  if (warnings.length > 0) {
    console.log(`[ink-sdk-docs] ${warnings.length} warning(s):`);
    for (const w of warnings) {
      console.log(`[ink-sdk-docs]   ${w}`);
    }
  }

  console.log(
    `[ink-sdk-docs] Written reference.mdx + meta.json → ${OUTPUT_DIR}`,
  );
}

main().catch((err: unknown) => {
  console.error("[ink-sdk-docs] Fatal error:", err);
  process.exit(1);
});
