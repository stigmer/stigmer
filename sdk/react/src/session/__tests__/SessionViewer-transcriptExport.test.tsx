// SessionViewer's built-in transcript export (stigmer/stigmer#814, placement
// reworked with #816): export lives in the Config facet's Transcript section
// for viewers with the session panel, and the header TranscriptExportMenu
// remains ONLY as the panel-less fallback (guests, panel="none") — so
// wherever a conversation is viewed, its transcript stays reachable, without
// a floating header button on surfaces that have a proper home for it.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

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

// SetupTab renders for real: the facet's Transcript section is asserted
// through its actual DOM (the "Copy transcript" action row), reached by
// opening the panel and selecting the Config rail view.

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

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function headerExportTrigger(): HTMLElement | null {
  return screen.queryByRole("button", { name: "Export transcript" });
}

/** Selects the panel's Config facet (the rail's radio). */
function openConfigFacet() {
  fireEvent.click(screen.getByRole("radio", { name: "Config" }));
}

function facetCopyAction(): HTMLElement | null {
  return screen.queryByRole("button", { name: "Copy transcript" });
}

describe("SessionViewer transcript export placement", () => {
  it("panel-enabled viewers export from the Config facet, not the header", () => {
    render(<SessionViewer sessionId="ses_1" org="acme" defaultPanelOpen />);
    expect(headerExportTrigger()).toBeNull();
    openConfigFacet();
    expect(facetCopyAction()).not.toBeNull();
  });

  it("observers keep facet export — a bulk copy of what they already see", () => {
    render(
      <SessionViewer
        sessionId="ses_1"
        org="acme"
        audience="observer"
        defaultPanelOpen
      />,
    );
    openConfigFacet();
    expect(facetCopyAction()).not.toBeNull();
  });

  it("panel=\"none\" hosts fall back to the header menu", () => {
    render(<SessionViewer sessionId="ses_1" org="acme" panel="none" />);
    expect(headerExportTrigger()).not.toBeNull();
  });

  it("guests fall back to the header menu (no panel to reach the facet)", () => {
    render(<SessionViewer sessionId="ses_1" org="acme" audience="guest" />);
    expect(headerExportTrigger()).not.toBeNull();
  });

  it("the header fallback composes with host headerActions", () => {
    render(
      <SessionViewer
        sessionId="ses_1"
        org="acme"
        panel="none"
        headerActions={<button>Share</button>}
      />,
    );
    expect(screen.getByRole("button", { name: "Share" })).toBeTruthy();
    expect(headerExportTrigger()).not.toBeNull();
  });

  it("explicit opt-out removes BOTH surfaces, leaving host actions intact", () => {
    render(
      <SessionViewer
        sessionId="ses_1"
        org="acme"
        transcriptExport={false}
        defaultPanelOpen
        headerActions={<button>Share</button>}
      />,
    );
    expect(headerExportTrigger()).toBeNull();
    openConfigFacet();
    expect(facetCopyAction()).toBeNull();
    expect(screen.getByRole("button", { name: "Share" })).toBeTruthy();
  });
});
