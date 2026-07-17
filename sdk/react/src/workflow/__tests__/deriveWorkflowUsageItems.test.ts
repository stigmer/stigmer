import { describe, it, expect } from "vitest";
import { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import type { DerivedTaskState } from "../../internal/store/workflow-execution-event-store";
import { deriveWorkflowUsageItems } from "../deriveWorkflowUsageItems";

function taskState(overrides: Partial<DerivedTaskState> & { taskName: string }): DerivedTaskState {
  return {
    taskKind: WorkflowTaskKind.llm_call,
    status: "completed",
    durationMs: 0,
    costMicros: 0n,
    tokensUsed: 0n,
    attemptNumber: 1,
    error: "",
    childExecutionId: "",
    agentSlug: "",
    currentToolName: "",
    messagesCount: 0,
    toolCallsCount: 0,
    inputSummary: null,
    outputSummary: null,
    approvalRequest: null,
    approvalResolution: null,
    ...overrides,
  };
}

function statesOf(...states: DerivedTaskState[]): ReadonlyMap<string, DerivedTaskState> {
  return new Map(states.map((s) => [s.taskName, s]));
}

describe("deriveWorkflowUsageItems", () => {
  it("returns an empty list for no task states", () => {
    expect(deriveWorkflowUsageItems(new Map())).toEqual([]);
  });

  it("drops zero-usage rows (zero cost AND zero tokens) — the snapshot fallback degrades to empty, not fake $0.00 rows", () => {
    const items = deriveWorkflowUsageItems(
      statesOf(
        taskState({ taskName: "no_usage_a" }),
        taskState({ taskName: "no_usage_b", status: "running" }),
      ),
    );
    expect(items).toEqual([]);
  });

  it("keeps rows with tokens but no cost (live agent-call progress reports tokens before cost)", () => {
    const items = deriveWorkflowUsageItems(
      statesOf(
        taskState({
          taskName: "call_agent",
          taskKind: WorkflowTaskKind.agent_call,
          status: "running",
          tokensUsed: 1200n,
        }),
      ),
    );
    expect(items).toHaveLength(1);
    expect(items[0].taskName).toBe("call_agent");
    expect(items[0].tokensUsed).toBe(1200n);
    expect(items[0].costMicros).toBe(0n);
  });

  it("excludes skipped tasks via the zero-usage filter (the store zeroes their cost and tokens)", () => {
    const items = deriveWorkflowUsageItems(
      statesOf(
        taskState({ taskName: "skipped_task", status: "skipped" }),
        taskState({ taskName: "real_task", costMicros: 100n, tokensUsed: 50n }),
      ),
    );
    expect(items.map((i) => i.taskName)).toEqual(["real_task"]);
  });

  it("includes a retrying task that kept its prior attempt's usage", () => {
    const items = deriveWorkflowUsageItems(
      statesOf(
        taskState({ taskName: "flaky_task", status: "retrying", costMicros: 250n, tokensUsed: 900n }),
      ),
    );
    expect(items).toHaveLength(1);
    expect(items[0].status).toBe("retrying");
    expect(items[0].costMicros).toBe(250n);
  });

  it("sorts by cost descending — the most expensive task first", () => {
    const items = deriveWorkflowUsageItems(
      statesOf(
        taskState({ taskName: "cheap", costMicros: 100n, tokensUsed: 10n }),
        taskState({ taskName: "expensive", costMicros: 900_000n, tokensUsed: 10n }),
        taskState({ taskName: "middle", costMicros: 5_000n, tokensUsed: 10n }),
      ),
    );
    expect(items.map((i) => i.taskName)).toEqual(["expensive", "middle", "cheap"]);
  });

  it("breaks cost ties by tokens descending, then name (case-insensitive)", () => {
    const items = deriveWorkflowUsageItems(
      statesOf(
        taskState({ taskName: "Beta", costMicros: 100n, tokensUsed: 10n }),
        taskState({ taskName: "alpha", costMicros: 100n, tokensUsed: 10n }),
        taskState({ taskName: "more_tokens", costMicros: 100n, tokensUsed: 999n }),
      ),
    );
    expect(items.map((i) => i.taskName)).toEqual(["more_tokens", "alpha", "Beta"]);
  });

  it("orders bigint costs beyond Number.MAX_SAFE_INTEGER correctly (no Number() coercion)", () => {
    // Two values that collapse to the same Number() but differ as bigints.
    const huge = 9_007_199_254_740_993n; // 2^53 + 1
    const hugeMinusOne = 9_007_199_254_740_992n; // 2^53
    const items = deriveWorkflowUsageItems(
      statesOf(
        taskState({ taskName: "slightly_smaller", costMicros: hugeMinusOne, tokensUsed: 1n }),
        taskState({ taskName: "slightly_larger", costMicros: huge, tokensUsed: 1n }),
      ),
    );
    expect(items.map((i) => i.taskName)).toEqual(["slightly_larger", "slightly_smaller"]);
  });

  it("labels kinds through the shared kind metadata", () => {
    const items = deriveWorkflowUsageItems(
      statesOf(
        taskState({
          taskName: "call_agent",
          taskKind: WorkflowTaskKind.agent_call,
          costMicros: 100n,
        }),
      ),
    );
    expect(items[0].kindLabel).toBe("Agent Call");
  });
});
