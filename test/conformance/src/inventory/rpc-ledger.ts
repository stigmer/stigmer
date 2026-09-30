// The RPC ledger: what the call recorder writes, and the measurement read
// from it of how far the conformance suite is from the declared contract.
// Domain: conformance inventory (the RPC contract).
//
// The recorder (src/harness/rpc-recorder.ts), with CONFORMANCE_RPC_LEDGER set,
// appends one line per distinct (target, file, test, rpc) a run sends. Over
// the declared set (rpc-contract.ts) this module sorts every RPC into one of
// four classes:
// - in-test: some test sends it, on at least one target (a tag can go there);
// - hook-only: sent only from suite hooks (`beforeAll`/`afterAll`), which
//   never satisfy a tag;
// - served-only: sent by no suite client, yet a server log of the run shows it
//   served: the runner's and the MCP bridge's own calls, which never pass
//   through the suite's transport;
// - unexercised: none of the above.
// Given the tags the static scan found, it also names every tag no run
// proved: a tag is proven when some test carrying it sent its RPC, on any
// target. A tag in a comment, on a test skipped everywhere, or in a
// parameterized row that never runs satisfies the static check and is proven
// nowhere; this is where that shows.
// The report is a measurement, not a gate: `scripts/report-rpc-ledger.ts`.
import { z } from "zod";
import { extractRpcTags, rpcKey } from "./rpc-tag";

// One distinct call site: a target, a suite file, the test that sent the RPC
// (null for a call made in a suite hook), and the RPC's `<Service>.<method>`.
export interface RpcLedgerLine {
  readonly target: string;
  readonly file: string;
  readonly test: string | null;
  readonly rpc: string;
}

const ledgerLineSchema = z
  .object({
    target: z.string().min(1),
    file: z.string(),
    test: z.string().nullable(),
    rpc: z.string().min(1),
  })
  .strict();

export function parseLedger(text: string, source: string): { lines: RpcLedgerLine[]; problems: string[] } {
  const lines: RpcLedgerLine[] = [];
  const problems: string[] = [];
  text.split("\n").forEach((raw, index) => {
    if (raw.trim() === "") return;
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      problems.push(`${source}:${index + 1}: not JSON`);
      return;
    }
    const parsed = ledgerLineSchema.safeParse(json);
    if (parsed.success) lines.push(parsed.data);
    else problems.push(`${source}:${index + 1}: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`);
  });
  return { lines, problems };
}

// Every RPC a server log shows served, from any caller. The server's logging
// interceptor writes a `procedure: "/<type name>/<method>"` field on every
// outcome line (backend/services/stigmer-server/src/pipeline/interceptors/
// logging.ts), in both of its output shapes (NDJSON, and the console form's
// trailing JSON fields), so one pattern reads either.
const PROCEDURE_PATTERN = /"procedure":"\/([A-Za-z0-9_.]+)\/([A-Za-z0-9_]+)"/g;

export function servedRpcs(logText: string): Set<string> {
  const served = new Set<string>();
  for (const match of logText.matchAll(PROCEDURE_PATTERN)) {
    if (match[1] !== undefined && match[2] !== undefined) served.add(rpcKey(match[1], match[2]));
  }
  return served;
}

export type RpcCoverage = "in-test" | "hook-only" | "served-only" | "unexercised";

export interface RpcLedgerEntry {
  readonly key: string;
  readonly coverage: RpcCoverage;
  // Per target, the `<file> > <test>` of every test that sent it.
  readonly testsByTarget: ReadonlyMap<string, readonly string[]>;
  // The targets on which a suite hook sent it.
  readonly hookTargets: readonly string[];
  readonly served: boolean;
}

export interface LedgerSummary {
  readonly targets: readonly string[];
  readonly entries: readonly RpcLedgerEntry[];
  readonly counts: Readonly<Record<RpcCoverage, number>>;
  // Declared RPCs sent by no test and shown served by no log: the count the
  // measurement's stop threshold reads.
  readonly neitherTestedNorServed: number;
  // Keys the ledger or the logs name that the contract does not declare
  // (gRPC health, an RPC a branch removed).
  readonly outsideContract: readonly string[];
  readonly servedMeasured: boolean;
  // The scanned tags no ledger line proves, sorted; undefined when no tag
  // scan was given.
  readonly unprovenTags: readonly string[] | undefined;
}

export function summarizeLedger(
  declared: readonly string[],
  lines: readonly RpcLedgerLine[],
  served: ReadonlySet<string> | undefined,
  tags?: Iterable<string>,
): LedgerSummary {
  const declaredSet = new Set(declared);
  const tests = new Map<string, Map<string, Set<string>>>();
  const hooks = new Map<string, Set<string>>();
  const outside = new Set<string>();
  const targets = new Set<string>();
  for (const line of lines) {
    targets.add(line.target);
    if (!declaredSet.has(line.rpc)) {
      outside.add(line.rpc);
      continue;
    }
    if (line.test === null) {
      const hookTargets = hooks.get(line.rpc) ?? new Set<string>();
      hookTargets.add(line.target);
      hooks.set(line.rpc, hookTargets);
      continue;
    }
    const byTarget = tests.get(line.rpc) ?? new Map<string, Set<string>>();
    const ids = byTarget.get(line.target) ?? new Set<string>();
    ids.add(`${line.file} > ${line.test}`);
    byTarget.set(line.target, ids);
    tests.set(line.rpc, byTarget);
  }
  for (const key of served ?? []) if (!declaredSet.has(key)) outside.add(key);

  // A line proves a tag when the test that sent the RPC carries the RPC's tag.
  const proven = new Set<string>();
  for (const line of lines) {
    if (line.test !== null && extractRpcTags(line.test).includes(line.rpc)) proven.add(line.rpc);
  }

  const counts: Record<RpcCoverage, number> = { "in-test": 0, "hook-only": 0, "served-only": 0, unexercised: 0 };
  let neitherTestedNorServed = 0;
  const entries = [...declared].sort().map((key): RpcLedgerEntry => {
    const byTarget = tests.get(key);
    const isServed = served?.has(key) ?? false;
    const coverage: RpcCoverage =
      byTarget !== undefined ? "in-test" : hooks.has(key) ? "hook-only" : isServed ? "served-only" : "unexercised";
    counts[coverage] += 1;
    if (byTarget === undefined && !isServed) neitherTestedNorServed += 1;
    return {
      key,
      coverage,
      testsByTarget: new Map([...(byTarget ?? new Map<string, Set<string>>())].map(([target, ids]) => [target, [...ids].sort()])),
      hookTargets: [...(hooks.get(key) ?? [])].sort(),
      served: isServed,
    };
  });
  return {
    targets: [...targets].sort(),
    entries,
    counts,
    neitherTestedNorServed,
    outsideContract: [...outside].sort(),
    servedMeasured: served !== undefined,
    unprovenTags: tags === undefined ? undefined : [...new Set(tags)].filter((key) => !proven.has(key)).sort(),
  };
}

const COVERAGE_LABEL: Readonly<Record<RpcCoverage, string>> = {
  "in-test": "sent in a test",
  "hook-only": "sent only in suite hooks",
  "served-only": "served, sent by no suite client",
  unexercised: "neither sent nor served",
};

// The measurement as Markdown, for an execution log: the counts, one row per
// RPC with its tests per target, and the edition matrix.
export function formatLedgerReport(summary: LedgerSummary): string {
  const out: string[] = [];
  out.push(`Targets: ${summary.targets.join(", ") || "none"}.`, "");
  out.push(`- declared: ${summary.entries.length}`);
  for (const coverage of ["in-test", "hook-only", "served-only", "unexercised"] as const) {
    const note = coverage === "served-only" && !summary.servedMeasured ? " (not measured: no server log given)" : "";
    out.push(`- ${COVERAGE_LABEL[coverage]}: ${summary.counts[coverage]}${note}`);
  }
  out.push(`- sent in no test and served by no log (the stop count): ${summary.neitherTestedNorServed}`);
  if (summary.outsideContract.length > 0) out.push(`- outside the contract: ${summary.outsideContract.join(", ")}`);
  if (summary.unprovenTags === undefined) {
    out.push("- tags proven on no target: not measured (no tag scan given)");
  } else {
    out.push(`- tags proven on no target: ${summary.unprovenTags.length}`);
    for (const key of summary.unprovenTags) out.push(`  - [rpc:${key}]`);
  }

  out.push("", "| RPC | class | tests per target | first test |", "|---|---|---|---|");
  for (const entry of summary.entries) {
    const perTarget = [...entry.testsByTarget].map(([target, ids]) => `${target} ${ids.length}`).join(", ");
    const hooks = entry.hookTargets.length > 0 ? `hooks: ${entry.hookTargets.join(", ")}` : "";
    const first = [...entry.testsByTarget.values()][0]?.[0] ?? "";
    out.push(`| ${entry.key} | ${entry.coverage} | ${[perTarget, hooks].filter(Boolean).join("; ")} | ${escapeCell(first)} |`);
  }

  out.push("", `| RPC | ${summary.targets.join(" | ")} |`, `|---|${summary.targets.map(() => "---|").join("")}`);
  for (const entry of summary.entries) {
    const cells = summary.targets.map((target) =>
      entry.testsByTarget.has(target) ? "T" : entry.hookTargets.includes(target) ? "h" : "·",
    );
    out.push(`| ${entry.key} | ${cells.join(" | ")} |`);
  }
  out.push("", "T: sent in a test on that target; h: sent only in its suite hooks; ·: not sent there.");
  return out.join("\n");
}

function escapeCell(text: string): string {
  return text.replaceAll("|", "\\|");
}
