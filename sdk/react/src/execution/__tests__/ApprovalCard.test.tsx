import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { PendingApprovalSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/approval_pb";
import {
  FileChangeSchema,
  FileContentSchema,
  type FileChange,
  type FileContent,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import {
  ApprovalAction,
  FileChangeCaptureLevel,
  FileChangeType,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { ToolKind } from "@stigmer/sdk";
import type { UseFileChangeContentReturn } from "../useFileChangeContent";

// ---------------------------------------------------------------------------
// ApprovalCard renders FileChangeDiff for file-modifying approvals, which pulls
// in the offload-resolving content hook transitively. Mock that hook so the
// diff path renders without artifact-fetch context, exactly as FileChangesView's
// tests do, and dynamically import the component after the mock is registered.
// ---------------------------------------------------------------------------

let mockReturn: UseFileChangeContentReturn;

vi.mock("../useFileChangeContent", () => ({
  useFileChangeContent: () => mockReturn,
}));

const { ApprovalCard } = await import("../ApprovalCard");

function setContent(overrides?: Partial<UseFileChangeContentReturn>) {
  mockReturn = {
    beforeText: "",
    afterText: "",
    isBinary: false,
    isLoading: false,
    error: null,
    isTruncated: false,
    downloadUrl: null,
    ...overrides,
  };
}

beforeEach(() => setContent());
afterEach(cleanup);

const noop = () => {};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function inlineSide(value: string): FileContent {
  return create(FileContentSchema, { body: { case: "inline", value } });
}

function wholeFileChange(
  path: string,
  before: string,
  after: string,
  changeType: FileChangeType = FileChangeType.MODIFY,
): FileChange {
  return create(FileChangeSchema, {
    path,
    changeType,
    captureLevel: FileChangeCaptureLevel.WHOLE_FILE,
    before: before ? inlineSide(before) : undefined,
    after: after ? inlineSide(after) : undefined,
  });
}

function hunkOnlyChange(path: string): FileChange {
  return create(FileChangeSchema, {
    path,
    changeType: FileChangeType.MODIFY,
    captureLevel: FileChangeCaptureLevel.HUNK_ONLY,
    unifiedDiff: "@@ -1 +1 @@\n-alpha\n+beta",
    linesAdded: 1,
    linesRemoved: 1,
  });
}

// ---------------------------------------------------------------------------
// Tool classification (ToolArgsView fallback path — no file_changes)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// File-change diff rendering (the Phase E surface)
// ---------------------------------------------------------------------------

describe("ApprovalCard file-change diff", () => {
  it("renders a hunk-only unified diff when the approval carries a hunk capture", () => {
    const approval = create(PendingApprovalSchema, {
      toolCallId: "tc-hunk",
      toolName: "str_replace",
      toolKind: ToolKind.FILE_EDIT,
      argsPreview: '{"path":"src/h.ts"}',
      fileChanges: [hunkOnlyChange("src/h.ts")],
    });

    render(<ApprovalCard pendingApproval={approval} onSubmit={noop} />);

    expect(screen.getByText("src/h.ts")).toBeTruthy();
    expect(screen.getByText("+beta")).toBeTruthy();
    expect(screen.getByText("-alpha")).toBeTruthy();
  });

  it("renders a whole-file before/after diff with +/- stats", () => {
    setContent({ beforeText: "alpha\n", afterText: "beta\n" });
    const approval = create(PendingApprovalSchema, {
      toolCallId: "tc-whole",
      toolName: "write_file",
      toolKind: ToolKind.FILE_EDIT,
      argsPreview: '{"path":"src/a.ts"}',
      fileChanges: [wholeFileChange("src/a.ts", "alpha\n", "beta\n")],
    });

    render(<ApprovalCard pendingApproval={approval} onSubmit={noop} />);

    // The path renders in both the header subtitle and the diff header.
    expect(screen.getAllByText("src/a.ts").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("+1")).toBeTruthy();
    expect(screen.getByText("-1")).toBeTruthy();
  });

  it("renders an all-additions diff for a CREATE (no before side)", () => {
    setContent({ beforeText: "", afterText: "hello\nworld\n" });
    const approval = create(PendingApprovalSchema, {
      toolCallId: "tc-create",
      toolName: "write_file",
      toolKind: ToolKind.FILE_EDIT,
      argsPreview: '{"path":"src/new.ts"}',
      fileChanges: [
        wholeFileChange("src/new.ts", "", "hello\nworld\n", FileChangeType.CREATE),
      ],
    });

    render(<ApprovalCard pendingApproval={approval} onSubmit={noop} />);

    expect(screen.getAllByText("src/new.ts").length).toBeGreaterThanOrEqual(1);
    // Two added lines, none removed.
    expect(screen.getByText("+2")).toBeTruthy();
    expect(screen.getByText("-0")).toBeTruthy();
  });

  it("shows a binary notice instead of a diff when a side is binary", () => {
    setContent({ isBinary: true });
    const approval = create(PendingApprovalSchema, {
      toolCallId: "tc-bin",
      toolName: "write_file",
      toolKind: ToolKind.FILE_EDIT,
      argsPreview: '{"path":"src/logo.png"}',
      fileChanges: [wholeFileChange("src/logo.png", "", "")],
    });

    render(<ApprovalCard pendingApproval={approval} onSubmit={noop} />);

    expect(screen.getByText(/binary file changed/i)).toBeTruthy();
  });

  it("shows a loading state while an offloaded side is fetched", () => {
    setContent({ beforeText: null, afterText: null, isLoading: true });
    const approval = create(PendingApprovalSchema, {
      toolCallId: "tc-loading",
      toolName: "write_file",
      toolKind: ToolKind.FILE_EDIT,
      argsPreview: '{"path":"src/big.ts"}',
      fileChanges: [wholeFileChange("src/big.ts", "", "")],
    });

    render(<ApprovalCard pendingApproval={approval} onSubmit={noop} />);

    expect(screen.getByText(/loading diff/i)).toBeTruthy();
  });

  it("renders one diff per file when an approval carries multiple changes", () => {
    setContent({ beforeText: "a\n", afterText: "b\n" });
    const approval = create(PendingApprovalSchema, {
      toolCallId: "tc-multi",
      toolName: "apply_patch",
      toolKind: ToolKind.FILE_EDIT,
      argsPreview: "{}",
      fileChanges: [
        wholeFileChange("src/one.ts", "a\n", "b\n"),
        wholeFileChange("src/two.ts", "a\n", "b\n"),
      ],
    });

    render(<ApprovalCard pendingApproval={approval} onSubmit={noop} />);

    expect(screen.getByText("src/one.ts")).toBeTruthy();
    expect(screen.getByText("src/two.ts")).toBeTruthy();
  });

  it("falls back to the args preview when there are no file changes", () => {
    const approval = create(PendingApprovalSchema, {
      toolCallId: "tc-fallback",
      toolName: "write_file",
      toolKind: ToolKind.FILE_EDIT,
      argsPreview: '{"path":"src/fallback.ts","contents":"x"}',
      // fileChanges intentionally empty.
    });

    render(<ApprovalCard pendingApproval={approval} onSubmit={noop} />);

    // ToolArgsView's FileArgsView renders the path link plus a "Content"
    // collapsible (its write/edit content). No diff body renders.
    expect(screen.getAllByText("src/fallback.ts").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Content")).toBeTruthy();
    expect(screen.queryByText(/binary file changed/i)).toBeNull();
  });
});
