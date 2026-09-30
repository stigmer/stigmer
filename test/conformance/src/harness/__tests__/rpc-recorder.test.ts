// Unit arms for the call recorder: the verdict's decision, and the mechanism
// itself, run for real, so that a vitest upgrade that changes what the
// recorder relies on turns these red instead of switching the verdict off.
// Domain: conformance harness (the RPC contract's call verdict).
//
// The mechanism arms run fixtures/rpc-verdict/verdict.fixture.ts in a vitest
// of its own (run-fixture.ts explains why it is a separate process and why
// the fixture is not a `*.test.ts`) and read its JSON report and ledger. The
// last arm sends a call from a plain `tsx` process, the live benchmark's
// path. No target, no server: every call goes to a port nothing listens on.
import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RpcLedgerLine } from "../../inventory/rpc-ledger";
import { judge } from "../rpc-recorder";

const run = promisify(execFile);
const PACKAGE_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const FIXTURES = fileURLToPath(new URL("./fixtures/rpc-verdict/", import.meta.url));

// The child must not believe it is this worker: vitest's own variables are
// dropped, so the nested run and the plain process each start from nothing.
function childEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (!name.startsWith("VITEST") && name !== "CONFORMANCE_RPC_LEDGER") env[name] = value;
  }
  return { ...env, ...extra };
}

async function runTsx(script: string, args: readonly string[], env: NodeJS.ProcessEnv): Promise<string> {
  const { stdout } = await run(process.execPath, ["--import", "tsx", script, ...args], {
    cwd: PACKAGE_ROOT,
    env,
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout;
}

describe("judge", () => {
  const sent = new Set(["AgentQueryController.get", "AgentCommandController.create"]);

  it("passes a test that sent every RPC its name claims, or claims none", () => {
    expect(judge("[rpc:AgentQueryController.get] reads", sent)).toBeUndefined();
    expect(judge("[rpc:AgentQueryController.get] [rpc:AgentCommandController.create] both", sent)).toBeUndefined();
    expect(judge("untagged > sends whatever", sent)).toBeUndefined();
  });

  it("fails a test that claims an RPC it never sent, naming the claim and what it sent", () => {
    expect(judge("[rpc:AgentQueryController.list] lists", sent)).toBe(
      'tag-without-call: "[rpc:AgentQueryController.list] lists" claims AgentQueryController.list but sent only AgentCommandController.create, AgentQueryController.get',
    );
  });

  it("reads a describe-level tag from the full name, and says so when nothing was sent", () => {
    expect(judge("[rpc:AgentQueryController.get] the facet > reads", new Set())).toBe(
      'tag-without-call: "[rpc:AgentQueryController.get] the facet > reads" claims AgentQueryController.get but sent only nothing',
    );
  });
});

interface AssertionResult {
  readonly fullName: string;
  readonly status: string;
  readonly failureMessages: readonly string[];
}

interface JsonReport {
  readonly testResults: ReadonlyArray<{ readonly message: string; readonly assertionResults: readonly AssertionResult[] }>;
}

describe("the verdict, run by vitest", () => {
  let dir: string;
  let results: Map<string, AssertionResult>;
  let fileMessage: string;
  let ledger: RpcLedgerLine[];

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "rpc-verdict-"));
    const reportPath = join(dir, "report.json");
    const ledgerDir = join(dir, "ledger");
    await runTsx(join(FIXTURES, "run-fixture.ts"), [join(FIXTURES, "verdict.fixture.ts"), reportPath], childEnv({ CONFORMANCE_RPC_LEDGER: ledgerDir }));
    const report = JSON.parse(await readFile(reportPath, "utf8")) as JsonReport;
    const file = report.testResults[0];
    if (file === undefined) throw new Error(`the fixture run reported no file: ${JSON.stringify(report)}`);
    fileMessage = file.message;
    results = new Map(file.assertionResults.map((result) => [result.fullName, result]));
    ledger = [];
    for (const name of await readdir(ledgerDir)) {
      const text = await readFile(join(ledgerDir, name), "utf8");
      ledger.push(...text.split("\n").filter(Boolean).map((raw) => JSON.parse(raw) as RpcLedgerLine));
    }
  }, 120_000);

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function result(fullName: string): AssertionResult {
    const found = results.get(fullName);
    if (found === undefined) throw new Error(`the fixture reported no "${fullName}"; it reported: ${[...results.keys()].join(" | ")}`);
    return found;
  }

  it("passes a tagged test that sends its RPC", () => {
    expect(result("[rpc:AgentQueryController.get] honest: sends the RPC it claims").status).toBe("passed");
  });

  it("fails a tagged test that never sends its RPC, by name, with tag-without-call", () => {
    const lying = result("[rpc:AgentCommandController.create] lying: claims an RPC it never sends");
    expect(lying.status).toBe("failed");
    expect(lying.failureMessages.join("\n")).toContain(
      'tag-without-call: "[rpc:AgentCommandController.create] lying: claims an RPC it never sends" claims AgentCommandController.create but sent only AgentQueryController.get',
    );
  });

  it("does not judge again a test that failed on its own", () => {
    const failing = result("[rpc:AgentCommandController.delete] failing: fails on its own before the verdict");
    expect(failing.status).toBe("failed");
    expect(failing.failureMessages).toHaveLength(1);
    expect(failing.failureMessages[0]).not.toContain("tag-without-call");
  });

  it("gives each test its own verdict, even after a test whose verdict vitest dropped", () => {
    expect(result("[rpc:AgentQueryController.get] cleanup-only: sends its RPC only from its own finished hook").status).toBe("passed");
    const after = result(
      "[rpc:AgentCommandController.create] after-cleanup-only: claims an RPC it never sends, after a dropped registration",
    );
    expect(after.status).toBe("failed");
    expect(after.failureMessages.join("\n")).toContain("tag-without-call");
  });

  it("binds a describe-level tag to every test under it", () => {
    expect(result("[rpc:AgentQueryController.get] a describe-level tag binds the test under it, which sends it").status).toBe("passed");
    const other = result("[rpc:AgentQueryController.get] a describe-level tag binds the test under it, which sends something else");
    expect(other.status).toBe("failed");
    expect(other.failureMessages.join("\n")).toContain("tag-without-call");
  });

  it("records suite-hook calls apart, never charged to a test, and never refuses them", () => {
    // The afterAll's call would reject with vitest's "inside a test" error, and
    // fail the file, if the recorder charged it to the file's last test.
    expect(fileMessage).toBe("");
    expect(result("[rpc:AgentQueryController.get] last: sends the RPC it claims before the suite's afterAll").status).toBe("passed");
    const hookLines = ledger.filter((line) => line.test === null).map((line) => line.rpc).sort();
    expect(hookLines).toEqual(["AgentCommandController.create", "AgentQueryController.get"]);
    const lastLines = ledger.filter((line) => line.test?.startsWith("[rpc:AgentQueryController.get] last:"));
    expect(lastLines.map((line) => line.rpc)).toEqual(["AgentQueryController.get"]);
  });

  it("writes one ledger line per distinct call site, naming the fixture's file", () => {
    const keys = ledger.map((line) => JSON.stringify(line));
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(ledger.map((line) => line.file))).toEqual(new Set(["src/harness/__tests__/fixtures/rpc-verdict/verdict.fixture.ts"]));
  });
});

describe("outside vitest", () => {
  it("stays out of the way: a plain tsx process gets the transport's own error, not vitest's", async () => {
    const stdout = await runTsx(join(FIXTURES, "send-outside-vitest.ts"), [], childEnv());
    const outcome = JSON.parse(stdout.trim().split("\n").at(-1) ?? "{}") as { outcome?: string; message?: string };
    expect(outcome.outcome, outcome.message).toBe("connect-error");
    expect(outcome.message).not.toContain("Vitest");
  }, 60_000);
});
