import { describe, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import {
  AgentExecutionSchema,
  AgentExecutionStatusSchema,
  type AgentExecution,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { AgentExecutionSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/spec_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import {
  AgentMessageSchema,
  ToolCallSchema,
  type AgentMessage,
  type ToolCall,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import {
  PendingApprovalSchema,
  type PendingApproval,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/approval_pb";
import {
  SubAgentExecutionSchema,
  type SubAgentExecution,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/subagent_pb";
import {
  ExecutionPhase,
  MessageType,
  ToolCallStatus,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { buildThreadItems, type ThreadItem } from "../MessageThread";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toolCall(id: string, name: string): ToolCall {
  return create(ToolCallSchema, {
    id,
    name,
    status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
  });
}

function aiWithTools(toolCalls: ToolCall[]): AgentMessage {
  return create(AgentMessageSchema, {
    type: MessageType.MESSAGE_AI,
    content: "",
    toolCalls,
  });
}

function approval(toolCallId: string, toolName: string): PendingApproval {
  return create(PendingApprovalSchema, {
    toolCallId,
    toolName,
    argsPreview: "{}",
  });
}

function execution(opts: {
  messages?: AgentMessage[];
  subAgents?: SubAgentExecution[];
  pendingApprovals?: PendingApproval[];
}): AgentExecution {
  return create(AgentExecutionSchema, {
    metadata: create(ApiResourceMetadataSchema, { id: "aex-1" }),
    spec: create(AgentExecutionSpecSchema, { message: "go" }),
    status: create(AgentExecutionStatusSchema, {
      phase: ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL,
      messages: opts.messages ?? [],
      subAgentExecutions: opts.subAgents ?? [],
      pendingApprovals: opts.pendingApprovals ?? [],
    }),
  });
}

function approvalItems(items: ThreadItem[]): ThreadItem[] {
  return items.filter((i) => i.kind === "approval-request");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildThreadItems — inline vs. bottom approval partition", () => {
  it("does NOT emit a bottom card for an approval rendered inline on a regular tool", () => {
    const tc = toolCall("tc-edit", "edit_file");
    const exec = execution({
      messages: [aiWithTools([tc])],
      pendingApprovals: [approval("tc-edit", "edit_file")],
    });

    const items = buildThreadItems([exec], null, null, true, undefined);

    // The tool renders in a group → its gate shows inline → no bottom card.
    expect(approvalItems(items)).toHaveLength(0);
    expect(items.some((i) => i.kind === "tool-group")).toBe(true);
  });

  it("emits a bottom card for an orphan approval with no matching tool row", () => {
    const tc = toolCall("tc-edit", "edit_file");
    const exec = execution({
      messages: [aiWithTools([tc])],
      pendingApprovals: [approval("tc-ghost", "phantom_tool")],
    });

    const items = buildThreadItems([exec], null, null, true, undefined);

    const bottom = approvalItems(items);
    expect(bottom).toHaveLength(1);
    expect(
      bottom[0].kind === "approval-request" && bottom[0].pendingApproval.toolCallId,
    ).toBe("tc-ghost");
  });

  it("emits a bottom card for a task-spawn approval (rendered as a sub-agent, not a tool row)", () => {
    // A `task` call with a matching SubAgentExecution renders as a SubAgentSection,
    // not an approval-capable ToolCallItem — so its spawn gate must surface below.
    const task = toolCall("tc-task", "task");
    const sub = create(SubAgentExecutionSchema, { id: "tc-task", name: "researcher" });
    const exec = execution({
      messages: [aiWithTools([task])],
      subAgents: [sub],
      pendingApprovals: [approval("tc-task", "task")],
    });

    const items = buildThreadItems([exec], null, null, true, undefined);

    expect(items.some((i) => i.kind === "sub-agent")).toBe(true);
    expect(approvalItems(items)).toHaveLength(1);
  });

  it("does NOT emit a bottom card for an approval on a sub-agent's nested tool", () => {
    const task = toolCall("tc-task", "task");
    const sub = create(SubAgentExecutionSchema, {
      id: "tc-task",
      name: "researcher",
      messages: [aiWithTools([toolCall("tc-nested", "fetch")])],
    });
    const exec = execution({
      messages: [aiWithTools([task])],
      subAgents: [sub],
      pendingApprovals: [approval("tc-nested", "fetch")],
    });

    const items = buildThreadItems([exec], null, null, true, undefined);

    // The nested tool renders inside the sub-agent section → inline gate → no bottom card.
    expect(approvalItems(items)).toHaveLength(0);
  });

  it("emits no approval items at all when approvals are disabled", () => {
    const tc = toolCall("tc-edit", "edit_file");
    const exec = execution({
      messages: [aiWithTools([tc])],
      pendingApprovals: [approval("tc-ghost", "phantom_tool")],
    });

    const items = buildThreadItems([exec], null, null, false, undefined);

    expect(approvalItems(items)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Triangulation (CLIENT boundary)
//
// The runner boundary (hitl-resume-approve-all.test.ts) and the server boundary
// (Go controller update_status tests) are covered elsewhere. This pins that the
// SDK thread derivation is a faithful PASSTHROUGH of the persisted transcript:
// every persisted thinking block and tool call must surface as a thread item,
// across both the gated (approval pending) state and the decided/leased resume
// state the user reported. A passing test here exonerates the client and
// localizes the reported "vanishing thinking + first tool call" upstream (the
// server merge); a failing test would indict the derivation instead.
// ---------------------------------------------------------------------------

function thinkingMsg(content: string): AgentMessage {
  return create(AgentMessageSchema, {
    type: MessageType.MESSAGE_THINKING,
    content,
  });
}

function aiText(content: string): AgentMessage {
  return create(AgentMessageSchema, {
    type: MessageType.MESSAGE_AI,
    content,
  });
}

function completedToolCall(id: string, name: string): ToolCall {
  return create(ToolCallSchema, {
    id,
    name,
    status: ToolCallStatus.TOOL_CALL_COMPLETED,
  });
}

function execAtPhase(
  phase: ExecutionPhase,
  messages: AgentMessage[],
  pendingApprovals: PendingApproval[] = [],
): AgentExecution {
  return create(AgentExecutionSchema, {
    metadata: create(ApiResourceMetadataSchema, { id: "aex-1" }),
    spec: create(AgentExecutionSpecSchema, { message: "Self-DM me" }),
    status: create(AgentExecutionStatusSchema, {
      phase,
      messages,
      pendingApprovals,
    }),
  });
}

function hasThinkingItem(items: ThreadItem[], content: string): boolean {
  return items.some(
    (i) =>
      i.kind === "message" &&
      i.message.type === MessageType.MESSAGE_THINKING &&
      i.message.content === content,
  );
}

function hasToolInGroup(items: ThreadItem[], toolCallId: string): boolean {
  return items.some(
    (i) => i.kind === "tool-group" && i.toolCalls.some((tc) => tc.id === toolCallId),
  );
}

describe("buildThreadItems — approve-all transcript renders faithfully (client triangulation)", () => {
  it("renders the leading thinking block and the gated tool while approval is pending", () => {
    const exec = execAtPhase(
      ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL,
      [
        thinkingMsg("planning the self-DM"),
        aiWithTools([toolCall("tc-getappstate", "getAppState")]),
      ],
      [approval("tc-getappstate", "getAppState")],
    );

    const items = buildThreadItems([exec], null, null, true, undefined);

    expect(hasThinkingItem(items, "planning the self-DM")).toBe(true);
    expect(hasToolInGroup(items, "tc-getappstate")).toBe(true);
  });

  it("renders thinking + first tool + appended leased tools after approve-all resume", () => {
    const exec = execAtPhase(ExecutionPhase.EXECUTION_IN_PROGRESS, [
      thinkingMsg("planning the self-DM"),
      aiWithTools([completedToolCall("tc-getappstate", "getAppState")]),
      aiWithTools([completedToolCall("tc-click", "click")]),
      aiText("Captured the app state and clicked the element."),
    ]);

    const items = buildThreadItems([exec], null, null, true, undefined);

    // The leading thinking block and the FIRST tool call survive rendering...
    expect(hasThinkingItem(items, "planning the self-DM")).toBe(true);
    expect(hasToolInGroup(items, "tc-getappstate")).toBe(true);
    // ...alongside the appended leased tool and the final assistant turn.
    expect(hasToolInGroup(items, "tc-click")).toBe(true);
    expect(
      items.some(
        (i) =>
          i.kind === "message" &&
          i.message.content === "Captured the app state and clicked the element.",
      ),
    ).toBe(true);
  });
});
