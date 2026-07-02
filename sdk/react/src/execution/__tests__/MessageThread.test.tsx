import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import {
  AgentExecutionSchema,
  AgentExecutionStatusSchema,
  type AgentExecution,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  AgentExecutionSpecSchema,
  ExecutionConfigSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/spec_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import {
  AgentMessageSchema,
  ToolCallSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { PendingApprovalSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/approval_pb";
import { TodoItemSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/todo_pb";
import { FileContentSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import {
  CapturedFileChangeSchema,
  FileChangeSetSchema,
  FileReviewBaselineCapturedSchema,
  FileReviewCandidateCapturedSchema,
  FileReviewEventSchema,
  FileReviewEventStreamSchema,
  FileReviewReconciledSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/filereview_pb";
import {
  DiffCompleteness,
  ExecutionPhase,
  FileChangeKind,
  FileChangeSetStatus,
  FileDecisionAction,
  FileReviewEventType,
  InteractionMode,
  MessageType,
  TodoStatus,
  ToolCallStatus,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

// FileReviewCard renders FileChangeDiff, which transitively pulls the
// offload-resolving content hook. Mock it so the diff path renders without an
// artifact-fetch context — this suite only exercises the file-review prop seam.
vi.mock("../useFileChangeContent", () => ({
  useFileChangeContent: () => ({
    beforeText: "old\n",
    afterText: "new\n",
    isBinary: false,
    isLoading: false,
    error: null,
    isTruncated: false,
    downloadUrl: null,
  }),
}));

import { MessageThread } from "../MessageThread";

// ---------------------------------------------------------------------------
// DOM stubs — useAutoScroll depends on browser APIs not available in happy-dom
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.stubGlobal(
    "IntersectionObserver",
    vi.fn(() => ({
      observe: vi.fn(),
      unobserve: vi.fn(),
      disconnect: vi.fn(),
      takeRecords: vi.fn(() => []),
      root: null,
      rootMargin: "",
      thresholds: [0],
    })),
  );

  vi.stubGlobal(
    "ResizeObserver",
    vi.fn(() => ({
      observe: vi.fn(),
      unobserve: vi.fn(),
      disconnect: vi.fn(),
    })),
  );

  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((cb: FrameRequestCallback) => {
      cb(performance.now());
      return 1;
    }),
  );

  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeExecution(opts: {
  id: string;
  specMessage?: string;
  phase?: ExecutionPhase;
  interactionMode?: InteractionMode;
  aiContent?: string;
  error?: string;
}): AgentExecution {
  const exec = create(AgentExecutionSchema);

  const meta = create(ApiResourceMetadataSchema);
  meta.id = opts.id;
  exec.metadata = meta;

  const spec = create(AgentExecutionSpecSchema);
  spec.message = opts.specMessage ?? "Hello";
  if (opts.interactionMode !== undefined) {
    const config = create(ExecutionConfigSchema);
    config.interactionMode = opts.interactionMode;
    spec.executionConfig = config;
  }
  exec.spec = spec;

  const status = create(AgentExecutionStatusSchema);
  status.phase = opts.phase ?? ExecutionPhase.EXECUTION_COMPLETED;
  if (opts.error !== undefined) {
    status.error = opts.error;
  }

  const humanMsg = create(AgentMessageSchema);
  humanMsg.type = MessageType.MESSAGE_HUMAN;
  humanMsg.content = opts.specMessage ?? "Hello";

  const aiMsg = create(AgentMessageSchema);
  aiMsg.type = MessageType.MESSAGE_AI;
  aiMsg.content = opts.aiContent ?? "Hi there!";

  status.messages = [humanMsg, aiMsg];
  exec.status = status;

  return exec;
}

function makeExecutionWithApproval(
  id: string,
  toolCallId: string,
  toolName: string,
): AgentExecution {
  const exec = create(AgentExecutionSchema);

  const meta = create(ApiResourceMetadataSchema);
  meta.id = id;
  exec.metadata = meta;

  const spec = create(AgentExecutionSpecSchema);
  spec.message = "Do something";
  exec.spec = spec;

  const status = create(AgentExecutionStatusSchema);
  status.phase = ExecutionPhase.EXECUTION_IN_PROGRESS;

  const aiMsg = create(AgentMessageSchema);
  aiMsg.type = MessageType.MESSAGE_AI;
  aiMsg.content = "I need to run a tool.";
  status.messages = [aiMsg];

  status.pendingApprovals = [
    create(PendingApprovalSchema, { toolCallId, toolName }),
  ];
  exec.status = status;

  return exec;
}

/**
 * An active execution whose AI turn carries a gated tool call, with a matching
 * pending approval — the case that should render the gate INLINE on the tool
 * row rather than as a detached bottom card.
 */
function makeExecutionWithInlineApproval(
  id: string,
  toolCallId: string,
  toolName: string,
): AgentExecution {
  const exec = create(AgentExecutionSchema);
  exec.metadata = create(ApiResourceMetadataSchema, { id });
  exec.spec = create(AgentExecutionSpecSchema, { message: "Do something" });

  const status = create(AgentExecutionStatusSchema);
  status.phase = ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL;

  const aiMsg = create(AgentMessageSchema, {
    type: MessageType.MESSAGE_AI,
    content: "",
    toolCalls: [
      create(ToolCallSchema, {
        id: toolCallId,
        name: toolName,
        status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
      }),
    ],
  });
  status.messages = [aiMsg];
  status.pendingApprovals = [
    create(PendingApprovalSchema, {
      toolCallId,
      toolName,
      argsPreview: '{"path":"/tmp/x"}',
    }),
  ];
  exec.status = status;
  return exec;
}

/**
 * An active execution carrying one single-file change set AWAITING_REVIEW — the
 * input that makes {@link MessageThread} render a {@link FileReviewCard}.
 */
function makeExecutionWithFileReview(id: string, setId: string): AgentExecution {
  const exec = create(AgentExecutionSchema);
  exec.metadata = create(ApiResourceMetadataSchema, { id });
  exec.spec = create(AgentExecutionSpecSchema, { message: "Edit a file" });

  const status = create(AgentExecutionStatusSchema);
  status.phase = ExecutionPhase.EXECUTION_IN_PROGRESS;
  status.messages = [
    create(AgentMessageSchema, { type: MessageType.MESSAGE_AI, content: "Done." }),
  ];
  status.fileChangeSets = [
    create(FileChangeSetSchema, {
      id: setId,
      status: FileChangeSetStatus.AWAITING_REVIEW,
      aggregateDigest: "agg-1",
      diffCompleteness: DiffCompleteness.COMPLETE,
      changes: [
        create(CapturedFileChangeSchema, {
          id: `${setId}:src/a.ts`,
          pathBefore: "src/a.ts",
          pathAfter: "src/a.ts",
          kind: FileChangeKind.MODIFY,
          before: create(FileContentSchema, { body: { case: "inline", value: "old\n" } }),
          after: create(FileContentSchema, { body: { case: "inline", value: "new\n" } }),
          fileDigest: "d-a",
          diffComplete: true,
        }),
      ],
    }),
  ];
  exec.status = status;
  return exec;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("MessageThread", () => {
  it("threads a fileDecisionErrors entry through to the rendered FileReviewCard", () => {
    const setId = "aex-1:0";
    const exec = makeExecutionWithFileReview("exec-fr", setId);
    const decisionErrors = new Map([[setId, new Error("digest mismatch")]]);

    render(
      <MessageThread
        executions={[]}
        activeStreamExecution={exec}
        onFileDecisionSubmit={() => {}}
        fileDecisionErrors={decisionErrors}
      />,
    );

    // The whole-set failure reaches the card and surfaces in-card.
    const err = screen.getByText(/Couldn.t submit decision — digest mismatch/);
    expect(err.getAttribute("data-cursor-target")).toBe("file-review-error");
  });

  it("renders an interactive review card for an AWAITING set on a live execution", () => {
    const exec = makeExecutionWithFileReview("exec-live", "cs-live:0");
    render(
      <MessageThread
        executions={[]}
        activeStreamExecution={exec}
        onFileDecisionSubmit={() => {}}
      />,
    );
    expect(screen.getByText("Review file changes")).toBeTruthy();
    expect(
      document.querySelector('[data-cursor-target="file-review-approve"]'),
    ).toBeTruthy();
    expect(
      document.querySelector('[data-cursor-target="file-review-reject"]'),
    ).toBeTruthy();
  });

  it("renders a settled set read-only (no decision controls)", () => {
    const exec = makeExecutionWithFileReview("exec-settled", "cs-settled:0");
    // A decided/reconciled set: history, not an action.
    exec.status!.fileChangeSets[0].status = FileChangeSetStatus.RECONCILED;

    render(
      <MessageThread
        executions={[exec]}
        onFileDecisionSubmit={() => {}}
      />,
    );
    expect(screen.getByText("File changes")).toBeTruthy();
    expect(screen.queryByText("Review file changes")).toBeNull();
    expect(
      document.querySelector('[data-cursor-target="file-review-approve"]'),
    ).toBeNull();
    expect(
      document.querySelector('[data-cursor-target="file-review-reject"]'),
    ).toBeNull();
  });

  it("folds the ledger and renders read-only for a terminal execution (empty projection)", () => {
    // A terminal execution: the server projects no actionable file_change_sets,
    // so MessageThread must fold the durable ledger to show what changed.
    const exec = create(AgentExecutionSchema);
    exec.metadata = create(ApiResourceMetadataSchema, { id: "exec-terminal" });
    exec.spec = create(AgentExecutionSpecSchema, { message: "Edit a file" });
    const status = create(AgentExecutionStatusSchema);
    status.phase = ExecutionPhase.EXECUTION_COMPLETED;
    status.messages = [
      create(AgentMessageSchema, { type: MessageType.MESSAGE_AI, content: "Done." }),
    ];
    status.fileChangeSets = []; // terminal: server projects nil
    const changeSetId = "cs-term:0";
    status.fileReviewEventStream = create(FileReviewEventStreamSchema, {
      executionId: "exec-terminal",
      events: [
        create(FileReviewEventSchema, {
          changeSetId,
          eventType: FileReviewEventType.BASELINE_CAPTURED,
          payload: {
            case: "baselineCaptured",
            value: create(FileReviewBaselineCapturedSchema, {
              changeSetId,
              turnId: "t1",
              harnessId: "deep-agent",
            }),
          },
        }),
        create(FileReviewEventSchema, {
          changeSetId,
          eventType: FileReviewEventType.CANDIDATE_CAPTURED,
          payload: {
            case: "candidateCaptured",
            value: create(FileReviewCandidateCapturedSchema, {
              changeSetId,
              aggregateDigest: "agg-1",
              changes: [
                create(CapturedFileChangeSchema, {
                  id: `${changeSetId}:src/a.ts`,
                  pathBefore: "src/a.ts",
                  pathAfter: "src/a.ts",
                  kind: FileChangeKind.MODIFY,
                  before: create(FileContentSchema, { body: { case: "inline", value: "old\n" } }),
                  after: create(FileContentSchema, { body: { case: "inline", value: "new\n" } }),
                  fileDigest: "d-a",
                  diffComplete: true,
                }),
              ],
            }),
          },
        }),
        create(FileReviewEventSchema, {
          changeSetId,
          eventType: FileReviewEventType.RECONCILED,
          payload: {
            case: "reconciled",
            value: create(FileReviewReconciledSchema, { changeSetId }),
          },
        }),
      ],
    });
    exec.status = status;

    render(
      <MessageThread executions={[exec]} onFileDecisionSubmit={() => {}} />,
    );
    // The read-only bar renders with no decision controls; expanding it shows
    // the folded set's changed file.
    expect(screen.getByText("File changes")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    expect(screen.getByTitle("src/a.ts")).toBeTruthy();
    expect(
      document.querySelector('[data-cursor-target="file-review-approve"]'),
    ).toBeNull();
  });

  it("threads an approvalErrors entry to an inline gate (the primary route)", () => {
    const exec = makeExecutionWithInlineApproval("exec-ia", "tc-1", "delete_file");
    const approvalErrors = new Map([["tc-1", new Error("gate already resolved")]]);

    const { container } = render(
      <MessageThread
        executions={[]}
        activeStreamExecution={exec}
        onApprovalSubmit={() => {}}
        approvalErrors={approvalErrors}
      />,
    );

    const alert = container.querySelector('[data-cursor-target="approval-error"]');
    expect(alert).toBeTruthy();
    expect(alert!.textContent).toContain("gate already resolved");
  });

  it("threads an approvalErrors entry to a bottom backstop card (orphan approval)", () => {
    // An approval whose tool call has no inline row renders as the bottom
    // backstop ApprovalCard; the keyed error must reach it too.
    const exec = create(AgentExecutionSchema);
    exec.metadata = create(ApiResourceMetadataSchema, { id: "exec-orphan" });
    exec.spec = create(AgentExecutionSpecSchema, { message: "Do something" });
    const status = create(AgentExecutionStatusSchema);
    status.phase = ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL;
    status.messages = [];
    status.pendingApprovals = [
      create(PendingApprovalSchema, {
        toolCallId: "tc-orphan",
        toolName: "delete_file",
        argsPreview: '{"path":"/tmp/x"}',
      }),
    ];
    exec.status = status;

    const approvalErrors = new Map([["tc-orphan", new Error("network down")]]);

    const { container } = render(
      <MessageThread
        executions={[]}
        activeStreamExecution={exec}
        onApprovalSubmit={() => {}}
        approvalErrors={approvalErrors}
      />,
    );

    const alert = container.querySelector('[data-cursor-target="approval-error"]');
    expect(alert).toBeTruthy();
    expect(alert!.textContent).toContain("network down");
  });

  it("renders role=log container when executions array is empty", () => {
    render(<MessageThread executions={[]} />);

    const log = screen.getByRole("log");
    expect(log).toBeTruthy();
    expect(log.getAttribute("aria-live")).toBe("polite");
  });

  it("renders human and AI messages from completed execution", () => {
    const exec = makeExecution({
      id: "exec-1",
      specMessage: "What is Stigmer?",
      aiContent: "Stigmer is a platform for platforms.",
    });

    render(<MessageThread executions={[exec]} />);

    // spec.message renders as a synthetic human bubble, plus it may
    // also appear in status.messages — assert at least one is present.
    const humanMessages = screen.getAllByText("What is Stigmer?");
    expect(humanMessages.length).toBeGreaterThanOrEqual(1);
    expect(
      screen.getByText("Stigmer is a platform for platforms."),
    ).toBeTruthy();
  });

  it("renders the agent's todos as an inline card in the thread", () => {
    const exec = makeExecution({
      id: "exec-todos",
      specMessage: "Build the feature",
      aiContent: "Here is my plan",
    });
    // Attach a live plan to the execution status (as the runner would).
    exec.status!.todos = {
      t1: create(TodoItemSchema, {
        id: "t1",
        content: "Scaffold the component",
        status: TodoStatus.TODO_IN_PROGRESS,
      }),
      t2: create(TodoItemSchema, {
        id: "t2",
        content: "Wire the thread",
        status: TodoStatus.TODO_PENDING,
      }),
    };

    render(<MessageThread executions={[exec]} />);

    const region = screen.getByRole("region", { name: "Agent to-dos" });
    expect(region).toBeTruthy();
    // Active plan → expanded → tasks visible inline.
    expect(region.textContent).toContain("Scaffold the component");
    expect(region.textContent).toContain("0/2 completed");
  });

  it("renders pending user message with opacity indicator", () => {
    render(
      <MessageThread
        executions={[]}
        pendingUserMessage="I am thinking..."
      />,
    );

    const pendingText = screen.getByText("I am thinking...");
    expect(pendingText).toBeTruthy();

    const article = pendingText.closest("[role='article']");
    expect(article?.className).toContain("opacity-70");
  });

  it("renders approval card when onApprovalSubmit is provided and execution has pending approvals", () => {
    const exec = makeExecutionWithApproval("exec-a", "tc-1", "write_file");
    const onApproval = vi.fn();

    render(
      <MessageThread
        executions={[]}
        activeStreamExecution={exec}
        onApprovalSubmit={onApproval}
      />,
    );

    const alert = screen.getByRole("alert");
    expect(alert).toBeTruthy();
    expect(alert.getAttribute("aria-label")).toContain("write_file");
  });

  it("does NOT render approval cards when onApprovalSubmit is omitted", () => {
    const exec = makeExecutionWithApproval("exec-b", "tc-2", "shell");

    render(
      <MessageThread executions={[]} activeStreamExecution={exec} />,
    );

    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("onApprovalSubmit fires with correct toolCallId and action", () => {
    const exec = makeExecutionWithApproval("exec-c", "tc-approve", "read_file");
    const onApproval = vi.fn();

    render(
      <MessageThread
        executions={[]}
        activeStreamExecution={exec}
        onApprovalSubmit={onApproval}
      />,
    );

    const approveBtn = screen.getByRole("button", { name: "Approve" });
    fireEvent.click(approveBtn);

    expect(onApproval).toHaveBeenCalledOnce();
    expect(onApproval).toHaveBeenCalledWith(
      "tc-approve",
      expect.any(Number),
      undefined,
    );
    // First arg is toolCallId, second is ApprovalAction.APPROVE (enum value)
    expect(onApproval.mock.calls[0][0]).toBe("tc-approve");
  });

  it("renders a matching approval INLINE on its tool row, not as a bottom card, and routes the decision", () => {
    const exec = makeExecutionWithInlineApproval("exec-inline", "tc-inline", "delete_file");
    const onApproval = vi.fn();

    render(
      <MessageThread
        executions={[]}
        activeStreamExecution={exec}
        onApprovalSubmit={onApproval}
      />,
    );

    // No detached bottom card (role=alert is the standalone ApprovalCard only).
    expect(screen.queryByRole("alert")).toBeNull();

    // The gate's actions are present inline, and approving routes the decision
    // with the gated tool's id.
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(onApproval).toHaveBeenCalledOnce();
    expect(onApproval.mock.calls[0][0]).toBe("tc-inline");
  });

  it("renders ExecutionPhaseBadge for non-completed terminal phase", () => {
    const exec = makeExecution({
      id: "exec-fail",
      phase: ExecutionPhase.EXECUTION_FAILED,
    });

    render(<MessageThread executions={[exec]} />);

    expect(screen.getByText(/failed/i)).toBeTruthy();
  });

  it("surfaces the server failure reason for a FAILED execution", () => {
    const exec = makeExecution({
      id: "exec-fail-reason",
      phase: ExecutionPhase.EXECUTION_FAILED,
      error: "Activity task timed out (RETRY_STATE_MAXIMUM_ATTEMPTS_REACHED)",
    });

    render(<MessageThread executions={[exec]} />);

    expect(
      screen.getByText(/Activity task timed out/i),
    ).toBeTruthy();
  });

  it("does NOT surface a failure reason for a COMPLETED execution", () => {
    const exec = makeExecution({
      id: "exec-ok",
      phase: ExecutionPhase.EXECUTION_COMPLETED,
      error: "stale error that should be ignored",
    });

    render(<MessageThread executions={[exec]} />);

    expect(screen.queryByText(/stale error/i)).toBeNull();
  });

  it("offers a Retry that resends the originating message on failure", () => {
    const exec = makeExecution({
      id: "exec-retry",
      specMessage: "do the thing",
      phase: ExecutionPhase.EXECUTION_FAILED,
      error: "boom",
    });
    const onRetryExecution = vi.fn();

    render(
      <MessageThread executions={[exec]} onRetryExecution={onRetryExecution} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetryExecution).toHaveBeenCalledWith("do the thing");
  });

  it("renders a failed pending message with an inline Retry", () => {
    const onRetrySend = vi.fn();

    render(
      <MessageThread
        executions={[]}
        pendingUserMessage="unsent message"
        pendingMessageFailed
        onRetrySend={onRetrySend}
      />,
    );

    expect(screen.getByText("unsent message")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetrySend).toHaveBeenCalledOnce();
  });

  it("shows an Edit affordance on the in-flight human turn and routes onEditMessage", () => {
    const active = makeExecution({
      id: "exec-active",
      specMessage: "fix the bug",
      phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
      aiContent: "working on it",
    });
    const onEditMessage = vi.fn();

    render(
      <MessageThread
        executions={[]}
        activeStreamExecution={active}
        onEditMessage={onEditMessage}
      />,
    );

    const editBtn = screen.getByRole("button", { name: "Edit message" });
    fireEvent.click(editBtn);
    expect(onEditMessage).toHaveBeenCalledWith("fix the bug");
  });

  it("shows no Edit affordance when onEditMessage is omitted", () => {
    const active = makeExecution({
      id: "exec-active",
      specMessage: "fix the bug",
      phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
    });

    render(
      <MessageThread executions={[]} activeStreamExecution={active} />,
    );

    expect(
      screen.queryByRole("button", { name: "Edit message" }),
    ).toBeNull();
  });

  it("marks only the active-stream human turn editable, not completed turns", () => {
    const completed = makeExecution({
      id: "exec-done",
      specMessage: "old turn",
      phase: ExecutionPhase.EXECUTION_COMPLETED,
    });
    const active = makeExecution({
      id: "exec-active",
      specMessage: "new turn",
      phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
    });
    const onEditMessage = vi.fn();

    render(
      <MessageThread
        executions={[completed]}
        activeStreamExecution={active}
        onEditMessage={onEditMessage}
      />,
    );

    const editBtns = screen.getAllByRole("button", { name: "Edit message" });
    expect(editBtns).toHaveLength(1);

    fireEvent.click(editBtns[0]);
    expect(onEditMessage).toHaveBeenCalledWith("new turn");
  });

  // Issue #179: while a turn streams, the synthetic "Thinking…" setup
  // placeholder must yield the moment real content (streamed reasoning or a tool
  // call) arrives — otherwise it renders *alongside* the real cards.
  describe("streaming trace replaces the synthetic placeholder (issue #179)", () => {
    function makeStreamingExecution(
      messages: ReturnType<typeof create<typeof AgentMessageSchema>>[],
    ): AgentExecution {
      const exec = create(AgentExecutionSchema);
      const meta = create(ApiResourceMetadataSchema);
      meta.id = "exec-streaming";
      exec.metadata = meta;
      const spec = create(AgentExecutionSpecSchema);
      spec.message = "Do the thing";
      exec.spec = spec;
      const status = create(AgentExecutionStatusSchema);
      status.phase = ExecutionPhase.EXECUTION_IN_PROGRESS;
      status.messages = messages;
      exec.status = status;
      return exec;
    }

    function humanMessage(text: string) {
      const m = create(AgentMessageSchema);
      m.type = MessageType.MESSAGE_HUMAN;
      m.content = text;
      return m;
    }

    function thinkingMessage(text: string) {
      const m = create(AgentMessageSchema);
      m.type = MessageType.MESSAGE_THINKING;
      m.content = text;
      m.isStreaming = true;
      return m;
    }

    it("streamed reasoning (no AI text yet) hides the synthetic 'Thinking…' placeholder", () => {
      const active = makeStreamingExecution([
        humanMessage("Do the thing"),
        thinkingMessage("Let me reason about the request"),
      ]);

      render(<MessageThread executions={[]} activeStreamExecution={active} />);

      // The real reasoning card is shown...
      expect(
        screen.getByRole("article", { name: "Model thinking" }),
      ).toBeTruthy();
      // ...and the synthetic placeholder (ellipsis "Thinking…") is gone. Before
      // the fix, hasAiMessages ignored MESSAGE_THINKING and both rendered.
      expect(screen.queryByText("Thinking\u2026")).toBeNull();
    });

    it("renders thinking + a running tool call mid-turn without the placeholder", () => {
      const aiWithTool = create(AgentMessageSchema);
      aiWithTool.type = MessageType.MESSAGE_AI;
      aiWithTool.content = "";
      aiWithTool.toolCalls = [
        create(ToolCallSchema, {
          id: "tc-1",
          name: "read",
          status: ToolCallStatus.TOOL_CALL_RUNNING,
        }),
      ];

      const active = makeStreamingExecution([
        humanMessage("Do the thing"),
        thinkingMessage("Planning the edit"),
        aiWithTool,
      ]);

      render(<MessageThread executions={[]} activeStreamExecution={active} />);

      expect(
        screen.getByRole("article", { name: "Model thinking" }),
      ).toBeTruthy();
      expect(screen.queryByText("Thinking\u2026")).toBeNull();
    });
  });

  it("renders plan-completion card when last execution is completed Plan mode", () => {
    const exec = makeExecution({
      id: "exec-plan",
      phase: ExecutionPhase.EXECUTION_COMPLETED,
      interactionMode: InteractionMode.PLAN,
    });

    const onBuildFromPlan = vi.fn();

    render(
      <MessageThread
        executions={[exec]}
        onBuildFromPlan={onBuildFromPlan}
      />,
    );

    const buildBtn = screen.getByRole("button", { name: /build from plan/i });
    expect(buildBtn).toBeTruthy();

    fireEvent.click(buildBtn);
    expect(onBuildFromPlan).toHaveBeenCalledOnce();
  });
});
