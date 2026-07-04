import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Wiring-contract tests for the `audience` preset on the session organisms.
//
// The composer and the Config facet (SetupTab) are replaced with
// prop-capturing probes so the tests assert exactly what `audience="endUser"`
// maps to: a locked agent, unwired MCP/skill/session-variable pickers, and a
// read-only Config facet. The Config facet lives in the session panel's rail,
// so the probe is reached by opening the panel (chip) and picking Config.
// The molecules' own behavior is covered by their co-located tests.
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

const setupTabProps: CapturedProps[] = [];
vi.mock("../facets/SetupTab", () => ({
  SetupTab: (props: CapturedProps) => {
    setupTabProps.push(props);
    return <div data-testid="setup-probe" />;
  },
}));

vi.mock("../../execution/MessageThread", () => ({
  MessageThread: () => <div data-testid="thread-probe" />,
}));

// ---------------------------------------------------------------------------
// Flow stubs — the organisms own these hooks; stub them to a loaded state.
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

const stubSessionVariables = { entries: [], isEmpty: true, clear: vi.fn() };

const stubNewSessionFlow = {
  harness: "native" as const,
  setHarness: vi.fn(),
  modelId: undefined,
  setModelId: vi.fn(),
  agentRef: { org: "acme", slug: "support-bot" },
  setAgentRef: vi.fn(),
  resolution: null,
  setResolution: vi.fn(),
  mcpServerUsages: [],
  setMcpServerUsages: vi.fn(),
  skillRefs: [],
  setSkillRefs: vi.fn(),
  workspace: stubWorkspace,
  sessionVariables: stubSessionVariables,
  isSubmitting: false,
  submitError: null,
  submit: vi.fn(),
};
const mockUseNewSessionFlow = vi.fn((_options: unknown) => stubNewSessionFlow);
vi.mock("../useNewSessionFlow", () => ({
  useNewSessionFlow: (options: unknown) => mockUseNewSessionFlow(options),
}));

const stubConv = {
  session: { spec: {} },
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
  sessionVariables: stubSessionVariables,
  autoApproveAll: false,
  setAutoApproveAll: vi.fn(),
  submitApproval: vi.fn(),
  handleSubmit: vi.fn(),
  submitError: null as Error | null,
  displayExecution: null,
  allExecutions: [],
  sandboxWorkspaceRoot: undefined,
};
const mockUseSessionPageFlow = vi.fn((_options: unknown) => stubSessionPageFlow);
vi.mock("../useSessionPageFlow", () => ({
  useSessionPageFlow: (options: unknown) => mockUseSessionPageFlow(options),
}));

import { NewSessionViewer } from "../NewSessionViewer";
import { SessionViewer } from "../SessionViewer";

const AGENT_REF = { org: "acme", slug: "support-bot" };

function lastComposerProps(): CapturedProps {
  expect(composerProps.length).toBeGreaterThan(0);
  return composerProps.at(-1)!;
}

/**
 * Reach the Config facet through the unified panel: expand it via the
 * top-right chip, pick Config in the rail, and return the props the (mocked)
 * SetupTab received.
 */
function openedConfigFacet(): { mutations?: unknown } {
  fireEvent.click(screen.getByRole("button", { name: "Show panel" }));
  fireEvent.click(screen.getByRole("radio", { name: "Config" }));
  expect(setupTabProps.length).toBeGreaterThan(0);
  return setupTabProps.at(-1)!;
}

beforeEach(() => {
  composerProps.length = 0;
  setupTabProps.length = 0;
  stubSessionPageFlow.submitError = null;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("NewSessionViewer — audience wiring", () => {
  it("integrator (default): full configuration surface, agent unlocked", () => {
    render(
      <NewSessionViewer
        org="acme"
        onSessionCreated={vi.fn()}
        initialAgentRef={AGENT_REF}
      />,
    );

    const props = lastComposerProps();
    expect(props.lockAgent).toBe(false);
    expect(props.onMcpServerUsagesChange).toBeDefined();
    expect(props.onSkillRefsChange).toBeDefined();
    expect(props.sessionVariables).toBeDefined();
    expect(openedConfigFacet().mutations).toBeDefined();
  });

  it("endUser with a pinned agent: locked agent, integrator pickers unwired", () => {
    render(
      <NewSessionViewer
        org="acme"
        onSessionCreated={vi.fn()}
        audience="endUser"
        initialAgentRef={AGENT_REF}
      />,
    );

    const props = lastComposerProps();
    expect(props.lockAgent).toBe(true);
    expect(props.onMcpServerUsagesChange).toBeUndefined();
    expect(props.onSkillRefsChange).toBeUndefined();
    expect(props.sessionVariables).toBeUndefined();
    // End-user controls survive the curation.
    expect(props.showHarnessSelector).toBe(true);
    expect(props.showInteractionModePicker).toBe(true);
    // Config facet is read-only: no remove affordances for pinned config.
    expect(openedConfigFacet().mutations).toBeUndefined();
  });

  it("endUser without a pinned agent: pickers hidden but agent not locked", () => {
    render(
      <NewSessionViewer
        org="acme"
        onSessionCreated={vi.fn()}
        audience="endUser"
      />,
    );

    expect(lastComposerProps().lockAgent).toBe(false);
  });

  it("forwards getRuntimeEnv and defaultHarness to the flow", () => {
    const getRuntimeEnv = vi.fn();
    render(
      <NewSessionViewer
        org="acme"
        onSessionCreated={vi.fn()}
        getRuntimeEnv={getRuntimeEnv}
        defaultHarness="cursor"
      />,
    );

    expect(mockUseNewSessionFlow).toHaveBeenCalledWith(
      expect.objectContaining({ getRuntimeEnv, defaultHarness: "cursor" }),
    );
  });
});

describe("SessionViewer — audience wiring", () => {
  it("integrator (default): full configuration surface, agent unlocked", () => {
    render(<SessionViewer sessionId="ses_1" org="acme" />);

    const props = lastComposerProps();
    expect(props.lockAgent).toBe(false);
    expect(props.onMcpServerUsagesChange).toBeDefined();
    expect(props.onSkillRefsChange).toBeDefined();
    expect(props.sessionVariables).toBeDefined();
    expect(openedConfigFacet().mutations).toBeDefined();
  });

  it("endUser: locked agent, integrator pickers unwired, read-only Setup tab", () => {
    render(<SessionViewer sessionId="ses_1" org="acme" audience="endUser" />);

    const props = lastComposerProps();
    expect(props.lockAgent).toBe(true);
    expect(props.onMcpServerUsagesChange).toBeUndefined();
    expect(props.onSkillRefsChange).toBeUndefined();
    expect(props.sessionVariables).toBeUndefined();
    // End-user controls survive the curation.
    expect(props.showInteractionModePicker).toBe(true);
    expect(openedConfigFacet().mutations).toBeUndefined();
  });

  it("forwards getRuntimeEnv to the flow", () => {
    const getRuntimeEnv = vi.fn();
    render(
      <SessionViewer sessionId="ses_1" org="acme" getRuntimeEnv={getRuntimeEnv} />,
    );

    expect(mockUseSessionPageFlow).toHaveBeenCalledWith(
      expect.objectContaining({ getRuntimeEnv }),
    );
  });

  it("renders the flow's submitError through the send-error banner", () => {
    stubSessionPageFlow.submitError = new Error("token mint failed");
    render(<SessionViewer sessionId="ses_1" org="acme" />);

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("token mint failed");
  });
});
