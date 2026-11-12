/**
 * Pins the session view's `nextStep` slot: drawn at the foot of the
 * conversation, under the newest turn, only once that turn has settled (a
 * turn exists, no run is active, nothing waits to be sent); called with the
 * agent the session runs; never drawn for a guest, an observer or a
 * participant; and with no host filling it nothing is drawn at all, so the
 * view is unchanged for every embed. The thread, the summary and the
 * composer are probes; the slot's own content is the host's.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("../../composer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../composer")>();
  return {
    ...actual,
    SessionComposer: () => <div data-testid="composer-probe" />,
  };
});
vi.mock("../../run/MessageThread", () => ({
  MessageThread: () => <div data-testid="thread-probe" />,
}));
vi.mock("../SessionSummary", () => ({
  SessionSummary: () => <div data-testid="summary-probe" />,
}));
vi.mock("../../run/FileReviewDock", () => ({
  FileReviewDock: () => <div data-testid="file-review-dock-probe" />,
}));

// The header menu is asserted through its real trigger.

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
  org: "acme",
  session: { metadata: { id: "ses_1", org: "acme" }, spec: { agentRef: { org: "org_acme", slug: "variance-reporter" } } } as unknown,
  isLoading: false,
  loadError: null,
  turns: [{ executionId: "run_1" }] as unknown[],
  runs: [],
  activeTurn: null,
  activeRun: null,
  activePhase: null as number | null,
  isStreaming: false,
  isConnecting: false,
  sendFollowUp: vi.fn(),
  canSendFollowUp: true,
  isSending: false,
  sendError: null,
  clearSendError: vi.fn(),
  pendingUserMessage: null as string | null,
  resources: [],
  plugins: [],
  skillRefs: [],
  asks: [],
  answerToolUse: vi.fn(),
  answeringToolUseIds: new Set<string>(),
  fileReviewSets: [],
  fileChangeCaptures: new Map(),
  reviewFileChanges: vi.fn(),
  submittingFileDecisionKeys: new Set<string>(),
  fileDecisionErrors: new Map<string, Error>(),
  streamError: null,
  reconnectStream: vi.fn(),
  answerError: null,
  retryLastSend: vi.fn(),
};

vi.mock("../useSessionPageFlow", () => ({
  useSessionPageFlow: () => ({
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
  }),
}));

// The reader's own access to the conversation: an owner's, unless a case
// says otherwise.
const access = { canSend: true, canDecide: true };
vi.mock("../useSessionAccess", () => ({
  useSessionAccess: () => access,
}));

vi.mock("@stigmer/react-core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@stigmer/react-core")>()),
  useStigmer: () => ({
    session: { get: vi.fn() },
    // Server info answers the Environment row: a server that predates the field.
    platform: { getServerInfo: async () => ({}) },
    run: {
      getArtifactContent: vi.fn(),
      listBySession: vi.fn(),
    },
  }),
}));

import { SessionViewer } from "../SessionViewer";

beforeEach(() => {
  stubConv.turns = [{ executionId: "run_1" }];
  stubConv.activePhase = null;
  stubConv.pendingUserMessage = null;
  access.canSend = true;
  access.canDecide = true;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const nextStep = vi.fn(({ agentRef }: { agentRef: { org: string; slug: string } | undefined }) => (
  <p data-testid="next-step">next for {agentRef?.slug ?? "none"}</p>
));

describe("SessionViewer nextStep", () => {
  it("draws the host's next step under a settled turn, with the session's agent", () => {
    render(<SessionViewer sessionId="ses_1" org="acme" nextStep={nextStep} />);

    expect(screen.getByTestId("next-step").textContent).toBe("next for variance-reporter");
    expect(nextStep.mock.calls.at(-1)?.[0]).toEqual({ agentRef: expect.objectContaining({ org: "org_acme", slug: "variance-reporter" }) });
    // At the foot of the conversation: after the thread, before the composer.
    const thread = screen.getByTestId("thread-probe");
    const line = screen.getByTestId("next-step");
    const composer = screen.getByTestId("composer-probe");
    expect(thread.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(line.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("draws nothing while a turn runs, while a message waits to send, or before any turn", () => {
    stubConv.activePhase = 2;
    const { unmount } = render(<SessionViewer sessionId="ses_1" org="acme" nextStep={nextStep} />);
    expect(screen.queryByTestId("next-step")).toBeNull();
    unmount();

    stubConv.activePhase = null;
    stubConv.pendingUserMessage = "and again";
    const second = render(<SessionViewer sessionId="ses_1" org="acme" nextStep={nextStep} />);
    expect(screen.queryByTestId("next-step")).toBeNull();
    second.unmount();

    stubConv.pendingUserMessage = null;
    stubConv.turns = [];
    render(<SessionViewer sessionId="ses_1" org="acme" nextStep={nextStep} />);
    expect(screen.queryByTestId("next-step")).toBeNull();
  });

  it.each(["guest", "observer"] as const)("draws nothing for a %s", (audience) => {
    render(<SessionViewer sessionId="ses_1" org="acme" audience={audience} nextStep={nextStep} />);
    expect(screen.queryByTestId("next-step")).toBeNull();
  });

  it("draws nothing for a participant, who sends but decides nothing", () => {
    access.canDecide = false;
    render(<SessionViewer sessionId="ses_1" org="acme" nextStep={nextStep} />);
    expect(screen.queryByTestId("next-step")).toBeNull();
  });

  it("draws nothing without a host filling the slot", () => {
    const { container } = render(<SessionViewer sessionId="ses_1" org="acme" />);
    expect(container.textContent).not.toContain("next for");
    expect(nextStep).not.toHaveBeenCalled();
  });
});
