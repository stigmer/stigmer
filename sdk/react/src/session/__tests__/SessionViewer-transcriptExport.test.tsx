// SessionViewer's built-in transcript export (stigmer/stigmer#814): the
// control ships ON by default in the header corner — wherever a conversation
// is viewed, its transcript is one click away (the owner-ratified DD-011
// divergence recorded on SessionViewerProps.transcriptExport) — composes
// with host headerActions, and disappears on explicit opt-out.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("../../composer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../composer")>();
  return {
    ...actual,
    SessionComposer: () => <div data-testid="composer-probe" />,
  };
});
vi.mock("../../execution/MessageThread", () => ({
  MessageThread: () => <div data-testid="thread-probe" />,
}));
vi.mock("../../execution/FileReviewDock", () => ({
  FileReviewDock: () => <div data-testid="file-review-dock-probe" />,
}));
vi.mock("../facets/SetupTab", () => ({
  SetupTab: () => <div data-testid="setup-probe" />,
}));

const stubWorkspace = {
  entries: [],
  hasEntries: false,
  toInput: vi.fn().mockReturnValue([]),
  addGitRepo: vi.fn(),
  addLocalPath: vi.fn(),
  removeEntry: vi.fn(),
  clear: vi.fn(),
};

const stubConv = {
  session: { metadata: { id: "ses_1", org: "acme" }, spec: {} },
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
  fileChangeSets: [],
  submitFileDecision: vi.fn(),
  submittingFileDecisionKeys: new Set<string>(),
  fileDecisionErrors: new Map<string, Error>(),
  streamError: null,
  reconnectStream: vi.fn(),
  approvalError: null,
  retryLastSend: vi.fn(),
};

vi.mock("../useSessionPageFlow", () => ({
  useSessionPageFlow: () => ({
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
  }),
}));

vi.mock("../../hooks", () => ({
  useStigmer: () => ({
    session: { get: vi.fn() },
    agentExecution: {
      uploadAttachment: vi.fn(),
      getArtifactContent: vi.fn(),
      listBySession: vi.fn(),
    },
  }),
}));

import { SessionViewer } from "../SessionViewer";

afterEach(cleanup);

function exportTrigger(): HTMLElement | null {
  return screen.queryByRole("button", { name: "Export transcript" });
}

describe("SessionViewer transcript export wiring", () => {
  it("renders the export control by default", () => {
    render(<SessionViewer sessionId="ses_1" org="acme" />);
    expect(exportTrigger()).not.toBeNull();
  });

  it("keeps the export control for the read-only observer audience — a bulk copy of what the observer already sees", () => {
    render(<SessionViewer sessionId="ses_1" org="acme" audience="observer" />);
    expect(exportTrigger()).not.toBeNull();
  });

  it("composes with host headerActions rather than replacing them", () => {
    render(
      <SessionViewer
        sessionId="ses_1"
        org="acme"
        headerActions={<button>Share</button>}
      />,
    );
    expect(screen.getByRole("button", { name: "Share" })).toBeTruthy();
    expect(exportTrigger()).not.toBeNull();
  });

  it("disappears on explicit opt-out, leaving host actions intact", () => {
    render(
      <SessionViewer
        sessionId="ses_1"
        org="acme"
        transcriptExport={false}
        headerActions={<button>Share</button>}
      />,
    );
    expect(exportTrigger()).toBeNull();
    expect(screen.getByRole("button", { name: "Share" })).toBeTruthy();
  });
});
