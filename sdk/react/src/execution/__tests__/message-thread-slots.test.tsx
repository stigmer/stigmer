import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import React, { memo } from "react";
import { create } from "@bufbuild/protobuf";
import {
  AgentExecutionSchema,
  AgentExecutionStatusSchema,
  RecalledMemoriesReportSchema,
  type AgentExecution,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  AgentExecutionSpecSchema,
  ExecutionConfigSchema,
  RecalledMemoriesSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/spec_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import { AgentMessageSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { PendingApprovalSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/approval_pb";
import { TodoItemSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/todo_pb";
import { ExecutionArtifactSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/artifact_pb";
import {
  ApprovalAction,
  ExecutionArtifactKind,
  ExecutionPhase,
  InteractionMode,
  MessageType,
  TodoStatus,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

import { MessageThread, type MessageThreadSlots } from "../MessageThread";
import type { MessageEntryProps } from "../MessageEntry";
import type { ApprovalCardProps } from "../ApprovalCard";
import type { ExecutionErrorNoticeProps } from "../ExecutionErrorNotice";
import type { TodoCardProps } from "../TodoCard";
import type { TodoRowProps } from "../TodoList";
import type { SetupProgressProps } from "../SetupProgress";
import type { RecalledMemoriesCardProps } from "../RecalledMemoriesCard";
import type { LivenessStatusLineProps } from "../LivenessStatusLine";
import type { PlanCompletionCardProps } from "../PlanCompletionCard";
import type { PlanArtifactCardProps } from "../PlanArtifactCard";
import type { PlanStreamingCardProps } from "../PlanStreamingCard";

// ---------------------------------------------------------------------------
// Mock react-virtuoso (same pattern as virtualized-thread.test.tsx) so the
// virtualized path renders its items synchronously in happy-dom.
// ---------------------------------------------------------------------------

vi.mock("react-virtuoso", () => ({
  Virtuoso: React.forwardRef(function MockVirtuoso(
    props: Record<string, unknown>,
    ref: React.Ref<unknown>,
  ) {
    const data = props.data as { key: string }[];
    const itemContent = props.itemContent as (
      index: number,
      item: unknown,
    ) => React.ReactNode;
    React.useImperativeHandle(ref, () => ({ scrollToIndex: vi.fn() }));
    return (
      <div data-testid="virtuoso-scroller">
        {data.map((item, i) => (
          <div key={item.key}>{itemContent(i, item)}</div>
        ))}
      </div>
    );
  }),
}));

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
    vi.fn(() => ({ observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() })),
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
// Fixtures
// ---------------------------------------------------------------------------

function makeExecution(opts: {
  id: string;
  specMessage?: string;
  phase?: ExecutionPhase;
  interactionMode?: InteractionMode;
  aiContent?: string;
  todos?: Record<string, { content: string; status: TodoStatus }>;
  pendingApprovalToolCallId?: string;
  planArtifactName?: string;
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
  if (opts.error) {
    status.error = opts.error;
  }

  const aiMsg = create(AgentMessageSchema);
  aiMsg.type = MessageType.MESSAGE_AI;
  aiMsg.content = opts.aiContent ?? "Hi there!";
  status.messages = [aiMsg];

  if (opts.todos) {
    for (const [id, todo] of Object.entries(opts.todos)) {
      status.todos[id] = create(TodoItemSchema, {
        id,
        content: todo.content,
        status: todo.status,
      });
    }
  }

  if (opts.pendingApprovalToolCallId) {
    status.pendingApprovals = [
      create(PendingApprovalSchema, {
        toolCallId: opts.pendingApprovalToolCallId,
        toolName: "shell_exec",
        argsPreview: "{}",
      }),
    ];
  }

  if (opts.planArtifactName) {
    status.artifacts = [
      create(ExecutionArtifactSchema, {
        name: opts.planArtifactName,
        kind: ExecutionArtifactKind.FILE,
      }),
    ];
  }

  exec.status = status;
  return exec;
}

// ---------------------------------------------------------------------------
// Slot overrides — each slot renders in place of its built-in
// ---------------------------------------------------------------------------

describe("MessageThread slots", () => {
  it("renders the MessageEntry slot for every message, including the failed-send bubble", () => {
    const CustomEntry = ({ message }: MessageEntryProps) => (
      <div data-testid="custom-entry">{message.content}</div>
    );
    const slots: MessageThreadSlots = { MessageEntry: CustomEntry };

    render(
      <MessageThread
        executions={[makeExecution({ id: "e1", specMessage: "prompt text" })]}
        pendingUserMessage="failed follow-up"
        pendingMessageFailed
        onRetrySend={vi.fn()}
        slots={slots}
      />,
    );

    const entries = screen.getAllByTestId("custom-entry");
    // Synthesized human bubble + AI message + the failed pending bubble.
    expect(entries.length).toBe(3);
    expect(entries.map((e) => e.textContent)).toContain("failed follow-up");
    // The built-in bubble chrome must not render.
    expect(screen.queryByRole("article", { name: "User message" })).toBeNull();
    // The failed-send Retry affordance stays built-in around the slot.
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("renders the ApprovalCard slot with the row's stabilized onSubmit wiring intact", () => {
    const onApprovalSubmit = vi.fn();
    const CustomApproval = ({ pendingApproval, onSubmit }: ApprovalCardProps) => (
      <button
        type="button"
        data-testid="custom-approval"
        onClick={() => onSubmit(ApprovalAction.APPROVE)}
      >
        approve {pendingApproval.toolName}
      </button>
    );

    render(
      <MessageThread
        executions={[
          makeExecution({
            id: "e1",
            phase: ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL,
            pendingApprovalToolCallId: "tc-1",
          }),
        ]}
        onApprovalSubmit={onApprovalSubmit}
        slots={{ ApprovalCard: CustomApproval }}
      />,
    );

    fireEvent.click(screen.getByTestId("custom-approval"));
    // The memoized ApprovalCardRow still injects the toolCallId — the slot's
    // onSubmit contract is identical to the built-in's.
    expect(onApprovalSubmit).toHaveBeenCalledWith(
      "tc-1",
      ApprovalAction.APPROVE,
      undefined,
    );
  });

  it("renders the TodoCard slot with the TodoRow slot forwarded through its props", () => {
    const forwarded: Array<TodoRowProps["item"]["content"]> = [];
    const CustomRow = ({ item }: TodoRowProps) => {
      forwarded.push(item.content);
      return <li data-testid="custom-row">{item.content}</li>;
    };
    const CustomCard = ({ todos, TodoRow }: TodoCardProps) => (
      <div data-testid="custom-todo-card">
        <ul>
          {Object.values(todos).map((item) =>
            TodoRow ? <TodoRow key={item.id} item={item} /> : null,
          )}
        </ul>
      </div>
    );

    render(
      <MessageThread
        executions={[
          makeExecution({
            id: "e1",
            todos: { t1: { content: "write tests", status: TodoStatus.TODO_IN_PROGRESS } },
          }),
        ]}
        slots={{ TodoCard: CustomCard, TodoRow: CustomRow }}
      />,
    );

    expect(screen.getByTestId("custom-todo-card")).toBeTruthy();
    expect(forwarded).toEqual(["write tests"]);
  });

  it("renders the TodoRow slot inside the built-in TodoCard when only TodoRow is overridden", () => {
    const CustomRow = ({ item }: TodoRowProps) => (
      <li data-testid="custom-row">ROW: {item.content}</li>
    );

    render(
      <MessageThread
        executions={[
          makeExecution({
            id: "e1",
            todos: { t1: { content: "write tests", status: TodoStatus.TODO_IN_PROGRESS } },
          }),
        ]}
        slots={{ TodoRow: CustomRow }}
      />,
    );

    // The built-in card chrome (region + disclosure) hosts the custom row —
    // auto-disclosure opens the card because an item is in progress.
    expect(screen.getByRole("region", { name: "Agent to-dos" })).toBeTruthy();
    expect(screen.getByTestId("custom-row").textContent).toBe("ROW: write tests");
  });

  it("renders the SetupProgress slot for the pre-first-token window", () => {
    const CustomSetup = ({ isAwaitingResponse }: SetupProgressProps) => (
      <div data-testid="custom-setup">{isAwaitingResponse ? "waiting" : "setup"}</div>
    );

    const exec = makeExecution({
      id: "e-live",
      phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
    });
    // No renderable response yet: the setup-progress item is emitted.
    exec.status!.messages = [];

    render(
      <MessageThread
        executions={[]}
        activeStreamExecution={exec}
        slots={{ SetupProgress: CustomSetup }}
      />,
    );

    expect(screen.getByTestId("custom-setup").textContent).toBe("waiting");
  });

  it("renders the RecalledMemoriesCard slot for a selection-active execution", () => {
    const CustomRecalled = ({ report, facts }: RecalledMemoriesCardProps) => (
      <div data-testid="custom-recalled">
        {report.injectedMemoryIds.length} of {facts.length}
      </div>
    );

    const exec = makeExecution({ id: "e1" });
    exec.spec!.recalledMemories = create(RecalledMemoriesSchema, {
      enabled: true,
      facts: [
        { memoryId: "mem_a", content: "Prefers concise answers." },
        { memoryId: "mem_b", content: "Deploys with Bazel." },
      ],
    });
    exec.status!.recalledMemoriesReport = create(RecalledMemoriesReportSchema, {
      selectionActive: true,
      injectedMemoryIds: ["mem_a"],
      embeddingModel: "text-embedding-3-small",
    });

    render(
      <MessageThread
        executions={[exec]}
        slots={{ RecalledMemoriesCard: CustomRecalled }}
      />,
    );

    expect(screen.getByTestId("custom-recalled").textContent).toBe("1 of 2");
    // The built-in card must not render alongside the override.
    expect(screen.queryByRole("status", { name: /Recalled/ })).toBeNull();
  });

  it("renders the LivenessStatusLine slot while the execution is live between events", () => {
    const CustomLiveness = ({ label }: LivenessStatusLineProps) => (
      <div data-testid="custom-liveness">{label ?? "custom-live"}</div>
    );

    const exec = makeExecution({
      id: "e-live",
      phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
      aiContent: "thinking about it",
    });

    render(
      <MessageThread
        executions={[]}
        activeStreamExecution={exec}
        slots={{ LivenessStatusLine: CustomLiveness }}
      />,
    );

    expect(screen.getByTestId("custom-liveness").textContent).toBe("custom-live");
  });

  it("renders the PlanCompletionCard slot for an artifact-less completed Plan turn", () => {
    const CustomCompletion = ({ onImplement }: PlanCompletionCardProps) => (
      <button type="button" data-testid="custom-completion" onClick={onImplement}>
        custom build
      </button>
    );
    const onBuildFromPlan = vi.fn();

    render(
      <MessageThread
        executions={[
          makeExecution({
            id: "e-plan",
            phase: ExecutionPhase.EXECUTION_COMPLETED,
            interactionMode: InteractionMode.PLAN,
          }),
        ]}
        onBuildFromPlan={onBuildFromPlan}
        slots={{ PlanCompletionCard: CustomCompletion }}
      />,
    );

    fireEvent.click(screen.getByTestId("custom-completion"));
    expect(onBuildFromPlan).toHaveBeenCalledOnce();
  });

  it("renders the PlanArtifactCard slot for a completed Plan turn with a published artifact", () => {
    const CustomArtifact = ({ artifact, title }: PlanArtifactCardProps) => (
      <div data-testid="custom-artifact">
        {title ?? "Plan"}: {artifact.name}
      </div>
    );

    render(
      <MessageThread
        executions={[
          makeExecution({
            id: "e-plan",
            phase: ExecutionPhase.EXECUTION_COMPLETED,
            interactionMode: InteractionMode.PLAN,
            aiContent: "# Rollout Plan\n\n1. First step",
            planArtifactName: "rollout_abc123.plan.md",
          }),
        ]}
        onBuildFromPlan={vi.fn()}
        slots={{ PlanArtifactCard: CustomArtifact }}
      />,
    );

    expect(screen.getByTestId("custom-artifact").textContent).toBe(
      "Rollout Plan: rollout_abc123.plan.md",
    );
  });

  it("renders the PlanStreamingCard slot while a plan is being written", () => {
    const CustomStreaming = ({ title }: PlanStreamingCardProps) => (
      <div data-testid="custom-streaming">writing: {title}</div>
    );

    render(
      <MessageThread
        executions={[]}
        activeStreamExecution={makeExecution({
          id: "e-live",
          phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
          interactionMode: InteractionMode.PLAN,
          aiContent: "# Rollout Plan\n\n1. First step",
        })}
        onOpenPlan={vi.fn()}
        slots={{ PlanStreamingCard: CustomStreaming }}
      />,
    );

    expect(screen.getByTestId("custom-streaming").textContent).toBe(
      "writing: Rollout Plan",
    );
  });

  it("renders the ExecutionErrorNotice slot with the retry wiring intact", () => {
    const onRetryExecution = vi.fn();
    const CustomNotice = ({ error, retryMessage, onRetry }: ExecutionErrorNoticeProps) => (
      <div data-testid="custom-error-notice">
        <span>{error}</span>
        {onRetry && retryMessage && (
          <button type="button" onClick={() => onRetry(retryMessage)}>
            switch engine and retry
          </button>
        )}
      </div>
    );

    render(
      <MessageThread
        executions={[
          makeExecution({
            id: "e-failed",
            specMessage: "prompt text",
            phase: ExecutionPhase.EXECUTION_FAILED,
            error: "model capacity exhausted",
          }),
        ]}
        onRetryExecution={onRetryExecution}
        slots={{ ExecutionErrorNotice: CustomNotice }}
      />,
    );

    const notice = screen.getByTestId("custom-error-notice");
    expect(notice.textContent).toContain("model capacity exhausted");
    // The built-in's clamp toggle must not render alongside the override.
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();

    // The slot's retry contract is identical to the built-in's: it resends
    // the originating message.
    fireEvent.click(screen.getByRole("button", { name: "switch engine and retry" }));
    expect(onRetryExecution).toHaveBeenCalledWith("prompt text");
  });

  it("falls back to the built-in ExecutionErrorNotice when the slot is omitted", () => {
    const onRetryExecution = vi.fn();

    render(
      <MessageThread
        executions={[
          makeExecution({
            id: "e-failed",
            specMessage: "prompt text",
            phase: ExecutionPhase.EXECUTION_FAILED,
            error: "model capacity exhausted",
          }),
        ]}
        onRetryExecution={onRetryExecution}
      />,
    );

    // The built-in renders as a destructive alert with clamp + Retry.
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("model capacity exhausted");
    expect(screen.getByRole("button", { name: "Show more" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetryExecution).toHaveBeenCalledWith("prompt text");
  });

  // -------------------------------------------------------------------------
  // Backward compatibility and memo guarantees
  // -------------------------------------------------------------------------

  it("renders every built-in unchanged when slots is omitted", () => {
    render(
      <MessageThread
        executions={[
          makeExecution({
            id: "e1",
            phase: ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL,
            todos: { t1: { content: "write tests", status: TodoStatus.TODO_IN_PROGRESS } },
            pendingApprovalToolCallId: "tc-1",
          }),
        ]}
        onApprovalSubmit={vi.fn()}
      />,
    );

    expect(screen.getByRole("article", { name: "User message" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Agent to-dos" })).toBeTruthy();
    expect(
      screen.getByRole("alert", { name: "Approval required for shell_exec" }),
    ).toBeTruthy();
  });

  it("renders slot overrides identically under the virtualized path", async () => {
    const CustomEntry = ({ message }: MessageEntryProps) => (
      <div data-testid="custom-entry">{message.content}</div>
    );

    render(
      <MessageThread
        executions={[makeExecution({ id: "e1", specMessage: "prompt text" })]}
        virtualized
        slots={{ MessageEntry: CustomEntry }}
      />,
    );

    // The lazy VirtualizedThread resolves asynchronously.
    await vi.waitFor(() => {
      expect(screen.getByTestId("virtuoso-scroller")).toBeTruthy();
    });
    const entries = screen.getAllByTestId("custom-entry");
    expect(entries.length).toBe(2); // synthesized human bubble + AI message
    expect(screen.queryByRole("article", { name: "User message" })).toBeNull();
  });

  it("does not re-render a memoized slot when the thread re-renders with identical data", () => {
    const renderCount = vi.fn();
    const CustomCard = memo(function CustomCard({ todos }: TodoCardProps) {
      renderCount();
      return <div data-testid="custom-todo-card">{Object.keys(todos).length} todos</div>;
    });
    const slots: MessageThreadSlots = { TodoCard: CustomCard };

    const exec = makeExecution({
      id: "e1",
      todos: { t1: { content: "write tests", status: TodoStatus.TODO_PENDING } },
    });

    const { rerender } = render(
      <MessageThread executions={[exec]} slots={slots} />,
    );
    rerender(<MessageThread executions={[exec]} slots={slots} />);

    // Same execution reference, same slots object: the renderer must not
    // manufacture fresh props that defeat the slot's React.memo (DD-010).
    expect(renderCount).toHaveBeenCalledTimes(1);
  });
});
