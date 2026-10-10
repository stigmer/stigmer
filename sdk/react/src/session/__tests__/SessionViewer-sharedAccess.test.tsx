/**
 * A conversation shared with the reader renders what the reader may do in
 * it, as the server answers (`useSessionAccess`, stubbed per case):
 *
 *   - a viewer (no can_create_run_in) gets the observer presentation: no
 *     composer, no approval, edit or retry callbacks, no file-review dock,
 *     and a line saying they can read the conversation;
 *   - a participant (can_create_run_in, not can_edit) keeps the composer
 *     and plan building, but stop, approvals, edits, file decisions and
 *     auto-approve are withheld, the agent and vaults are locked, and a
 *     pending decision names the creator it waits on;
 *   - an owner keeps every control.
 *
 * The thread and composer are prop-capturing probes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

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
  mcpServerUsages: [],
  skillRefs: [],
  pendingApprovals: [] as unknown[],
  submitApproval: vi.fn(),
  submittingApprovalIds: new Set<string>(),
  fileChangeSets: [] as unknown[],
  fileChangeProgress: undefined,
  submitFileDecision: vi.fn(),
  submittingFileDecisionKeys: new Set<string>(),
  fileDecisionErrors: new Map<string, Error>(),
  streamError: null,
  reconnectStream: vi.fn(),
  approvalError: null,
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
  displayRun: null,
  allRuns: [],
  sandboxWorkspaceRoot: undefined,
};
vi.mock("../useSessionPageFlow", () => ({
  useSessionPageFlow: () => stubSessionPageFlow,
}));

const access = vi.hoisted(() => ({ canSend: true, canDecide: true }));
vi.mock("../useSessionAccess", () => ({
  useSessionAccess: () => access,
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

beforeEach(() => {
  threadProps.length = 0;
  composerProps.length = 0;
  access.canSend = true;
  access.canDecide = true;
  stubConv.pendingApprovals = [];
  stubConv.fileChangeSets = [];
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SessionViewer — a shared conversation", () => {
  it("gives a viewer a read-only transcript and says so", () => {
    access.canSend = false;
    access.canDecide = false;
    render(<SessionViewer sessionId="ses_1" org="acme" />);

    expect(screen.queryByTestId("composer-probe")).toBeNull();
    expect(screen.getByText("You can read this conversation.")).toBeTruthy();
    const props = threadProps.at(-1)!;
    expect(props.onApprovalSubmit).toBeUndefined();
    expect(props.onEditMessage).toBeUndefined();
    expect(props.onRetrySend).toBeUndefined();
    expect(props.onBuildFromPlan).toBeUndefined();
  });

  it("lets a participant send and build plans, but withholds the owners' controls", () => {
    access.canDecide = false;
    render(<SessionViewer sessionId="ses_1" org="acme" />);

    expect(screen.getByTestId("composer-probe")).toBeTruthy();
    expect(screen.queryByText("You can read this conversation.")).toBeNull();
    const composer = composerProps.at(-1)!;
    expect(composer.onStop).toBeUndefined();
    expect(composer.lockAgent).toBe(true);
    expect(composer.enableVaultPicker).toBe(false);
    const thread = threadProps.at(-1)!;
    expect(thread.onApprovalSubmit).toBeUndefined();
    expect(thread.onEditMessage).toBeUndefined();
    expect(thread.onBuildFromPlan).toBeDefined();
    expect(
      document.querySelector('[data-cursor-target="file-review-dock"]'),
    ).toBeNull();
  });

  it("tells a participant whom a pending decision waits on", () => {
    access.canDecide = false;
    stubConv.pendingApprovals = [{ toolCallId: "call_1" }];
    render(<SessionViewer sessionId="ses_1" org="acme" />);

    expect(screen.getByText("Waiting for Bob Owner to approve")).toBeTruthy();
  });

  it("keeps every control for an owner", () => {
    stubConv.pendingApprovals = [{ toolCallId: "call_1" }];
    render(<SessionViewer sessionId="ses_1" org="acme" />);

    expect(screen.queryByText(/Waiting for/)).toBeNull();
    const composer = composerProps.at(-1)!;
    expect(composer.onStop).toBeDefined();
    expect(threadProps.at(-1)!.onApprovalSubmit).toBeDefined();
  });
});
