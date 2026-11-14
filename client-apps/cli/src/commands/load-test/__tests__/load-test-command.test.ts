// Tests for `stigmer load-test` end to end through the command
// (commands/load-test/index.ts) over a scripted server: the flags are
// checked before anything is sent; the budget is said on stderr before the
// burst, split into each run's share; stdout holds only the report (a table
// and its summary, or a clean JSON document under -o json), while the
// progress and the cleanup line go to stderr; the burst exits 0 whatever it
// found, 1 when the cleanup left something (listed), and 130 after Ctrl-C
// once the cleanup ran. The progress line is rewritten in place on a
// terminal, its time ticking, and printed per change off one.

import { Code } from "@connectrpc/connect";
import { StigmerError } from "@stigmer/client";
import { ExitCode } from "@stigmer/client/exit-codes";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../../../config/index.js";
import { CliExitError } from "../../../errors/cli-exit-error.js";
import { UsageError } from "../../../errors/usage-error.js";
import { setServerAddress } from "../../../runtime.js";
import { completes, LoadTestServer, runOf, type TurnScript } from "../../__test-utils__/load-test-server.js";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { frameOf, phase, user } from "../../../resources/__test-utils__/session-events.js";
import { cleanupLine, DEFAULT_MESSAGE, parseFlags, progressPrinter, registerLoadTest } from "../index.js";

const CONFIG: Config = {
  backend: {},
  backends: { cloud: { type: "cloud", token: "test-token" } },
  current_backend: "cloud",
  context: { org: "acme" },
};

// A server that holds one organization: the config names none.
const SOLO: Config = { ...CONFIG, context: undefined };

const PLAN = "Your organization is at its plan's number of agents running at once.";

const backend = vi.hoisted(() => ({ server: undefined as unknown, address: true, solo: false }));

vi.mock("../../../backend.js", () => ({
  connectBackend: () => {
    if (backend.address) setServerAddress({ address: "https://api.example.com", source: "config" } as never);
    return { config: backend.solo ? SOLO : CONFIG, stigmer: backend.server };
  },
}));

async function run(args: string[]): Promise<{ stdout: string; stderr: string; error?: unknown }> {
  const out: string[] = [];
  const err: string[] = [];
  const stdout = vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
    out.push(String(chunk));
    return true;
  });
  const stderr = vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
    err.push(String(chunk));
    return true;
  });
  let error: unknown;
  try {
    const program = new Command().exitOverride().option("--org <org>").enablePositionalOptions();
    registerLoadTest(program);
    await program.parseAsync(["node", "stigmer", ...args]);
  } catch (e) {
    error = e;
  } finally {
    stdout.mockRestore();
    stderr.mockRestore();
  }
  return { stdout: out.join(""), stderr: err.join(""), error };
}

function serve(scripts: TurnScript[]): LoadTestServer {
  const server = new LoadTestServer(scripts);
  backend.server = server;
  return server;
}

beforeEach(() => {
  vi.stubEnv("STIGMER_ORG", "");
  backend.address = true;
  backend.solo = false;
  setServerAddress(undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("stigmer load-test", () => {
  it("says the budget first, prints only the report on stdout under -o json, and exits 0", async () => {
    const server = serve([completes("run_1"), { refuse: new StigmerError("resource-exhausted", PLAN, Code.ResourceExhausted) }]);
    const { stdout, stderr, error } = await run(["load-test", "--agents", "2", "-o", "json"]);

    expect(error).toBeUndefined();
    const report = JSON.parse(stdout) as { org: string; server: string; shareUsd: number; counts: Record<string, number>; agent: string };
    expect(report).toMatchObject({ org: "acme", server: "https://api.example.com", shareUsd: 0.5, counts: { started: 1, refused: 1 } });
    expect(report.agent).toMatch(/^load-test-[a-z0-9]+$/);
    expect(server.runsMade[0]).toMatchObject({ message: DEFAULT_MESSAGE, runConfig: { maxCostUsd: 0.5 } });
    expect(stderr.split("\n").slice(0, 2)).toEqual([
      "Starting 2 agents at once in acme on https://api.example.com.",
      "Budget $1.00, split across the runs: each stops once it has spent $0.50. One model call can go past a run's share.",
    ]);
    expect(stderr).toContain("2 sent · 0 started · 1 waiting · 1 refused · 0s\n");
    expect(stderr).toContain("Cleaned up: deleted 1 conversation and the agent.\n");
  });

  it("prints the table and summary by default, with the flags it was given", async () => {
    const server = serve([completes("run_1")]);
    const { stdout, stderr, error } = await run(["--org", "beta", "load-test", "--agents", "1", "--model", "claude-haiku-4-5", "--message", "Hi.", "--max-usd", "0.2", "--wait-minutes", "1"]);

    expect(error).toBeUndefined();
    expect(server.runsMade[0]).toMatchObject({ org: "beta", message: "Hi.", runConfig: { maxCostUsd: 0.2, modelName: "claude-haiku-4-5" } });
    expect(stdout.split("\n")[0]).toBe("#   START     TO START   WAITED FOR A SANDBOX   ENDING      COST");
    expect(stdout).toContain("1 agent: 1 started.\n");
    expect(stdout).toContain("No run reported waiting for a sandbox during the burst.\n");
    expect(stderr.split("\n")[0]).toBe("Starting 1 agent at once in beta on https://api.example.com.");
  });

  it("names no organization or server it does not know", async () => {
    backend.address = false;
    backend.solo = true;
    serve([completes("run_1")]);
    const { stdout, stderr } = await run(["load-test", "--agents", "1", "-o", "yaml"]);
    expect(stderr.split("\n")[0]).toBe("Starting 1 agent at once.");
    expect(stdout).toContain("org: \"\"\n");
  });

  it("exits 1 when the cleanup left something, after listing it", async () => {
    const server = serve([completes("run_1")]);
    server.undeletableSessions.add("ses_1");
    const { stdout, stderr, error } = await run(["load-test", "--agents", "1", "-o", "json"]);

    expect((error as CliExitError).exitCode).toBe(ExitCode.General);
    expect(stderr).toContain("Could not delete, remove by hand: conversation ses_1\n");
    expect((JSON.parse(stdout) as { leftBehind: string[] }).leftBehind).toEqual(["conversation ses_1"]);
  });

  it("on Ctrl-C cleans up, reports what it saw, and exits 130", async () => {
    const pending = { frames: [frameOf(user("run_1", "hi")), frameOf(phase("run_1", "pending"))], run: runOf({ phase: RunPhase.RUN_PENDING }) };
    const server = serve([pending]);
    server.onAllFollowing = () => process.emit("SIGINT");
    const { stdout, error } = await run(["load-test", "--agents", "1", "-o", "json"]);

    expect((error as CliExitError).exitCode).toBe(ExitCode.Interrupted);
    expect(server.terminated).toEqual(["run_1"]);
    expect(server.sessionsDeleted).toEqual(["ses_1"]);
    expect((JSON.parse(stdout) as { counts: { stillWaiting: number } }).counts.stillWaiting).toBe(1);
    expect(process.listenerCount("SIGINT")).toBe(0);
  });

  it("lets a refusal before the burst exit with its own error, sending no turn", async () => {
    const server = serve([]);
    server.agentCreateRefusal = new StigmerError("permission-denied", "not a member", Code.PermissionDenied);
    const { error } = await run(["load-test", "--agents", "3"]);
    expect((error as StigmerError).code).toBe("permission-denied");
    expect(server.runsMade).toEqual([]);
  });
});

describe("parseFlags", () => {
  it("refuses a count, a budget or a watch it cannot use", () => {
    for (const agents of [undefined, "0", "1.5", "many"]) {
      expect(() => parseFlags({ agents })).toThrow(new UsageError("--agents takes a whole number of at least 1"));
    }
    expect(() => parseFlags({ agents: "2", maxUsd: "0" })).toThrow("--max-usd takes an amount above 0, in US dollars");
    expect(() => parseFlags({ agents: "2", waitMinutes: "-1" })).toThrow("--wait-minutes takes a number of minutes above 0");
    expect(parseFlags({ agents: "25" })).toEqual({ agents: 25, maxUsd: 1, waitMinutes: 20 });
  });
});

describe("cleanupLine", () => {
  it("says what was deleted, or what is left", () => {
    expect(cleanupLine(6, [])).toBe("Cleaned up: deleted 6 conversations and the agent.\n");
    expect(cleanupLine(0, [])).toBe("Cleaned up: deleted the agent.\n");
    expect(cleanupLine(2, ["conversation ses_1", "agent agt_1"])).toBe("Could not delete, remove by hand: conversation ses_1, agent agt_1\n");
  });
});

describe("progressPrinter", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("rewrites one line in place on a terminal, its time ticking, and ends it once", () => {
    vi.useFakeTimers();
    const written: string[] = [];
    let clock = 0;
    const printer = progressPrinter({ isTTY: true, write: (t) => written.push(t) > 0 }, (ms) => `${ms / 1000}s`, () => clock);
    printer.update({ sent: 6, started: 3, waiting: 2, refused: 1 });
    clock = 42_000;
    vi.advanceTimersByTime(1000);
    printer.stop();
    printer.stop();
    expect(written).toEqual([
      "\r\u001b[2K6 sent · 3 started · 2 waiting · 1 refused · 0s",
      "\r\u001b[2K6 sent · 3 started · 2 waiting · 1 refused · 42s",
      "\n",
    ]);
  });

  it("prints a line per change off a terminal, leaving out refusals when there are none", () => {
    const written: string[] = [];
    const printer = progressPrinter({ write: (t) => written.push(t) > 0 }, () => "1s", () => 0);
    printer.update({ sent: 2, started: 0, waiting: 2, refused: 0 });
    printer.update({ sent: 2, started: 1, waiting: 1, refused: 0 });
    printer.stop();
    expect(written).toEqual(["2 sent · 0 started · 2 waiting · 1s\n", "2 sent · 1 started · 1 waiting · 1s\n"]);
  });
});
