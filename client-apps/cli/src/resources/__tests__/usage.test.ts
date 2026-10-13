// Tests for the `stigmer usage` renderers: json and yaml are the report's
// protojson; the tables count tokens and never show a price. They pin the
// TOKENS and SHARE columns (share of the report's tokens), the total and
// per-run average in tokens, the "estimated" marks on a session and its
// runner-reported runs, the served-by line (a plain name for one known
// source, a split only when more than one known source served tokens,
// nothing when none is known), the org report's top agents, harness split
// and daily trend, the cache hit rate over all input, and the request shapes
// the agent and org reports send.

import { create, toJson } from "@bufbuild/protobuf";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import {
  GetAgentUsageReportOutputSchema,
  GetOrgUsageReportOutputSchema,
  GetSessionUsageReportOutputSchema,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/io_pb";
import { ProviderKeySource, UsageReportAggregateSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/usage_pb";
import { describe, expect, it } from "vitest";
import type { Stigmer } from "@stigmer/sdk";
import {
  formatServedBy,
  getAgentUsageReport,
  getOrgUsageReport,
  renderAgentUsage,
  renderOrgUsage,
  renderSessionUsage,
} from "../usage.js";

const sessionReport = create(GetSessionUsageReportOutputSchema, {
  sessionId: "ses_1",
  runCount: 2,
  isEstimated: true,
  firstRunAt: "2026-03-01T10:00:00Z",
  lastRunAt: "2026-03-01T11:00:00Z",
  totalUsage: {
    inputTokens: 7500n,
    outputTokens: 1800n,
    cacheReadInputTokens: 5000n,
    cacheCreationInputTokens: 0n,
    totalTokens: 14_300n,
    servedBy: [{ providerKeySource: ProviderKeySource.ORGANIZATION, totalTokens: 14_300n, llmCallCount: 4 }],
  },
  modelBreakdown: [
    { model: "claude-sonnet-4", inputTokens: 7500n, outputTokens: 1800n, cacheReadInputTokens: 5000n, totalTokens: 14_300n },
  ],
  runs: [
    {
      startedAt: "2026-03-01T10:00:00Z",
      totalTokens: 12_000n,
      primaryModel: "claude-sonnet-4",
      phase: RunPhase.RUN_COMPLETED,
    },
    {
      startedAt: "2026-03-01T11:00:00Z",
      totalTokens: 2300n,
      primaryModel: "claude-sonnet-4",
      phase: RunPhase.RUN_COMPLETED,
      isEstimated: true,
    },
  ],
});

describe("renderSessionUsage", () => {
  it("emits protojson for json (a deliberate divergence from the Go CLI's encoding/json)", () => {
    const json = JSON.parse(renderSessionUsage(sessionReport, "json"));
    expect(json).toEqual(toJson(GetSessionUsageReportOutputSchema, sessionReport, { useProtoFieldName: true }));
  });

  it("renders tokens, never a price, with the estimated marks and who served them", () => {
    const out = renderSessionUsage(sessionReport, "table");
    expect(out).toContain("Session: ses_1");
    expect(out).toContain("Tokens:  14.3k (estimated)");
    expect(out).toContain("Served by: your keys");
    expect(out).toMatch(/MODEL\s+INPUT\s+OUTPUT\s+CACHED\s+TOKENS\s+SHARE/);
    expect(out).toMatch(/claude-sonnet-4\s+7\.5k\s+1\.8k\s+5\.0k\s+14\.3k\s+100\.0%/);
    expect(out).toContain("40% cached"); // 5000 of 12,500 input (7500 uncached + 5000 cached)
    expect(out).toMatch(/#\s+DATE\s+TOKENS\s+MODEL\s+STATUS/);
    expect(out).toMatch(/1\s+Mar 01\s+12\.0k\s+claude-sonnet-4\s+completed/);
    expect(out).toMatch(/2\s+Mar 01\s+~2\.3k\s+claude-sonnet-4\s+completed/);
    expect(out).toContain("~ estimated from the run's own report");
    expect(out).not.toMatch(/\$|COST|cost/);
  });

  it("drops the estimated marks when every run was metered", () => {
    const metered = create(GetSessionUsageReportOutputSchema, {
      sessionId: "ses_2",
      runCount: 1,
      totalUsage: { totalTokens: 900n },
      runs: [{ totalTokens: 900n, phase: RunPhase.RUN_COMPLETED }],
    });
    const out = renderSessionUsage(metered, "table");
    expect(out).toContain("Tokens:  900\n");
    expect(out).not.toContain("estimated");
    expect(out).not.toContain("~");
  });
});

describe("formatServedBy", () => {
  const org = ProviderKeySource.ORGANIZATION;
  const platform = ProviderKeySource.PLATFORM;
  const unrecorded = ProviderKeySource.UNSPECIFIED;
  const aggregate = (rows: { source: ProviderKeySource; tokens: bigint }[]) =>
    create(UsageReportAggregateSchema, {
      servedBy: rows.map((r) => ({ providerKeySource: r.source, totalTokens: r.tokens })),
    });

  it("prints nothing when no known source served tokens", () => {
    expect(formatServedBy(undefined)).toBe("");
    expect(formatServedBy(aggregate([]))).toBe("");
    expect(formatServedBy(aggregate([{ source: unrecorded, tokens: 5000n }]))).toBe("");
  });

  it("names a single known source, noting tokens whose server was not recorded", () => {
    expect(formatServedBy(aggregate([{ source: org, tokens: 5000n }]))).toBe("your keys");
    expect(formatServedBy(aggregate([{ source: platform, tokens: 5000n }]))).toBe("Stigmer's free model");
    expect(
      formatServedBy(
        aggregate([
          { source: org, tokens: 5000n },
          { source: unrecorded, tokens: 1500n },
        ]),
      ),
    ).toBe("your keys (1.5k tokens not recorded)");
  });

  it("ignores a source that served no tokens", () => {
    expect(
      formatServedBy(
        aggregate([
          { source: org, tokens: 5000n },
          { source: platform, tokens: 0n },
        ]),
      ),
    ).toBe("your keys");
  });

  it("splits by share when more than one known source served tokens", () => {
    expect(
      formatServedBy(
        aggregate([
          { source: org, tokens: 6000n },
          { source: platform, tokens: 3000n },
          { source: unrecorded, tokens: 1000n },
        ]),
      ),
    ).toBe("your keys 6.0k (60.0%) · Stigmer's free model 3.0k (30.0%) · not recorded 1.0k (10.0%)");
  });
});

const agentReport = create(GetAgentUsageReportOutputSchema, {
  agentId: "agt_1",
  agentName: "Reviewer",
  totalSessions: 2,
  totalRuns: 4,
  totalUsage: { totalTokens: 4000n },
  modelBreakdown: [
    { model: "claude-sonnet-4", totalTokens: 3000n },
    { model: "gpt-5", totalTokens: 1000n },
  ],
  sessions: [{ sessionId: "ses_1", runCount: 4, totalTokens: 4000n, firstRunAt: "2026-03-01T10:00:00Z", lastRunAt: "2026-03-02T10:00:00Z" }],
});

describe("renderAgentUsage", () => {
  it("emits protojson for yaml", () => {
    const out = renderAgentUsage(agentReport, { from: "", to: "" }, "yaml");
    expect(out).toContain("agent_id: agt_1");
  });

  it("renders the total and the average per run in tokens, and each model's share of them", () => {
    const out = renderAgentUsage(agentReport, { from: "2026-03-01", to: "2026-03-13" }, "table");
    expect(out).toContain("Agent:  Reviewer");
    expect(out).toContain("Period: 2026-03-01 to 2026-03-13");
    expect(out).toContain("Runs:         4");
    expect(out).toContain("Total tokens: 4.0k");
    expect(out).toContain("Avg/run:      1.0k"); // 4000 / 4
    expect(out).toMatch(/MODEL\s+TOKENS\s+SHARE/);
    expect(out).toMatch(/claude-sonnet-4\s+3\.0k\s+75\.0%/);
    expect(out).toMatch(/gpt-5\s+1\.0k\s+25\.0%/);
    expect(out).toMatch(/#\s+PERIOD\s+RUNS\s+TOKENS/);
    expect(out).not.toContain("Served by"); // no known source
    expect(out).not.toMatch(/\$|COST|cost/);
  });
});

const orgReport = create(GetOrgUsageReportOutputSchema, {
  totalAgents: 3,
  totalSessions: 5,
  totalRuns: 10,
  totalUsage: {
    totalTokens: 10_000n,
    servedBy: [
      { providerKeySource: ProviderKeySource.ORGANIZATION, totalTokens: 8000n },
      { providerKeySource: ProviderKeySource.PLATFORM, totalTokens: 2000n },
    ],
  },
  modelBreakdown: [{ model: "claude-sonnet-4", totalTokens: 10_000n }],
  topAgents: [{ agentId: "agt_1", agentName: "Reviewer", runCount: 6, totalTokens: 6000n }],
  harnessUsage: [
    { harness: "native", runCount: 7, totalTokens: 7000n, callCount: 21 },
    { harness: "cursor", runCount: 3, totalTokens: 3000n },
  ],
  dailyUsage: [{ date: "2026-03-01", runCount: 4, totalTokens: 4000n }],
});

describe("renderOrgUsage", () => {
  it("renders the org's tokens, who served them, top agents, the harness split and the daily trend", () => {
    const out = renderOrgUsage(orgReport, { from: "2026-03-01", to: "2026-03-31" }, "table");
    expect(out).toContain("Organization Usage Report");
    expect(out).toContain("Agents:       3");
    expect(out).toContain("Runs:         10");
    expect(out).toContain("Total tokens: 10.0k");
    expect(out).toContain("Served by:    your keys 8.0k (80.0%) · Stigmer's free model 2.0k (20.0%)");
    expect(out).toMatch(/AGENT\s+RUNS\s+TOKENS\s+SHARE/);
    expect(out).toMatch(/Reviewer\s+6\s+6\.0k\s+60\.0%/);
    expect(out).toMatch(/HARNESS\s+RUNS\s+TOKENS\s+SHARE/);
    expect(out).toMatch(/native\s+7\s+7\.0k\s+70\.0%/);
    expect(out).toMatch(/cursor\s+3\s+3\.0k\s+30\.0%/);
    expect(out).toMatch(/DATE\s+RUNS\s+TOKENS/);
    expect(out).toMatch(/2026-03-01\s+4\s+4\.0k/);
    expect(out).not.toMatch(/\$|COST|cost/);
  });
});

describe("the usage reports ask for the organization as org", () => {
  const range = { from: "2026-09-01", to: "2026-09-30" };

  it("getAgentUsageReport sends the agent and org with the range", async () => {
    let seen: unknown;
    const client = {
      run: { getAgentUsageReport: async (input: unknown) => ((seen = input), {}) },
    } as unknown as Stigmer;
    await getAgentUsageReport(client, "agt_1", "acme", range);
    expect(seen).toMatchObject({ agentId: "agt_1", org: "acme", fromDate: range.from, toDate: range.to });
  });

  it("getOrgUsageReport sends the org with the range", async () => {
    let seen: unknown;
    const client = {
      run: { getOrgUsageReport: async (input: unknown) => ((seen = input), {}) },
    } as unknown as Stigmer;
    await getOrgUsageReport(client, "acme", range);
    expect(seen).toMatchObject({ org: "acme", fromDate: range.from, toDate: range.to });
  });
});
