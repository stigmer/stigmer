import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
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
  startedAt?: string;
  completedAt?: string;
}): SubAgentExecution {
  return create(SubAgentExecutionSchema, {
    id: "sa-1",
    name: "researcher",
    status: opts.status,
    messages: opts.messages ?? [],
    startedAt: opts.startedAt ?? "",
    completedAt: opts.completedAt ?? "",
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

// The Cursor SDK delivers sub-agent internals only at completion (nothing to
// stream mid-run), so the running card's honest live signal is a ticking
// elapsed counter from started_at. Completed cards keep the precise static
// duration (start -> completion), not a counter.
describe("SubAgentSection running duration", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows a ticking elapsed time while running", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-02T12:00:42Z"));

    render(
      <ApprovalContext.Provider value={emptyCtx}>
        <SubAgentSection
          subAgentExecution={subAgent({
            status: SubAgentStatus.SUB_AGENT_IN_PROGRESS,
            startedAt: "2026-07-02T12:00:00Z",
          })}
        />
      </ApprovalContext.Provider>,
    );

    expect(screen.getByText("42s")).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(screen.getByText("1m 2s")).toBeTruthy();
  });

  it("shows no counter while running when started_at is absent", () => {
    render(
      <ApprovalContext.Provider value={emptyCtx}>
        <SubAgentSection
          subAgentExecution={subAgent({ status: SubAgentStatus.SUB_AGENT_IN_PROGRESS })}
        />
      </ApprovalContext.Provider>,
    );
    expect(screen.queryByText(/^\d+s$/)).toBeNull();
  });

  it("shows the static duration (not a counter) once completed", () => {
    render(
      <ApprovalContext.Provider value={emptyCtx}>
        <SubAgentSection
          subAgentExecution={subAgent({
            status: SubAgentStatus.SUB_AGENT_COMPLETED,
            startedAt: "2026-07-02T12:00:00Z",
            completedAt: "2026-07-02T12:01:14.500Z",
          })}
        />
      </ApprovalContext.Provider>,
    );
    // formatDuration's m/s rendering for a completed 74.5s run.
    expect(screen.getByText("1m 15s")).toBeTruthy();
  });
});
