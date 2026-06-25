/**
 * Diagnostic regression test (triangulation — RUNNER boundary).
 *
 * Reproduces the user-reported scenario exactly: a gated `getAppState` call
 * (open-computer-use MCP) is approved with APPROVE_ALL, which leases the whole
 * server so the resume runs `getAppState` AND every following computer-use tool
 * to completion in ONE durable-checkpoint resume — no further interrupts.
 *
 * The reported symptom is that the LEADING thinking block and the FIRST tool
 * call (`getAppState`) vanish from the transcript after approve-all, while the
 * later auto-executed tools remain. This test pins what the RUNNER persists at
 * its single gRPC chokepoint (`updateStatus`). If the runner is faithful, the
 * final status it sends must be a SUPERSET of run-1's transcript: the leading
 * thinking block survives, the gated tool call is reconciled in place (exactly
 * one copy, now COMPLETED), and the leased follow-up tool is appended.
 *
 * Models the cloud path deterministically, mirroring hitl-resume-history.test.ts:
 *   - the persisted execution already holds the run-1 transcript
 *     (THINKING + AI(getAppState WAITING_APPROVAL, approvalAction=APPROVE_ALL));
 *   - the durable checkpoint exists (getState reports prior values + a pending
 *     interrupt), so streamEvents re-emits ONLY post-interrupt events;
 *   - the lease drops open-computer-use from the policy map, so the follow-up
 *     `click` is NOT re-gated (its key is absent from approvalPolicies) and the
 *     resume reaches a terminal COMPLETED phase.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
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
      cancellationSignal: { aborted: false },
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

const MCP_SLUG = "open-computer-use";
const GATED_TOOL_CALL_ID = "toolu_getappstate_01";
const LEASED_TOOL_CALL_ID = "toolu_click_01";
const THINKING_TEXT = "Let me capture the current app state before clicking anything.";
const PRE_RESUME_AI_TEXT = "I'll capture the app state first.";
const POST_RESUME_AI_TEXT = "Captured the app state and clicked the element.";

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

function toolMessageOutput(content: string, toolCallId: string): unknown {
  return {
    lc: 1,
    type: "constructor",
    id: ["langchain_core", "messages", "ToolMessage"],
    kwargs: { content, tool_call_id: toolCallId },
  };
}

/**
 * The events a durable resume re-emits after APPROVE_ALL: the gated tool
 * executes (reconciled in place), then the leased follow-up tool auto-runs,
 * then the assistant produces a final turn. No interrupts — the lease dropped
 * open-computer-use from the policy map.
 */
function resumeEvents(): V3ProtocolEvent[] {
  return [
    // 1. Gated getAppState now runs (reconciled to the seeded WAITING call).
    v3Event(0, "tools", {
      event: "tool-started",
      tool_call_id: GATED_TOOL_CALL_ID,
      tool_name: "getAppState",
      input: {},
    }, [`tools:${GATED_TOOL_CALL_ID}`]),
    v3Event(1, "tools", {
      event: "tool-finished",
      tool_call_id: GATED_TOOL_CALL_ID,
      output: toolMessageOutput("app-state-captured: 3 windows", GATED_TOOL_CALL_ID),
    }, [`tools:${GATED_TOOL_CALL_ID}`]),
    // 2. The model decides to click; the leased tool auto-runs (no gate).
    v3Event(2, "messages", { event: "message-start", run_id: "r2" }),
    v3Event(3, "tools", {
      event: "tool-started",
      tool_call_id: LEASED_TOOL_CALL_ID,
      tool_name: "click",
      input: { x: 10, y: 20 },
    }, [`tools:${LEASED_TOOL_CALL_ID}`]),
    v3Event(4, "tools", {
      event: "tool-finished",
      tool_call_id: LEASED_TOOL_CALL_ID,
      output: toolMessageOutput("clicked at (10,20)", LEASED_TOOL_CALL_ID),
    }, [`tools:${LEASED_TOOL_CALL_ID}`]),
    // 3. Final assistant turn.
    v3Event(5, "messages", { event: "message-start", run_id: "r3" }),
    v3Event(6, "messages", {
      event: "content-block-delta",
      index: 0,
      delta: { type: "text-delta", text: POST_RESUME_AI_TEXT },
      run_id: "r3",
    }),
    v3Event(7, "messages", { event: "message-finish", run_id: "r3" }),
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

/**
 * The run-1 transcript already persisted on the execution: a leading thinking
 * block, then the gated getAppState call the user approved with APPROVE_ALL.
 */
function persistedRunOneStatus(): AgentExecutionStatus {
  return create(AgentExecutionStatusSchema, {
    phase: ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL,
    startedAt: "2026-06-15T00:00:00.000Z",
    messages: [
      create(AgentMessageSchema, {
        type: MessageType.MESSAGE_THINKING,
        content: THINKING_TEXT,
        timestamp: "2026-06-15T00:00:01.000Z",
      }),
      create(AgentMessageSchema, {
        type: MessageType.MESSAGE_AI,
        content: PRE_RESUME_AI_TEXT,
        timestamp: "2026-06-15T00:00:02.000Z",
        toolCalls: [
          create(ToolCallSchema, {
            id: GATED_TOOL_CALL_ID,
            name: "getAppState",
            status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
            requiresApproval: true,
            approvalMessage: "Execute getAppState tool",
            approvalAction: ApprovalAction.APPROVE_ALL,
            mcpServerSlug: MCP_SLUG,
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
          tool_name: "getAppState",
          mcp_server_slug: MCP_SLUG,
          message: "Execute getAppState tool",
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

  // Approve-all leased open-computer-use: the resume's policy map no longer
  // contains the leased server's tools, so the follow-up `click` is NOT gated.
  // Only the originally-gated getAppState policy remains for resume resolution.
  const approvalPolicies = new Map([
    [`${MCP_SLUG}/getAppState`, {
      toolName: "getAppState",
      mcpServerSlug: MCP_SLUG,
      requiresApproval: true,
      approvalMessage: "Execute getAppState tool",
    }],
  ]);

  return {
    agentGraph,
    langgraphConfig: { configurable: { thread_id: "thread-1" } },
    langgraphInput: { messages: [{ role: "user", content: "Self-DM me" }] },
    execution: {
      spec: { message: "Self-DM me to confirm you can." },
      status: persistedRunOneStatus(),
    },
    agent: {},
    session: { spec: { workspaceEntries: [] } },
    workspaceBackend: { rootDir: "/tmp/ws" },
    mcpConnection: null,
    mergedEnvVars: {},
    secretKeys: new Set<string>(),
    modelName: "claude-sonnet",
    gracefulStop: undefined,
    artifactStorage: {
      upload: vi.fn(async (key: string) => key),
      getDownloadUrl: vi.fn(async (key: string) => `https://artifacts.local/${key}`),
      exists: vi.fn(async () => false),
    },
    provisionResults: [],
    approvalPolicies,
    // Both computer-use tools belong to the leased server.
    toolServerMap: new Map([["getAppState", MCP_SLUG], ["click", MCP_SLUG]]),
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
};

describe("ExecuteDeepAgent — APPROVE_ALL durable resume preserves leading thinking + first tool call", () => {
  beforeEach(() => {
    persistedStatuses.length = 0;
    vi.mocked(performSetup).mockResolvedValue(fakeDurableResumeSetup());
  });

  it("keeps the leading thinking block and the gated getAppState call, and appends the leased tool", async () => {
    const activities = createDeepAgentActivities(baseConfig);
    await activities.ExecuteDeepAgent("exec-1", "thread-1");

    expect(persistedStatuses.length).toBeGreaterThan(0);
    const finalStatus = persistedStatuses.at(-1)!;

    // 1. The LEADING thinking block survives the resume (the reported symptom).
    const thinkingMessages = finalStatus.messages.filter(
      m => m.type === MessageType.MESSAGE_THINKING,
    );
    expect(thinkingMessages).toHaveLength(1);
    expect(thinkingMessages[0].content).toBe(THINKING_TEXT);

    // 2. The thinking block stays at the FRONT — it is still messages[0], proving
    //    the transcript was not front-truncated and rebuilt from a later turn.
    expect(finalStatus.messages[0].type).toBe(MessageType.MESSAGE_THINKING);

    // 3. The FIRST tool call (getAppState) is reconciled in place: exactly one
    //    copy, now COMPLETED with its result — not dropped, not duplicated.
    const getAppStateCalls = finalStatus.messages
      .flatMap(m => m.toolCalls)
      .filter(tc => tc.id === GATED_TOOL_CALL_ID);
    expect(getAppStateCalls).toHaveLength(1);
    expect(getAppStateCalls[0].status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
    expect(getAppStateCalls[0].result).toContain("app-state-captured");

    // 4. The leased follow-up tool is appended.
    const clickCalls = finalStatus.messages
      .flatMap(m => m.toolCalls)
      .filter(tc => tc.id === LEASED_TOOL_CALL_ID);
    expect(clickCalls).toHaveLength(1);
    expect(clickCalls[0].status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);

    // 5. The post-resume assistant turn is appended and the run completes.
    const allText = finalStatus.messages.map(m => m.content).join("\n");
    expect(allText).toContain(POST_RESUME_AI_TEXT);
    expect(finalStatus.phase).toBe(ExecutionPhase.EXECUTION_COMPLETED);
  });
});
