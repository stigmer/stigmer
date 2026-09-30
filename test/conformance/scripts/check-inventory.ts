// CLI for the conformance inventory checks (`npm run inventory:check`).
// Domain: conformance inventory.
//
// Thin wrapper over the unit-tested logic (the same lib/script split the docs
// inventory uses), running two static checks and failing if either finds a
// problem:
// - the cloud-capability inventory (src/inventory/inventory.ts): reads
//   inventory/cloud-capabilities.yaml and scans src/suites and
//   src/suites-execution for `[row.id]` tags;
// - the RPC contract (src/inventory/rpc-contract.ts): every RPC the API
//   declares carries an `[rpc:<Service>.<method>]` tag on a suite test or a
//   waiver in inventory/rpc-waivers.yaml, and every tag and waiver names a
//   declared RPC.
// Prints every problem and one summary line per check; exits 1 if any exist.
//
// Runs in: the Class A conformance workflow (ci.conformance.yaml, before any
// target boots), `make check-conformance-inventory` and `make check-node`.
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { collectTags, computeCoverage, formatSummary, parseInventory } from "../src/inventory/inventory";
import { collectRpcTags, computeRpcContract, declaredRpcs, formatRpcSummary, parseRpcWaivers } from "../src/inventory/rpc-contract";

const PACKAGE_ROOT = resolve(import.meta.dirname, "..");
const REPO_ROOT = resolve(PACKAGE_ROOT, "../..");
const INVENTORY_PATH = resolve(PACKAGE_ROOT, "inventory/cloud-capabilities.yaml");
const RPC_WAIVERS_PATH = resolve(PACKAGE_ROOT, "inventory/rpc-waivers.yaml");
const SUITE_ROOTS = [resolve(PACKAGE_ROOT, "src/suites"), resolve(PACKAGE_ROOT, "src/suites-execution")];

// A `proven_by` path is repository-relative; undefined when it names no file.
function readProof(repoPath: string): string | undefined {
  try {
    return readFileSync(resolve(REPO_ROOT, repoPath), "utf8");
  } catch {
    return undefined;
  }
}

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

  const { waivers, problems: waiverProblems } = parseRpcWaivers(await readFile(RPC_WAIVERS_PATH, "utf8"));
  const contract = computeRpcContract({
    declared: await declaredRpcs(),
    tags: await collectRpcTags(SUITE_ROOTS, PACKAGE_ROOT),
    waivers,
    readProof,
  });
  const rpcProblems = [...waiverProblems, ...contract.problems];
  for (const problem of rpcProblems) {
    console.error(`[rpc-contract:${problem.kind}] ${problem.message}`);
  }
  console.log(formatRpcSummary(contract, rpcProblems.length));

  if (problems.length > 0 || rpcProblems.length > 0) process.exit(1);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
