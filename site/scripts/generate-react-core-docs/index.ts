/**
 * React core reference docs generator.
 *
 * Reads TypeDoc JSON from @stigmer/react-core (`npm run typedoc:json` in
 * sdk/react-core) and writes one Fumadocs MDX reference page and its
 * meta.json under docs/sdk/react-core/.
 *
 * Usage: tsx scripts/generate-react-core-docs/index.ts
 * Runs as part of: make gen-react-core-docs
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parseTypeDocJson } from "./parser";
import { renderMetaJson, renderReferencePage } from "./renderer";

const API_JSON_PATH = path.resolve(process.cwd(), "..", "sdk", "react-core", "dist", "api.json");
const OUTPUT_DIR = process.env.REACT_CORE_DOCS_OUTPUT_DIR ?? path.resolve(process.cwd(), "..", "docs", "sdk", "react-core");

async function main(): Promise<void> {
  try {
    await fs.access(API_JSON_PATH);
  } catch {
    console.error(`[react-core-docs] ${API_JSON_PATH} does not exist. Run 'cd sdk/react-core && npm run typedoc:json' first.`);
    process.exit(1);
  }
  const reference = await parseTypeDocJson(API_JSON_PATH);
  if (reference.exports.length === 0) {
    console.error("[react-core-docs] no exports found in the TypeDoc output.");
    process.exit(1);
  }
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await fs.writeFile(path.join(OUTPUT_DIR, "reference.mdx"), renderReferencePage(reference), "utf-8");
  await fs.writeFile(path.join(OUTPUT_DIR, "meta.json"), renderMetaJson(), "utf-8");
  console.log(`[react-core-docs] ${reference.exports.length} exports → ${OUTPUT_DIR}`);
}

main().catch((err: unknown) => {
  console.error("[react-core-docs] Fatal error:", err);
  process.exit(1);
});
