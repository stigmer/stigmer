/**
 * The listFires query steps — port pkg/domain/schedule/controller/list_runs.go:
 * the fire-ledger surface. Every fire leaves a row, INCLUDING
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

import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { ScheduleSchema } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import { ScheduleQueryController } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/query_pb";
import {
  ScheduleFireListSchema,
  ScheduleFireOrigin,
  ScheduleFireOutcome,
  ScheduleFireSchema,
} from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/io_pb";
import type { ScheduleFire } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { internalError, notFoundError } from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { ScheduleFireRecord, Store } from "../../store/interface.js";

type ListFiresInput = typeof ScheduleQueryController.method.listFires.input;

export const LIST_FIRES_RESULT_KEY = "listFiresResult";

/**
 * Bounds an unpaginated listFires read — history can hold a quarter's worth
 * of daily fires, and "the recent runs" is the question the surface
 * answers (Go defaultRunsPageSize).
 */
export const DEFAULT_FIRES_PAGE_SIZE = 50;

/**
 * Confirms the schedule exists — a missing schedule answers NOT_FOUND,
 * never an empty history that reads as "exists but never fired" (Go
 * loadScheduleForRunsStep).
 */
export function newLoadScheduleForFiresStep(store: Store): PipelineStep<ListFiresInput> {
  return {
    name: "LoadScheduleForRuns",
    async execute(ctx: RequestContext<ListFiresInput>): Promise<void> {
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
export function newListFiresFromLedgerStep(store: Store): PipelineStep<ListFiresInput> {
  return {
    name: "ListRunsFromLedger",
    async execute(ctx: RequestContext<ListFiresInput>): Promise<void> {
      const req = ctx.input;

      // PageInfo.num is 1-indexed by contract (pagination.proto); a
      // zero/absent page reads as the first.
      let size = req.pageInfo?.size ?? 0;
      if (size <= 0) {
        size = DEFAULT_FIRES_PAGE_SIZE;
      }
      let num = req.pageInfo?.num ?? 0;
      if (num < 1) {
        num = 1;
      }
      const offset = (num - 1) * size;

      let fires: ScheduleFireRecord[];
      let total: number;
      try {
        ({ fires, total } = await store.listScheduleFires(
          req.scheduleId,
          offset,
          size,
        ));
      } catch (error) {
        throw internalError(error, "failed to list schedule fires");
      }

      const items: ScheduleFire[] = [];
      for (const record of fires) {
        items.push(await toProtoFire(store, record));
      }

      ctx.set(
        LIST_FIRES_RESULT_KEY,
        create(ScheduleFireListSchema, { totalCount: total, items }),
      );
    },
  };
}

/**
 * Maps one ledger row to the wire, enriching a non-terminal row that
 * carries an execution id with the execution's live phase — the read-time
 * honesty rule (Go toProtoRun).
 */
async function toProtoFire(
  store: Store,
  record: ScheduleFireRecord,
): Promise<ScheduleFire> {
  const fire = create(ScheduleFireSchema, {
    scheduleId: record.scheduleId,
    org: record.org,
    origin: fireOriginFromLabel(record.origin),
    outcome: fireOutcomeFromLabel(record.outcome),
    reason: record.reason,
    runId: record.executionId,
  });
  const nominal = parseTime(record.nominalFireTime);
  if (nominal !== undefined) {
    fire.nominalFireTime = timestampFromDate(nominal);
  }
  const recordedAt = parseTime(record.recordedAt);
  if (recordedAt !== undefined) {
    fire.recordedAt = timestampFromDate(recordedAt);
  }
  if (record.completedAt !== "") {
    const completedAt = parseTime(record.completedAt);
    if (completedAt !== undefined) {
      fire.completedAt = timestampFromDate(completedAt);
    }
    return fire;
  }

  // In flight on paper — ask the execution row what actually happened.
  if (record.executionId === "") {
    return fire;
  }
  let phase: RunPhase;
  try {
    const execution = await store.getResource(
      ApiResourceKind.run,
      record.executionId,
      RunSchema,
    );
    phase = execution.status?.phase ?? RunPhase.RUN_PHASE_UNSPECIFIED;
  } catch {
    // Execution deleted (or unreadable): the ledger row stands as
    // recorded — deleting a run must not rewrite its history.
    return fire;
  }
  switch (phase) {
    case RunPhase.RUN_COMPLETED:
      fire.outcome = ScheduleFireOutcome.COMPLETED;
      break;
    case RunPhase.RUN_FAILED:
    case RunPhase.RUN_CANCELLED:
    case RunPhase.RUN_TERMINATED:
      fire.outcome = ScheduleFireOutcome.FAILED;
      fire.reason = `run ${record.executionId} ended ${executionPhaseWord(phase)}`;
      break;
    default:
      // Genuinely still running — "started" is the honest answer.
      break;
  }
  return fire;
}

/**
 * Lowers an RunPhase to the reason vocabulary the tick's verdict
 * writer uses ("run X ended failed") — Go executionPhaseWord.
 */
function executionPhaseWord(phase: RunPhase): string {
  switch (phase) {
    case RunPhase.RUN_FAILED:
      return "failed";
    case RunPhase.RUN_CANCELLED:
      return "cancelled";
    case RunPhase.RUN_TERMINATED:
      return "terminated";
    default:
      return "unknown";
  }
}

/** Maps the ledger's lowercase origin vocabulary back to the wire enum. */
function fireOriginFromLabel(origin: string): ScheduleFireOrigin {
  switch (origin) {
    case "cron":
      return ScheduleFireOrigin.CRON;
    case "manual":
      return ScheduleFireOrigin.MANUAL;
    default:
      return ScheduleFireOrigin.UNSPECIFIED;
  }
}

/** Maps the ledger's lowercase outcome vocabulary back to the wire enum. */
function fireOutcomeFromLabel(outcome: string): ScheduleFireOutcome {
  switch (outcome) {
    case "started":
      return ScheduleFireOutcome.STARTED;
    case "refused":
      return ScheduleFireOutcome.REFUSED;
    case "target_missing":
      return ScheduleFireOutcome.TARGET_MISSING;
    case "skipped":
      return ScheduleFireOutcome.SKIPPED;
    case "completed":
      return ScheduleFireOutcome.COMPLETED;
    case "failed":
      return ScheduleFireOutcome.FAILED;
    case "timed_out":
      return ScheduleFireOutcome.TIMED_OUT;
    default:
      return ScheduleFireOutcome.UNSPECIFIED;
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
