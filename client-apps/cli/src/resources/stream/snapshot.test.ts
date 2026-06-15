// Tests for the historical-replay projection (snapshotToEvents). Stored
// executions must yield the same event vocabulary as the live differ, with
// `done` emitted only for the final execution.

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
  ExecutionPhase,
  MessageType,
  ToolCallStatus,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { StreamEvent } from "./events.js";
import { snapshotToEvents } from "./snapshot.js";

function exec(opts: {
  message?: string;
  phase?: ExecutionPhase;
  messages?: AgentMessage[];
  error?: string;
}): AgentExecution {
  return create(AgentExecutionSchema, {
    spec: create(AgentExecutionSpecSchema, { message: opts.message ?? "" }),
    status: create(AgentExecutionStatusSchema, {
      phase: opts.phase ?? ExecutionPhase.EXECUTION_COMPLETED,
      messages: opts.messages ?? [],
      error: opts.error ?? "",
    }),
  });
}

function aiMsg(content: string): AgentMessage {
  return create(AgentMessageSchema, { type: MessageType.MESSAGE_AI, content });
}

function systemMsg(content: string): AgentMessage {
  return create(AgentMessageSchema, { type: MessageType.MESSAGE_SYSTEM, content });
}

function toolMsg(tc: ToolCall): AgentMessage {
  return create(AgentMessageSchema, { type: MessageType.MESSAGE_TOOL, toolCalls: [tc], timestamp: "t1" });
}

function tool(id: string, status: ToolCallStatus): ToolCall {
  return create(ToolCallSchema, { id, name: "read", status, startedAt: "t0" });
}

const kinds = (events: StreamEvent[]): string[] => events.map((e) => e.kind);

describe("snapshotToEvents", () => {
  it("emits the human prompt, AI text, and a terminal done for the last execution", () => {
    const events = snapshotToEvents([exec({ message: "do it", messages: [aiMsg("done")] })]);
    expect(kinds(events)).toEqual(["humanMessage", "aiMessage", "done"]);
    expect(events[0]).toMatchObject({ kind: "humanMessage", content: "do it" });
    expect(events[2]).toMatchObject({ kind: "done", phase: "completed" });
  });

  it("suppresses the 'execute' placeholder prompt", () => {
    const events = snapshotToEvents([exec({ message: "execute", messages: [aiMsg("hi")] })]);
    expect(kinds(events)).toEqual(["aiMessage", "done"]);
  });

  it("promotes a MESSAGE_TOOL into a stateful tool event by status", () => {
    const events = snapshotToEvents([
      exec({ messages: [toolMsg(tool("tc1", ToolCallStatus.TOOL_CALL_COMPLETED))] }),
    ]);
    expect(kinds(events)).toEqual(["toolCompleted", "done"]);
    expect(events[0]).toMatchObject({ kind: "toolCompleted", toolCallId: "tc1" });
  });

  it("only the final execution emits done", () => {
    const events = snapshotToEvents([
      exec({ message: "first", messages: [aiMsg("a")] }),
      exec({ message: "second", messages: [aiMsg("b")] }),
    ]);
    expect(kinds(events)).toEqual(["humanMessage", "aiMessage", "humanMessage", "aiMessage", "done"]);
  });

  it("carries the failure phase + error into done", () => {
    const events = snapshotToEvents([
      exec({ phase: ExecutionPhase.EXECUTION_FAILED, error: "boom", messages: [systemMsg("context")] }),
    ]);
    const done = events.at(-1);
    expect(done).toMatchObject({ kind: "done", phase: "failed", error: "boom" });
  });
});
