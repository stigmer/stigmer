import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act, fireEvent } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Wiring-contract test for transcript click-to-open: the onFilePathClick
// SessionViewer hands to MessageThread resolves a tool-call path, writes the
// open-editor store, AND expands the session panel — so the resolved file
// surfaces in the WorkspaceSurface. MessageThread and WorkspaceSurface render
// as prop-capturing probes; the store + SessionPanelRegion wire between them
// is the subject under test.
// ---------------------------------------------------------------------------

type CapturedProps = Record<string, unknown>;

const threadProps: CapturedProps[] = [];
vi.mock("../../run/MessageThread", () => ({
  MessageThread: (props: CapturedProps) => {
    threadProps.push(props);
    return <div data-testid="thread-probe" />;
  },
}));

const surfaceProps: CapturedProps[] = [];
vi.mock("../../workspace/WorkspaceSurface", () => ({
  WorkspaceSurface: (props: CapturedProps) => {
    surfaceProps.push(props);
    return <div data-testid="surface-probe" />;
  },
}));

vi.mock("../../composer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../composer")>();
  return {
    ...actual,
    SessionComposer: () => <div data-testid="composer-probe" />,
  };
});

const gitEntry = {
  id: "e1",
  name: "acme/app",
  type: "git" as const,
  gitUrl: "https://github.com/acme/app.git",
  gitBranch: "main",
};

const stubWorkspace = {
  entries: [gitEntry],
  hasEntries: true,
  toInput: vi.fn().mockReturnValue([]),
  addGitRepo: vi.fn(),
  addLocalPath: vi.fn(),
  remove: vi.fn(),
  clear: vi.fn(),
  clearLocal: vi.fn(),
};

const stubConv = {
  org: "acme",
  session: { spec: {} },
  isLoading: false,
  loadError: null,
  turns: [],
  runs: [],
  activeTurn: null,
  activeRun: null,
  pendingUserMessage: null,
  resources: [],
  fileReviewSets: [],
  fileChangeCaptures: new Map(),
  reviewFileChanges: vi.fn(),
  submittingFileDecisionKeys: new Set<string>(),
  fileDecisionErrors: new Map<string, Error>(),
  sendError: null,
  stopError: null,
  streamError: null,
  reconnectStream: vi.fn(),
  answeringToolUseIds: new Set<string>(),
  answerErrors: new Map<string, Error>(),
  isStoppable: false,
  isStopping: false,
  isSending: false,
  canSendFollowUp: true,
  isReconnecting: false,
  connectTimedOut: false,
  isSlow: false,
  liveness: undefined,
  stop: vi.fn(),
  retryLastSend: vi.fn(),
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
  handleSubmit: vi.fn(),
  submitError: null as Error | null,
  displayRun: null,
  allRuns: [] as Run[],
  sandboxWorkspaceRoot: "/home/daytona/workspace",
};
const dialogChanges: (DisplayFileChange | null)[] = [];
vi.mock("../TurnChangeDialog", () => ({
  TurnChangeDialog: (props: { change: DisplayFileChange | null }) => {
    dialogChanges.push(props.change);
    return null;
  },
}));

vi.mock("../useSessionPageFlow", () => ({
  useSessionPageFlow: () => stubSessionPageFlow,
}));

// The reader's own access to the conversation: an owner's, unless a case
// says otherwise.
vi.mock("../useSessionAccess", () => ({
  useSessionAccess: () => ({ canSend: true, canDecide: true }),
}));

vi.mock("@stigmer/react-core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@stigmer/react-core")>()),
  useStigmer: () => ({
    // Server info answers the Environment row: a server that predates the field.
    platform: { getServerInfo: async () => ({}) },
    run: {
      getArtifactContent: vi.fn(),
    },
  }),
}));

import { SessionViewer } from "../SessionViewer";
import { SessionInspector } from "../inspector/SessionInspector";
import { create } from "@bufbuild/protobuf";
import { RunSchema, RunStatusSchema, type Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { ApiResourceMetadataSchema } from "@stigmer/apis/ai/stigmer/commons/apiresource/metadata_pb";
import { FileChangeKind } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { CapturedFileChangeSchema, FileChangeSetSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/filereview_pb";
import type { DisplayFileChange } from "@stigmer/client";

/** The onFilePathClick handler threaded down to the (mocked) MessageThread. */
function capturedOnFilePathClick(): (path: string) => boolean {
  const props = threadProps.at(-1);
  return props?.onFilePathClick as (path: string) => boolean;
}

/** The latest selectedFile the (mocked) WorkspaceSurface received, if rendered. */
function latestSurfaceSelectedFile(): unknown {
  return surfaceProps.at(-1)?.selectedFile ?? null;
}

beforeEach(() => {
  threadProps.length = 0;
  surfaceProps.length = 0;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SessionViewer — transcript click-to-open wiring", () => {
  it("threads an onFilePathClick to the message thread", () => {
    render(<SessionViewer sessionId="ses_1" org="acme" inspector={<SessionInspector />} />);
    expect(typeof capturedOnFilePathClick()).toBe("function");
  });

  it("opens a resolvable tool-call path in the session panel", () => {
    render(<SessionViewer sessionId="ses_1" org="acme" inspector={<SessionInspector />} />);
    // Before any click: panel collapsed — the surface is not rendered.
    expect(surfaceProps.length).toBe(0);

    let handled: boolean | undefined;
    act(() => {
      handled = capturedOnFilePathClick()("/home/daytona/workspace/src/main.go");
    });

    expect(handled).toBe(true);
    // Opening expands the panel and routes the resolved selection into the
    // surface — the SAME selection a tree click yields.
    expect(latestSurfaceSelectedFile()).toEqual({
      entryId: "e1",
      path: "src/main.go",
    });
  });

  it("declines a platform path (returns false) and opens nothing", () => {
    render(<SessionViewer sessionId="ses_1" org="acme" inspector={<SessionInspector />} />);

    let handled: boolean | undefined;
    act(() => {
      handled = capturedOnFilePathClick()(".stigmer/skills/x.md");
    });

    expect(handled).toBe(false);
    // The panel stays collapsed: no surface rendered.
    expect(surfaceProps.length).toBe(0);
  });

  it("collapses back to full-width chat via the chip without losing the editor group", () => {
    render(<SessionViewer sessionId="ses_1" org="acme" inspector={<SessionInspector />} />);
    act(() => {
      capturedOnFilePathClick()("/home/daytona/workspace/src/main.go");
    });
    expect(latestSurfaceSelectedFile()).toEqual({ entryId: "e1", path: "src/main.go" });

    // Chip is the hide affordance while open …
    fireEvent.click(screen.getByRole("button", { name: "Hide panel" }));
    const countBefore = surfaceProps.length;

    // … and the show affordance while collapsed; the editor group survives.
    fireEvent.click(screen.getByRole("button", { name: "Show panel" }));
    expect(surfaceProps.length).toBeGreaterThan(countBefore);
    expect(latestSurfaceSelectedFile()).toEqual({
      entryId: "e1",
      path: "src/main.go",
    });
  });
});

describe("SessionViewer — a transcript path with no inspector", () => {
  /** A run that captured one change, to src/main.go unless named. */
  function runWithCapture(path = "src/main.go"): Run {
    const run = create(RunSchema);
    run.metadata = create(ApiResourceMetadataSchema, { id: "run_1" });
    run.status = create(RunStatusSchema, {
      fileChanges: [
        create(FileChangeSetSchema, {
          id: "cs-1",
          changes: [
            create(CapturedFileChangeSchema, {
              id: "c1",
              pathBefore: path,
              pathAfter: path,
              kind: FileChangeKind.MODIFY,
              diffComplete: true,
            }),
          ],
        }),
      ],
    });
    return run;
  }

  it("KIT-06 opens a path a turn changed as that change's diff, and declines any other", () => {
    stubSessionPageFlow.allRuns = [runWithCapture()];
    dialogChanges.length = 0;
    try {
      render(<SessionViewer sessionId="ses_1" org="acme" />);

      let handled: boolean | undefined;
      act(() => {
        handled = capturedOnFilePathClick()("/home/daytona/workspace/src/main.go");
      });
      expect(handled).toBe(true);
      expect(dialogChanges.at(-1)?.path).toBe("src/main.go");

      act(() => {
        handled = capturedOnFilePathClick()("/home/daytona/workspace/README.md");
      });
      expect(handled).toBe(false);
    } finally {
      stubSessionPageFlow.allRuns = [];
    }
  });

  it("matches a path to a change by its place in the workspace, never by its name alone", () => {
    stubSessionPageFlow.allRuns = [runWithCapture("README.md")];
    dialogChanges.length = 0;
    try {
      render(<SessionViewer sessionId="ses_1" org="acme" />);

      let handled: boolean | undefined;
      act(() => {
        handled = capturedOnFilePathClick()("/home/daytona/workspace/docs/README.md");
      });
      expect(handled).toBe(false);
      act(() => {
        handled = capturedOnFilePathClick()("docs/README.md");
      });
      expect(handled).toBe(false);
      expect(dialogChanges.filter((change) => change !== null)).toHaveLength(0);

      act(() => {
        handled = capturedOnFilePathClick()("./README.md");
      });
      expect(handled).toBe(true);
      expect(dialogChanges.at(-1)?.path).toBe("README.md");
    } finally {
      stubSessionPageFlow.allRuns = [];
    }
  });
});
