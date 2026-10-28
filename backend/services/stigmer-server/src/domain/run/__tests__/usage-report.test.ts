/**
 * Pins the usage report pipelines (usage.ts) over a real SQLite store
 * opened with the run list index:
 *   - the session, agent and organization reports read through the index,
 *     never the whole kind (the store's `listResources` throws here);
 *   - a run is counted from the composed meter when it answers for it, and
 *     from its runner's report otherwise, marked estimated, mapped by its
 *     session's harness; one meter call per report; a meter that throws
 *     fails the report;
 *   - the dated reports count runs by creation instant: a date-only `to`
 *     holds its whole day, a date-only `from` its own midnight, a run
 *     created before `from` is out however late it started, and the
 *     organization report counts the same runs as the dashboard summary
 *     for the same window, runs that never started included;
 *   - a composed list read scope narrows what the organization report
 *     counts and names;
 *   - the organization report's top agents order by tokens and its total
 *     is the sum of its runs;
 *   - the session report counts each run's sub-agents from the
 *     `session.thread_created` events of its session's log, not its row;
 *   - every report carries working time: each run the stretches of work
 *     it started in its session's status events, every total their sum
 *     floored once, an open stretch counted to the report's clock; a
 *     store fault on that read fails the report as Internal;
 *   - a store fault on the index read, or on a session's harness read,
 *     fails the report as Internal, and an index row that will not decode
 *     is skipped while the rest are counted.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import type { DescMessage, MessageInitShape } from "@bufbuild/protobuf";
import { timestampFromMs } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { AgentSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import {
  GetAgentUsageReportInputSchema,
  GetOrgUsageReportInputSchema,
  GetRunSummaryRequestSchema,
  GetRunUsageReportInputSchema,
  GetSessionUsageReportInputSchema,
  RunSummaryTimeWindow,
} from "@stigmer/apis/ai/stigmer/agentic/run/v1/io_pb";
import type { StreamingUsageSummarySchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/usage_pb";
import { ProviderKeySource } from "@stigmer/apis/ai/stigmer/agentic/run/v1/usage_pb";
import { SessionSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import { SessionEventSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";
import { Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { createLogger } from "../../../boot/logger.js";
import type { Authorizer } from "../../../extensions/authorizer.js";
import type { ListReadScope } from "../../../extensions/list-read-scope.js";
import type {
  MeteredRunUsage,
  MeteredUsageProvider,
  MeteredUsageRow,
} from "../../../extensions/metered-usage.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import type { Store } from "../../../store/interface.js";
import { SqliteStore } from "../../../store/sqlite/store.js";
import { draftOf } from "../../session/events/codec.js";
import {
  RunEventsBuilder,
  appendRunEvents,
} from "../../session/events/__tests__/run-events-fixture.js";
import { agentExecutionListIndex } from "../list-index.js";
import {
  getAgentUsageReport,
  getOrgUsageReport,
  getRunSummary,
  getRunUsageReport,
  getSessionUsageReport,
  type UsageReportDeps,
} from "../usage.js";

const silentLogger = createLogger({ level: "error", pretty: false, write: () => {} });
const allow: Authorizer = { authorize: () => Promise.resolve({ kind: "allow" }) };
const DAY = 24 * 60 * 60 * 1000;

let dir: string;
let sqlite: SqliteStore;
/** The store every report reads: the whole-kind read is refused. */
let store: Store;

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "usage-report-test-"));
  sqlite = SqliteStore.open(path.join(dir, "usage.sqlite"), undefined, {
    listIndexes: [agentExecutionListIndex],
  });
  store = new Proxy(sqlite, {
    get(target, member, receiver) {
      if (member === "listResources") {
        return () => Promise.reject(new Error("a usage report decoded the whole kind"));
      }
      const value: unknown = Reflect.get(target, member, receiver);
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
});

afterAll(async () => {
  await sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

function deps(overrides: Partial<UsageReportDeps> = {}): UsageReportDeps {
  return {
    store,
    logger: silentLogger,
    authorizer: allow,
    listReadScope: undefined,
    meteredUsageProvider: undefined,
    ...overrides,
  };
}

/** A native run's report: input 18,432 including 15,000 cache read and 2,000 cache write. */
const NATIVE_USAGE: MessageInitShape<typeof StreamingUsageSummarySchema> = {
  inputTokens: 18_432n,
  outputTokens: 1_210n,
  cacheReadTokens: 15_000n,
  cacheWriteTokens: 2_000n,
  totalTokens: 19_642n,
  turnCount: 3,
  model: "claude-sonnet-4-5",
};

/** A Claude run's report: input 44,920 including 41,800 cache read, the runner's input + output total. */
const CLAUDE_USAGE: MessageInitShape<typeof StreamingUsageSummarySchema> = {
  inputTokens: 44_920n,
  outputTokens: 2_045n,
  cacheReadTokens: 41_800n,
  cacheWriteTokens: 0n,
  totalTokens: 46_965n,
  turnCount: 2,
  model: "claude-opus-4-8",
};

async function seedRun(
  id: string,
  options: {
    org: string;
    sessionId?: string;
    agentId?: string;
    usage?: MessageInitShape<typeof StreamingUsageSummarySchema>;
    createdAtMs?: number;
    startedAt?: string;
    phase?: RunPhase;
  },
): Promise<string> {
  await store.saveResource(
    ApiResourceKind.run,
    id,
    RunSchema,
    create(RunSchema, {
      metadata: { id, name: id, org: options.org },
      spec: { target: { case: "sessionId", value: options.sessionId ?? `ses_${id}` } },
      status: {
        agentId: options.agentId ?? "agt_default",
        phase: options.phase ?? RunPhase.RUN_COMPLETED,
        startedAt: options.startedAt ?? "",
        streamingUsage: options.usage,
        audit:
          options.createdAtMs === undefined
            ? undefined
            : { specAudit: { createdAt: timestampFromMs(options.createdAtMs) } },
      },
    }),
  );
  return id;
}

async function seedSession(id: string, org: string, harness: Harness): Promise<void> {
  await store.saveResource(
    ApiResourceKind.session,
    id,
    SessionSchema,
    create(SessionSchema, { metadata: { id, name: id, org }, spec: { harness } }),
  );
}

function meterRow(overrides: Partial<MeteredUsageRow>): MeteredUsageRow {
  return {
    model: "claude-sonnet-4-5",
    provider: "anthropic",
    harness: "stigmer",
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

/** A meter answering from a fixed table, recording each call's run ids. */
function fakeMeter(table: ReadonlyMap<string, MeteredRunUsage>): MeteredUsageProvider & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    usageForRuns(runIds) {
      calls.push([...runIds]);
      const answer = new Map<string, MeteredRunUsage>();
      for (const id of runIds) {
        const usage = table.get(id);
        if (usage !== undefined) answer.set(id, usage);
      }
      return Promise.resolve(answer);
    },
  };
}

async function refusal(call: () => Promise<unknown>): Promise<ConnectError> {
  try {
    await call();
  } catch (error) {
    if (error instanceof ConnectError) return error;
    throw error;
  }
  throw new Error("the call succeeded");
}

describe("a run counted from its runner's report", () => {
  it("the run report carries the runner's tokens, estimated, input less both cache buckets, served by UNSPECIFIED", async () => {
    await seedSession("ses_native_1", "org_runner", Harness.STIGMER);
    const id = await seedRun("run_native_1", { org: "org_runner", sessionId: "ses_native_1", usage: NATIVE_USAGE });
    const report = await getRunUsageReport(deps(), create(GetRunUsageReportInputSchema, { runId: id }), testCallerIdentity());
    expect(report.aggregate?.totalTokens).toBe(19_642n);
    expect(report.aggregate?.inputTokens).toBe(1_432n);
    expect(report.aggregate?.cacheReadInputTokens).toBe(15_000n);
    expect(report.aggregate?.cacheCreationInputTokens).toBe(2_000n);
    expect(report.aggregate?.outputTokens).toBe(1_210n);
    expect(report.aggregate?.llmCallCount).toBe(0);
    expect(report.aggregate?.servedBy.map((s) => [s.providerKeySource, s.totalTokens])).toEqual([
      [ProviderKeySource.UNSPECIFIED, 19_642n],
    ]);
    expect(report.modelBreakdown.map((m) => [m.model, m.totalTokens])).toEqual([["claude-sonnet-4-5", 19_642n]]);
  });

  it("a Claude session's run is counted by native's rule: input less the cache, the runner's total", async () => {
    await seedSession("ses_claude_1", "org_runner", Harness.CLAUDE);
    await seedRun("run_claude_1", { org: "org_runner", sessionId: "ses_claude_1", usage: CLAUDE_USAGE });
    const report = await getSessionUsageReport(
      deps(),
      create(GetSessionUsageReportInputSchema, { sessionId: "ses_claude_1" }),
      testCallerIdentity(),
    );
    expect(report.isEstimated).toBe(true);
    expect(report.totalUsage?.inputTokens).toBe(3_120n);
    expect(report.totalUsage?.totalTokens).toBe(46_965n);
    expect(report.totalUsage?.primaryProvider).toBe("");
    expect(report.runs.map((r) => [r.runId, r.totalTokens, r.isEstimated])).toEqual([["run_claude_1", 46_965n, true]]);
  });
});

describe("the session report's sub-agent count", () => {
  it("counts each run's sub-agent threads from its session's events, not its row", async () => {
    await seedSession("ses_threads", "org_threads", Harness.STIGMER);
    await seedRun("run_threads_a", { org: "org_threads", sessionId: "ses_threads", startedAt: "2026-10-13T09:00:00Z" });
    await seedRun("run_threads_b", { org: "org_threads", sessionId: "ses_threads", startedAt: "2026-10-13T10:00:00Z" });
    await appendRunEvents(
      store,
      "ses_threads",
      "org_threads",
      new RunEventsBuilder("run_threads_a")
        .threadCreated("run_threads_a.t1", "researcher")
        .threadCreated("run_threads_a.t2", "writer")
        .build(),
    );
    const report = await getSessionUsageReport(
      deps(),
      create(GetSessionUsageReportInputSchema, { sessionId: "ses_threads" }),
      testCallerIdentity(),
    );
    expect(report.runs.map((r) => [r.runId, r.subAgentCount])).toEqual([
      ["run_threads_a", 2],
      ["run_threads_b", 0],
    ]);
  });
});

describe("working time", () => {
  const T0 = Date.UTC(2026, 9, 14, 9, 0, 0);

  /** Appends one status event of `runId`, accepted at `atMs`. */
  async function statusAt(sessionId: string, runId: string, kind: "running" | "idle", atMs: number): Promise<void> {
    vi.setSystemTime(atMs);
    const event = create(SessionEventSchema, {
      runId,
      event:
        kind === "running"
          ? { case: "sessionStatusRunning", value: { id: `sevt_${runId}_${String(atMs)}` } }
          : { case: "sessionStatusIdle", value: { id: `sevt_${runId}_${String(atMs)}`, stopReason: { type: "end_turn" } } },
    });
    await store.sessionEvents.append(sessionId, "org_work", [draftOf(event)], {
      kind: ApiResourceKind.run,
      id: runId,
      schema: RunSchema,
      admit: () => undefined,
    });
  }

  it("each run carries the stretches it started, the session and the organization their sum, an open stretch counted to the report's clock", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      await seedSession("ses_work", "org_work", Harness.STIGMER);
      await seedRun("run_work_a", { org: "org_work", sessionId: "ses_work", agentId: "agt_work", usage: NATIVE_USAGE, startedAt: "2026-10-14T09:00:00Z", createdAtMs: T0 });
      await seedRun("run_work_b", { org: "org_work", sessionId: "ses_work", agentId: "agt_work", startedAt: "2026-10-14T09:10:00Z", createdAtMs: T0 + 600_000, phase: RunPhase.RUN_IN_PROGRESS });
      await statusAt("ses_work", "run_work_a", "running", T0);
      await statusAt("ses_work", "run_work_a", "idle", T0 + 3_400);
      await statusAt("ses_work", "run_work_b", "running", T0 + 600_000);
    } finally {
      vi.useRealTimers();
    }
    const clocked = deps({ now: () => new Date(T0 + 601_900) });

    const session = await getSessionUsageReport(clocked, create(GetSessionUsageReportInputSchema, { sessionId: "ses_work" }), testCallerIdentity());
    expect(session.runs.map((r) => [r.runId, r.workingSeconds])).toEqual([
      ["run_work_a", 3n],
      ["run_work_b", 1n],
    ]);
    expect(session.totalUsage?.workingSeconds, "5,300 ms floored once, not 3 + 1").toBe(5n);

    const run = await getRunUsageReport(clocked, create(GetRunUsageReportInputSchema, { runId: "run_work_b" }), testCallerIdentity());
    expect(run.aggregate?.workingSeconds).toBe(1n);

    const org = await getOrgUsageReport(clocked, create(GetOrgUsageReportInputSchema, { org: "org_work", fromDate: "2026-10-14", toDate: "2026-10-14" }), testCallerIdentity());
    expect(org.totalUsage?.workingSeconds).toBe(5n);
    expect(org.topAgents.map((a) => [a.agentId, a.workingSeconds])).toEqual([["agt_work", 5n]]);

    const agent = await getAgentUsageReport(
      clocked,
      create(GetAgentUsageReportInputSchema, { org: "org_work", agentId: "agt_work", fromDate: "2026-10-14", toDate: "2026-10-14" }),
      testCallerIdentity(),
    );
    expect(agent.sessions.map((s) => [s.sessionId, s.workingSeconds])).toEqual([["ses_work", 5n]]);
  });

  it("a store fault on the status read fails the report as Internal", async () => {
    await seedSession("ses_work_fault", "org_work_fault", Harness.STIGMER);
    await seedRun("run_work_fault", { org: "org_work_fault", sessionId: "ses_work_fault" });
    const faulty = new Proxy(store, {
      get(target, member, receiver) {
        if (member === "sessionEvents") {
          return { ...target.sessionEvents, list: () => Promise.reject(new Error("disk gone")) };
        }
        const value: unknown = Reflect.get(target, member, receiver);
        return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      },
    });
    const error = await refusal(() =>
      getRunUsageReport(deps({ store: faulty }), create(GetRunUsageReportInputSchema, { runId: "run_work_fault" }), testCallerIdentity()),
    );
    expect(error.code).toBe(Code.Internal);
  });
});

describe("a run counted from the meter", () => {
  it("meter rows on two models sum per model, served by the organization, not estimated; a sibling with none falls back", async () => {
    await seedSession("ses_metered", "org_meter", Harness.STIGMER);
    await seedRun("run_metered", { org: "org_meter", sessionId: "ses_metered", usage: NATIVE_USAGE, startedAt: "2026-10-13T09:00:00Z" });
    await seedRun("run_unmetered", { org: "org_meter", sessionId: "ses_metered", usage: NATIVE_USAGE, startedAt: "2026-10-13T10:00:00Z" });
    const meter = fakeMeter(
      new Map([
        [
          "run_metered",
          {
            rows: [
              meterRow({ inputTokens: 400n, outputTokens: 200n, cacheReadInputTokens: 1_000n, totalTokens: 1_600n, callCount: 3 }),
              meterRow({ model: "claude-haiku-4-5", inputTokens: 100n, outputTokens: 50n, totalTokens: 150n, callCount: 2 }),
              meterRow({ inputTokens: 10n, outputTokens: 90n, totalTokens: 100n, callCount: 1 }),
            ],
          },
        ],
      ]),
    );
    const report = await getSessionUsageReport(
      deps({ meteredUsageProvider: meter }),
      create(GetSessionUsageReportInputSchema, { sessionId: "ses_metered" }),
      testCallerIdentity(),
    );
    expect(meter.calls, "one meter call with every run the report counts").toEqual([["run_metered", "run_unmetered"]]);
    expect(report.runs.map((r) => [r.runId, r.totalTokens, r.isEstimated])).toEqual([
      ["run_metered", 1_850n, false],
      ["run_unmetered", 19_642n, true],
    ]);
    expect(report.isEstimated).toBe(true);
    expect(report.modelBreakdown.map((m) => [m.model, m.provider, m.totalTokens, m.callCount])).toEqual([
      ["claude-sonnet-4-5", "", 19_642n, 0],
      ["claude-sonnet-4-5", "anthropic", 1_700n, 4],
      ["claude-haiku-4-5", "anthropic", 150n, 2],
    ]);
    expect(report.totalUsage?.servedBy.map((s) => [s.providerKeySource, s.totalTokens, s.llmCallCount])).toEqual([
      [ProviderKeySource.UNSPECIFIED, 19_642n, 0],
      [ProviderKeySource.ORGANIZATION, 1_850n, 6],
    ]);

    const runReport = await getRunUsageReport(
      deps({ meteredUsageProvider: meter }),
      create(GetRunUsageReportInputSchema, { runId: "run_metered" }),
      testCallerIdentity(),
    );
    expect(runReport.aggregate?.servedBy.map((s) => s.providerKeySource)).toEqual([ProviderKeySource.ORGANIZATION]);
    expect(runReport.aggregate?.totalTokens).toBe(1_850n);
  });

  it("a meter that throws fails the report with an internal error", async () => {
    await seedRun("run_meter_down", { org: "org_meter_down", sessionId: "ses_meter_down" });
    const broken: MeteredUsageProvider = { usageForRuns: () => Promise.reject(new Error("meter unreachable")) };
    const error = await refusal(() =>
      getSessionUsageReport(
        deps({ meteredUsageProvider: broken }),
        create(GetSessionUsageReportInputSchema, { sessionId: "ses_meter_down" }),
        testCallerIdentity(),
      ),
    );
    expect(error.code).toBe(Code.Internal);
  });
});

describe("the organization report", () => {
  const org = "org_report";
  beforeAll(async () => {
    await store.saveResource(
      ApiResourceKind.agent,
      "agt_big",
      AgentSchema,
      create(AgentSchema, { metadata: { id: "agt_big", name: "Big Agent", org } }),
    );
    const day = Date.UTC(2026, 9, 13);
    await seedSession("ses_big", org, Harness.CLAUDE);
    await seedRun("org_small_1", { org, agentId: "agt_small", usage: NATIVE_USAGE, createdAtMs: day - DAY + 3_600_000 });
    await seedRun("org_small_2", { org, agentId: "agt_small", createdAtMs: day + 3_600_000, phase: RunPhase.RUN_PENDING });
    await seedRun("org_big_1", { org, agentId: "agt_big", sessionId: "ses_big", usage: CLAUDE_USAGE, createdAtMs: day + 9 * 3_600_000, startedAt: "2026-10-13T09:00:01Z" });
    // Created before the window, started inside it: out.
    await seedRun("org_early", { org, agentId: "agt_small", usage: NATIVE_USAGE, createdAtMs: Date.UTC(2026, 9, 1) - 3_600_000, startedAt: "2026-10-01T01:00:00Z" });
    // Another organization's run.
    await seedRun("org_other", { org: "org_elsewhere", agentId: "agt_small", usage: NATIVE_USAGE, createdAtMs: day });
  });

  it("orders top agents by tokens, names them, and totals the sum of its runs", async () => {
    const report = await getOrgUsageReport(
      deps(),
      create(GetOrgUsageReportInputSchema, { org, fromDate: "2026-10-01", toDate: "2026-10-13" }),
      testCallerIdentity(),
    );
    expect(report.totalRuns).toBe(3);
    expect(report.totalAgents).toBe(2);
    expect(report.topAgents.map((a) => [a.agentId, a.agentName, a.runCount, a.totalTokens])).toEqual([
      ["agt_big", "Big Agent", 1, 46_965n],
      ["agt_small", "agt_small", 2, 19_642n],
    ]);
    expect(report.totalUsage?.totalTokens).toBe(46_965n + 19_642n);
    expect(report.totalUsage?.servedBy.reduce((sum, s) => sum + s.totalTokens, 0n)).toBe(report.totalUsage?.totalTokens);
    expect(report.dailyUsage.map((d) => [d.date, d.runCount, d.totalTokens])).toEqual([
      ["2026-10-12", 1, 19_642n],
      ["2026-10-13", 2, 46_965n],
    ]);
    expect(report.harnessUsage.map((h) => [h.harness, h.totalTokens, h.runCount])).toEqual([
      ["claude", 46_965n, 1],
      ["stigmer", 19_642n, 1],
    ]);
  });

  it("a date-only to holds its whole day; a date-only from holds its own midnight", async () => {
    const today = await getOrgUsageReport(
      deps(),
      create(GetOrgUsageReportInputSchema, { org, fromDate: "2026-10-13", toDate: "2026-10-13" }),
      testCallerIdentity(),
    );
    expect(today.totalRuns, "the 01:00 and 09:00 runs of the day").toBe(2);

    await seedRun("org_midnight", { org: "org_midnight", createdAtMs: Date.UTC(2026, 9, 20) });
    const fromMidnight = await getOrgUsageReport(
      deps(),
      create(GetOrgUsageReportInputSchema, { org: "org_midnight", fromDate: "2026-10-20", toDate: "2026-10-20" }),
      testCallerIdentity(),
    );
    expect(fromMidnight.totalRuns).toBe(1);
    const dayBefore = await getOrgUsageReport(
      deps(),
      create(GetOrgUsageReportInputSchema, { org: "org_midnight", fromDate: "2026-10-19", toDate: "2026-10-19" }),
      testCallerIdentity(),
    );
    expect(dayBefore.totalRuns).toBe(0);
  });

  it("a run created after a date-only to's day is out; a to that is neither a date nor an instant is refused", async () => {
    const throughYesterday = await getOrgUsageReport(
      deps(),
      create(GetOrgUsageReportInputSchema, { org, fromDate: "2026-10-01", toDate: "2026-10-12" }),
      testCallerIdentity(),
    );
    expect(throughYesterday.totalRuns, "only the 2026-10-12 run; both 2026-10-13 runs are after the window").toBe(1);
    const error = await refusal(() =>
      getOrgUsageReport(
        deps(),
        create(GetOrgUsageReportInputSchema, { org, fromDate: "2026-10-01", toDate: "13/10/2026" }),
        testCallerIdentity(),
      ),
    );
    expect(error.code).toBe(Code.InvalidArgument);
  });

  it("a run created a millisecond before a date-only from is out, though the index's bound is a millisecond wider", async () => {
    await seedRun("org_edge_before", { org: "org_edge", createdAtMs: Date.UTC(2026, 9, 13) - 1 });
    await seedRun("org_edge_at", { org: "org_edge", createdAtMs: Date.UTC(2026, 9, 13) });
    const report = await getOrgUsageReport(
      deps(),
      create(GetOrgUsageReportInputSchema, { org: "org_edge", fromDate: "2026-10-13", toDate: "2026-10-13" }),
      testCallerIdentity(),
    );
    expect(report.totalRuns).toBe(1);
  });

  it("refuses a bound that is neither a date nor an RFC 3339 instant", async () => {
    const error = await refusal(() =>
      getOrgUsageReport(
        deps(),
        create(GetOrgUsageReportInputSchema, { org, fromDate: "2026-02-30", toDate: "2026-10-13" }),
        testCallerIdentity(),
      ),
    );
    expect(error.code).toBe(Code.InvalidArgument);
  });

  it("counts the same runs as the dashboard summary for the same window, runs that never started included", async () => {
    const now = Date.now();
    const summaryOrg = "org_summary_window";
    await seedRun("sum_old", { org: summaryOrg, createdAtMs: now - 30 * DAY });
    // Created before the summary's cutoff, started after it: out of both.
    await seedRun("sum_created_before", { org: summaryOrg, createdAtMs: now - 8 * DAY, startedAt: new Date(now - DAY).toISOString() });
    await seedRun("sum_recent", { org: summaryOrg, createdAtMs: now - 3 * DAY, startedAt: new Date(now - DAY).toISOString() });
    await seedRun("sum_pending", { org: summaryOrg, createdAtMs: now - 3_600_000, phase: RunPhase.RUN_PENDING });

    const summary = await getRunSummary(
      deps(),
      create(GetRunSummaryRequestSchema, { org: summaryOrg, timeWindow: RunSummaryTimeWindow.LAST_7D }),
      testCallerIdentity(),
    );
    const summaryCount = Object.values(summary.phaseCounts).reduce((sum, n) => sum + n, 0);
    const report = await getOrgUsageReport(
      deps(),
      create(GetOrgUsageReportInputSchema, {
        org: summaryOrg,
        fromDate: new Date(now - 7 * DAY).toISOString(),
        toDate: new Date(now + DAY).toISOString().slice(0, 10),
      }),
      testCallerIdentity(),
    );
    expect(summaryCount).toBe(2);
    expect(report.totalRuns).toBe(summaryCount);
  });

  it("with a read scope composed, neither counts nor names a run the caller cannot read", async () => {
    const scopedOrg = "org_scoped";
    await seedRun("scoped_visible", { org: scopedOrg, agentId: "agt_visible", usage: NATIVE_USAGE, createdAtMs: Date.UTC(2026, 9, 13) });
    await seedRun("scoped_hidden", { org: scopedOrg, agentId: "agt_secret", usage: CLAUDE_USAGE, createdAtMs: Date.UTC(2026, 9, 13) });
    const visible = new Set(["scoped_visible"]);
    const scope: ListReadScope = {
      authorizedResourceIds: () => Promise.resolve(visible),
      restrictListEntries: (_caller, _kind, entries) =>
        Promise.resolve(new Set(entries.map((e) => e.id).filter((id) => visible.has(id)))),
    };
    const meter = fakeMeter(new Map());
    const report = await getOrgUsageReport(
      deps({ listReadScope: scope, meteredUsageProvider: meter }),
      create(GetOrgUsageReportInputSchema, { org: scopedOrg, fromDate: "2026-10-13", toDate: "2026-10-13" }),
      testCallerIdentity(),
    );
    expect(report.totalRuns).toBe(1);
    expect(report.totalAgents).toBe(1);
    expect(report.topAgents.map((a) => a.agentId)).toEqual(["agt_visible"]);
    expect(report.totalUsage?.totalTokens).toBe(19_642n);
    expect(meter.calls, "the meter is asked only about readable runs").toEqual([["scoped_visible"]]);
  });
});

describe("the agent report", () => {
  it("reads one agent's runs in the organization through the index, by creation instant", async () => {
    const org = "org_agent_report";
    await seedRun("agent_in", { org, agentId: "agt_reported", sessionId: "ses_ar_1", usage: NATIVE_USAGE, createdAtMs: Date.UTC(2026, 9, 13, 9) });
    await seedRun("agent_in_2", { org, agentId: "agt_reported", sessionId: "ses_ar_1", createdAtMs: Date.UTC(2026, 9, 13, 10) });
    await seedRun("agent_other_agent", { org, agentId: "agt_unrelated", usage: NATIVE_USAGE, createdAtMs: Date.UTC(2026, 9, 13, 9) });
    await seedRun("agent_too_early", { org, agentId: "agt_reported", usage: NATIVE_USAGE, createdAtMs: Date.UTC(2026, 9, 12, 23) });
    await seedRun("agent_other_org", { org: "org_agent_elsewhere", agentId: "agt_reported", usage: NATIVE_USAGE, createdAtMs: Date.UTC(2026, 9, 13, 9) });

    const report = await getAgentUsageReport(
      deps(),
      create(GetAgentUsageReportInputSchema, { agentId: "agt_reported", org, fromDate: "2026-10-13", toDate: "2026-10-13" }),
      testCallerIdentity(),
    );
    expect(report.totalRuns).toBe(2);
    expect(report.totalSessions).toBe(1);
    expect(report.sessions.map((s) => [s.sessionId, s.runCount, s.totalTokens])).toEqual([["ses_ar_1", 2, 19_642n]]);
    expect(report.totalUsage?.totalTokens).toBe(19_642n);

    const unbounded = await getAgentUsageReport(
      deps(),
      create(GetAgentUsageReportInputSchema, { agentId: "agt_reported", org }),
      testCallerIdentity(),
    );
    expect(unbounded.totalRuns).toBe(3);
  });
});

describe("store faults under the reports", () => {
  it("a fault on the index read fails the report as Internal", async () => {
    const faulty = new Proxy(store, {
      get(target, member, receiver) {
        if (member === "queryResources") {
          return () => Promise.reject(new Error("index read failed"));
        }
        return Reflect.get(target, member, receiver) as unknown;
      },
    });
    const error = await refusal(() =>
      getOrgUsageReport(deps({ store: faulty }), create(GetOrgUsageReportInputSchema, { org: "org_index_fault", fromDate: "2026-10-01", toDate: "2026-10-31" }), testCallerIdentity()),
    );
    expect(error.code).toBe(Code.Internal);
  });

  it("an index row that will not decode is skipped, and the rest are counted", async () => {
    const org = "org_undecodable";
    await seedRun("undecodable_kept", { org, usage: NATIVE_USAGE, createdAtMs: Date.UTC(2026, 9, 13) });
    const withJunk = new Proxy(store, {
      get(target, member, receiver) {
        if (member === "queryResources") {
          return async (...args: Parameters<Store["queryResources"]>) => {
            const rows = await target.queryResources(...args);
            const [first] = rows;
            if (first === undefined) return rows;
            return [...rows, { ...first, id: "undecodable_junk", data: new Uint8Array([0xff, 0xff, 0xff]) }];
          };
        }
        return Reflect.get(target, member, receiver) as unknown;
      },
    });
    const report = await getOrgUsageReport(deps({ store: withJunk }), create(GetOrgUsageReportInputSchema, { org, fromDate: "2026-10-01", toDate: "2026-10-31" }), testCallerIdentity());
    expect(report.totalRuns).toBe(1);
    expect(report.totalUsage?.totalTokens).toBe(19_642n);
  });

  it("a fault reading a run's session, other than not found, fails the report as Internal", async () => {
    const org = "org_session_fault";
    await seedRun("session_fault_run", { org, sessionId: "ses_session_fault", usage: NATIVE_USAGE, createdAtMs: Date.UTC(2026, 9, 13) });
    const faulty = new Proxy(store, {
      get(target, member, receiver) {
        if (member === "getResource") {
          return (kind: ApiResourceKind, id: string, schema: DescMessage) =>
            kind === ApiResourceKind.session
              ? Promise.reject(new Error("session read failed"))
              : target.getResource(kind, id, schema);
        }
        return Reflect.get(target, member, receiver) as unknown;
      },
    });
    const error = await refusal(() =>
      getOrgUsageReport(deps({ store: faulty }), create(GetOrgUsageReportInputSchema, { org, fromDate: "2026-10-01", toDate: "2026-10-31" }), testCallerIdentity()),
    );
    expect(error.code).toBe(Code.Internal);
  });
});
