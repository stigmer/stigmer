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
  FileCaptureClass,
  FileChangeKind,
  FileChangeSetStatus,
  FileDecisionAction,
  FileDecisionScope,
  FileReviewBlockReason,
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

function inline(value: string, isBinary = false) {
  return create(FileContentSchema, { body: { case: "inline", value }, isBinary });
}

function capturedChange(opts: {
  id: string;
  path: string;
  fileDigest: string;
  diffComplete?: boolean;
  captureClass?: FileCaptureClass;
}) {
  return create(CapturedFileChangeSchema, {
    id: opts.id,
    pathBefore: opts.path,
    pathAfter: opts.path,
    kind: FileChangeKind.MODIFY,
    captureClass: opts.captureClass ?? FileCaptureClass.GIT_TRACKED,
    before: inline("old\n"),
    after: inline("new\n"),
    fileDigest: opts.fileDigest,
    diffComplete: opts.diffComplete ?? true,
  });
}

/** A binary change (real wire shape): both sides present + flagged, incomplete. */
function capturedBinaryChange(opts: {
  id: string;
  path: string;
  fileDigest: string;
  captureClass?: FileCaptureClass;
}) {
  return create(CapturedFileChangeSchema, {
    id: opts.id,
    pathBefore: opts.path,
    pathAfter: opts.path,
    kind: FileChangeKind.MODIFY,
    captureClass: opts.captureClass ?? FileCaptureClass.GIT_TRACKED,
    before: inline("\u0000old", true),
    after: inline("\u0000new", true),
    fileDigest: opts.fileDigest,
    diffComplete: false,
  });
}

/**
 * A diff-unavailable change (real wire shape): content-less + incomplete — the
 * shape both the secret gate and the size backstop produce. `blockedReason`
 * carries the honest cause (doc 15); omit it to model a pre-doc-15/unknown row.
 */
function capturedUnavailableChange(opts: {
  id: string;
  path: string;
  fileDigest: string;
  captureClass?: FileCaptureClass;
  blockedReason?: FileReviewBlockReason;
}) {
  return create(CapturedFileChangeSchema, {
    id: opts.id,
    pathBefore: opts.path,
    pathAfter: opts.path,
    kind: FileChangeKind.MODIFY,
    captureClass: opts.captureClass ?? FileCaptureClass.GIT_IGNORED_CAPTURED,
    fileDigest: opts.fileDigest,
    diffComplete: false,
    blockedReason: opts.blockedReason ?? FileReviewBlockReason.UNSPECIFIED,
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
function changeSet(opts?: {
  diffCompleteness?: DiffCompleteness;
  change?: ReturnType<typeof capturedChange>;
}) {
  return create(FileChangeSetSchema, {
    id: "aex-1:0",
    status: FileChangeSetStatus.AWAITING_REVIEW,
    aggregateDigest: "agg-1",
    diffCompleteness: opts?.diffCompleteness ?? DiffCompleteness.COMPLETE,
    changes: [
      opts?.change ??
        capturedChange({ id: "aex-1:0:src/a.ts", path: "src/a.ts", fileDigest: "d-a" }),
    ],
  });
}

/** Two-file change set with per-file Keep/Discard controls. */
function multiChangeSet(opts?: {
  diffCompleteness?: DiffCompleteness;
  fc1?: ReturnType<typeof capturedChange>;
  fc2?: ReturnType<typeof capturedChange>;
  decisions?: ReturnType<typeof fileDecision>[];
}) {
  return create(FileChangeSetSchema, {
    id: "aex-1:0",
    status: FileChangeSetStatus.AWAITING_REVIEW,
    aggregateDigest: "agg-1",
    diffCompleteness: opts?.diffCompleteness ?? DiffCompleteness.COMPLETE,
    changes: [
      opts?.fc1 ?? capturedChange({ id: "fc1", path: "src/a.ts", fileDigest: "d-fc1" }),
      opts?.fc2 ?? capturedChange({ id: "fc2", path: "src/b.ts", fileDigest: "d-fc2" }),
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
            fc2: capturedUnavailableChange({ id: "fc2", path: "src/b.ts", fileDigest: "d-fc2" }),
          })}
          onSubmit={onSubmit}
        />,
      );

      // The unavailable file can only be discarded.
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

  describe("decision errors (in-card surfacing)", () => {
    it("renders no error element when the map is empty (default path)", () => {
      const { container } = render(
        <FileReviewCard fileChangeSet={changeSet()} onSubmit={noop} />,
      );
      expect(container.querySelector('[data-cursor-target="file-review-error"]')).toBeNull();
      expect(
        container.querySelector('[data-cursor-target="file-review-file-error"]'),
      ).toBeNull();
    });

    it("surfaces a whole-set failure beside the bulk buttons", () => {
      const decisionErrors = new Map([["aex-1:0", new Error("digest mismatch")]]);
      render(
        <FileReviewCard
          fileChangeSet={changeSet()}
          onSubmit={noop}
          decisionErrors={decisionErrors}
        />,
      );
      const err = screen.getByText(/Couldn.t submit decision — digest mismatch/);
      expect(err.getAttribute("data-cursor-target")).toBe("file-review-error");
    });

    it("surfaces a per-file failure under the right file row only", () => {
      const decisionErrors = new Map([
        [fileDecisionKey("aex-1:0", "fc1"), new Error("network down")],
      ]);
      render(
        <FileReviewCard
          fileChangeSet={multiChangeSet()}
          onSubmit={noop}
          decisionErrors={decisionErrors}
        />,
      );
      // Exactly one per-file error, and it carries fc1's message.
      const fileErrors = screen.getAllByText(/Couldn.t save/);
      expect(fileErrors).toHaveLength(1);
      expect(fileErrors[0].textContent).toMatch(/network down/);
      // The whole-set error is NOT shown (the failure was per-file).
      expect(screen.queryByText(/Couldn.t submit decision/)).toBeNull();
    });
  });

  describe("blocked / partial states (Slice 6)", () => {
    it("labels a binary file's reason and disables only its Keep", () => {
      render(
        <FileReviewCard
          fileChangeSet={multiChangeSet({
            diffCompleteness: DiffCompleteness.PARTIAL_BLOCKED,
            fc2: capturedBinaryChange({ id: "fc2", path: "img.png", fileDigest: "d-fc2" }),
          })}
          onSubmit={noop}
        />,
      );

      expect(screen.getByText(/Binary file.*no text diff/i)).toBeTruthy();
      expect(
        (screen.getByRole("radio", { name: "Keep img.png" }) as HTMLButtonElement).disabled,
      ).toBe(true);
      expect(
        (screen.getByRole("radio", { name: "Discard img.png" }) as HTMLButtonElement).disabled,
      ).toBe(false);
      // The reviewable sibling stays keepable.
      expect(
        (screen.getByRole("radio", { name: "Keep src/a.ts" }) as HTMLButtonElement).disabled,
      ).toBe(false);
    });

    it("labels a diff-unavailable file and associates the reason via aria-describedby", () => {
      render(
        <FileReviewCard
          fileChangeSet={multiChangeSet({
            diffCompleteness: DiffCompleteness.PARTIAL_BLOCKED,
            fc2: capturedUnavailableChange({ id: "fc2", path: "src/b.ts", fileDigest: "d-fc2" }),
          })}
          onSubmit={noop}
        />,
      );

      const note = screen.getByText(/full diff isn.t available to review/i);
      expect(note).toBeTruthy();
      // The blocked file's radiogroup points at exactly that note (a11y).
      const group = screen.getByRole("radiogroup", { name: "Decision for src/b.ts" });
      const describedBy = group.getAttribute("aria-describedby");
      expect(describedBy).toBeTruthy();
      expect(note.getAttribute("id")).toBe(describedBy);
      // The reviewable sibling's group carries no such description.
      const okGroup = screen.getByRole("radiogroup", { name: "Decision for src/a.ts" });
      expect(okGroup.getAttribute("aria-describedby")).toBeFalsy();
    });

    it("gives a secret-withheld file its own honest copy (doc 15)", () => {
      render(
        <FileReviewCard
          fileChangeSet={multiChangeSet({
            diffCompleteness: DiffCompleteness.PARTIAL_BLOCKED,
            fc2: capturedUnavailableChange({
              id: "fc2",
              path: ".env",
              fileDigest: "d-fc2",
              blockedReason: FileReviewBlockReason.SECRET_WITHHELD,
            }),
          })}
          onSubmit={noop}
        />,
      );
      expect(screen.getByText(/looks like a secret/i)).toBeTruthy();
      // It is NOT the generic copy — the cause is now honest, not agnostic.
      expect(screen.queryByText(/full diff isn.t available to review/i)).toBeNull();
    });

    it("gives a size-elided file its own honest copy, distinct from secret (doc 15)", () => {
      render(
        <FileReviewCard
          fileChangeSet={multiChangeSet({
            diffCompleteness: DiffCompleteness.PARTIAL_BLOCKED,
            fc2: capturedUnavailableChange({
              id: "fc2",
              path: "src/huge.ts",
              fileDigest: "d-fc2",
              blockedReason: FileReviewBlockReason.SIZE_ELIDED,
            }),
          })}
          onSubmit={noop}
        />,
      );
      expect(screen.getByText(/too large to display/i)).toBeTruthy();
      expect(screen.queryByText(/looks like a secret/i)).toBeNull();
    });

    it("shows a provenance badge for a gitignored capture", () => {
      render(
        <FileReviewCard
          fileChangeSet={changeSet({
            change: capturedChange({
              id: "x",
              path: ".env.local",
              fileDigest: "d",
              captureClass: FileCaptureClass.GIT_IGNORED_CAPTURED,
            }),
          })}
          onSubmit={noop}
        />,
      );
      const badge = screen.getByText("gitignored");
      expect(badge).toBeTruthy();
      expect(badge.getAttribute("aria-label")).toMatch(/ignored by git/i);
    });

    it("shows no provenance badge for an ordinary git-tracked change", () => {
      render(<FileReviewCard fileChangeSet={changeSet()} onSubmit={noop} />);
      expect(screen.queryByText("gitignored")).toBeNull();
      expect(screen.queryByText("outside git")).toBeNull();
    });

    it("uses unavailable-specific set copy when a diff-unavailable file is present", () => {
      render(
        <FileReviewCard
          fileChangeSet={multiChangeSet({
            diffCompleteness: DiffCompleteness.PARTIAL_BLOCKED,
            fc2: capturedUnavailableChange({ id: "fc2", path: "src/b.ts", fileDigest: "d-fc2" }),
          })}
          onSubmit={noop}
        />,
      );
      expect(screen.getByText(/isn.t available to review, so the whole set/i)).toBeTruthy();
    });

    it("uses binary-specific set copy when the only blocker is a binary file", () => {
      render(
        <FileReviewCard
          fileChangeSet={multiChangeSet({
            diffCompleteness: DiffCompleteness.PARTIAL_BLOCKED,
            fc2: capturedBinaryChange({ id: "fc2", path: "img.png", fileDigest: "d-fc2" }),
          })}
          onSubmit={noop}
        />,
      );
      expect(screen.getByText(/includes a binary change with no text diff/i)).toBeTruthy();
    });

    it("blocks Approve on a single-file binary set, allows Reject, and describes the disabled Approve", () => {
      const onSubmit = vi.fn();
      render(
        <FileReviewCard
          fileChangeSet={changeSet({
            diffCompleteness: DiffCompleteness.PARTIAL_BLOCKED,
            change: capturedBinaryChange({ id: "aex-1:0:img.png", path: "img.png", fileDigest: "d" }),
          })}
          onSubmit={onSubmit}
        />,
      );

      const approve = screen.getByRole("button", { name: "Approve" });
      expect((approve as HTMLButtonElement).disabled).toBe(true);
      // The disabled Approve is associated with the notice explaining why.
      const noticeId = approve.getAttribute("aria-describedby");
      expect(noticeId).toBeTruthy();
      expect(document.getElementById(noticeId as string)?.textContent).toMatch(/binary change/i);

      fireEvent.click(screen.getByRole("button", { name: "Reject" }));
      expect(onSubmit).toHaveBeenCalledWith(FileDecisionAction.REJECT, expect.anything());
    });

    it("defensively disables Approve for any non-COMPLETE completeness (catch-all)", () => {
      // BINARY_SUMMARY_ONLY is not produced today, but the guard must still block.
      render(
        <FileReviewCard
          fileChangeSet={changeSet({
            diffCompleteness: DiffCompleteness.BINARY_SUMMARY_ONLY,
          })}
          onSubmit={noop}
        />,
      );
      expect(
        (screen.getByRole("button", { name: "Approve" }) as HTMLButtonElement).disabled,
      ).toBe(true);
    });
  });
});
