/**
 * REJECT semantics across both checkpointers (issue #197).
 *
 * These tests exercise the full ExecuteDeepAgent activity on the post-decision
 * re-invocation after a user REJECTS a gated tool call, under BOTH the durable
 * (http, cloud) and ephemeral (memory, OSS/desktop) checkpointers.
 *
 * The contract (deny-tool-and-continue): a rejected tool is NOT executed, the
 * user's objection is fed back to the model, and the execution CONTINUES to
 * EXECUTION_COMPLETED — identically on both checkpointers. The rejected tool
 * call is terminalized (never left stuck at WAITING_APPROVAL) with
 * approval_action=REJECT recorded for audit.
 *
 * Modeled on hitl-resume-history.test.ts (http) and sequential-gate-resume.test.ts
 * (memory): performSetup + the agent graph are mocked so the assertions isolate
 * the activity's resume orchestration and status reconciliation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeInMemoryArtifactStorage } from "../../../__test-utils__/fake-artifact-storage.js";
import { create, clone } from "@bufbuild/protobuf";
import {
  AgentExecutionStatusSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { AgentExecutionStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  AgentMessageSchema,
  ToolCallSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import {
  ApprovalAction,
  ExecutionPhase,
  MessageType,
  ToolCallStatus,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { V3ProtocolEvent } from "../v3-event-recorder.js";
import type { Config } from "../../../config.js";
import type { SetupResult } from "../setup.js";

vi.mock("@temporalio/activity", () => ({
  Context: {
    current: () => ({
      cancellationSignal: new AbortController().signal,
      heartbeat: vi.fn(),
    }),
  },
  CancelledFailure: class CancelledFailure extends Error {},
}));

vi.mock("../../../idle-watchdog.js", () => ({
  activityStarted: vi.fn(),
  activityFinished: vi.fn(),
}));

const { persistedStatuses } = vi.hoisted(() => ({
  persistedStatuses: [] as AgentExecutionStatus[],
}));

vi.mock("../../../client/stigmer-client.js", () => ({
  StigmerClient: vi.fn().mockImplementation(() => ({
    updateStatus: vi.fn(async (_id: string, status: AgentExecutionStatus) => {
      persistedStatuses.push(clone(AgentExecutionStatusSchema, status));
      return { signal: 0 };
    }),
    getExecution: vi.fn(),
  })),
}));

vi.mock("../setup.js", () => ({ performSetup: vi.fn() }));

import { createDeepAgentActivities } from "../index.js";
import { performSetup } from "../setup.js";

const GATED_TOOL_CALL_ID = "toolu_reject_01";
const PRE_AI_TEXT = "I'll call the echo tool.";
const POST_AI_TEXT = "Understood — I'll proceed without that tool.";
const REJECT_COMMENT = "not this time";

function v3Event(seq: number, method: string, data: unknown, namespace: string[] = []): V3ProtocolEvent {
  return { type: "event", seq, method, params: { namespace, timestamp: Date.now(), data } };
}

/**
 * A rejected tool does NOT execute, so the resumed stream carries only the
 * model's follow-up assistant turn reacting to the rejection — no
 * tool-started / tool-finished for the gated call.
 */
function postRejectAssistantTurn(): V3ProtocolEvent[] {
  return [
    v3Event(0, "messages", { event: "message-start", run_id: "r2" }),
    v3Event(1, "messages", {
      event: "content-block-delta",
      index: 0,
      delta: { type: "text-delta", text: POST_AI_TEXT },
      run_id: "r2",
    }),
    v3Event(2, "messages", { event: "message-finish", run_id: "r2" }),
  ];
}

function mockV3Run(events: V3ProtocolEvent[]) {
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const e of events) yield e;
    },
    output: Promise.resolve({ messages: [] }),
    abort: vi.fn(),
    signal: new AbortController().signal,
  };
}

/** Run-1 transcript with the gated call carrying the user's REJECT decision. */
function persistedRejectedStatus(): AgentExecutionStatus {
  return create(AgentExecutionStatusSchema, {
    phase: ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL,
    startedAt: "2026-06-15T00:00:00.000Z",
    messages: [
      create(AgentMessageSchema, {
        type: MessageType.MESSAGE_AI,
        content: PRE_AI_TEXT,
        timestamp: "2026-06-15T00:00:01.000Z",
        toolCalls: [
          create(ToolCallSchema, {
            id: GATED_TOOL_CALL_ID,
            name: "echo",
            status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
            requiresApproval: true,
            approvalMessage: "Execute echo tool",
            approvalAction: ApprovalAction.REJECT,
            mcpServerSlug: "test-mcp",
          }),
        ],
      }),
    ],
  });
}

const approvalPolicies = new Map([
  ["test-mcp/echo", {
    toolName: "echo",
    mcpServerSlug: "test-mcp",
    requiresApproval: true,
    approvalMessage: "Execute echo tool",
  }],
]);

/** Durable (http) resume: getState reports a pending interrupt, then resolves. */
function fakeHttpRejectSetup(): SetupResult {
  let streamed = false;
  const pendingInterruptState = {
    values: { messages: [{ role: "assistant", content: PRE_AI_TEXT }] },
    tasks: [{
      id: "task-1",
      interrupts: [{
        value: {
          tool_call_id: GATED_TOOL_CALL_ID,
          tool_name: "echo",
          mcp_server_slug: "test-mcp",
          message: "Execute echo tool",
        },
        resumeValue: undefined,
      }],
    }],
  };
  const resolvedState = { values: { messages: [{ role: "assistant", content: PRE_AI_TEXT }] }, tasks: [] };

  const agentGraph = {
    getState: vi.fn(async () => (streamed ? resolvedState : pendingInterruptState)),
    streamEvents: vi.fn(async () => {
      streamed = true;
      return mockV3Run(postRejectAssistantTurn());
    }),
  };

  return {
    agentGraph,
    langgraphConfig: { configurable: { thread_id: "thread-reject-http" } },
    langgraphInput: { messages: [{ role: "user", content: "Call echo" }] },
    execution: {
      spec: { message: "Call echo with 'hello'." },
      status: persistedRejectedStatus(),
    },
    agent: {},
    session: { spec: { workspaceEntries: [] } },
    workspaceBackend: { rootDir: "/tmp/stigmer-test-ws-reject-http" },
    mcpConnection: null,
    mergedEnvVars: {},
    secretKeys: new Set<string>(),
    modelName: "claude-sonnet",
    gracefulStop: undefined,
    artifactStorage: makeInMemoryArtifactStorage({ urlBase: "https://artifacts.local/" }).storage,
    provisionResults: [],
    approvalPolicies,
    toolServerMap: new Map([["echo", "test-mcp"]]),
    leasedCategories: new Set(),
    globalBypass: false,
    hasStructuredOutput: false,
    streamVersion: "v3",
  } as unknown as SetupResult;
}

/** Memory resume: empty live checkpoint (replay), stream completes with a turn. */
function fakeMemoryRejectSetup(): SetupResult {
  const emptyState = { values: { messages: [] as unknown[] }, tasks: [] };
  const agentGraph = {
    getState: vi.fn(async () => emptyState),
    streamEvents: vi.fn(async () => mockV3Run(postRejectAssistantTurn())),
  };

  return {
    agentGraph,
    langgraphConfig: { configurable: { thread_id: "thread-reject-mem" } },
    langgraphInput: { messages: [{ role: "user", content: "Call echo" }] },
    execution: {
      spec: { message: "Call echo with 'hello'." },
      status: persistedRejectedStatus(),
    },
    agent: {},
    session: { spec: { workspaceEntries: [] } },
    workspaceBackend: { rootDir: "/tmp/stigmer-test-ws-reject-mem" },
    mcpConnection: null,
    mergedEnvVars: {},
    secretKeys: new Set<string>(),
    modelName: "claude-sonnet",
    gracefulStop: undefined,
    artifactStorage: makeInMemoryArtifactStorage({ urlBase: "https://artifacts.local/" }).storage,
    provisionResults: [],
    approvalPolicies,
    toolServerMap: new Map([["echo", "test-mcp"]]),
    leasedCategories: new Set(),
    globalBypass: false,
    hasStructuredOutput: false,
    streamVersion: "v3",
  } as unknown as SetupResult;
}

const httpConfig: Config = {
  taskQueue: "test-queue",
  temporalAddress: "localhost:7233",
  temporalNamespace: "default",
  stigmerBackendEndpoint: "http://localhost:7234",
  stigmerToken: null,
  cursorApiKey: "",
  workspaceRootDir: "/tmp/test",
  mode: "cloud",
  proxyEndpoint: "http://localhost:7234",
  maxConcurrentActivities: 5,
  idleTimeoutSeconds: null,
  cloudModeEnabled: true,
  checkpointerType: "http",
  checkpointerProxyEndpoint: "http://localhost:7234",
  primaryModel: "claude-sonnet",
  cursorStreamStallTimeoutMs: 180000,
  workspaceLockTimeoutMs: 900000,
};

const memoryConfig: Config = {
  ...httpConfig,
  mode: "local",
  proxyEndpoint: null,
  cloudModeEnabled: false,
  checkpointerType: "memory",
  checkpointerProxyEndpoint: null,
};

function gatedToolCall(status: AgentExecutionStatus) {
  return status.messages.flatMap(m => m.toolCalls).find(tc => tc.id === GATED_TOOL_CALL_ID);
}

describe("ExecuteDeepAgent — REJECT continues the execution (issue #197)", () => {
  beforeEach(() => {
    persistedStatuses.length = 0;
  });

  it("http checkpointer: reject denies the tool and the execution COMPLETES", async () => {
    vi.mocked(performSetup).mockResolvedValue(fakeHttpRejectSetup());
    const activities = createDeepAgentActivities(httpConfig);
    await activities.ExecuteDeepAgent("exec-reject-http", "thread-reject-http");

    const final = persistedStatuses.at(-1)!;
    expect(final.phase, "rejected execution continues to COMPLETED").toBe(
      ExecutionPhase.EXECUTION_COMPLETED,
    );

    const tc = gatedToolCall(final);
    expect(tc, "the gated tool call is present").toBeDefined();
    expect(
      tc!.status,
      "rejected tool call is terminalized (SKIPPED), never stuck at WAITING_APPROVAL",
    ).toBe(ToolCallStatus.TOOL_CALL_SKIPPED);
    expect(tc!.approvalAction, "the REJECT decision is preserved for audit").toBe(
      ApprovalAction.REJECT,
    );
  });

  it("memory checkpointer: reject denies the tool and the execution COMPLETES", async () => {
    vi.mocked(performSetup).mockResolvedValue(fakeMemoryRejectSetup());
    const activities = createDeepAgentActivities(memoryConfig);
    await activities.ExecuteDeepAgent("exec-reject-mem", "thread-reject-mem");

    const final = persistedStatuses.at(-1)!;
    expect(final.phase, "rejected execution continues to COMPLETED on memory too").toBe(
      ExecutionPhase.EXECUTION_COMPLETED,
    );

    const tc = gatedToolCall(final);
    expect(tc, "the gated tool call is present").toBeDefined();
    expect(
      tc!.status,
      "rejected tool call is terminalized identically on memory",
    ).toBe(ToolCallStatus.TOOL_CALL_SKIPPED);
    expect(tc!.approvalAction).toBe(ApprovalAction.REJECT);
  });
});
