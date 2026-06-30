import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { FileContentSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import {
  CapturedFileChangeSchema,
  FileChangeSetSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/filereview_pb";
import {
  DiffCompleteness,
  FileChangeKind,
  FileChangeSetStatus,
  FileDecisionAction,
  FileDecisionScope,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { UseFileChangeContentReturn } from "../useFileChangeContent";

// FileReviewCard renders FileChangeDiff (per file), which pulls in the
// offload-resolving content hook transitively. Mock it so the diff path renders
// without artifact-fetch context, then import the component after the mock.
let mockReturn: UseFileChangeContentReturn;
vi.mock("../useFileChangeContent", () => ({
  useFileChangeContent: () => mockReturn,
}));

const { FileReviewCard } = await import("../FileReviewCard");

function setContent(overrides?: Partial<UseFileChangeContentReturn>) {
  mockReturn = {
    beforeText: "old\n",
    afterText: "new\n",
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

function inline(value: string) {
  return create(FileContentSchema, { body: { case: "inline", value } });
}

function changeSet(opts?: { diffCompleteness?: DiffCompleteness }) {
  return create(FileChangeSetSchema, {
    id: "aex-1:0",
    status: FileChangeSetStatus.AWAITING_REVIEW,
    aggregateDigest: "agg-1",
    diffCompleteness: opts?.diffCompleteness ?? DiffCompleteness.COMPLETE,
    changes: [
      create(CapturedFileChangeSchema, {
        id: "aex-1:0:src/a.ts",
        pathBefore: "src/a.ts",
        pathAfter: "src/a.ts",
        kind: FileChangeKind.MODIFY,
        before: inline("old\n"),
        after: inline("new\n"),
        diffComplete: true,
      }),
    ],
  });
}

describe("FileReviewCard", () => {
  it("renders the change set summary and file diff", () => {
    render(<FileReviewCard fileChangeSet={changeSet()} onSubmit={noop} />);
    expect(screen.getByText(/awaiting review/i)).toBeTruthy();
    expect(
      screen.getByRole("alert", { name: /review 1 file change/i }),
    ).toBeTruthy();
  });

  it("submits a CHANGE_SET APPROVE bound to the aggregate digest on Approve all", () => {
    const onSubmit = vi.fn();
    render(<FileReviewCard fileChangeSet={changeSet()} onSubmit={onSubmit} />);

    fireEvent.click(screen.getByRole("button", { name: "Approve all" }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(FileDecisionAction.APPROVE, {
      scope: FileDecisionScope.CHANGE_SET,
      expectedDigest: "agg-1",
    });
  });

  it("submits a CHANGE_SET REJECT on Reject all", () => {
    const onSubmit = vi.fn();
    render(<FileReviewCard fileChangeSet={changeSet()} onSubmit={onSubmit} />);

    fireEvent.click(screen.getByRole("button", { name: "Reject all" }));

    expect(onSubmit).toHaveBeenCalledWith(FileDecisionAction.REJECT, {
      scope: FileDecisionScope.CHANGE_SET,
      expectedDigest: "agg-1",
    });
  });

  it("disables Approve all (but not Reject all) when the diff is incomplete", () => {
    const onSubmit = vi.fn();
    render(
      <FileReviewCard
        fileChangeSet={changeSet({
          diffCompleteness: DiffCompleteness.PARTIAL_BLOCKED,
        })}
        onSubmit={onSubmit}
      />,
    );

    const approve = screen.getByRole("button", { name: "Approve all" });
    expect((approve as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(approve);
    expect(onSubmit).not.toHaveBeenCalled();

    // Rejecting an unreviewable change is always allowed (the safe action).
    fireEvent.click(screen.getByRole("button", { name: "Reject all" }));
    expect(onSubmit).toHaveBeenCalledWith(FileDecisionAction.REJECT, expect.anything());
  });
});
