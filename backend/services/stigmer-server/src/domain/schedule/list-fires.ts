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
import {
  listPageFingerprint,
  readPage,
} from "../../pipeline/steps/list-page.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { ScheduleFireRecord, Store } from "../../store/interface.js";

type ListFiresInput = typeof ScheduleQueryController.method.listFires.input;

export const LIST_FIRES_RESULT_KEY = "listFiresResult";

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
      const page = await readPage<ScheduleFireRecord>({
        source: async (after, limit) =>
          (
            await store.listScheduleFires(
              req.scheduleId,
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
          scheduleId: req.scheduleId,
        }),
        decode: decodeRecord,
        // Authorized once, on the schedule: the fires are its own record.
        scope: (records) => Promise.resolve(records),
        failure: "failed to list schedule fires",
      });

      const entries: ScheduleFire[] = [];
      for (const record of page.entries) {
        entries.push(await toProtoFire(store, record));
      }
      ctx.set(
        LIST_FIRES_RESULT_KEY,
        create(ScheduleFireListSchema, {
          entries,
          nextPageToken: page.nextPageToken,
        }),
      );
    },
  };
}

/** A ledger row as the page loop carries it: its own fields, as JSON bytes. */
function encodeRecord(record: ScheduleFireRecord): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(record));
}

function decodeRecord(data: Uint8Array): ScheduleFireRecord {
  return JSON.parse(new TextDecoder().decode(data)) as ScheduleFireRecord;
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
