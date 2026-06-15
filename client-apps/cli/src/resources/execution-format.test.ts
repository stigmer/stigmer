import { WorkflowTaskType } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
import { describe, expect, it } from "vitest";
import { calculateDuration, formatWorkflowTaskType, truncateWithEllipsis } from "./execution-format.js";

describe("calculateDuration", () => {
  it("returns '-' when a bound is missing or unparseable", () => {
    expect(calculateDuration("", "2026-01-01T00:00:01Z")).toBe("-");
    expect(calculateDuration("2026-01-01T00:00:00Z", "")).toBe("-");
    expect(calculateDuration("not-a-date", "2026-01-01T00:00:01Z")).toBe("-");
  });

  it("formats sub-minute durations in seconds", () => {
    expect(calculateDuration("2026-01-01T00:00:00Z", "2026-01-01T00:00:42Z")).toBe("42s");
  });

  it("formats sub-hour durations as minutes and seconds", () => {
    expect(calculateDuration("2026-01-01T00:00:00Z", "2026-01-01T00:05:09Z")).toBe("5m 9s");
  });

  it("formats hour-plus durations as hours and minutes", () => {
    expect(calculateDuration("2026-01-01T00:00:00Z", "2026-01-01T02:30:00Z")).toBe("2h 30m");
  });
});

describe("truncateWithEllipsis", () => {
  it("leaves short strings untouched", () => {
    expect(truncateWithEllipsis("short", 10)).toBe("short");
  });

  it("truncates and appends an ellipsis", () => {
    expect(truncateWithEllipsis("abcdefghij", 8)).toBe("abcde...");
  });
});

describe("formatWorkflowTaskType", () => {
  it.each([
    [WorkflowTaskType.WORKFLOW_TASK_AGENT_INVOCATION, "agent"],
    [WorkflowTaskType.WORKFLOW_TASK_APPROVAL, "approval"],
    [WorkflowTaskType.WORKFLOW_TASK_API_CALL, "api_call"],
    [WorkflowTaskType.WORKFLOW_TASK_CONDITIONAL, "condition"],
    [WorkflowTaskType.WORKFLOW_TASK_PARALLEL, "parallel"],
    [WorkflowTaskType.WORKFLOW_TASK_TRANSFORM, "transform"],
    [WorkflowTaskType.WORKFLOW_TASK_CUSTOM, "custom"],
    [WorkflowTaskType.WORKFLOW_TASK_TYPE_UNSPECIFIED, "unknown"],
  ])("%s -> %s", (type, expected) => {
    expect(formatWorkflowTaskType(type)).toBe(expected);
  });
});
