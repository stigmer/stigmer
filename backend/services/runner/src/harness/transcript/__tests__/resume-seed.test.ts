/**
 * What a resumed invocation seeds from the session's log (`resume-seed.ts`):
 * only the asked calls with no result, with what their asks state, the
 * sub-agent threads holding them and their task calls; plus the run's newest
 * root answer and its memory selection. Every other logged fact stays the
 * log's.
 */

import { create, type MessageInitShape } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { SessionEventSchema, type SessionEvent } from "@stigmer/protos/ai/stigmer/agentic/session/v1/event_pb";

import { permissionAskedEventId, threadEventId, toolResultEventId, toolUseEventId } from "../../events/ids.js";
import { NO_RESUME_SEED, RESUME_SEED_EVENT_TYPES, resumeSeedOf, rowIdOf } from "../resume-seed.js";
import { ApprovalPolicySource, MessageType, SubAgentStatus, ToolCallStatus, ToolKind } from "../../../gen/turn/ai/stigmer/runner/turn/v1/enum_pb.js";

const RUN = "run_01seed";

type Value = MessageInitShape<typeof SessionEventSchema>["event"];

function event(value: Value, threadId = "", runId = RUN): SessionEvent {
  return create(SessionEventSchema, { runId, threadId, event: value });
}

function use(callId: string, opts: { readonly permission?: string; readonly thread?: string; readonly name?: string; readonly mcp?: string } = {}): SessionEvent {
  const id = toolUseEventId(RUN, callId);
  const common = { id, input: { command: `run ${callId}` }, name: opts.name ?? "shell", evaluatedPermission: opts.permission ?? "", sessionThreadId: opts.thread ?? "" };
  return opts.mcp === undefined
    ? event({ case: "agentToolUse", value: common }, opts.thread ?? "")
    : event({ case: "agentMcpToolUse", value: { ...common, mcpServerName: opts.mcp } }, opts.thread ?? "");
}

function asked(callId: string, policySource = "builtin_category", contentDigest = ""): SessionEvent {
  const toolUseId = toolUseEventId(RUN, callId);
  return event({
    case: "stigmerPermissionAsked",
    value: { id: permissionAskedEventId(toolUseId), toolUseId, message: `Run ${callId}?`, argsPreview: `{"command":"run ${callId}"}`, policySource, policyHook: "", contentDigest, processedAt: "2026-01-01T00:00:01Z" },
  });
}

function result(callId: string): SessionEvent {
  const useId = toolUseEventId(RUN, callId);
  return event({ case: "agentToolResult", value: { id: toolResultEventId(useId), toolUseId: useId, content: [], isError: false } });
}

function message(text: string, threadId = ""): SessionEvent {
  return event({ case: "agentMessage", value: { id: `${RUN}.m.${text}`, content: [{ type: "text", text }] } }, threadId);
}

describe("resumeSeedOf", () => {
  it("names the types it reads, and seeds nothing from an empty log", () => {
    expect(RESUME_SEED_EVENT_TYPES).toContain("agent.tool_use");
    expect(resumeSeedOf(RUN, [])).toEqual(NO_RESUME_SEED);
  });

  it("seeds each asked call with no result as a WAITING row carrying its ask, on a message with no text", () => {
    const seed = resumeSeedOf(RUN, [
      message("Building now."),
      use("call-read"),
      result("call-read"),
      use("call-done", { permission: "ask" }),
      asked("call-done"),
      result("call-done"),
      use("call-build", { permission: "ask" }),
      asked("call-build", "hook", "sha256:abc"),
    ]);
    expect(seed.rows.subAgentRuns).toEqual([]);
    expect(seed.rows.messages).toHaveLength(1);
    const [holder] = seed.rows.messages;
    expect([holder!.type, holder!.content]).toEqual([MessageType.MESSAGE_AI, ""]);
    expect(holder!.toolCalls.map((row) => row.id), "a finished ask and an unasked call stay the log's").toEqual(["call-build"]);
    const row = holder!.toolCalls[0]!;
    expect(row.status).toBe(ToolCallStatus.TOOL_CALL_WAITING_APPROVAL);
    expect(row.requiresApproval).toBe(true);
    expect(row.name).toBe("shell");
    expect(row.args).toEqual({ command: "run call-build" });
    expect(row.toolKind).toBe(ToolKind.SHELL);
    expect([row.approvalMessage, row.argsPreview, row.approvalRequestedAt]).toEqual(["Run call-build?", '{"command":"run call-build"}', "2026-01-01T00:00:01Z"]);
    expect([row.approvalPolicySource, row.approvalContentDigest]).toEqual([ApprovalPolicySource.HOOK, "sha256:abc"]);
    expect(seed.answerText, "the run's newest root answer").toBe("Building now.");
  });

  it("seeds an MCP call with its server, an ask the log lost with what its use states, and an unknown rule word as no rule", () => {
    const seed = resumeSeedOf(RUN, [
      use("call-mcp", { permission: "ask", mcp: "linear", name: "create_issue" }),
      asked("call-mcp", "a_rule_from_tomorrow"),
      use("call-bare", { permission: "ask" }),
    ]);
    const [mcp, bare] = seed.rows.messages[0]!.toolCalls;
    expect([mcp!.mcpServerSlug, mcp!.name, mcp!.approvalPolicySource]).toEqual(["linear", "create_issue", ApprovalPolicySource.UNSPECIFIED]);
    expect([bare!.id, bare!.status, bare!.approvalMessage]).toEqual(["call-bare", ToolCallStatus.TOOL_CALL_WAITING_APPROVAL, ""]);
  });

  it("seeds a sub-agent's ask in its own thread, with the thread's row and its task call, running", () => {
    const thread = toolUseEventId(RUN, "task-1");
    const seed = resumeSeedOf(RUN, [
      message("Delegating."),
      use("task-1", { name: "task" }),
      event({ case: "sessionThreadCreated", value: { id: threadEventId(thread, "created"), agentName: "researcher", sessionThreadId: thread } }),
      event({ case: "agentThreadMessageSent", value: { id: threadEventId(thread, "sent"), toSessionThreadId: thread, toAgentName: "researcher", content: [{ type: "text", text: "find it" }] } }),
      message("Searching.", thread),
      use("sub-shell", { permission: "ask", thread }),
      asked("sub-shell"),
    ]);
    expect(seed.rows.messages[0]!.toolCalls.map((row) => [row.id, row.name, row.status])).toEqual([["task-1", "task", ToolCallStatus.TOOL_CALL_RUNNING]]);
    expect(seed.rows.subAgentRuns).toHaveLength(1);
    const sub = seed.rows.subAgentRuns[0]!;
    expect([sub.id, sub.name, sub.input, sub.status]).toEqual(["task-1", "researcher", "find it", SubAgentStatus.SUB_AGENT_IN_PROGRESS]);
    expect(sub.messages[0]!.toolCalls.map((row) => [row.id, row.status])).toEqual([["sub-shell", ToolCallStatus.TOOL_CALL_WAITING_APPROVAL]]);
    expect(seed.answerText, "a thread's message is not the run's answer").toBe("Delegating.");
  });

  it("names a thread whose task call the log lost by the ask's own tool, and seeds no task row for it", () => {
    const thread = toolUseEventId(RUN, "task-gone");
    const seed = resumeSeedOf(RUN, [use("sub-ask", { permission: "ask", thread }), asked("sub-ask")]);
    expect(seed.rows.messages, "no root row: the task call is not in the log").toEqual([]);
    expect(seed.rows.subAgentRuns.map((sub) => [sub.id, sub.name, sub.input])).toEqual([["task-gone", "", ""]]);
  });

  it("reads the run's memory selection once, and ignores another run's events", () => {
    const seed = resumeSeedOf(RUN, [
      event({ case: "stigmerMemoryRecalled", value: { id: `${RUN}.memory`, selectionActive: true, injectedMemoryIds: ["mem-1"], embeddingModel: "embed" } }),
      event({ case: "stigmerMemoryRecalled", value: { id: `${RUN}.memory.again`, selectionActive: false, injectedMemoryIds: [], embeddingModel: "" } }),
      event({ case: "agentMessage", value: { id: "other.m0", content: [{ type: "text", text: "not this run's" }] } }, "", "run_other"),
    ]);
    expect([seed.recalledMemoriesReport?.selectionActive, seed.recalledMemoriesReport?.injectedMemoryIds, seed.recalledMemoriesReport?.embeddingModel]).toEqual([true, ["mem-1"], "embed"]);
    expect(seed.answerText).toBeUndefined();
  });
});

describe("rowIdOf", () => {
  it("is the tool use id's call part, which derives the same tool use id again, a hashed one included", () => {
    expect(rowIdOf(RUN, toolUseEventId(RUN, "call_abc"))).toBe("call_abc");
    const hashed = toolUseEventId(RUN, "call/with/slashes");
    expect(toolUseEventId(RUN, rowIdOf(RUN, hashed))).toBe(hashed);
    expect(rowIdOf(RUN, "not-of-this-run")).toBe("not-of-this-run");
  });
});
