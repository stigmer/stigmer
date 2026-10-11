import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

// ---------------------------------------------------------------------------
// The viewer acts in the session's own organization (stigmer/stigmer#1580):
// once the conversation reports the session's organization, every
// org-scoped child receives it, whatever the host's `org` prop says, so a
// session opened while another organization is active never files a turn
// or runs a picker there. The composer's vault picker starts from the vaults
// the session lists, by organization and slug.
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
vi.mock("../../run/MessageThread", () => ({
  MessageThread: (props: CapturedProps) => {
    threadProps.push(props);
    return <div data-testid="thread-probe" />;
  },
}));

vi.mock("../../run/FileReviewDock", () => ({
  FileReviewDock: () => <div data-testid="file-review-dock-probe" />,
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
  org: "acme" as string,
  session: { spec: {} } as Record<string, unknown>,
  isLoading: false,
  loadError: null,
  completedRuns: [],
  activeStreamRun: null,
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
  plugins: [],
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
  sessionVariables: { entries: [], isEmpty: true, clear: vi.fn() },
  autoApproveAll: false,
  setAutoApproveAll: vi.fn(),
  submitApproval: vi.fn(),
  handleSubmit: vi.fn(),
  submitError: null as Error | null,
  displayRun: null,
  allRuns: [],
  sandboxWorkspaceRoot: undefined,
};
vi.mock("../useSessionPageFlow", () => ({
  useSessionPageFlow: () => stubSessionPageFlow,
}));

// The reader's own access to the conversation: an owner's, unless a case
// says otherwise.
vi.mock("../useSessionAccess", () => ({
  useSessionAccess: () => ({ canSend: true, canDecide: true }),
}));

vi.mock("../../hooks", () => ({
  useStigmer: () => ({
    run: {
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
  threadProps.length = 0;
  stubConv.org = "acme";
  stubConv.session = { spec: {} };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SessionViewer — the session's organization", () => {
  it("hands the composer the session's organization, not the host's prop", () => {
    render(<SessionViewer sessionId="ses_1" org="personal" />);

    expect(lastComposerProps().org).toBe("acme");
  });

  it("hands the thread (its plan actions) the session's organization too", () => {
    render(<SessionViewer sessionId="ses_1" org="personal" />);

    expect(threadProps.length).toBeGreaterThan(0);
    expect(threadProps.at(-1)!.org).toBe("acme");
  });

  it("starts the composer's vault picker from the vaults the session lists", () => {
    stubConv.session = {
      spec: { vaults: [{ org: "acme", slug: "support-tools", kind: 7 }] },
    };
    render(<SessionViewer sessionId="ses_1" org="personal" />);

    expect(lastComposerProps().initialVaultRefs).toEqual([{ org: "acme", slug: "support-tools" }]);
  });
});
