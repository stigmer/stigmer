/**
 * Pins the usage aggregation helpers against Go's usage_aggregation_test.go
 * case-for-case: the OSS zero-value posture (no llm_call_usage_record
 * collection here — every aggregate is structurally valid and zero), the
 * date/org/agent filters, grouping, distinct sets, daily entries, and the
 * top-agents cap.
 */
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { AgentUsageSummarySchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";

import {
  aggregateUsageReport,
  buildDailyCostEntries,
  buildExecutionSummary,
  buildSessionSummary,
  earliestStartedAt,
  extractDate,
  filterByDateRange,
  filterByOrg,
  groupByDate,
  groupBySessionId,
  latestStartedAt,
  mergeModelBreakdowns,
  topAgentsByCost,
} from "../usage.js";

function makeExecution(
  id: string,
  sessionId: string,
  agentId: string,
  org: string,
  startedAt: string,
  subAgentCount = 0,
): AgentExecution {
  return create(AgentExecutionSchema, {
    metadata: { id, name: `exec-${id}`, org },
    spec: { sessionId, agentId },
    status: {
      startedAt,
      completedAt: startedAt,
      phase: ExecutionPhase.EXECUTION_COMPLETED,
      subAgentExecutions: Array.from({ length: subAgentCount }, () => ({})),
    },
  });
}

describe("usage aggregation (OSS zero-value posture)", () => {
  it("aggregateUsageReport returns zero", () => {
    const agg = aggregateUsageReport();
    expect(agg.inputTokens).toBe(0n);
    expect(agg.outputTokens).toBe(0n);
    expect(agg.totalTokens).toBe(0n);
    expect(agg.llmCallCount).toBe(0);
    expect(agg.billableCostMicros).toBe(0n);
  });

  it("mergeModelBreakdowns returns empty", () => {
    expect(mergeModelBreakdowns()).toHaveLength(0);
  });

  it("buildExecutionSummary projects identity fields with zero usage", () => {
    const summary = buildExecutionSummary(
      makeExecution("e1", "s1", "a1", "org", "2026-03-10T10:00:00Z", 1),
    );
    expect(summary.executionId).toBe("e1");
    expect(summary.startedAt).toBe("2026-03-10T10:00:00Z");
    expect(summary.subAgentCount).toBe(1);
    expect(summary.phase).toBe(ExecutionPhase.EXECUTION_COMPLETED);
    expect(summary.inputTokens, "OSS has no usage data").toBe(0n);
    expect(summary.billableCostMicros, "OSS has no usage data").toBe(0n);
  });

  it("filterByDateRange applies inclusive string bounds", () => {
    const executions = [
      makeExecution("e1", "s1", "a1", "org", "2026-03-01T10:00:00Z"),
      makeExecution("e2", "s1", "a1", "org", "2026-03-05T10:00:00Z"),
      makeExecution("e3", "s1", "a1", "org", "2026-03-10T10:00:00Z"),
      makeExecution("e4", "s1", "a1", "org", "2026-03-15T10:00:00Z"),
    ];
    expect(filterByDateRange(executions, "2026-03-03", "2026-03-12")).toHaveLength(2);
    expect(filterByDateRange(executions, "2026-03-10", "")).toHaveLength(2);
    expect(filterByDateRange(executions, "", "2026-03-05T10:00:00Z")).toHaveLength(2);
    expect(filterByDateRange(executions, "", "")).toHaveLength(4);
  });

  it("groupBySessionId groups by spec.session_id", () => {
    const groups = groupBySessionId([
      makeExecution("e1", "s1", "a1", "org", ""),
      makeExecution("e2", "s1", "a1", "org", ""),
      makeExecution("e3", "s2", "a1", "org", ""),
    ]);
    expect(groups.size).toBe(2);
    expect(groups.get("s1")).toHaveLength(2);
    expect(groups.get("s2")).toHaveLength(1);
  });

  it("groupByDate groups by the YYYY-MM-DD prefix", () => {
    const groups = groupByDate([
      makeExecution("e1", "s1", "a1", "org", "2026-03-10T08:00:00Z"),
      makeExecution("e2", "s1", "a1", "org", "2026-03-10T14:00:00Z"),
      makeExecution("e3", "s1", "a1", "org", "2026-03-11T09:00:00Z"),
    ]);
    expect(groups.size).toBe(2);
    expect(groups.get("2026-03-10")).toHaveLength(2);
  });

  it("buildSessionSummary carries the time span with zero usage", () => {
    const summary = buildSessionSummary("s1", [
      makeExecution("e1", "s1", "a1", "org", "2026-03-10T08:00:00Z"),
      makeExecution("e2", "s1", "a1", "org", "2026-03-10T14:00:00Z"),
    ]);
    expect(summary.sessionId).toBe("s1");
    expect(summary.executionCount).toBe(2);
    expect(summary.totalTokens, "OSS has no usage data").toBe(0n);
    expect(summary.billableCostMicros, "OSS has no usage data").toBe(0n);
    expect(summary.firstExecutionAt).toBe("2026-03-10T08:00:00Z");
  });

  it("buildDailyCostEntries sorts chronologically with zero cost", () => {
    const entries = buildDailyCostEntries([
      makeExecution("e1", "s1", "a1", "org", "2026-03-10T08:00:00Z"),
      makeExecution("e2", "s1", "a1", "org", "2026-03-10T14:00:00Z"),
      makeExecution("e3", "s1", "a1", "org", "2026-03-11T09:00:00Z"),
    ]);
    expect(entries).toHaveLength(2);
    expect(entries[0]?.date).toBe("2026-03-10");
    expect(entries[0]?.executionCount).toBe(2);
    expect(entries[0]?.totalTokens, "OSS has no usage data").toBe(0n);
    expect(entries[1]?.date).toBe("2026-03-11");
  });

  it("topAgentsByCost ranks descending and caps", () => {
    const top = topAgentsByCost(
      [
        create(AgentUsageSummarySchema, { agentId: "a1", billableCostMicros: 1_000_000n }),
        create(AgentUsageSummarySchema, { agentId: "a2", billableCostMicros: 5_000_000n }),
        create(AgentUsageSummarySchema, { agentId: "a3", billableCostMicros: 500_000n }),
        create(AgentUsageSummarySchema, { agentId: "a4", billableCostMicros: 3_000_000n }),
      ],
      2,
    );
    expect(top).toHaveLength(2);
    expect(top[0]?.agentId).toBe("a2");
    expect(top[1]?.agentId).toBe("a4");
  });

  it("filterByOrg matches case-insensitively", () => {
    const executions = [
      makeExecution("e1", "s1", "a1", "org-a", ""),
      makeExecution("e2", "s1", "a1", "org-b", ""),
      makeExecution("e3", "s1", "a1", "org-a", ""),
    ];
    expect(filterByOrg(executions, "org-a")).toHaveLength(2);
    // Go strings.EqualFold semantics.
    expect(filterByOrg(executions, "ORG-A")).toHaveLength(2);
  });

  it("extractDate takes the 10-char prefix or nothing", () => {
    expect(extractDate("2026-03-10T08:00:00Z")).toBe("2026-03-10");
    expect(extractDate("2026-03-10")).toBe("2026-03-10");
    expect(extractDate("short")).toBe("");
    expect(extractDate("")).toBe("");
  });

  it("earliest/latestStartedAt skip empties and compare as strings", () => {
    const executions = [
      makeExecution("e1", "s1", "a1", "org", "2026-03-10T14:00:00Z"),
      makeExecution("e2", "s1", "a1", "org", "2026-03-05T09:00:00Z"),
      makeExecution("e3", "s1", "a1", "org", "2026-03-12T08:00:00Z"),
    ];
    expect(earliestStartedAt(executions)).toBe("2026-03-05T09:00:00Z");
    expect(latestStartedAt(executions)).toBe("2026-03-12T08:00:00Z");
  });

  it("empty inputs answer zero shapes everywhere", () => {
    expect(aggregateUsageReport().totalTokens).toBe(0n);
    expect(mergeModelBreakdowns()).toHaveLength(0);
    expect(buildDailyCostEntries([])).toHaveLength(0);
    expect(earliestStartedAt([])).toBe("");
  });
});
