// Unit arms for the Run support seams.
// - The phase polls: a timeout names the run, the label awaited, the distinct
//   phases the poll saw in order, the status error and the last message, and
//   awaitPhase labels its wait with the phase it awaits.
// - allToolCalls: the root transcript's tool calls, then every sub-agent's.
// - The submit-approval seam: one submit, then the response's
//   pending_approvals must equal what the decision leaves behind — a match
//   returns the response, a mismatch is red under the caller's label, and in
//   neither case is the decision submitted twice.
// - pushFixturePlugin: it pushes a one-server plugin on the fixture surface
//   it was given and returns the installed plugin only when its status
//   lists that one server at the surface's URL with no sign-in; anything
//   else is red at the helper, and the plugin's delete is deferred either
//   way.
// Pure: hand-built resources and stubbed clients, no target.
// Domain: conformance support (execution engine).
import { create } from "@bufbuild/protobuf";
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { type Plugin, PluginSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { describe, expect, it, vi } from "vitest";
import type { ConformanceClients } from "../../harness/clients";
import { FixtureTracker } from "../../harness/fixtures";
import { DESTRUCTIVE_ECHO_TOOL_NAME, ECHO_TOOL_NAME, type McpToolFixture } from "../../harness/mcp-server";
import {
  allToolCalls,
  awaitPhase,
  pollExecution,
  pushFixturePlugin,
  submitApprovalPerContract,
} from "../runs";

function executionWithPending(toolCallIds: string[]): Run {
  return create(RunSchema, {
    metadata: { id: "aex_unit" },
    status: { pendingApprovals: toolCallIds.map((toolCallId) => ({ toolCallId })) },
  });
}

describe("submitApprovalPerContract", () => {
  it("submits once and returns the response when pending_approvals matches the decision", async () => {
    const settled = executionWithPending([]);
    const submit = vi.fn(async () => settled);
    const response = await submitApprovalPerContract({
      submit,
      expectedRemaining: 0,
      label: "approve clears the gate",
    });
    expect(response).toBe(settled);
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("accepts a partially resolved gate when the decision leaves that many pending", async () => {
    const oneLeft = executionWithPending(["call_second"]);
    const response = await submitApprovalPerContract({
      submit: async () => oneLeft,
      expectedRemaining: 1,
      label: "one gate remains after the first approve",
    });
    expect(response).toBe(oneLeft);
  });

  it("is red under the caller's label when the response still lists the decided call — and never re-submits", async () => {
    const submit = vi.fn(async () => executionWithPending(["call_a"]));
    await expect(
      submitApprovalPerContract({
        submit,
        expectedRemaining: 0,
        label: "approve clears the gate",
      }),
    ).rejects.toThrow("approve clears the gate");
    expect(submit).toHaveBeenCalledTimes(1);
  });
});

// A plugin as push answers it: one server entry at `url`, signed in or not.
function installed(url: string, oauthOnly = false): Plugin {
  return create(PluginSchema, {
    metadata: { id: "plg_unit", org: "org-unit", slug: "plugin-unit" },
    status: {
      mcpServers: [
        {
          name: "tools",
          transport: { case: "http", value: { url } },
          ...(oauthOnly ? { signIn: { oauthOnly: true } } : {}),
        },
      ],
    },
  });
}

// Stubbed clients and fixture: push answers `answer`, and every call is recorded.
function stubs(answer: (url: string) => Plugin) {
  const url = vi.fn((tools?: readonly string[]) => `http://127.0.0.1:1/mcp/${(tools ?? []).join(",")}`);
  const push = vi.fn(async () => answer(url.mock.results[0]?.value as string));
  const deletePlugin = vi.fn(async () => create(PluginSchema, {}));
  const clients = { pluginCommand: { push, delete: deletePlugin } } as unknown as ConformanceClients;
  const mcp = { url } as unknown as McpToolFixture;
  return { clients, mcp, push, deletePlugin, url };
}

describe("pushFixturePlugin", () => {
  const tools = [ECHO_TOOL_NAME, DESTRUCTIVE_ECHO_TOOL_NAME] as const;

  it("pushes a plugin on the given surface and returns it when its one server is listed at that URL", async () => {
    const s = stubs((url) => installed(url));
    const fixtures = new FixtureTracker();

    const result = await pushFixturePlugin(s.clients, s.mcp, fixtures, { org: "org-unit", name: "plugin-unit", tools: [...tools] });

    expect(result.metadata?.id).toBe("plg_unit");
    expect(s.url).toHaveBeenCalledWith([...tools]);
    expect(s.push).toHaveBeenCalledWith(expect.objectContaining({ org: "org-unit", artifact: expect.any(Uint8Array) }));
    await fixtures.cleanup();
    expect(s.deletePlugin).toHaveBeenCalledWith({ value: "plg_unit" });
  });

  it("is red when the install completed the server with a sign-in, and still defers the delete", async () => {
    const s = stubs((url) => installed(url, true));
    const fixtures = new FixtureTracker();

    await expect(
      pushFixturePlugin(s.clients, s.mcp, fixtures, { org: "org-unit", name: "plugin-unit", tools: [...tools] }),
    ).rejects.toThrow("lists its one server at the fixture's surface");
    await fixtures.cleanup();
    expect(s.deletePlugin).toHaveBeenCalledTimes(1);
  });

  it("is red when the server is listed at another address", async () => {
    const s = stubs(() => installed("http://127.0.0.1:2/mcp/echo"));

    await expect(
      pushFixturePlugin(s.clients, s.mcp, new FixtureTracker(), { org: "org-unit", name: "plugin-unit", tools: [...tools] }),
    ).rejects.toThrow("lists its one server at the fixture's surface");
  });
});

// A query client whose get answers each of `answers` in turn, then the last
// one for good.
function queryAnswering(answers: Run[]) {
  const get = vi.fn(async () => answers[Math.min(get.mock.calls.length - 1, answers.length - 1)] as Run);
  const clients = { agentExecutionQuery: { get } } as unknown as ConformanceClients;
  return { clients, get };
}

function atPhase(phase: RunPhase, extra: { error?: string; lastMessage?: string } = {}): Run {
  return create(RunSchema, {
    metadata: { id: "aex_unit" },
    status: {
      phase,
      error: extra.error ?? "",
      messages: extra.lastMessage !== undefined ? [{ content: "first" }, { content: extra.lastMessage }] : [],
    },
  });
}

describe("pollExecution", () => {
  it("times out with the distinct phases it saw in order, the status error and the last message", async () => {
    const { clients, get } = queryAnswering([
      atPhase(RunPhase.RUN_PENDING),
      atPhase(RunPhase.RUN_PENDING),
      atPhase(RunPhase.RUN_IN_PROGRESS, { error: "provider refused", lastMessage: "still thinking" }),
    ]);
    // Long enough for at least three polls on a loaded machine; the predicate
    // never holds, so the run always ends at the deadline.
    await expect(
      pollExecution(clients, "aex_unit", () => false, { timeoutMs: 1000, pollMs: 1, label: "the unit predicate" }),
    ).rejects.toThrow(
      "execution aex_unit did not satisfy the unit predicate within 1000ms " +
        '(observed phases: RUN_PENDING -> RUN_IN_PROGRESS; status.error: "provider refused"; ' +
        'messages: 2, last: "still thinking")',
    );
    expect(get).toHaveBeenCalledWith({ value: "aex_unit" });
  });

  it("reads an absent phase as RUN_PHASE_UNSPECIFIED", async () => {
    const { clients } = queryAnswering([create(RunSchema, {})]);
    await expect(pollExecution(clients, "aex_unit", () => false, { timeoutMs: 1, pollMs: 1 })).rejects.toThrow(
      'did not satisfy the predicate within 1ms (observed phases: RUN_PHASE_UNSPECIFIED; status.error: ""; messages: 0, last: "")',
    );
  });
});

describe("awaitPhase", () => {
  it("returns the run once it reaches the phase", async () => {
    const completed = atPhase(RunPhase.RUN_COMPLETED);
    const { clients } = queryAnswering([completed]);
    await expect(awaitPhase(clients, "aex_unit", RunPhase.RUN_COMPLETED, { timeoutMs: 1, pollMs: 1 })).resolves.toBe(
      completed,
    );
  });

  it("labels its timeout with the phase it awaited", async () => {
    const { clients } = queryAnswering([atPhase(RunPhase.RUN_IN_PROGRESS)]);
    await expect(
      awaitPhase(clients, "aex_unit", RunPhase.RUN_WAITING_FOR_APPROVAL, { timeoutMs: 1, pollMs: 1 }),
    ).rejects.toThrow("did not satisfy phase RUN_WAITING_FOR_APPROVAL within 1ms");
  });
});

describe("allToolCalls", () => {
  it("returns the root transcript's tool calls, then every sub-agent's", () => {
    const execution = create(RunSchema, {
      status: {
        messages: [{ toolCalls: [{ id: "call_root" }] }, { toolCalls: [] }],
        subAgentRuns: [
          { messages: [{ toolCalls: [{ id: "call_sub_a1" }, { id: "call_sub_a2" }] }] },
          { messages: [{ toolCalls: [{ id: "call_sub_b" }] }] },
        ],
      },
    });
    expect(allToolCalls(execution).map((call) => call.id)).toEqual([
      "call_root",
      "call_sub_a1",
      "call_sub_a2",
      "call_sub_b",
    ]);
  });

  it("is empty for a run with no status", () => {
    expect(allToolCalls(create(RunSchema, {}))).toEqual([]);
  });
});
