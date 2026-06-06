import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { PendingApprovalSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/approval_pb";
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
