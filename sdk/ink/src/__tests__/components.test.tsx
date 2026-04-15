import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { Text, Box } from "ink";
import { create } from "@bufbuild/protobuf";
import { AgentMessageSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { MessageType, ExecutionPhase, ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { ToolCallSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { MessageEntry } from "../components/MessageEntry.js";
import { ExecutionProgress } from "../components/ExecutionProgress.js";
import { ToolCallItem } from "../components/ToolCallItem.js";

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
    expect(output).toContain("read_file");
    expect(output).toContain("✓");
  });

  it("shows running indicator for running tools", () => {
    const tc = create(ToolCallSchema);
    tc.id = "tc-2";
    tc.name = "write_file";
    tc.status = ToolCallStatus.TOOL_CALL_RUNNING;

    const { lastFrame } = render(<ToolCallItem toolCall={tc} />);
    const output = lastFrame() ?? "";
    expect(output).toContain("write_file");
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
