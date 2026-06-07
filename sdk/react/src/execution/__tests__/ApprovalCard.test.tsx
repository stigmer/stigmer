import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { PendingApprovalSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/approval_pb";
import { ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { ToolKind } from "@stigmer/sdk";
import { ApprovalCard } from "../ApprovalCard";

afterEach(cleanup);

const noop = () => {};

describe("ApprovalCard tool classification", () => {
  it("honors the denormalized wire tool_kind for a name not in the fallback map", () => {
    // A future/unknown tool name that the name-based resolver cannot classify —
    // only the server-projected tool_kind can. This proves the backend
    // denormalization (Go + Java PendingApproval projection) is consumed.
    const approval = create(PendingApprovalSchema, {
      toolCallId: "tc1",
      toolName: "SomeFutureEditTool",
      toolKind: ToolKind.FILE_EDIT,
      argsPreview: "{}",
    });

    const { getByText } = render(
      <ApprovalCard pendingApproval={approval} onSubmit={noop} />,
    );

    // FILE_EDIT presentation label, not a humanized tool name.
    expect(getByText("Edit")).toBeTruthy();
  });

  it("falls back to name-based classification when tool_kind is unset (legacy)", () => {
    const approval = create(PendingApprovalSchema, {
      toolCallId: "tc2",
      toolName: "delete_file",
      // toolKind left UNSPECIFIED — legacy execution.
      argsPreview: '{"path":"/tmp/x"}',
    });

    const { getByText } = render(
      <ApprovalCard pendingApproval={approval} onSubmit={noop} />,
    );

    expect(getByText("Delete")).toBeTruthy();
  });
});

describe("ApprovalCard approve-all action", () => {
  it("renders the subordinate 'Approve & don't ask again' action", () => {
    const approval = create(PendingApprovalSchema, {
      toolCallId: "tc3",
      toolName: "delete_file",
      argsPreview: '{"path":"/tmp/x"}',
    });

    const { getByText, getByLabelText } = render(
      <ApprovalCard pendingApproval={approval} onSubmit={noop} />,
    );

    expect(getByText("Approve")).toBeTruthy();
    expect(getByLabelText("Approve & don't ask again")).toBeTruthy();
  });

  it("submits APPROVE_ALL when the subordinate action is clicked", () => {
    const onSubmit = vi.fn();
    const approval = create(PendingApprovalSchema, {
      toolCallId: "tc4",
      toolName: "delete_file",
      argsPreview: '{"path":"/tmp/x"}',
    });

    const { getByLabelText } = render(
      <ApprovalCard pendingApproval={approval} onSubmit={onSubmit} />,
    );

    fireEvent.click(getByLabelText("Approve & don't ask again"));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(ApprovalAction.APPROVE_ALL);
  });

  it("submits a plain APPROVE when the primary action is clicked", () => {
    const onSubmit = vi.fn();
    const approval = create(PendingApprovalSchema, {
      toolCallId: "tc5",
      toolName: "delete_file",
      argsPreview: '{"path":"/tmp/x"}',
    });

    const { getByLabelText } = render(
      <ApprovalCard pendingApproval={approval} onSubmit={onSubmit} />,
    );

    fireEvent.click(getByLabelText("Approve"));

    expect(onSubmit).toHaveBeenCalledWith(ApprovalAction.APPROVE);
  });
});
