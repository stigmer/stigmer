import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Wiring-contract tests for the session panel's host-negotiation surface
// (issue #300) on both session organisms: no inspector means no panel; the
// host's SessionInspector carries `defaultOpen` and the controlled/observed
// `open` + `onOpenChange` pair; a guest never gets the panel.
//
// The contract under test is the one the PanelChip's aria labels already
// promise ("Show panel"/"Hide panel") — the same seam the issue's filer
// watched with a MutationObserver. These tests are what retires that
// workaround: every open/close beat must reach `onPanelOpenChange`.
//
// Same probe/stub setup as audienceWiring.test.tsx: the composer and thread
// are prop-capturing probes; the flow hooks are stubbed to a loaded state.
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

vi.mock("../facets/SetupTab", () => ({
  SetupTab: () => <div data-testid="setup-probe" />,
  RunConfigSection: () => <div data-testid="run-config-probe" />,
}));

vi.mock("../../run/MessageThread", () => ({
  MessageThread: () => <div data-testid="thread-probe" />,
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

const stubSessionVariables = { entries: [], isEmpty: true, clear: vi.fn(), nextPageToken: "" };

const stubNewSessionFlow = {
  harness: "stigmer" as const,
  setHarness: vi.fn(),
  modelId: undefined,
  setModelId: vi.fn(),
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
  sessionVariables: stubSessionVariables,
  isSubmitting: false,
  submitError: null,
  submit: vi.fn(),
};
// Readiness has answered "unknown": the launcher draws its composer.
vi.mock("../../models/hub/ModelsHub", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../models/hub/ModelsHub")>();
  return {
    ...actual,
    useModelsHubData: () => ({
      org: "acme",
      orgName: "acme",
      viewer: { canManage: false, local: false },
      providers: null,
      models: null,
      keyOf: () => undefined,
      parentOrgNameOf: () => undefined,
      readinessOf: () => undefined,
      isLoading: false,
      readinessLoading: false,
      error: null,
      refresh: () => {},
    }),
  };
});

vi.mock("../useNewSessionFlow", () => ({
  useNewSessionFlow: () => stubNewSessionFlow,
}));

const stubConv = {
  org: "acme",
  session: { spec: {} },
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
  retryLastSend: vi.fn(),
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
  pluginRefs: [],
  setPluginRefs: vi.fn(),
  skillRefs: [],
  setSkillRefs: vi.fn(),
  workspace: stubWorkspace,
  sessionVariables: stubSessionVariables,
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

// The reader's own access to the conversation: an owner's, unless a case
// says otherwise.
vi.mock("../useSessionAccess", () => ({
  useSessionAccess: () => ({ canSend: true, canDecide: true }),
}));

vi.mock("../../hooks", () => ({
  useStigmer: () => ({
    // Server info answers the Environment row: a server that predates the field.
    platform: { getServerInfo: async () => ({}) },
    run: {
      getArtifactContent: vi.fn(),
    },
  }),
}));

import { NewSessionViewer } from "../NewSessionViewer";
import { SessionViewer } from "../SessionViewer";
import { SessionInspector } from "../inspector/SessionInspector";

function lastComposerProps(): CapturedProps {
  expect(composerProps.length).toBeGreaterThan(0);
  return composerProps.at(-1)!;
}

function chipButton(): HTMLElement | null {
  return (
    screen.queryByRole("button", { name: "Show panel" }) ??
    screen.queryByRole("button", { name: "Hide panel" })
  );
}

beforeEach(() => {
  composerProps.length = 0;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SessionViewer — no inspector", () => {
  it("has no chip and never renders the panel", () => {
    render(<SessionViewer sessionId="ses_1" org="acme" />);
    expect(chipButton()).toBeNull();
  });

  it("keeps every composer capability the audience allows — the guest contrast", () => {
    // Leaving the inspector out removes the builder mode WITHOUT
    // audience="guest"'s composer strip-down. Assert the exact capabilities
    // guest removes.
    render(<SessionViewer sessionId="ses_1" org="acme" />);

    const props = lastComposerProps();
    expect(props.showInteractionModePicker).toBe(true);
    expect(props.showModelSelector).toBe(true);
    expect(props.enableFiles).toBe(true);
    expect(props.lockAgent).toBe(false);
    expect(props.onPluginRefsChange).toBeDefined();
  });

  it("keeps an inspector given to a guest inert — its open prop cannot force the panel", () => {
    const onOpenChange = vi.fn();
    render(
      <SessionViewer
        sessionId="ses_1"
        org="acme"
        audience="guest"
        inspector={<SessionInspector open onOpenChange={onOpenChange} />}
      />,
    );
    expect(chipButton()).toBeNull();
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});

describe("SessionViewer — observed panel state (uncontrolled + onOpenChange)", () => {
  it("reports chip toggles — the seam that retires the aria-expanded MutationObserver", () => {
    const seen: boolean[] = [];
    render(
      <SessionViewer
        sessionId="ses_1"
        org="acme"
        inspector={<SessionInspector onOpenChange={(open) => seen.push(open)} />}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Show panel" }));
    expect(seen).toEqual([true]);
    fireEvent.click(screen.getByRole("button", { name: "Hide panel" }));
    expect(seen).toEqual([true, false]);
  });

  it("starts open with defaultOpen, without a spurious notification", () => {
    const onOpenChange = vi.fn();
    render(
      <SessionViewer
        sessionId="ses_1"
        org="acme"
        inspector={<SessionInspector defaultOpen onOpenChange={onOpenChange} />}
      />,
    );

    expect(screen.getByRole("button", { name: "Hide panel" })).toBeDefined();
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});

describe("SessionViewer — controlled panel state", () => {
  it("follows open and surfaces the chip's request without applying it", () => {
    const seen: boolean[] = [];
    const onOpenChange = (open: boolean) => seen.push(open);
    const { rerender } = render(
      <SessionViewer
        sessionId="ses_1"
        org="acme"
        inspector={<SessionInspector open={false} onOpenChange={onOpenChange} />}
      />,
    );

    // The chip requests; the host owns the state — nothing moves yet.
    fireEvent.click(screen.getByRole("button", { name: "Show panel" }));
    expect(seen).toEqual([true]);
    expect(screen.getByRole("button", { name: "Show panel" })).toBeDefined();

    // The host grants the request: the panel opens and the chip flips.
    rerender(
      <SessionViewer
        sessionId="ses_1"
        org="acme"
        inspector={<SessionInspector open onOpenChange={onOpenChange} />}
      />,
    );
    expect(screen.getByRole("button", { name: "Hide panel" })).toBeDefined();
  });
});

describe("NewSessionViewer — panel negotiation (parity with SessionViewer)", () => {
  it("no inspector: no chip, while the composer keeps its capabilities", () => {
    render(<NewSessionViewer org="acme" onSessionCreated={vi.fn()} />);

    expect(chipButton()).toBeNull();
    const props = lastComposerProps();
    expect(props.showInteractionModePicker).toBe(true);
    expect(props.lockAgent).toBe(false);
  });

  it("reports chip toggles through the inspector's onOpenChange", () => {
    const seen: boolean[] = [];
    render(
      <NewSessionViewer
        org="acme"
        onSessionCreated={vi.fn()}
        inspector={<SessionInspector onOpenChange={(open) => seen.push(open)} />}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Show panel" }));
    fireEvent.click(screen.getByRole("button", { name: "Hide panel" }));
    expect(seen).toEqual([true, false]);
  });

  it("starts open with the inspector's defaultOpen", () => {
    render(<NewSessionViewer org="acme" onSessionCreated={vi.fn()} inspector={<SessionInspector defaultOpen />} />);
    expect(screen.getByRole("button", { name: "Hide panel" })).toBeDefined();
  });
});
