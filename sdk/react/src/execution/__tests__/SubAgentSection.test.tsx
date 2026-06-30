import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import {
  AgentMessageSchema,
  ToolCallSchema,
  type AgentMessage,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import {
  SubAgentExecutionSchema,
  type SubAgentExecution,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/subagent_pb";
import {
  PendingApprovalSchema,
  type PendingApproval,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/approval_pb";
import {
  MessageType,
  SubAgentStatus,
  ToolCallStatus,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { SubAgentSection } from "../SubAgentSection";
import { ApprovalContext, type ApprovalContextValue } from "../ApprovalContext";

afterEach(cleanup);

function gatedToolMessage(toolCallId: string): AgentMessage {
  return create(AgentMessageSchema, {
    type: MessageType.MESSAGE_AI,
    content: "",
    toolCalls: [
      create(ToolCallSchema, {
        id: toolCallId,
        name: "delete_file",
        status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
      }),
    ],
  });
}

function subAgent(opts: {
  status: SubAgentStatus;
  messages?: AgentMessage[];
}): SubAgentExecution {
  return create(SubAgentExecutionSchema, {
    id: "sa-1",
    name: "researcher",
    status: opts.status,
    messages: opts.messages ?? [],
  });
}

/** The CollapsibleCard's own toggle is the first button under its role=group. */
function sectionExpanded(container: HTMLElement): boolean {
  const toggle = container.querySelector('[role="group"] > button');
  return toggle?.getAttribute("aria-expanded") === "true";
}

const emptyCtx: ApprovalContextValue = {
  approvalsByToolCallId: new Map(),
  submittingIds: new Set(),
  errorsByToolCallId: new Map(),
};

describe("SubAgentSection auto-disclosure", () => {
  it("auto-opens while the sub-agent is running", () => {
    const { container } = render(
      <ApprovalContext.Provider value={emptyCtx}>
        <SubAgentSection
          subAgentExecution={subAgent({ status: SubAgentStatus.SUB_AGENT_IN_PROGRESS })}
        />
      </ApprovalContext.Provider>,
    );
    expect(sectionExpanded(container)).toBe(true);
  });

  it("stays collapsed when the sub-agent has settled", () => {
    const { container } = render(
      <ApprovalContext.Provider value={emptyCtx}>
        <SubAgentSection
          subAgentExecution={subAgent({ status: SubAgentStatus.SUB_AGENT_COMPLETED })}
        />
      </ApprovalContext.Provider>,
    );
    expect(sectionExpanded(container)).toBe(false);
  });

  it("auto-opens a settled sub-agent when a nested tool awaits approval, and shows the gate inline", () => {
    const approval: PendingApproval = create(PendingApprovalSchema, {
      toolCallId: "tc-nested",
      toolName: "delete_file",
      argsPreview: '{"path":"/tmp/x"}',
    });
    const ctx: ApprovalContextValue = {
      approvalsByToolCallId: new Map([["tc-nested", approval]]),
      onSubmit: () => {},
      submittingIds: new Set(),
      errorsByToolCallId: new Map(),
    };

    const { container } = render(
      <ApprovalContext.Provider value={ctx}>
        <SubAgentSection
          subAgentExecution={subAgent({
            status: SubAgentStatus.SUB_AGENT_COMPLETED,
            messages: [gatedToolMessage("tc-nested")],
          })}
        />
      </ApprovalContext.Provider>,
    );

    expect(sectionExpanded(container)).toBe(true);
    // The nested gate's actions surface inside the sub-agent section.
    expect(screen.getByLabelText("Approve")).toBeTruthy();
  });
});
