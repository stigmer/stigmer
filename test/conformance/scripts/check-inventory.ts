// CLI for the cloud-capability inventory check (`npm run inventory:check`).
// Domain: conformance inventory.
//
// Thin wrapper over src/inventory/inventory.ts (the unit-tested logic — the
// same lib/script split the docs inventory uses). Reads
// inventory/cloud-capabilities.yaml, scans src/suites and src/suites-execution
// for `[row.id]` tags, prints every problem and exits 1 if any exist.
//
// Runs in: ci.conformance*.yaml (before any target boots) and `make check`.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { collectTags, computeCoverage, formatSummary, parseInventory } from "../src/inventory/inventory";

const PACKAGE_ROOT = resolve(import.meta.dirname, "..");
const INVENTORY_PATH = resolve(PACKAGE_ROOT, "inventory/cloud-capabilities.yaml");
const SUITE_ROOTS = [resolve(PACKAGE_ROOT, "src/suites"), resolve(PACKAGE_ROOT, "src/suites-execution")];

async function main(): Promise<void> {
  const { inventory, problems: parseProblems } = parseInventory(await readFile(INVENTORY_PATH, "utf8"));
  const tags = await collectTags(SUITE_ROOTS, PACKAGE_ROOT);
  const coverage = computeCoverage(inventory, tags);
  const problems = [...parseProblems, ...coverage.problems];

  for (const problem of problems) {
    console.error(`[inventory:${problem.kind}] ${problem.message}`);
  }
  const metricParts = ["ported", "dropped"]
    .map((d) => `${d} ${inventory.metrics.filter((m) => m.disposition === d).length}`)
    .join(", ");
  console.log(`${formatSummary({ ...coverage, problems }, inventory.rows.length)}; metrics: ${inventory.metrics.length} (${metricParts})`);
  if (problems.length > 0) process.exit(1);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
