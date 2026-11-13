/**
 * Wiring-contract tests for where SessionViewer lets a turn's edits be seen
 * and undone. A finished turn's changed files show once, in its outcome's
 * "Changed" group: the owner gets Undo there on the newest turn only, routed
 * through conv's `reviewFileChanges` as an undo; an older turn, a
 * participant, an observer and a guest (whose credential is refused file
 * decisions, stigmer#1481) get none. While a turn works, the files-changing
 * strip sits above the composer, and the thread carries no file-review
 * records or decision props. The thread and composer are prop-capturing
 * probes; the outcome is drawn from the render prop the thread receives.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import {
  FileChangeProgressSchema,
  FileChangeProgressEntrySchema,
} from "@stigmer/apis/ai/stigmer/agentic/run/v1/filereview_pb";
import { FileChangeKind } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import type { Turn } from "@stigmer/client";
import { renderOutcomeOf, undecidedTurn } from "./__fixtures__/undecided-turn";

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
  turns: [] as Turn[],
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
  fileReviewSets: [],
  fileChangeCaptures: new Map(),
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
  harness: "stigmer" as const,
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
// The ending notice's wiring asks the server (permissions, recover): its own tests prove it.
vi.mock("../useTurnEndingWiring", () => ({
  useTurnEndingWiring: () => ({
    wiring: { viewer: { canManageProviders: false, canOpenAgent: false, canAct: true, stoppedIt: false } },
    error: null,
    clearError: () => {},
  }),
}));

const access = { canSend: true, canDecide: true };
vi.mock("../useSessionAccess", () => ({
  useSessionAccess: () => access,
}));

vi.mock("@stigmer/react-core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@stigmer/react-core")>()),
  useStigmer: () => ({
    run: {
      getArtifactContent: vi.fn(),
    },
  }),
}));

import { SessionViewer } from "../SessionViewer";

beforeEach(() => {
  threadProps.length = 0;
  access.canSend = true;
  access.canDecide = true;
  stubConv.turns = [];
  stubConv.fileChangeProgress = undefined;
  stubConv.reviewFileChanges = vi.fn().mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function lastThreadProps(): Record<string, unknown> {
  expect(threadProps.length).toBeGreaterThan(0);
  return threadProps.at(-1)!;
}

describe("SessionViewer — Undo on a turn's changed files", () => {
  const older = undecidedTurn("run_1");
  const newest = undecidedTurn("run_2");

  it("offers the owner Undo on the newest turn, routed to conv's reviewFileChanges as an undo", () => {
    stubConv.turns = [older, newest];
    render(<SessionViewer sessionId="ses_1" org="acme" />);
    renderOutcomeOf(lastThreadProps(), newest);

    fireEvent.click(screen.getByRole("button", { name: "Undo a.ts" }));
    expect(stubConv.reviewFileChanges).toHaveBeenCalledWith("cs-run_2", "undo", {
      scope: "file",
      fileChangeId: "run_2:a.ts",
      expectedDigest: "d-run_2",
    });
  });

  it("offers no Undo on an older turn", () => {
    stubConv.turns = [older, newest];
    render(<SessionViewer sessionId="ses_1" org="acme" />);
    renderOutcomeOf(lastThreadProps(), older);

    expect(screen.getAllByText("a.ts").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /^Undo/ })).toBeNull();
  });

  it("offers no Undo to a participant, an observer or a guest", () => {
    stubConv.turns = [newest];
    access.canDecide = false;
    render(<SessionViewer sessionId="ses_1" org="acme" />);
    renderOutcomeOf(lastThreadProps(), newest);
    expect(screen.getAllByText("a.ts").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /^Undo/ })).toBeNull();
    cleanup();

    access.canDecide = true;
    for (const audience of ["observer", "guest"] as const) {
      render(<SessionViewer sessionId="ses_1" org="acme" audience={audience} />);
      renderOutcomeOf(lastThreadProps(), newest);
      expect(screen.getAllByText("a.ts").length, audience).toBeGreaterThan(0);
      expect(screen.queryByRole("button", { name: /^Undo/ }), audience).toBeNull();
      cleanup();
    }
  });
});

describe("SessionViewer — the files-changing strip and the thread", () => {
  it("renders no progress bar when no turn is capturing", () => {
    render(<SessionViewer sessionId="ses_1" org="acme" />);
    expect(
      document.querySelector('[data-cursor-target="file-change-progress-bar"]'),
    ).toBeNull();
  });

  it("shows the mid-run progress strip above the composer while a turn is capturing", () => {
    stubConv.fileChangeProgress = progressSnapshot();
    render(<SessionViewer sessionId="ses_1" org="acme" />);

    const bar = document.querySelector('[data-cursor-target="file-change-progress-bar"]');
    expect(bar).toBeTruthy();
    expect(screen.getByText("Changing 2 files")).toBeTruthy();

    // Pinned in the fixed strip, ordered before the composer input.
    const composer = screen.getByTestId("composer-probe");
    expect(bar!.parentElement).toBe(composer.parentElement);
    expect(
      bar!.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("gives the thread no file-review records or decision props", () => {
    render(<SessionViewer sessionId="ses_1" org="acme" />);

    const props = lastThreadProps();
    expect(props.showFileReviewRecords).toBeUndefined();
    // The thread renders the conversation's turns, with their runs.
    expect(props.turns).toBe(stubConv.turns);
    expect(props.runs).toBe(stubConv.runs);
    expect(props.onFileDecisionSubmit).toBeUndefined();
    expect(props.submittingFileDecisionKeys).toBeUndefined();
    expect(props.fileDecisionErrors).toBeUndefined();
  });
});
