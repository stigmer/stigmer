/**
 * The usage reports' arithmetic: how each run is counted, and how counted
 * runs fold into the report shapes (the aggregate, the model breakdown and
 * the per-run, per-session, per-agent, per-day and per-harness rows). Pure
 * functions over decoded runs; the pipelines in usage.ts load the runs,
 * ask the composed meter once, and call these.
 *
 * A run's working time is its session's stretches of work it started
 * (domain/session/events/working-time.ts), read by the caller and handed
 * to `countRun`; it does not depend on how the run's tokens are counted.
 *
 * Each run is counted from one source, decided once by `countRun`:
 *   - the rows the composed meter (extensions/metered-usage.ts) returned
 *     for it, when it answered for the run: not estimated;
 *   - else the run's own runner report (RunStatus.streaming_usage), mapped
 *     to the report's buckets by `runnerReportRows`: estimated;
 *   - a run with neither (no turn has ended yet) adds no tokens and is not
 *     estimated.
 *
 * The runner reports native's buckets, and Claude's normalized to them:
 * LangChain's usage metadata counts the cache inside input_tokens (runner
 * src/activities/execute-deep-agent/turn-stream.ts), so the report's
 * non-cached input is input less both cache buckets, and the runner's total
 * (input + output) is already cache-inclusive.
 * A run records no harness of its own: it runs on its session's
 * (SessionSpec.harness, which dispatch reads, temporal/agentexecution/
 * dispatch.ts), so the caller resolves it and hands it in. An unknown or
 * unset harness is the native one (session/v1 Harness).
 *
 * Fold rules the tests pin (__tests__/usage-fold.test.ts):
 *   - served_by rows sum exactly to the aggregate's total_tokens and
 *     llm_call_count; a row whose server is not known (every
 *     runner-reported row) counts under PROVIDER_KEY_SOURCE_UNSPECIFIED;
 *   - the primary model and provider are the model with the most tokens;
 *   - model rows and harness rows order by total tokens, most first; agent
 *     rows likewise, capped by the caller; daily rows chronologically;
 *   - a harness row counts the distinct runs that contributed a row to it,
 *     so a run with no tokens is in no harness row;
 *   - a daily row is the UTC day of the run's creation instant; a run with
 *     no creation stamp has no day and is in no daily row;
 *   - working_seconds is the rows' runs' working milliseconds summed, then
 *     floored to whole seconds once per field, so no run is rounded on its
 *     own and a row never shows more than its runs worked.
 * Ties keep first-seen order (Map insertion, stable sort); tie order is
 * not part of the contract.
 */
import { create } from "@bufbuild/protobuf";

import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import type {
  AgentUsageSummary,
  DailyUsage,
  HarnessUsage,
  RunUsageSummary,
  SessionUsageSummary,
} from "@stigmer/apis/ai/stigmer/agentic/run/v1/io_pb";
import {
  AgentUsageSummarySchema,
  DailyUsageSchema,
  HarnessUsageSchema,
  RunUsageSummarySchema,
  SessionUsageSummarySchema,
} from "@stigmer/apis/ai/stigmer/agentic/run/v1/io_pb";
import type {
  ModelUsage,
  ServedByUsage,
  UsageReportAggregate,
} from "@stigmer/apis/ai/stigmer/agentic/run/v1/usage_pb";
import {
  ModelUsageSchema,
  ProviderKeySource,
  ServedByUsageSchema,
  UsageReportAggregateSchema,
} from "@stigmer/apis/ai/stigmer/agentic/run/v1/usage_pb";
import { Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";

import type {
  MeteredRunUsage,
  MeteredUsageRow,
} from "../../extensions/metered-usage.js";
import { sessionIdOf } from "./target.js";

/** One run with the rows it is counted from. */
export interface CountedRun {
  readonly run: Run;
  /** Empty when the run has neither meter rows nor a runner report with tokens. */
  readonly rows: readonly MeteredUsageRow[];
  /** True when the rows are the runner's own report rather than the meter's. */
  readonly estimated: boolean;
  /** The milliseconds the run's session worked in the stretches the run started. */
  readonly workingMillis: number;
}

// ---------------------------------------------------------------------------
// Counting one run
// ---------------------------------------------------------------------------

/**
 * A harness as the report names it ("native", "claude"). Claude
 * counts with native's arithmetic: its runner reports normalized usage,
 * as native's does. A number no engine owns is never written (every
 * `harness` field is `enum.defined_only`), so one here is a defect, named
 * rather than counted as another engine's.
 */
export function harnessName(harness: Harness): string {
  switch (harness) {
    case Harness.CLAUDE:
      return "claude";
    case Harness.NATIVE:
    case Harness.UNSPECIFIED:
      return "native";
    default: {
      const unknown: never = harness;
      throw new Error(`usage report: harness ${String(unknown)} names no engine`);
    }
  }
}

/**
 * The run's runner report as report rows: one row for its model, or none
 * when the report is absent or holds no tokens. `harness` is the run's
 * session's; the header states the per-harness mapping and why.
 */
export function runnerReportRows(
  run: Run,
  harness: Harness,
): MeteredUsageRow[] {
  const usage = run.status?.streamingUsage;
  if (usage === undefined) {
    return [];
  }
  const cacheRead = usage.cacheReadTokens;
  const cacheWrite = usage.cacheWriteTokens;
  const output = usage.outputTokens;
  const uncached = usage.inputTokens - cacheRead - cacheWrite;
  const input = uncached > 0n ? uncached : 0n;
  const total =
    usage.totalTokens !== 0n ? usage.totalTokens : usage.inputTokens + output;
  if (
    input === 0n &&
    output === 0n &&
    cacheRead === 0n &&
    cacheWrite === 0n &&
    total === 0n
  ) {
    return [];
  }
  return [
    {
      model: usage.model,
      provider: "",
      harness: harnessName(harness),
      providerKeySource: ProviderKeySource.UNSPECIFIED,
      inputTokens: input,
      outputTokens: output,
      cacheCreationInputTokens: cacheWrite,
      cacheReadInputTokens: cacheRead,
      reasoningTokens: 0n,
      totalTokens: total,
      callCount: 0,
    },
  ];
}

/**
 * Decides the run's source once: the meter's rows when it answered for the
 * run, else the runner's report (estimated when it holds tokens). A meter
 * row that names no harness takes the run's (`harness`, its session's).
 * `workingMillis` is the run's working time, whichever source counts its
 * tokens.
 */
export function countRun(
  run: Run,
  metered: MeteredRunUsage | undefined,
  harness: Harness,
  workingMillis: number,
): CountedRun {
  if (metered !== undefined && metered.rows.length > 0) {
    const runHarness = harnessName(harness);
    return {
      run,
      rows: metered.rows.map((row) =>
        row.harness === "" ? { ...row, harness: runHarness } : row,
      ),
      estimated: false,
      workingMillis,
    };
  }
  const rows = runnerReportRows(run, harness);
  return { run, rows, estimated: rows.length > 0, workingMillis };
}

/** The run's total tokens (cache-inclusive). */
export function totalTokensOf(counted: CountedRun): bigint {
  let total = 0n;
  for (const row of counted.rows) {
    total += row.totalTokens;
  }
  return total;
}

/** The runs' working time in whole seconds, floored once over their sum. */
export function workingSecondsOf(runs: readonly CountedRun[]): bigint {
  let millis = 0;
  for (const counted of runs) {
    millis += counted.workingMillis;
  }
  return BigInt(Math.floor(millis / 1000));
}

function callCountOf(counted: CountedRun): number {
  let calls = 0;
  for (const row of counted.rows) {
    calls += row.callCount;
  }
  return calls;
}

// ---------------------------------------------------------------------------
// Aggregate and model breakdown
// ---------------------------------------------------------------------------

/** Per (model, provider), ordered by total tokens, most first. */
export function modelBreakdownOf(runs: readonly CountedRun[]): ModelUsage[] {
  const byModel = new Map<string, ModelUsage>();
  for (const counted of runs) {
    for (const row of counted.rows) {
      const key = `${row.model}\u0000${row.provider}`;
      let entry = byModel.get(key);
      if (entry === undefined) {
        entry = create(ModelUsageSchema, {
          model: row.model,
          provider: row.provider,
        });
        byModel.set(key, entry);
      }
      entry.inputTokens += row.inputTokens;
      entry.outputTokens += row.outputTokens;
      entry.cacheCreationInputTokens += row.cacheCreationInputTokens;
      entry.cacheReadInputTokens += row.cacheReadInputTokens;
      entry.totalTokens += row.totalTokens;
      entry.callCount += row.callCount;
    }
  }
  return [...byModel.values()].sort((a, b) =>
    compareBigintDesc(a.totalTokens, b.totalTokens),
  );
}

/** The runs' token and call totals, primary model and who served them. */
export function aggregateOf(runs: readonly CountedRun[]): UsageReportAggregate {
  const aggregate = create(UsageReportAggregateSchema);
  const servedBy = new Map<ProviderKeySource, ServedByUsage>();
  for (const counted of runs) {
    for (const row of counted.rows) {
      aggregate.inputTokens += row.inputTokens;
      aggregate.outputTokens += row.outputTokens;
      aggregate.cacheCreationInputTokens += row.cacheCreationInputTokens;
      aggregate.cacheReadInputTokens += row.cacheReadInputTokens;
      aggregate.reasoningTokens += row.reasoningTokens;
      aggregate.totalTokens += row.totalTokens;
      aggregate.llmCallCount += row.callCount;
      let served = servedBy.get(row.providerKeySource);
      if (served === undefined) {
        served = create(ServedByUsageSchema, {
          providerKeySource: row.providerKeySource,
        });
        servedBy.set(row.providerKeySource, served);
      }
      served.totalTokens += row.totalTokens;
      served.llmCallCount += row.callCount;
    }
  }
  aggregate.workingSeconds = workingSecondsOf(runs);
  const primary = modelBreakdownOf(runs)[0];
  if (primary !== undefined) {
    aggregate.primaryModel = primary.model;
    aggregate.primaryProvider = primary.provider;
  }
  aggregate.servedBy = [...servedBy.values()].sort(
    (a, b) =>
      compareBigintDesc(a.totalTokens, b.totalTokens) ||
      a.providerKeySource - b.providerKeySource,
  );
  return aggregate;
}

// ---------------------------------------------------------------------------
// Per-run, per-session, per-agent, per-day, per-harness rows
// ---------------------------------------------------------------------------

/**
 * The run's row in a session report. `threads` is how many sub-agent
 * threads the run opened, its `session.thread_created` events (the
 * caller's typed read of the session's log); 0 when it opened none.
 */
export function runSummaryOf(
  counted: CountedRun,
  threads: number,
): RunUsageSummary {
  const run = counted.run;
  let input = 0n;
  let output = 0n;
  let cacheRead = 0n;
  for (const row of counted.rows) {
    input += row.inputTokens;
    output += row.outputTokens;
    cacheRead += row.cacheReadInputTokens;
  }
  return create(RunUsageSummarySchema, {
    runId: run.metadata?.id ?? "",
    startedAt: run.status?.startedAt ?? "",
    completedAt: run.status?.completedAt ?? "",
    inputTokens: input,
    outputTokens: output,
    cacheReadInputTokens: cacheRead,
    totalTokens: totalTokensOf(counted),
    primaryModel: modelBreakdownOf([counted])[0]?.model ?? "",
    subAgentCount: threads,
    phase: run.status?.phase ?? RunPhase.RUN_PHASE_UNSPECIFIED,
    isEstimated: counted.estimated,
    workingSeconds: workingSecondsOf([counted]),
  });
}

/** Earliest non-empty started_at (machine-written RFC 3339 UTC text). */
export function earliestStartedAt(runs: readonly Run[]): string {
  let earliest = "";
  for (const run of runs) {
    const startedAt = run.status?.startedAt ?? "";
    if (startedAt !== "" && (earliest === "" || startedAt < earliest)) {
      earliest = startedAt;
    }
  }
  return earliest;
}

/** Latest non-empty started_at (machine-written RFC 3339 UTC text). */
export function latestStartedAt(runs: readonly Run[]): string {
  let latest = "";
  for (const run of runs) {
    const startedAt = run.status?.startedAt ?? "";
    if (startedAt !== "" && startedAt > latest) {
      latest = startedAt;
    }
  }
  return latest;
}

/** One row per session, in first-seen order. */
export function sessionSummariesOf(
  runs: readonly CountedRun[],
): SessionUsageSummary[] {
  const bySession = groupBy(runs, (counted) => sessionIdOf(counted.run.spec));
  const summaries: SessionUsageSummary[] = [];
  for (const [sessionId, group] of bySession) {
    const groupRuns = group.map((counted) => counted.run);
    summaries.push(
      create(SessionUsageSummarySchema, {
        sessionId,
        runCount: group.length,
        totalTokens: sumTokens(group),
        firstRunAt: earliestStartedAt(groupRuns),
        lastRunAt: latestStartedAt(groupRuns),
        workingSeconds: workingSecondsOf(group),
      }),
    );
  }
  return summaries;
}

/**
 * The `limit` agents with the most tokens (all of them when `limit` is not
 * positive), by the agent each run recorded (status.agent_id; "" for none).
 * Names are left empty: the caller resolves only the agents it keeps.
 */
export function topAgentsOf(
  runs: readonly CountedRun[],
  limit: number,
): AgentUsageSummary[] {
  const byAgent = groupBy(runs, (counted) => counted.run.status?.agentId ?? "");
  const summaries: AgentUsageSummary[] = [];
  for (const [agentId, group] of byAgent) {
    summaries.push(
      create(AgentUsageSummarySchema, {
        agentId,
        runCount: group.length,
        totalTokens: sumTokens(group),
        workingSeconds: workingSecondsOf(group),
      }),
    );
  }
  summaries.sort((a, b) => compareBigintDesc(a.totalTokens, b.totalTokens));
  return limit > 0 && summaries.length > limit
    ? summaries.slice(0, limit)
    : summaries;
}

/** status.audit.spec_audit.created_at in epoch ms; undefined when absent. */
export function auditCreatedAtMs(run: Run): number | undefined {
  const ts = run.status?.audit?.specAudit?.createdAt;
  if (ts === undefined) {
    return undefined;
  }
  return Number(ts.seconds) * 1000 + Math.floor(ts.nanos / 1_000_000);
}

/** One row per UTC day of creation that has a run, chronological. */
export function dailyUsageOf(runs: readonly CountedRun[]): DailyUsage[] {
  const byDay = new Map<string, DailyUsage>();
  for (const counted of runs) {
    const createdAtMs = auditCreatedAtMs(counted.run);
    if (createdAtMs === undefined) {
      continue;
    }
    const date = new Date(createdAtMs).toISOString().slice(0, 10);
    let entry = byDay.get(date);
    if (entry === undefined) {
      entry = create(DailyUsageSchema, { date });
      byDay.set(date, entry);
    }
    entry.runCount += 1;
    entry.totalTokens += totalTokensOf(counted);
    entry.llmCallCount += callCountOf(counted);
  }
  return [...byDay.values()].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
  );
}

/** One row per harness the rows name, ordered by total tokens, most first. */
export function harnessUsageOf(runs: readonly CountedRun[]): HarnessUsage[] {
  const byHarness = new Map<
    string,
    { usage: HarnessUsage; runIds: Set<string> }
  >();
  for (const counted of runs) {
    const runId = counted.run.metadata?.id ?? "";
    for (const row of counted.rows) {
      let entry = byHarness.get(row.harness);
      if (entry === undefined) {
        entry = {
          usage: create(HarnessUsageSchema, { harness: row.harness }),
          runIds: new Set(),
        };
        byHarness.set(row.harness, entry);
      }
      entry.usage.totalTokens += row.totalTokens;
      entry.usage.callCount += row.callCount;
      entry.runIds.add(runId);
    }
  }
  const rows: HarnessUsage[] = [];
  for (const { usage, runIds } of byHarness.values()) {
    usage.runCount = runIds.size;
    rows.push(usage);
  }
  return rows.sort((a, b) => compareBigintDesc(a.totalTokens, b.totalTokens));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sumTokens(runs: readonly CountedRun[]): bigint {
  let total = 0n;
  for (const counted of runs) {
    total += totalTokensOf(counted);
  }
  return total;
}

function groupBy(
  runs: readonly CountedRun[],
  keyOf: (counted: CountedRun) => string,
): Map<string, CountedRun[]> {
  const groups = new Map<string, CountedRun[]>();
  for (const counted of runs) {
    const key = keyOf(counted);
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, [counted]);
    } else {
      group.push(counted);
    }
  }
  return groups;
}

function compareBigintDesc(a: bigint, b: bigint): number {
  return a < b ? 1 : a > b ? -1 : 0;
}
