// CLI for the RPC ledger's measurement:
//   npx tsx scripts/report-rpc-ledger.ts <ledger dir> [--served <server log>]... [--json <out.json>]
// Domain: conformance inventory (the RPC contract).
//
// Thin wrapper over src/inventory/rpc-ledger.ts (the unit-tested logic, the
// same lib/script split check-inventory.ts uses). A ledger directory is what
// suite runs write with CONFORMANCE_RPC_LEDGER=<dir> set, one `<pid>.jsonl`
// per worker, any number of targets into one directory. Each `--served` log
// (a server's or the cloud composition's, at LOG_LEVEL info or lower) adds the
// RPCs it shows served, which is how RPCs only the runner or the MCP bridge
// send are told apart from RPCs nothing exercised. The suite sources are
// scanned for `[rpc:...]` tags, and every tag no run proved is listed. Prints
// Markdown; `--json` also writes every RPC's tests per target, the input for
// tagging.
//
// A measurement, not a gate: it exits 0 whatever it counts, and 1 only when an
// input is unreadable or malformed.
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { collectRpcTags, declaredRpcs } from "../src/inventory/rpc-contract";
import { formatLedgerReport, parseLedger, servedRpcs, summarizeLedger, type RpcLedgerLine } from "../src/inventory/rpc-ledger";

const PACKAGE_ROOT = resolve(import.meta.dirname, "..");
const SUITE_ROOTS = [resolve(PACKAGE_ROOT, "src/suites"), resolve(PACKAGE_ROOT, "src/suites-execution")];

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      served: { type: "string", multiple: true },
      json: { type: "string" },
    },
  });
  const ledgerDir = positionals[0];
  if (ledgerDir === undefined || positionals.length > 1) {
    console.error("usage: report-rpc-ledger.ts <ledger dir> [--served <server log>]... [--json <out.json>]");
    process.exit(2);
  }

  const lines: RpcLedgerLine[] = [];
  const problems: string[] = [];
  for (const name of (await readdir(ledgerDir)).filter((file) => file.endsWith(".jsonl")).sort()) {
    const parsed = parseLedger(await readFile(join(ledgerDir, name), "utf8"), name);
    lines.push(...parsed.lines);
    problems.push(...parsed.problems);
  }
  for (const problem of problems) console.error(`[rpc-ledger] ${problem}`);
  if (problems.length > 0) process.exit(1);

  let served: Set<string> | undefined;
  for (const log of values.served ?? []) {
    served ??= new Set<string>();
    for (const key of servedRpcs(await readFile(log, "utf8"))) served.add(key);
  }

  const summary = summarizeLedger(
    (await declaredRpcs()).map((rpc) => rpc.key),
    lines,
    served,
    (await collectRpcTags(SUITE_ROOTS, PACKAGE_ROOT)).map((tag) => tag.key),
  );
  console.log(formatLedgerReport(summary));

  if (values.json !== undefined) {
    const byRpc = Object.fromEntries(
      summary.entries.map((entry) => [
        entry.key,
        {
          coverage: entry.coverage,
          served: entry.served,
          hookTargets: entry.hookTargets,
          tests: Object.fromEntries(entry.testsByTarget),
        },
      ]),
    );
    await writeFile(values.json, `${JSON.stringify(byRpc, null, 2)}\n`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exit(1);
});
