/**
 * Regression test: resuming an execution from a durable LangGraph checkpoint
 * must NOT wipe the message transcript.
 *
 * This models the cloud path deterministically. On the post-approval
 * re-invocation of ExecuteDeepAgent:
 *   - the persisted execution already holds the run-1 transcript (an AI message
 *     plus the gated tool call in WAITING_APPROVAL, approved by the user);
 *   - the durable checkpoint exists (getState reports prior values + a pending
 *     interrupt), so streamEvents re-emits ONLY the post-interrupt events
 *     (the resumed tool execution + the following assistant turn).
 *
 * The activity must seed its status from the persisted execution so the
 * streamed delta appends onto the existing history, and the resumed tool
 * events must reconcile to the existing gated tool call rather than
 * duplicating it. The persisted status after resume must therefore contain
 * the full transcript with exactly one copy of the gated tool call.
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

// The Temporal activity context is unavailable outside a worker.
vi.mock("@temporalio/activity", () => ({
  Context: {
    current: () => ({
      // A real AbortSignal: the workspace-lock wait registers abort listeners
      // on it, which a bare `{ aborted: false }` stub cannot satisfy.
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

// Capture every persisted status (the gRPC chokepoint) for assertions.
const { persistedStatuses } = vi.hoisted(() => ({
  persistedStatuses: [] as AgentExecutionStatus[],
}));

vi.mock("../../../client/stigmer-client.js", () => ({
  StigmerClient: vi.fn().mockImplementation(() => ({
    updateStatus: vi.fn(async (_id: string, status: AgentExecutionStatus) => {
      // Snapshot point-in-time: persistStatus mutates the same object in place.
      persistedStatuses.push(clone(AgentExecutionStatusSchema, status));
      return { signal: 0 };
    }),
    getExecution: vi.fn(),
  })),
}));

// performSetup is mocked per-test to return a fake durable-resume SetupResult.
vi.mock("../setup.js", () => ({ performSetup: vi.fn() }));

import { createDeepAgentActivities } from "../index.js";
import { performSetup } from "../setup.js";

const GATED_TOOL_CALL_ID = "toolu_hitl_01";
const PRE_RESUME_AI_TEXT = "I'll call the echo tool.";
const POST_RESUME_AI_TEXT = "The echo tool returned the result.";

function v3Event(
  seq: number,
  method: string,
  data: unknown,
  namespace: string[] = [],
): V3ProtocolEvent {
  return {
    type: "event",
    seq,
    method,
    params: { namespace, timestamp: Date.now(), data },
  };
}

/** The events a durable resume re-emits: tool execution + assistant turn. */
function resumeEvents(): V3ProtocolEvent[] {
  return [
    v3Event(0, "tools", {
      event: "tool-started",
      tool_call_id: GATED_TOOL_CALL_ID,
      tool_name: "echo",
      input: { input: "hello-hitl" },
    }, [`tools:${GATED_TOOL_CALL_ID}`]),
    v3Event(1, "tools", {
      event: "tool-finished",
      tool_call_id: GATED_TOOL_CALL_ID,
      output: {
        lc: 1,
        type: "constructor",
        id: ["langchain_core", "messages", "ToolMessage"],
        kwargs: { content: "hello-hitl", tool_call_id: GATED_TOOL_CALL_ID },
      },
    }, [`tools:${GATED_TOOL_CALL_ID}`]),
    v3Event(2, "messages", { event: "message-start", run_id: "r2" }),
    v3Event(3, "messages", {
      event: "content-block-delta",
      index: 0,
      delta: { type: "text-delta", text: POST_RESUME_AI_TEXT },
      run_id: "r2",
    }),
    v3Event(4, "messages", { event: "message-finish", run_id: "r2" }),
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

/** The run-1 transcript already persisted on the execution. */
function persistedRunOneStatus(): AgentExecutionStatus {
  return create(AgentExecutionStatusSchema, {
    phase: ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL,
    startedAt: "2026-06-15T00:00:00.000Z",
    messages: [
      create(AgentMessageSchema, {
        type: MessageType.MESSAGE_AI,
        content: PRE_RESUME_AI_TEXT,
        timestamp: "2026-06-15T00:00:01.000Z",
        toolCalls: [
          create(ToolCallSchema, {
            id: GATED_TOOL_CALL_ID,
            name: "echo",
            status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
            requiresApproval: true,
            approvalMessage: "Execute echo tool",
            approvalAction: ApprovalAction.APPROVE,
            mcpServerSlug: "test-mcp",
          }),
        ],
      }),
    ],
  });
}

function fakeDurableResumeSetup(): SetupResult {
  let streamed = false;

  const pendingInterruptState = {
    values: { messages: [{ role: "assistant", content: PRE_RESUME_AI_TEXT }] },
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
  const resolvedState = {
    values: { messages: [{ role: "assistant", content: PRE_RESUME_AI_TEXT }] },
    tasks: [],
  };

  const agentGraph = {
    // Before the resumed stream: a pending interrupt awaits the decision.
    // After the stream: the interrupt is resolved (no pending approvals).
    getState: vi.fn(async () => (streamed ? resolvedState : pendingInterruptState)),
    streamEvents: vi.fn(async () => {
      streamed = true;
      return mockV3Run(resumeEvents());
    }),
  };

  const approvalPolicies = new Map([
    ["test-mcp/echo", {
      toolName: "echo",
      mcpServerSlug: "test-mcp",
      requiresApproval: true,
      approvalMessage: "Execute echo tool",
    }],
  ]);

  return {
    agentGraph,
    langgraphConfig: { configurable: { thread_id: "thread-1" } },
    langgraphInput: { messages: [{ role: "user", content: "Call echo" }] },
    execution: {
      spec: { message: "Call echo with 'hello-hitl'." },
      status: persistedRunOneStatus(),
    },
    agent: {},
    session: { spec: { workspaceEntries: [] } },
    // Unique per test file: the workspace turn lock keys on this path, and a
    // path shared across files would serialize parallel test workers for real.
    workspaceBackend: { rootDir: "/tmp/stigmer-test-ws-hitl-history" },
    mcpConnection: null,
    mergedEnvVars: {},
    secretKeys: new Set<string>(),
    modelName: "claude-sonnet",
    gracefulStop: undefined,
    artifactStorage: makeInMemoryArtifactStorage({ urlBase: "https://artifacts.local/" }).storage,
    provisionResults: [],
    approvalPolicies,
    toolServerMap: new Map([["echo", "test-mcp"]]),
    autoApproveAll: false,
    hasStructuredOutput: false,
    streamVersion: "v3",
  } as unknown as SetupResult;
}

const baseConfig: Config = {
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
  agentResolveTimeoutMs: 120000,
  workspaceLockTimeoutMs: 900000,
};

describe("ExecuteDeepAgent — durable-checkpoint resume preserves history", () => {
  beforeEach(() => {
    persistedStatuses.length = 0;
    vi.mocked(performSetup).mockResolvedValue(fakeDurableResumeSetup());
  });

  it("retains the full transcript and resolves the gated tool call in place", async () => {
    const activities = createDeepAgentActivities(baseConfig);
    await activities.ExecuteDeepAgent("exec-1", "thread-1");

    expect(persistedStatuses.length).toBeGreaterThan(0);
    const finalStatus = persistedStatuses.at(-1)!;

    // 1. The pre-resume transcript survives the resume.
    const allText = finalStatus.messages.map(m => m.content).join("\n");
    expect(allText).toContain(PRE_RESUME_AI_TEXT);

    // 2. The post-resume assistant turn is appended.
    expect(allText).toContain(POST_RESUME_AI_TEXT);

    // 3. Exactly one copy of the gated tool call — no duplicate on resume.
    const gatedToolCalls = finalStatus.messages
      .flatMap(m => m.toolCalls)
      .filter(tc => tc.id === GATED_TOOL_CALL_ID);
    expect(gatedToolCalls).toHaveLength(1);

    // 4. The gated tool call is resolved with its result, not stuck waiting.
    expect(gatedToolCalls[0].status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
    expect(gatedToolCalls[0].result).toContain("hello-hitl");

    // 5. The execution reaches a terminal COMPLETED phase.
    expect(finalStatus.phase).toBe(ExecutionPhase.EXECUTION_COMPLETED);
  });
});
