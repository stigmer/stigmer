// SessionViewer's built-in transcript export (stigmer/stigmer#814): the
// header's TranscriptExportMenu, for every audience and with or without the
// host's inspector, so wherever a conversation is viewed its transcript
// stays reachable.

import { describe, it, expect, vi, afterEach } from "vitest";
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
  session: { metadata: { id: "ses_1", org: "acme" }, spec: {} },
  isLoading: false,
  loadError: null,
  turns: [],
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
vi.mock("../useSessionAccess", () => ({
  useSessionAccess: () => ({ canSend: true, canDecide: true }),
}));

vi.mock("../../hooks", () => ({
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
import { SessionInspector } from "../inspector/SessionInspector";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function headerExportTrigger(): HTMLElement | null {
  return screen.queryByRole("button", { name: "Export transcript" });
}

describe("SessionViewer transcript export placement", () => {
  it.each(["integrator", "endUser", "guest", "observer"] as const)("a %s exports from the header", (audience) => {
    render(<SessionViewer sessionId="ses_1" org="acme" audience={audience} />);
    expect(headerExportTrigger()).not.toBeNull();
  });

  it("a host with the inspector exports from the header too, and the inspector carries no export", () => {
    render(<SessionViewer sessionId="ses_1" org="acme" inspector={<SessionInspector defaultOpen />} />);
    expect(headerExportTrigger()).not.toBeNull();
    expect(screen.queryByRole("radio", { name: "Config" })).toBeNull();
  });

  it("the header menu composes with host headerActions", () => {
    render(<SessionViewer sessionId="ses_1" org="acme" headerActions={<button>Share</button>} />);
    expect(screen.getByRole("button", { name: "Share" })).toBeTruthy();
    expect(headerExportTrigger()).not.toBeNull();
  });

  it("explicit opt-out removes the menu, leaving host actions intact", () => {
    render(
      <SessionViewer
        sessionId="ses_1"
        org="acme"
        transcriptExport={false}
        headerActions={<button>Share</button>}
      />,
    );
    expect(headerExportTrigger()).toBeNull();
    expect(screen.getByRole("button", { name: "Share" })).toBeTruthy();
  });
});
