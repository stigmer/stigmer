import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Wiring-contract test for Slice 3 (transcript click-to-open): the
// onFilePathClick SessionViewer hands to MessageThread resolves a tool-call
// path and writes the shared file-selection store, which the inspector reads.
// MessageThread + SessionInspector render as prop-capturing probes; the store
// and InspectorPanel are real (the subject under test is the wire between them).
// ---------------------------------------------------------------------------

type CapturedProps = Record<string, unknown>;

const threadProps: CapturedProps[] = [];
vi.mock("../../execution/MessageThread", () => ({
  MessageThread: (props: CapturedProps) => {
    threadProps.push(props);
    return <div data-testid="thread-probe" />;
  },
}));

const inspectorProps: CapturedProps[] = [];
vi.mock("../inspector/SessionInspector", () => ({
  SessionInspector: (props: CapturedProps) => {
    inspectorProps.push(props);
    return <div data-testid="inspector-probe" />;
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

/** The latest selectedFile the (mocked) SessionInspector received. */
function latestSelectedFile(): unknown {
  return inspectorProps.at(-1)?.selectedFile ?? null;
}

beforeEach(() => {
  threadProps.length = 0;
  inspectorProps.length = 0;
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

  it("opens a resolvable tool-call path in the inspector's Viewer selection", () => {
    render(<SessionViewer sessionId="ses_1" org="acme" />);
    expect(latestSelectedFile()).toBeNull();

    let handled: boolean | undefined;
    act(() => {
      handled = capturedOnFilePathClick()("/home/daytona/workspace/src/main.go");
    });

    expect(handled).toBe(true);
    // The transcript path resolves to the SAME selection a tree click yields.
    expect(latestSelectedFile()).toEqual({ entryId: "e1", path: "src/main.go" });
  });

  it("declines a platform path (returns false) and opens nothing", () => {
    render(<SessionViewer sessionId="ses_1" org="acme" />);

    let handled: boolean | undefined;
    act(() => {
      handled = capturedOnFilePathClick()(".stigmer/skills/x.md");
    });

    expect(handled).toBe(false);
    expect(latestSelectedFile()).toBeNull();
  });
});
