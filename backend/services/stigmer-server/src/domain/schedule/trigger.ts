/**
 * The trigger command's steps — ports
 * pkg/domain/schedule/controller/trigger.go (DD-017 D-5/D-6, amending
 * DD-014).
 *
 * The manual fire runs SYNCHRONOUSLY through the standard execution create
 * pipeline — every launch gate runs — and the result names what happened:
 * the created execution's id, or the refusing gate's copy verbatim.
 * Two-level contract: a gRPC error means the trigger itself was refused
 * (missing → NOT_FOUND, disabled → FAILED_PRECONDITION); a gRPC success
 * means the fire happened, whatever the run's outcome — a deterministically
 * refused run is a successful trigger honestly reported, never an
 * exception.
 *
 * Semantics settled by DD-017 D-5:
 *   - A PAUSED schedule may be triggered (test-then-resume): a test fire
 *     is exactly how an owner verifies a fix before resuming, and resume
 *     stays the one path that clears the latch.
 *   - Manual fires do NOT feed the failure streak: the sync path is
 *     untracked (the caller watches the execution), so it has no honest
 *     completion verdict to contribute — and a test fire of a broken
 *     schedule must not race its owner to the pause threshold.
 *   - The handler stamps last_fire_at and writes the fire-ledger row
 *     (origin=manual) because the tick is not in the path to do it; the
 *     run starter stamps last_execution_id on success as it does for cron
 *     fires.
 */
import { create } from "@bufbuild/protobuf";
import type { DescMessage } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";

import { ScheduleSchema } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import type { Schedule } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import {
  ScheduleRunOutcome,
  ScheduleTriggerResultSchema,
} from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/io_pb";
import { ScheduleStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/status_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { ConnectError } from "@connectrpc/connect";

import type { Logger } from "../../boot/logger.js";
import {
  failedPreconditionError,
  rethrownStatusError,
} from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import {
  setAuditFieldsForUpdate,
} from "../../pipeline/steps/defaults.js";
import { EXISTING_RESOURCE_KEY } from "../../pipeline/steps/load-existing.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";
import { recordManualFire } from "../../temporal/schedule/run-ledger.js";
import { rfc3339Seconds } from "../../temporal/schedule/run-ledger.js";
import type { RunOutcomeResult } from "../../temporal/schedule/run-starter.js";

// The trigger refusal copy, byte-identical to the cloud edition's
// ScheduleTriggerHandler (same error contracts in both editions; the
// conformance suite asserts these verbatim). A change on either side must
// change both.

/**
 * The owner's switch is off. OSS has no blueprint-access layer, so the
 * refusal here is pure contract parity: cloud MUST refuse (a
 * disabled-schedule run would die mid-execution after billing side
 * effects, DD-017 D-5), and the two editions must not diverge on a refusal
 * a user can observe. Consoles turn the dead end into a one-click
 * "Enable & run now".
 */
export const TRIGGER_DISABLED_MESSAGE =
  "schedule is disabled (spec.enabled=false) — enable it before triggering";

/**
 * No run starter is wired into this process (production wiring always
 * injects it — this is the defensive posture for embedded/test assemblies
 * that skip server wiring): refuse honestly, never pretend.
 */
export const TRIGGER_NO_RUNNER_MESSAGE =
  "this Stigmer server process has no schedule run starter wired — the schedule cannot fire";

/**
 * The narrow slice of the scheduling runtime the trigger needs (satisfied
 * by the clock's RunStarter): start one run through the full execution
 * create pipeline and answer with the real outcome. Deliberately NOT the
 * Clock — a manual fire needs no Temporal artifact (DD-017 D-5 amending
 * DD-014 D-A): the artifact round-trip made the fire asynchronous, so the
 * RPC answered "started" before the launch gates ran — exactly the false
 * toast the owner hit (Go Runner).
 */
export interface ScheduleRunner {
  startRun(schedule: Schedule, nominalFireTime: Date): Promise<RunOutcomeResult>;
}

/** A provider so the compose root can wire the runner after the clock stage. */
export type RunnerProvider = () => ScheduleRunner | undefined;

/** Carries the shaped ScheduleTriggerResult from the fire step to the handler. */
export const TRIGGER_RESULT_KEY = "trigger_result";

/**
 * Refuses a disabled schedule (the owner's switch) — the ONE remaining
 * trigger refusal (DD-017 D-5 narrowed DD-014 D-B's matrix: paused
 * schedules are now triggerable, and the tick's revalidation no longer
 * guards manual fires because manual fires no longer pass through the
 * tick). Go validateTriggerableStep.
 */
export function newValidateTriggerableStep<Desc extends DescMessage>(): PipelineStep<Desc> {
  return {
    name: "ValidateTriggerable",
    execute(ctx: RequestContext<Desc>): void {
      const schedule = ctx.get(EXISTING_RESOURCE_KEY) as Schedule;
      if (!(schedule.spec?.enabled ?? false)) {
        throw failedPreconditionError(TRIGGER_DISABLED_MESSAGE);
      }
    },
  };
}

export interface FireDirectRunDeps {
  readonly store: Store;
  readonly runner: RunnerProvider;
  readonly logger: Logger;
}

/**
 * Starts the run in-process and shapes the result: stamp last_fire_at, run
 * the full create pipeline via the Runner, write the fire-ledger row,
 * mirror the outcome into ScheduleTriggerResult. Infrastructure failures
 * from the create pipeline propagate as the handler's error — the
 * in-process client already speaks gRPC status (Go fireDirectRunStep).
 */
export function newFireDirectRunStep<Desc extends DescMessage>(
  deps: FireDirectRunDeps,
): PipelineStep<Desc> {
  return {
    name: "FireDirectRun",
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      const runner = deps.runner();
      if (runner === undefined) {
        throw failedPreconditionError(TRIGGER_NO_RUNNER_MESSAGE);
      }

      const schedule = ctx.get(EXISTING_RESOURCE_KEY) as Schedule;
      const scheduleId = schedule.metadata?.id ?? "";

      // The manual fire's nominal time is the trigger instant, whole
      // seconds — the same identity the deterministic execution name uses,
      // so a manual fire at the exact cron nominal second converges on the
      // same execution via the ALREADY_EXISTS → re-find path.
      const nominal = new Date(Math.floor(Date.now() / 1000) * 1000);
      const nominalRfc3339 = rfc3339Seconds(nominal);

      let outcome: RunOutcomeResult;
      try {
        outcome = await runner.startRun(schedule, nominal);
      } catch (error) {
        deps.logger.warn("Manual trigger's run start failed on infrastructure", {
          schedule_id: scheduleId,
          error: error instanceof Error ? error.message : String(error),
        });
        // The in-process client's error instance carries the INNER
        // response's metadata; echoing it corrupts the serving HTTP/2
        // trailers (NGHTTP2_PROTOCOL_ERROR — the #18 transport finding).
        // Re-mint code + message, exactly the workflowexecution
        // forwarding posture.
        throw error instanceof ConnectError ? rethrownStatusError(error) : error;
      }

      // The fire happened: record it — last_fire_at on status (the tick is
      // not in this path to do it) and the ledger row (origin=manual).
      await stampLastFireAt(deps, scheduleId, nominal);
      await recordManualFire(
        deps.store,
        deps.logger,
        scheduleId,
        schedule.metadata?.org ?? "",
        nominalRfc3339,
        outcome,
      );

      const result = create(ScheduleTriggerResultSchema);
      switch (outcome.kind) {
        case "started":
          result.outcome = ScheduleRunOutcome.STARTED;
          result.executionId = outcome.executionId;
          deps.logger.info("Schedule triggered manually — run started", {
            schedule_id: scheduleId,
            execution_id: outcome.executionId,
            already_existed: outcome.alreadyExisted,
          });
          break;
        case "targetMissing":
          result.outcome = ScheduleRunOutcome.TARGET_MISSING;
          result.refusalReason = outcome.reason;
          deps.logger.warn("Schedule triggered manually — target missing", {
            schedule_id: scheduleId,
            reason: outcome.reason,
          });
          break;
        case "refused":
          result.outcome = ScheduleRunOutcome.REFUSED;
          result.refusalReason = outcome.reason;
          deps.logger.warn(
            "Schedule triggered manually — run refused by a launch gate",
            { schedule_id: scheduleId, reason: outcome.reason },
          );
          break;
        default: {
          const exhaustive: never = outcome;
          throw new Error(`unknown run outcome ${String(exhaustive)}`);
        }
      }

      // Answer with the post-fire row — last_fire_at and (on success)
      // last_execution_id freshly stamped. A failed re-read degrades to the
      // loaded schedule rather than failing a fire that already happened.
      try {
        result.schedule = await deps.store.getResource(
          ApiResourceKind.schedule,
          scheduleId,
          ScheduleSchema,
        );
      } catch {
        result.schedule = schedule;
      }

      ctx.set(TRIGGER_RESULT_KEY, result);
    },
  };
}

/**
 * Records the manual fire on status — best-effort with a loud log: the run
 * already started, and a bookkeeping failure must not turn a real fire
 * into a caller-visible error. (The cron path's stamp rides the tick's
 * recordFire; this is its manual twin. Uses the FULL shared audit helper —
 * this is a request-path write, unlike the clock's minimal bump.) Go
 * stampLastFireAt.
 */
async function stampLastFireAt(
  deps: FireDirectRunDeps,
  scheduleId: string,
  nominal: Date,
): Promise<void> {
  try {
    await deps.store.updateResource(
      ApiResourceKind.schedule,
      scheduleId,
      ScheduleSchema,
      (live) => {
        if (live.status === undefined) {
          live.status = create(ScheduleStatusSchema);
        }
        live.status.lastFireAt = timestampFromDate(nominal);
        setAuditFieldsForUpdate(ScheduleSchema, live, "status_audit");
      },
    );
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      return;
    }
    deps.logger.warn(
      "Manual fire's last_fire_at not stamped (best-effort — the run is unaffected)",
      {
        schedule_id: scheduleId,
        error: error instanceof Error ? error.message : String(error),
      },
    );
  }
}
