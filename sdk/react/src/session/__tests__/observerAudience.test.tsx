import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Wiring-contract tests for the read-only `"observer"` audience (design
// decision 012: channel-session observability).
//
// Two invariants are pinned:
// 1. `audience="observer"` renders a pure transcript — no composer, no
//    interaction callbacks on the thread, no decision surfaces — while the
//    session panel (usage/artifacts inspection) stays available.
// 2. A channel-originated session (the `stigmer.ai/channel-id` label)
//    self-selects observer regardless of the host's audience, so a pasted
//    /sessions/{id} URL can never render a send surface the server would
//    refuse (channel viewers hold can_view only).
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

const threadProps: CapturedProps[] = [];
vi.mock("../../execution/MessageThread", () => ({
  MessageThread: (props: CapturedProps) => {
    threadProps.push(props);
    return <div data-testid="thread-probe" />;
  },
}));

const fileReviewDockProps: CapturedProps[] = [];
vi.mock("../../execution/FileReviewDock", () => ({
  FileReviewDock: (props: CapturedProps) => {
    fileReviewDockProps.push(props);
    return <div data-testid="file-review-dock-probe" />;
  },
}));

const setupTabProps: CapturedProps[] = [];
vi.mock("../facets/SetupTab", () => ({
  SetupTab: (props: CapturedProps) => {
    setupTabProps.push(props);
    return <div data-testid="setup-probe" />;
  },
}));

// ---------------------------------------------------------------------------
// Flow stub — the organism owns the hook; stub it to a loaded state whose
// session the individual tests can shape (channel-labeled or plain).
// ---------------------------------------------------------------------------

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

const CHANNEL_SESSION = {
  metadata: {
    id: "ses_1",
    org: "acme",
    labels: {
      "stigmer.ai/channel-id": "ach_1",
      "stigmer.ai/channel-external-user-key": "U0AB12CD3",
    },
  },
  spec: {},
};

function lastThreadProps(): CapturedProps {
  expect(threadProps.length).toBeGreaterThan(0);
  return threadProps.at(-1)!;
}

function expectReadOnlyTranscript() {
  // No composer mounted at all — read-only by construction, not a
  // disabled state.
  expect(composerProps).toHaveLength(0);
  expect(screen.queryByTestId("composer-probe")).toBeNull();

  // Every thread interaction affordance is unwired (they are opt-in via
  // their callbacks).
  const thread = lastThreadProps();
  expect(thread.onApprovalSubmit).toBeUndefined();
  expect(thread.onEditMessage).toBeUndefined();
  expect(thread.onRetrySend).toBeUndefined();
  expect(thread.onRetryExecution).toBeUndefined();
  expect(thread.onBuildFromPlan).toBeUndefined();
  expect(thread.planActionsDisabled).toBe(true);

  // The file-review decision surface never mounts.
  expect(fileReviewDockProps).toHaveLength(0);

  // The session panel stays available — inspecting usage/artifacts is
  // the point of observability.
  expect(screen.getByRole("button", { name: "Show panel" })).toBeDefined();
}

beforeEach(() => {
  composerProps.length = 0;
  threadProps.length = 0;
  fileReviewDockProps.length = 0;
  setupTabProps.length = 0;
  stubConv.session = { spec: {} };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SessionViewer — observer audience", () => {
  it("observer: read-only transcript, no composer, panel available", () => {
    render(<SessionViewer sessionId="ses_1" org="acme" audience="observer" />);

    expectReadOnlyTranscript();
  });

  it("a channel-originated session forces observer even for integrator hosts", () => {
    stubConv.session = CHANNEL_SESSION;

    render(<SessionViewer sessionId="ses_1" org="acme" />);

    expectReadOnlyTranscript();
  });

  it("observer: the host's access slot is withheld from the panel", () => {
    stubConv.session = CHANNEL_SESSION;

    render(
      <SessionViewer
        sessionId="ses_1"
        org="acme"
        accessSlot={<button type="button">Manage access</button>}
      />,
    );

    // Even inside the opened Config facet — observers hold neither
    // can_grant_access nor can_view_access on a channel session, so the
    // control is withheld rather than left to fail server-side.
    fireEvent.click(screen.getByRole("button", { name: "Show panel" }));
    fireEvent.click(screen.getByRole("radio", { name: "Config" }));
    expect(setupTabProps.length).toBeGreaterThan(0);
    expect(setupTabProps.at(-1)!.accessSlot).toBeUndefined();
    expect(screen.queryByRole("button", { name: "Manage access" })).toBeNull();
  });

  it("a plain console session keeps its composer (no accidental forcing)", () => {
    render(<SessionViewer sessionId="ses_1" org="acme" />);

    expect(composerProps.length).toBeGreaterThan(0);
    const thread = lastThreadProps();
    expect(thread.onApprovalSubmit).toBeDefined();
    expect(thread.onRetrySend).toBeDefined();
  });
});
