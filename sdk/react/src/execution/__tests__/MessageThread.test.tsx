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
import { AgentMessageSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { PendingApprovalSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/approval_pb";
import {
  ExecutionPhase,
  InteractionMode,
  MessageType,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("MessageThread", () => {
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

  it("renders ExecutionPhaseBadge for non-completed terminal phase", () => {
    const exec = makeExecution({
      id: "exec-fail",
      phase: ExecutionPhase.EXECUTION_FAILED,
    });

    render(<MessageThread executions={[exec]} />);

    expect(screen.getByText(/failed/i)).toBeTruthy();
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

    const implementBtn = screen.getByRole("button", { name: /implement/i });
    expect(implementBtn).toBeTruthy();

    fireEvent.click(implementBtn);
    expect(onBuildFromPlan).toHaveBeenCalledOnce();
  });
});
