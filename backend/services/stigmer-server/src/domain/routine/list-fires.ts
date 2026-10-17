/**
 * The listFires query steps: the fire-ledger surface. Every fire leaves a
 * row, INCLUDING fires that created no run (a refused launch gate, a
 * missing target agent), with the refusing gate's copy verbatim, and who
 * fired it when someone did: this is the RPC that explains
 * status.consecutive_failures, and who started what.
 *
 * Rows carrying a run id but no terminal outcome are enriched with the
 * run's LIVE phase at read time — manual fires are untracked by design
 * (the caller watches the run), so their outcome is resolved here rather
 * than by a tracker, and outcome columns never lie while a run is in
 * flight.
 */
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";

import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { RoutineSchema } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/api_pb";
import { RoutineQueryController } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/query_pb";
import {
  RoutineFireListSchema,
  RoutineFireOrigin,
  RoutineFireOutcome,
  RoutineFireSchema,
} from "@stigmer/apis/ai/stigmer/agentic/routine/v1/io_pb";
import type { RoutineFire } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/io_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceAuditActorSchema } from "@stigmer/apis/ai/stigmer/commons/apiresource/status_pb";

import { internalError, notFoundError } from "../../pipeline/errors.js";
import {
  listPageFingerprint,
  readPage,
} from "../../pipeline/steps/list-page.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { RoutineFireRecord, Store } from "../../store/interface.js";
import {
  RUN_LEDGER_ORIGIN_MANUAL,
  RUN_LEDGER_ORIGIN_SCHEDULE,
} from "../../temporal/routine/run-ledger.js";

type ListFiresInput = typeof RoutineQueryController.method.listFires.input;

export const LIST_FIRES_RESULT_KEY = "listFiresResult";

/**
 * Confirms the routine exists — a missing routine answers NOT_FOUND,
 * never an empty history that reads as "exists but never fired".
 */
export function newLoadRoutineForFiresStep(store: Store): PipelineStep<ListFiresInput> {
  return {
    name: "LoadRoutineForFires",
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
          throw notFoundError("Routine", routineId);
        }
        throw internalError(error, "failed to load routine");
      }
    },
  };
}

/**
 * Pages the fire ledger (newest first), then enriches the page's in-flight
 * rows with the run's live phase. The ledger's rows carry their order as
 * the page cursor: the nominal fire time in the cursor's instant and the
 * fire id in its id, the two columns the ledger orders by.
 */
export function newListFiresFromLedgerStep(store: Store): PipelineStep<ListFiresInput> {
  return {
    name: "ListFiresFromLedger",
    async execute(ctx: RequestContext<ListFiresInput>): Promise<void> {
      const req = ctx.input;
      const page = await readPage<RoutineFireRecord>({
        source: async (after, limit) =>
          (
            await store.listRoutineFires(
              req.routineId,
              after === undefined
                ? undefined
                : { nominalFireTime: after.createdAt, fireId: after.id },
              limit,
            )
          ).map((record) => ({
            id: record.fireId,
            data: encodeRecord(record),
            cursor: { createdAt: record.nominalFireTime, id: record.fireId },
          })),
        request: req,
        fingerprint: listPageFingerprint({
          lane: "routine.listFires",
          routineId: req.routineId,
        }),
        decode: decodeRecord,
        // Authorized once, on the routine: the fires are its own record.
        scope: (records) => Promise.resolve(records),
        failure: "failed to list routine fires",
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

/** A ledger row as the page loop carries it: its fields as JSON bytes, the actor as its own bytes. */
function encodeRecord(record: RoutineFireRecord): Uint8Array {
  const { firedBy, ...fields } = record;
  return new TextEncoder().encode(
    JSON.stringify({
      ...fields,
      firedBy:
        firedBy === undefined
          ? undefined
          : Buffer.from(toBinary(ApiResourceAuditActorSchema, firedBy)).toString("base64"),
    }),
  );
}

function decodeRecord(data: Uint8Array): RoutineFireRecord {
  const { firedBy, ...fields } = JSON.parse(new TextDecoder().decode(data)) as Omit<
    RoutineFireRecord,
    "firedBy"
  > & { readonly firedBy?: string };
  return {
    ...fields,
    firedBy:
      firedBy === undefined
        ? undefined
        : fromBinary(ApiResourceAuditActorSchema, Buffer.from(firedBy, "base64")),
  };
}

/**
 * Maps one ledger row to the wire, enriching a non-terminal row that
 * carries a run id with the run's live phase — the read-time honesty rule.
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
    runId: record.runId,
    fireId: record.fireId,
    firedBy: record.firedBy,
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

  // In flight on paper — ask the run row what actually happened.
  if (record.runId === "") {
    return fire;
  }
  let phase: RunPhase;
  try {
    const run = await store.getResource(ApiResourceKind.run, record.runId, RunSchema);
    phase = run.status?.phase ?? RunPhase.RUN_PHASE_UNSPECIFIED;
  } catch {
    // Run deleted (or unreadable): the ledger row stands as recorded —
    // deleting a run must not rewrite its history.
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
      fire.reason = `run ${record.runId} ended ${RUN_PHASE_WORD[phase]}`;
      break;
    default:
      // Genuinely still running — "started" is the honest answer.
      break;
  }
  return fire;
}

/**
 * Lowers an ended RunPhase to the reason vocabulary the tick's verdict
 * writer uses ("run X ended failed"). A Record over the phases the caller
 * narrowed to, so no phase reaches it without a word.
 */
const RUN_PHASE_WORD: Readonly<
  Record<RunPhase.RUN_FAILED | RunPhase.RUN_CANCELLED | RunPhase.RUN_TERMINATED, string>
> = {
  [RunPhase.RUN_FAILED]: "failed",
  [RunPhase.RUN_CANCELLED]: "cancelled",
  [RunPhase.RUN_TERMINATED]: "terminated",
};

/** Maps the ledger's lowercase origin vocabulary back to the wire enum. */
function fireOriginFromLabel(origin: string): RoutineFireOrigin {
  switch (origin) {
    case RUN_LEDGER_ORIGIN_SCHEDULE:
      return RoutineFireOrigin.SCHEDULE;
    case RUN_LEDGER_ORIGIN_MANUAL:
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
