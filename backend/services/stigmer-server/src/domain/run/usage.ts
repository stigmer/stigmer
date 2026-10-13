/**
 * Run usage reports — the four report pipelines (getRunUsageReport,
 * getSessionUsageReport, getAgentUsageReport, getOrgUsageReport) and the
 * dashboard summary (getRunSummary, a direct handler).
 *
 * The numbers come from the composed meter (drivers.meteredUsageProvider,
 * extensions/metered-usage.ts); for a run it has not metered, from the
 * run's own runner report (RunStatus.streaming_usage), marked estimated.
 * Open source composes no meter, so every run is counted the second way.
 * Each report asks the meter once, for every run it counts; a meter that
 * throws fails the report rather than show metered runs as estimates.
 * A run counted from its runner's report is mapped by its harness, which
 * is its session's (one session read per distinct session of such runs).
 * The arithmetic is usage-fold.ts beside this file.
 *
 * Every report reads only the runs it reports, through the run list index
 * (list-index.ts beside this file), never the whole kind: the session
 * report by the `session` key, the agent report by the organization and
 * the `agent` key, the organization report by the organization; the two
 * dated reports narrow the read by creation instant, and the loop here
 * stays the authority, the store only narrowing. A run is in a dated
 * report's range when it was CREATED in it (status.audit, the dashboard
 * summary's rule, so both count the same runs for the same window,
 * including runs that never started); a run with no creation stamp is
 * kept, as the summary keeps it. A date-only bound is a UTC day (`from`
 * from its midnight, `to` through its last instant); a full RFC 3339
 * bound is taken as given (`parseReportBound`).
 *
 * Every report but the run report then narrows its runs by the composed
 * list read scope (extensions/list-read-scope.ts), as the summary and the
 * run lists do, so the organization report counts and names only runs and
 * agents the caller may read; with no scope composed nothing is narrowed.
 * The run report answers for one run its RPC check already authorized.
 * The session, agent and organization reports never error for "nothing
 * to count"; the run report is the ONE report that 404s.
 *
 * Proven by __tests__/usage-report.test.ts (the pipelines over a real
 * store), __tests__/usage-fold.test.ts (the arithmetic),
 * __tests__/usage.test.ts (the bounds) and __tests__/run.test.ts (over
 * the wire).
 */
import { create, fromBinary } from "@bufbuild/protobuf";
import type { Duration } from "@bufbuild/protobuf/wkt";
import { DurationSchema } from "@bufbuild/protobuf/wkt";

import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import type {
  RunSummary,
  AgentFailureRank,
  GetRunSummaryRequest,
  GetAgentUsageReportOutput,
  GetRunUsageReportOutput,
  GetOrgUsageReportOutput,
  GetSessionUsageReportOutput,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/io_pb";
import {
  RunSummaryTimeWindow,
  RunSummarySchema,
  AgentFailureRankSchema,
  GetAgentUsageReportOutputSchema,
  GetRunUsageReportOutputSchema,
  GetOrgUsageReportOutputSchema,
  GetSessionUsageReportOutputSchema,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/io_pb";
import { RunQueryController } from "@stigmer/protos/ai/stigmer/agentic/run/v1/query_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../../boot/logger.js";
import type { Authorizer } from "../../extensions/authorizer.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import type { ListReadScope } from "../../extensions/list-read-scope.js";
import { restrictListByReadScope } from "../../extensions/list-read-scope.js";
import type {
  MeteredRunUsage,
  MeteredUsageProvider,
} from "../../extensions/metered-usage.js";
import {
  internalError,
  invalidArgumentError,
  notFoundError,
} from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import { newPipeline } from "../../pipeline/pipeline.js";
import { RequestContext } from "../../pipeline/request-context.js";
import { newAuthorizeStep } from "../../pipeline/steps/authorize.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";
import { listIndexInstantOfMillis } from "../../store/list-index.js";
import type { ListIndexQuery, ListIndexRow } from "../../store/list-index.js";

import { agentExecutionListIndex } from "./list-index.js";
import { sessionIdOf } from "./target.js";
import type { CountedRun } from "./usage-fold.js";
import {
  aggregateOf,
  auditCreatedAtMs,
  countRun,
  dailyUsageOf,
  earliestStartedAt,
  harnessUsageOf,
  latestStartedAt,
  modelBreakdownOf,
  runSummaryOf,
  sessionSummariesOf,
  topAgentsOf,
} from "./usage-fold.js";

export interface UsageReportDeps {
  readonly store: Store;
  readonly logger: Logger;
  /** The composed authorization seam — the Authorize step at position 1 of every chain calls it. */
  readonly authorizer: Authorizer;
  /** The composed list read scope — undefined = every run is readable (open source). */
  readonly listReadScope: ListReadScope | undefined;
  /** The composed meter — undefined = every run is counted from its runner's report. */
  readonly meteredUsageProvider: MeteredUsageProvider | undefined;
}

// Context keys for inter-step communication — Go's key strings, verbatim.
const EXECUTION_USAGE_REPORT_KEY = "execution_usage_report";
const EXECUTION_KEY = "execution";
const SESSION_USAGE_REPORT_KEY = "session_usage_report";
const AGENT_USAGE_REPORT_KEY = "agent_usage_report";
const ORG_USAGE_REPORT_KEY = "org_usage_report";
const COUNTED_RUNS_KEY = "counted_runs";

/** Top-agents cap. */
const TOP_AGENTS_LIMIT = 10;

/** The name an agent row carries when its runs recorded no agent. */
const UNKNOWN_AGENT_NAME = "(unknown agent)";

// ---------------------------------------------------------------------------
// Date bounds
// ---------------------------------------------------------------------------

/** A calendar date, YYYY-MM-DD. */
const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A report's date bound as an instant in epoch ms. A date-only bound is a
 * UTC calendar day: `from` is its midnight, `to` its last millisecond (a
 * creation instant is compared at millisecond precision, floored, so the
 * whole day is inside). A full RFC 3339 timestamp is taken as given.
 * Undefined for anything else, including an impossible date.
 */
export function parseReportBound(
  value: string,
  side: "from" | "to",
): number | undefined {
  const date = DATE_ONLY_PATTERN.exec(value);
  if (date !== null) {
    const year = Number(date[1]);
    const month = Number(date[2]);
    const day = Number(date[3]);
    const midnight = Date.UTC(year, month - 1, day);
    const check = new Date(midnight);
    if (
      check.getUTCFullYear() !== year ||
      check.getUTCMonth() !== month - 1 ||
      check.getUTCDate() !== day
    ) {
      return undefined;
    }
    return side === "from" ? midnight : midnight + DAY_MS - 1;
  }
  return parseRfc3339Ms(value);
}

/** A report's range in epoch ms; an absent side is unbounded. */
interface ReportWindow {
  readonly fromMs: number | undefined;
  readonly toMs: number | undefined;
}

/** Parses both bounds; "" is unbounded, anything unparseable is refused. */
function resolveReportWindow(from: string, to: string): ReportWindow {
  const fromMs = from === "" ? undefined : parseReportBound(from, "from");
  if (from !== "" && fromMs === undefined) {
    throw invalidArgumentError(
      "from_date must be a UTC date (YYYY-MM-DD) or an RFC 3339 timestamp",
    );
  }
  const toMs = to === "" ? undefined : parseReportBound(to, "to");
  if (to !== "" && toMs === undefined) {
    throw invalidArgumentError(
      "to_date must be a UTC date (YYYY-MM-DD) or an RFC 3339 timestamp",
    );
  }
  return { fromMs, toMs };
}

/** Whether the run was created in the window; a run with no stamp is kept. */
function createdInWindow(run: Run, window: ReportWindow): boolean {
  const createdAtMs = auditCreatedAtMs(run);
  if (createdAtMs === undefined) {
    return true;
  }
  if (window.fromMs !== undefined && createdAtMs < window.fromMs) {
    return false;
  }
  if (window.toMs !== undefined && createdAtMs > window.toMs) {
    return false;
  }
  return true;
}

/** The index's creation bound for a window: one millisecond wider than the loop's. */
function createdAtOrAfterOf(
  window: ReportWindow,
): { createdAtOrAfter: string } | Record<string, never> {
  return window.fromMs === undefined
    ? {}
    : { createdAtOrAfter: listIndexInstantOfMillis(window.fromMs - 1) };
}

// ---------------------------------------------------------------------------
// Loading and counting runs
// ---------------------------------------------------------------------------

type RunIndexKey = keyof typeof agentExecutionListIndex.keys;

/** The runs the index answers for `query`; a row that will not decode is skipped. */
async function queryRuns(
  deps: UsageReportDeps,
  query: ListIndexQuery<RunIndexKey>,
): Promise<Run[]> {
  let rows: ListIndexRow[];
  try {
    rows = await deps.store.queryResources(agentExecutionListIndex, query);
  } catch (error) {
    throw internalError(error, "failed to list agent executions");
  }
  const runs: Run[] = [];
  for (const row of rows) {
    try {
      runs.push(fromBinary(RunSchema, row.data));
    } catch (error) {
      deps.logger.warn("Failed to unmarshal execution, skipping", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return runs;
}

/** The runs the caller may read (all of them with no scope composed). */
function scopeRuns(
  deps: UsageReportDeps,
  identity: CallerIdentity,
  runs: Run[],
): Promise<Run[]> {
  return restrictListByReadScope(
    deps.listReadScope,
    identity,
    ApiResourceKind.run,
    runs,
    "",
  );
}

/**
 * The harness each of `runs`' sessions runs on, by session id: a run
 * records none of its own, and dispatch runs it on its session's
 * (temporal/agentexecution/dispatch.ts). One read per distinct session; a
 * session that is gone, or a run in none, is the native harness, as
 * dispatch defaults it. Any other store fault fails the report: a guessed
 * harness would count a Cursor run's tokens by the wrong rule.
 */
async function sessionHarnesses(
  deps: UsageReportDeps,
  runs: readonly Run[],
): Promise<Map<string, Harness>> {
  const harnesses = new Map<string, Harness>();
  for (const run of runs) {
    const sessionId = sessionIdOf(run.spec);
    if (sessionId === "" || harnesses.has(sessionId)) {
      continue;
    }
    let harness = Harness.NATIVE;
    try {
      const session = await deps.store.getResource(
        ApiResourceKind.session,
        sessionId,
        SessionSchema,
      );
      harness = session.spec?.harness ?? Harness.UNSPECIFIED;
    } catch (error) {
      if (!(error instanceof ResourceNotFoundError)) {
        throw internalError(error, "failed to load session");
      }
    }
    harnesses.set(sessionId, harness);
  }
  return harnesses;
}

/**
 * Each run with its source decided: one meter call for all of them, then
 * the session harness of every run that needs one (a run the meter did
 * not answer for, or a meter row that names no harness).
 */
async function countRuns(
  deps: UsageReportDeps,
  runs: readonly Run[],
): Promise<CountedRun[]> {
  let metered: ReadonlyMap<string, MeteredRunUsage> = new Map();
  if (deps.meteredUsageProvider !== undefined && runs.length > 0) {
    try {
      metered = await deps.meteredUsageProvider.usageForRuns(
        runs.map((run) => run.metadata?.id ?? ""),
      );
    } catch (error) {
      deps.logger.error("The metered usage read failed", {
        runCount: runs.length,
        error: error instanceof Error ? error.message : String(error),
      });
      throw internalError(error, "failed to read metered usage");
    }
  }
  const meteredOf = (run: Run): MeteredRunUsage | undefined =>
    metered.get(run.metadata?.id ?? "");
  const harnesses = await sessionHarnesses(
    deps,
    runs.filter((run) => {
      const usage = meteredOf(run);
      return (
        usage === undefined ||
        usage.rows.length === 0 ||
        usage.rows.some((row) => row.harness === "")
      );
    }),
  );
  return runs.map((run) =>
    countRun(
      run,
      meteredOf(run),
      harnesses.get(sessionIdOf(run.spec)) ?? Harness.NATIVE,
    ),
  );
}

/** In-place chronological sort by started_at (machine-written RFC 3339 UTC text). */
export function sortExecutionsByStartedAt(executions: Run[]): void {
  executions.sort((a, b) => {
    const sa = a.status?.startedAt ?? "";
    const sb = b.status?.startedAt ?? "";
    return sa < sb ? -1 : sa > sb ? 1 : 0;
  });
}

/** Deduplicated, sorted non-empty agent ids. */
export function distinctAgentIds(executions: readonly Run[]): string[] {
  const seen = new Set<string>();
  for (const exec of executions) {
    const aid = exec.status?.agentId ?? "";
    if (aid !== "") {
      seen.add(aid);
    }
  }
  return [...seen].sort();
}

/** Deduplicated, sorted non-empty session ids. */
export function distinctSessionIds(executions: readonly Run[]): string[] {
  const seen = new Set<string>();
  for (const exec of executions) {
    const sid = sessionIdOf(exec.spec);
    if (sid !== "") {
      seen.add(sid);
    }
  }
  return [...seen].sort();
}

/** Loads an agent's display name, falling back to the id. */
async function resolveAgentNameFromStore(
  deps: UsageReportDeps,
  agentId: string,
): Promise<string> {
  let agent: Agent;
  try {
    agent = await deps.store.getResource(
      ApiResourceKind.agent,
      agentId,
      AgentSchema,
    );
  } catch {
    deps.logger.debug("Could not resolve agent name, using ID", { agentId });
    return agentId;
  }
  const name = agent.metadata?.name ?? "";
  return name !== "" ? name : agentId;
}

// ---------------------------------------------------------------------------
// getRunUsageReport — the ONE report that 404s.
// Chain: ValidateExecutionUsageReport → LoadExecution →
// BuildExecutionUsageReport.
// ---------------------------------------------------------------------------

type ExecutionReportDesc =
  typeof RunQueryController.method.getRunUsageReport.input;

export async function getRunUsageReport(
  deps: UsageReportDeps,
  req: RequestContext<ExecutionReportDesc>["input"],
  identity: CallerIdentity,
): Promise<GetRunUsageReportOutput> {
  const reqCtx = new RequestContext(
    RunQueryController.method.getRunUsageReport.input,
    req,
    identity,
    ApiResourceKind.run,
  );
  await newPipeline<ExecutionReportDesc>(
    "get-execution-usage-report",
    deps.logger,
  )
    .addStep(
      newAuthorizeStep(
        RunQueryController.method.getRunUsageReport,
        deps.authorizer,
      ),
    )
    .addStep({
      name: "ValidateExecutionUsageReport",
      execute(ctx) {
        if (ctx.input.runId === "") {
          throw invalidArgumentError("run_id is required");
        }
      },
    })
    .addStep(newLoadExecutionStep(deps.store))
    .addStep({
      name: "BuildExecutionUsageReport",
      async execute(ctx) {
        const execution = ctx.get(EXECUTION_KEY) as Run;
        const counted = await countRuns(deps, [execution]);
        ctx.set(
          EXECUTION_USAGE_REPORT_KEY,
          create(GetRunUsageReportOutputSchema, {
            aggregate: aggregateOf(counted),
            modelBreakdown: modelBreakdownOf(counted),
          }),
        );
      },
    })
    .build()
    .execute(reqCtx);

  return requireReport<GetRunUsageReportOutput>(
    reqCtx.get(EXECUTION_USAGE_REPORT_KEY),
    "execution usage report not found in context",
  );
}

/**
 * LoadExecution — verifies existence. A missing execution answers the
 * domain's agent_execution NotFound (stigmer/stigmer#859); any other store
 * failure is an infrastructure fault answered as a sanitized Internal, as
 * the approval loads do (submit-approval.ts), never a NotFound that tells
 * the client the execution does not exist.
 */
function newLoadExecutionStep(store: Store): PipelineStep<ExecutionReportDesc> {
  return {
    name: "LoadExecution",
    async execute(ctx) {
      const executionId = ctx.input.runId;
      let execution: Run;
      try {
        execution = await store.getResource(
          ApiResourceKind.run,
          executionId,
          RunSchema,
        );
      } catch (error) {
        if (error instanceof ResourceNotFoundError) {
          throw notFoundError("Run", executionId);
        }
        throw internalError(error, "failed to load agent execution");
      }
      ctx.set(EXECUTION_KEY, execution);
    },
  };
}

// ---------------------------------------------------------------------------
// getSessionUsageReport — no existence check.
// Chain: ValidateSessionUsageReport → LoadSessionExecutions →
// BuildSessionUsageReport.
// ---------------------------------------------------------------------------

type SessionReportDesc =
  typeof RunQueryController.method.getSessionUsageReport.input;

export async function getSessionUsageReport(
  deps: UsageReportDeps,
  req: RequestContext<SessionReportDesc>["input"],
  identity: CallerIdentity,
): Promise<GetSessionUsageReportOutput> {
  const reqCtx = new RequestContext(
    RunQueryController.method.getSessionUsageReport.input,
    req,
    identity,
    ApiResourceKind.run,
  );
  await newPipeline<SessionReportDesc>("get-session-usage-report", deps.logger)
    .addStep(
      newAuthorizeStep(
        RunQueryController.method.getSessionUsageReport,
        deps.authorizer,
      ),
    )
    .addStep({
      name: "ValidateSessionUsageReport",
      execute(ctx) {
        if (ctx.input.sessionId === "") {
          throw invalidArgumentError("session_id is required");
        }
      },
    })
    .addStep({
      name: "LoadSessionExecutions",
      async execute(ctx) {
        const runs = await scopeRuns(
          deps,
          ctx.callerIdentity,
          await queryRuns(deps, {
            anyKey: [{ name: "session", value: ctx.input.sessionId }],
          }),
        );
        sortExecutionsByStartedAt(runs);
        deps.logger.debug("Loaded executions for session usage report", {
          sessionId: ctx.input.sessionId,
          count: runs.length,
        });
        ctx.set(COUNTED_RUNS_KEY, await countRuns(deps, runs));
      },
    })
    .addStep({
      name: "BuildSessionUsageReport",
      execute(ctx) {
        const counted = requireCountedRuns(ctx.get(COUNTED_RUNS_KEY));
        const runs = counted.map((c) => c.run);
        ctx.set(
          SESSION_USAGE_REPORT_KEY,
          create(GetSessionUsageReportOutputSchema, {
            sessionId: ctx.input.sessionId,
            runCount: counted.length,
            totalUsage: aggregateOf(counted),
            runs: counted.map(runSummaryOf),
            modelBreakdown: modelBreakdownOf(counted),
            firstRunAt: earliestStartedAt(runs),
            lastRunAt: latestStartedAt(runs),
            isEstimated: counted.some((c) => c.estimated),
          }),
        );
      },
    })
    .build()
    .execute(reqCtx);

  return requireReport<GetSessionUsageReportOutput>(
    reqCtx.get(SESSION_USAGE_REPORT_KEY),
    "session usage report not found in context",
  );
}

// ---------------------------------------------------------------------------
// getAgentUsageReport — org-scoped (oss#389).
// Chain: ValidateAgentUsageReport → LoadAgentExecutions →
// BuildAgentUsageReport.
// ---------------------------------------------------------------------------

type AgentReportDesc =
  typeof RunQueryController.method.getAgentUsageReport.input;

export async function getAgentUsageReport(
  deps: UsageReportDeps,
  req: RequestContext<AgentReportDesc>["input"],
  identity: CallerIdentity,
): Promise<GetAgentUsageReportOutput> {
  const reqCtx = new RequestContext(
    RunQueryController.method.getAgentUsageReport.input,
    req,
    identity,
    ApiResourceKind.run,
  );
  let window: ReportWindow = { fromMs: undefined, toMs: undefined };
  await newPipeline<AgentReportDesc>("get-agent-usage-report", deps.logger)
    .addStep(
      newAuthorizeStep(
        RunQueryController.method.getAgentUsageReport,
        deps.authorizer,
      ),
    )
    .addStep({
      name: "ValidateAgentUsageReport",
      execute(ctx) {
        if (ctx.input.agentId === "") {
          throw invalidArgumentError("agent_id is required");
        }
        if (ctx.input.org === "") {
          throw invalidArgumentError("org is required");
        }
        window = resolveReportWindow(ctx.input.fromDate, ctx.input.toDate);
      },
    })
    .addStep({
      name: "LoadAgentExecutions",
      async execute(ctx) {
        const indexed = await queryRuns(deps, {
          org: ctx.input.org,
          anyKey: [{ name: "agent", value: ctx.input.agentId }],
          ...createdAtOrAfterOf(window),
        });
        const runs = await scopeRuns(
          deps,
          ctx.callerIdentity,
          indexed.filter(
            (run) =>
              (run.status?.agentId ?? "") === ctx.input.agentId &&
              createdInWindow(run, window),
          ),
        );
        sortExecutionsByStartedAt(runs);
        deps.logger.debug("Loaded executions for agent usage report", {
          agentId: ctx.input.agentId,
          orgId: ctx.input.org,
          count: runs.length,
        });
        ctx.set(COUNTED_RUNS_KEY, await countRuns(deps, runs));
      },
    })
    .addStep({
      name: "BuildAgentUsageReport",
      async execute(ctx) {
        const counted = requireCountedRuns(ctx.get(COUNTED_RUNS_KEY));
        const agentId = ctx.input.agentId;

        // The name resolves only when the org has runs of the agent the
        // caller may read, so the report is never an id-to-name oracle for
        // agents the org never used.
        let agentName = agentId;
        if (counted.length > 0) {
          agentName = await resolveAgentNameFromStore(deps, agentId);
        }

        const sessions = sessionSummariesOf(counted);
        ctx.set(
          AGENT_USAGE_REPORT_KEY,
          create(GetAgentUsageReportOutputSchema, {
            agentId,
            agentName,
            totalUsage: aggregateOf(counted),
            modelBreakdown: modelBreakdownOf(counted),
            sessions,
            totalSessions: sessions.length,
            totalRuns: counted.length,
          }),
        );
      },
    })
    .build()
    .execute(reqCtx);

  return requireReport<GetAgentUsageReportOutput>(
    reqCtx.get(AGENT_USAGE_REPORT_KEY),
    "agent usage report not found in context",
  );
}

// ---------------------------------------------------------------------------
// getOrgUsageReport — required date range.
// Chain: ValidateOrgUsageReport → LoadOrgExecutions → BuildOrgUsageReport.
// ---------------------------------------------------------------------------

type OrgReportDesc =
  typeof RunQueryController.method.getOrgUsageReport.input;

export async function getOrgUsageReport(
  deps: UsageReportDeps,
  req: RequestContext<OrgReportDesc>["input"],
  identity: CallerIdentity,
): Promise<GetOrgUsageReportOutput> {
  const reqCtx = new RequestContext(
    RunQueryController.method.getOrgUsageReport.input,
    req,
    identity,
    ApiResourceKind.run,
  );
  let window: ReportWindow = { fromMs: undefined, toMs: undefined };
  await newPipeline<OrgReportDesc>("get-org-usage-report", deps.logger)
    .addStep(
      newAuthorizeStep(
        RunQueryController.method.getOrgUsageReport,
        deps.authorizer,
      ),
    )
    .addStep({
      name: "ValidateOrgUsageReport",
      execute(ctx) {
        if (ctx.input.org === "") {
          throw invalidArgumentError("org is required");
        }
        if (ctx.input.fromDate === "") {
          throw invalidArgumentError("from_date is required");
        }
        if (ctx.input.toDate === "") {
          throw invalidArgumentError("to_date is required");
        }
        window = resolveReportWindow(ctx.input.fromDate, ctx.input.toDate);
      },
    })
    .addStep({
      name: "LoadOrgExecutions",
      async execute(ctx) {
        const indexed = await queryRuns(deps, {
          org: ctx.input.org,
          ...createdAtOrAfterOf(window),
        });
        const runs = await scopeRuns(
          deps,
          ctx.callerIdentity,
          indexed.filter((run) => createdInWindow(run, window)),
        );
        deps.logger.debug("Loaded executions for org usage report", {
          orgId: ctx.input.org,
          count: runs.length,
        });
        ctx.set(COUNTED_RUNS_KEY, await countRuns(deps, runs));
      },
    })
    .addStep({
      name: "BuildOrgUsageReport",
      async execute(ctx) {
        const counted = requireCountedRuns(ctx.get(COUNTED_RUNS_KEY));
        const runs = counted.map((c) => c.run);

        const topAgents = topAgentsOf(counted, TOP_AGENTS_LIMIT);
        for (const agent of topAgents) {
          agent.agentName =
            agent.agentId === ""
              ? UNKNOWN_AGENT_NAME
              : await resolveAgentNameFromStore(deps, agent.agentId);
        }

        ctx.set(
          ORG_USAGE_REPORT_KEY,
          create(GetOrgUsageReportOutputSchema, {
            org: ctx.input.org,
            totalAgents: distinctAgentIds(runs).length,
            totalSessions: distinctSessionIds(runs).length,
            totalRuns: counted.length,
            modelBreakdown: modelBreakdownOf(counted),
            topAgents,
            dailyUsage: dailyUsageOf(counted),
            harnessUsage: harnessUsageOf(counted),
            totalUsage: aggregateOf(counted),
          }),
        );
      },
    })
    .build()
    .execute(reqCtx);

  return requireReport<GetOrgUsageReportOutput>(
    reqCtx.get(ORG_USAGE_REPORT_KEY),
    "org usage report not found in context",
  );
}

function requireCountedRuns(value: unknown): CountedRun[] {
  if (!Array.isArray(value)) {
    throw internalError(
      new Error("counted runs not found in context"),
      "counted runs not found in context",
    );
  }
  return value as CountedRun[];
}

function requireReport<T>(value: unknown, message: string): T {
  if (value === undefined) {
    throw internalError(new Error(message), message);
  }
  return value as T;
}

// ---------------------------------------------------------------------------
// getRunSummary — the dashboard aggregate (get_execution_summary.go,
// a direct handler in Go as well — no pipeline). Tokens are deliberately
// absent from this shape: the dashboard reads them from getOrgUsageReport,
// so carrying them here too would count them twice. A run with no
// creation stamp (audit.spec_audit.created_at) is never skipped by the
// cutoff, Go's zero time.
//
// The rows are the requested org's within the time window, read through
// the list index, so a member of several organizations never sees every
// org's numbers on every dashboard; with a composed ListReadScope they are
// offered to its restrict verb (exact, one read of the kind), and none
// visible answers the proto default instance — the Java
// AgentExecutionGetExecutionSummaryHandler baseline, whose multi-tenant
// zero shape falls out of the scoping, never a special case.
// ---------------------------------------------------------------------------

export async function getRunSummary(
  deps: UsageReportDeps,
  req: GetRunSummaryRequest,
  identity: CallerIdentity,
): Promise<RunSummary> {
  // The store's window is one millisecond wider than the loop's check
  // below, which stays the authority: it only ever narrows the read.
  const cutoffMs = resolveAgentTimeCutoffMs(req.timeWindow);
  let rows: ListIndexRow[];
  try {
    rows = await deps.store.queryResources(agentExecutionListIndex, {
      org: req.org,
      ...(cutoffMs === undefined
        ? {}
        : { createdAtOrAfter: listIndexInstantOfMillis(cutoffMs - 1) }),
    });
  } catch (error) {
    throw internalError(error, "failed to list agent executions");
  }
  let executions: Run[] = [];
  for (const row of rows) {
    try {
      executions.push(fromBinary(RunSchema, row.data));
    } catch (error) {
      deps.logger.warn("Failed to unmarshal execution, skipping", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (deps.listReadScope !== undefined) {
    executions = await restrictListByReadScope(
      deps.listReadScope,
      identity,
      ApiResourceKind.run,
      executions,
      "",
    );
    if (executions.length === 0) {
      return create(RunSummarySchema);
    }
  }

  const phaseCounts: { [key: number]: number } = {};
  let activeCount = 0;
  const completedDurationsMs: number[] = [];
  const failureCounts = new Map<string, number>();
  const agentNames = new Map<string, string>();

  for (const exec of executions) {
    const createdAtMs = auditCreatedAtMs(exec);
    if (
      createdAtMs !== undefined &&
      cutoffMs !== undefined &&
      createdAtMs < cutoffMs
    ) {
      continue;
    }

    const phase =
      exec.status?.phase ?? RunPhase.RUN_PHASE_UNSPECIFIED;
    phaseCounts[phase] = (phaseCounts[phase] ?? 0) + 1;

    if (isAgentActivePhase(phase)) {
      activeCount++;
    }

    const agentId = exec.status?.agentId ?? "";

    if (phase === RunPhase.RUN_COMPLETED) {
      const d = completionDurationMs(exec);
      if (d > 0) {
        completedDurationsMs.push(d);
      }
    }

    if (phase === RunPhase.RUN_FAILED && agentId !== "") {
      failureCounts.set(agentId, (failureCounts.get(agentId) ?? 0) + 1);
      const name = exec.metadata?.name ?? "";
      if (name !== "") {
        agentNames.set(agentId, name);
      }
    }
  }

  const summary = create(RunSummarySchema, {
    activeCount,
    phaseCounts,
  });

  if (completedDurationsMs.length > 0) {
    let totalMs = 0;
    for (const d of completedDurationsMs) {
      totalMs += d;
    }
    summary.avgDuration = durationFromMs(totalMs / completedDurationsMs.length);
  }

  summary.topFailingAgents = buildAgentFailureRanks(
    failureCounts,
    agentNames,
    10,
  );

  return summary;
}

/**
 * The window cutoff in epoch ms; undefined = no cutoff (ALL_TIME's zero
 * time). Default (UNSPECIFIED and unknown values) is LAST_7D — Go's
 * switch default.
 */
function resolveAgentTimeCutoffMs(
  tw: RunSummaryTimeWindow,
): number | undefined {
  const now = Date.now();
  switch (tw) {
    case RunSummaryTimeWindow.LAST_24H:
      return now - 24 * 60 * 60 * 1000;
    case RunSummaryTimeWindow.LAST_7D:
      return now - 7 * 24 * 60 * 60 * 1000;
    case RunSummaryTimeWindow.LAST_30D:
      return now - 30 * 24 * 60 * 60 * 1000;
    case RunSummaryTimeWindow.ALL_TIME:
      return undefined;
    default:
      return now - 7 * 24 * 60 * 60 * 1000;
  }
}

function isAgentActivePhase(p: RunPhase): boolean {
  return (
    p === RunPhase.RUN_PENDING ||
    p === RunPhase.RUN_IN_PROGRESS ||
    p === RunPhase.RUN_WAITING_FOR_APPROVAL ||
    p === RunPhase.RUN_PAUSED
  );
}

/**
 * completed_at − started_at in ms; 0 when either side is missing or
 * malformed (Go returns 0 on time.Parse error). Go parses strict RFC3339;
 * Date.parse is more lenient, so a strictness guard keeps the reject set
 * aligned for realistic inputs (both fields are machine-authored RFC3339;
 * the exotic leniency edges are unreachable in practice).
 */
function completionDurationMs(exec: Run): number {
  const started = parseRfc3339Ms(exec.status?.startedAt ?? "");
  const completed = parseRfc3339Ms(exec.status?.completedAt ?? "");
  if (started === undefined || completed === undefined) {
    return 0;
  }
  return completed - started;
}

/** Full-timestamp RFC3339 shapes only (date-only strings are rejected). */
const RFC3339_PATTERN =
  /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/;

function parseRfc3339Ms(value: string): number | undefined {
  if (!RFC3339_PATTERN.test(value)) {
    return undefined;
  }
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? undefined : ms;
}

/**
 * Milliseconds → google.protobuf.Duration, truncating toward zero at
 * nanosecond scale exactly like Go's integer division of a nanosecond
 * total.
 */
function durationFromMs(ms: number): Duration {
  const truncatedMs = Math.trunc(ms);
  const seconds = Math.trunc(truncatedMs / 1000);
  const nanos = Math.trunc((truncatedMs - seconds * 1000) * 1_000_000);
  return create(DurationSchema, { seconds: BigInt(seconds), nanos });
}

/**
 * Failure ranks sorted by count descending, capped (Go
 * buildAgentFailureRanks — its manual insertion sort is stable, as is
 * Array.sort; tie ORDER still differs cross-edition because Go feeds the
 * sort from nondeterministic map iteration — not wire-assertable).
 */
function buildAgentFailureRanks(
  counts: Map<string, number>,
  names: Map<string, string>,
  limit: number,
): AgentFailureRank[] {
  const entries = [...counts.entries()];
  entries.sort((a, b) => b[1] - a[1]);
  const capped = entries.length > limit ? entries.slice(0, limit) : entries;
  return capped.map(([agentId, count]) =>
    create(AgentFailureRankSchema, {
      agentSlug: agentId,
      agentName: names.get(agentId) ?? "",
      failureCount: count,
    }),
  );
}
