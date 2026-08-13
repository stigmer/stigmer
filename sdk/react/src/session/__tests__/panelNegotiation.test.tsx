import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Wiring-contract tests for the session panel's host-negotiation surface
// (issue #300): `panel="none"` omission, `defaultPanelOpen`, and the
// controlled/observed `panelOpen` + `onPanelOpenChange` pair on both session
// organisms.
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
}));

vi.mock("../../execution/MessageThread", () => ({
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
vi.mock("../useNewSessionFlow", () => ({
  useNewSessionFlow: () => stubNewSessionFlow,
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
  retryLastSend: vi.fn(),
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

import { NewSessionViewer } from "../NewSessionViewer";
import { SessionViewer } from "../SessionViewer";

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

describe("SessionViewer — panel=\"none\"", () => {
  it("removes the chip and never renders the panel", () => {
    render(<SessionViewer sessionId="ses_1" org="acme" panel="none" />);
    expect(chipButton()).toBeNull();
  });

  it("keeps every composer capability the audience allows — the guest contrast", () => {
    // The point of panel="none": omission WITHOUT audience="guest"'s
    // composer strip-down. Assert the exact capabilities guest removes.
    render(<SessionViewer sessionId="ses_1" org="acme" panel="none" />);

    const props = lastComposerProps();
    expect(props.showInteractionModePicker).toBe(true);
    expect(props.showModelSelector).toBe(true);
    expect(props.enableAttachments).toBe(true);
    expect(props.lockAgent).toBe(false);
    expect(props.onMcpServerUsagesChange).toBeDefined();
  });

  it("keeps controlled props inert — panelOpen cannot force a surface that does not exist", () => {
    const onPanelOpenChange = vi.fn();
    render(
      <SessionViewer
        sessionId="ses_1"
        org="acme"
        panel="none"
        panelOpen={true}
        onPanelOpenChange={onPanelOpenChange}
      />,
    );
    expect(chipButton()).toBeNull();
    expect(onPanelOpenChange).not.toHaveBeenCalled();
  });
});

describe("SessionViewer — observed panel state (uncontrolled + onPanelOpenChange)", () => {
  it("reports chip toggles — the seam that retires the aria-expanded MutationObserver", () => {
    const seen: boolean[] = [];
    render(
      <SessionViewer
        sessionId="ses_1"
        org="acme"
        onPanelOpenChange={(open) => seen.push(open)}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Show panel" }));
    expect(seen).toEqual([true]);
    fireEvent.click(screen.getByRole("button", { name: "Hide panel" }));
    expect(seen).toEqual([true, false]);
  });

  it("starts open with defaultPanelOpen, without a spurious notification", () => {
    const onPanelOpenChange = vi.fn();
    render(
      <SessionViewer
        sessionId="ses_1"
        org="acme"
        defaultPanelOpen
        onPanelOpenChange={onPanelOpenChange}
      />,
    );

    expect(screen.getByRole("button", { name: "Hide panel" })).toBeDefined();
    expect(onPanelOpenChange).not.toHaveBeenCalled();
  });
});

describe("SessionViewer — controlled panel state", () => {
  it("follows panelOpen and surfaces the chip's request without applying it", () => {
    const seen: boolean[] = [];
    const onPanelOpenChange = (open: boolean) => seen.push(open);
    const { rerender } = render(
      <SessionViewer
        sessionId="ses_1"
        org="acme"
        panelOpen={false}
        onPanelOpenChange={onPanelOpenChange}
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
        panelOpen={true}
        onPanelOpenChange={onPanelOpenChange}
      />,
    );
    expect(screen.getByRole("button", { name: "Hide panel" })).toBeDefined();
  });
});

describe("NewSessionViewer — panel negotiation (DD-016 parity)", () => {
  it("panel=\"none\" removes the chip while the composer keeps its capabilities", () => {
    render(
      <NewSessionViewer org="acme" onSessionCreated={vi.fn()} panel="none" />,
    );

    expect(chipButton()).toBeNull();
    const props = lastComposerProps();
    expect(props.showInteractionModePicker).toBe(true);
    expect(props.lockAgent).toBe(false);
  });

  it("reports chip toggles through onPanelOpenChange", () => {
    const seen: boolean[] = [];
    render(
      <NewSessionViewer
        org="acme"
        onSessionCreated={vi.fn()}
        onPanelOpenChange={(open) => seen.push(open)}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Show panel" }));
    fireEvent.click(screen.getByRole("button", { name: "Hide panel" }));
    expect(seen).toEqual([true, false]);
  });

  it("starts open with defaultPanelOpen", () => {
    render(
      <NewSessionViewer org="acme" onSessionCreated={vi.fn()} defaultPanelOpen />,
    );
    expect(screen.getByRole("button", { name: "Hide panel" })).toBeDefined();
  });
});
