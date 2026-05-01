/**
 * Codegen script — fetches Cursor's official pricing page and the model
 * catalog from the Stigmer proxy, cross-references them by display name,
 * and generates src/adapter/model-pricing-data.ts.
 *
 * Usage:
 *   STIGMER_TOKEN=stg_xxx npm run update-pricing
 *   STIGMER_TOKEN=stg_xxx STIGMER_PROXY_URL=https://... npm run update-pricing
 *
 * Requires:
 *   STIGMER_TOKEN   — authenticates to the Stigmer proxy for the model catalog
 *   STIGMER_PROXY_URL — proxy base URL (defaults to https://api.stigmer.ai)
 */

import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PricingRow {
  displayName: string;
  provider: string;
  inputPricePerMillion: number;
  outputPricePerMillion: number;
  cacheWritePricePerMillion: number;
  cacheReadPricePerMillion: number;
}

export interface ProxyModel {
  id: string;
  displayName: string;
}

export interface GeneratedEntry {
  model: string;
  displayName: string;
  inputPricePerMillion: number;
  outputPricePerMillion: number;
  cacheWritePricePerMillion: number;
  cacheReadPricePerMillion: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PRICING_PAGE_URL = "https://cursor.com/docs/models-and-pricing";
const PRICING_SOURCE_URL = `${PRICING_PAGE_URL}.md`;
const DEFAULT_PROXY_URL = "https://api.stigmer.ai";
const CURSOR_API_HOST = "api2.cursor.sh";

// ---------------------------------------------------------------------------
// Markdown table helpers
// ---------------------------------------------------------------------------

export interface ParsedTable {
  headers: string[];
  rows: string[][];
}

/**
 * Extract all pipe-delimited markdown tables from a markdown string.
 * Returns header names (lowercased) and the raw cell text for each row.
 */
export function extractMarkdownTables(markdown: string): ParsedTable[] {
  const tables: ParsedTable[] = [];
  const lines = markdown.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();

    if (line.startsWith("|") && line.endsWith("|")) {
      const tableLines: string[] = [line];
      i++;
      while (
        i < lines.length &&
        lines[i].trim().startsWith("|") &&
        lines[i].trim().endsWith("|")
      ) {
        tableLines.push(lines[i].trim());
        i++;
      }

      if (tableLines.length >= 3) {
        const splitRow = (l: string) =>
          l
            .split("|")
            .slice(1, -1)
            .map((c) => c.trim());

        const headers = splitRow(tableLines[0]).map((h) => h.toLowerCase());
        const dataRows = tableLines
          .slice(2)
          .map((l) => splitRow(l));
        tables.push({ headers, rows: dataRows });
      }
    } else {
      i++;
    }
  }

  return tables;
}

/** Strip a markdown link `[text](url)` to just `text`. */
export function stripMarkdownLink(cell: string): string {
  const match = cell.match(/^\[([^\]]+)\]\([^)]+\)$/);
  return match ? match[1] : cell;
}

// ---------------------------------------------------------------------------
// Pricing page parser
// ---------------------------------------------------------------------------

/** Parse a price cell like "$3.75" or "-" into a number. */
export function parsePrice(cell: string): number {
  const trimmed = cell.trim();
  if (trimmed === "-" || trimmed === "") return 0;
  const cleaned = trimmed.replace(/^\$/, "").replace(/,/g, "");
  const value = Number(cleaned);
  if (Number.isNaN(value)) {
    throw new Error(`Cannot parse price: "${cell}"`);
  }
  return value;
}

/**
 * Parse the Auto pricing table from the pricing page markdown.
 * Identifies the 2-column table with "token type" + "price" headers.
 */
export function parseAutoPricing(markdown: string): GeneratedEntry {
  let inputAndCacheWrite = 0;
  let output = 0;
  let cacheRead = 0;

  for (const table of extractMarkdownTables(markdown)) {
    if (
      table.headers.length === 2 &&
      table.headers[0].includes("token type") &&
      table.headers[1].includes("price")
    ) {
      for (const row of table.rows) {
        if (row.length < 2) continue;
        const label = row[0].toLowerCase();
        const price = parsePrice(row[1]);

        if (label.includes("input") && label.includes("cache write")) {
          inputAndCacheWrite = price;
        } else if (label.includes("output")) {
          output = price;
        } else if (label.includes("cache read")) {
          cacheRead = price;
        }
      }
      break;
    }
  }

  if (output === 0) {
    throw new Error("Failed to parse Auto pricing table — output price is 0");
  }

  return {
    model: "default",
    displayName: "Auto",
    inputPricePerMillion: inputAndCacheWrite,
    outputPricePerMillion: output,
    cacheWritePricePerMillion: inputAndCacheWrite,
    cacheReadPricePerMillion: cacheRead,
  };
}

/**
 * Parse the Model pricing table from the pricing page markdown.
 * Identifies the multi-column table with Model, Provider, Input, Output headers.
 */
export function parseModelPricingTable(markdown: string): PricingRow[] {
  const results: PricingRow[] = [];

  for (const table of extractMarkdownTables(markdown)) {
    const hasModelCol = table.headers.some((h) => h === "model");
    const hasProviderCol = table.headers.some((h) => h === "provider");
    const hasInputCol = table.headers.some((h) => h === "input");
    const hasOutputCol = table.headers.some((h) => h === "output");

    if (!hasModelCol || !hasProviderCol || !hasInputCol || !hasOutputCol) {
      continue;
    }

    const col = (name: string) => table.headers.findIndex((h) => h === name);
    const modelIdx = col("model");
    const providerIdx = col("provider");
    const inputIdx = col("input");
    const cacheWriteIdx = col("cache write");
    const cacheReadIdx = col("cache read");
    const outputIdx = col("output");

    for (const row of table.rows) {
      if (row.length < table.headers.length) continue;
      const displayName = stripMarkdownLink(row[modelIdx]);
      if (!displayName) continue;

      results.push({
        displayName,
        provider: row[providerIdx] || "",
        inputPricePerMillion: parsePrice(row[inputIdx]),
        outputPricePerMillion: parsePrice(row[outputIdx]),
        cacheWritePricePerMillion:
          cacheWriteIdx >= 0 ? parsePrice(row[cacheWriteIdx]) : 0,
        cacheReadPricePerMillion:
          cacheReadIdx >= 0 ? parsePrice(row[cacheReadIdx]) : 0,
      });
    }
    break;
  }

  return results;
}

// ---------------------------------------------------------------------------
// Proxy model catalog
// ---------------------------------------------------------------------------

export async function fetchModelCatalog(
  proxyUrl: string,
  token: string,
): Promise<ProxyModel[]> {
  const url = `${proxyUrl.replace(/\/+$/, "")}/v1/proxy/cursor/${CURSOR_API_HOST}/v1/models`;
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    throw new Error(
      `Proxy model catalog request failed: ${res.status} ${res.statusText}`,
    );
  }

  const body = await res.json();

  // The Cursor API may return { data: [...] } (OpenAI style) or a raw array.
  const items: unknown[] = Array.isArray(body) ? body : body?.data ?? [];

  return items
    .filter(
      (item): item is { id: string; displayName: string } =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as Record<string, unknown>).id === "string" &&
        typeof (item as Record<string, unknown>).displayName === "string",
    )
    .map(({ id, displayName }) => ({ id, displayName }));
}

// ---------------------------------------------------------------------------
// Cross-reference matching
// ---------------------------------------------------------------------------

export function matchPricingToModels(
  pricingRows: PricingRow[],
  proxyModels: ProxyModel[],
): { matched: GeneratedEntry[]; unmatchedPricing: string[]; unmatchedModels: string[] } {
  const matched: GeneratedEntry[] = [];
  const unmatchedPricing: string[] = [];

  const modelByDisplayName = new Map<string, ProxyModel>();
  for (const m of proxyModels) {
    modelByDisplayName.set(m.displayName.trim().toLowerCase(), m);
  }

  const matchedModelIds = new Set<string>();

  for (const row of pricingRows) {
    const key = row.displayName.trim().toLowerCase();
    const model = modelByDisplayName.get(key);

    if (!model) {
      unmatchedPricing.push(row.displayName);
      continue;
    }

    matchedModelIds.add(model.id);
    matched.push({
      model: model.id,
      displayName: row.displayName,
      inputPricePerMillion: row.inputPricePerMillion,
      outputPricePerMillion: row.outputPricePerMillion,
      cacheWritePricePerMillion: row.cacheWritePricePerMillion,
      cacheReadPricePerMillion: row.cacheReadPricePerMillion,
    });
  }

  const unmatchedModels = proxyModels
    .filter((m) => !matchedModelIds.has(m.id))
    .map((m) => `${m.displayName} (${m.id})`);

  return { matched, unmatchedPricing, unmatchedModels };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function validate(entries: GeneratedEntry[]): void {
  const ids = new Set<string>();
  const errors: string[] = [];

  for (const entry of entries) {
    if (ids.has(entry.model)) {
      errors.push(`Duplicate model ID: "${entry.model}"`);
    }
    ids.add(entry.model);

    if (entry.inputPricePerMillion < 0) {
      errors.push(`${entry.model}: negative input price`);
    }
    if (entry.outputPricePerMillion <= 0) {
      errors.push(`${entry.model}: output price must be > 0`);
    }
    if (entry.cacheWritePricePerMillion < 0) {
      errors.push(`${entry.model}: negative cache write price`);
    }
    if (entry.cacheReadPricePerMillion < 0) {
      errors.push(`${entry.model}: negative cache read price`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Validation failed:\n  ${errors.join("\n  ")}`);
  }
}

// ---------------------------------------------------------------------------
// Code generation
// ---------------------------------------------------------------------------

export function generateTypeScript(
  entries: GeneratedEntry[],
  timestamp: string,
): string {
  const lines: string[] = [
    "/**",
    " * AUTO-GENERATED — do not edit by hand.",
    ` * Generated: ${timestamp}`,
    ` * Sources:`,
    ` *   Pricing: ${PRICING_PAGE_URL}`,
    ` *   Models:  Stigmer proxy → Cursor /v1/models`,
    ` *`,
    ` * Regenerate with: STIGMER_TOKEN=stg_xxx npm run update-pricing`,
    " */",
    "",
    "export interface CursorModelPricing {",
    "  readonly model: string;",
    "  readonly displayName: string;",
    "  readonly inputPricePerMillion: number;",
    "  readonly outputPricePerMillion: number;",
    "  readonly cacheWritePricePerMillion: number;",
    "  readonly cacheReadPricePerMillion: number;",
    "}",
    "",
    "export const PRICING_TABLE: readonly CursorModelPricing[] = [",
  ];

  for (const entry of entries) {
    const fields = [
      `model: ${JSON.stringify(entry.model)}`,
      `displayName: ${JSON.stringify(entry.displayName)}`,
      `inputPricePerMillion: ${entry.inputPricePerMillion}`,
      `outputPricePerMillion: ${entry.outputPricePerMillion}`,
      `cacheWritePricePerMillion: ${entry.cacheWritePricePerMillion}`,
      `cacheReadPricePerMillion: ${entry.cacheReadPricePerMillion}`,
    ].join(", ");
    lines.push(`  { ${fields} },`);
  }

  lines.push("];", "");

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const stigmerToken = process.env.STIGMER_TOKEN;
  const proxyUrl = process.env.STIGMER_PROXY_URL || DEFAULT_PROXY_URL;

  if (!stigmerToken) {
    console.error(
      "Error: STIGMER_TOKEN is required.\n" +
        "Usage: STIGMER_TOKEN=stg_xxx npm run update-pricing",
    );
    process.exit(1);
  }

  // Step 1: Fetch pricing page markdown
  console.log(`Fetching pricing page: ${PRICING_SOURCE_URL}`);
  const pageRes = await fetch(PRICING_SOURCE_URL);
  if (!pageRes.ok) {
    throw new Error(
      `Failed to fetch pricing page: ${pageRes.status} ${pageRes.statusText}`,
    );
  }
  const markdown = await pageRes.text();

  // Step 2: Parse Auto pricing
  console.log("Parsing Auto pricing table...");
  const autoEntry = parseAutoPricing(markdown);
  console.log(
    `  Auto: input=$${autoEntry.inputPricePerMillion}, output=$${autoEntry.outputPricePerMillion}, cacheRead=$${autoEntry.cacheReadPricePerMillion}`,
  );

  // Step 3: Parse Model pricing table
  console.log("Parsing Model pricing table...");
  const pricingRows = parseModelPricingTable(markdown);
  console.log(`  Found ${pricingRows.length} models on pricing page`);

  // Step 4: Fetch model catalog from proxy
  console.log(`Fetching model catalog from proxy: ${proxyUrl}`);
  const proxyModels = await fetchModelCatalog(proxyUrl, stigmerToken);
  console.log(`  Proxy returned ${proxyModels.length} models`);

  // Step 5: Cross-reference
  console.log("Cross-referencing pricing with model catalog...");
  const { matched, unmatchedPricing, unmatchedModels } = matchPricingToModels(
    pricingRows,
    proxyModels,
  );

  // Step 6: Combine Auto + matched models
  const allEntries = [autoEntry, ...matched];

  // Step 7: Validate
  validate(allEntries);

  // Step 8: Generate TypeScript
  const timestamp = new Date().toISOString();
  const code = generateTypeScript(allEntries, timestamp);

  // Step 9: Write file
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const outputPath = resolve(
    __dirname,
    "../src/adapter/model-pricing-data.ts",
  );
  writeFileSync(outputPath, code, "utf-8");

  // Step 10: Summary
  console.log("\n── Summary ──────────────────────────────────────────");
  console.log(`  Matched:   ${matched.length} models`);
  console.log(`  Auto:      1 (always included)`);
  console.log(`  Total:     ${allEntries.length} entries written`);

  if (unmatchedPricing.length > 0) {
    console.log(
      `\n  ⚠ Pricing rows with no matching proxy model (skipped):`,
    );
    for (const name of unmatchedPricing) {
      console.log(`    - ${name}`);
    }
  }

  if (unmatchedModels.length > 0) {
    console.log(
      `\n  ℹ Proxy models with no pricing row (informational):`,
    );
    for (const name of unmatchedModels) {
      console.log(`    - ${name}`);
    }
  }

  console.log(`\n  Output: ${outputPath}`);
  console.log("  Done.");
}

const isDirectExecution =
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isDirectExecution) {
  main().catch((err) => {
    console.error("Fatal:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
