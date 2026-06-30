import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { FileContentSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import {
  CapturedFileChangeSchema,
  FileChangeSetSchema,
  FileDecisionSchema,
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
const { fileDecisionKey } = await import("../useFileReview");

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

function capturedChange(opts: {
  id: string;
  path: string;
  fileDigest: string;
  diffComplete?: boolean;
}) {
  return create(CapturedFileChangeSchema, {
    id: opts.id,
    pathBefore: opts.path,
    pathAfter: opts.path,
    kind: FileChangeKind.MODIFY,
    before: inline("old\n"),
    after: inline("new\n"),
    fileDigest: opts.fileDigest,
    diffComplete: opts.diffComplete ?? true,
  });
}

function fileDecision(fileChangeId: string, action: FileDecisionAction) {
  return create(FileDecisionSchema, {
    changeSetId: "aex-1:0",
    fileChangeId,
    scope: FileDecisionScope.FILE,
    action,
  });
}

/** Single-file change set (the whole set IS the file — no per-file controls). */
function changeSet(opts?: { diffCompleteness?: DiffCompleteness }) {
  return create(FileChangeSetSchema, {
    id: "aex-1:0",
    status: FileChangeSetStatus.AWAITING_REVIEW,
    aggregateDigest: "agg-1",
    diffCompleteness: opts?.diffCompleteness ?? DiffCompleteness.COMPLETE,
    changes: [
      capturedChange({ id: "aex-1:0:src/a.ts", path: "src/a.ts", fileDigest: "d-a" }),
    ],
  });
}

/** Two-file change set with per-file Keep/Discard controls. */
function multiChangeSet(opts?: {
  diffCompleteness?: DiffCompleteness;
  fc2DiffComplete?: boolean;
  decisions?: ReturnType<typeof fileDecision>[];
}) {
  return create(FileChangeSetSchema, {
    id: "aex-1:0",
    status: FileChangeSetStatus.AWAITING_REVIEW,
    aggregateDigest: "agg-1",
    diffCompleteness: opts?.diffCompleteness ?? DiffCompleteness.COMPLETE,
    changes: [
      capturedChange({ id: "fc1", path: "src/a.ts", fileDigest: "d-fc1" }),
      capturedChange({
        id: "fc2",
        path: "src/b.ts",
        fileDigest: "d-fc2",
        diffComplete: opts?.fc2DiffComplete ?? true,
      }),
    ],
    decisions: opts?.decisions ?? [],
  });
}

describe("FileReviewCard", () => {
  describe("single-file set (bulk only)", () => {
    it("renders the change set summary and file diff", () => {
      render(<FileReviewCard fileChangeSet={changeSet()} onSubmit={noop} />);
      expect(screen.getByText(/awaiting review/i)).toBeTruthy();
      expect(
        screen.getByRole("alert", { name: /review 1 file change/i }),
      ).toBeTruthy();
    });

    it("shows no per-file Keep/Discard radios for a single file", () => {
      render(<FileReviewCard fileChangeSet={changeSet()} onSubmit={noop} />);
      expect(screen.queryByRole("radio")).toBeNull();
      // The bulk label is singular (no misleading "all" for one file).
      expect(screen.getByRole("button", { name: "Approve" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Reject" })).toBeTruthy();
    });

    it("submits a CHANGE_SET APPROVE bound to the aggregate digest on Approve", () => {
      const onSubmit = vi.fn();
      render(<FileReviewCard fileChangeSet={changeSet()} onSubmit={onSubmit} />);

      fireEvent.click(screen.getByRole("button", { name: "Approve" }));

      expect(onSubmit).toHaveBeenCalledTimes(1);
      expect(onSubmit).toHaveBeenCalledWith(FileDecisionAction.APPROVE, {
        scope: FileDecisionScope.CHANGE_SET,
        expectedDigest: "agg-1",
      });
    });

    it("submits a CHANGE_SET REJECT on Reject", () => {
      const onSubmit = vi.fn();
      render(<FileReviewCard fileChangeSet={changeSet()} onSubmit={onSubmit} />);

      fireEvent.click(screen.getByRole("button", { name: "Reject" }));

      expect(onSubmit).toHaveBeenCalledWith(FileDecisionAction.REJECT, {
        scope: FileDecisionScope.CHANGE_SET,
        expectedDigest: "agg-1",
      });
    });

    it("disables Approve (but not Reject) when the diff is incomplete", () => {
      const onSubmit = vi.fn();
      render(
        <FileReviewCard
          fileChangeSet={changeSet({
            diffCompleteness: DiffCompleteness.PARTIAL_BLOCKED,
          })}
          onSubmit={onSubmit}
        />,
      );

      const approve = screen.getByRole("button", { name: "Approve" });
      expect((approve as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(approve);
      expect(onSubmit).not.toHaveBeenCalled();

      // Rejecting an unreviewable change is always allowed (the safe action).
      fireEvent.click(screen.getByRole("button", { name: "Reject" }));
      expect(onSubmit).toHaveBeenCalledWith(
        FileDecisionAction.REJECT,
        expect.anything(),
      );
    });
  });

  describe("multi-file set (per-file controls)", () => {
    it("renders a Keep/Discard radio per file plus a whole-set footer", () => {
      render(<FileReviewCard fileChangeSet={multiChangeSet()} onSubmit={noop} />);

      expect(screen.getByRole("radio", { name: "Keep src/a.ts" })).toBeTruthy();
      expect(screen.getByRole("radio", { name: "Discard src/a.ts" })).toBeTruthy();
      expect(screen.getByRole("radio", { name: "Keep src/b.ts" })).toBeTruthy();
      expect(screen.getByRole("radio", { name: "Discard src/b.ts" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Approve all" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Reject all" })).toBeTruthy();
    });

    it("submits a FILE APPROVE bound to the file digest on Keep", () => {
      const onSubmit = vi.fn();
      render(<FileReviewCard fileChangeSet={multiChangeSet()} onSubmit={onSubmit} />);

      fireEvent.click(screen.getByRole("radio", { name: "Keep src/a.ts" }));

      expect(onSubmit).toHaveBeenCalledWith(FileDecisionAction.APPROVE, {
        scope: FileDecisionScope.FILE,
        fileChangeId: "fc1",
        expectedDigest: "d-fc1",
      });
    });

    it("submits a FILE REJECT bound to the file digest on Discard", () => {
      const onSubmit = vi.fn();
      render(<FileReviewCard fileChangeSet={multiChangeSet()} onSubmit={onSubmit} />);

      fireEvent.click(screen.getByRole("radio", { name: "Discard src/b.ts" }));

      expect(onSubmit).toHaveBeenCalledWith(FileDecisionAction.REJECT, {
        scope: FileDecisionScope.FILE,
        fileChangeId: "fc2",
        expectedDigest: "d-fc2",
      });
    });

    it("disables Keep (but not Discard) for an incomplete file, leaving complete files keepable", () => {
      const onSubmit = vi.fn();
      render(
        <FileReviewCard
          fileChangeSet={multiChangeSet({
            diffCompleteness: DiffCompleteness.PARTIAL_BLOCKED,
            fc2DiffComplete: false,
          })}
          onSubmit={onSubmit}
        />,
      );

      // The binary/truncated file can only be discarded.
      expect(
        (screen.getByRole("radio", { name: "Keep src/b.ts" }) as HTMLButtonElement)
          .disabled,
      ).toBe(true);
      expect(
        (screen.getByRole("radio", { name: "Discard src/b.ts" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false);
      // The complete file is still keepable individually.
      expect(
        (screen.getByRole("radio", { name: "Keep src/a.ts" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false);
      // The whole-set Approve is blocked while the set is not COMPLETE.
      expect(
        (screen.getByRole("button", { name: "Approve all" }) as HTMLButtonElement)
          .disabled,
      ).toBe(true);
    });

    it("shows a committed verdict as checked and flips it on the other option", () => {
      const onSubmit = vi.fn();
      render(
        <FileReviewCard
          fileChangeSet={multiChangeSet({
            decisions: [fileDecision("fc1", FileDecisionAction.APPROVE)],
          })}
          onSubmit={onSubmit}
        />,
      );

      expect(
        screen.getByRole("radio", { name: "Keep src/a.ts" }).getAttribute("aria-checked"),
      ).toBe("true");

      // Flipping is allowed: clicking Discard records a new (last-wins) decision.
      fireEvent.click(screen.getByRole("radio", { name: "Discard src/a.ts" }));
      expect(onSubmit).toHaveBeenCalledWith(FileDecisionAction.REJECT, {
        scope: FileDecisionScope.FILE,
        fileChangeId: "fc1",
        expectedDigest: "d-fc1",
      });
    });

    it("reflects last-write-wins: a later REJECT supersedes an earlier APPROVE", () => {
      render(
        <FileReviewCard
          fileChangeSet={multiChangeSet({
            decisions: [
              fileDecision("fc1", FileDecisionAction.APPROVE),
              fileDecision("fc1", FileDecisionAction.REJECT),
            ],
          })}
          onSubmit={noop}
        />,
      );

      expect(
        screen.getByRole("radio", { name: "Discard src/a.ts" }).getAttribute("aria-checked"),
      ).toBe("true");
      expect(
        screen.getByRole("radio", { name: "Keep src/a.ts" }).getAttribute("aria-checked"),
      ).toBe("false");
    });

    it("shows review progress for a partially-decided set", () => {
      render(
        <FileReviewCard
          fileChangeSet={multiChangeSet({
            decisions: [fileDecision("fc1", FileDecisionAction.APPROVE)],
          })}
          onSubmit={noop}
        />,
      );
      expect(screen.getByText(/1 of 2 files reviewed/i)).toBeTruthy();
    });

    it("relabels the bulk action to 'remaining' once some files are decided", () => {
      const onSubmit = vi.fn();
      render(
        <FileReviewCard
          fileChangeSet={multiChangeSet({
            decisions: [fileDecision("fc1", FileDecisionAction.APPROVE)],
          })}
          onSubmit={onSubmit}
        />,
      );

      const approveRemaining = screen.getByRole("button", { name: "Approve remaining" });
      expect(approveRemaining).toBeTruthy();
      expect(screen.getByRole("button", { name: "Reject remaining" })).toBeTruthy();

      fireEvent.click(approveRemaining);
      expect(onSubmit).toHaveBeenCalledWith(FileDecisionAction.APPROVE, {
        scope: FileDecisionScope.CHANGE_SET,
        expectedDigest: "agg-1",
      });
    });

    it("disables a file's options while that file's decision is in flight", () => {
      const submitting = new Set([fileDecisionKey("aex-1:0", "fc1")]);
      render(
        <FileReviewCard
          fileChangeSet={multiChangeSet()}
          onSubmit={noop}
          submittingDecisionKeys={submitting}
        />,
      );

      expect(
        (screen.getByRole("radio", { name: "Keep src/a.ts" }) as HTMLButtonElement)
          .disabled,
      ).toBe(true);
      expect(
        (screen.getByRole("radio", { name: "Discard src/a.ts" }) as HTMLButtonElement)
          .disabled,
      ).toBe(true);
      // A different file is unaffected.
      expect(
        (screen.getByRole("radio", { name: "Keep src/b.ts" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false);
    });

    it("disables the bulk action while a whole-set decision is in flight", () => {
      const submitting = new Set(["aex-1:0"]);
      render(
        <FileReviewCard
          fileChangeSet={multiChangeSet()}
          onSubmit={noop}
          submittingDecisionKeys={submitting}
        />,
      );

      expect(
        (screen.getByRole("button", { name: "Approve all" }) as HTMLButtonElement)
          .disabled,
      ).toBe(true);
    });
  });
});
