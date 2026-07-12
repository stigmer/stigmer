import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import { Text, Box } from "ink";
import { create } from "@bufbuild/protobuf";
import { AgentMessageSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { MessageType, ExecutionPhase, ToolCallStatus, ApprovalAction, ApprovalPolicySource } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { ToolCallSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { PendingApprovalSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/approval_pb";
import { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { MessageEntry } from "../components/MessageEntry.js";
import { ExecutionProgress } from "../components/ExecutionProgress.js";
import { ToolCallItem } from "../components/ToolCallItem.js";
import { ApprovalPrompt } from "../components/ApprovalPrompt.js";
import { MessageThread } from "../components/MessageThread.js";

describe("MessageEntry", () => {
  it("renders a human message with 'You' prefix", () => {
    const msg = create(AgentMessageSchema);
    msg.type = MessageType.MESSAGE_HUMAN;
    msg.content = "Hello agent";

    const { lastFrame } = render(<MessageEntry message={msg} />);
    const output = lastFrame() ?? "";
    expect(output).toContain("You");
    expect(output).toContain("Hello agent");
  });

  it("renders an AI message with 'Agent' prefix", () => {
    const msg = create(AgentMessageSchema);
    msg.type = MessageType.MESSAGE_AI;
    msg.content = "Here is the answer";
    msg.isStreaming = false;

    const { lastFrame } = render(<MessageEntry message={msg} />);
    const output = lastFrame() ?? "";
    expect(output).toContain("Agent");
    expect(output).toContain("answer");
  });

  it("renders a system message in dim style", () => {
    const msg = create(AgentMessageSchema);
    msg.type = MessageType.MESSAGE_SYSTEM;
    msg.content = "System notice";

    const { lastFrame } = render(<MessageEntry message={msg} />);
    const output = lastFrame() ?? "";
    expect(output).toContain("System notice");
  });

  it("renders nothing for tool messages", () => {
    const msg = create(AgentMessageSchema);
    msg.type = MessageType.MESSAGE_TOOL;
    msg.content = "tool result";

    const { lastFrame } = render(<MessageEntry message={msg} />);
    expect(lastFrame()).toBe("");
  });

  it("shows 'Thinking...' for streaming AI with no content", () => {
    const msg = create(AgentMessageSchema);
    msg.type = MessageType.MESSAGE_AI;
    msg.content = "";
    msg.isStreaming = true;

    const { lastFrame } = render(<MessageEntry message={msg} />);
    const output = lastFrame() ?? "";
    expect(output).toContain("Thinking...");
  });
});

describe("ExecutionProgress", () => {
  it("shows 'Running' for in-progress phase", () => {
    const { lastFrame } = render(
      <ExecutionProgress phase={ExecutionPhase.EXECUTION_IN_PROGRESS} />,
    );
    const output = lastFrame() ?? "";
    expect(output).toContain("Running");
  });

  it("shows 'Completed' with check for completed phase", () => {
    const { lastFrame } = render(
      <ExecutionProgress phase={ExecutionPhase.EXECUTION_COMPLETED} />,
    );
    const output = lastFrame() ?? "";
    expect(output).toContain("Completed");
    expect(output).toContain("✓");
  });

  it("shows 'Failed' for failed phase", () => {
    const { lastFrame } = render(
      <ExecutionProgress phase={ExecutionPhase.EXECUTION_FAILED} />,
    );
    const output = lastFrame() ?? "";
    expect(output).toContain("Failed");
  });

  it("shows 'Waiting for approval' for approval phase", () => {
    const { lastFrame } = render(
      <ExecutionProgress
        phase={ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL}
      />,
    );
    const output = lastFrame() ?? "";
    expect(output).toContain("Waiting for approval");
  });

  it("renders nothing for unspecified phase", () => {
    const { lastFrame } = render(
      <ExecutionProgress
        phase={ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED}
      />,
    );
    expect(lastFrame()).toBe("");
  });
});

describe("ToolCallItem", () => {
  it("renders tool name with status indicator", () => {
    const tc = create(ToolCallSchema);
    tc.id = "tc-1";
    tc.name = "read_file";
    tc.status = ToolCallStatus.TOOL_CALL_COMPLETED;

    const { lastFrame } = render(<ToolCallItem toolCall={tc} />);
    const output = lastFrame() ?? "";
    expect(output).toContain("Read");
    expect(output).toContain("✓");
  });

  it("shows running indicator for running tools", () => {
    const tc = create(ToolCallSchema);
    tc.id = "tc-2";
    tc.name = "write_file";
    tc.status = ToolCallStatus.TOOL_CALL_RUNNING;

    const { lastFrame } = render(<ToolCallItem toolCall={tc} />);
    const output = lastFrame() ?? "";
    expect(output).toContain("Write");
    expect(output).toContain("running");
  });

  it("shows error for failed tools when expanded", () => {
    const tc = create(ToolCallSchema);
    tc.id = "tc-3";
    tc.name = "execute_command";
    tc.status = ToolCallStatus.TOOL_CALL_FAILED;
    tc.error = "Permission denied";

    const { lastFrame } = render(<ToolCallItem toolCall={tc} expanded />);
    const output = lastFrame() ?? "";
    expect(output).toContain("Permission denied");
  });

  it("renders an interrupted tool with the neutral cut-short glyph (issue #207)", () => {
    const tc = create(ToolCallSchema);
    tc.id = "tc-int";
    tc.name = "execute_command";
    tc.status = ToolCallStatus.TOOL_CALL_INTERRUPTED;

    const { lastFrame } = render(<ToolCallItem toolCall={tc} />);
    const output = lastFrame() ?? "";
    expect(output).toContain("⊘");
    // Settled: no live "running" hint, no success checkmark.
    expect(output).not.toContain("running");
    expect(output).not.toContain("✓");
  });

  it("shows MCP server slug prefix", () => {
    const tc = create(ToolCallSchema);
    tc.id = "tc-4";
    tc.name = "list_resources";
    tc.mcpServerSlug = "github";
    tc.status = ToolCallStatus.TOOL_CALL_COMPLETED;

    const { lastFrame } = render(<ToolCallItem toolCall={tc} />);
    const output = lastFrame() ?? "";
    expect(output).toContain("github/list_resources");
  });
});

describe("ApprovalPrompt", () => {
  it("offers Approve, scope-truthful approve-all, Reject, and Skip", () => {
    const pending = create(PendingApprovalSchema);
    pending.toolCallId = "tc-1";
    pending.toolName = "write_file";

    const { lastFrame } = render(
      <ApprovalPrompt pendingApproval={pending} onSubmit={() => {}} />,
    );
    const output = lastFrame() ?? "";
    expect(output).toContain("[y] Approve");
    // write_file leases the "file edits" class — the label names that class.
    expect(output).toContain("[a] Approve all file edits");
    expect(output).toContain("[n] Reject");
    expect(output).toContain("[s] Skip");
  });

  it("renders the why-gated line from the projected approval_policy_source", () => {
    const pending = create(PendingApprovalSchema);
    pending.toolCallId = "tc-1";
    pending.toolName = "write_file";
    pending.approvalPolicySource = ApprovalPolicySource.AGENT_OVERRIDE;

    const { lastFrame } = render(
      <ApprovalPrompt pendingApproval={pending} onSubmit={() => {}} />,
    );
    const output = lastFrame() ?? "";
    expect(output).toContain("Why:");
    expect(output).toContain("required by agent override");
  });

  it("submits APPROVE_ALL when the 'a' shortcut is pressed", () => {
    const pending = create(PendingApprovalSchema);
    pending.toolCallId = "tc-1";
    pending.toolName = "write_file";
    const onSubmit = vi.fn();

    const { stdin } = render(
      <ApprovalPrompt pendingApproval={pending} onSubmit={onSubmit} />,
    );
    stdin.write("a");

    expect(onSubmit).toHaveBeenCalledWith(ApprovalAction.APPROVE_ALL);
  });

  it("submits APPROVE when the 'y' shortcut is pressed", () => {
    const pending = create(PendingApprovalSchema);
    pending.toolCallId = "tc-1";
    pending.toolName = "write_file";
    const onSubmit = vi.fn();

    const { stdin } = render(
      <ApprovalPrompt pendingApproval={pending} onSubmit={onSubmit} />,
    );
    stdin.write("y");

    expect(onSubmit).toHaveBeenCalledWith(ApprovalAction.APPROVE);
  });

  it("ignores keyboard input when inactive", () => {
    const pending = create(PendingApprovalSchema);
    pending.toolCallId = "tc-1";
    pending.toolName = "write_file";
    const onSubmit = vi.fn();

    const { stdin } = render(
      <ApprovalPrompt
        pendingApproval={pending}
        onSubmit={onSubmit}
        isActive={false}
      />,
    );
    stdin.write("y");
    stdin.write("a");

    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe("MessageThread — multi-approval keyboard arbitration", () => {
  function execWithApprovals(...toolCallIds: string[]) {
    const pendingApprovals = toolCallIds.map((id) => {
      const pa = create(PendingApprovalSchema);
      pa.toolCallId = id;
      pa.toolName = "write_file";
      return pa;
    });
    return create(AgentExecutionSchema, {
      metadata: { id: "aex-1" },
      status: { pendingApprovals },
    });
  }

  it("routes a single keystroke to only the FIRST of multiple pending approvals", () => {
    // The regression lock for the keyboard-sharing bug: two live ApprovalPrompts
    // each had an unconditional useInput, so one keystroke settled both. Now only
    // the first is active.
    const onApprovalSubmit = vi.fn();
    const exec = execWithApprovals("tc-1", "tc-2");

    const { stdin } = render(
      <MessageThread executions={[exec]} onApprovalSubmit={onApprovalSubmit} />,
    );
    stdin.write("y");

    expect(onApprovalSubmit).toHaveBeenCalledTimes(1);
    expect(onApprovalSubmit).toHaveBeenCalledWith("tc-1", ApprovalAction.APPROVE);
  });

  it("keeps the sole pending approval interactive", () => {
    const onApprovalSubmit = vi.fn();
    const exec = execWithApprovals("tc-1");

    const { stdin } = render(
      <MessageThread executions={[exec]} onApprovalSubmit={onApprovalSubmit} />,
    );
    stdin.write("y");

    expect(onApprovalSubmit).toHaveBeenCalledTimes(1);
    expect(onApprovalSubmit).toHaveBeenCalledWith("tc-1", ApprovalAction.APPROVE);
  });
});
