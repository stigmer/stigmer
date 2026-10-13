/**
 * Pins the usage reports' arithmetic (usage-fold.ts): how one run is
 * counted (the meter's rows, else its runner's report mapped per harness,
 * else nothing) and how counted runs fold into the aggregate, the model
 * breakdown and the per-run, per-session, per-agent, per-day and
 * per-harness rows.
 *
 * The runner-report fixtures are shaped like the two harnesses' real
 * reports. Native: LangChain's usage metadata counts the cache inside
 * input_tokens (runner src/activities/execute-deep-agent/turn-stream.ts),
 * and the runner's total is input + output. Cursor: the Cursor SDK reports
 * disjoint buckets and sums all four for its own total (`toTokenUsage` in
 * @cursor/sdk), while the runner's stored Cursor total is input + output
 * and so leaves out the cache (#2206); the fold recomputes it.
 */
import { create } from "@bufbuild/protobuf";
import type { MessageInitShape } from "@bufbuild/protobuf";
import { timestampFromMs } from "@bufbuild/protobuf/wkt";
import { describe, expect, it } from "vitest";

import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import {
  ProviderKeySource,
  StreamingUsageSummarySchema,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/usage_pb";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";

import type { MeteredUsageRow } from "../../../extensions/metered-usage.js";
import {
  aggregateOf,
  countRun,
  dailyUsageOf,
  harnessName,
  harnessUsageOf,
  modelBreakdownOf,
  runSummaryOf,
  runnerReportRows,
  sessionSummariesOf,
  topAgentsOf,
  totalTokensOf,
} from "../usage-fold.js";

/** A native run's report: input 18,432 of which 15,000 cache read and 2,000 cache write. */
const NATIVE_USAGE: MessageInitShape<typeof StreamingUsageSummarySchema> = {
  inputTokens: 18_432n,
  outputTokens: 1_210n,
  cacheReadTokens: 15_000n,
  cacheWriteTokens: 2_000n,
  totalTokens: 19_642n,
  turnCount: 3,
  model: "claude-sonnet-4-5",
};

/** A Cursor run's report: disjoint buckets, and the runner's input + output total. */
const CURSOR_USAGE: MessageInitShape<typeof StreamingUsageSummarySchema> = {
  inputTokens: 3_120n,
  outputTokens: 2_045n,
  cacheReadTokens: 41_800n,
  cacheWriteTokens: 0n,
  totalTokens: 5_165n,
  turnCount: 2,
  model: "composer-1",
};

function makeRun(
  id: string,
  options: {
    sessionId?: string;
    agentId?: string;
    usage?: MessageInitShape<typeof StreamingUsageSummarySchema>;
    createdAtMs?: number;
    startedAt?: string;
  } = {},
): Run {
  return create(RunSchema, {
    metadata: { id, org: "org_1" },
    spec: { target: { case: "sessionId", value: options.sessionId ?? `ses_${id}` } },
    status: {
      agentId: options.agentId ?? "agt_1",
      phase: RunPhase.RUN_COMPLETED,
      startedAt: options.startedAt ?? "",
      streamingUsage:
        options.usage === undefined
          ? undefined
          : create(StreamingUsageSummarySchema, options.usage),
      audit:
        options.createdAtMs === undefined
          ? undefined
          : { specAudit: { createdAt: timestampFromMs(options.createdAtMs) } },
    },
  });
}

function meterRow(overrides: Partial<MeteredUsageRow>): MeteredUsageRow {
  return {
    model: "claude-sonnet-4-5",
    provider: "anthropic",
    harness: "native",
    providerKeySource: ProviderKeySource.ORGANIZATION,
    inputTokens: 0n,
    outputTokens: 0n,
    cacheCreationInputTokens: 0n,
    cacheReadInputTokens: 0n,
    reasoningTokens: 0n,
    totalTokens: 0n,
    callCount: 0,
    ...overrides,
  };
}

describe("a run counted from its runner's report", () => {
  it("native: input less both cache buckets, the runner's total, no provider", () => {
    const [row] = runnerReportRows(makeRun("r1", { usage: NATIVE_USAGE }), Harness.NATIVE);
    expect(row).toEqual({
      model: "claude-sonnet-4-5",
      provider: "",
      harness: "native",
      providerKeySource: ProviderKeySource.UNSPECIFIED,
      inputTokens: 1_432n,
      outputTokens: 1_210n,
      cacheCreationInputTokens: 2_000n,
      cacheReadInputTokens: 15_000n,
      reasoningTokens: 0n,
      totalTokens: 19_642n,
      callCount: 0,
    });
  });

  it("an unset harness is the native one", () => {
    const [row] = runnerReportRows(makeRun("r1", { usage: NATIVE_USAGE }), Harness.UNSPECIFIED);
    expect(row?.harness).toBe("native");
    expect(row?.inputTokens).toBe(1_432n);
  });

  it("Cursor: input as reported, total recomputed from all four buckets, provider cursor", () => {
    const [row] = runnerReportRows(makeRun("r1", { usage: CURSOR_USAGE }), Harness.CURSOR);
    expect(row?.inputTokens).toBe(3_120n);
    expect(row?.cacheReadInputTokens).toBe(41_800n);
    expect(row?.cacheCreationInputTokens).toBe(0n);
    expect(row?.outputTokens).toBe(2_045n);
    expect(row?.totalTokens, "not the runner's 5,165").toBe(46_965n);
    expect(row?.provider).toBe("cursor");
    expect(row?.harness).toBe("cursor");
  });

  it("native input never goes below zero", () => {
    const [row] = runnerReportRows(
      makeRun("r1", { usage: { inputTokens: 10n, cacheReadTokens: 30n, outputTokens: 5n, totalTokens: 15n } }),
      Harness.NATIVE,
    );
    expect(row?.inputTokens).toBe(0n);
  });

  it("is estimated, with served_by summing to the total under UNSPECIFIED", () => {
    const counted = countRun(makeRun("r1", { usage: NATIVE_USAGE }), undefined, Harness.NATIVE);
    expect(counted.estimated).toBe(true);
    const aggregate = aggregateOf([counted]);
    expect(aggregate.totalTokens).toBe(19_642n);
    expect(aggregate.inputTokens).toBe(1_432n);
    expect(aggregate.llmCallCount).toBe(0);
    expect(aggregate.primaryModel).toBe("claude-sonnet-4-5");
    expect(aggregate.primaryProvider).toBe("");
    expect(aggregate.servedBy.map((s) => [s.providerKeySource, s.totalTokens, s.llmCallCount])).toEqual([
      [ProviderKeySource.UNSPECIFIED, 19_642n, 0],
    ]);
  });

  it("a run with no report, or a report with no tokens, adds nothing and is not estimated", () => {
    for (const run of [makeRun("r1"), makeRun("r2", { usage: { turnCount: 0 } })]) {
      const counted = countRun(run, undefined, Harness.NATIVE);
      expect(counted.rows).toEqual([]);
      expect(counted.estimated).toBe(false);
    }
    const aggregate = aggregateOf([countRun(makeRun("r3"), undefined, Harness.NATIVE)]);
    expect(aggregate.totalTokens).toBe(0n);
    expect(aggregate.servedBy).toEqual([]);
  });
});

describe("a run counted from the meter", () => {
  it("takes the meter's rows over the runner's report, not estimated, a nameless row taking the run's harness", () => {
    const counted = countRun(
      makeRun("r1", { usage: CURSOR_USAGE }),
      { rows: [meterRow({ harness: "", totalTokens: 100n, callCount: 1 })] },
      Harness.CURSOR,
    );
    expect(counted.estimated).toBe(false);
    expect(counted.rows).toHaveLength(1);
    expect(counted.rows[0]?.harness).toBe("cursor");
    expect(totalTokensOf(counted)).toBe(100n);
  });

  it("sums two models per model, ordered by tokens, served by the organization", () => {
    const counted = countRun(
      makeRun("r1"),
      {
        rows: [
          meterRow({ model: "gpt-5", provider: "openai", inputTokens: 100n, outputTokens: 50n, totalTokens: 150n, callCount: 2 }),
          meterRow({
            inputTokens: 400n,
            outputTokens: 200n,
            cacheReadInputTokens: 1_000n,
            cacheCreationInputTokens: 100n,
            totalTokens: 1_700n,
            callCount: 3,
          }),
        ],
      },
      Harness.NATIVE,
    );
    const models = modelBreakdownOf([counted]);
    expect(models.map((m) => [m.model, m.provider, m.totalTokens, m.callCount])).toEqual([
      ["claude-sonnet-4-5", "anthropic", 1_700n, 3],
      ["gpt-5", "openai", 150n, 2],
    ]);
    const aggregate = aggregateOf([counted]);
    expect(aggregate.totalTokens).toBe(1_850n);
    expect(aggregate.llmCallCount).toBe(5);
    expect(aggregate.primaryModel).toBe("claude-sonnet-4-5");
    expect(aggregate.primaryProvider).toBe("anthropic");
    expect(aggregate.servedBy.map((s) => [s.providerKeySource, s.totalTokens, s.llmCallCount])).toEqual([
      [ProviderKeySource.ORGANIZATION, 1_850n, 5],
    ]);
  });
});

describe("folding several runs", () => {
  const metered = countRun(
    makeRun("m1", { sessionId: "ses_a", agentId: "agt_small", createdAtMs: Date.UTC(2026, 9, 12, 23, 59), startedAt: "2026-10-13T00:01:00Z" }),
    { rows: [meterRow({ totalTokens: 500n, callCount: 4 })] },
    Harness.NATIVE,
  );
  const estimated = countRun(
    makeRun("e1", { sessionId: "ses_a", agentId: "agt_big", usage: CURSOR_USAGE, createdAtMs: Date.UTC(2026, 9, 13, 9), startedAt: "2026-10-13T09:00:01Z" }),
    undefined,
    Harness.CURSOR,
  );
  const empty = countRun(
    makeRun("z1", { sessionId: "ses_b", agentId: "agt_small", createdAtMs: Date.UTC(2026, 9, 13, 10) }),
    undefined,
    Harness.NATIVE,
  );
  const noStamp = countRun(makeRun("n1", { sessionId: "ses_b", agentId: "", usage: NATIVE_USAGE }), undefined, Harness.NATIVE);
  const all = [metered, estimated, empty, noStamp];

  it("served_by rows sum exactly to the aggregate, the unknown server under UNSPECIFIED", () => {
    const aggregate = aggregateOf(all);
    expect(aggregate.totalTokens).toBe(500n + 46_965n + 19_642n);
    expect(aggregate.llmCallCount).toBe(4);
    const served = aggregate.servedBy;
    expect(served.reduce((sum, s) => sum + s.totalTokens, 0n)).toBe(aggregate.totalTokens);
    expect(served.reduce((sum, s) => sum + s.llmCallCount, 0)).toBe(aggregate.llmCallCount);
    expect(served.map((s) => s.providerKeySource)).toEqual([ProviderKeySource.UNSPECIFIED, ProviderKeySource.ORGANIZATION]);
    expect(aggregate.primaryModel, "the model with the most tokens").toBe("composer-1");
    expect(aggregate.primaryProvider).toBe("cursor");
  });

  it("per-run rows carry total tokens and whether they are estimated", () => {
    const rows = all.map((counted, index) => runSummaryOf(counted, index));
    expect(rows.map((r) => [r.runId, r.totalTokens, r.isEstimated, r.primaryModel, r.subAgentCount])).toEqual([
      ["m1", 500n, false, "claude-sonnet-4-5", 0],
      ["e1", 46_965n, true, "composer-1", 1],
      ["z1", 0n, false, "", 2],
      ["n1", 19_642n, true, "claude-sonnet-4-5", 3],
    ]);
    expect(rows[1]?.inputTokens).toBe(3_120n);
    expect(rows[1]?.cacheReadInputTokens).toBe(41_800n);
  });

  it("agents order by tokens and cap; sessions total their runs", () => {
    expect(topAgentsOf(all, 10).map((a) => [a.agentId, a.runCount, a.totalTokens])).toEqual([
      ["agt_big", 1, 46_965n],
      ["", 1, 19_642n],
      ["agt_small", 2, 500n],
    ]);
    expect(topAgentsOf(all, 1).map((a) => a.agentId)).toEqual(["agt_big"]);
    expect(sessionSummariesOf(all).map((s) => [s.sessionId, s.runCount, s.totalTokens, s.firstRunAt])).toEqual([
      ["ses_a", 2, 47_465n, "2026-10-13T00:01:00Z"],
      ["ses_b", 2, 19_642n, ""],
    ]);
  });

  it("daily rows are UTC days of creation; a run with no stamp has no day", () => {
    expect(dailyUsageOf(all).map((d) => [d.date, d.runCount, d.totalTokens, d.llmCallCount])).toEqual([
      ["2026-10-12", 1, 500n, 4],
      ["2026-10-13", 2, 46_965n, 0],
    ]);
  });

  it("harness rows order by tokens and count the distinct runs that contributed", () => {
    expect(harnessUsageOf(all).map((h) => [h.harness, h.totalTokens, h.callCount, h.runCount])).toEqual([
      ["cursor", 46_965n, 0, 1],
      ["native", 20_142n, 4, 2],
    ]);
  });

  it("names harnesses as the rest of the server does", () => {
    expect(harnessName(Harness.CURSOR)).toBe("cursor");
    expect(harnessName(Harness.NATIVE)).toBe("native");
    expect(harnessName(Harness.UNSPECIFIED)).toBe("native");
  });

  it("a harness value this build does not know is named native, the platform default", () => {
    expect(harnessName(99 as Harness)).toBe("native");
  });

  it("an empty fold is zero everywhere", () => {
    expect(aggregateOf([]).totalTokens).toBe(0n);
    expect(modelBreakdownOf([])).toEqual([]);
    expect(dailyUsageOf([])).toEqual([]);
    expect(harnessUsageOf([])).toEqual([]);
    expect(topAgentsOf([], 10)).toEqual([]);
  });
});
