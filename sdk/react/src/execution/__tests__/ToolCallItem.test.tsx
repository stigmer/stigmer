import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { create, type JsonObject } from "@bufbuild/protobuf";
import {
  ToolCallSchema,
  type ToolCall,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import {
  PendingApprovalSchema,
  type PendingApproval,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/approval_pb";
import {
  ApprovalAction,
  ToolCallStatus,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { ToolCallItem } from "../ToolCallItem";
import { ApprovalContext, type ApprovalContextValue } from "../ApprovalContext";

afterEach(cleanup);

function makeToolCall(opts: {
  id?: string;
  name: string;
  args?: Record<string, unknown>;
  result?: string;
  mcpServerSlug?: string;
  status?: ToolCallStatus;
}): ToolCall {
  return create(ToolCallSchema, {
    id: opts.id ?? opts.name,
    name: opts.name,
    args: (opts.args ?? {}) as JsonObject,
    result: opts.result ?? "",
    mcpServerSlug: opts.mcpServerSlug ?? "",
    status: opts.status ?? ToolCallStatus.TOOL_CALL_COMPLETED,
  });
}

/** The row's disclosure toggle is the only element carrying aria-expanded. */
function expanded(container: HTMLElement): boolean {
  return (
    container.querySelector("[aria-expanded]")?.getAttribute("aria-expanded") ===
    "true"
  );
}

describe("ToolCallItem disclosure", () => {
  it("keeps a settled summary tool collapsed", () => {
    const { container } = render(
      <ToolCallItem
        toolCall={makeToolCall({
          name: "Shell",
          args: { command: "ls" },
          result: "files",
        })}
      />,
    );
    expect(expanded(container)).toBe(false);
  });

  it("foregrounds a settled preview (MCP) tool", () => {
    const { container } = render(
      <ToolCallItem
        toolCall={makeToolCall({
          name: "send_message",
          mcpServerSlug: "acme/slack",
          result: "{}",
        })}
      />,
    );
    expect(expanded(container)).toBe(true);
  });

  it("foregrounds a running tool regardless of category", () => {
    const { container } = render(
      <ToolCallItem
        toolCall={makeToolCall({
          name: "Shell",
          args: { command: "sleep 5" },
          status: ToolCallStatus.TOOL_CALL_RUNNING,
        })}
      />,
    );
    expect(expanded(container)).toBe(true);
  });

  it("settles a summary tool closed once it finishes running", () => {
    // The row, not just the hook, must recompute `autoOpen` from the new
    // ToolCall on re-render: a running `summary` tool foregrounds while live,
    // then collapses to its compact summary the moment it completes (the user
    // never touched it). Proves the React.memo + useAutoDisclosure composition.
    const { container, rerender } = render(
      <ToolCallItem
        toolCall={makeToolCall({
          id: "tc-shell",
          name: "Shell",
          args: { command: "ls" },
          status: ToolCallStatus.TOOL_CALL_RUNNING,
        })}
      />,
    );
    expect(expanded(container)).toBe(true);

    rerender(
      <ToolCallItem
        toolCall={makeToolCall({
          id: "tc-shell",
          name: "Shell",
          args: { command: "ls" },
          result: "files",
          status: ToolCallStatus.TOOL_CALL_COMPLETED,
        })}
      />,
    );
    expect(expanded(container)).toBe(false);
  });

  it("foregrounds a gated tool and renders its approval actions inline", () => {
    const tc = makeToolCall({
      id: "tc-gated",
      name: "delete_file",
      status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
    });
    const approval: PendingApproval = create(PendingApprovalSchema, {
      toolCallId: "tc-gated",
      toolName: "delete_file",
      argsPreview: '{"path":"/tmp/x"}',
    });
    const ctx: ApprovalContextValue = {
      approvalsByToolCallId: new Map([["tc-gated", approval]]),
      onSubmit: () => {},
      submittingIds: new Set(),
    };

    const { container } = render(
      <ApprovalContext.Provider value={ctx}>
        <ToolCallItem toolCall={tc} />
      </ApprovalContext.Provider>,
    );

    expect(expanded(container)).toBe(true);
    // The inline body's actions are present right on the gated row.
    expect(screen.getByLabelText("Approve")).toBeTruthy();
    expect(screen.getByLabelText("Approve all file deletions")).toBeTruthy();
  });

  it("routes an inline APPROVE_ALL decision with the gated tool's id", () => {
    // The inline "Approve all ..." escalation must reach the run's submit
    // handler bound to THIS tool call. MessageThread already covers inline
    // APPROVE routing; APPROVE_ALL (the lease escalation) is the untested arm.
    const tc = makeToolCall({
      id: "tc-gated",
      name: "delete_file",
      status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
    });
    const approval: PendingApproval = create(PendingApprovalSchema, {
      toolCallId: "tc-gated",
      toolName: "delete_file",
      argsPreview: '{"path":"/tmp/x"}',
    });
    const onSubmit = vi.fn();
    const ctx: ApprovalContextValue = {
      approvalsByToolCallId: new Map([["tc-gated", approval]]),
      onSubmit,
      submittingIds: new Set(),
    };

    render(
      <ApprovalContext.Provider value={ctx}>
        <ToolCallItem toolCall={tc} />
      </ApprovalContext.Provider>,
    );

    fireEvent.click(screen.getByLabelText("Approve all file deletions"));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(
      "tc-gated",
      ApprovalAction.APPROVE_ALL,
      undefined,
    );
  });
});
