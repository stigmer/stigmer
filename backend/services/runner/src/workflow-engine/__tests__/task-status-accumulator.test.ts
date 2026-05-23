import { describe, it, expect } from "vitest";
import {
  TaskStatusAccumulator,
  truncatePayload,
} from "../task-status-accumulator.js";

describe("TaskStatusAccumulator", () => {
  describe("taskStarted", () => {
    it("records task name, kind, status, startedAt, and taskId", () => {
      const acc = new TaskStatusAccumulator();
      acc.taskStarted("myTask", "call:http");
      const [entry] = acc.toArray();
      expect(entry.taskName).toBe("myTask");
      expect(entry.taskKind).toBe("call:http");
      expect(entry.status).toBe("started");
      expect(entry.startedAt).toBeDefined();
      expect(entry.taskId).toBe("myTask:1");
    });
  });

  describe("taskStartedWithInput", () => {
    it("records input alongside start fields", () => {
      const acc = new TaskStatusAccumulator();
      const input = { url: "https://example.com", method: "GET" };
      acc.taskStartedWithInput("httpTask", "call:http", input);
      const [entry] = acc.toArray();
      expect(entry.taskName).toBe("httpTask");
      expect(entry.status).toBe("started");
      expect(entry.input).toEqual(input);
    });

    it("truncates large inputs", () => {
      const acc = new TaskStatusAccumulator();
      const largeInput = { data: "x".repeat(100_000) };
      acc.taskStartedWithInput("bigTask", "call:agent", largeInput);
      const [entry] = acc.toArray();
      expect((entry.input as Record<string, unknown>)._truncated).toBe(true);
    });
  });

  describe("taskCompleted", () => {
    it("preserves startedAt from taskStarted and records completedAt", () => {
      const acc = new TaskStatusAccumulator();
      acc.taskStarted("t1", "set");
      const startedAt = acc.toArray()[0].startedAt;
      acc.taskCompleted("t1", 150);
      const [entry] = acc.toArray();
      expect(entry.status).toBe("completed");
      expect(entry.startedAt).toBe(startedAt);
      expect(entry.completedAt).toBeDefined();
      expect(entry.durationMs).toBe(150);
    });
  });

  describe("taskCompletedWithResult", () => {
    it("stores output and cost info", () => {
      const acc = new TaskStatusAccumulator();
      acc.taskStarted("llmTask", "call:function:llm");
      const output = { result: "hello", input_tokens: 50, output_tokens: 20 };
      acc.taskCompletedWithResult("llmTask", 200, output, {
        costMicros: 1500,
        inputTokens: 50,
        outputTokens: 20,
      });
      const [entry] = acc.toArray();
      expect(entry.status).toBe("completed");
      expect(entry.output).toEqual(output);
      expect(entry.costMicros).toBe(1500);
      expect(entry.inputTokens).toBe(50);
      expect(entry.outputTokens).toBe(20);
      expect(entry.durationMs).toBe(200);
    });

    it("preserves input from taskStartedWithInput", () => {
      const acc = new TaskStatusAccumulator();
      const input = { prompt: "test" };
      acc.taskStartedWithInput("t1", "call:function:llm", input);
      acc.taskCompletedWithResult("t1", 100, { result: "ok" }, {
        costMicros: 0,
        inputTokens: 10,
        outputTokens: 5,
      });
      const [entry] = acc.toArray();
      expect(entry.input).toEqual(input);
      expect(entry.output).toEqual({ result: "ok" });
    });

    it("handles undefined cost gracefully", () => {
      const acc = new TaskStatusAccumulator();
      acc.taskStarted("t1", "set");
      acc.taskCompletedWithResult("t1", 50, { greeting: "hi" });
      const [entry] = acc.toArray();
      expect(entry.costMicros).toBeUndefined();
      expect(entry.inputTokens).toBeUndefined();
      expect(entry.outputTokens).toBeUndefined();
      expect(entry.output).toEqual({ greeting: "hi" });
    });
  });

  describe("taskFailed", () => {
    it("records error and preserves startedAt", () => {
      const acc = new TaskStatusAccumulator();
      acc.taskStartedWithInput("t1", "call:http", { url: "bad" });
      acc.taskFailed("t1", "connection timeout");
      const [entry] = acc.toArray();
      expect(entry.status).toBe("failed");
      expect(entry.error).toBe("connection timeout");
      expect(entry.input).toEqual({ url: "bad" });
    });
  });

  describe("setTaskMetadata", () => {
    it("adds metadata to an existing entry", () => {
      const acc = new TaskStatusAccumulator();
      acc.taskStarted("agentTask", "call:agent");
      acc.setTaskMetadata("agentTask", { agent_execution_id: "exec-123" });
      const [entry] = acc.toArray();
      expect(entry.metadata).toEqual({ agent_execution_id: "exec-123" });
    });

    it("merges with existing metadata", () => {
      const acc = new TaskStatusAccumulator();
      acc.taskStarted("t1", "call:agent");
      acc.setTaskMetadata("t1", { agent_execution_id: "e1" });
      acc.setTaskMetadata("t1", { tool_call_count: 3 });
      const [entry] = acc.toArray();
      expect(entry.metadata).toEqual({
        agent_execution_id: "e1",
        tool_call_count: 3,
      });
    });

    it("is a no-op for unknown task names", () => {
      const acc = new TaskStatusAccumulator();
      acc.setTaskMetadata("nonexistent", { key: "val" });
      expect(acc.toArray()).toHaveLength(0);
    });
  });

  describe("toArray", () => {
    it("returns entries in insertion order", () => {
      const acc = new TaskStatusAccumulator();
      acc.taskStarted("a", "set");
      acc.taskStarted("b", "call:http");
      acc.taskStarted("c", "switch");
      const names = acc.toArray().map(e => e.taskName);
      expect(names).toEqual(["a", "b", "c"]);
    });
  });

  describe("taskId generation", () => {
    it("generates taskId as taskName:attemptNumber for first attempt", () => {
      const acc = new TaskStatusAccumulator();
      acc.taskStarted("validate", "call:http");
      expect(acc.toArray()[0].taskId).toBe("validate:1");
    });

    it("increments attempt on repeated taskStarted calls for the same task", () => {
      const acc = new TaskStatusAccumulator();
      acc.taskStarted("flaky", "call:http");
      expect(acc.toArray()[0].taskId).toBe("flaky:1");

      acc.taskStarted("flaky", "call:http");
      expect(acc.toArray()[0].taskId).toBe("flaky:2");
    });

    it("preserves taskId from taskStarted through taskStartedWithInput", () => {
      const acc = new TaskStatusAccumulator();
      acc.taskStarted("t1", "call:http");
      acc.taskStartedWithInput("t1", "call:http", { url: "http://example.com" });
      expect(acc.toArray()[0].taskId).toBe("t1:1");
    });

    it("preserves taskId through taskCompletedWithResult", () => {
      const acc = new TaskStatusAccumulator();
      acc.taskStarted("t1", "set");
      acc.taskCompletedWithResult("t1", 100, { greeting: "hi" });
      expect(acc.toArray()[0].taskId).toBe("t1:1");
    });

    it("preserves taskId through taskFailed", () => {
      const acc = new TaskStatusAccumulator();
      acc.taskStarted("t1", "call:http");
      acc.taskFailed("t1", "timeout");
      expect(acc.toArray()[0].taskId).toBe("t1:1");
    });

    it("assigns unique taskIds across different tasks", () => {
      const acc = new TaskStatusAccumulator();
      acc.taskStarted("a", "set");
      acc.taskStarted("b", "call:http");
      acc.taskStarted("c", "switch");
      const ids = acc.toArray().map(e => e.taskId);
      expect(ids).toEqual(["a:1", "b:1", "c:1"]);
      expect(new Set(ids).size).toBe(3);
    });

    it("assigns taskId for skipped tasks", () => {
      const acc = new TaskStatusAccumulator();
      acc.taskSkipped("conditional", "condition false");
      expect(acc.toArray()[0].taskId).toBe("conditional:1");
    });
  });
});

describe("truncatePayload", () => {
  it("returns small objects unchanged", () => {
    const obj = { name: "test", value: 42 };
    expect(truncatePayload(obj)).toEqual(obj);
  });

  it("returns null/undefined unchanged", () => {
    expect(truncatePayload(null)).toBeNull();
    expect(truncatePayload(undefined)).toBeUndefined();
  });

  it("returns strings unchanged if small", () => {
    expect(truncatePayload("hello")).toBe("hello");
  });

  it("truncates objects larger than maxBytes", () => {
    const large = { data: "x".repeat(100_000) };
    const result = truncatePayload(large, 1000) as Record<string, unknown>;
    expect(result._truncated).toBe(true);
    expect(result._original_bytes).toBeGreaterThan(1000);
    expect(typeof result._preview).toBe("string");
    expect((result._preview as string).length).toBeLessThanOrEqual(2048);
  });

  it("uses default 64KB limit", () => {
    const justUnder = { data: "x".repeat(60_000) };
    expect(truncatePayload(justUnder)).toEqual(justUnder);

    const justOver = { data: "x".repeat(70_000) };
    const result = truncatePayload(justOver) as Record<string, unknown>;
    expect(result._truncated).toBe(true);
  });

  it("handles circular references gracefully", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const result = truncatePayload(circular) as Record<string, unknown>;
    expect(result._truncated).toBe(true);
    expect(result._reason).toBe("unserializable");
  });

  it("handles arrays", () => {
    const arr = [1, 2, 3, 4, 5];
    expect(truncatePayload(arr)).toEqual(arr);
  });
});
