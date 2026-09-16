/**
 * `ExecutionRecord.whenToolCallsSettled` — the barrier the hermetic scripted
 * model waits on before it ticks (since #1097): resolves once every named row is
 * persisted settled, across the root and the sub-agent transcripts; resolves
 * at once when there is nothing to wait for; fails naming the open ids rather
 * than hanging when no persist ever carries them.
 */
import { describe, expect, it } from "vitest";
import { create } from "@bufbuild/protobuf";
import { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ExecutionPhase, MessageType, ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { deepAgentExecutionRecord } from "../../activities/execute-deep-agent/__test-utils__/hermetic-deep-agent.js";

function statusWith(rows: Array<{ id: string; status: ToolCallStatus; subAgent?: boolean }>) {
  const message = (ids: typeof rows) => ({
    type: MessageType.MESSAGE_AI,
    content: "",
    toolCalls: ids.map((r) => ({ id: r.id, name: "probe", status: r.status })),
  });
  return create(AgentExecutionStatusSchema, {
    phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
    messages: [message(rows.filter((r) => !r.subAgent))],
    subAgentExecutions: rows.some((r) => r.subAgent)
      ? [{ id: "task-1", name: "helper", messages: [message(rows.filter((r) => r.subAgent))] }]
      : [],
  });
}

describe("ExecutionRecord.whenToolCallsSettled", () => {
  it("resolves at once for no ids, and for ids already persisted settled", async () => {
    const record = deepAgentExecutionRecord({ message: "go" });
    await expect(record.whenToolCallsSettled([])).resolves.toBeUndefined();

    record.applyStatusUpdate(statusWith([{ id: "c-1", status: ToolCallStatus.TOOL_CALL_COMPLETED }]));
    await expect(record.whenToolCallsSettled(["c-1"])).resolves.toBeUndefined();
  });

  it("waits through a RUNNING persist and releases on the persist that settles the row", async () => {
    const record = deepAgentExecutionRecord({ message: "go" });
    let released = false;
    const barrier = record.whenToolCallsSettled(["c-1"]).then(() => {
      released = true;
    });

    record.applyStatusUpdate(statusWith([{ id: "c-1", status: ToolCallStatus.TOOL_CALL_RUNNING }]));
    await Promise.resolve();
    expect(released, "a RUNNING row is not settled").toBe(false);

    record.applyStatusUpdate(statusWith([{ id: "c-1", status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL }]));
    await barrier;
    expect(released).toBe(true);
  });

  it("finds a sub-agent's rows in its own transcript", async () => {
    const record = deepAgentExecutionRecord({ message: "go" });
    record.applyStatusUpdate(
      statusWith([
        { id: "task-1", status: ToolCallStatus.TOOL_CALL_RUNNING },
        { id: "sub-1", status: ToolCallStatus.TOOL_CALL_COMPLETED, subAgent: true },
      ]),
    );
    await expect(record.whenToolCallsSettled(["sub-1"])).resolves.toBeUndefined();
  });

  it("fails naming the ids still open when no persist ever settles them, instead of hanging", async () => {
    const record = deepAgentExecutionRecord({ message: "go" });
    record.applyStatusUpdate(statusWith([{ id: "c-1", status: ToolCallStatus.TOOL_CALL_RUNNING }]));
    await expect(record.whenToolCallsSettled(["c-1", "c-2"], 20)).rejects.toThrow(/c-1, c-2 never settled/);
  });
});
