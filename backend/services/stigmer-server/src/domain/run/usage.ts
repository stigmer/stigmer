/**
 * AgentRun usage reports — ports usage_aggregation.go plus the four
 * report pipelines (get_execution_usage_report.go,
 * get_session_usage_report.go, get_agent_usage_report.go,
 * get_org_usage_report.go) and the dashboard summary
 * (get_execution_summary.go, a direct handler in Go too).
 *
 * The OSS zero-shapes contract, which the conformance suite's zero-record
 * read surfaces pin (agentrun.conformance.test.ts): runners record
 * no per-message llm_metrics and there is no llm_call_usage_record
 * collection (a cloud billing concern), so every aggregate is
 * structurally valid and zero-valued, and the session/agent/org reports
 * never error for "nothing to aggregate". The execution-scoped report is
 * the ONE report that 404s (it verifies the execution exists).
 *
 * Faithful-port notes:
 *   - Org matching is case-insensitive (Go strings.EqualFold); slug-shaped
 *     orgs make the exotic Unicode fold edges unreachable, so toLowerCase
 *     comparison sits inside Go's envelope.
 *   - Rank/summary tie order: Go iterates maps (nondeterministic) and
 *     sorts unstably; TS Maps iterate insertion-ordered and Array.sort is
 *     stable. Ties are not wire-assertable — the same cross-edition
 *     nuance as the agent family's lists.
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
  AgentUsageSummary,
  DailyCostEntry,
  RunUsageSummary,
  GetRunSummaryRequest,
  GetAgentUsageReportOutput,
  GetRunUsageReportOutput,
  GetOrgUsageReportOutput,
  GetSessionUsageReportOutput,
  SessionUsageSummary,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/io_pb";
import {
  RunSummaryTimeWindow,
  RunSummarySchema,
  AgentFailureRankSchema,
  AgentUsageSummarySchema,
  DailyCostEntrySchema,
  RunUsageSummarySchema,
  GetAgentUsageReportOutputSchema,
  GetRunUsageReportOutputSchema,
  GetOrgUsageReportOutputSchema,
  GetSessionUsageReportOutputSchema,
  SessionUsageSummarySchema,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/io_pb";
import { RunQueryController } from "@stigmer/protos/ai/stigmer/agentic/run/v1/query_pb";
import type { ModelUsage } from "@stigmer/protos/ai/stigmer/agentic/run/v1/usage_pb";
import { UsageReportAggregateSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/usage_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../../boot/logger.js";
import type { Authorizer } from "../../extensions/authorizer.js";
import type { ListReadScope } from "../../extensions/list-read-scope.js";
import { restrictListByReadScope } from "../../extensions/list-read-scope.js";
import {
  internalError,
  invalidArgumentError,
  notFoundError,
} from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import { newPipeline } from "../../pipeline/pipeline.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import { RequestContext } from "../../pipeline/request-context.js";
import { newAuthorizeStep } from "../../pipeline/steps/authorize.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";
import { listIndexInstantOfMillis } from "../../store/list-index.js";
import type { ListIndexRow } from "../../store/list-index.js";

import { agentExecutionListIndex } from "./list-index.js";
import { EXECUTION_LIST_KEY, loadAllAgentExecutions } from "./steps.js";
import { sessionIdOf } from "./target.js";

export interface UsageReportDeps {
  readonly store: Store;
  readonly logger: Logger;
  /** The composed authorization seam — the Authorize step at position 1 of every chain calls it. */
  readonly authorizer: Authorizer;
  /** The composed summary read scope — undefined = the OSS full scan. */
  readonly listReadScope: ListReadScope | undefined;
}

// Context keys for inter-step communication — Go's key strings, verbatim.
const EXECUTION_USAGE_REPORT_KEY = "execution_usage_report";
const EXECUTION_KEY = "execution";
const SESSION_USAGE_REPORT_KEY = "session_usage_report";
const AGENT_USAGE_REPORT_KEY = "agent_usage_report";
const ORG_USAGE_REPORT_KEY = "org_usage_report";

// ---------------------------------------------------------------------------
// Aggregation helpers (usage_aggregation.go) — the OSS zero-value posture.
// ---------------------------------------------------------------------------

/** Zero-valued UsageReportAggregate (Go aggregateUsageReport). */
export function aggregateUsageReport(): ReturnType<
  typeof create<typeof UsageReportAggregateSchema>
> {
  return create(UsageReportAggregateSchema);
}

/** Empty model breakdown (Go mergeModelBreakdowns returns nil). */
export function mergeModelBreakdowns(): ModelUsage[] {
  return [];
}

/**
 * Projects a full AgentRun into the lightweight per-execution
 * summary (Go buildExecutionSummary). Token/cost fields stay zero.
 */
export function buildExecutionSummary(
  exec: Run,
): RunUsageSummary {
  return create(RunUsageSummarySchema, {
    runId: exec.metadata?.id ?? "",
    startedAt: exec.status?.startedAt ?? "",
    completedAt: exec.status?.completedAt ?? "",
    subAgentCount: exec.status?.subAgentRuns.length ?? 0,
    phase: exec.status?.phase ?? RunPhase.RUN_PHASE_UNSPECIFIED,
  });
}

/**
 * Executions whose started_at falls within [from, to] (inclusive,
 * ISO 8601 STRING comparison — Go filterByDateRange). Empty bounds
 * disable that side; executions without started_at are excluded whenever
 * any bound is set.
 */
export function filterByDateRange(
  executions: Run[],
  from: string,
  to: string,
): Run[] {
  if (from === "" && to === "") {
    return executions;
  }
  return executions.filter((exec) => {
    const startedAt = exec.status?.startedAt ?? "";
    if (startedAt === "") {
      return false;
    }
    if (from !== "" && startedAt < from) {
      return false;
    }
    if (to !== "" && startedAt > to) {
      return false;
    }
    return true;
  });
}

/** Case-insensitive org filter (Go filterByOrg / strings.EqualFold). */
export function filterByOrg(
  executions: Run[],
  orgId: string,
): Run[] {
  const target = orgId.toLowerCase();
  return executions.filter(
    (exec) => (exec.metadata?.org ?? "").toLowerCase() === target,
  );
}

/** The recorded agent (status.agent_id) equality filter (Go filterByAgentID). */
export function filterByAgentId(
  executions: Run[],
  agentId: string,
): Run[] {
  return executions.filter((exec) => (exec.status?.agentId ?? "") === agentId);
}

/** Groups by the session the execution belongs to (Go groupBySessionID). */
export function groupBySessionId(
  executions: Run[],
): Map<string, Run[]> {
  const groups = new Map<string, Run[]>();
  for (const exec of executions) {
    const sid = sessionIdOf(exec.spec);
    const group = groups.get(sid);
    if (group === undefined) {
      groups.set(sid, [exec]);
    } else {
      group.push(exec);
    }
  }
  return groups;
}

/**
 * Groups by the recorded agent (status.agent_id); executions without one
 * group under "" (Go
 * groupByAgentID).
 */
export function groupByAgentId(
  executions: Run[],
): Map<string, Run[]> {
  const groups = new Map<string, Run[]>();
  for (const exec of executions) {
    const aid = exec.status?.agentId ?? "";
    const group = groups.get(aid);
    if (group === undefined) {
      groups.set(aid, [exec]);
    } else {
      group.push(exec);
    }
  }
  return groups;
}

/** The YYYY-MM-DD prefix of an ISO 8601 timestamp (Go extractDate). */
export function extractDate(ts: string): string {
  if (ts.length < 10) {
    return "";
  }
  return ts.slice(0, 10);
}

/** Earliest non-empty started_at (Go earliestStartedAt). */
export function earliestStartedAt(executions: Run[]): string {
  let earliest = "";
  for (const exec of executions) {
    const sa = exec.status?.startedAt ?? "";
    if (sa === "") {
      continue;
    }
    if (earliest === "" || sa < earliest) {
      earliest = sa;
    }
  }
  return earliest;
}

/** Latest non-empty started_at (Go latestStartedAt). */
export function latestStartedAt(executions: Run[]): string {
  let latest = "";
  for (const exec of executions) {
    const sa = exec.status?.startedAt ?? "";
    if (sa === "") {
      continue;
    }
    if (latest === "" || sa > latest) {
      latest = sa;
    }
  }
  return latest;
}

/** Per-session zero-cost summary (Go buildSessionSummary). */
export function buildSessionSummary(
  sessionId: string,
  executions: Run[],
): SessionUsageSummary {
  return create(SessionUsageSummarySchema, {
    sessionId,
    runCount: executions.length,
    firstRunAt: earliestStartedAt(executions),
    lastRunAt: latestStartedAt(executions),
  });
}

/** Per-agent zero-cost summary (Go buildAgentSummary). */
export function buildAgentSummary(
  agentId: string,
  agentName: string,
  executions: Run[],
): AgentUsageSummary {
  return create(AgentUsageSummarySchema, {
    agentId,
    agentName,
    runCount: executions.length,
  });
}

/**
 * Groups by the YYYY-MM-DD prefix of started_at; executions without one
 * are dropped (Go groupByDate).
 */
export function groupByDate(
  executions: Run[],
): Map<string, Run[]> {
  const groups = new Map<string, Run[]>();
  for (const exec of executions) {
    const date = extractDate(exec.status?.startedAt ?? "");
    if (date === "") {
      continue;
    }
    const group = groups.get(date);
    if (group === undefined) {
      groups.set(date, [exec]);
    } else {
      group.push(exec);
    }
  }
  return groups;
}

/**
 * Chronologically sorted daily entries with zero cost (Go
 * buildDailyCostEntries).
 */
export function buildDailyCostEntries(
  executions: Run[],
): DailyCostEntry[] {
  const byDate = groupByDate(executions);
  const entries: DailyCostEntry[] = [];
  for (const [date, group] of byDate) {
    entries.push(
      create(DailyCostEntrySchema, {
        date,
        runCount: group.length,
      }),
    );
  }
  entries.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return entries;
}

/** In-place chronological sort by started_at (Go sortExecutionsByStartedAt). */
export function sortExecutionsByStartedAt(executions: Run[]): void {
  executions.sort((a, b) => {
    const sa = a.status?.startedAt ?? "";
    const sb = b.status?.startedAt ?? "";
    return sa < sb ? -1 : sa > sb ? 1 : 0;
  });
}

/** Deduplicated, sorted non-empty agent ids (Go distinctAgentIDs). */
export function distinctAgentIds(executions: Run[]): string[] {
  const seen = new Set<string>();
  for (const exec of executions) {
    const aid = exec.status?.agentId ?? "";
    if (aid !== "") {
      seen.add(aid);
    }
  }
  return [...seen].sort();
}

/** Deduplicated, sorted non-empty session ids (Go distinctSessionIDs). */
export function distinctSessionIds(executions: Run[]): string[] {
  const seen = new Set<string>();
  for (const exec of executions) {
    const sid = sessionIdOf(exec.spec);
    if (sid !== "") {
      seen.add(sid);
    }
  }
  return [...seen].sort();
}

/**
 * Top N agent summaries by billable cost descending (Go topAgentsByCost).
 * All costs are zero in OSS, so this is order-preserving in practice.
 */
export function topAgentsByCost(
  summaries: AgentUsageSummary[],
  n: number,
): AgentUsageSummary[] {
  summaries.sort((a, b) =>
    a.billableCostMicros < b.billableCostMicros
      ? 1
      : a.billableCostMicros > b.billableCostMicros
        ? -1
        : 0,
  );
  if (n > 0 && summaries.length > n) {
    return summaries.slice(0, n);
  }
  return summaries;
}

/** Loads an agent's display name, falling back to the id (Go resolveAgentName). */
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
// Chain per Go: ValidateExecutionUsageReport → LoadExecution →
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
      execute(ctx) {
        ctx.set(
          EXECUTION_USAGE_REPORT_KEY,
          create(GetRunUsageReportOutputSchema, {
            aggregate: aggregateUsageReport(),
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
// getSessionUsageReport — zero shapes, no existence check.
// Chain per Go: ValidateSessionUsageReport → LoadSessionExecutions →
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
        const all = await loadAllAgentExecutions(deps.store, deps.logger);
        const executions = all.filter(
          (exec) => sessionIdOf(exec.spec) === ctx.input.sessionId,
        );
        deps.logger.debug("Loaded executions for session usage report", {
          sessionId: ctx.input.sessionId,
          count: executions.length,
        });
        ctx.set(EXECUTION_LIST_KEY, executions);
      },
    })
    .addStep({
      name: "BuildSessionUsageReport",
      execute(ctx) {
        const executions = requireExecutionList(ctx.get(EXECUTION_LIST_KEY));
        sortExecutionsByStartedAt(executions);
        ctx.set(
          SESSION_USAGE_REPORT_KEY,
          create(GetSessionUsageReportOutputSchema, {
            sessionId: ctx.input.sessionId,
            runCount: executions.length,
            totalUsage: aggregateUsageReport(),
            runs: executions.map(buildExecutionSummary),
            modelBreakdown: mergeModelBreakdowns(),
            firstRunAt: earliestStartedAt(executions),
            lastRunAt: latestStartedAt(executions),
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
// getAgentUsageReport — org-scoped (oss#389), zero shapes.
// Chain per Go: ValidateAgentUsageReport → LoadAgentExecutions →
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
      },
    })
    .addStep({
      name: "LoadAgentExecutions",
      async execute(ctx) {
        const all = await loadAllAgentExecutions(deps.store, deps.logger);
        let filtered = filterByOrg(all, ctx.input.org);
        filtered = filterByAgentId(filtered, ctx.input.agentId);
        filtered = filterByDateRange(
          filtered,
          ctx.input.fromDate,
          ctx.input.toDate,
        );
        deps.logger.debug("Loaded executions for agent usage report", {
          agentId: ctx.input.agentId,
          orgId: ctx.input.org,
          count: filtered.length,
        });
        ctx.set(EXECUTION_LIST_KEY, filtered);
      },
    })
    .addStep({
      name: "BuildAgentUsageReport",
      async execute(ctx) {
        const executions = requireExecutionList(ctx.get(EXECUTION_LIST_KEY));
        const agentId = ctx.input.agentId;

        // The name resolves only when the org has executions of the agent —
        // contract parity with cloud, where this prevents the report from
        // acting as an id-to-name oracle for agents the org never used.
        let agentName = agentId;
        if (executions.length > 0) {
          agentName = await resolveAgentNameFromStore(deps, agentId);
        }

        sortExecutionsByStartedAt(executions);

        const bySession = groupBySessionId(executions);
        const sessionSummaries: SessionUsageSummary[] = [];
        for (const [sid, group] of bySession) {
          sessionSummaries.push(buildSessionSummary(sid, group));
        }

        ctx.set(
          AGENT_USAGE_REPORT_KEY,
          create(GetAgentUsageReportOutputSchema, {
            agentId,
            agentName,
            totalUsage: aggregateUsageReport(),
            modelBreakdown: mergeModelBreakdowns(),
            sessions: sessionSummaries,
            totalSessions: bySession.size,
            totalRuns: executions.length,
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
// getOrgUsageReport — required date range, zero shapes.
// Chain per Go: ValidateOrgUsageReport → LoadOrgExecutions →
// BuildOrgUsageReport.
// ---------------------------------------------------------------------------

/** Top-agents cap (Go topAgentsLimit). */
const TOP_AGENTS_LIMIT = 10;

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
      },
    })
    .addStep({
      name: "LoadOrgExecutions",
      async execute(ctx) {
        const all = await loadAllAgentExecutions(deps.store, deps.logger);
        let filtered = filterByOrg(all, ctx.input.org);
        filtered = filterByDateRange(
          filtered,
          ctx.input.fromDate,
          ctx.input.toDate,
        );
        deps.logger.debug("Loaded executions for org usage report", {
          orgId: ctx.input.org,
          count: filtered.length,
        });
        ctx.set(EXECUTION_LIST_KEY, filtered);
      },
    })
    .addStep({
      name: "BuildOrgUsageReport",
      async execute(ctx) {
        const executions = requireExecutionList(ctx.get(EXECUTION_LIST_KEY));

        const byAgent = groupByAgentId(executions);
        const agentSummaries: AgentUsageSummary[] = [];
        for (const [aid, group] of byAgent) {
          const name =
            aid === ""
              ? "(unknown agent)"
              : await resolveAgentNameFromStore(deps, aid);
          agentSummaries.push(buildAgentSummary(aid, name, group));
        }

        ctx.set(
          ORG_USAGE_REPORT_KEY,
          create(GetOrgUsageReportOutputSchema, {
            org: ctx.input.org,
            totalAgents: distinctAgentIds(executions).length,
            totalSessions: distinctSessionIds(executions).length,
            totalRuns: executions.length,
            modelBreakdown: mergeModelBreakdowns(),
            topAgentsByCost: topAgentsByCost(agentSummaries, TOP_AGENTS_LIMIT),
            dailyCosts: buildDailyCostEntries(executions),
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

function requireExecutionList(value: unknown): Run[] {
  if (!Array.isArray(value)) {
    throw internalError(
      new Error("execution list not found in context"),
      "execution list not found in context",
    );
  }
  return value as Run[];
}

function requireReport<T>(value: unknown, message: string): T {
  if (value === undefined) {
    throw internalError(new Error(message), message);
  }
  return value as T;
}

// ---------------------------------------------------------------------------
// getRunSummary — the dashboard aggregate (get_execution_summary.go,
// a direct handler in Go as well — no pipeline). Cost is deliberately
// absent from this shape: the dashboard sources cost from
// getOrgUsageReport, so carrying it here too would count it twice.
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
 * status.audit.spec_audit.created_at in epoch ms; undefined when the
 * timestamp is absent (Go's zero time, which disables the cutoff skip for
 * that record).
 */
function auditCreatedAtMs(exec: Run): number | undefined {
  const ts = exec.status?.audit?.specAudit?.createdAt;
  if (ts === undefined) {
    return undefined;
  }
  return Number(ts.seconds) * 1000 + Math.floor(ts.nanos / 1_000_000);
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
