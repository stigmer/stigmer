/**
 * The Clock seam and the write-path arming/teardown steps — ports
 * pkg/domain/schedule/controller/clock.go.
 *
 * Clock is the narrow slice of the scheduling runtime the write paths need
 * (satisfied by the clock's ScheduleSyncer). Undefined until the server
 * wires it — and possibly forever, when Temporal was never configured:
 * every consumer below degrades instead of refusing, because "no Temporal
 * right now" is a supported OSS state (DD-015 D-A) and a declarative
 * resource must be writable offline. The reconciliation pass converges
 * whatever was written while the clock was away.
 *
 * Go's Clock also declares Trigger (the DD-014 artifact-trigger lane);
 * DD-017 D-5 left it with zero production callers, so this seam
 * deliberately omits it (sub-project decision 2, owner-ratified).
 */
import { create } from "@bufbuild/protobuf";
import type { DescMessage } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";

import type { Schedule } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import { ScheduleSchema } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import { ScheduleStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/status_pb";

import type { Logger } from "../../boot/logger.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import { RESOURCE_ID_KEY } from "../../pipeline/steps/delete.js";
import { EXISTING_RESOURCE_KEY } from "../../pipeline/steps/load-existing.js";
import type { Store } from "../../store/interface.js";

/** The write paths' slice of the scheduling runtime (Go Clock). */
export interface ScheduleClock {
  /**
   * Converges the resource's Temporal artifact and stamps
   * status.next_fire_at; returns the stamp (undefined when paused).
   */
  ensureAndRecord(schedule: Schedule): Promise<Date | undefined>;
  /** Deletes the resource's artifact (not-found is success). */
  teardown(resourceId: string): Promise<void>;
}

/** A provider so the compose root can wire the clock after the store stage. */
export type ClockProvider = () => ScheduleClock | undefined;

/**
 * Converges the artifact AFTER a successful write (create/update/apply —
 * pipelines whose request is the Schedule) and mirrors the fresh
 * next_fire_at into the response state (Go armScheduleStep).
 *
 * Non-critical in every outcome: a failed arm logs and succeeds, because
 * the write already happened and the reconciliation pass is the
 * correctness path. Refusing here would tear declarative writes away from
 * offline use for no gain (DD-015 D-A).
 */
export function newArmScheduleStep(
  clock: ClockProvider,
  logger: Logger,
): PipelineStep<typeof ScheduleSchema> {
  return {
    name: "ArmScheduleArtifact",
    async execute(ctx: RequestContext<typeof ScheduleSchema>): Promise<void> {
      await armAndMirror(clock(), ctx.newState, logger);
    },
  };
}

/**
 * The resume pipeline's arming step (request type ScheduleId; the resumed
 * schedule lives under EXISTING_RESOURCE_KEY). Re-arming is what makes
 * resume answer with a fresh next_fire_at — the latch just cleared, so
 * DesiredPaused flipped and the artifact must unpause NOW, not at the next
 * sweep (Go armResumedScheduleStep).
 */
export function newArmResumedScheduleStep<Desc extends DescMessage>(
  clock: ClockProvider,
  logger: Logger,
): PipelineStep<Desc> {
  return {
    name: "ArmResumedScheduleArtifact",
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      const schedule = ctx.get(EXISTING_RESOURCE_KEY) as Schedule | undefined;
      if (schedule === undefined) {
        return;
      }
      await armAndMirror(clock(), schedule, logger);
    },
  };
}

/**
 * Runs the ensure and mirrors the stamp into the in-memory state the
 * pipeline will answer with, so the response's next_fire_at matches what
 * was just recorded on the row (Go armAndMirror).
 */
async function armAndMirror(
  clock: ScheduleClock | undefined,
  schedule: Schedule | undefined,
  logger: Logger,
): Promise<void> {
  if (clock === undefined || schedule === undefined) {
    return;
  }
  let nextFireAt: Date | undefined;
  try {
    nextFireAt = await clock.ensureAndRecord(schedule);
  } catch (error) {
    logger.warn(
      "Schedule artifact not armed — next_fire_at stays absent until the reconciliation pass converges it",
      {
        schedule_id: schedule.metadata?.id ?? "",
        error: error instanceof Error ? error.message : String(error),
      },
    );
    return;
  }
  if (schedule.status === undefined) {
    schedule.status = create(ScheduleStatusSchema);
  }
  schedule.status.nextFireAt =
    nextFireAt === undefined ? undefined : timestampFromDate(nextFireAt);
}

/**
 * Deletes the artifact AFTER the row delete (DD-008 D9: the row is the
 * source of truth — a failed row delete must never tear down a live
 * schedule's clock, so this step only ever runs once the delete
 * succeeded). Non-critical: an orphaned artifact cannot fire past
 * revalidation, and the reconciliation pass reaps it (Go
 * teardownScheduleArtifactStep).
 */
export function newTeardownScheduleArtifactStep<Desc extends DescMessage>(
  clock: ClockProvider,
  logger: Logger,
): PipelineStep<Desc> {
  return {
    name: "TeardownScheduleArtifact",
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      const liveClock = clock();
      if (liveClock === undefined) {
        return;
      }
      const resourceId = ctx.get(RESOURCE_ID_KEY);
      if (typeof resourceId !== "string" || resourceId === "") {
        return;
      }
      try {
        await liveClock.teardown(resourceId);
      } catch (error) {
        logger.warn(
          "Schedule artifact teardown failed (non-fatal — the orphan cannot fire past revalidation and the reconciliation pass removes it)",
          {
            schedule_id: resourceId,
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }
    },
  };
}

/**
 * Removes the schedule's fire-ledger rows AFTER the row delete succeeded —
 * the teardown step's posture: best-effort, never fails the delete
 * (orphaned ledger rows answer no query and retention prunes them). Go
 * deleteScheduleRunsStep.
 */
export function newDeleteScheduleRunsStep<Desc extends DescMessage>(
  store: Store,
  logger: Logger,
): PipelineStep<Desc> {
  return {
    name: "DeleteScheduleRuns",
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      const resourceId = ctx.get(RESOURCE_ID_KEY);
      if (typeof resourceId !== "string" || resourceId === "") {
        return;
      }
      try {
        await store.deleteScheduleRunsBySchedule(resourceId);
      } catch (error) {
        logger.warn(
          "Fire-ledger cleanup failed (non-fatal — orphaned rows answer no query; retention prunes them)",
          {
            schedule_id: resourceId,
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }
    },
  };
}
