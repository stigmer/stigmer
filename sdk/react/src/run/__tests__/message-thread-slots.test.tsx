/**
 * MessageThread slots: each slot renders in place of its built-in with the
 * built-in's props (the person's and agent's messages and the failed-send
 * bubble, the bottom approval card with its answer wiring, the to-dos card
 * and rows, the set-up placeholder, the recalled-memories card, the
 * liveness line, the plan cards, the error notice with its retry wiring),
 * every built-in renders when slots are omitted, overrides apply under the
 * virtualized path too, and a memoized slot is not re-rendered when the
 * thread re-renders with the same turns.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import React, { memo } from "react";
import { create } from "@bufbuild/protobuf";
import { FileSchema } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import { RecalledMemoriesSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/spec_pb";
import { InteractionMode } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import type { Turn } from "@stigmer/client";

import { MessageThread, type MessageThreadProps, type MessageThreadSlots } from "../MessageThread";
import type { MessageEntryProps } from "../MessageEntry";
import type { ApprovalCardProps } from "../ApprovalCard";
import type { RunErrorNoticeProps } from "../RunErrorNotice";
import type { TodoCardProps } from "../TodoCard";
import type { TodoRowProps } from "../TodoList";
import type { SetupProgressProps } from "../SetupProgress";
import type { RecalledMemoriesCardProps } from "../RecalledMemoriesCard";
import type { LivenessStatusLineProps } from "../LivenessStatusLine";
import type { PlanCompletionCardProps } from "../PlanCompletionCard";
import type { PlanFileCardProps } from "../PlanFileCard";
import type { PlanStreamingCardProps } from "../PlanStreamingCard";
import {
  asked,
  conversation,
  recalled,
  result,
  status,
  toolId,
  use,
} from "./__fixtures__/thread-events";

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

/** A to-do write in run `id` that returned: one in-progress (or pending) item. */
function todoWrite(id: string, todoStatus = "in_progress") {
  return [use(id, "todo", "write_todos", { todos: [{ content: "write tests", status: todoStatus }] }), result(id, "todo", "ok")];
}

/** A run `id` waiting on a call with no row of its own (a to-do write that asks). */
function waitingOnOrphan(id: string) {
  return [use(id, "gate", "write_todos", {}, { ask: true }), asked(id, "gate"), status(id, "waiting")];
}

function renderThread(conv: { turns: readonly Turn[]; runs: Run[] }, props: Partial<MessageThreadProps> = {}) {
  return render(<MessageThread turns={conv.turns} runs={conv.runs} {...props} />);
}

// ---------------------------------------------------------------------------
// Slot overrides — each slot renders in place of its built-in
// ---------------------------------------------------------------------------

describe("MessageThread slots", () => {
  it("renders the MessageEntry slot for every message, including the failed-send bubble", () => {
    const CustomEntry = ({ message }: MessageEntryProps) => <div data-testid="custom-entry">{message.text}</div>;

    renderThread(conversation({ id: "e1", message: "prompt text" }), {
      pendingUserMessage: "failed follow-up",
      pendingMessageFailed: true,
      onRetrySend: vi.fn(),
      slots: { MessageEntry: CustomEntry },
    });

    const entries = screen.getAllByTestId("custom-entry");
    expect(entries.map((e) => e.textContent)).toEqual(["prompt text", "Hi there!", "failed follow-up"]);
    expect(screen.queryByRole("article", { name: "User message" })).toBeNull();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("renders the ApprovalCard slot with the row's stabilized answer wiring intact", () => {
    const onAnswerToolUse = vi.fn();
    const CustomApproval = ({ toolUse, onAnswer }: ApprovalCardProps) => (
      <button type="button" data-testid="custom-approval" onClick={() => onAnswer("grant")}>
        approve {toolUse.name}
      </button>
    );

    renderThread(conversation({ id: "e1", phase: "running", extra: waitingOnOrphan("e1") }), {
      onAnswerToolUse,
      slots: { ApprovalCard: CustomApproval },
    });

    fireEvent.click(screen.getByTestId("custom-approval"));
    expect(onAnswerToolUse).toHaveBeenCalledWith(toolId("e1", "gate"), "grant", undefined);
  });

  it("renders the TodoCard slot with the TodoRow slot forwarded through its props", () => {
    const forwarded: string[] = [];
    const CustomRow = ({ item }: TodoRowProps) => {
      forwarded.push(item.content);
      return <li data-testid="custom-row">{item.content}</li>;
    };
    const CustomCard = ({ todos, TodoRow }: TodoCardProps) => (
      <div data-testid="custom-todo-card">
        <ul>{todos.map((item) => (TodoRow ? <TodoRow key={item.id} item={item} /> : null))}</ul>
      </div>
    );

    renderThread(conversation({ id: "e1", extra: todoWrite("e1") }), { slots: { TodoCard: CustomCard, TodoRow: CustomRow } });

    expect(screen.getByTestId("custom-todo-card")).toBeTruthy();
    expect(forwarded).toEqual(["write tests"]);
  });

  it("renders the TodoRow slot inside the built-in TodoCard when only TodoRow is overridden", () => {
    const CustomRow = ({ item }: TodoRowProps) => <li data-testid="custom-row">ROW: {item.content}</li>;

    renderThread(conversation({ id: "e1", extra: todoWrite("e1") }), { slots: { TodoRow: CustomRow } });

    expect(screen.getByRole("region", { name: "Agent to-dos" })).toBeTruthy();
    expect(screen.getByTestId("custom-row").textContent).toBe("ROW: write tests");
  });

  it("renders the SetupProgress slot for the pre-first-output window", () => {
    const CustomSetup = ({ isAwaitingResponse }: SetupProgressProps) => (
      <div data-testid="custom-setup">{isAwaitingResponse ? "waiting" : "setup"}</div>
    );

    renderThread(conversation({ id: "e-live", phase: "running", reply: "" }), { slots: { SetupProgress: CustomSetup } });

    expect(screen.getByTestId("custom-setup").textContent).toBe("waiting");
  });

  it("renders the RecalledMemoriesCard slot for a selection-active turn", () => {
    const CustomRecalled = ({ recall, facts }: RecalledMemoriesCardProps) => (
      <div data-testid="custom-recalled">
        {recall.injectedMemoryIds.length} of {facts.length}
      </div>
    );
    const conv = conversation({ id: "e1", extra: [recalled("e1", ["mem_a"])] });
    conv.runs[0]!.status!.recalledMemories = create(RecalledMemoriesSchema, {
      enabled: true,
      facts: [
        { memoryId: "mem_a", content: "Prefers concise answers." },
        { memoryId: "mem_b", content: "Deploys with Bazel." },
      ],
    });

    renderThread(conv, { slots: { RecalledMemoriesCard: CustomRecalled } });

    expect(screen.getByTestId("custom-recalled").textContent).toBe("1 of 2");
    expect(screen.queryByRole("status", { name: /Recalled/ })).toBeNull();
  });

  it("renders the LivenessStatusLine slot while the turn works between events", () => {
    const CustomLiveness = ({ label }: LivenessStatusLineProps) => <div data-testid="custom-liveness">{label ?? "custom-live"}</div>;

    renderThread(conversation({ id: "e-live", phase: "running", reply: "thinking about it" }), { slots: { LivenessStatusLine: CustomLiveness } });

    expect(screen.getByTestId("custom-liveness").textContent).toBe("custom-live");
  });

  it("renders the PlanCompletionCard slot for a completed Plan turn with no plan File", () => {
    const CustomCompletion = ({ onImplement }: PlanCompletionCardProps) => (
      <button type="button" data-testid="custom-completion" onClick={onImplement}>
        custom build
      </button>
    );
    const onBuildFromPlan = vi.fn();

    renderThread(conversation({ id: "e-plan", mode: InteractionMode.PLAN }), { onBuildFromPlan, slots: { PlanCompletionCard: CustomCompletion } });

    fireEvent.click(screen.getByTestId("custom-completion"));
    expect(onBuildFromPlan).toHaveBeenCalledOnce();
  });

  it("renders the PlanFileCard slot for a completed Plan turn with a plan File", () => {
    const CustomPlan = ({ file, title }: PlanFileCardProps) => (
      <div data-testid="custom-plan-card">
        {title ?? "Plan"}: {file.spec?.filename}
      </div>
    );
    const conv = conversation({ id: "e-plan", mode: InteractionMode.PLAN, reply: "# Rollout Plan\n\n1. First step" });
    const planFile = create(FileSchema, {
      spec: { filename: "rollout_abc123.plan.md" },
      status: { runId: "e-plan", outputPath: "rollout_abc123.plan.md" },
    });

    renderThread(conv, {
      onBuildFromPlan: vi.fn(),
      planFiles: new Map([["e-plan", planFile]]),
      slots: { PlanFileCard: CustomPlan },
    });

    expect(screen.getByTestId("custom-plan-card").textContent).toBe("Rollout Plan: rollout_abc123.plan.md");
  });

  it("renders the PlanStreamingCard slot while a plan is being written", () => {
    const CustomStreaming = ({ title }: PlanStreamingCardProps) => <div data-testid="custom-streaming">writing: {title}</div>;

    renderThread(conversation({ id: "e-live", phase: "running", mode: InteractionMode.PLAN, reply: "# Rollout Plan\n\n1. First step" }), {
      onOpenPlan: vi.fn(),
      slots: { PlanStreamingCard: CustomStreaming },
    });

    expect(screen.getByTestId("custom-streaming").textContent).toBe("writing: Rollout Plan");
  });

  it("renders the RunErrorNotice slot with the retry wiring intact", () => {
    const onRetryRun = vi.fn();
    const CustomNotice = ({ error, retryMessage, onRetry }: RunErrorNoticeProps) => (
      <div data-testid="custom-error-notice">
        <span>{error}</span>
        {onRetry && retryMessage && (
          <button type="button" onClick={() => onRetry(retryMessage)}>
            switch engine and retry
          </button>
        )}
      </div>
    );

    renderThread(conversation({ id: "e-failed", message: "prompt text", phase: "failed", error: "model capacity exhausted" }), {
      onRetryRun,
      slots: { RunErrorNotice: CustomNotice },
    });

    expect(screen.getByTestId("custom-error-notice").textContent).toContain("model capacity exhausted");
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "switch engine and retry" }));
    expect(onRetryRun).toHaveBeenCalledWith("prompt text");
  });

  it("falls back to the built-in RunErrorNotice when the slot is omitted", () => {
    const onRetryRun = vi.fn();

    renderThread(conversation({ id: "e-failed", message: "prompt text", phase: "failed", error: "model capacity exhausted" }), { onRetryRun });

    expect(screen.getByRole("alert").textContent).toContain("model capacity exhausted");
    expect(screen.getByRole("button", { name: "Show more" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetryRun).toHaveBeenCalledWith("prompt text");
  });

  // -------------------------------------------------------------------------
  // Backward compatibility and memo guarantees
  // -------------------------------------------------------------------------

  it("renders every built-in unchanged when slots is omitted", () => {
    renderThread(conversation({ id: "e1", phase: "running", extra: [...todoWrite("e1"), ...waitingOnOrphan("e1")] }), { onAnswerToolUse: vi.fn() });

    expect(screen.getByRole("article", { name: "User message" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Agent to-dos" })).toBeTruthy();
    expect(screen.getByRole("alert", { name: "Approval required for write_todos" })).toBeTruthy();
  });

  it("renders slot overrides identically under the virtualized path", async () => {
    const CustomEntry = ({ message }: MessageEntryProps) => <div data-testid="custom-entry">{message.text}</div>;

    renderThread(conversation({ id: "e1", message: "prompt text" }), { virtualized: true, slots: { MessageEntry: CustomEntry } });

    await vi.waitFor(() => {
      expect(screen.getByTestId("virtuoso-scroller")).toBeTruthy();
    });
    expect(screen.getAllByTestId("custom-entry")).toHaveLength(2);
    expect(screen.queryByRole("article", { name: "User message" })).toBeNull();
  });

  it("does not re-render a memoized slot when the thread re-renders with the same turns", () => {
    const renderCount = vi.fn();
    const CustomCard = memo(function CustomCard({ todos }: TodoCardProps) {
      renderCount();
      return <div data-testid="custom-todo-card">{todos.length} todos</div>;
    });
    const slots: MessageThreadSlots = { TodoCard: CustomCard };
    const conv = conversation({ id: "e1", extra: todoWrite("e1", "pending") });

    const { rerender } = renderThread(conv, { slots });
    rerender(<MessageThread turns={conv.turns} runs={conv.runs} slots={slots} />);

    expect(renderCount).toHaveBeenCalledTimes(1);
  });
});
