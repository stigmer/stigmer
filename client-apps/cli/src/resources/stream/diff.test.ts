// Scenario tests for the snapshot→event differ. Each test drives a sequence of
// AgentExecution snapshots through a single SnapshotDiffer and asserts the
// resulting event sequence — the wire-parity contract with Go's streamToEvents.

import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import {
  AgentExecutionSchema,
  AgentExecutionStatusSchema,
  type AgentExecution,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { AgentExecutionSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/spec_pb";
import {
  AgentMessageSchema,
  ToolCallSchema,
  type AgentMessage,
  type ToolCall,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import {
  SubAgentExecutionSchema,
  type SubAgentExecution,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/subagent_pb";
import { TodoItemSchema, type TodoItem } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/todo_pb";
import {
  PendingApprovalSchema,
  type PendingApproval,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/approval_pb";
import {
  ContextInfoSchema,
  SummarizationEventSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/context_pb";
import {
  ExecutionPhase,
  MessageType,
  SubAgentStatus,
  ToolCallStatus,
  TodoStatus,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { SnapshotDiffer } from "./diff.js";
import type { StreamEvent } from "./events.js";

// --- Snapshot builders ---------------------------------------------------------

interface SnapshotOpts {
  message?: string;
  phase?: ExecutionPhase;
  messages?: AgentMessage[];
  subAgents?: SubAgentExecution[];
  todos?: Record<string, TodoItem>;
  pendingApprovals?: PendingApproval[];
  summarizations?: Array<{ source?: number; tokensBefore?: number; tokensAfter?: number }>;
  error?: string;
}

function snapshot(opts: SnapshotOpts): AgentExecution {
  const contextInfo =
    opts.summarizations !== undefined
      ? create(ContextInfoSchema, {
          summarizationEvents: opts.summarizations.map((s) =>
            create(SummarizationEventSchema, {
              tokensBefore: s.tokensBefore ?? 0,
              tokensAfter: s.tokensAfter ?? 0,
            }),
          ),
        })
      : undefined;

  return create(AgentExecutionSchema, {
    spec: create(AgentExecutionSpecSchema, { message: opts.message ?? "" }),
    status: create(AgentExecutionStatusSchema, {
      phase: opts.phase ?? ExecutionPhase.EXECUTION_IN_PROGRESS,
      messages: opts.messages ?? [],
      subAgentExecutions: opts.subAgents ?? [],
      todos: opts.todos ?? {},
      pendingApprovals: opts.pendingApprovals ?? [],
      contextInfo,
      error: opts.error ?? "",
    }),
  });
}

function aiMsg(content: string, opts: { streaming?: boolean; toolCalls?: ToolCall[] } = {}): AgentMessage {
  return create(AgentMessageSchema, {
    type: MessageType.MESSAGE_AI,
    content,
    isStreaming: opts.streaming ?? false,
    toolCalls: opts.toolCalls ?? [],
  });
}

function toolMsg(content: string, toolCalls: ToolCall[]): AgentMessage {
  return create(AgentMessageSchema, { type: MessageType.MESSAGE_TOOL, content, toolCalls });
}

function humanMsg(content: string): AgentMessage {
  return create(AgentMessageSchema, { type: MessageType.MESSAGE_HUMAN, content });
}

function systemMsg(content: string): AgentMessage {
  return create(AgentMessageSchema, { type: MessageType.MESSAGE_SYSTEM, content });
}

function tool(id: string, name: string, status: ToolCallStatus, opts: { result?: string; isStreaming?: boolean } = {}): ToolCall {
  return create(ToolCallSchema, { id, name, status, result: opts.result ?? "", isStreaming: opts.isStreaming ?? false });
}

function subAgent(
  id: string,
  status: SubAgentStatus,
  opts: { name?: string; subject?: string; input?: string; output?: string; messages?: AgentMessage[] } = {},
): SubAgentExecution {
  return create(SubAgentExecutionSchema, {
    id,
    status,
    name: opts.name ?? "researcher",
    subject: opts.subject ?? "",
    input: opts.input ?? "",
    output: opts.output ?? "",
    messages: opts.messages ?? [],
  });
}

function todo(id: string, content: string, status: TodoStatus): TodoItem {
  return create(TodoItemSchema, { id, content, status });
}

function approval(toolCallId: string, toolName: string, message: string): PendingApproval {
  return create(PendingApprovalSchema, { toolCallId, toolName, message });
}

// Drive a snapshot sequence through one differ; return flattened event kinds.
function kindsFor(snapshots: AgentExecution[]): string[] {
  const differ = new SnapshotDiffer();
  const out: string[] = [];
  for (const s of snapshots) out.push(...differ.next(s).map((e) => e.kind));
  return out;
}

// Drive a sequence and return the full event objects.
function eventsFor(snapshots: AgentExecution[]): StreamEvent[] {
  const differ = new SnapshotDiffer();
  const out: StreamEvent[] = [];
  for (const s of snapshots) out.push(...differ.next(s));
  return out;
}

// --- Tests ---------------------------------------------------------------------

describe("human message", () => {
  it("emits once and suppresses the 'execute' placeholder", () => {
    expect(kindsFor([snapshot({ message: "hi" }), snapshot({ message: "hi" })])).toEqual([
      "humanMessage",
      "phaseChange",
    ]);
    expect(kindsFor([snapshot({ message: "execute" })])).toEqual(["phaseChange"]);
  });
});

describe("AI streaming lifecycle", () => {
  it("start → delta → end across snapshots", () => {
    const seq = [
      snapshot({ messages: [aiMsg("Hel", { streaming: true })] }),
      snapshot({ messages: [aiMsg("Hello", { streaming: true })] }),
      snapshot({ messages: [aiMsg("Hello world", { streaming: false })] }),
    ];
    expect(kindsFor(seq)).toEqual(["aiStreamStart", "phaseChange", "aiStreamDelta", "aiStreamEnd"]);
  });
});

describe("tool call interleaving", () => {
  it("running tool is an orphan event, completion lands at the tool-message position", () => {
    const seq = [
      snapshot({ messages: [aiMsg("calling", { toolCalls: [tool("t1", "read", ToolCallStatus.TOOL_CALL_RUNNING)] })] }),
      snapshot({
        messages: [
          aiMsg("calling", { toolCalls: [tool("t1", "read", ToolCallStatus.TOOL_CALL_COMPLETED, { result: "data" })] }),
          toolMsg("data", [tool("t1", "read", ToolCallStatus.TOOL_CALL_COMPLETED, { result: "data" })]),
        ],
      }),
    ];
    expect(kindsFor(seq)).toEqual(["aiMessage", "toolRunning", "phaseChange", "toolCompleted"]);
  });

  it("first-sight terminal tool synthesizes a completion", () => {
    const seq = [
      snapshot({
        messages: [toolMsg("data", [tool("t1", "read", ToolCallStatus.TOOL_CALL_COMPLETED, { result: "data" })])],
      }),
    ];
    expect(kindsFor(seq)).toContain("toolCompleted");
  });

  it("running → interrupted closes the block with toolInterrupted, not toolCompleted", () => {
    // Issue #207: the platform settles an in-flight call to INTERRUPTED when
    // the execution terminalizes; the live differ must close its running block
    // with the honest event (a checkmark would claim the tool finished).
    const seq = [
      snapshot({ messages: [aiMsg("calling", { toolCalls: [tool("t1", "shell", ToolCallStatus.TOOL_CALL_RUNNING)] })] }),
      snapshot({ messages: [aiMsg("calling", { toolCalls: [tool("t1", "shell", ToolCallStatus.TOOL_CALL_INTERRUPTED)] })] }),
    ];
    const kinds = kindsFor(seq);
    expect(kinds).toContain("toolInterrupted");
    expect(kinds).not.toContain("toolCompleted");
  });

  it("first-sight interrupted tool (re-attach) synthesizes toolInterrupted", () => {
    const seq = [
      snapshot({
        messages: [toolMsg("", [tool("t1", "read", ToolCallStatus.TOOL_CALL_INTERRUPTED)])],
      }),
    ];
    expect(kindsFor(seq)).toContain("toolInterrupted");
  });

  it("emits a streaming delta when a running tool's result grows", () => {
    const seq = [
      snapshot({
        messages: [aiMsg("", { toolCalls: [tool("t1", "shell", ToolCallStatus.TOOL_CALL_RUNNING, { isStreaming: true, result: "a" })] })],
      }),
      snapshot({
        messages: [aiMsg("", { toolCalls: [tool("t1", "shell", ToolCallStatus.TOOL_CALL_RUNNING, { isStreaming: true, result: "ab" })] })],
      }),
    ];
    expect(kindsFor(seq)).toContain("toolStreamDelta");
  });
});

describe("system messages", () => {
  it("sanitizes raw API errors and suppresses approval noise", () => {
    const events = eventsFor([
      snapshot({ messages: [systemMsg('Boom: Error code: 500 - {"type": "error"}'), systemMsg("Approval received: ok")] }),
    ]);
    const system = events.filter((e) => e.kind === "systemMessage");
    expect(system).toHaveLength(1);
    expect(system[0].kind === "systemMessage" && system[0].content).toContain("internal error");
  });
});

describe("approval detection", () => {
  it("emits ApprovalNeeded from pending_approvals once", () => {
    const snap = snapshot({
      phase: ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL,
      messages: [aiMsg("", { toolCalls: [tool("t1", "delete", ToolCallStatus.TOOL_CALL_WAITING_APPROVAL)] })],
      pendingApprovals: [approval("t1", "delete", "Delete repo?")],
    });
    // Same snapshot twice — the dedup set prevents a second prompt.
    const events = eventsFor([snap, snap]);
    const approvals = events.filter((e) => e.kind === "approvalNeeded");
    expect(approvals).toHaveLength(1);
    expect(approvals[0].kind === "approvalNeeded" && approvals[0].toolName).toBe("delete");
  });

  it("defense-in-depth: detects approval via tool status when pending_approvals is empty", () => {
    const snap = snapshot({
      phase: ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL,
      messages: [aiMsg("", { toolCalls: [tool("t1", "delete", ToolCallStatus.TOOL_CALL_WAITING_APPROVAL)] })],
      pendingApprovals: [],
    });
    expect(kindsFor([snap])).toContain("approvalNeeded");
  });

  it("re-prompts after an approval cycle (IN_PROGRESS → WAITING_FOR_APPROVAL)", () => {
    const waiting = () =>
      snapshot({
        phase: ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL,
        messages: [aiMsg("", { toolCalls: [tool("t1", "delete", ToolCallStatus.TOOL_CALL_WAITING_APPROVAL)] })],
        pendingApprovals: [approval("t1", "delete", "Delete?")],
      });
    const running = snapshot({
      phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
      messages: [aiMsg("", { toolCalls: [tool("t1", "delete", ToolCallStatus.TOOL_CALL_RUNNING)] })],
    });
    const events = eventsFor([waiting(), running, waiting()]);
    expect(events.filter((e) => e.kind === "approvalNeeded")).toHaveLength(2);
  });
});

describe("todos", () => {
  it("emits an update only when the fingerprint changes", () => {
    const t = todo("a", "do x", TodoStatus.TODO_PENDING);
    const seq = [
      snapshot({ todos: { a: t } }),
      snapshot({ todos: { a: t } }),
      snapshot({ todos: { a: todo("a", "do x", TodoStatus.TODO_COMPLETED) } }),
    ];
    expect(kindsFor(seq).filter((k) => k === "todoUpdate")).toHaveLength(2);
  });
});

describe("context compaction", () => {
  it("emits one event per new summarization entry", () => {
    const seq = [
      snapshot({ summarizations: [{ tokensBefore: 100, tokensAfter: 50 }] }),
      snapshot({ summarizations: [{ tokensBefore: 100, tokensAfter: 50 }, { tokensBefore: 80, tokensAfter: 40 }] }),
    ];
    expect(kindsFor(seq).filter((k) => k === "contextCompacted")).toHaveLength(2);
  });
});

describe("sub-agents", () => {
  it("emits started, nested messages, then completed", () => {
    const seq = [
      snapshot({
        subAgents: [subAgent("s1", SubAgentStatus.SUB_AGENT_IN_PROGRESS, { subject: "Explore", messages: [aiMsg("thinking")] })],
      }),
      snapshot({
        subAgents: [
          subAgent("s1", SubAgentStatus.SUB_AGENT_COMPLETED, {
            subject: "Explore",
            output: "done",
            messages: [aiMsg("thinking"), aiMsg("result")],
          }),
        ],
      }),
    ];
    const events = eventsFor(seq);
    const subKinds = events.filter((e) => ["subAgentStarted", "subAgentCompleted"].includes(e.kind)).map((e) => e.kind);
    expect(subKinds).toEqual(["subAgentStarted", "subAgentCompleted"]);
    const nested = events.filter((e) => e.kind === "aiMessage" && e.subAgentId === "s1");
    expect(nested).toHaveLength(2);
  });
});

describe("terminal", () => {
  it("emits done and ignores all later snapshots", () => {
    const differ = new SnapshotDiffer();
    const first = differ.next(snapshot({ phase: ExecutionPhase.EXECUTION_COMPLETED }));
    expect(first.map((e) => e.kind)).toContain("done");
    const second = differ.next(snapshot({ phase: ExecutionPhase.EXECUTION_COMPLETED }));
    expect(second).toEqual([]);
  });

  it("carries the error message on failure", () => {
    const events = eventsFor([snapshot({ phase: ExecutionPhase.EXECUTION_FAILED, error: "boom" })]);
    const done = events.find((e) => e.kind === "done");
    expect(done?.kind === "done" && done.error).toBe("boom");
  });
});
