import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import {
  WorkflowPendingApprovalSchema,
  type WorkflowPendingApproval,
} from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { PendingApprovalSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/approval_pb";
import { ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { ToolKind } from "@stigmer/sdk";
import { WorkflowApprovalList } from "../WorkflowApprovalList";

// The workflow tool-approval surface renders the session's canonical
// ApprovalCard (4-action parity). These tests cover the LIST's own contract —
// per-gate binding, isolation, and degradation; the card's internals
// (chrome, preview dispatch, provenance) are covered by ApprovalCard.test.tsx.
//
// The component is purely presentational: no useStigmer, no RPCs — decisions
// flow only through the supplied `onSubmitApproval` (the workflow-level
// actions hook). Rendering without a StigmerProvider, as these tests do, is
// itself the guardrail that no agentExecution.* path can be reached from here.

afterEach(cleanup);

const noop = () => {};

function makeGate(overrides?: {
  toolCallId?: string;
  toolName?: string;
  childAgentExecutionId?: string;
  argsPreview?: string;
  toolKind?: ToolKind;
}): WorkflowPendingApproval {
  return create(WorkflowPendingApprovalSchema, {
    childAgentExecutionId: overrides?.childAgentExecutionId ?? "agx_child_1",
    approval: create(PendingApprovalSchema, {
      toolCallId: overrides?.toolCallId ?? "tc_1",
      toolName: overrides?.toolName ?? "delete_file",
      toolKind: overrides?.toolKind ?? ToolKind.UNSPECIFIED,
      argsPreview: overrides?.argsPreview ?? '{"path":"/tmp/x"}',
    }),
  });
}

describe("WorkflowApprovalList rendering", () => {
  it("renders nothing when there are no pending approvals", () => {
    const { container } = render(
      <WorkflowApprovalList pendingApprovals={[]} onSubmitApproval={noop} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders one shared ApprovalCard per surfaced gate", () => {
    render(
      <WorkflowApprovalList
        pendingApprovals={[
          makeGate({ toolCallId: "tc_a", toolName: "delete_file" }),
          makeGate({ toolCallId: "tc_b", toolName: "shell", argsPreview: '{"command":"ls"}' }),
        ]}
        onSubmitApproval={noop}
      />,
    );

    // The shared card announces itself per gate (role=alert + tool name).
    expect(screen.getByRole("alert", { name: "Approval required for delete_file" })).toBeTruthy();
    expect(screen.getByRole("alert", { name: "Approval required for shell" })).toBeTruthy();
  });

  it("skips a surfaced gate missing its approval payload (nothing to decide)", () => {
    const orphan = create(WorkflowPendingApprovalSchema, {
      childAgentExecutionId: "agx_orphan",
      // approval intentionally unset.
    });
    render(
      <WorkflowApprovalList
        pendingApprovals={[orphan, makeGate({ toolCallId: "tc_ok" })]}
        onSubmitApproval={noop}
      />,
    );
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  // The two projection guards: WorkflowPendingApproval.approval is the
  // child's fully-projected PendingApproval, forwarded verbatim (Java signal
  // → runner → parent status). These assert the workflow surface actually
  // benefits — a projection regression upstream fails here.

  it("resolves the category label from the projected wire tool_kind", () => {
    // A tool name the name-based fallback cannot classify — only the
    // server-projected tool_kind can.
    render(
      <WorkflowApprovalList
        pendingApprovals={[
          makeGate({
            toolCallId: "tc_proj_kind",
            toolName: "SomeFutureEditTool",
            toolKind: ToolKind.FILE_EDIT,
            argsPreview: "{}",
          }),
        ]}
        onSubmitApproval={noop}
      />,
    );
    expect(screen.getByText("Edit")).toBeTruthy();
  });

  it("renders the proposed change from the projected args_preview", () => {
    render(
      <WorkflowApprovalList
        pendingApprovals={[
          makeGate({
            toolCallId: "tc_proj_content",
            toolName: "write_file",
            toolKind: ToolKind.FILE_EDIT,
            argsPreview: '{"path":"src/x.ts","contents":"x"}',
          }),
        ]}
        onSubmitApproval={noop}
      />,
    );
    // The proposed write content surfaces via the "Content" collapsible.
    expect(screen.getByText("Content")).toBeTruthy();
  });

  it("shows the per-gate 'View agent execution' link only when navigation is wired", () => {
    const onNavigate = vi.fn();
    const { rerender } = render(
      <WorkflowApprovalList
        pendingApprovals={[makeGate({ childAgentExecutionId: "agx_nav" })]}
        onSubmitApproval={noop}
      />,
    );
    expect(screen.queryByRole("button", { name: "View agent execution" })).toBeNull();

    rerender(
      <WorkflowApprovalList
        pendingApprovals={[makeGate({ childAgentExecutionId: "agx_nav" })]}
        onSubmitApproval={noop}
        onNavigateToAgentExecution={onNavigate}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "View agent execution" }));
    expect(onNavigate).toHaveBeenCalledWith("agx_nav");
  });
});

describe("WorkflowApprovalList decision routing (4-action parity)", () => {
  it("routes each of the four actions with the gate's own toolCallId", () => {
    const onSubmitApproval = vi.fn();
    render(
      <WorkflowApprovalList
        pendingApprovals={[makeGate({ toolCallId: "tc_route", toolName: "delete_file" })]}
        onSubmitApproval={onSubmitApproval}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    fireEvent.click(screen.getByRole("button", { name: "Approve all file deletions" }));

    expect(onSubmitApproval).toHaveBeenNthCalledWith(1, "tc_route", ApprovalAction.APPROVE, undefined);
    expect(onSubmitApproval).toHaveBeenNthCalledWith(2, "tc_route", ApprovalAction.SKIP, undefined);
    expect(onSubmitApproval).toHaveBeenNthCalledWith(3, "tc_route", ApprovalAction.REJECT, undefined);
    expect(onSubmitApproval).toHaveBeenNthCalledWith(4, "tc_route", ApprovalAction.APPROVE_ALL, undefined);
  });

  it("routes concurrent gates independently — each card binds its own toolCallId", () => {
    const onSubmitApproval = vi.fn();
    render(
      <WorkflowApprovalList
        pendingApprovals={[
          makeGate({ toolCallId: "tc_first", toolName: "delete_file", childAgentExecutionId: "agx_1" }),
          makeGate({ toolCallId: "tc_second", toolName: "shell", argsPreview: '{"command":"ls"}', childAgentExecutionId: "agx_2" }),
        ]}
        onSubmitApproval={onSubmitApproval}
      />,
    );

    const secondCard = screen.getByRole("alert", { name: "Approval required for shell" });
    fireEvent.click(within(secondCard).getByRole("button", { name: "Approve" }));

    expect(onSubmitApproval).toHaveBeenCalledTimes(1);
    expect(onSubmitApproval).toHaveBeenCalledWith("tc_second", ApprovalAction.APPROVE, undefined);
  });
});

describe("WorkflowApprovalList per-gate in-flight and error isolation", () => {
  it("an in-flight decision disables only ITS gate's actions", () => {
    render(
      <WorkflowApprovalList
        pendingApprovals={[
          makeGate({ toolCallId: "tc_busy", toolName: "delete_file", childAgentExecutionId: "agx_1" }),
          makeGate({ toolCallId: "tc_idle", toolName: "shell", argsPreview: '{"command":"ls"}', childAgentExecutionId: "agx_2" }),
        ]}
        onSubmitApproval={noop}
        submittingToolCallIds={new Set(["tc_busy"])}
      />,
    );

    const busy = screen.getByRole("alert", { name: "Approval required for delete_file" });
    const idle = screen.getByRole("alert", { name: "Approval required for shell" });
    expect(
      (within(busy).getByRole("button", { name: "Approve" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (within(idle).getByRole("button", { name: "Approve" }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("a failed decision surfaces in-card on the failing gate only", () => {
    const { container } = render(
      <WorkflowApprovalList
        pendingApprovals={[
          makeGate({ toolCallId: "tc_failed", toolName: "delete_file", childAgentExecutionId: "agx_1" }),
          makeGate({ toolCallId: "tc_healthy", toolName: "shell", argsPreview: '{"command":"ls"}', childAgentExecutionId: "agx_2" }),
        ]}
        onSubmitApproval={noop}
        approvalErrors={new Map([["tc_failed", new Error("gate already resolved")]])}
      />,
    );

    const errors = container.querySelectorAll('[data-cursor-target="approval-error"]');
    expect(errors).toHaveLength(1);
    expect(errors[0]!.textContent).toContain("gate already resolved");
    const failing = screen.getByRole("alert", { name: "Approval required for delete_file" });
    expect(failing.contains(errors[0]!)).toBe(true);
  });
});
