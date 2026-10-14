// Tests for the `stigmer usage` renderers: json and yaml are the report's
// protojson; the tables count tokens and never show a price. They pin
// working time (a "Working time:" line and a WORKING column, as hours and
// minutes, never days), the agent hours line for each kind of plan (a
// pausing allowance before and after it is used, a priced one, no
// allowance; "this month" on Free's calendar month), the hours formatter's
// half-up tenth and the working-time formatter's units. They also pin the
// TOKENS and SHARE columns (share of the report's tokens), the total and
// per-run average in tokens, the "estimated" marks on a session and its
// runner-reported runs, the served-by line (a plain name for one known
// source, a split only when more than one known source served tokens,
// nothing when none is known, a source this build does not know by its
// number), the org report's top agents, harness split
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
import { timestampFromMs } from "@bufbuild/protobuf/wkt";
import {
  AgentHoursSchema,
  AgentHoursWindow,
} from "@stigmer/protos/ai/stigmer/billing/subscription/v1/io_pb";
import { describe, expect, it } from "vitest";
import type { Stigmer } from "@stigmer/sdk";
import {
  formatAgentHours,
  formatServedBy,
  formatWorkingTime,
  getAgentHours,
  getAgentUsageReport,
  getOrgUsageReport,
  renderAgentHours,
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
    workingSeconds: 312n,
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
      workingSeconds: 252n,
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
    expect(out).toContain("Working time: 5m 12s");
    expect(out).toMatch(/#\s+DATE\s+TOKENS\s+WORKING\s+MODEL\s+STATUS/);
    expect(out).toMatch(/1\s+Mar 01\s+12\.0k\s+4m 12s\s+claude-sonnet-4\s+completed/);
    expect(out).toMatch(/2\s+Mar 01\s+~2\.3k\s+0s\s+claude-sonnet-4\s+completed/);
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

  it("names a source this build does not know by its number", () => {
    expect(
      formatServedBy(
        aggregate([
          { source: org, tokens: 3000n },
          { source: 7 as ProviderKeySource, tokens: 1000n },
        ]),
      ),
    ).toBe("your keys 3.0k (75.0%) · source 7 1.0k (25.0%)");
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
  sessions: [{ sessionId: "ses_1", runCount: 4, totalTokens: 4000n, firstRunAt: "2026-03-01T10:00:00Z", lastRunAt: "2026-03-02T10:00:00Z", workingSeconds: 7_260n }],
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
    expect(out).toContain("Working time: 0s"); // the aggregate carries none
    expect(out).toMatch(/#\s+PERIOD\s+RUNS\s+TOKENS\s+WORKING/);
    expect(out).toMatch(/1\s+Mar 01 to Mar 02\s+4\s+4\.0k\s+2h 1m/);
    expect(out).not.toContain("Served by"); // no known source
    expect(out).not.toMatch(/\$|COST|cost/);
  });

  it("names who served the agent's tokens when a known source did", () => {
    const served = create(GetAgentUsageReportOutputSchema, {
      ...agentReport,
      totalUsage: create(UsageReportAggregateSchema, {
        totalTokens: 4000n,
        servedBy: [{ providerKeySource: ProviderKeySource.ORGANIZATION, totalTokens: 4000n, llmCallCount: 9 }],
      }),
    });
    expect(renderAgentUsage(served, { from: "", to: "" }, "table")).toContain("Served by:    your keys");
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
    workingSeconds: 1_123_500n,
  },
  modelBreakdown: [{ model: "claude-sonnet-4", totalTokens: 10_000n }],
  topAgents: [{ agentId: "agt_1", agentName: "Reviewer", runCount: 6, totalTokens: 6000n, workingSeconds: 42n }],
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
    expect(out).toContain("Working time: 312h 5m"); // never days
    expect(out).toMatch(/AGENT\s+RUNS\s+TOKENS\s+SHARE\s+WORKING/);
    expect(out).toMatch(/Reviewer\s+6\s+6\.0k\s+60\.0%\s+42s/);
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

describe("the hours and working-time formatters", () => {
  it("prints agent hours to the tenth, rounded half up", () => {
    expect(formatAgentHours(0n)).toBe("0.0 h");
    expect(formatAgentHours(179n)).toBe("0.0 h");
    expect(formatAgentHours(180n)).toBe("0.1 h"); // half a tenth rounds up
    expect(formatAgentHours(66_240n)).toBe("18.4 h");
    expect(formatAgentHours(36_000n)).toBe("10.0 h");
  });

  it("prints working time in hours and minutes, never days", () => {
    expect(formatWorkingTime(0n)).toBe("0s");
    expect(formatWorkingTime(42n)).toBe("42s");
    expect(formatWorkingTime(252n)).toBe("4m 12s");
    expect(formatWorkingTime(3_600n)).toBe("1h 0m");
    expect(formatWorkingTime(1_123_500n)).toBe("312h 5m");
  });
});

describe("renderAgentHours", () => {
  const RESET = timestampFromMs(Date.UTC(2026, 10, 1));
  const free = (workingSeconds: bigint) =>
    create(AgentHoursSchema, {
      workingSeconds,
      includedHours: 10,
      windowStart: timestampFromMs(Date.UTC(2026, 9, 1)),
      windowEnd: RESET,
      window: AgentHoursWindow.calendar_month,
    });

  it("on a pausing plan: the month's hours of those included, the reset, and the pause", () => {
    expect(renderAgentHours(free(11_520n), "table")).toBe(
      "Agent hours: 3.2 h of 10 h used this month (resets 2026-11-01 UTC). New work pauses at the allowance.\n",
    );
  });

  it("past a pausing allowance: new work is paused until the reset", () => {
    expect(renderAgentHours(free(36_000n), "table")).toBe(
      "Agent hours: 10.0 h of 10 h used this month (resets 2026-11-01 UTC). New work is paused until the reset.\n",
    );
  });

  it("on a priced plan: the period's hours and the price of each hour past them", () => {
    const priced = create(AgentHoursSchema, {
      workingSeconds: 66_240n,
      includedHours: 25,
      perAgentHourMicros: 500_000n,
      windowEnd: RESET,
      window: AgentHoursWindow.billing_period,
    });
    expect(renderAgentHours(priced, "table")).toBe(
      "Agent hours: 18.4 h of 25 h used this period (resets 2026-11-01 UTC). Then $0.50 an hour, on this period's invoice.\n",
    );
  });

  it("on a plan with no allowance: the hours alone", () => {
    const unlimited = create(AgentHoursSchema, {
      workingSeconds: 66_240n,
      windowEnd: RESET,
      window: AgentHoursWindow.billing_period,
    });
    expect(renderAgentHours(unlimited, "table")).toBe("Agent hours: 18.4 h used this period (resets 2026-11-01 UTC).\n");
  });

  it("emits protojson for json", () => {
    const hours = free(11_520n);
    expect(JSON.parse(renderAgentHours(hours, "json"))).toEqual(toJson(AgentHoursSchema, hours, { useProtoFieldName: true }));
  });

  it("getAgentHours asks the subscription service for the organization", async () => {
    let seen: unknown;
    const client = {
      subscription: { getAgentHours: async (input: unknown) => ((seen = input), free(0n)) },
    } as unknown as Stigmer;
    await getAgentHours(client, "acme");
    expect(seen).toMatchObject({ org: "acme" });
  });
});
