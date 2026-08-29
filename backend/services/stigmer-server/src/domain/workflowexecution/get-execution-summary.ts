/**
 * GetExecutionSummary — ports get_execution_summary.go (T14 dashboard,
 * T12 overview): a full scan aggregated into phase counts, cost totals,
 * average completed duration, top failure ranks, and per-workflow cost
 * breakdown, optionally scoped by time window and workflow.
 *
 * Zero-shape pins (Class A suite): success_rate is the -1 sentinel when
 * no terminal executions exist (distinguishable from a real 0%); the
 * zero-valued total_cost summary is ALWAYS present; avg_duration is
 * deliberately absent when nothing completed (an average over nothing is
 * not 0).
 *
 * With a composed ExecutionReadScope (C2 Stage 4 — the multi-tenant
 * edition), the scan narrows to the caller's authorized ids intersected
 * with the requested org (the Java GetExecutionSummary baseline: without
 * the org filter a member of several organizations sees every org's
 * numbers on every dashboard), and an EMPTY authorized set answers the
 * proto default instance — the conformance-pinned multi-tenant zero shape
 * (success_rate 0, NO cost summary) falls out of the scoping, never a
 * special case. No scope composed = the full scan above, byte-identical
 * (the request's org deliberately not consulted — single-user semantics).
 *
 * Tie order in the two ranked lists is not wire-stable in Go (map
 * iteration feeds a stable sort), so ties here — deterministic first-seen
 * order — are not a wire divergence (the #6 sort-stability precedent).
 */
import { create } from "@bufbuild/protobuf";
import { DurationSchema } from "@bufbuild/protobuf/wkt";
import type { Timestamp } from "@bufbuild/protobuf/wkt";
import { timestampMs } from "@bufbuild/protobuf/wkt";

import type { WorkflowExecution } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
import {
  ExecutionSummarySchema,
  SummaryTimeWindow,
  WorkflowCostBreakdownSchema,
  WorkflowCostSummarySchema,
  WorkflowFailureRankSchema,
} from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/io_pb";
import type {
  ExecutionSummary,
  GetExecutionSummaryRequest,
  WorkflowCostBreakdown,
  WorkflowFailureRank,
} from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/io_pb";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../../boot/logger.js";
import type { ExecutionReadScope } from "../../extensions/execution-read-scope.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import type { Store } from "../../store/interface.js";

import { parseRfc3339Ms } from "./execution-filter.js";
import { loadAllWorkflowExecutions } from "./queries.js";

const RANK_LIMIT = 10;

export interface SummaryDeps {
  readonly store: Store;
  readonly logger: Logger;
  /** The composed summary read scope — undefined = the OSS full scan (C2 Stage 4). */
  readonly executionReadScope: ExecutionReadScope | undefined;
}

export async function getExecutionSummary(
  deps: SummaryDeps,
  req: GetExecutionSummaryRequest,
  identity: CallerIdentity,
): Promise<ExecutionSummary> {
  let executions = await loadAllWorkflowExecutions(
    deps.store,
    deps.logger,
    "failed to list workflow executions for summary",
  );

  if (deps.executionReadScope !== undefined) {
    const authorizedIds = await deps.executionReadScope.authorizedExecutionIds(
      identity,
      ApiResourceKind.workflow_execution,
    );
    if (authorizedIds.size === 0) {
      // The Java baseline's empty arm: the default instance, before any
      // aggregation — success_rate 0 and NO cost summary by construction.
      return create(ExecutionSummarySchema);
    }
    executions = executions.filter(
      (execution) =>
        authorizedIds.has(execution.metadata?.id ?? "") &&
        execution.metadata?.org === req.org,
    );
  }

  const cutoffMs = resolveTimeCutoffMs(req.timeWindow);
  const workflowFilter = req.workflowId;

  const phaseCounts: Record<number, number> = {};
  let activeCount = 0;
  let totalCount = 0;
  let completedCount = 0;
  let failedCount = 0;
  const completedDurationsMs: number[] = [];
  const failureCounts = new Map<string, number>();
  const workflowNames = new Map<string, string>();
  const execByWorkflow = new Map<string, number>();
  const costByWorkflow = new Map<string, number>();

  let totalCostMicros = 0n;
  let totalInputTokens = 0n;
  let totalOutputTokens = 0n;

  for (const execution of executions) {
    const createdAtMs = auditCreatedAtMs(
      execution.status?.audit?.specAudit?.createdAt,
    );
    if (
      createdAtMs !== undefined &&
      cutoffMs !== undefined &&
      createdAtMs < cutoffMs
    ) {
      continue;
    }

    if (
      workflowFilter !== "" &&
      execution.spec?.workflowId !== workflowFilter &&
      execution.spec?.workflowInstanceId !== workflowFilter
    ) {
      continue;
    }

    const phase =
      execution.status?.phase ?? ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED;
    phaseCounts[phase] = (phaseCounts[phase] ?? 0) + 1;
    totalCount++;

    if (isActivePhase(phase)) {
      activeCount++;
    }
    if (phase === ExecutionPhase.EXECUTION_COMPLETED) {
      completedCount++;
    }
    if (phase === ExecutionPhase.EXECUTION_FAILED) {
      failedCount++;
    }

    // Go's extractWorkflowSlug reads the EXECUTION's metadata.slug (the
    // per-workflow grouping key the dashboard renders).
    const slug = execution.metadata?.slug ?? "";
    if (slug !== "") {
      execByWorkflow.set(slug, (execByWorkflow.get(slug) ?? 0) + 1);
      const name = execution.metadata?.name ?? "";
      if (name !== "") {
        workflowNames.set(slug, name);
      }
    }

    const execCostMicros = execution.status?.totalCostMicros ?? 0n;
    totalCostMicros += execCostMicros;
    totalInputTokens += execution.status?.totalInputTokens ?? 0n;
    totalOutputTokens += execution.status?.totalOutputTokens ?? 0n;
    if (slug !== "" && execCostMicros > 0n) {
      costByWorkflow.set(
        slug,
        (costByWorkflow.get(slug) ?? 0) + Number(execCostMicros) / 1_000_000,
      );
    }

    if (phase === ExecutionPhase.EXECUTION_COMPLETED) {
      const durationMs = completionDurationMs(execution);
      if (durationMs > 0) {
        completedDurationsMs.push(durationMs);
      }
    }

    if (phase === ExecutionPhase.EXECUTION_FAILED && slug !== "") {
      failureCounts.set(slug, (failureCounts.get(slug) ?? 0) + 1);
    }
  }

  let successRate = -1;
  const terminal = completedCount + failedCount;
  if (terminal > 0) {
    successRate = completedCount / terminal;
  }

  const summary = create(ExecutionSummarySchema, {
    activeCount,
    phaseCounts,
    totalCost: create(WorkflowCostSummarySchema, {
      totalCostUsd: Number(totalCostMicros) / 1_000_000,
      totalInputTokens,
      totalOutputTokens,
    }),
    totalCount,
    successRate,
  });

  if (completedDurationsMs.length > 0) {
    let totalMs = 0;
    for (const durationMs of completedDurationsMs) {
      totalMs += durationMs;
    }
    summary.avgDuration = durationFromMs(
      totalMs / completedDurationsMs.length,
    );
  }

  summary.topFailingWorkflows = buildFailureRanks(
    failureCounts,
    workflowNames,
    RANK_LIMIT,
  );
  summary.costByWorkflow = buildCostBreakdown(
    costByWorkflow,
    execByWorkflow,
    workflowNames,
    RANK_LIMIT,
  );

  return summary;
}

/**
 * resolveTimeCutoff — LAST_7D is the default for unspecified/unknown
 * windows; ALL_TIME is the "no cutoff" sentinel (Go's zero time,
 * undefined here).
 */
export function resolveTimeCutoffMs(
  timeWindow: SummaryTimeWindow,
): number | undefined {
  const nowMs = Date.now();
  switch (timeWindow) {
    case SummaryTimeWindow.LAST_24H:
      return nowMs - 24 * 60 * 60 * 1000;
    case SummaryTimeWindow.LAST_7D:
      return nowMs - 7 * 24 * 60 * 60 * 1000;
    case SummaryTimeWindow.LAST_30D:
      return nowMs - 30 * 24 * 60 * 60 * 1000;
    case SummaryTimeWindow.ALL_TIME:
      return undefined;
    default:
      return nowMs - 7 * 24 * 60 * 60 * 1000;
  }
}

function isActivePhase(phase: ExecutionPhase): boolean {
  return (
    phase === ExecutionPhase.EXECUTION_PENDING ||
    phase === ExecutionPhase.EXECUTION_IN_PROGRESS ||
    phase === ExecutionPhase.EXECUTION_PAUSED
  );
}

/** Go auditCreatedAt: nil timestamp → zero time (undefined here). */
function auditCreatedAtMs(createdAt: Timestamp | undefined): number | undefined {
  if (createdAt === undefined) {
    return undefined;
  }
  return timestampMs(createdAt);
}

/**
 * Go completionDuration: 0 when either timestamp is missing or
 * unparseable — those executions are excluded from the average (the
 * `> 0` guard at the call site).
 */
function completionDurationMs(execution: WorkflowExecution): number {
  const started = parseRfc3339Ms(execution.status?.startedAt ?? "");
  const completed = parseRfc3339Ms(execution.status?.completedAt ?? "");
  if (Number.isNaN(started) || Number.isNaN(completed)) {
    return 0;
  }
  return completed - started;
}

function durationFromMs(ms: number) {
  const truncatedMs = Math.trunc(ms);
  const seconds = Math.trunc(truncatedMs / 1000);
  const nanos = Math.trunc((truncatedMs - seconds * 1000) * 1_000_000);
  return create(DurationSchema, { seconds: BigInt(seconds), nanos });
}

/** Failure ranks by count descending, capped (stable; ties first-seen). */
function buildFailureRanks(
  counts: Map<string, number>,
  names: Map<string, string>,
  limit: number,
): WorkflowFailureRank[] {
  const entries = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return entries.slice(0, limit).map(([slug, count]) =>
    create(WorkflowFailureRankSchema, {
      workflowSlug: slug,
      workflowName: names.get(slug) ?? "",
      failureCount: count,
    }),
  );
}

/** Cost breakdown by total cost descending, capped (ties first-seen). */
function buildCostBreakdown(
  costs: Map<string, number>,
  execCounts: Map<string, number>,
  names: Map<string, string>,
  limit: number,
): WorkflowCostBreakdown[] {
  const entries = [...costs.entries()].sort((a, b) => b[1] - a[1]);
  return entries.slice(0, limit).map(([slug, cost]) =>
    create(WorkflowCostBreakdownSchema, {
      workflowSlug: slug,
      workflowName: names.get(slug) ?? "",
      totalCostUsd: cost,
      executionCount: execCounts.get(slug) ?? 0,
    }),
  );
}
