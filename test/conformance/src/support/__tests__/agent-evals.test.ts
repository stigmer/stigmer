// Pins the agent-eval suites' fixtures, copy and follower
// (support/agent-evals.ts): a fresh eval runs the agent's current version,
// every attached plugin's cases, with no targets (the agent as it runs),
// once per case, one try at a time, within ten dollars; the agent fixture
// lists the plugins by slug in order, saves at the visibility asked and
// defers its delete; the follower reads past the phases it was not asked
// for and fails loudly, naming what it last read, once its budget is spent;
// `agentEvalTriesOf` walks the status in plugin, case and target order and
// skips a plugin whose cases did not run; the copied refusal copy is the
// server's, byte for byte; cleanup cancels an eval that may still run,
// waits for its end, then deletes it, and deletes a finished one at once.
// The clients are stubbed; nothing here starts a server.
import { create } from "@bufbuild/protobuf";
import { AgentEvalSchema } from "@stigmer/protos/ai/stigmer/agentic/agenteval/v1/api_pb";
import type { AgentEval } from "@stigmer/protos/ai/stigmer/agentic/agenteval/v1/api_pb";
import { PluginSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { PluginEvalPhase } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/status_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { describe, expect, it } from "vitest";
import type { ConformanceClients } from "../../harness/clients";
import { FixtureTracker } from "../../harness/fixtures";
import {
  AGENT_EVAL_CREATE_DENIED_MESSAGE,
  AGENT_EVAL_NO_CASES_MESSAGE,
  AGENT_EVAL_NO_PLUGINS_MESSAGE,
  PLUGIN_NO_CASES_REASON,
  PLUGIN_NOT_SELECTED_REASON,
  agentEvalActiveDeleteMessage,
  agentEvalActiveOnAgentDeleteMessage,
  agentEvalOrgMismatchMessage,
  agentEvalOtherPluginToolMessage,
  agentEvalTriesOf,
  agentEvalUnknownPluginMessage,
  cancelAndDeleteAgentEval,
  createAgentWith,
  followAgentEval,
  makeAgentEval,
} from "../agent-evals";

describe("the eval fixture", () => {
  it("runs the agent's current version on every attached plugin's cases, as the agent runs, once per case, one try at a time, within ten dollars", () => {
    expect(makeAgentEval({ org: "org_1", agentId: "agt_1" })).toEqual({
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "AgentEval",
      metadata: { org: "org_1" },
      spec: {
        agentId: "agt_1",
        agentVersion: "",
        plugins: [],
        targets: [],
        runs: 1,
        caseGlob: "",
        maxCostUsd: 10,
        concurrency: 1,
        allowTools: [],
      },
    });
  });

  it("carries every option it is given", () => {
    const made = makeAgentEval({
      org: "org_1",
      agentId: "agt_1",
      agentVersion: "stable",
      plugins: ["notes"],
      runs: 3,
      caseGlob: "first",
      maxCostUsd: 0.01,
      concurrency: 2,
      allowTools: ["Skill"],
      name: "nightly",
    });
    expect(made.metadata).toEqual({ org: "org_1", name: "nightly" });
    expect(made.spec).toMatchObject({
      agentVersion: "stable",
      plugins: ["notes"],
      runs: 3,
      caseGlob: "first",
      maxCostUsd: 0.01,
      concurrency: 2,
      allowTools: ["Skill"],
    });
  });
});

describe("createAgentWith", () => {
  function agentClients(calls: string[], seen: unknown[]): ConformanceClients {
    return {
      agentCommand: {
        create: async (input: unknown) => {
          seen.push(input);
          calls.push("create");
          return { metadata: { id: "agt_1" } };
        },
        delete: async ({ value }: { value: string }) => {
          calls.push(`delete ${value}`);
          return {};
        },
      },
    } as unknown as ConformanceClients;
  }

  const plugins = [
    create(PluginSchema, { metadata: { slug: "notes" } }),
    create(PluginSchema, { metadata: { slug: "tracker" } }),
  ];

  it("lists the plugins by slug, in order, and defers the agent's delete", async () => {
    const calls: string[] = [];
    const seen: unknown[] = [];
    const fixtures = new FixtureTracker();
    const agent = await createAgentWith(agentClients(calls, seen), fixtures, "acme", plugins, {
      name: "desk",
      instructions: "Answer as the release desk.",
    });
    expect(agent.metadata?.id).toBe("agt_1");
    expect(seen[0]).toMatchObject({
      metadata: { org: "acme", name: "desk" },
      spec: {
        instructions: "Answer as the release desk.",
        plugins: [
          { slug: "notes", kind: ApiResourceKind.plugin },
          { slug: "tracker", kind: ApiResourceKind.plugin },
        ],
      },
    });
    expect((seen[0] as { metadata: Record<string, unknown> }).metadata).not.toHaveProperty("visibility");
    await fixtures.cleanup();
    expect(calls).toEqual(["create", "delete agt_1"]);
  });

  it("saves at the visibility it is given", async () => {
    const seen: unknown[] = [];
    await createAgentWith(agentClients([], seen), new FixtureTracker(), "acme", plugins, {
      name: "desk",
      visibility: ApiResourceVisibility.visibility_private,
    });
    expect(seen[0]).toMatchObject({ metadata: { visibility: ApiResourceVisibility.visibility_private } });
  });
});

function evalAt(phase: PluginEvalPhase): AgentEval {
  return create(AgentEvalSchema, {
    metadata: { id: "aev_1" },
    status: { phase, triesTotal: 2, triesFinished: 1 },
  });
}

function getting(pages: AgentEval[]): ConformanceClients {
  let calls = 0;
  return {
    agentEvalQuery: {
      get: async () => {
        const page = pages[Math.min(calls, pages.length - 1)]!;
        calls += 1;
        return page;
      },
    },
  } as unknown as ConformanceClients;
}

describe("followAgentEval", () => {
  it("reads past the phases it was not asked for", async () => {
    const seen = await followAgentEval(
      getting([evalAt(PluginEvalPhase.pending), evalAt(PluginEvalPhase.running), evalAt(PluginEvalPhase.completed)]),
      "aev_1",
      (e) => e.status?.phase === PluginEvalPhase.completed,
      "completed",
      5_000,
    );
    expect(seen.status?.phase).toBe(PluginEvalPhase.completed);
  });

  it("fails loudly once its budget is spent, naming what it last read and the eval's error", async () => {
    await expect(
      followAgentEval(getting([evalAt(PluginEvalPhase.running)]), "aev_1", () => false, "an end", 0),
    ).rejects.toThrow("agent eval aev_1 did not reach an end within 0 ms; last read: phase running, tries 1/2");
    const failed = evalAt(PluginEvalPhase.failed);
    failed.status!.error = "the eval's workflow could not be started";
    await expect(followAgentEval(getting([failed]), "aev_1", () => false, "a try", 0)).rejects.toThrow(
      'last read: phase failed, tries 1/2, error "the eval\'s workflow could not be started"',
    );
  });
});

describe("agentEvalTriesOf", () => {
  it("walks the status in plugin, case and target order, past a plugin whose cases did not run", () => {
    const agentEval = create(AgentEvalSchema, {
      status: {
        plugins: [
          {
            pluginSlug: "notes",
            cases: [
              { caseName: "a", targets: [{ withPlugin: { tries: [{ index: 1 }, { index: 2 }] } }, { withPlugin: { tries: [{ index: 1 }] } }] },
              { caseName: "b", targets: [{ withPlugin: { tries: [{ index: 1 }] } }] },
            ],
          },
          { pluginSlug: "style", notRunReason: PLUGIN_NOT_SELECTED_REASON },
          { pluginSlug: "tracker", cases: [{ caseName: "c", targets: [{ withPlugin: { tries: [{ index: 1 }] } }] }] },
        ],
      },
    });
    expect(
      agentEvalTriesOf(agentEval).map((t) => `${t.pluginSlug}/${t.caseName}/${t.targetIndex}/${t.attempt.index}`),
    ).toEqual(["notes/a/0/1", "notes/a/0/2", "notes/a/1/1", "notes/b/0/1", "tracker/c/0/1"]);
  });
});

describe("the copy the suites assert", () => {
  it("is the server's refusal and reason copy, byte for byte", () => {
    expect(AGENT_EVAL_CREATE_DENIED_MESSAGE).toBe("unauthorized to run evals of agent");
    expect(agentEvalOrgMismatchMessage("acme")).toBe("metadata.org must be the agent's organization (acme)");
    expect(AGENT_EVAL_NO_PLUGINS_MESSAGE).toBe(
      "this agent version attaches no plugin, and an agent's eval cases are its plugins': attach a plugin with eval cases, then run the eval",
    );
    expect(agentEvalUnknownPluginMessage("notes")).toBe(
      "spec.plugins names 'notes', which this agent version does not attach",
    );
    expect(AGENT_EVAL_NO_CASES_MESSAGE).toBe(
      "none of the plugins this eval runs has eval cases at the version the agent attaches",
    );
    expect(agentEvalOtherPluginToolMessage("mcp__plugin_x_a__*", "plugin_x_a")).toBe(
      "allow_tools entry 'mcp__plugin_x_a__*' names MCP server 'plugin_x_a', which is none of the agent's own servers or its plugins'",
    );
    expect(PLUGIN_NOT_SELECTED_REASON).toBe("not selected");
    expect(PLUGIN_NO_CASES_REASON).toBe("no eval cases at this version");
    expect(agentEvalActiveDeleteMessage("aev_1")).toBe(
      "agent eval aev_1 is still running: cancel it first, then delete it",
    );
    expect(agentEvalActiveOnAgentDeleteMessage("aev_1")).toBe(
      "this agent has a running eval (aev_1): cancel it first, then delete the agent",
    );
  });
});

describe("cancelAndDeleteAgentEval", () => {
  function cleanupClients(pages: AgentEval[]): { clients: ConformanceClients; calls: string[] } {
    const calls: string[] = [];
    let reads = 0;
    const clients = {
      agentEvalQuery: {
        get: async () => {
          const page = pages[Math.min(reads, pages.length - 1)]!;
          reads += 1;
          return page;
        },
      },
      agentEvalCommand: {
        cancel: async () => {
          calls.push("cancel");
          return {};
        },
        delete: async () => {
          calls.push("delete");
          return {};
        },
      },
    } as unknown as ConformanceClients;
    return { clients, calls };
  }

  it("cancels an eval that may still run, waits for its end, then deletes it", async () => {
    const { clients, calls } = cleanupClients([
      evalAt(PluginEvalPhase.pending),
      evalAt(PluginEvalPhase.running),
      evalAt(PluginEvalPhase.partial),
    ]);
    await cancelAndDeleteAgentEval(clients, "aev_1");
    expect(calls).toEqual(["cancel", "delete"]);
  });

  it("deletes a finished eval at once", async () => {
    const { clients, calls } = cleanupClients([evalAt(PluginEvalPhase.failed)]);
    await cancelAndDeleteAgentEval(clients, "aev_1");
    expect(calls).toEqual(["delete"]);
  });
});
