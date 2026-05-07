import { describe, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import {
  AgentExecutionSchema,
  AgentExecutionStatusSchema,
  type AgentExecution,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { AgentExecutionSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/spec_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import {
  AgentMessageSchema,
  ToolCallSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { SubAgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/subagent_pb";
import {
  ExecutionPhase,
  MessageType,
  ToolCallStatus,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { buildThreadItems } from "../MessageThread";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMessage(
  type: MessageType,
  content: string,
  opts?: { toolCalls?: ReturnType<typeof makeToolCall>[]; isStreaming?: boolean },
) {
  const msg = create(AgentMessageSchema);
  msg.type = type;
  msg.content = content;
  if (opts?.toolCalls) {
    msg.toolCalls = opts.toolCalls;
  }
  if (opts?.isStreaming) {
    msg.isStreaming = true;
  }
  return msg;
}

function makeToolCall(name: string, id: string) {
  const tc = create(ToolCallSchema);
  tc.id = id;
  tc.name = name;
  tc.status = ToolCallStatus.TOOL_CALL_COMPLETED;
  return tc;
}

function makeSubAgent(id: string) {
  const sa = create(SubAgentExecutionSchema);
  sa.id = id;
  sa.name = "test-agent";
  return sa;
}

function makeExecution(opts: {
  id: string;
  specMessage?: string;
  phase?: ExecutionPhase;
  messages?: ReturnType<typeof makeMessage>[];
  subAgents?: ReturnType<typeof makeSubAgent>[];
}): AgentExecution {
  const exec = create(AgentExecutionSchema);

  const meta = create(ApiResourceMetadataSchema);
  meta.id = opts.id;
  exec.metadata = meta;

  if (opts.specMessage) {
    const spec = create(AgentExecutionSpecSchema);
    spec.message = opts.specMessage;
    exec.spec = spec;
  }

  const status = create(AgentExecutionStatusSchema);
  status.phase = opts.phase ?? ExecutionPhase.EXECUTION_COMPLETED;
  if (opts.messages) {
    status.messages = opts.messages;
  }
  if (opts.subAgents) {
    status.subAgentExecutions = opts.subAgents;
  }
  exec.status = status;

  return exec;
}

function extractKeys(items: { key: string }[]): string[] {
  return items.map((i) => i.key);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildThreadItems key generation", () => {
  it("uses execution ID in message keys, not array index", () => {
    const exec = makeExecution({
      id: "exec-abc",
      specMessage: "Hello",
      messages: [
        makeMessage(MessageType.MESSAGE_HUMAN, "Hello"),
        makeMessage(MessageType.MESSAGE_AI, "Hi there"),
      ],
    });

    const items = buildThreadItems([exec], null, null, false, undefined);
    const keys = extractKeys(items);

    expect(keys).toContain("exec-abc-spec");
    expect(keys).toContain("exec-abc-m0");
    expect(keys).toContain("exec-abc-m1");
    for (const k of keys) {
      expect(k).not.toMatch(/^e\d+-/);
    }
  });

  it("uses execution ID for tool group keys", () => {
    const tc = makeToolCall("shell", "tc-001");
    const aiMsg = makeMessage(MessageType.MESSAGE_AI, "Running tool", {
      toolCalls: [tc],
    });

    const exec = makeExecution({
      id: "exec-xyz",
      messages: [aiMsg],
    });

    const items = buildThreadItems([exec], null, null, false, undefined);
    const keys = extractKeys(items);

    expect(keys).toContain("exec-xyz-m0");
    expect(keys).toContain("exec-xyz-m0-tc");
  });

  it("uses SubAgentExecution.id for sub-agent keys", () => {
    const taskTc = makeToolCall("task", "sa-id-42");
    const aiMsg = makeMessage(MessageType.MESSAGE_AI, "Delegating", {
      toolCalls: [taskTc],
    });
    const subAgent = makeSubAgent("sa-id-42");

    const exec = makeExecution({
      id: "exec-parent",
      messages: [aiMsg],
      subAgents: [subAgent],
    });

    const items = buildThreadItems([exec], null, null, false, undefined);
    const keys = extractKeys(items);

    expect(keys).toContain("sa-sa-id-42");
  });

  it("keys are stable when execution moves from active to completed", () => {
    const messages = [
      makeMessage(MessageType.MESSAGE_HUMAN, "Hello"),
      makeMessage(MessageType.MESSAGE_AI, "Response"),
    ];

    const exec = makeExecution({
      id: "exec-stable",
      specMessage: "Hello",
      phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
      messages,
    });

    // Phase A: execution is the active stream
    const itemsActive = buildThreadItems([], exec, null, false, undefined);

    // Phase B: same execution is now completed (in the list, no active stream)
    const completedExec = makeExecution({
      id: "exec-stable",
      specMessage: "Hello",
      phase: ExecutionPhase.EXECUTION_COMPLETED,
      messages,
    });
    const itemsCompleted = buildThreadItems(
      [completedExec],
      null,
      null,
      false,
      undefined,
    );

    const keysActive = extractKeys(itemsActive);
    const keysCompleted = extractKeys(itemsCompleted);

    // Spec message key and all message keys should be identical
    expect(keysActive).toContain("exec-stable-spec");
    expect(keysCompleted).toContain("exec-stable-spec");
    expect(keysActive).toContain("exec-stable-m0");
    expect(keysCompleted).toContain("exec-stable-m0");
    expect(keysActive).toContain("exec-stable-m1");
    expect(keysCompleted).toContain("exec-stable-m1");
  });

  describe("pending → confirmed message bridging", () => {
    it("pending message gets 'pending-user-turn' key", () => {
      const items = buildThreadItems([], null, "Hello world", false, undefined);
      const last = items[items.length - 1];

      expect(last.key).toBe("pending-user-turn");
      expect(last.kind).toBe("message");
      if (last.kind === "message") {
        expect(last.isPending).toBe(true);
        expect(last.message.content).toBe("Hello world");
        expect(last.message.type).toBe(MessageType.MESSAGE_HUMAN);
      }
    });

    it("active stream spec message uses bridging key when matching pending", () => {
      const activeExec = makeExecution({
        id: "exec-new",
        specMessage: "Hello world",
        phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
      });

      const items = buildThreadItems(
        [],
        activeExec,
        "Hello world",
        false,
        undefined,
      );
      const keys = extractKeys(items);

      expect(keys).toContain("pending-user-turn");
      expect(keys).not.toContain("exec-new-spec");
    });

    it("spec message gets permanent key when no pending user message", () => {
      const exec = makeExecution({
        id: "exec-done",
        specMessage: "Hello world",
      });

      const items = buildThreadItems([exec], null, null, false, undefined);
      const keys = extractKeys(items);

      expect(keys).toContain("exec-done-spec");
      expect(keys).not.toContain("pending-user-turn");
    });

    it("spec message gets permanent key when pending does not match", () => {
      const activeExec = makeExecution({
        id: "exec-mismatch",
        specMessage: "Original message",
        phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
      });

      const items = buildThreadItems(
        [],
        activeExec,
        "Different message",
        false,
        undefined,
      );
      const keys = extractKeys(items);

      expect(keys).toContain("exec-mismatch-spec");
      // Pending message is also present because alreadySynthesized is false
      expect(keys).toContain("pending-user-turn");
    });

    it("pending message is suppressed when alreadySynthesized", () => {
      const activeExec = makeExecution({
        id: "exec-synth",
        specMessage: "Hello",
        phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
      });

      const items = buildThreadItems(
        [],
        activeExec,
        "Hello",
        false,
        undefined,
      );

      const pendingItems = items.filter(
        (i) => i.kind === "message" && "isPending" in i && i.isPending,
      );
      expect(pendingItems).toHaveLength(0);
    });

    it("completed execution spec message uses permanent key even with pending", () => {
      const completedExec = makeExecution({
        id: "exec-old",
        specMessage: "Old message",
      });
      const activeExec = makeExecution({
        id: "exec-current",
        specMessage: "New message",
        phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
      });

      const items = buildThreadItems(
        [completedExec],
        activeExec,
        "New message",
        false,
        undefined,
      );
      const keys = extractKeys(items);

      expect(keys).toContain("exec-old-spec");
      expect(keys).toContain("pending-user-turn");
    });
  });

  it("produces no duplicate keys in a realistic multi-execution scenario", () => {
    const tc1 = makeToolCall("shell", "tc-1");
    const tc2 = makeToolCall("task", "tc-2");
    const sa = makeSubAgent("tc-2");

    const exec1 = makeExecution({
      id: "exec-1",
      specMessage: "First turn",
      messages: [
        makeMessage(MessageType.MESSAGE_HUMAN, "First turn"),
        makeMessage(MessageType.MESSAGE_AI, "Working on it", {
          toolCalls: [tc1, tc2],
        }),
        makeMessage(MessageType.MESSAGE_TOOL, "shell output"),
        makeMessage(MessageType.MESSAGE_AI, "Done"),
      ],
      subAgents: [sa],
    });

    const exec2 = makeExecution({
      id: "exec-2",
      specMessage: "Second turn",
      phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
      messages: [
        makeMessage(MessageType.MESSAGE_THINKING, "Let me think..."),
        makeMessage(MessageType.MESSAGE_AI, "Here's my answer", {
          isStreaming: true,
        }),
      ],
    });

    const items = buildThreadItems(
      [exec1],
      exec2,
      "Second turn",
      false,
      undefined,
    );

    const keys = extractKeys(items);
    const uniqueKeys = new Set(keys);

    expect(keys.length).toBe(uniqueKeys.size);
    expect(keys.length).toBeGreaterThan(0);
  });

  it("skips MESSAGE_TOOL messages", () => {
    const exec = makeExecution({
      id: "exec-skip",
      messages: [
        makeMessage(MessageType.MESSAGE_AI, "Using tool"),
        makeMessage(MessageType.MESSAGE_TOOL, "tool output"),
        makeMessage(MessageType.MESSAGE_AI, "Got result"),
      ],
    });

    const items = buildThreadItems([exec], null, null, false, undefined);
    const messageItems = items.filter((i) => i.kind === "message");

    expect(messageItems).toHaveLength(2);
    expect(messageItems[0].key).toBe("exec-skip-m0");
    // m1 is the TOOL message (skipped), m2 is the next AI message
    expect(messageItems[1].key).toBe("exec-skip-m2");
  });

  it("skips empty AI messages but still emits tool groups", () => {
    const tc = makeToolCall("read_file", "tc-empty");
    const exec = makeExecution({
      id: "exec-empty-ai",
      messages: [
        makeMessage(MessageType.MESSAGE_AI, "  ", { toolCalls: [tc] }),
      ],
    });

    const items = buildThreadItems([exec], null, null, false, undefined);
    const kinds = items.map((i) => i.kind);

    expect(kinds).not.toContain("message");
    expect(kinds).toContain("tool-group");
    expect(items.find((i) => i.kind === "tool-group")!.key).toBe(
      "exec-empty-ai-m0-tc",
    );
  });

  it("falls back to index-based prefix when metadata.id is missing", () => {
    const exec = create(AgentExecutionSchema);
    const status = create(AgentExecutionStatusSchema);
    status.phase = ExecutionPhase.EXECUTION_COMPLETED;
    status.messages = [makeMessage(MessageType.MESSAGE_AI, "No metadata")];
    exec.status = status;

    const items = buildThreadItems([exec], null, null, false, undefined);

    expect(items[0].key).toBe("_e0-m0");
  });
});
