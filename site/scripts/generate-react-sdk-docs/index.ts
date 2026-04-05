/**
 * React SDK Reference Docs Generator
 *
 * Reads TypeDoc JSON from @stigmer/react and produces per-domain Fumadocs
 * MDX reference pages under docs/sdk/react/.
 *
 * Usage: tsx scripts/generate-react-sdk-docs/index.ts
 * Runs as part of: make gen-react-sdk-docs
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parseTypeDocJson } from "./parser";
import { renderDomainPage, renderMetaJson, renderSummaryJson } from "./renderer";

const API_JSON_PATH = path.resolve(
  process.cwd(),
  "..",
  "sdk",
  "react",
  "dist",
  "api.json",
);

const OUTPUT_DIR =
  process.env.REACT_SDK_DOCS_OUTPUT_DIR ??
  path.resolve(process.cwd(), "..", "docs", "sdk", "react");

const SUMMARY_JSON_PATH = path.resolve(
  process.cwd(),
  "src",
  "data",
  "react-sdk-summary.json",
);

async function main(): Promise<void> {
  console.log("[react-sdk-docs] Generating React SDK reference documentation...");

  try {
    await fs.access(API_JSON_PATH);
  } catch {
    console.error(`[react-sdk-docs] Error: ${API_JSON_PATH} does not exist.`);
    console.error(
      "[react-sdk-docs] Run 'cd sdk/react && npm run typedoc:json' first.",
    );
    process.exit(1);
  }

  const { domains, warnings } = await parseTypeDocJson(API_JSON_PATH);

  if (domains.length === 0) {
    console.error("[react-sdk-docs] Error: no domains found in TypeDoc output.");
    process.exit(1);
  }

  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  for (const domain of domains) {
    const mdx = renderDomainPage(domain);
    await fs.writeFile(path.join(OUTPUT_DIR, `${domain.slug}.mdx`), mdx, "utf-8");
  }

  const metaJson = renderMetaJson(domains);
  await fs.writeFile(path.join(OUTPUT_DIR, "meta.json"), metaJson, "utf-8");

  await fs.mkdir(path.dirname(SUMMARY_JSON_PATH), { recursive: true });
  const summaryJson = renderSummaryJson(domains);
  await fs.writeFile(SUMMARY_JSON_PATH, summaryJson, "utf-8");

  // Summary
  const totalHooks = domains.reduce((n, d) => n + d.hooks.length, 0);
  const totalComponents = domains.reduce((n, d) => n + d.components.length, 0);
  const totalTypes = domains.reduce((n, d) => n + d.types.length, 0);

  console.log(
    `[react-sdk-docs] ${domains.length} domains — ` +
      `${totalHooks} hooks, ${totalComponents} components, ${totalTypes} standalone types`,
  );

  for (const d of domains) {
    const parts: string[] = [];
    if (d.hooks.length) parts.push(`${d.hooks.length} hooks`);
    if (d.components.length) parts.push(`${d.components.length} components`);
    if (d.types.length) parts.push(`${d.types.length} types`);
    console.log(`[react-sdk-docs]   ${d.slug}: ${parts.join(", ")}`);
  }

  if (warnings.length > 0) {
    console.log(`[react-sdk-docs] ${warnings.length} warning(s):`);
    for (const w of warnings) {
      console.log(`[react-sdk-docs]   ${w}`);
    }
  }

  console.log(
    `[react-sdk-docs] Written ${domains.length} pages + meta.json → ${OUTPUT_DIR}`,
  );
  console.log(
    `[react-sdk-docs] Written react-sdk-summary.json → ${SUMMARY_JSON_PATH}`,
  );
}

main().catch((err: unknown) => {
  console.error("[react-sdk-docs] Fatal error:", err);
  process.exit(1);
});
