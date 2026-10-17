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
import { RoutineSchema } from "@stigmer/protos/ai/stigmer/agentic/routine/v1/api_pb";
import { RoutineQueryController } from "@stigmer/protos/ai/stigmer/agentic/routine/v1/query_pb";
import {
  RoutineFireListSchema,
  RoutineFireOrigin,
  RoutineFireOutcome,
  RoutineFireSchema,
} from "@stigmer/protos/ai/stigmer/agentic/routine/v1/io_pb";
import type { RoutineFire } from "@stigmer/protos/ai/stigmer/agentic/routine/v1/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { internalError, notFoundError } from "../../pipeline/errors.js";
import {
  listPageFingerprint,
  readPage,
} from "../../pipeline/steps/list-page.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { RoutineFireRecord, Store } from "../../store/interface.js";

type ListFiresInput = typeof RoutineQueryController.method.listFires.input;

export const LIST_FIRES_RESULT_KEY = "listFiresResult";

/**
 * Confirms the schedule exists — a missing schedule answers NOT_FOUND,
 * never an empty history that reads as "exists but never fired" (Go
 * loadScheduleForRunsStep).
 */
export function newLoadRoutineForFiresStep(store: Store): PipelineStep<ListFiresInput> {
  return {
    name: "LoadScheduleForRuns",
    async execute(ctx: RequestContext<ListFiresInput>): Promise<void> {
      const routineId = ctx.input.routineId;
      try {
        await store.getResource(
          ApiResourceKind.routine,
          routineId,
          RoutineSchema,
        );
      } catch (error) {
        if (error instanceof ResourceNotFoundError) {
          throw notFoundError("Schedule", routineId);
        }
        throw internalError(error, "failed to load schedule");
      }
    },
  };
}

/**
 * Pages the fire ledger (newest first) by its key, then enriches the
 * page's in-flight rows with the execution's live phase (Go
 * listRunsFromLedgerStep). The ledger's rows carry their key as the page
 * cursor: the nominal fire time in the cursor's instant and the origin in
 * its id, the two columns the ledger orders by.
 */
export function newListFiresFromLedgerStep(store: Store): PipelineStep<ListFiresInput> {
  return {
    name: "ListRunsFromLedger",
    async execute(ctx: RequestContext<ListFiresInput>): Promise<void> {
      const req = ctx.input;
      const page = await readPage<RoutineFireRecord>({
        source: async (after, limit) =>
          (
            await store.listRoutineFires(
              req.routineId,
              after === undefined
                ? undefined
                : { nominalFireTime: after.createdAt, origin: after.id },
              limit,
            )
          ).map((record) => ({
            id: record.origin,
            data: encodeRecord(record),
            cursor: { createdAt: record.nominalFireTime, id: record.origin },
          })),
        request: req,
        fingerprint: listPageFingerprint({
          lane: "schedule.listFires",
          scheduleId: req.routineId,
        }),
        decode: decodeRecord,
        // Authorized once, on the schedule: the fires are its own record.
        scope: (records) => Promise.resolve(records),
        failure: "failed to list schedule fires",
      });

      const entries: RoutineFire[] = [];
      for (const record of page.entries) {
        entries.push(await toProtoFire(store, record));
      }
      ctx.set(
        LIST_FIRES_RESULT_KEY,
        create(RoutineFireListSchema, {
          entries,
          nextPageToken: page.nextPageToken,
        }),
      );
    },
  };
}

/** A ledger row as the page loop carries it: its own fields, as JSON bytes. */
function encodeRecord(record: RoutineFireRecord): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(record));
}

function decodeRecord(data: Uint8Array): RoutineFireRecord {
  return JSON.parse(new TextDecoder().decode(data)) as RoutineFireRecord;
}

/**
 * Maps one ledger row to the wire, enriching a non-terminal row that
 * carries an execution id with the execution's live phase — the read-time
 * honesty rule (Go toProtoRun).
 */
async function toProtoFire(
  store: Store,
  record: RoutineFireRecord,
): Promise<RoutineFire> {
  const fire = create(RoutineFireSchema, {
    routineId: record.routineId,
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
      fire.outcome = RoutineFireOutcome.COMPLETED;
      break;
    case RunPhase.RUN_FAILED:
    case RunPhase.RUN_CANCELLED:
    case RunPhase.RUN_TERMINATED:
      fire.outcome = RoutineFireOutcome.FAILED;
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
function fireOriginFromLabel(origin: string): RoutineFireOrigin {
  switch (origin) {
    case "cron":
      return RoutineFireOrigin.SCHEDULE;
    case "manual":
      return RoutineFireOrigin.MANUAL;
    default:
      return RoutineFireOrigin.UNSPECIFIED;
  }
}

/** Maps the ledger's lowercase outcome vocabulary back to the wire enum. */
function fireOutcomeFromLabel(outcome: string): RoutineFireOutcome {
  switch (outcome) {
    case "started":
      return RoutineFireOutcome.STARTED;
    case "refused":
      return RoutineFireOutcome.REFUSED;
    case "target_missing":
      return RoutineFireOutcome.TARGET_MISSING;
    case "skipped":
      return RoutineFireOutcome.SKIPPED;
    case "completed":
      return RoutineFireOutcome.COMPLETED;
    case "failed":
      return RoutineFireOutcome.FAILED;
    case "timed_out":
      return RoutineFireOutcome.TIMED_OUT;
    default:
      return RoutineFireOutcome.UNSPECIFIED;
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
