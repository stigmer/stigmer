/**
 * The resume command's clearing step — ports
 * pkg/domain/schedule/controller/resume.go.
 *
 * "Paused" is the platform's latch (status.paused_reason, written by the
 * failure-streak auto-pause), distinct from "disabled", the owner's switch
 * (spec.enabled) — DD-013 D-E. Resume clears the latch and resets
 * status.consecutive_failures, and is deliberately the ONLY path that does
 * either (DD-013 D-D): update and apply preserve status verbatim, so a
 * routine manifest apply can never silently un-pause a failing schedule.
 *
 * Resuming a schedule that is not paused (and has no failure streak)
 * succeeds and changes nothing — no write, no audit bump. A disabled
 * schedule stays disabled: the latch and the switch are independent.
 */
import type { DescMessage } from "@bufbuild/protobuf";

import { ScheduleSchema } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import type { Schedule } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { internalError, notFoundError } from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import { setAuditFieldsForUpdate } from "../../pipeline/steps/defaults.js";
import { EXISTING_RESOURCE_KEY } from "../../pipeline/steps/load-existing.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";

/**
 * Aborts the atomic write on the idempotent no-op path — the fresh row has
 * no latch and no streak, so nothing is written and no audit bumps (Go
 * errResumeNothingToClear).
 */
class NothingToClearError extends Error {
  constructor() {
    super("nothing to clear");
    this.name = "NothingToClearError";
  }
}

/**
 * Clears status.paused_reason and resets status.consecutive_failures in
 * ONE store.updateResource closure on the freshly-read row, preserving
 * every other status leaf as the concurrent runtime last wrote it (Go
 * clearSchedulePauseStep).
 *
 * This is the revisit DD-013 D-D reserved for the clock slice: a previous
 * load-mutate-save across step boundaries was safe only while nothing else
 * wrote schedule status. The clock ended that — a fire recorded (or a
 * streak advanced) between the load and the save would have been silently
 * reverted. The agent-execution domain adopted this exact primitive after
 * losing user approvals to the same race class.
 */
export function newClearSchedulePauseStep<Desc extends DescMessage>(
  store: Store,
): PipelineStep<Desc> {
  return {
    name: "ClearSchedulePause",
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      const loaded = ctx.get(EXISTING_RESOURCE_KEY) as Schedule;
      const scheduleId = loaded.metadata?.id ?? "";

      let live: Schedule;
      try {
        live = await store.updateResource(
          ApiResourceKind.schedule,
          scheduleId,
          ScheduleSchema,
          (row) => {
            const status = row.status;
            if (
              (status?.pausedReason ?? "") === "" &&
              (status?.consecutiveFailures ?? 0) === 0
            ) {
              throw new NothingToClearError();
            }
            // status is defined here: a latch or streak exists only on a
            // materialized status message.
            row.status!.pausedReason = "";
            // Resuming with strikes left would re-pause on the next
            // failure — a lie; both clear together, always.
            row.status!.consecutiveFailures = 0;
            setAuditFieldsForUpdate(ScheduleSchema, row, "status_audit");
          },
        );
      } catch (error) {
        if (error instanceof NothingToClearError) {
          // The untouched fresh row is the honest response on the no-op
          // path; updateResource skipped the write, so re-read the live
          // row (Go's out-param `live` holds it either way).
          try {
            live = await store.getResource(
              ApiResourceKind.schedule,
              scheduleId,
              ScheduleSchema,
            );
          } catch (readError) {
            if (readError instanceof ResourceNotFoundError) {
              throw notFoundError("Schedule", scheduleId);
            }
            throw internalError(readError, "failed to resume schedule");
          }
          ctx.set(EXISTING_RESOURCE_KEY, live);
          return;
        }
        if (error instanceof ResourceNotFoundError) {
          // Deleted between load and clear: the delete won.
          throw notFoundError("Schedule", scheduleId);
        }
        throw internalError(error, "failed to resume schedule");
      }
      // live holds the post-image (cleared) — the honest response.
      ctx.set(EXISTING_RESOURCE_KEY, live);
    },
  };
}
