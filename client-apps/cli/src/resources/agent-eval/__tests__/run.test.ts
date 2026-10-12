// Pins the `agent eval` dispatch on the loop it shares with `plugin eval`
// (resources/plugin-eval/follow.ts, whose own rules the plugin eval's run
// tests pin), against a fake server and fake effects: the agent is
// resolved by slug in the organization, or by id, and the eval created in
// the agent's organization with the version, the plugins and every
// option, and with no target when no model is named; each finished try
// prints once, named by its plugin, while the command follows the eval
// through the agent eval client; the report goes to stdout; `--json`
// writes the SDK's agent eval document with the agent's slug; `--no-wait`
// prints the id and names `get agent-eval`; Ctrl+C cancels through the
// agent eval client and exits 130, and a second one names `agent eval
// cancel`; reads that are lost cancel the eval and name `agent eval
// cancel` when that fails too; a refused agent read or create exits 1;
// and `agent eval cancel` cancels.

import { create } from "@bufbuild/protobuf";
import { Code } from "@connectrpc/connect";
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { AgentEval } from "@stigmer/protos/ai/stigmer/agentic/agenteval/v1/api_pb";
import { PluginEvalPartialReason, PluginEvalPhase } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/status_pb";
import { StigmerError, type AgentEvalInput, type Stigmer } from "@stigmer/sdk";
import { describe, expect, it } from "vitest";
import { CliExitError } from "../../../errors/index.js";
import type { EvalIo } from "../../plugin-eval/follow.js";
import { readAgentEvalOptions, type AgentEvalFlags } from "../options.js";
import { cancelAgentEval, runAgentEval } from "../run.js";
import { VERSION_HASH, finishedAgentEval } from "./fixtures.js";

const agent = create(AgentSchema, {
  metadata: { id: "agt_1", org: "org_acme", name: "Support desk", slug: "support-desk" },
});

function pending(): AgentEval {
  const agentEval = finishedAgentEval(PluginEvalPhase.pending);
  for (const plugin of agentEval.status!.plugins) plugin.cases = [];
  return agentEval;
}

/** A server whose eval reads as each of `reads` in turn, then the last one forever. */
function fakeServer(
  reads: AgentEval[],
  opts: { agentError?: Error; createError?: Error; failedReads?: boolean; cancelError?: Error } = {},
) {
  const calls: string[] = [];
  const created: AgentEvalInput[] = [];
  let next = 0;
  const client = {
    agent: {
      get: async (id: string) => {
        calls.push(`agent.get ${id}`);
        if (opts.agentError !== undefined) throw opts.agentError;
        return agent;
      },
      getByReference: async (ref: { org: string; slug: string }) => {
        calls.push(`agent.ref ${ref.org}/${ref.slug}`);
        if (opts.agentError !== undefined) throw opts.agentError;
        return agent;
      },
    },
    agenteval: {
      create: async (input: AgentEvalInput) => {
        calls.push("create");
        created.push(input);
        if (opts.createError !== undefined) throw opts.createError;
        return pending();
      },
      get: async (id: string) => {
        calls.push(`get ${id}`);
        if (opts.failedReads === true) throw new StigmerError("unavailable", "the server is unavailable", Code.Unavailable);
        const read = reads[Math.min(next, reads.length - 1)]!;
        next += 1;
        return read;
      },
      cancel: async (id: string) => {
        calls.push(`cancel ${id}`);
        if (opts.cancelError !== undefined) throw opts.cancelError;
        const result = finishedAgentEval(PluginEvalPhase.partial);
        result.status!.partialReason = PluginEvalPartialReason.cancelled;
        return result;
      },
    },
    platform: { getServerInfo: async () => ({ singleOrg: false }) },
  } as unknown as Stigmer;
  return { client, calls, created };
}

function fakeIo(opts: { interruptAfterSleeps?: number } = {}) {
  let stdout = "";
  let stderr = "";
  const files = new Map<string, string>();
  let handler: (() => void) | undefined;
  let sleeps = 0;
  const io: EvalIo = {
    stdout: { write: (text) => void (stdout += text) },
    stderr: { write: (text) => void (stderr += text) },
    writeFile: async (path, content) => void files.set(path, content),
    sleep: async () => {
      sleeps += 1;
      if (opts.interruptAfterSleeps !== undefined && sleeps >= opts.interruptAfterSleeps) handler?.();
    },
    // A call's deadline never passes on its own here; it ends on the signal.
    timeout: (_ms, signal) =>
      new Promise<void>((resolve) => {
        if (signal.aborted) resolve();
        signal.addEventListener("abort", () => resolve(), { once: true });
      }),
    now: () => 1_042_000,
    onInterrupt: (h) => {
      handler = h;
      return () => {
        handler = undefined;
      };
    },
    exit: (code) => {
      throw new Error(`exit ${code}`);
    },
  };
  return { io, out: () => stdout, err: () => stderr, files, interrupt: () => handler?.() };
}

function options(flags: AgentEvalFlags = {}) {
  return readAgentEvalOptions(flags);
}

const SUPPORT_DESK = { ref: "support-desk", version: "" };

describe("runAgentEval", () => {
  it("creates the eval in the agent's organization with every option, follows it, and prints the report", async () => {
    const server = fakeServer([finishedAgentEval(PluginEvalPhase.running), finishedAgentEval()]);
    const fake = fakeIo();
    const code = await runAgentEval(
      server.client,
      "acme",
      { ref: "support-desk", version: "v3" },
      options({ plugin: ["refund-policy", "tracker"], runs: "2", tag: ["smoke"], allowTools: ["Skill", "Agent"] }),
      fake.io,
    );

    expect(code).toBe(0);
    expect(server.calls).toEqual(["agent.ref acme/support-desk", "create", "get aev_1", "get aev_1"]);
    expect(server.created[0]).toEqual({
      name: "",
      org: "org_acme",
      agentId: "agt_1",
      agentVersion: "v3",
      plugins: ["refund-policy", "tracker"],
      targets: [],
      runs: 2,
      caseGlob: "",
      caseTags: ["smoke"],
      judgeModel: "",
      maxCostUsd: 5,
      concurrency: 0,
      allowTools: ["Skill", "Agent"],
      realMcpServers: false,
      allowRealServers: false,
      skipScaffold: false,
    });
    expect(fake.err()).toContain("Spending limit $5.00, the default; set --max-cost-usd to change it.");
    expect(fake.err()).toContain("Started aev_1 on support-desk@v3. Ctrl+C cancels it.");
    // Each finished try once, though two reads carried it.
    expect(fake.err().match(/tracker\/refund-window · native\/claude-sonnet-4-6 · with · try 1\/1 · 1\.00/g)).toHaveLength(1);
    expect(fake.out()).toContain("support-desk@0123456789ab · refund-policy@c0ffee111111 · native/claude-sonnet-4-6");
    expect(fake.out()).toContain("support-desk@0123456789ab · notes@abcdef333333\n  not run: not selected");
    expect(fake.out()).toContain("2 case(s) · 42s · $0.50");
    expect(fake.out()).toContain("tracker/needs-fixture: not run: plugins");
  });

  it("reads an agent given by id, and sends the named models as targets", async () => {
    const server = fakeServer([finishedAgentEval()]);
    const code = await runAgentEval(
      server.client,
      "",
      { ref: "agt_1", version: "" },
      options({ model: ["native/claude-opus-4-1"] }),
      fakeIo().io,
    );
    expect(code).toBe(0);
    expect(server.calls[0]).toBe("agent.get agt_1");
    expect(server.created[0]).toMatchObject({ agentVersion: "", plugins: [], targets: [{ modelName: "claude-opus-4-1" }] });
  });

  it("writes the agent eval document with the agent's slug under --json, and prints nothing else", async () => {
    const server = fakeServer([finishedAgentEval()]);
    const fake = fakeIo();
    const code = await runAgentEval(server.client, "acme", SUPPORT_DESK, options({ json: "out.json" }), fake.io);
    expect(code).toBe(0);
    expect(fake.out()).toBe("");
    expect(fake.err()).toBe("");
    const document = JSON.parse(fake.files.get("out.json") ?? "{}") as Record<string, unknown>;
    expect(document).toMatchObject({
      evalId: "aev_1",
      agent: { id: "agt_1", slug: "support-desk", versionHash: VERSION_HASH },
      aggregates: { casesPassed: 2, casesTotal: 2 },
    });
    expect((document.plugins as { plugin: { slug: string }; notRunReason: string | null }[]).map((p) => [p.plugin.slug, p.notRunReason])).toEqual([
      ["refund-policy", null],
      ["tracker", null],
      ["notes", "not selected"],
    ]);
    expect(document).not.toHaveProperty("stillRunning");
  });

  it("prints the id and returns under --no-wait, naming get agent-eval", async () => {
    const server = fakeServer([finishedAgentEval()]);
    const fake = fakeIo();
    const code = await runAgentEval(server.client, "acme", SUPPORT_DESK, options({ wait: false }), fake.io);
    expect(code).toBe(0);
    expect(server.calls).toEqual(["agent.ref acme/support-desk", "create"]);
    expect(fake.out()).toBe("aev_1\n");
    expect(fake.err()).toContain("Started. Follow it with: stigmer get agent-eval aev_1");
  });

  it("cancels through the agent eval client on Ctrl+C and exits 130", async () => {
    const server = fakeServer([finishedAgentEval(PluginEvalPhase.running)]);
    const fake = fakeIo({ interruptAfterSleeps: 1 });
    const code = await runAgentEval(server.client, "acme", SUPPORT_DESK, options(), fake.io);
    expect(code).toBe(130);
    expect(server.calls).toContain("cancel aev_1");
    expect(fake.out()).toContain("Cancelled: 2 of 2 tries ran.");
  });

  it("names agent eval cancel on a second Ctrl+C", async () => {
    const server = fakeServer([finishedAgentEval(PluginEvalPhase.running)]);
    const fake = fakeIo();
    // Two Ctrl+Cs while the command waits to read the eval again.
    const io: EvalIo = {
      ...fake.io,
      sleep: async () => {
        fake.interrupt();
        fake.interrupt();
      },
    };
    const error = await runAgentEval(server.client, "acme", SUPPORT_DESK, options(), io).catch((e: unknown) => e);
    expect((error as Error).message).toBe("exit 130");
    expect(fake.err()).toContain("Stopped following aev_1; if it is still running, cancel it with: stigmer agent eval cancel aev_1");
  });

  it("names agent eval cancel when the reads are lost and the cancel fails too", async () => {
    const unreachable = new StigmerError("unavailable", "the server is unavailable", Code.Unavailable);
    const server = fakeServer([], { failedReads: true, cancelError: unreachable });
    const fake = fakeIo();
    const error = await runAgentEval(server.client, "acme", SUPPORT_DESK, options(), fake.io).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CliExitError);
    expect((error as CliExitError).exitCode).toBe(1);
    expect((error as CliExitError).message).toContain("cancel it with: stigmer agent eval cancel aev_1");
    expect(fake.out()).toContain("it may still be running: cancel it with `stigmer agent eval cancel aev_1`");
  });

  it.each([
    ["the agent read", { agentError: new StigmerError("not-found", "agent not found", Code.NotFound) }],
    ["create", { createError: new StigmerError("failed-precondition", "the agent uses no plugin", Code.FailedPrecondition) }],
  ])("exits 1 when %s is refused", async (_name, opts) => {
    const server = fakeServer([finishedAgentEval()], opts);
    const error = await runAgentEval(server.client, "acme", SUPPORT_DESK, options(), fakeIo().io).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CliExitError);
    expect((error as CliExitError).exitCode).toBe(1);
  });

  it("asks for an organization before reading an agent by slug on a server that needs one", async () => {
    const server = fakeServer([finishedAgentEval()]);
    const error = await runAgentEval(server.client, "", SUPPORT_DESK, options(), fakeIo().io).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CliExitError);
    expect((error as CliExitError).exitCode).toBe(1);
    expect((error as CliExitError).message).toContain("organization not set");
    expect(server.calls).toEqual([]);
  });
});

describe("cancelAgentEval", () => {
  it("cancels by id through the agent eval client and says how far the eval got", async () => {
    const server = fakeServer([]);
    let stderr = "";
    await cancelAgentEval(server.client, "aev_1", { stderr: { write: (text) => void (stderr += text) } });
    expect(server.calls).toEqual(["cancel aev_1"]);
    expect(stderr).toBe("Cancelled aev_1: tries in flight stop; 2 of 2 tries had finished.\n");
  });
});
