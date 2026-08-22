import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Wiring-contract tests for auto-approve placement (the #816 rework):
//
// - The composer carries NO auto-approve control — the session-level switch
//   lives in the Config facet (SetupTab receives the `autoApprove` group for
//   every audience that may submit approvals, never observers; guests never
//   render the panel at all).
// - The armed-only AutoApproveIndicator above the composer is the
//   always-visible disclosure: present exactly while the state is armed,
//   with a one-click "Turn off"; never rendered for observers.
// ---------------------------------------------------------------------------

type CapturedProps = Record<string, unknown>;

const composerProps: CapturedProps[] = [];
vi.mock("../../composer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../composer")>();
  return {
    ...actual,
    SessionComposer: (props: CapturedProps) => {
      composerProps.push(props);
      return <div data-testid="composer-probe" />;
    },
  };
});

vi.mock("../../execution/MessageThread", () => ({
  MessageThread: () => <div data-testid="thread-probe" />,
}));

vi.mock("../../execution/FileReviewDock", () => ({
  FileReviewDock: () => <div data-testid="file-review-dock-probe" />,
}));

// SetupTab renders for real: the facet switch is asserted through its
// actual DOM (a switch labeled "Auto-approve" in the Run Config section),
// reached by opening the panel and selecting the Config rail view.

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
  session: { spec: {} } as Record<string, unknown>,
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

const setAutoApproveAll = vi.fn();
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
  setAutoApproveAll,
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

const INDICATOR_TEXT = "Auto-approving tool calls for this session";

function lastComposerProps(): CapturedProps {
  expect(composerProps.length).toBeGreaterThan(0);
  return composerProps.at(-1)!;
}

/** Selects the panel's Config facet (the rail's radio). */
function openConfigFacet() {
  fireEvent.click(screen.getByRole("radio", { name: "Config" }));
}

function facetSwitch(): HTMLElement | null {
  return screen.queryByRole("switch", { name: "Auto-approve" });
}

beforeEach(() => {
  composerProps.length = 0;
  stubConv.session = { spec: {} };
  stubSessionPageFlow.autoApproveAll = false;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SessionViewer — composer stays clean (#816 rework)", () => {
  it("hands the composer no auto-approve control at all", () => {
    render(<SessionViewer sessionId="ses_1" org="acme" />);

    expect("autoApprove" in lastComposerProps()).toBe(false);
  });
});

describe("SessionViewer — Config facet auto-approve switch (#816 rework)", () => {
  it("renders the switch reflecting the flow state, and flipping calls the flow (integrator)", () => {
    render(<SessionViewer sessionId="ses_1" org="acme" defaultPanelOpen />);
    openConfigFacet();

    const toggle = facetSwitch();
    expect(toggle).not.toBeNull();
    expect(toggle!.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(toggle!);
    expect(setAutoApproveAll).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("mirrors an armed flow state into the switch", () => {
    stubSessionPageFlow.autoApproveAll = true;
    render(<SessionViewer sessionId="ses_1" org="acme" defaultPanelOpen />);
    openConfigFacet();

    expect(facetSwitch()!.getAttribute("aria-checked")).toBe("true");
  });

  it("endUser gets the switch — the walk-away persona is an end user", () => {
    render(
      <SessionViewer
        sessionId="ses_1"
        org="acme"
        audience="endUser"
        defaultPanelOpen
      />,
    );
    openConfigFacet();

    expect(facetSwitch()).not.toBeNull();
  });

  it("observers never get the switch — the approval-submission withhold", () => {
    render(
      <SessionViewer
        sessionId="ses_1"
        org="acme"
        audience="observer"
        defaultPanelOpen
      />,
    );
    openConfigFacet();

    expect(facetSwitch()).toBeNull();
  });

  it("channel-origin sessions never get the switch (observer by construction)", () => {
    stubConv.session = {
      spec: {},
      metadata: { labels: { "stigmer.ai/channel-id": "chn_1" } },
    };
    render(<SessionViewer sessionId="ses_1" org="acme" defaultPanelOpen />);
    openConfigFacet();

    expect(facetSwitch()).toBeNull();
  });
});

describe("SessionViewer — armed-only indicator (#816 rework)", () => {
  it("absent while auto-approve is off — the composer stays clean", () => {
    render(<SessionViewer sessionId="ses_1" org="acme" />);

    expect(screen.queryByText(INDICATOR_TEXT)).toBeNull();
  });

  it("renders while armed, and Turn off flips the flow state", () => {
    stubSessionPageFlow.autoApproveAll = true;
    render(<SessionViewer sessionId="ses_1" org="acme" />);

    expect(screen.getByText(INDICATOR_TEXT)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Turn off" }));
    expect(setAutoApproveAll).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("never renders for observers — they cannot arm or disarm anything", () => {
    stubSessionPageFlow.autoApproveAll = true;
    render(
      <SessionViewer sessionId="ses_1" org="acme" audience="observer" />,
    );

    expect(screen.queryByText(INDICATOR_TEXT)).toBeNull();
  });
});
