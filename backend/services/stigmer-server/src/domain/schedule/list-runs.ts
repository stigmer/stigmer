/**
 * The listRuns query steps — port pkg/domain/schedule/controller/list_runs.go:
 * the fire-ledger surface (DD-017 D-7). Every fire leaves a row, INCLUDING
 * fires that created no execution (a refused launch gate, a missing target
 * agent), with the refusing gate's copy verbatim: this is the RPC that
 * explains status.consecutive_failures.
 *
 * Rows carrying an execution id but no terminal outcome are enriched with
 * the execution's LIVE phase at read time — manual fires are untracked by
 * design (the caller watches the execution), so their outcome is resolved
 * here rather than by a tracker, and outcome columns never lie while a run
 * is in flight.
 */
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";

import { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { ScheduleSchema } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import { ScheduleQueryController } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/query_pb";
import {
  ScheduleRunListSchema,
  ScheduleRunOrigin,
  ScheduleRunOutcome,
  ScheduleRunSchema,
} from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/io_pb";
import type { ScheduleRun } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { internalError, notFoundError } from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { ScheduleRunRecord, Store } from "../../store/interface.js";

type ListRunsInput = typeof ScheduleQueryController.method.listRuns.input;

export const LIST_RUNS_RESULT_KEY = "listRunsResult";

/**
 * Bounds an unpaginated listRuns read — history can hold a quarter's worth
 * of daily fires, and "the recent runs" is the question the surface
 * answers (Go defaultRunsPageSize).
 */
export const DEFAULT_RUNS_PAGE_SIZE = 50;

/**
 * Confirms the schedule exists — a missing schedule answers NOT_FOUND,
 * never an empty history that reads as "exists but never fired" (Go
 * loadScheduleForRunsStep).
 */
export function newLoadScheduleForRunsStep(store: Store): PipelineStep<ListRunsInput> {
  return {
    name: "LoadScheduleForRuns",
    async execute(ctx: RequestContext<ListRunsInput>): Promise<void> {
      const scheduleId = ctx.input.scheduleId;
      try {
        await store.getResource(
          ApiResourceKind.schedule,
          scheduleId,
          ScheduleSchema,
        );
      } catch (error) {
        if (error instanceof ResourceNotFoundError) {
          throw notFoundError("Schedule", scheduleId);
        }
        throw internalError(error, "failed to load schedule");
      }
    },
  };
}

/**
 * Pages the fire ledger (newest first) and enriches in-flight rows with
 * the execution's live phase (Go listRunsFromLedgerStep).
 */
export function newListRunsFromLedgerStep(store: Store): PipelineStep<ListRunsInput> {
  return {
    name: "ListRunsFromLedger",
    async execute(ctx: RequestContext<ListRunsInput>): Promise<void> {
      const req = ctx.input;

      // PageInfo.num is 1-indexed by contract (pagination.proto); a
      // zero/absent page reads as the first.
      let size = req.pageInfo?.size ?? 0;
      if (size <= 0) {
        size = DEFAULT_RUNS_PAGE_SIZE;
      }
      let num = req.pageInfo?.num ?? 0;
      if (num < 1) {
        num = 1;
      }
      const offset = (num - 1) * size;

      let runs: ScheduleRunRecord[];
      let total: number;
      try {
        ({ runs, total } = await store.listScheduleRuns(
          req.scheduleId,
          offset,
          size,
        ));
      } catch (error) {
        throw internalError(error, "failed to list schedule runs");
      }

      const items: ScheduleRun[] = [];
      for (const record of runs) {
        items.push(await toProtoRun(store, record));
      }

      ctx.set(
        LIST_RUNS_RESULT_KEY,
        create(ScheduleRunListSchema, { totalCount: total, items }),
      );
    },
  };
}

/**
 * Maps one ledger row to the wire, enriching a non-terminal row that
 * carries an execution id with the execution's live phase — the read-time
 * honesty rule (Go toProtoRun).
 */
async function toProtoRun(
  store: Store,
  record: ScheduleRunRecord,
): Promise<ScheduleRun> {
  const run = create(ScheduleRunSchema, {
    scheduleId: record.scheduleId,
    org: record.org,
    origin: runOriginFromLabel(record.origin),
    outcome: runOutcomeFromLabel(record.outcome),
    reason: record.reason,
    executionId: record.executionId,
  });
  const nominal = parseTime(record.nominalFireTime);
  if (nominal !== undefined) {
    run.nominalFireTime = timestampFromDate(nominal);
  }
  const recordedAt = parseTime(record.recordedAt);
  if (recordedAt !== undefined) {
    run.recordedAt = timestampFromDate(recordedAt);
  }
  if (record.completedAt !== "") {
    const completedAt = parseTime(record.completedAt);
    if (completedAt !== undefined) {
      run.completedAt = timestampFromDate(completedAt);
    }
    return run;
  }

  // In flight on paper — ask the execution row what actually happened.
  if (record.executionId === "") {
    return run;
  }
  let phase: ExecutionPhase;
  try {
    const execution = await store.getResource(
      ApiResourceKind.agent_execution,
      record.executionId,
      AgentExecutionSchema,
    );
    phase = execution.status?.phase ?? ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED;
  } catch {
    // Execution deleted (or unreadable): the ledger row stands as
    // recorded — deleting a run must not rewrite its history.
    return run;
  }
  switch (phase) {
    case ExecutionPhase.EXECUTION_COMPLETED:
      run.outcome = ScheduleRunOutcome.COMPLETED;
      break;
    case ExecutionPhase.EXECUTION_FAILED:
    case ExecutionPhase.EXECUTION_CANCELLED:
    case ExecutionPhase.EXECUTION_TERMINATED:
      run.outcome = ScheduleRunOutcome.FAILED;
      run.reason = `run ${record.executionId} ended ${executionPhaseWord(phase)}`;
      break;
    default:
      // Genuinely still running — "started" is the honest answer.
      break;
  }
  return run;
}

/**
 * Lowers an ExecutionPhase to the reason vocabulary the tick's verdict
 * writer uses ("run X ended failed") — Go executionPhaseWord.
 */
function executionPhaseWord(phase: ExecutionPhase): string {
  switch (phase) {
    case ExecutionPhase.EXECUTION_FAILED:
      return "failed";
    case ExecutionPhase.EXECUTION_CANCELLED:
      return "cancelled";
    case ExecutionPhase.EXECUTION_TERMINATED:
      return "terminated";
    default:
      return "unknown";
  }
}

/** Maps the ledger's lowercase origin vocabulary back to the wire enum. */
function runOriginFromLabel(origin: string): ScheduleRunOrigin {
  switch (origin) {
    case "cron":
      return ScheduleRunOrigin.CRON;
    case "manual":
      return ScheduleRunOrigin.MANUAL;
    default:
      return ScheduleRunOrigin.UNSPECIFIED;
  }
}

/** Maps the ledger's lowercase outcome vocabulary back to the wire enum. */
function runOutcomeFromLabel(outcome: string): ScheduleRunOutcome {
  switch (outcome) {
    case "started":
      return ScheduleRunOutcome.STARTED;
    case "refused":
      return ScheduleRunOutcome.REFUSED;
    case "target_missing":
      return ScheduleRunOutcome.TARGET_MISSING;
    case "skipped":
      return ScheduleRunOutcome.SKIPPED;
    case "completed":
      return ScheduleRunOutcome.COMPLETED;
    case "failed":
      return ScheduleRunOutcome.FAILED;
    case "timed_out":
      return ScheduleRunOutcome.TIMED_OUT;
    default:
      return ScheduleRunOutcome.UNSPECIFIED;
  }
}

/** Go's time.Parse(time.RFC3339) tolerance: unparseable leaves the field unset. */
function parseTime(value: string): Date | undefined {
  if (value === "") {
    return undefined;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}
