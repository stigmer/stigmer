import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Wiring-contract tests for the always-visible auto-approve toggle
// (stigmer/stigmer#816): SessionViewer hands the composer the flow's
// auto-approve state for every audience that may submit approvals
// (integrator AND endUser — the walk-away persona is an embedder's end
// user), never for guests, and the old armed-only indicator banner is gone
// (the toggle IS the indicator now).
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

function lastComposerProps(): CapturedProps {
  expect(composerProps.length).toBeGreaterThan(0);
  return composerProps.at(-1)!;
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

describe("SessionViewer — auto-approve toggle wiring (#816)", () => {
  it("hands the composer the flow's auto-approve state (integrator)", () => {
    render(<SessionViewer sessionId="ses_1" org="acme" />);

    const autoApprove = lastComposerProps().autoApprove as
      | { armed: boolean; onChange: (v: boolean) => void }
      | undefined;
    expect(autoApprove).toBeDefined();
    expect(autoApprove!.armed).toBe(false);
    expect(autoApprove!.onChange).toBe(setAutoApproveAll);
  });

  it("mirrors an armed flow state into the composer", () => {
    stubSessionPageFlow.autoApproveAll = true;
    render(<SessionViewer sessionId="ses_1" org="acme" />);

    const autoApprove = lastComposerProps().autoApprove as { armed: boolean };
    expect(autoApprove.armed).toBe(true);
  });

  it("endUser gets the toggle — the walk-away persona is an end user", () => {
    render(<SessionViewer sessionId="ses_1" org="acme" audience="endUser" />);

    expect(lastComposerProps().autoApprove).toBeDefined();
  });

  it("guests never get the toggle", () => {
    render(<SessionViewer sessionId="ses_1" org="acme" audience="guest" />);

    expect(lastComposerProps().autoApprove).toBeUndefined();
  });

  it("the armed-only indicator banner is gone — the toggle is the indicator", () => {
    stubSessionPageFlow.autoApproveAll = true;
    render(<SessionViewer sessionId="ses_1" org="acme" />);

    expect(
      screen.queryByText("Auto-approving tool calls for this session"),
    ).toBeNull();
  });
});
