import { describe, it, expect } from "vitest";
import { buildRecoveryContext } from "../recovery.js";
import type { RecoveryTaskData } from "../recovery.js";

describe("buildRecoveryContext", () => {
  it("includes only completed tasks", () => {
    const tasks: RecoveryTaskData[] = [
      { taskName: "task1", status: "completed", output: { result: "ok" } },
      { taskName: "task2", status: "failed", output: undefined },
      { taskName: "task3", status: "skipped", output: undefined },
      { taskName: "task4", status: "started", output: undefined },
      { taskName: "task5", status: "completed", output: { result: "done" } },
      { taskName: "task6", status: "waiting_approval", output: undefined },
    ];

    const ctx = buildRecoveryContext(tasks);

    expect(ctx.completedTasks.size).toBe(2);
    expect(ctx.completedTasks.has("task1")).toBe(true);
    expect(ctx.completedTasks.has("task5")).toBe(true);
    expect(ctx.completedTasks.has("task2")).toBe(false);
    expect(ctx.completedTasks.has("task3")).toBe(false);
    expect(ctx.completedTasks.has("task4")).toBe(false);
    expect(ctx.completedTasks.has("task6")).toBe(false);
  });

  it("detects truncated outputs", () => {
    const tasks: RecoveryTaskData[] = [
      {
        taskName: "truncated_task",
        status: "completed",
        output: { _truncated: true, _original_bytes: 100000, _preview: "{...}" },
      },
      {
        taskName: "normal_task",
        status: "completed",
        output: { data: "small" },
      },
    ];

    const ctx = buildRecoveryContext(tasks);

    expect(ctx.completedTasks.get("truncated_task")!.isTruncated).toBe(true);
    expect(ctx.completedTasks.get("normal_task")!.isTruncated).toBe(false);
  });

  it("returns empty context for empty tasks array", () => {
    const ctx = buildRecoveryContext([]);
    expect(ctx.completedTasks.size).toBe(0);
  });

  it("handles null output", () => {
    const tasks: RecoveryTaskData[] = [
      { taskName: "null_output", status: "completed", output: null },
    ];

    const ctx = buildRecoveryContext(tasks);

    expect(ctx.completedTasks.has("null_output")).toBe(true);
    expect(ctx.completedTasks.get("null_output")!.output).toBeNull();
    expect(ctx.completedTasks.get("null_output")!.isTruncated).toBe(false);
  });

  it("handles undefined output", () => {
    const tasks: RecoveryTaskData[] = [
      { taskName: "no_output", status: "completed", output: undefined },
    ];

    const ctx = buildRecoveryContext(tasks);

    expect(ctx.completedTasks.has("no_output")).toBe(true);
    expect(ctx.completedTasks.get("no_output")!.output).toBeUndefined();
    expect(ctx.completedTasks.get("no_output")!.isTruncated).toBe(false);
  });

  it("last entry wins for duplicate task names", () => {
    const tasks: RecoveryTaskData[] = [
      { taskName: "dup", status: "completed", output: { version: 1 } },
      { taskName: "dup", status: "completed", output: { version: 2 } },
    ];

    const ctx = buildRecoveryContext(tasks);

    expect(ctx.completedTasks.size).toBe(1);
    expect(ctx.completedTasks.get("dup")!.output).toEqual({ version: 2 });
  });

  it("does not treat non-object outputs as truncated", () => {
    const tasks: RecoveryTaskData[] = [
      { taskName: "string_output", status: "completed", output: "hello" },
      { taskName: "number_output", status: "completed", output: 42 },
      { taskName: "array_output", status: "completed", output: [1, 2, 3] },
      { taskName: "bool_output", status: "completed", output: true },
    ];

    const ctx = buildRecoveryContext(tasks);

    for (const [, task] of ctx.completedTasks) {
      expect(task.isTruncated).toBe(false);
    }
  });

  it("skips tasks with unknown status", () => {
    const tasks: RecoveryTaskData[] = [
      { taskName: "unknown", status: "unknown", output: { data: 1 } },
      { taskName: "good", status: "completed", output: { data: 2 } },
    ];

    const ctx = buildRecoveryContext(tasks);

    expect(ctx.completedTasks.size).toBe(1);
    expect(ctx.completedTasks.has("unknown")).toBe(false);
    expect(ctx.completedTasks.has("good")).toBe(true);
  });
});
