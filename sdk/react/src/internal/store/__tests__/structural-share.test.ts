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
  type AgentMessage,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { SubAgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/subagent_pb";
import { PendingApprovalSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/approval_pb";
import {
  ExecutionPhase,
  MessageType,
  ToolCallStatus,
  SubAgentStatus,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { structuralShare } from "../structural-share";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function msg(
  type: MessageType,
  content: string,
  opts?: {
    toolCalls?: ReturnType<typeof tc>[];
    isStreaming?: boolean;
    timestamp?: string;
  },
): AgentMessage {
  const m = create(AgentMessageSchema);
  m.type = type;
  m.content = content;
  if (opts?.toolCalls) m.toolCalls = opts.toolCalls;
  if (opts?.isStreaming) m.isStreaming = true;
  if (opts?.timestamp) m.timestamp = opts.timestamp;
  return m;
}

function tc(
  id: string,
  name: string,
  opts?: { status?: ToolCallStatus; result?: string; isStreaming?: boolean },
) {
  const t = create(ToolCallSchema);
  t.id = id;
  t.name = name;
  t.status = opts?.status ?? ToolCallStatus.TOOL_CALL_COMPLETED;
  if (opts?.result) t.result = opts.result;
  if (opts?.isStreaming) t.isStreaming = true;
  return t;
}

function subAgent(
  id: string,
  opts?: {
    status?: SubAgentStatus;
    messages?: AgentMessage[];
    output?: string;
  },
) {
  const sa = create(SubAgentExecutionSchema);
  sa.id = id;
  sa.name = `agent-${id}`;
  sa.status = opts?.status ?? SubAgentStatus.SUB_AGENT_IN_PROGRESS;
  if (opts?.messages) sa.messages = opts.messages;
  if (opts?.output) sa.output = opts.output;
  return sa;
}

function approval(toolCallId: string, toolName: string) {
  const a = create(PendingApprovalSchema);
  a.toolCallId = toolCallId;
  a.toolName = toolName;
  return a;
}

function exec(opts: {
  id?: string;
  phase?: ExecutionPhase;
  messages?: AgentMessage[];
  subAgents?: ReturnType<typeof subAgent>[];
  approvals?: ReturnType<typeof approval>[];
}): AgentExecution {
  const e = create(AgentExecutionSchema);
  const meta = create(ApiResourceMetadataSchema);
  meta.id = opts.id ?? "exec-1";
  e.metadata = meta;
  const spec = create(AgentExecutionSpecSchema);
  e.spec = spec;
  const status = create(AgentExecutionStatusSchema);
  status.phase = opts.phase ?? ExecutionPhase.EXECUTION_IN_PROGRESS;
  if (opts.messages) status.messages = opts.messages;
  if (opts.subAgents) status.subAgentExecutions = opts.subAgents;
  if (opts.approvals) status.pendingApprovals = opts.approvals;
  e.status = status;
  return e;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("structuralShare", () => {
  describe("first snapshot (prev is null)", () => {
    it("returns next unchanged", () => {
      const next = exec({ messages: [msg(MessageType.MESSAGE_HUMAN, "hi")] });
      expect(structuralShare(null, next)).toBe(next);
    });
  });

  describe("identical snapshots", () => {
    it("returns prev reference when nothing changed", () => {
      const snapshot = exec({
        messages: [
          msg(MessageType.MESSAGE_HUMAN, "hello"),
          msg(MessageType.MESSAGE_AI, "world"),
        ],
      });
      const next = exec({
        messages: [
          msg(MessageType.MESSAGE_HUMAN, "hello"),
          msg(MessageType.MESSAGE_AI, "world"),
        ],
      });
      const result = structuralShare(snapshot, next);
      expect(result).toBe(snapshot);
    });
  });

  describe("message-level sharing", () => {
    it("reuses references for unchanged messages at the prefix", () => {
      const m1 = msg(MessageType.MESSAGE_HUMAN, "hello");
      const m2 = msg(MessageType.MESSAGE_AI, "complete response");
      const prev = exec({ messages: [m1, m2] });

      const m3 = msg(MessageType.MESSAGE_AI, "streaming...", {
        isStreaming: true,
      });
      const next = exec({
        messages: [
          msg(MessageType.MESSAGE_HUMAN, "hello"),
          msg(MessageType.MESSAGE_AI, "complete response"),
          m3,
        ],
      });

      const result = structuralShare(prev, next);
      expect(result).not.toBe(prev);
      expect(result.status!.messages[0]).toBe(m1);
      expect(result.status!.messages[1]).toBe(m2);
      expect(result.status!.messages[2]).toBe(m3);
    });

    it("produces new reference for a message whose content changed", () => {
      const m1 = msg(MessageType.MESSAGE_HUMAN, "hello");
      const prev = exec({
        messages: [m1, msg(MessageType.MESSAGE_AI, "partial")],
      });
      const next = exec({
        messages: [
          msg(MessageType.MESSAGE_HUMAN, "hello"),
          msg(MessageType.MESSAGE_AI, "partial text growing"),
        ],
      });

      const result = structuralShare(prev, next);
      expect(result.status!.messages[0]).toBe(m1);
      expect(result.status!.messages[1]).not.toBe(prev.status!.messages[1]);
      expect(result.status!.messages[1].content).toBe("partial text growing");
    });

    it("produces new reference when isStreaming flag changes", () => {
      const prev = exec({
        messages: [
          msg(MessageType.MESSAGE_AI, "done text", { isStreaming: true }),
        ],
      });
      const next = exec({
        messages: [
          msg(MessageType.MESSAGE_AI, "done text", { isStreaming: false }),
        ],
      });

      const result = structuralShare(prev, next);
      expect(result).not.toBe(prev);
      expect(result.status!.messages[0]).not.toBe(prev.status!.messages[0]);
    });

    it("handles empty to non-empty messages transition", () => {
      const prev = exec({ messages: [] });
      const next = exec({
        messages: [msg(MessageType.MESSAGE_HUMAN, "first")],
      });

      const result = structuralShare(prev, next);
      expect(result).not.toBe(prev);
      expect(result.status!.messages.length).toBe(1);
    });

    it("returns prev when both have empty messages", () => {
      const prev = exec({ messages: [] });
      const next = exec({ messages: [] });
      expect(structuralShare(prev, next)).toBe(prev);
    });
  });

  describe("tool call sharing within messages", () => {
    it("preserves unchanged tool call references by id", () => {
      const tc1 = tc("tc-1", "read_file", { result: "file content" });
      const tc2 = tc("tc-2", "write_file", {
        status: ToolCallStatus.TOOL_CALL_RUNNING,
        isStreaming: true,
      });

      const prev = exec({
        messages: [
          msg(MessageType.MESSAGE_AI, "using tools", { toolCalls: [tc1, tc2] }),
        ],
      });

      const tc2Updated = tc("tc-2", "write_file", {
        status: ToolCallStatus.TOOL_CALL_COMPLETED,
        result: "written",
      });
      const next = exec({
        messages: [
          msg(MessageType.MESSAGE_AI, "using tools", {
            toolCalls: [
              tc("tc-1", "read_file", { result: "file content" }),
              tc2Updated,
            ],
          }),
        ],
      });

      const result = structuralShare(prev, next);
      const resultTcs = result.status!.messages[0].toolCalls;
      expect(resultTcs[0]).toBe(tc1);
      expect(resultTcs[1]).not.toBe(tc2);
      expect(resultTcs[1].status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
    });

    it("handles new tool calls being appended", () => {
      const tc1 = tc("tc-1", "read_file", { result: "ok" });
      const prev = exec({
        messages: [
          msg(MessageType.MESSAGE_AI, "tools", { toolCalls: [tc1] }),
        ],
      });

      const next = exec({
        messages: [
          msg(MessageType.MESSAGE_AI, "tools", {
            toolCalls: [
              tc("tc-1", "read_file", { result: "ok" }),
              tc("tc-2", "write_file"),
            ],
          }),
        ],
      });

      const result = structuralShare(prev, next);
      const resultTcs = result.status!.messages[0].toolCalls;
      expect(resultTcs[0]).toBe(tc1);
      expect(resultTcs.length).toBe(2);
    });
  });

  describe("sub-agent sharing", () => {
    it("reuses unchanged sub-agent references by id", () => {
      const sa1 = subAgent("sa-1", {
        status: SubAgentStatus.SUB_AGENT_COMPLETED,
        messages: [msg(MessageType.MESSAGE_AI, "sub done")],
        output: "result",
      });
      const prev = exec({ subAgents: [sa1] });

      const next = exec({
        subAgents: [
          subAgent("sa-1", {
            status: SubAgentStatus.SUB_AGENT_COMPLETED,
            messages: [msg(MessageType.MESSAGE_AI, "sub done")],
            output: "result",
          }),
        ],
      });

      const result = structuralShare(prev, next);
      expect(result.status!.subAgentExecutions[0]).toBe(sa1);
    });

    it("produces new reference for updated sub-agent but shares its inner messages", () => {
      const innerMsg = msg(MessageType.MESSAGE_AI, "thinking");
      const sa = subAgent("sa-1", {
        status: SubAgentStatus.SUB_AGENT_IN_PROGRESS,
        messages: [innerMsg],
      });
      const prev = exec({ subAgents: [sa] });

      const next = exec({
        subAgents: [
          subAgent("sa-1", {
            status: SubAgentStatus.SUB_AGENT_IN_PROGRESS,
            messages: [
              msg(MessageType.MESSAGE_AI, "thinking"),
              msg(MessageType.MESSAGE_AI, "more thinking"),
            ],
          }),
        ],
      });

      const result = structuralShare(prev, next);
      const resultSa = result.status!.subAgentExecutions[0];
      expect(resultSa).not.toBe(sa);
      expect(resultSa.messages[0]).toBe(innerMsg);
      expect(resultSa.messages.length).toBe(2);
    });

    it("handles new sub-agent appearing", () => {
      const sa1 = subAgent("sa-1", {
        status: SubAgentStatus.SUB_AGENT_COMPLETED,
      });
      const prev = exec({ subAgents: [sa1] });

      const next = exec({
        subAgents: [
          subAgent("sa-1", {
            status: SubAgentStatus.SUB_AGENT_COMPLETED,
          }),
          subAgent("sa-2", {
            status: SubAgentStatus.SUB_AGENT_IN_PROGRESS,
          }),
        ],
      });

      const result = structuralShare(prev, next);
      expect(result.status!.subAgentExecutions[0]).toBe(sa1);
      expect(result.status!.subAgentExecutions.length).toBe(2);
    });
  });

  describe("pending approvals sharing", () => {
    it("reuses prev array when approvals are unchanged", () => {
      const a1 = approval("tc-1", "dangerous_tool");
      const prev = exec({ approvals: [a1] });

      const next = exec({
        approvals: [approval("tc-1", "dangerous_tool")],
      });

      const result = structuralShare(prev, next);
      expect(result.status!.pendingApprovals).toBe(
        prev.status!.pendingApprovals,
      );
    });

    it("uses new array when approvals change", () => {
      const prev = exec({ approvals: [approval("tc-1", "tool1")] });
      const next = exec({
        approvals: [approval("tc-1", "tool1"), approval("tc-2", "tool2")],
      });

      const result = structuralShare(prev, next);
      expect(result.status!.pendingApprovals).not.toBe(
        prev.status!.pendingApprovals,
      );
    });

    it("uses new array when an approval is removed", () => {
      const prev = exec({
        approvals: [approval("tc-1", "tool1"), approval("tc-2", "tool2")],
      });
      const next = exec({ approvals: [approval("tc-1", "tool1")] });

      const result = structuralShare(prev, next);
      expect(result.status!.pendingApprovals).not.toBe(
        prev.status!.pendingApprovals,
      );
    });
  });

  describe("phase changes", () => {
    it("produces new reference when phase changes", () => {
      const prev = exec({ phase: ExecutionPhase.EXECUTION_IN_PROGRESS });
      const next = exec({ phase: ExecutionPhase.EXECUTION_COMPLETED });

      const result = structuralShare(prev, next);
      expect(result).not.toBe(prev);
      expect(result.status!.phase).toBe(ExecutionPhase.EXECUTION_COMPLETED);
    });
  });

  describe("realistic streaming scenario", () => {
    it("only the streaming tail produces new references during token streaming", () => {
      const humanMsg = msg(MessageType.MESSAGE_HUMAN, "Explain React hooks");
      const completedAi = msg(MessageType.MESSAGE_AI, "React hooks are...", {
        toolCalls: [tc("tc-1", "read_docs", { result: "hooks docs" })],
      });

      const prev = exec({
        messages: [
          humanMsg,
          completedAi,
          msg(MessageType.MESSAGE_AI, "Let me explain fur", {
            isStreaming: true,
          }),
        ],
      });

      const next = exec({
        messages: [
          msg(MessageType.MESSAGE_HUMAN, "Explain React hooks"),
          msg(MessageType.MESSAGE_AI, "React hooks are...", {
            toolCalls: [tc("tc-1", "read_docs", { result: "hooks docs" })],
          }),
          msg(MessageType.MESSAGE_AI, "Let me explain further. Hooks are", {
            isStreaming: true,
          }),
        ],
      });

      const result = structuralShare(prev, next);

      expect(result.status!.messages[0]).toBe(humanMsg);
      expect(result.status!.messages[1]).toBe(completedAi);
      expect(result.status!.messages[2]).not.toBe(prev.status!.messages[2]);
      expect(result.status!.messages[2].content).toBe(
        "Let me explain further. Hooks are",
      );
    });
  });

  describe("missing status", () => {
    it("returns next when prev has no status", () => {
      const prev = create(AgentExecutionSchema);
      const next = exec({ messages: [msg(MessageType.MESSAGE_AI, "hi")] });
      expect(structuralShare(prev, next)).toBe(next);
    });

    it("returns next when next has no status", () => {
      const prev = exec({ messages: [msg(MessageType.MESSAGE_AI, "hi")] });
      const next = create(AgentExecutionSchema);
      expect(structuralShare(prev, next)).toBe(next);
    });
  });
});
