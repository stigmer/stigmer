// Pins the `eval run --agent` dispatch on the loop follow.ts owns (whose
// own rules run-plugin.test.ts pins), against a fake server and fake
// effects: the agent is resolved by slug in the organization, or by id,
// and the eval run created in the agent's organization with the version,
// the case sources and every option, and with no target when no model is
// named; a compared plugin is read in the agent's organization and sent
// by id, its load findings printed, and the start line names it; each
// finished try prints once, named by its plugin, while the command
// follows the eval run; the report goes to stdout; `--json` writes the
// SDK's document with the agent's slug; `--no-wait` prints the id and
// names `get eval-run`; Ctrl+C cancels and exits 130, and a second one
// names `eval cancel`; reads that are lost cancel the eval run and name
// `eval cancel` when that fails too; a refused agent read, compared
// plugin read or create exits 1; and `eval cancel` cancels.

import { create } from "@bufbuild/protobuf";
import { Code } from "@connectrpc/connect";
import { AgentSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import type { EvalRun } from "@stigmer/apis/ai/stigmer/agentic/evalrun/v1/api_pb";
import { EvalRunAblation } from "@stigmer/apis/ai/stigmer/agentic/evalrun/v1/spec_pb";
import { EvalRunPartialReason, EvalRunPhase } from "@stigmer/apis/ai/stigmer/agentic/evalrun/v1/status_pb";
import { PluginSchema } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/api_pb";
import { StigmerError, type EvalRunInput, type Stigmer } from "@stigmer/client";
import { describe, expect, it } from "vitest";
import { CliExitError } from "../../../errors/index.js";
import type { EvalIo } from "../follow.js";
import { readEvalRunOptions, type EvalRunFlags } from "../options.js";
import { cancelEvalRun, runEvalRun } from "../run.js";
import { VERSION_HASH, finishedEvalRunOnAgent } from "./fixtures.js";

const agent = create(AgentSchema, {
  metadata: { id: "agt_1", org: "org_acme", name: "Support desk", slug: "support-desk" },
});

const refundPolicy = create(PluginSchema, {
  metadata: { id: "plg_refund", org: "org_acme", name: "refund-policy", slug: "refund-policy" },
  status: {
    evals: {
      dir: "evals",
      caseCount: 1,
      findings: [{ kind: "eval-case-invalid", path: "evals/broken/case.yaml", message: "evals/broken/case.yaml: runs must be a number" }],
    },
  },
});

function pending(): EvalRun {
  const evalRun = finishedEvalRunOnAgent(EvalRunPhase.pending);
  for (const plugin of evalRun.status!.plugins) plugin.cases = [];
  return evalRun;
}

/** A server whose eval reads as each of `reads` in turn, then the last one forever. */
function fakeServer(
  reads: EvalRun[],
  opts: { agentError?: Error; pluginError?: Error; createError?: Error; failedReads?: boolean; cancelError?: Error } = {},
) {
  const calls: string[] = [];
  const created: EvalRunInput[] = [];
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
    plugin: {
      get: async (id: string) => {
        calls.push(`plugin.get ${id}`);
        if (opts.pluginError !== undefined) throw opts.pluginError;
        return refundPolicy;
      },
      getByReference: async (ref: { org: string; slug: string }) => {
        calls.push(`plugin.ref ${ref.org}/${ref.slug}`);
        if (opts.pluginError !== undefined) throw opts.pluginError;
        return refundPolicy;
      },
    },
    evalrun: {
      create: async (input: EvalRunInput) => {
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
        const result = finishedEvalRunOnAgent(EvalRunPhase.partial);
        result.status!.partialReason = EvalRunPartialReason.cancelled;
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

/** Runs `eval run --agent support-desk` with `flags` over `--agent`'s default. */
function run(client: Stigmer, org: string, flags: EvalRunFlags, io: EvalIo) {
  return runEvalRun(client, org, readEvalRunOptions({ agent: "support-desk", ...flags }), io);
}

describe("runEvalRun about an agent", () => {
  it("creates the eval in the agent's organization with every option, follows it, and prints the report", async () => {
    const server = fakeServer([finishedEvalRunOnAgent(EvalRunPhase.running), finishedEvalRunOnAgent()]);
    const fake = fakeIo();
    const code = await run(
      server.client,
      "acme",
      {
        agent: "support-desk@v3",
        casesFrom: ["refund-policy", "acme/tracker", "plg_01notes"],
        eval: ["support-evals@stable", "evs_01kept"],
        runs: "2",
        tag: ["smoke"],
        allowTools: ["Skill", "Agent"],
      },
      fake.io,
    );

    expect(code).toBe(0);
    expect(server.calls).toEqual(["agent.ref acme/support-desk", "create", "get evr_2", "get evr_2"]);
    expect(server.created[0]).toEqual({
      name: "",
      org: "org_acme",
      agentId: "agt_1",
      agentVersion: "v3",
      comparedPluginId: "",
      cases: [
        { plugin: { org: "org_acme", slug: "refund-policy" } },
        { plugin: { org: "acme", slug: "tracker" } },
        { plugin: { org: "", slug: "", id: "plg_01notes" } },
        { eval: { org: "org_acme", slug: "support-evals", version: "stable" } },
        { eval: { org: "", slug: "", id: "evs_01kept" } },
      ],
      targets: [],
      runs: 2,
      ablation: EvalRunAblation.with_without,
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
    expect(fake.err()).toContain("Started evr_2 on support-desk@v3. Ctrl+C cancels it.");
    // Each finished try once, though two reads carried it.
    expect(fake.err().match(/tracker\/refund-window · stigmer\/claude-sonnet-4-6 · with · try 1\/1 · 1\.00/g)).toHaveLength(1);
    expect(fake.out()).toContain("support-desk@0123456789ab · refund-policy@c0ffee111111 · stigmer/claude-sonnet-4-6");
    expect(fake.out()).toContain("support-desk@0123456789ab · notes@abcdef333333\n  not run: not selected");
    expect(fake.out()).toContain("2 case(s) · 42s · $0.50");
    expect(fake.out()).toContain("tracker/needs-fixture: not run: plugins");
  });

  it("reads an agent given by id, and sends the named models as targets", async () => {
    const server = fakeServer([finishedEvalRunOnAgent()]);
    const code = await run(server.client, "", { agent: "agt_1", model: ["stigmer/claude-opus-4-1"] }, fakeIo().io);
    expect(code).toBe(0);
    expect(server.calls[0]).toBe("agent.get agt_1");
    expect(server.created[0]).toMatchObject({ agentVersion: "", cases: [], targets: [{ modelName: "claude-opus-4-1" }] });
  });

  it("writes the result document with the agent's slug under --json, and prints nothing else", async () => {
    const server = fakeServer([finishedEvalRunOnAgent()]);
    const fake = fakeIo();
    const code = await run(server.client, "acme", { json: "out.json" }, fake.io);
    expect(code).toBe(0);
    expect(fake.out()).toBe("");
    expect(fake.err()).toBe("");
    const document = JSON.parse(fake.files.get("out.json") ?? "{}") as Record<string, unknown>;
    expect(document).toMatchObject({
      evalRunId: "evr_2",
      subject: { kind: "agent", id: "agt_1", slug: "support-desk", versionHash: VERSION_HASH },
      findings: [],
      aggregates: { casesPassed: 2, casesTotal: 2 },
    });
    expect((document.plugins as { plugin: { slug: string }; notRunReason: string | null }[]).map((p) => [p.plugin.slug, p.notRunReason])).toEqual([
      ["refund-policy", null],
      ["tracker", null],
      ["notes", "not selected"],
    ]);
    expect(document).not.toHaveProperty("stillRunning");
  });

  it("prints the id and returns under --no-wait, naming get eval-run", async () => {
    const server = fakeServer([finishedEvalRunOnAgent()]);
    const fake = fakeIo();
    const code = await run(server.client, "acme", { wait: false }, fake.io);
    expect(code).toBe(0);
    expect(server.calls).toEqual(["agent.ref acme/support-desk", "create"]);
    expect(fake.out()).toBe("evr_2\n");
    expect(fake.err()).toContain("Started. Follow it with: stigmer get eval-run evr_2");
  });

  it("cancels on Ctrl+C and exits 130", async () => {
    const server = fakeServer([finishedEvalRunOnAgent(EvalRunPhase.running)]);
    const fake = fakeIo({ interruptAfterSleeps: 1 });
    const code = await run(server.client, "acme", {}, fake.io);
    expect(code).toBe(130);
    expect(server.calls).toContain("cancel evr_2");
    expect(fake.out()).toContain("Cancelled: 2 of 2 tries ran.");
  });

  it("names eval cancel on a second Ctrl+C", async () => {
    const server = fakeServer([finishedEvalRunOnAgent(EvalRunPhase.running)]);
    const fake = fakeIo();
    // Two Ctrl+Cs while the command waits to read the eval again.
    const io: EvalIo = {
      ...fake.io,
      sleep: async () => {
        fake.interrupt();
        fake.interrupt();
      },
    };
    const error = await run(server.client, "acme", {}, io).catch((e: unknown) => e);
    expect((error as Error).message).toBe("exit 130");
    expect(fake.err()).toContain("Stopped following evr_2; if it is still running, cancel it with: stigmer eval cancel evr_2");
  });

  it("names eval cancel when the reads are lost and the cancel fails too", async () => {
    const unreachable = new StigmerError("unavailable", "the server is unavailable", Code.Unavailable);
    const server = fakeServer([], { failedReads: true, cancelError: unreachable });
    const fake = fakeIo();
    const error = await run(server.client, "acme", {}, fake.io).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CliExitError);
    expect((error as CliExitError).exitCode).toBe(1);
    expect((error as CliExitError).message).toContain("cancel it with: stigmer eval cancel evr_2");
    expect(fake.out()).toContain("it may still be running: cancel it with `stigmer eval cancel evr_2`");
  });

  it.each([
    ["the agent read", { agentError: new StigmerError("not-found", "agent not found", Code.NotFound) }],
    ["the compared plugin's read", { pluginError: new StigmerError("not-found", "plugin not found", Code.NotFound) }],
    ["create", { createError: new StigmerError("failed-precondition", "the agent uses no plugin", Code.FailedPrecondition) }],
  ])("exits 1 when %s is refused", async (_name, opts) => {
    const server = fakeServer([finishedEvalRunOnAgent()], opts);
    const error = await run(server.client, "acme", { plugin: "refund-policy" }, fakeIo().io).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CliExitError);
    expect((error as CliExitError).exitCode).toBe(1);
  });

  it("compares a plugin read in the agent's organization, sent by id, its load findings printed", async () => {
    const server = fakeServer([finishedEvalRunOnAgent()]);
    const fake = fakeIo();
    const code = await run(server.client, "acme", { plugin: "refund-policy", ablation: "none" }, fake.io);
    expect(code).toBe(1);
    expect(server.calls.slice(0, 2)).toEqual(["agent.ref acme/support-desk", "plugin.ref org_acme/refund-policy"]);
    expect(server.created[0]).toMatchObject({ agentId: "agt_1", comparedPluginId: "plg_refund", cases: [], ablation: EvalRunAblation.none });
    expect(fake.err()).toContain("evals: evals/broken/case.yaml: runs must be a number\n");
    expect(fake.err()).toContain("Started evr_2 on support-desk with and without refund-policy.");
  });

  it("asks for an organization before reading an agent by slug on a server that needs one", async () => {
    const server = fakeServer([finishedEvalRunOnAgent()]);
    const error = await run(server.client, "", {}, fakeIo().io).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CliExitError);
    expect((error as CliExitError).exitCode).toBe(1);
    expect((error as CliExitError).message).toContain("organization not set");
    expect(server.calls).toEqual([]);
  });
});

describe("cancelEvalRun", () => {
  it("cancels by id and says how far the eval run got", async () => {
    const server = fakeServer([]);
    const result = await cancelEvalRun(server.client, "evr_2");
    expect(server.calls).toEqual(["cancel evr_2"]);
    expect(result.message).toBe("Cancelled evr_2: tries in flight stop; 2 of 2 tries had finished.");
    expect(result.data).toEqual({ evalRunId: "evr_2", triesFinished: 2, triesTotal: 2 });
  });
});
