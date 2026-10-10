/**
 * The compatibility claim, proven the day the contract lands: every event
 * the contract carries, rendered as Managed Agents JSON (../render.ts),
 * deep-equals a fixture typed against Anthropic's own SDK types at the
 * pinned version (`@anthropic-ai/sdk`, an exact devDependency of this
 * package). `satisfies` makes `tsc` check each fixture against the SDK, and
 * the assertion checks that the renderer produces exactly it. A bump of
 * the pin that reshapes an event the contract carries fails here first.
 */
import { create } from "@bufbuild/protobuf";
import type { MessageInitShape } from "@bufbuild/protobuf";
import type {
  BetaManagedAgentsAgentMCPToolResultEvent,
  BetaManagedAgentsAgentMCPToolUseEvent,
  BetaManagedAgentsAgentMessageEvent,
  BetaManagedAgentsAgentThinkingEvent,
  BetaManagedAgentsAgentThreadContextCompactedEvent,
  BetaManagedAgentsAgentThreadMessageReceivedEvent,
  BetaManagedAgentsAgentThreadMessageSentEvent,
  BetaManagedAgentsAgentToolResultEvent,
  BetaManagedAgentsAgentToolUseEvent,
  BetaManagedAgentsSessionErrorEvent,
  BetaManagedAgentsSessionEvent,
  BetaManagedAgentsSessionStatusIdleEvent,
  BetaManagedAgentsSessionStatusRunningEvent,
  BetaManagedAgentsSessionThreadCreatedEvent,
  BetaManagedAgentsSessionThreadStatusIdleEvent,
  BetaManagedAgentsSessionThreadStatusRunningEvent,
  BetaManagedAgentsUserMessageEvent,
} from "@anthropic-ai/sdk/resources/beta/sessions/events";
import type {
  BetaManagedAgentsDeltaEvent,
  BetaManagedAgentsStartEvent,
} from "@anthropic-ai/sdk/resources/beta/sessions/sessions";
import { describe, expect, it } from "vitest";

import { SessionEventSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/event_pb";
import { StreamSessionEventsResponseSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/io_pb";

import { SESSION_EVENT_TYPES } from "../catalog.js";
import { toManagedAgentsJson, toManagedAgentsStreamJson } from "../render.js";

const AT = "2026-10-11T09:30:00.000Z";

type EventInit = MessageInitShape<typeof SessionEventSchema>["event"];

interface Case {
  readonly name: string;
  readonly proto: EventInit;
  readonly sdk: BetaManagedAgentsSessionEvent;
}

const CASES: ReadonlyArray<Case> = [
  {
    name: "user.message, text",
    proto: { case: "userMessage", value: { id: "e1", content: [{ type: "text", text: "summarise the repo" }], processedAt: AT } },
    sdk: {
      id: "e1",
      type: "user.message",
      content: [{ type: "text", text: "summarise the repo" }],
      processed_at: AT,
    } satisfies BetaManagedAgentsUserMessageEvent,
  },
  {
    name: "user.message, an image and a document",
    proto: {
      case: "userMessage",
      value: {
        id: "e2",
        processedAt: AT,
        content: [
          { type: "image", source: { type: "base64", mediaType: "image/png", data: "aGk=" } },
          { type: "document", source: { type: "url", url: "https://example.com/a.pdf" }, title: "a" },
          { type: "document", source: { type: "file", fileId: "file_1" } },
        ],
      },
    },
    sdk: {
      id: "e2",
      type: "user.message",
      processed_at: AT,
      content: [
        { type: "image", source: { type: "base64", media_type: "image/png", data: "aGk=" } },
        { type: "document", source: { type: "url", url: "https://example.com/a.pdf" }, title: "a" },
        { type: "document", source: { type: "file", file_id: "file_1" } },
      ],
    } satisfies BetaManagedAgentsUserMessageEvent,
  },
  {
    name: "session.status_running",
    proto: { case: "sessionStatusRunning", value: { id: "e3", processedAt: AT } },
    sdk: { id: "e3", type: "session.status_running", processed_at: AT } satisfies BetaManagedAgentsSessionStatusRunningEvent,
  },
  {
    name: "session.status_idle, end_turn",
    proto: { case: "sessionStatusIdle", value: { id: "e4", processedAt: AT, stopReason: { type: "end_turn" } } },
    sdk: {
      id: "e4",
      type: "session.status_idle",
      processed_at: AT,
      stop_reason: { type: "end_turn" },
      stop_details: null,
    } satisfies BetaManagedAgentsSessionStatusIdleEvent,
  },
  {
    name: "session.status_idle, requires_action",
    proto: {
      case: "sessionStatusIdle",
      value: { id: "e5", processedAt: AT, stopReason: { type: "requires_action", eventIds: ["e10", "e11"] } },
    },
    sdk: {
      id: "e5",
      type: "session.status_idle",
      processed_at: AT,
      stop_reason: { type: "requires_action", event_ids: ["e10", "e11"] },
      stop_details: null,
    } satisfies BetaManagedAgentsSessionStatusIdleEvent,
  },
  {
    name: "session.status_idle, a refusal with its details",
    proto: {
      case: "sessionStatusIdle",
      value: { id: "e6", processedAt: AT, stopReason: { type: "refusal" }, stopDetails: { type: "refusal", category: "cyber" } },
    },
    sdk: {
      id: "e6",
      type: "session.status_idle",
      processed_at: AT,
      stop_reason: { type: "refusal" },
      stop_details: { type: "refusal", category: "cyber", explanation: null },
    } satisfies BetaManagedAgentsSessionStatusIdleEvent,
  },
  {
    name: "session.error, unknown_error",
    proto: {
      case: "sessionError",
      value: { id: "e7", processedAt: AT, error: { type: "unknown_error", message: "boom", retryStatus: { type: "terminal" } } },
    },
    sdk: {
      id: "e7",
      type: "session.error",
      processed_at: AT,
      error: { type: "unknown_error", message: "boom", retry_status: { type: "terminal" } },
    } satisfies BetaManagedAgentsSessionErrorEvent,
  },
  {
    name: "session.error, mcp_connection_failed_error",
    proto: {
      case: "sessionError",
      value: {
        id: "e8",
        processedAt: AT,
        error: { type: "mcp_connection_failed_error", message: "refused", mcpServerName: "linear", retryStatus: { type: "retrying" } },
      },
    },
    sdk: {
      id: "e8",
      type: "session.error",
      processed_at: AT,
      error: { type: "mcp_connection_failed_error", message: "refused", mcp_server_name: "linear", retry_status: { type: "retrying" } },
    } satisfies BetaManagedAgentsSessionErrorEvent,
  },
  {
    name: "agent.message, text and redacted",
    proto: { case: "agentMessage", value: { id: "e9", processedAt: AT, content: [{ type: "text", text: "done" }, { type: "redacted" }] } },
    sdk: {
      id: "e9",
      type: "agent.message",
      processed_at: AT,
      content: [{ type: "text", text: "done" }, { type: "redacted" }],
    } satisfies BetaManagedAgentsAgentMessageEvent,
  },
  {
    name: "agent.thinking",
    proto: { case: "agentThinking", value: { id: "e10", processedAt: AT } },
    sdk: { id: "e10", type: "agent.thinking", processed_at: AT } satisfies BetaManagedAgentsAgentThinkingEvent,
  },
  {
    name: "agent.tool_use, every field",
    proto: {
      case: "agentToolUse",
      value: {
        id: "e11",
        processedAt: AT,
        name: "bash",
        input: { command: "ls" },
        evaluatedPermission: "ask",
        evaluation: { type: "auto", evaluatedPermission: { type: "ask", reasonCode: "writes_files" } },
        sessionThreadId: "thr_1",
      },
    },
    sdk: {
      id: "e11",
      type: "agent.tool_use",
      processed_at: AT,
      name: "bash",
      input: { command: "ls" },
      evaluated_permission: "ask",
      evaluation: { type: "auto", evaluated_permission: { type: "ask", reason_code: "writes_files" } },
      session_thread_id: "thr_1",
    } satisfies BetaManagedAgentsAgentToolUseEvent,
  },
  {
    name: "agent.tool_use, the required fields only",
    proto: { case: "agentToolUse", value: { id: "e12", processedAt: AT, name: "read", input: {} } },
    sdk: { id: "e12", type: "agent.tool_use", processed_at: AT, name: "read", input: {} } satisfies BetaManagedAgentsAgentToolUseEvent,
  },
  {
    name: "agent.tool_result",
    proto: {
      case: "agentToolResult",
      value: { id: "e13", processedAt: AT, toolUseId: "e11", content: [{ type: "text", text: "a.txt" }], isError: true },
    },
    sdk: {
      id: "e13",
      type: "agent.tool_result",
      processed_at: AT,
      tool_use_id: "e11",
      content: [{ type: "text", text: "a.txt" }],
      is_error: true,
    } satisfies BetaManagedAgentsAgentToolResultEvent,
  },
  {
    name: "agent.mcp_tool_use",
    proto: {
      case: "agentMcpToolUse",
      value: { id: "e14", processedAt: AT, mcpServerName: "linear", name: "list_issues", input: {}, evaluatedPermission: "allow" },
    },
    sdk: {
      id: "e14",
      type: "agent.mcp_tool_use",
      processed_at: AT,
      mcp_server_name: "linear",
      name: "list_issues",
      input: {},
      evaluated_permission: "allow",
    } satisfies BetaManagedAgentsAgentMCPToolUseEvent,
  },
  {
    name: "agent.mcp_tool_result",
    proto: { case: "agentMcpToolResult", value: { id: "e15", processedAt: AT, mcpToolUseId: "e14", content: [{ type: "text", text: "[]" }] } },
    sdk: {
      id: "e15",
      type: "agent.mcp_tool_result",
      processed_at: AT,
      mcp_tool_use_id: "e14",
      content: [{ type: "text", text: "[]" }],
    } satisfies BetaManagedAgentsAgentMCPToolResultEvent,
  },
  {
    name: "session.thread_created",
    proto: { case: "sessionThreadCreated", value: { id: "e16", processedAt: AT, agentName: "researcher", sessionThreadId: "thr_1" } },
    sdk: {
      id: "e16",
      type: "session.thread_created",
      processed_at: AT,
      agent_name: "researcher",
      session_thread_id: "thr_1",
    } satisfies BetaManagedAgentsSessionThreadCreatedEvent,
  },
  {
    name: "session.thread_status_running",
    proto: { case: "sessionThreadStatusRunning", value: { id: "e17", processedAt: AT, agentName: "researcher", sessionThreadId: "thr_1" } },
    sdk: {
      id: "e17",
      type: "session.thread_status_running",
      processed_at: AT,
      agent_name: "researcher",
      session_thread_id: "thr_1",
    } satisfies BetaManagedAgentsSessionThreadStatusRunningEvent,
  },
  {
    name: "session.thread_status_idle",
    proto: {
      case: "sessionThreadStatusIdle",
      value: { id: "e18", processedAt: AT, agentName: "researcher", sessionThreadId: "thr_1", stopReason: { type: "end_turn" } },
    },
    sdk: {
      id: "e18",
      type: "session.thread_status_idle",
      processed_at: AT,
      agent_name: "researcher",
      session_thread_id: "thr_1",
      stop_reason: { type: "end_turn" },
      stop_details: null,
    } satisfies BetaManagedAgentsSessionThreadStatusIdleEvent,
  },
  {
    name: "agent.thread_message_sent",
    proto: {
      case: "agentThreadMessageSent",
      value: { id: "e19", processedAt: AT, toSessionThreadId: "thr_1", toAgentName: "researcher", content: [{ type: "text", text: "look" }] },
    },
    sdk: {
      id: "e19",
      type: "agent.thread_message_sent",
      processed_at: AT,
      to_session_thread_id: "thr_1",
      to_agent_name: "researcher",
      content: [{ type: "text", text: "look" }],
    } satisfies BetaManagedAgentsAgentThreadMessageSentEvent,
  },
  {
    name: "agent.thread_message_received",
    proto: {
      case: "agentThreadMessageReceived",
      value: { id: "e20", processedAt: AT, fromSessionThreadId: "thr_1", content: [{ type: "text", text: "found" }] },
    },
    sdk: {
      id: "e20",
      type: "agent.thread_message_received",
      processed_at: AT,
      from_session_thread_id: "thr_1",
      content: [{ type: "text", text: "found" }],
    } satisfies BetaManagedAgentsAgentThreadMessageReceivedEvent,
  },
  {
    name: "agent.thread_context_compacted",
    proto: { case: "agentThreadContextCompacted", value: { id: "e21", processedAt: AT } },
    sdk: { id: "e21", type: "agent.thread_context_compacted", processed_at: AT } satisfies BetaManagedAgentsAgentThreadContextCompactedEvent,
  },
];

describe("every event the contract carries renders as the pinned SDK types it", () => {
  it.each(CASES)("$name", ({ proto, sdk }) => {
    const event = create(SessionEventSchema, { seq: 7n, sessionId: "ses_1", runId: "run_1", event: proto });
    expect(toManagedAgentsJson(event)).toEqual(sdk);
  });

  it("the cases cover every event type the contract lands", () => {
    expect(new Set(CASES.map((c) => c.sdk.type))).toEqual(new Set(SESSION_EVENT_TYPES));
  });
});

describe("stream previews render as the SDK's event_start and event_delta", () => {
  it("event_start", () => {
    const frame = create(StreamSessionEventsResponseSchema, {
      frame: { case: "eventStart", value: { event: { id: "e9", type: "agent.message" } } },
    });
    expect(toManagedAgentsStreamJson(frame)).toEqual({
      type: "event_start",
      event: { id: "e9", type: "agent.message" },
    } satisfies BetaManagedAgentsStartEvent);
  });

  it("event_delta", () => {
    const frame = create(StreamSessionEventsResponseSchema, {
      frame: {
        case: "eventDelta",
        value: { eventId: "e9", delta: { type: "content_delta", index: 1, content: { type: "text", text: "do" } } },
      },
    });
    expect(toManagedAgentsStreamJson(frame)).toEqual({
      type: "event_delta",
      event_id: "e9",
      delta: { type: "content_delta", index: 1, content: { type: "text", text: "do" } },
    } satisfies BetaManagedAgentsDeltaEvent);
  });

  it("a stored event in the stream renders as the event itself", () => {
    const frame = create(StreamSessionEventsResponseSchema, {
      frame: { case: "event", value: { event: { case: "agentThinking", value: { id: "e10", processedAt: AT } } } },
    });
    expect(toManagedAgentsStreamJson(frame)).toEqual({ id: "e10", type: "agent.thinking", processed_at: AT });
  });
});
