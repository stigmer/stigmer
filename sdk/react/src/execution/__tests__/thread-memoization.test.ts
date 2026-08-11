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
  type ToolCall,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { SubAgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/subagent_pb";
import {
  ExecutionPhase,
  MessageType,
  ToolCallStatus,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { toolCallGroupPropsEqual, type ToolCallGroupProps } from "../ToolCallGroup";
import { buildThreadItems } from "../MessageThread";
import { structuralShare } from "../../internal/store";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMessage(
  type: MessageType,
  content: string,
  opts?: { toolCalls?: ToolCall[]; isStreaming?: boolean },
) {
  const msg = create(AgentMessageSchema);
  msg.type = type;
  msg.content = content;
  if (opts?.toolCalls) msg.toolCalls = opts.toolCalls;
  if (opts?.isStreaming) msg.isStreaming = true;
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
  if (opts.messages) status.messages = opts.messages;
  if (opts.subAgents) status.subAgentExecutions = opts.subAgents;
  exec.status = status;
  return exec;
}

// ---------------------------------------------------------------------------
// toolCallGroupPropsEqual
// ---------------------------------------------------------------------------

describe("toolCallGroupPropsEqual", () => {
  it("returns true when both arrays share the same ToolCall references", () => {
    const tc1 = makeToolCall("shell", "tc-1");
    const tc2 = makeToolCall("read_file", "tc-2");
    const prev: ToolCallGroupProps = { toolCalls: [tc1, tc2] };
    const next: ToolCallGroupProps = { toolCalls: [tc1, tc2] };
    expect(toolCallGroupPropsEqual(prev, next)).toBe(true);
  });

  it("returns false when array lengths differ", () => {
    const tc1 = makeToolCall("shell", "tc-1");
    const prev: ToolCallGroupProps = { toolCalls: [tc1] };
    const next: ToolCallGroupProps = { toolCalls: [tc1, makeToolCall("read_file", "tc-2")] };
    expect(toolCallGroupPropsEqual(prev, next)).toBe(false);
  });

  it("returns false when a ToolCall reference changes", () => {
    const tc1 = makeToolCall("shell", "tc-1");
    const tc1Copy = makeToolCall("shell", "tc-1");
    const prev: ToolCallGroupProps = { toolCalls: [tc1] };
    const next: ToolCallGroupProps = { toolCalls: [tc1Copy] };
    expect(toolCallGroupPropsEqual(prev, next)).toBe(false);
  });

  it("returns false when className changes", () => {
    const tc1 = makeToolCall("shell", "tc-1");
    const prev: ToolCallGroupProps = { toolCalls: [tc1], className: "stg:mx-4" };
    const next: ToolCallGroupProps = { toolCalls: [tc1], className: "stg:mx-6" };
    expect(toolCallGroupPropsEqual(prev, next)).toBe(false);
  });

  it("returns false when subAgentExecutions reference changes", () => {
    const tc1 = makeToolCall("shell", "tc-1");
    const subs1 = [makeSubAgent("sa-1")];
    const subs2 = [makeSubAgent("sa-1")];
    const prev: ToolCallGroupProps = { toolCalls: [tc1], subAgentExecutions: subs1 };
    const next: ToolCallGroupProps = { toolCalls: [tc1], subAgentExecutions: subs2 };
    expect(toolCallGroupPropsEqual(prev, next)).toBe(false);
  });

  it("returns true when subAgentExecutions is the same reference", () => {
    const tc1 = makeToolCall("shell", "tc-1");
    const subs = [makeSubAgent("sa-1")];
    const prev: ToolCallGroupProps = { toolCalls: [tc1], subAgentExecutions: subs };
    const next: ToolCallGroupProps = { toolCalls: [tc1], subAgentExecutions: subs };
    expect(toolCallGroupPropsEqual(prev, next)).toBe(true);
  });

  it("returns false when formatSummary reference changes", () => {
    const tc1 = makeToolCall("shell", "tc-1");
    const fn1 = () => "summary";
    const fn2 = () => "summary";
    const prev: ToolCallGroupProps = { toolCalls: [tc1], formatSummary: fn1 };
    const next: ToolCallGroupProps = { toolCalls: [tc1], formatSummary: fn2 };
    expect(toolCallGroupPropsEqual(prev, next)).toBe(false);
  });

  it("handles empty arrays", () => {
    const prev: ToolCallGroupProps = { toolCalls: [] };
    const next: ToolCallGroupProps = { toolCalls: [] };
    expect(toolCallGroupPropsEqual(prev, next)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildThreadItems — toolCalls array reuse
// ---------------------------------------------------------------------------

describe("buildThreadItems toolCalls array reuse", () => {
  it("reuses msg.toolCalls reference when no task tools are present", () => {
    const tc1 = makeToolCall("shell", "tc-1");
    const tc2 = makeToolCall("read_file", "tc-2");
    const aiMsg = makeMessage(MessageType.MESSAGE_AI, "using tools", {
      toolCalls: [tc1, tc2],
    });

    const exec = makeExecution({ id: "exec-1", messages: [aiMsg] });
    const items = buildThreadItems([exec], null, null, false, undefined);

    const toolGroup = items.find((i) => i.kind === "tool-group");
    expect(toolGroup).toBeDefined();
    if (toolGroup?.kind === "tool-group") {
      expect(toolGroup.toolCalls).toBe(aiMsg.toolCalls);
    }
  });

  it("creates a new array when task tools are present", () => {
    const tc1 = makeToolCall("shell", "tc-1");
    const tc2 = makeToolCall("task", "sa-1");
    const sa = makeSubAgent("sa-1");
    const aiMsg = makeMessage(MessageType.MESSAGE_AI, "delegating", {
      toolCalls: [tc1, tc2],
    });

    const exec = makeExecution({
      id: "exec-1",
      messages: [aiMsg],
      subAgents: [sa],
    });
    const items = buildThreadItems([exec], null, null, false, undefined);

    const toolGroup = items.find((i) => i.kind === "tool-group");
    expect(toolGroup).toBeDefined();
    if (toolGroup?.kind === "tool-group") {
      expect(toolGroup.toolCalls).not.toBe(aiMsg.toolCalls);
      expect(toolGroup.toolCalls).toHaveLength(1);
      expect(toolGroup.toolCalls[0]).toBe(tc1);
    }

    const subAgentItem = items.find((i) => i.kind === "sub-agent");
    expect(subAgentItem).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Structural sharing + memoization integration
// ---------------------------------------------------------------------------

describe("structural sharing preserves references for memo boundaries", () => {
  it("completed messages keep the same reference across stream updates", () => {
    const humanMsg = makeMessage(MessageType.MESSAGE_HUMAN, "Hello");
    const completedAi = makeMessage(MessageType.MESSAGE_AI, "Full response");

    const prev = makeExecution({
      id: "exec-1",
      phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
      messages: [
        humanMsg,
        completedAi,
        makeMessage(MessageType.MESSAGE_AI, "streaming par", { isStreaming: true }),
      ],
    });

    const next = makeExecution({
      id: "exec-1",
      phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
      messages: [
        makeMessage(MessageType.MESSAGE_HUMAN, "Hello"),
        makeMessage(MessageType.MESSAGE_AI, "Full response"),
        makeMessage(MessageType.MESSAGE_AI, "streaming partial text grow", {
          isStreaming: true,
        }),
      ],
    });

    const shared = structuralShare(prev, next);

    expect(shared.status!.messages[0]).toBe(humanMsg);
    expect(shared.status!.messages[1]).toBe(completedAi);
    expect(shared.status!.messages[2]).not.toBe(prev.status!.messages[2]);
  });

  it("toolCalls within completed messages keep their references", () => {
    const tc1 = makeToolCall("shell", "tc-1");
    const tc2 = makeToolCall("read_file", "tc-2");
    const aiMsg = makeMessage(MessageType.MESSAGE_AI, "tools done", {
      toolCalls: [tc1, tc2],
    });

    const prev = makeExecution({
      id: "exec-1",
      phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
      messages: [
        aiMsg,
        makeMessage(MessageType.MESSAGE_AI, "now streaming", { isStreaming: true }),
      ],
    });

    const next = makeExecution({
      id: "exec-1",
      phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
      messages: [
        makeMessage(MessageType.MESSAGE_AI, "tools done", {
          toolCalls: [
            makeToolCall("shell", "tc-1"),
            makeToolCall("read_file", "tc-2"),
          ],
        }),
        makeMessage(MessageType.MESSAGE_AI, "now streaming more", {
          isStreaming: true,
        }),
      ],
    });

    const shared = structuralShare(prev, next);

    expect(shared.status!.messages[0]).toBe(aiMsg);
    expect(shared.status!.messages[0].toolCalls[0]).toBe(tc1);
    expect(shared.status!.messages[0].toolCalls[1]).toBe(tc2);
  });

  it("buildThreadItems with shared execution preserves tool group stability", () => {
    const tc1 = makeToolCall("shell", "tc-1");
    const completedMsg = makeMessage(MessageType.MESSAGE_AI, "used tools", {
      toolCalls: [tc1],
    });

    const prev = makeExecution({
      id: "exec-1",
      phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
      messages: [
        completedMsg,
        makeMessage(MessageType.MESSAGE_AI, "stream", { isStreaming: true }),
      ],
    });

    const next = makeExecution({
      id: "exec-1",
      phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
      messages: [
        makeMessage(MessageType.MESSAGE_AI, "used tools", {
          toolCalls: [makeToolCall("shell", "tc-1")],
        }),
        makeMessage(MessageType.MESSAGE_AI, "stream grows", {
          isStreaming: true,
        }),
      ],
    });

    const shared = structuralShare(prev, next);

    const itemsPrev = buildThreadItems([], prev, null, false, undefined);
    const itemsNext = buildThreadItems([], shared, null, false, undefined);

    const prevToolGroup = itemsPrev.find((i) => i.kind === "tool-group");
    const nextToolGroup = itemsNext.find((i) => i.kind === "tool-group");

    expect(prevToolGroup).toBeDefined();
    expect(nextToolGroup).toBeDefined();

    if (prevToolGroup?.kind === "tool-group" && nextToolGroup?.kind === "tool-group") {
      expect(nextToolGroup.toolCalls).toBe(shared.status!.messages[0].toolCalls);
      expect(nextToolGroup.toolCalls[0]).toBe(tc1);
    }
  });
});
