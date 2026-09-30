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
// How it knows the running test, using vitest's public API only:
// - `expect.getState()` names the test (`currentTestName`) and its file
//   (`testPath`). The name is set before each test and never cleared, so in
//   an `afterAll` it still names the file's last test; it cannot tell alone
//   whether a test is running.
// - `onTestFinished` can: it throws when no test is current. The first call
//   of each test registers the verdict through it, and a registration that
//   throws means the call came from `beforeAll` or `afterAll`. Such calls
//   are recorded apart and never satisfy a tag.
// - The verdict's handler receives the test's own context and judges only a
//   test that passed: a failed test is not judged again, a skipped one never
//   ran.
//
// Outside a vitest worker (`VITEST_WORKER_ID` unset: the `tsx` benchmark,
// vitest's main process running a global setup) the interceptor only passes
// the call on. Importing `vitest` there throws, so it is loaded lazily, and
// only inside a worker; once loaded it is used synchronously. A failed load
// inside a worker rejects the call instead of leaving the verdict silently
// off.
//
// With CONFORMANCE_RPC_LEDGER=<dir> set, every distinct (target, file, test,
// rpc) is also appended to `<dir>/<pid>.jsonl`, with `test: null` for a call
// made in a suite hook; `scripts/report-rpc-ledger.ts` reads the directory.
//
// Its limits, each closed elsewhere or ruled out by the suite's own shape:
// - A tagged test that sends nothing registers no verdict, and neither does
//   one whose first call is made from its own `onTestFinished` cleanup (vitest
//   never runs a finished-hook registered while the finished hooks run). A
//   per-test setup file closes both; it is a vitest config change.
// - A call in `beforeEach` or `afterEach` counts as the test's.
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

type VitestApi = Pick<typeof import("vitest"), "expect" | "onTestFinished">;

const PACKAGE_ROOT = fileURLToPath(new URL("../..", import.meta.url));

// Started at load inside a worker, so the first call rarely waits; the
// derived catch keeps a failed load from surfacing as an unhandled rejection
// before any call awaits it (the call then rejects with the load's error).
let vitestApi: VitestApi | undefined;
const vitestLoad: Promise<VitestApi> | undefined =
  process.env.VITEST_WORKER_ID === undefined
    ? undefined
    : import("vitest").then((loaded) => {
        vitestApi = loaded;
        return loaded;
      });
vitestLoad?.catch(() => undefined);

export const rpcRecorder: Interceptor = (next) => async (req) => {
  if (vitestLoad === undefined) return next(req);
  const api = vitestApi ?? (await vitestLoad);
  record(api, rpcKey(req.service.typeName, req.method.name));
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

// One run of one test, from its first call to its verdict.
interface Attempt {
  readonly key: string;
  readonly name: string;
  readonly sent: Set<string>;
}

let open: Attempt | undefined;

function record(api: VitestApi, rpc: string): void {
  const state = api.expect.getState();
  const attempt = currentAttempt(api, state.testPath ?? "", state.currentTestName);
  attempt?.sent.add(rpc);
  writeLedger(state.testPath, attempt?.name ?? null, rpc);
}

// The running test's attempt, opened (and its verdict registered) on the
// test's first call; undefined when no test is running. A verdict that ran
// clears its attempt; one whose registration vitest dropped (a first call made
// from the test's own finished hook) leaves it open, so an open attempt under
// another key is replaced, never reused: its test has ended.
function currentAttempt(api: VitestApi, testPath: string, testName: string | undefined): Attempt | undefined {
  if (testName === undefined) return undefined;
  const key = `${testPath}\u0000${testName}`;
  if (open !== undefined && open.key === key) return open;
  const attempt: Attempt = { key, name: testName, sent: new Set() };
  try {
    api.onTestFinished((context) => {
      if (open === attempt) open = undefined;
      if (context.task.result?.state !== "pass") return;
      const failure = judge(attempt.name, attempt.sent);
      if (failure !== undefined) throw new Error(failure);
    });
  } catch (error) {
    // vitest's refusal outside a test is the probe's answer. Any other error
    // is not, and surfaces on the call rather than disabling the verdict.
    if (error instanceof Error && error.message.includes("can only be called inside a test")) return undefined;
    throw error;
  }
  open = attempt;
  return attempt;
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
