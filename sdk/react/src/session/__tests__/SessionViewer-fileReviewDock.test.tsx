import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import {
  CapturedFileChangeSchema,
  FileChangeProgressSchema,
  FileChangeProgressEntrySchema,
  FileChangeSetSchema,
  type FileChangeSet,
} from "@stigmer/apis/ai/stigmer/agentic/run/v1/filereview_pb";
import {
  FileCaptureClass,
  FileChangeKind,
} from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import type { FileReviewSet } from "@stigmer/client";

// ---------------------------------------------------------------------------
// Wiring-contract tests for the file-review surfaces on SessionViewer:
// the pending decision bar renders in the composer-docked FileReviewDock
// (fed from conv's file reviews, with the runs' captures, and deciding
// through conv's reviewFileChanges), and the thread is records-only
// (`showFileReviewRecords`, no decision callbacks). The dock renders REAL —
// it is the subject; the thread/composer/inspector are prop-capturing probes.
// ---------------------------------------------------------------------------

type CapturedProps = Record<string, unknown>;

const threadProps: CapturedProps[] = [];
vi.mock("../../run/MessageThread", () => ({
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

/** A turn's undecided file review, one added file, as the session's fold holds it. */
function pendingChangeSet(id: string): FileReviewSet {
  return {
    changeSetId: id,
    runId: "run_1",
    aggregateDigest: `agg-${id}`,
    files: [
      {
        fileChangeId: `${id}:notes.md`,
        path: "notes.md",
        previousPath: "",
        change: "added",
        digest: "d-notes",
        linesAdded: 1,
        linesRemoved: 0,
        reviewable: "complete",
        state: "undecided",
        decidedBy: "",
      },
    ],
    decisions: [],
    reconciles: [],
    undecided: true,
    processedAt: "",
  };
}

/** The run's capture of that review's file: it was captured outside git tracking. */
function capturedSet(id: string): FileChangeSet {
  return create(FileChangeSetSchema, {
    id,
    changes: [
      create(CapturedFileChangeSchema, {
        id: `${id}:notes.md`,
        pathAfter: "notes.md",
        kind: FileChangeKind.ADD,
        captureClass: FileCaptureClass.GIT_IGNORED_CAPTURED,
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
  org: "acme",
  session: { spec: {} },
  isLoading: false,
  loadError: null,
  turns: [],
  runs: [],
  activeTurn: null,
  activeRun: null,
  activePhase: null,
  isStreaming: false,
  isConnecting: false,
  sendFollowUp: vi.fn(),
  canSendFollowUp: true,
  isSending: false,
  sendError: null,
  clearSendError: vi.fn(),
  pendingUserMessage: null,
  resources: [],
  plugins: [],
  skillRefs: [],
  asks: [],
  answerToolUse: vi.fn(),
  answeringToolUseIds: new Set<string>(),
  fileReviewSets: [] as FileReviewSet[],
  fileChangeCaptures: new Map<string, FileChangeSet>(),
  fileChangeProgress: undefined as ReturnType<typeof progressSnapshot> | undefined,
  reviewFileChanges: vi.fn(),
  submittingFileDecisionKeys: new Set<string>(),
  fileDecisionErrors: new Map<string, Error>(),
  streamError: null,
  reconnectStream: vi.fn(),
  answerError: null,
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
  agentVersion: {
    pinnedHash: "",
    currentHash: "",
    agentName: "",
    isOutdated: false,
    labelOf: (hash: string) => hash.slice(0, 12),
    update: vi.fn(),
    isUpdating: false,
    updateError: null,
  },
  pluginRefs: [],
  setPluginRefs: vi.fn(),
  skillRefs: [],
  setSkillRefs: vi.fn(),
  workspace: stubWorkspace,
  sessionVariables: { entries: [], isEmpty: true, clear: vi.fn(), nextPageToken: "" },
  autoApproveAll: false,
  setAutoApproveAll: vi.fn(),
  answerToolUse: vi.fn(),
  handleSubmit: vi.fn(),
  submitError: null as Error | null,
  displayRun: null,
  allRuns: [],
  sandboxWorkspaceRoot: undefined,
};
vi.mock("../useSessionPageFlow", () => ({
  useSessionPageFlow: () => stubSessionPageFlow,
}));

// The reader's own access to the conversation: an owner's, unless a case
// says otherwise.
vi.mock("../useSessionAccess", () => ({
  useSessionAccess: () => ({ canSend: true, canDecide: true }),
}));

vi.mock("../../hooks", () => ({
  useStigmer: () => ({
    run: {
      getArtifactContent: vi.fn(),
    },
  }),
}));

import { SessionViewer } from "../SessionViewer";

beforeEach(() => {
  threadProps.length = 0;
  stubConv.fileReviewSets = [];
  stubConv.fileChangeCaptures = new Map();
  stubConv.fileChangeProgress = undefined;
  stubConv.reviewFileChanges = vi.fn();
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
    stubConv.fileReviewSets = [pendingChangeSet("cs-1")];
    stubConv.fileChangeCaptures = new Map([["cs-1", capturedSet("cs-1")]]);
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

    // The run's capture reaches the dock: its file carries its provenance.
    fireEvent.click(
      document.querySelector<HTMLButtonElement>('[data-cursor-target="file-review-expander"]')!,
    );
    expect(screen.getByText("gitignored")).toBeTruthy();

    // A decision routes through conv.reviewFileChanges with the set's id.
    fireEvent.click(
      document.querySelector<HTMLButtonElement>(
        '[data-cursor-target="file-review-approve"]',
      )!,
    );
    expect(stubConv.reviewFileChanges).toHaveBeenCalledWith(
      "cs-1",
      "keep",
      expect.objectContaining({ scope: "change_set", expectedDigest: "agg-cs-1" }),
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
    // The thread renders the conversation's turns, with their runs.
    expect(props.turns).toBe(stubConv.turns);
    expect(props.runs).toBe(stubConv.runs);
    // The decision plumbing must not leak back into the thread.
    expect(props.onFileDecisionSubmit).toBeUndefined();
    expect(props.submittingFileDecisionKeys).toBeUndefined();
    expect(props.fileDecisionErrors).toBeUndefined();
  });
});
