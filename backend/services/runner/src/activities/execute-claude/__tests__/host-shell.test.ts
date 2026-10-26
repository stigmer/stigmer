/**
 * Pins the Claude engine's shell as the agent host serves it
 * (`host-shell.ts`): the command runs only under the gate's allow for its
 * own call, in the workspace's directory, with exactly the environment the
 * turn hands its caller (the main agent's, or a sub-agent's own), its
 * output streamed under the call's id, and every way it
 * can end (an exit code, its timeout, the turn's stop, a shell that never
 * started) reported as a failure the model reads.
 *
 * Why the verdict is read here: the endpoint admits a call only under its
 * allow (`loopback-mcp.ts`, `gate.ts` `admit`), and the verdict names the
 * caller whose environment the command runs in; a call with no allow runs
 * nothing even so. Each refusal is proven by a marker file the command
 * would have created. Why the environment is exact: the command is the
 * agent's, and nothing of the runner's (a token, a key) may reach it.
 */

import { existsSync } from "node:fs";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ROOT_CALLER, type Caller, type GateVerdict } from "../gate.js";
import { DEFAULT_SHELL_TIMEOUT_MS, HOST_SHELL_TOOL, hostShellServer, isHostShell, runShellCall, timeoutOf, type HostShellOptions } from "../host-shell.js";
import type { ServedCall } from "../loopback-mcp.js";
import { connectServed } from "../__test-utils__/served-client.js";

/** An allow for a shell call, judged as `caller`. */
function allowFor(caller: Caller = ROOT_CALLER): GateVerdict {
  return { kind: "allow", source: undefined, caller, toolName: HOST_SHELL_TOOL.aliasedName, args: {}, rewritten: false, hook: undefined, context: [] };
}

const ALLOW = allowFor();

let cwd: string;
let verdicts: Map<string, GateVerdict>;
let outputs: { id: string; chunk: string }[];
let activity: string[];
let stop: AbortController;

beforeEach(async () => {
  cwd = await realpath(await mkdtemp(join(tmpdir(), "claude-shell-")));
  verdicts = new Map();
  outputs = [];
  activity = [];
  stop = new AbortController();
});
afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

function options(overrides: Partial<HostShellOptions> = {}): HostShellOptions {
  return {
    cwd,
    envFor: () => ({ PATH: process.env.PATH ?? "/usr/bin:/bin" }),
    maxTimeoutSeconds: 600,
    gate: { verdictOf: (id) => verdicts.get(id) },
    stopSignal: stop.signal,
    onOutput: (id, chunk) => outputs.push({ id, chunk }),
    onActivity: (detail) => activity.push(detail),
    ...overrides,
  };
}

function bash(toolUseId: string, args: Record<string, unknown>): ServedCall {
  return { server: HOST_SHELL_TOOL.server, tool: HOST_SHELL_TOOL.tool, args, toolUseId };
}

function textOf(result: CallToolResult): string {
  return result.content.map((block) => (block.type === "text" ? block.text : "")).join("");
}

describe("timeoutOf", () => {
  it("takes the engine's default when the model names none, or names something that is not a positive number", () => {
    const fallback = { timeoutSeconds: DEFAULT_SHELL_TIMEOUT_MS / 1000, clamped: false };
    for (const requested of [undefined, null, "5000", Number.NaN, Number.POSITIVE_INFINITY, 0, -10]) {
      expect(timeoutOf(requested, 600), String(requested)).toEqual(fallback);
    }
  });

  it("rounds milliseconds up to whole seconds", () => {
    expect(timeoutOf(1, 600)).toEqual({ timeoutSeconds: 1, clamped: false });
    expect(timeoutOf(1500, 600)).toEqual({ timeoutSeconds: 2, clamped: false });
  });

  it("clamps to the runner's ceiling and says so, and leaves a bound at the ceiling alone", () => {
    expect(timeoutOf(600_000, 300)).toEqual({ timeoutSeconds: 300, clamped: true });
    expect(timeoutOf(undefined, 60), "the default too").toEqual({ timeoutSeconds: 60, clamped: true });
    expect(timeoutOf(300_000, 300)).toEqual({ timeoutSeconds: 300, clamped: false });
  });
});

describe("the shell's names", () => {
  it("knows its own aliased name and nothing else", () => {
    expect(isHostShell("mcp__stigmer__bash")).toBe(true);
    expect(isHostShell("Bash")).toBe(false);
    expect(isHostShell("mcp__other__bash")).toBe(false);
  });
});

describe("runShellCall", () => {
  it("refuses a call the gate made no decision for, and runs nothing", async () => {
    const marker = join(cwd, "ran");
    const result = await runShellCall(options(), bash("toolu_undecided", { command: `touch ${marker}` }));
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe("The gate allowed no such call; it was not run.");
    expect(existsSync(marker)).toBe(false);
    expect(outputs).toEqual([]);
  });

  it("refuses a call the gate denied or paused, and runs nothing", async () => {
    const marker = join(cwd, "ran");
    verdicts.set("toolu_denied", { kind: "refuse", message: "Denied by policy: no touching.", source: undefined, caller: ROOT_CALLER, hook: undefined, byPerson: false });
    verdicts.set("toolu_paused", { kind: "pause", message: "Run touch?", source: "builtin_category", caller: ROOT_CALLER, toolName: HOST_SHELL_TOOL.aliasedName, args: {}, hook: undefined });
    verdicts.set("toolu_other", ALLOW);
    for (const id of ["toolu_denied", "toolu_paused"]) {
      const result = await runShellCall(options(), bash(id, { command: `touch ${marker}` }));
      expect(result.isError).toBe(true);
      expect(textOf(result)).toBe("The gate allowed no such call; it was not run.");
    }
    expect(existsSync(marker), "another call's allow is not this call's").toBe(false);
  });

  it("refuses an empty command, or one that is not a string, even when allowed", async () => {
    verdicts.set("toolu_1", ALLOW);
    for (const args of [{ command: "" }, { command: "   \n" }, { command: 42 }, {}]) {
      const result = await runShellCall(options(), bash("toolu_1", args));
      expect(result.isError, JSON.stringify(args)).toBe(true);
      expect(textOf(result)).toBe("No command was given.");
    }
  });

  it("runs an allowed command in the workspace's directory with exactly the environment given", async () => {
    process.env.STIGMER_RUNNER_ONLY_SECRET = "must-not-leak";
    try {
      verdicts.set("toolu_env", ALLOW);
      const env = { PATH: process.env.PATH ?? "/usr/bin:/bin", AGENT_VALUE: "from-the-run" };
      const result = await runShellCall(options({ envFor: () => env }), bash("toolu_env", { command: "pwd -P; env" }));
      expect(result.isError).toBeUndefined();
      const [dir, ...envLines] = textOf(result).trim().split("\n");
      expect(dir).toBe(cwd);
      const names = envLines.map((line) => line.split("=")[0]);
      expect(envLines).toContain("AGENT_VALUE=from-the-run");
      expect(names).not.toContain("STIGMER_RUNNER_ONLY_SECRET");
      expect(names).not.toContain("HOME");
      // The shell itself may add its own bookkeeping; nothing else appears.
      expect(names.filter((n) => !["PATH", "AGENT_VALUE", "PWD", "OLDPWD", "SHLVL", "_", "__CF_USER_TEXT_ENCODING"].includes(n!))).toEqual([]);
    } finally {
      delete process.env.STIGMER_RUNNER_ONLY_SECRET;
    }
  });

  it("runs a sub-agent's command with its own environment, never the main agent's", async () => {
    const helper: Caller = { kind: "subagent", type: "test-runner" };
    verdicts.set("toolu_main", ALLOW);
    verdicts.set("toolu_helper", allowFor(helper));
    const envFor = (caller: Caller): Record<string, string> => ({
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      WHOSE: caller.kind === "root" ? "main" : caller.type,
    });
    const main = await runShellCall(options({ envFor }), bash("toolu_main", { command: "echo $WHOSE" }));
    const sub = await runShellCall(options({ envFor }), bash("toolu_helper", { command: "echo $WHOSE" }));
    expect([textOf(main).trim(), textOf(sub).trim()]).toEqual(["main", "test-runner"]);
  });

  it("streams each chunk as it prints, under the call's id, and reports the shell's activity", async () => {
    verdicts.set("toolu_stream", ALLOW);
    const result = await runShellCall(options(), bash("toolu_stream", { command: "echo first; sleep 0.1; echo second >&2" }));
    expect(outputs.length).toBeGreaterThanOrEqual(2);
    expect(new Set(outputs.map((o) => o.id))).toEqual(new Set(["toolu_stream"]));
    expect(outputs.map((o) => o.chunk).join("")).toContain("first");
    expect(outputs.map((o) => o.chunk).join("")).toContain("second");
    expect(activity.length).toBe(outputs.length);
    expect(new Set(activity)).toEqual(new Set(["Bash"]));
    expect(textOf(result)).toBe("first\n\n[stderr] second");
  });

  it("reports a non-zero exit as a failure with its code", async () => {
    verdicts.set("toolu_exit", ALLOW);
    const result = await runShellCall(options(), bash("toolu_exit", { command: "echo nope; exit 3" }));
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe("nope\n\nExit code: 3");
  });

  it("reports a command ended by a signal as a failure", async () => {
    verdicts.set("toolu_killed", ALLOW);
    const result = await runShellCall(options(), bash("toolu_killed", { command: "kill -KILL $$" }));
    expect(result.isError).toBe(true);
  });

  it("stops a command at its timeout and says so", async () => {
    verdicts.set("toolu_slow", ALLOW);
    const marker = join(cwd, "finished");
    const result = await runShellCall(options(), bash("toolu_slow", { command: `sleep 5; touch ${marker}`, timeout: 300 }));
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("The command was stopped at its timeout of 1 seconds.");
    expect(existsSync(marker)).toBe(false);
  });

  it("gives a command the runner's ceiling when the model asked for more, and says so", async () => {
    verdicts.set("toolu_long", ALLOW);
    const result = await runShellCall(options({ maxTimeoutSeconds: 30 }), bash("toolu_long", { command: "echo ok", timeout: 3_600_000 }));
    expect(result.isError).toBeUndefined();
    expect(textOf(result)).toBe("ok\n\n\nThe timeout asked for was above this runner's limit; the command was given 30 seconds.");
  });

  it("stops a running command when the turn stops, and says so", async () => {
    verdicts.set("toolu_stop", ALLOW);
    const marker = join(cwd, "finished");
    const result = await runShellCall(
      options({
        onOutput: (id, chunk) => {
          outputs.push({ id, chunk });
          if (chunk.includes("started")) stop.abort();
        },
      }),
      bash("toolu_stop", { command: `echo started; sleep 10; touch ${marker}` }),
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("The command was stopped because the turn stopped.");
    expect(existsSync(marker)).toBe(false);
  });

  it("reports a command that could not start", async () => {
    verdicts.set("toolu_nowhere", ALLOW);
    const result = await runShellCall(options({ cwd: join(cwd, "no-such-dir") }), bash("toolu_nowhere", { command: "echo hi" }));
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/^The command could not start: /);
  });
});

describe("hostShellServer", () => {
  it("lists the engine's Bash schema under the host's tool name and runs a call under the engine's own id", async () => {
    verdicts.set("toolu_engine", ALLOW);
    const { client, close } = await connectServed([hostShellServer(options())]);
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).toEqual(["bash"]);
      expect(tools[0]!.inputSchema.required).toEqual(["command"]);
      expect(Object.keys(tools[0]!.inputSchema.properties ?? {}).sort()).toEqual(["command", "description", "timeout"]);

      const result = (await client.callTool({ name: "bash", arguments: { command: "echo via-the-engine" }, _meta: { "claudecode/toolUseId": "toolu_engine" } })) as CallToolResult;
      expect(textOf(result)).toBe("via-the-engine\n");
      expect(outputs.every((o) => o.id === "toolu_engine")).toBe(true);

      const unkeyed = (await client.callTool({ name: "bash" })) as CallToolResult;
      expect(unkeyed.isError, "a call with no id has no decision").toBe(true);
      expect(textOf(unkeyed)).toBe("The gate allowed no such call; it was not run.");
    } finally {
      await close();
    }
  });
});
