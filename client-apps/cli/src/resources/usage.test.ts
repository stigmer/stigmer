import { create, toJson } from "@bufbuild/protobuf";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import {
  GetAgentUsageReportOutputSchema,
  GetOrgUsageReportOutputSchema,
  GetSessionUsageReportOutputSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
import { describe, expect, it } from "vitest";
import { renderAgentUsage, renderOrgUsage, renderSessionUsage } from "./usage.js";

const sessionReport = create(GetSessionUsageReportOutputSchema, {
  sessionId: "ses_1",
  executionCount: 1,
  firstExecutionAt: "2026-03-01T10:00:00Z",
  lastExecutionAt: "2026-03-01T11:00:00Z",
  totalUsage: { inputTokens: 12500n, cacheReadInputTokens: 5000n },
  modelBreakdown: [
    { model: "claude-sonnet-4", inputTokens: 12500n, outputTokens: 1800n, cacheReadInputTokens: 5000n, billableCostMicros: 74000n },
  ],
  executions: [
    {
      startedAt: "2026-03-01T10:00:00Z",
      inputTokens: 12500n,
      outputTokens: 1800n,
      billableCostMicros: 74000n,
      primaryModel: "claude-sonnet-4",
      phase: ExecutionPhase.EXECUTION_COMPLETED,
    },
  ],
});

describe("renderSessionUsage", () => {
  it("emits protojson for json (DD-005 divergence: not Go's encoding/json)", () => {
    const json = JSON.parse(renderSessionUsage(sessionReport, "json"));
    expect(json).toEqual(toJson(GetSessionUsageReportOutputSchema, sessionReport, { useProtoFieldName: true }));
  });

  it("renders a human table with cost, token, model, and cache detail", () => {
    const out = renderSessionUsage(sessionReport, "table");
    expect(out).toContain("Session: ses_1");
    expect(out).toContain("$0.074"); // sub-dollar → 3 decimals
    expect(out).toContain("12.5K"); // compact token count
    expect(out).toContain("claude-sonnet-4");
    expect(out).toContain("40% cached"); // 5000 / 12500
    expect(out).toContain("completed");
  });
});

const agentReport = create(GetAgentUsageReportOutputSchema, {
  agentId: "agt_1",
  agentName: "Reviewer",
  totalSessions: 2,
  totalExecutions: 4,
  totalBillableCostMicros: 4_000_000n,
  modelBreakdown: [{ model: "claude-sonnet-4", inputTokens: 1000n, outputTokens: 200n, billableCostMicros: 4_000_000n }],
  sessions: [{ sessionId: "ses_1", executionCount: 4, billableCostMicros: 4_000_000n, firstExecutionAt: "2026-03-01T10:00:00Z", lastExecutionAt: "2026-03-02T10:00:00Z" }],
});

describe("renderAgentUsage", () => {
  it("emits protojson for yaml", () => {
    const out = renderAgentUsage(agentReport, { from: "", to: "" }, "yaml");
    expect(out).toContain("agent_id: agt_1");
  });

  it("renders summary stats with an average per execution", () => {
    const out = renderAgentUsage(agentReport, { from: "2026-03-01", to: "2026-03-13" }, "table");
    expect(out).toContain("Agent:  Reviewer");
    expect(out).toContain("Period: 2026-03-01 to 2026-03-13");
    expect(out).toContain("$4.00"); // total cost, dollar+ → 2 decimals
    expect(out).toContain("$1.00"); // avg/exec = 4.00 / 4
    expect(out).toContain("100.0%"); // single model = 100% share
  });
});

const orgReport = create(GetOrgUsageReportOutputSchema, {
  totalAgents: 3,
  totalSessions: 5,
  totalExecutions: 10,
  totalBillableCostMicros: 10_000_000n,
  modelBreakdown: [{ model: "claude-sonnet-4", inputTokens: 1000n, billableCostMicros: 10_000_000n }],
  topAgentsByCost: [{ agentId: "agt_1", agentName: "Reviewer", executionCount: 6, billableCostMicros: 6_000_000n }],
  dailyCosts: [{ date: "2026-03-01", executionCount: 4, billableCostMicros: 4_000_000n }],
});

describe("renderOrgUsage", () => {
  it("renders org summary, top agents, and daily trend", () => {
    const out = renderOrgUsage(orgReport, { from: "2026-03-01", to: "2026-03-31" }, "table");
    expect(out).toContain("Organization Usage Report");
    expect(out).toContain("Agents:       3");
    expect(out).toContain("Reviewer");
    expect(out).toContain("2026-03-01");
    expect(out).toContain("60.0%"); // 6M of 10M total
  });
});
