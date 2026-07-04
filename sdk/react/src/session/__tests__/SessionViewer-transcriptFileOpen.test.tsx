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
vi.mock("../../execution/MessageThread", () => ({
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
  session: { spec: {} },
  isLoading: false,
  loadError: null,
  completedExecutions: [],
  activeStreamExecution: null,
  pendingUserMessage: null,
  workspaceEntries: [],
  fileChangeSets: [],
  submitFileDecision: vi.fn(),
  submittingFileDecisionKeys: new Set<string>(),
  fileDecisionErrors: new Map<string, Error>(),
  sendError: null,
  stopError: null,
  streamError: null,
  reconnectStream: vi.fn(),
  submittingApprovalIds: new Set<string>(),
  approvalErrors: new Map<string, Error>(),
  isStoppable: false,
  isStopping: false,
  isSending: false,
  canSendFollowUp: true,
  isReconnecting: false,
  connectTimedOut: false,
  isSlow: false,
  stop: vi.fn(),
  retryLastSend: vi.fn(),
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
  handleSubmit: vi.fn(),
  submitError: null as Error | null,
  displayExecution: null,
  allExecutions: [],
  sandboxWorkspaceRoot: "/home/daytona/workspace",
};
vi.mock("../useSessionPageFlow", () => ({
  useSessionPageFlow: () => stubSessionPageFlow,
}));

import { SessionViewer } from "../SessionViewer";

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
    render(<SessionViewer sessionId="ses_1" org="acme" />);
    expect(typeof capturedOnFilePathClick()).toBe("function");
  });

  it("opens a resolvable tool-call path in the session panel", () => {
    render(<SessionViewer sessionId="ses_1" org="acme" />);
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
    render(<SessionViewer sessionId="ses_1" org="acme" />);

    let handled: boolean | undefined;
    act(() => {
      handled = capturedOnFilePathClick()(".stigmer/skills/x.md");
    });

    expect(handled).toBe(false);
    // The panel stays collapsed: no surface rendered.
    expect(surfaceProps.length).toBe(0);
  });

  it("collapses back to full-width chat via the chip without losing the editor group", () => {
    render(<SessionViewer sessionId="ses_1" org="acme" />);
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
