// The call recorder: every conformance RPC is attributed to the test that
// sent it, and a test whose title claims an RPC it never sent fails by name.
// Domain: conformance harness (the RPC contract's call verdict).
//
// A `[rpc:<Service>.<method>]` tag in a test's title (src/inventory/rpc-tag.ts)
// claims the test pins that RPC. A title can claim what the body never sends,
// so the claim is checked where every call passes: `createTransport` installs
// this interceptor on every transport every target builds, local and cloud.
// When a test ends, each tag in its full name (the describe chain joined with
// " > ", so a describe-level tag binds every test under it) must be among the
// RPCs the test sent; otherwise the test fails with `tag-without-call`.
//
// The two halves:
// - rpc-verdict-setup.ts, in every suite config's `setupFiles`, opens each
//   test's attempt before the test's own hooks run and registers its verdict
//   as the test's first finished hook. vitest runs finished hooks last
//   registered first, so the verdict runs after `afterEach` and the test's own
//   cleanups, and judges every call the test made, a test that sent nothing
//   included.
// - The interceptor records each call into the open attempt; a call with none
//   open was made from a suite hook (`beforeAll`/`afterAll`), is recorded
//   apart, and never satisfies a tag.
//
// This module imports nothing from `vitest`: importing it outside a vitest
// process throws, and the `tsx` benchmark sends through this transport too.
// Outside a vitest worker (`VITEST_WORKER_ID` unset: the benchmark, vitest's
// main process running a global setup) the interceptor only passes the call
// on. Inside a worker whose config does not load the setup file, a call
// rejects rather than leaving every tag unjudged.
//
// With CONFORMANCE_RPC_LEDGER=<dir> set, every distinct (target, file, test,
// rpc) is also appended to `<dir>/<pid>.jsonl`, with `test: null` for a call
// made in a suite hook; `scripts/report-rpc-ledger.ts` reads the directory.
//
// Its limits, each closed elsewhere or ruled out by the suite's own shape:
// - A call in `beforeEach`, `afterEach` or a test's own finished hook counts
//   as the test's; the reviewer judges what a test asserts.
// - `it.fails` flips a test's result after its finished hooks, so the verdict
//   cannot fail one; a tagged test is never `it.fails`.
// - Calls another process sends (the runner, the MCP bridge) never pass
//   through this transport and are not seen here.
import { appendFileSync, mkdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { Interceptor } from "@connectrpc/connect";
import type { RpcLedgerLine } from "../inventory/rpc-ledger";
import { extractRpcTags, rpcKey } from "../inventory/rpc-tag";

const PACKAGE_ROOT = fileURLToPath(new URL("../..", import.meta.url));

const inWorker = process.env.VITEST_WORKER_ID !== undefined;

// What the setup file hands over: where the running file is, read through
// vitest's `expect.getState()`, which this module cannot import.
export interface RpcVerdictHost {
  readonly currentFile: () => string | undefined;
}

let host: RpcVerdictHost | undefined;

export function installRpcVerdict(installed: RpcVerdictHost): void {
  host = installed;
}

export const rpcRecorder: Interceptor = (next) => async (req) => {
  if (!inWorker) return next(req);
  if (host === undefined) {
    throw new Error(
      "rpc-verdict: this vitest run does not load src/harness/rpc-verdict-setup.ts in setupFiles, so no tag can be judged",
    );
  }
  record(host, rpcKey(req.service.typeName, req.method.name));
  return next(req);
};

// The verdict on one test: undefined when every tag in its full name was
// sent, else the failure message naming what it claimed and what it sent.
export function judge(testName: string, sent: ReadonlySet<string>): string | undefined {
  const missing = [...new Set(extractRpcTags(testName))].filter((key) => !sent.has(key));
  if (missing.length === 0) return undefined;
  const sentList = sent.size === 0 ? "nothing" : [...sent].sort().join(", ");
  return `tag-without-call: "${testName}" claims ${missing.join(", ")} but sent only ${sentList}`;
}

// One run of one test, from its first hook to its verdict.
interface Attempt {
  readonly name: string;
  readonly sent: Set<string>;
}

let open: Attempt | undefined;

// Opens the running test's attempt; the setup file calls it from its
// `beforeEach` and hands the returned verdict to `onTestFinished`. The verdict
// closes the attempt, then judges only a test that passed: a failed test is
// not judged again, and a skipped one never ran.
export function beginTest(name: string): (state: string | undefined) => void {
  const attempt: Attempt = { name, sent: new Set() };
  open = attempt;
  return (state) => {
    if (open === attempt) open = undefined;
    if (state !== "pass") return;
    const failure = judge(attempt.name, attempt.sent);
    if (failure !== undefined) throw new Error(failure);
  };
}

function record(installed: RpcVerdictHost, rpc: string): void {
  open?.sent.add(rpc);
  writeLedger(installed.currentFile(), open?.name ?? null, rpc);
}

const ledgerDir = process.env.CONFORMANCE_RPC_LEDGER;
const ledgerWritten = new Set<string>();
let ledgerDirMade = false;

function writeLedger(testPath: string | undefined, test: string | null, rpc: string): void {
  if (ledgerDir === undefined || ledgerDir === "") return;
  const line: RpcLedgerLine = {
    // createTarget's own default: a run that names no target runs `local`.
    target: process.env.CONFORMANCE_TARGET ?? "local",
    file: testPath === undefined ? "" : relative(PACKAGE_ROOT, testPath),
    test,
    rpc,
  };
  const serialized = JSON.stringify(line);
  if (ledgerWritten.has(serialized)) return;
  ledgerWritten.add(serialized);
  if (!ledgerDirMade) {
    mkdirSync(ledgerDir, { recursive: true });
    ledgerDirMade = true;
  }
  appendFileSync(join(ledgerDir, `${process.pid}.jsonl`), `${serialized}\n`);
}
