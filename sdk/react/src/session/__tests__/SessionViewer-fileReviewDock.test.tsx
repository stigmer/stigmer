import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import {
  CapturedFileChangeSchema,
  FileChangeProgressSchema,
  FileChangeProgressEntrySchema,
  FileChangeSetSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/filereview_pb";
import { FileContentSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import {
  DiffCompleteness,
  FileChangeKind,
  FileChangeSetStatus,
  FileDecisionAction,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

// ---------------------------------------------------------------------------
// Wiring-contract tests for the file-review surfaces on SessionViewer:
// the pending decision bar renders in the composer-docked FileReviewDock
// (fed from conv's seam), and the thread is records-only
// (`showFileReviewRecords`, no decision callbacks). The dock renders REAL —
// it is the subject; the thread/composer/inspector are prop-capturing probes.
// ---------------------------------------------------------------------------

type CapturedProps = Record<string, unknown>;

const threadProps: CapturedProps[] = [];
vi.mock("../../execution/MessageThread", () => ({
  MessageThread: (props: CapturedProps) => {
    threadProps.push(props);
    return <div data-testid="thread-probe" />;
  },
}));

vi.mock("../../composer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../composer")>();
  return {
    ...actual,
    SessionComposer: () => <div data-testid="composer-probe" />,
  };
});

const stubWorkspace = {
  entries: [],
  hasEntries: false,
  toInput: vi.fn().mockReturnValue([]),
  addGitRepo: vi.fn(),
  addLocalPath: vi.fn(),
  removeEntry: vi.fn(),
  clear: vi.fn(),
};

function pendingChangeSet(id: string) {
  return create(FileChangeSetSchema, {
    id,
    status: FileChangeSetStatus.AWAITING_REVIEW,
    aggregateDigest: `agg-${id}`,
    diffCompleteness: DiffCompleteness.COMPLETE,
    changes: [
      create(CapturedFileChangeSchema, {
        id: `${id}:notes.md`,
        pathBefore: "notes.md",
        pathAfter: "notes.md",
        kind: FileChangeKind.ADD,
        before: create(FileContentSchema, { body: { case: "inline", value: "" } }),
        after: create(FileContentSchema, { body: { case: "inline", value: "# Notes\n" } }),
        fileDigest: "d-notes",
        diffComplete: true,
      }),
    ],
  });
}

function progressSnapshot() {
  return create(FileChangeProgressSchema, {
    changeSetId: "cs-1",
    filesChanged: 2,
    linesAdded: 4,
    linesRemoved: 1,
    entries: [
      create(FileChangeProgressEntrySchema, {
        pathAfter: "a.ts",
        kind: FileChangeKind.ADD,
        linesAdded: 4,
        linesRemoved: 0,
      }),
      create(FileChangeProgressEntrySchema, {
        pathBefore: "b.ts",
        pathAfter: "b.ts",
        kind: FileChangeKind.MODIFY,
        linesAdded: 0,
        linesRemoved: 1,
      }),
    ],
    capturedAt: "2026-07-05T00:00:00Z",
  });
}

const stubConv = {
  session: { spec: {} },
  isLoading: false,
  loadError: null,
  completedExecutions: [],
  activeStreamExecution: null,
  activePhase: null,
  isStreaming: false,
  isConnecting: false,
  sendFollowUp: vi.fn(),
  canSendFollowUp: true,
  isSending: false,
  sendError: null,
  clearSendError: vi.fn(),
  pendingUserMessage: null,
  workspaceEntries: [],
  mcpServerUsages: [],
  skillRefs: [],
  pendingApprovals: [],
  submitApproval: vi.fn(),
  submittingApprovalIds: new Set<string>(),
  fileChangeSets: [] as ReturnType<typeof pendingChangeSet>[],
  fileChangeProgress: undefined as ReturnType<typeof progressSnapshot> | undefined,
  submitFileDecision: vi.fn(),
  submittingFileDecisionKeys: new Set<string>(),
  fileDecisionErrors: new Map<string, Error>(),
  streamError: null,
  reconnectStream: vi.fn(),
  approvalError: null,
};

const stubSessionPageFlow = {
  conv: stubConv,
  harness: "native" as const,
  executionTarget: undefined,
  model: [undefined, vi.fn()] as const,
  interactionMode: ["agent" as const, vi.fn()] as const,
  agentRef: { org: "acme", slug: "support-bot" },
  setAgentRef: vi.fn(),
  resolution: null,
  setResolution: vi.fn(),
  isDefaultAgent: false,
  mcpServerUsages: [],
  setMcpServerUsages: vi.fn(),
  skillRefs: [],
  setSkillRefs: vi.fn(),
  workspace: stubWorkspace,
  sessionVariables: { entries: [], isEmpty: true, clear: vi.fn() },
  autoApproveAll: false,
  setAutoApproveAll: vi.fn(),
  submitApproval: vi.fn(),
  handleSubmit: vi.fn(),
  submitError: null as Error | null,
  displayExecution: null,
  allExecutions: [],
  sandboxWorkspaceRoot: undefined,
};
vi.mock("../useSessionPageFlow", () => ({
  useSessionPageFlow: () => stubSessionPageFlow,
}));

vi.mock("../../hooks", () => ({
  useStigmer: () => ({
    agentExecution: {
      uploadAttachment: vi.fn(),
      getArtifactContent: vi.fn(),
    },
  }),
}));

import { SessionViewer } from "../SessionViewer";

beforeEach(() => {
  threadProps.length = 0;
  stubConv.fileChangeSets = [];
  stubConv.fileChangeProgress = undefined;
  stubConv.submitFileDecision = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SessionViewer — file-review dock wiring", () => {
  it("renders no dock when nothing is pending", () => {
    render(<SessionViewer sessionId="ses_1" org="acme" />);
    expect(
      document.querySelector('[data-cursor-target="file-review-dock"]'),
    ).toBeNull();
  });

  it("docks a pending set above the composer, wired to conv's decision seam", () => {
    stubConv.fileChangeSets = [pendingChangeSet("cs-1")];
    render(<SessionViewer sessionId="ses_1" org="acme" />);

    const dock = document.querySelector('[data-cursor-target="file-review-dock"]');
    expect(dock).toBeTruthy();
    expect(screen.getByText("Review file changes")).toBeTruthy();

    // The dock sits in the fixed strip: a sibling of the composer probe,
    // ordered before it (pinned directly above the input).
    const composer = screen.getByTestId("composer-probe");
    expect(dock!.parentElement).toBe(composer.parentElement);
    expect(
      dock!.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // A decision routes through conv.submitFileDecision with the set's id.
    fireEvent.click(
      document.querySelector<HTMLButtonElement>(
        '[data-cursor-target="file-review-approve"]',
      )!,
    );
    expect(stubConv.submitFileDecision).toHaveBeenCalledWith(
      "cs-1",
      FileDecisionAction.APPROVE,
      expect.objectContaining({ expectedDigest: "agg-cs-1" }),
    );
  });

  it("renders no progress bar when no turn is capturing", () => {
    render(<SessionViewer sessionId="ses_1" org="acme" />);
    expect(
      document.querySelector('[data-cursor-target="file-change-progress-bar"]'),
    ).toBeNull();
  });

  it("shows the mid-run progress strip above the composer while a turn is capturing", () => {
    // Progress is present (CAPTURING) and the dock is empty — the two are
    // mutually exclusive per turn, so the strip stands in for the dock.
    stubConv.fileChangeProgress = progressSnapshot();
    render(<SessionViewer sessionId="ses_1" org="acme" />);

    const bar = document.querySelector('[data-cursor-target="file-change-progress-bar"]');
    expect(bar).toBeTruthy();
    expect(screen.getByText(/2 files changing/)).toBeTruthy();
    expect(
      document.querySelector('[data-cursor-target="file-review-dock"]'),
    ).toBeNull();

    // Pinned in the fixed strip, ordered before the composer input.
    const composer = screen.getByTestId("composer-probe");
    expect(bar!.parentElement).toBe(composer.parentElement);
    expect(
      bar!.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("gives the thread records-only file-review props (no decision callbacks)", () => {
    render(<SessionViewer sessionId="ses_1" org="acme" />);

    expect(threadProps.length).toBeGreaterThan(0);
    const props = threadProps.at(-1)!;
    expect(props.showFileReviewRecords).toBe(true);
    // The decision plumbing must not leak back into the thread.
    expect(props.onFileDecisionSubmit).toBeUndefined();
    expect(props.submittingFileDecisionKeys).toBeUndefined();
    expect(props.fileDecisionErrors).toBeUndefined();
  });
});
