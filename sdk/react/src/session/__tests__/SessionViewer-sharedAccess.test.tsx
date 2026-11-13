/**
 * A conversation shared with the reader renders what the reader may do in
 * it, as the server answers (`useSessionAccess`, stubbed per case):
 *
 *   - a viewer (no can_create_run_in) gets the observer presentation: no
 *     composer, no approval, edit or retry callbacks, no Undo on a turn's
 *     changed files,
 *     and a footer saying they are reading it and only its members reply;
 *   - a participant (can_create_run_in, not can_edit) keeps the composer
 *     and plan building, but stop, approvals, edits, file decisions (Undo)
 *     and auto-approve are withheld, the agent and vaults are locked, and a
 *     pending approval names the creator it waits on (file review holds no
 *     turn, so it names no one), and the header's pill says the turn waits
 *     for an answer, with no Stop on the composer;
 *   - an owner keeps every control, Undo on the newest turn's changed files
 *     included: the amber pill says the turn waits for
 *     them, and the composer's Stop stays in reach.
 *
 * The thread and composer are prop-capturing probes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import { conversationOf, scenarios } from "../../test";
import { renderOutcomeOf, undecidedTurn } from "./__fixtures__/undecided-turn";

type CapturedProps = Record<string, unknown>;

const threadProps: CapturedProps[] = [];
vi.mock("../../run/MessageThread", () => ({
  MessageThread: (props: CapturedProps) => {
    threadProps.push(props);
    return <div data-testid="thread-probe" />;
  },
}));

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
  session: {
    spec: {},
    status: { audit: { specAudit: { createdBy: { id: "ida_bob", displayName: "Bob Owner" } } } },
  },
  isStoppable: true,
  isStopping: false,
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
  mcpServerUsages: [],
  skillRefs: [],
  asks: [] as unknown[],
  answerToolUse: vi.fn(),
  answeringToolUseIds: new Set<string>(),
  fileReviewSets: [] as unknown[],
  fileChangeCaptures: new Map(),
  fileChangeProgress: undefined,
  reviewFileChanges: vi.fn(),
  submittingFileDecisionKeys: new Set<string>(),
  fileDecisionErrors: new Map<string, Error>(),
  streamError: null,
  reconnectStream: vi.fn(),
  answerError: null,
};

const stubSessionPageFlow = {
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
  mcpServerUsages: [],
  setMcpServerUsages: vi.fn(),
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
};
vi.mock("../useSessionPageFlow", () => ({
  useSessionPageFlow: () => stubSessionPageFlow,
}));

const access = vi.hoisted(() => ({ canSend: true, canDecide: true }));
// The ending notice's wiring asks the server (permissions, recover): its own tests prove it.
vi.mock("../useTurnEndingWiring", () => ({
  useTurnEndingWiring: () => ({
    wiring: { viewer: { canManageProviders: false, canOpenAgent: false, canAct: true, stoppedIt: false } },
    error: null,
    clearError: () => {},
  }),
}));

vi.mock("../useSessionAccess", () => ({
  useSessionAccess: () => access,
}));

vi.mock("@stigmer/react-core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@stigmer/react-core")>()),
  useStigmer: () => ({
    run: {
      getArtifactContent: vi.fn(),
    },
    // Server info answers the run settings' Environment row: a server that predates the field.
    platform: { getServerInfo: async () => ({}) },
  }),
}));

import { SessionViewer } from "../SessionViewer";

beforeEach(() => {
  threadProps.length = 0;
  composerProps.length = 0;
  access.canSend = true;
  access.canDecide = true;
  stubConv.asks = [];
  stubConv.fileReviewSets = [];
  stubConv.turns = [];
});

/** The conversation's newest turn: it edited a file its review holds undecided. */
const EDITED = undecidedTurn("run_1");

/** Whether the outcome the thread draws for {@link EDITED} offers Undo. */
function offersUndo(): boolean {
  const { unmount } = renderOutcomeOf(threadProps.at(-1)!, EDITED);
  const offered = screen.queryByRole("button", { name: "Undo a.ts" }) !== null;
  unmount();
  return offered;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SessionViewer — a shared conversation", () => {
  it("gives a viewer a read-only transcript and says so", () => {
    access.canSend = false;
    access.canDecide = false;
    stubConv.turns = [EDITED] as never;
    render(<SessionViewer sessionId="ses_1" org="acme" />);

    expect(screen.queryByTestId("composer-probe")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("You\u2019re reading this conversation. Only its members can reply.");
    const props = threadProps.at(-1)!;
    expect(props.onAnswerToolUse).toBeUndefined();
    expect(props.onEditMessage).toBeUndefined();
    expect(props.onRetrySend).toBeUndefined();
    expect(props.onBuildFromPlan).toBeUndefined();
    expect(offersUndo()).toBe(false);
  });

  it("lets a participant send and build plans, but withholds the owners' controls", () => {
    access.canDecide = false;
    stubConv.turns = [EDITED] as never;
    render(<SessionViewer sessionId="ses_1" org="acme" />);

    expect(screen.getByTestId("composer-probe")).toBeTruthy();
    expect(screen.queryByText(/reading this conversation/)).toBeNull();
    const composer = composerProps.at(-1)!;
    expect(composer.onStop).toBeUndefined();
    expect(composer.lockAgent).toBe(true);
    expect(composer.enableVaultPicker).toBe(false);
    const thread = threadProps.at(-1)!;
    expect(thread.onAnswerToolUse).toBeUndefined();
    expect(thread.onEditMessage).toBeUndefined();
    expect(thread.onBuildFromPlan).toBeDefined();
    expect(offersUndo()).toBe(false);
  });

  it("hands the thread the owner's name, so a participant's waiting step says whom it waits on", () => {
    access.canDecide = false;
    stubConv.asks = [{ id: "call_1" }];
    render(<SessionViewer sessionId="ses_1" org="acme" />);

    expect(threadProps.at(-1)!.approverName).toBe("Bob Owner");
    // The line that floated above the composer is gone: the waiting step says it.
    expect(screen.queryByText("Waiting for Bob Owner to approve")).toBeNull();
  });

  it("tells a participant the turn waits for an answer, with no Stop and no auto-approve switch", () => {
    access.canDecide = false;
    const waiting = conversationOf(scenarios.approval).activeTurn!;
    stubConv.activeTurn = waiting as never;
    stubConv.turns = [waiting] as never;
    stubConv.asks = [{ id: "call_1" }];
    try {
      render(<SessionViewer sessionId="ses_1" org="acme" />);
      expect(screen.getByText(/^Waiting for an answer · /)).toBeTruthy();
      expect(screen.queryByText(/Waiting for you/)).toBeNull();
      expect(composerProps.at(-1)!.onStop).toBeUndefined();
      const settings = composerProps.at(-1)!.extraSettings as ReadonlyArray<{ panel: ReactNode }>;
      render(<>{settings[0]!.panel}</>);
      expect(screen.queryByRole("switch", { name: "Auto-approve" })).toBeNull();
    } finally {
      stubConv.activeTurn = null;
      stubConv.turns = [];
    }
  });

  it("KIT-08 tells an owner the turn waits for them in the amber pill, with Stop in reach and the auto-approve switch", () => {
    const waiting = conversationOf(scenarios.approval).activeTurn!;
    stubConv.activeTurn = waiting as never;
    stubConv.turns = [waiting] as never;
    stubConv.asks = [{ id: "call_1" }];
    try {
      render(<SessionViewer sessionId="ses_1" org="acme" />);
      const pill = screen.getByText(/^Waiting for you · /);
      expect(pill.className).toContain("--stgm-status-degraded");
      expect(screen.getByRole("heading", { level: 1 }).parentElement!.parentElement!.contains(pill)).toBe(true);
      const composer = composerProps.at(-1)!;
      expect(composer.onStop).toBeTypeOf("function");
      const settings = composer.extraSettings as ReadonlyArray<{ panel: ReactNode }>;
      render(<>{settings[0]!.panel}</>);
      expect(screen.getByRole("switch", { name: "Auto-approve" })).toBeTruthy();
    } finally {
      stubConv.activeTurn = null;
      stubConv.turns = [];
    }
  });

  it("never tells a participant that file review holds the turn", () => {
    access.canDecide = false;
    stubConv.fileReviewSets = [{ changeSetId: "run_1:1", files: [] }];
    render(<SessionViewer sessionId="ses_1" org="acme" />);

    expect(screen.queryByText(/Waiting for/)).toBeNull();
    expect(screen.getByTestId("composer-probe")).toBeTruthy();
  });

  it("keeps every control for an owner", () => {
    stubConv.asks = [{ id: "call_1" }];
    stubConv.turns = [EDITED] as never;
    render(<SessionViewer sessionId="ses_1" org="acme" />);

    expect(screen.queryByText(/Waiting for/)).toBeNull();
    const composer = composerProps.at(-1)!;
    expect(composer.onStop).toBeDefined();
    expect(threadProps.at(-1)!.onAnswerToolUse).toBeDefined();
    expect(offersUndo()).toBe(true);
  });
});
