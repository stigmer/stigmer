import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { forwardRef, useImperativeHandle } from "react";

// ---------------------------------------------------------------------------
// Wiring-contract test for edit-and-resubmit (stigmer/stigmer#181): the
// onEditMessage SessionViewer hands to MessageThread stops the in-flight
// turn, prefills the composer, and enters editing mode; submitting while
// editing attaches the superseded execution's id to the submit context;
// cancelling drops the link so the next send appends normally. MessageThread
// and SessionComposer render as prop-capturing probes; the viewer's editing
// state machine is the subject under test.
// ---------------------------------------------------------------------------

type CapturedProps = Record<string, unknown>;

const threadProps: CapturedProps[] = [];
vi.mock("../../execution/MessageThread", () => ({
  MessageThread: (props: CapturedProps) => {
    threadProps.push(props);
    return <div data-testid="thread-probe" />;
  },
}));

vi.mock("../../workspace/WorkspaceSurface", () => ({
  WorkspaceSurface: () => <div data-testid="surface-probe" />,
}));

const composerProps: CapturedProps[] = [];
const composerSetMessage = vi.fn();
const composerFocus = vi.fn();
vi.mock("../../composer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../composer")>();
  const ComposerProbe = forwardRef<unknown, CapturedProps>(
    function ComposerProbe(props, ref) {
      useImperativeHandle(ref, () => ({
        setMessage: composerSetMessage,
        focus: composerFocus,
        submit: vi.fn(),
      }));
      composerProps.push(props);
      return <div data-testid="composer-probe" />;
    },
  );
  return { ...actual, SessionComposer: ComposerProbe };
});

const stubConv = {
  session: { spec: {} },
  isLoading: false,
  loadError: null,
  completedExecutions: [],
  activeStreamExecution: { metadata: { id: "exec-old" } },
  pendingUserMessage: null,
  workspaceEntries: [],
  fileChangeSets: [],
  submitFileDecision: vi.fn(),
  submittingFileDecisionKeys: new Set<string>(),
  fileDecisionErrors: new Map<string, Error>(),
  sendError: null,
  stopError: null,
  streamError: null,
  reconnectStream: vi.fn(),
  submittingApprovalIds: new Set<string>(),
  approvalErrors: new Map<string, Error>(),
  isStoppable: true,
  isStopping: false,
  isSending: false,
  canSendFollowUp: false,
  isReconnecting: false,
  connectTimedOut: false,
  isSlow: false,
  stop: vi.fn().mockResolvedValue(undefined),
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
  workspace: {
    entries: [],
    hasEntries: false,
    toInput: vi.fn().mockReturnValue([]),
    addGitRepo: vi.fn(),
    addLocalPath: vi.fn(),
    remove: vi.fn(),
    clear: vi.fn(),
    clearLocal: vi.fn(),
  },
  sessionVariables: { entries: [], isEmpty: true, clear: vi.fn() },
  autoApproveAll: false,
  setAutoApproveAll: vi.fn(),
  handleSubmit: vi.fn(),
  submitError: null as Error | null,
  displayExecution: null,
  allExecutions: [],
  sandboxWorkspaceRoot: "/home/daytona/workspace",
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

/** The onEditMessage handler threaded down to the (mocked) MessageThread. */
function capturedOnEditMessage(): ((text: string) => void) | undefined {
  return threadProps.at(-1)?.onEditMessage as
    | ((text: string) => void)
    | undefined;
}

/** The latest props the (mocked) SessionComposer received. */
function latestComposerProps(): CapturedProps {
  return composerProps.at(-1) ?? {};
}

function submitViaComposer(message: string): void {
  const onSubmit = latestComposerProps().onSubmit as (
    m: string,
    model?: string,
    context?: Record<string, unknown>,
  ) => void;
  onSubmit(message, undefined, { interactionMode: "agent" });
}

beforeEach(() => {
  threadProps.length = 0;
  composerProps.length = 0;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SessionViewer — edit-and-resubmit wiring", () => {
  it("wires onEditMessage to the thread while the turn is stoppable", () => {
    render(<SessionViewer sessionId="ses_1" org="acme" />);
    expect(typeof capturedOnEditMessage()).toBe("function");
    expect(latestComposerProps().isEditing).toBe(false);
  });

  it("Edit stops the turn, prefills the composer, and enters editing mode", () => {
    render(<SessionViewer sessionId="ses_1" org="acme" />);

    act(() => {
      capturedOnEditMessage()!("original message");
    });

    expect(stubConv.stop).toHaveBeenCalledTimes(1);
    expect(composerSetMessage).toHaveBeenCalledWith("original message");
    expect(composerFocus).toHaveBeenCalledTimes(1);
    expect(latestComposerProps().isEditing).toBe(true);
  });

  it("submitting while editing attaches the supersede link and exits editing", () => {
    render(<SessionViewer sessionId="ses_1" org="acme" />);

    act(() => {
      capturedOnEditMessage()!("original message");
    });
    act(() => {
      submitViaComposer("corrected message");
    });

    expect(stubSessionPageFlow.handleSubmit).toHaveBeenCalledTimes(1);
    const [message, , context] =
      stubSessionPageFlow.handleSubmit.mock.calls[0];
    expect(message).toBe("corrected message");
    expect(context).toMatchObject({
      supersedesExecutionId: "exec-old",
      // Composer-provided context fields survive the merge.
      interactionMode: "agent",
    });
    expect(latestComposerProps().isEditing).toBe(false);
  });

  it("cancelling the edit clears the composer and drops the supersede link", () => {
    render(<SessionViewer sessionId="ses_1" org="acme" />);

    act(() => {
      capturedOnEditMessage()!("original message");
    });
    expect(latestComposerProps().isEditing).toBe(true);

    act(() => {
      (latestComposerProps().onCancelEdit as () => void)();
    });
    expect(latestComposerProps().isEditing).toBe(false);
    expect(composerSetMessage).toHaveBeenLastCalledWith("");

    // A subsequent unrelated send must NOT carry the supersede link.
    act(() => {
      submitViaComposer("unrelated new message");
    });
    const [, , context] = stubSessionPageFlow.handleSubmit.mock.calls[0];
    expect(context).not.toHaveProperty("supersedesExecutionId");
  });

  it("ordinary sends pass the composer context through untouched", () => {
    render(<SessionViewer sessionId="ses_1" org="acme" />);

    act(() => {
      submitViaComposer("plain message");
    });

    const [message, , context] =
      stubSessionPageFlow.handleSubmit.mock.calls[0];
    expect(message).toBe("plain message");
    expect(context).toEqual({ interactionMode: "agent" });
  });
});
