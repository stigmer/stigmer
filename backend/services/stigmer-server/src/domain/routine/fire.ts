/**
 * The fire command's steps: a routine run once, now, by its owner or a
 * Participant, optionally with a short note.
 *
 * The fire runs SYNCHRONOUSLY through the standard run create pipeline —
 * every launch gate runs — and the result names what happened: the created
 * run's id, or the refusing gate's copy verbatim. Two-level contract: a
 * gRPC error means the fire itself was refused (missing → NOT_FOUND,
 * disabled → FAILED_PRECONDITION); a gRPC success means the fire happened,
 * whatever the run's outcome — a deterministically refused run is a
 * successful fire honestly reported, never an exception.
 *
 * Semantics:
 *   - Each call is its own fire, even two in one second: its id is the
 *     second's name plus random characters (run-starter.ts `manualFire`),
 *     and the run starter never looks for an earlier one. A caller that
 *     retries starts a second run, recorded with its own `fired_by`.
 *   - The run acts as the routine's owner, whoever fired it; the text is
 *     handed to the run fenced as information, not instructions
 *     (run-starter.ts `composeMessage`).
 *   - A PAUSED routine may be fired (test-then-resume): a test fire is
 *     exactly how an owner verifies a fix before resuming, and resume stays
 *     the one path that clears the latch.
 *   - A fire does NOT feed the failure streak: the sync path is untracked
 *     (the caller watches the run), so it has no honest completion verdict
 *     to contribute — and a test fire of a broken routine must not race its
 *     owner to the pause threshold.
 *   - The handler stamps last_fire_at and writes the fire-ledger row
 *     (origin=manual, fired_by=the caller) because the tick is not in the
 *     path to do it; the run starter stamps last_run_id on success as it
 *     does for a schedule's fires.
 */
import { create } from "@bufbuild/protobuf";
import type { DescMessage } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";

import { RoutineSchema } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/api_pb";
import type { Routine } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/api_pb";
import { RoutineCommandController } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/command_pb";
import {
  RoutineFireOutcome,
  RoutineFireResultSchema,
} from "@stigmer/apis/ai/stigmer/agentic/routine/v1/io_pb";
import { RoutineStatusSchema } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/status_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { ConnectError } from "@connectrpc/connect";

import type { Logger } from "../../boot/logger.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import {
  failedPreconditionError,
  invalidArgumentError,
  rethrownStatusError,
} from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import { auditActorFor, setAuditFieldsForUpdate } from "../../pipeline/steps/defaults.js";
import { RESOURCE_ID_KEY } from "../../pipeline/steps/delete.js";
import { EXISTING_RESOURCE_KEY } from "../../pipeline/steps/load-existing.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";
import { recordManualFire, rfc3339Seconds } from "../../temporal/routine/run-ledger.js";
import { manualFire } from "../../temporal/routine/run-starter.js";
import type { RoutineFireRequest, RunOutcomeResult } from "../../temporal/routine/run-starter.js";

type FireInput = typeof RoutineCommandController.method.fire.input;

/**
 * The owner's switch is off. Contract parity across editions: a hosted
 * edition MUST refuse (a disabled routine's run would die mid-run after its
 * side effects), and the editions must not diverge on a refusal a user can
 * observe. Consoles turn the dead end into a one-click "Enable & run now".
 */
export const FIRE_DISABLED_MESSAGE =
  "routine is disabled (spec.enabled=false) — enable it before firing";

/**
 * No run starter is wired into this process (production wiring always
 * injects it — this is the defensive posture for embedded/test assemblies
 * that skip server wiring): refuse honestly, never pretend.
 */
export const FIRE_NO_RUNNER_MESSAGE =
  "this Stigmer server process has no routine run starter wired — the routine cannot fire";

/**
 * The narrow slice of the scheduling runtime a fire needs (satisfied by
 * the RunStarter): start one run through the full run create pipeline and
 * answer with the real outcome. Deliberately NOT the clock — a fire needs
 * no Temporal artifact, so a routine fires even while the engine is away.
 */
export interface RoutineRunner {
  startRun(routine: Routine, fire: RoutineFireRequest): Promise<RunOutcomeResult>;
}

/** A provider so the compose root can wire the runner after the clock stage. */
export type RunnerProvider = () => RoutineRunner | undefined;

/** Carries the shaped RoutineFireResult from the fire step to the handler. */
export const FIRE_RESULT_KEY = "fire_result";

/**
 * The routine a fire names: its input's `id`, for the shared load step
 * (LoadExistingForDelete reads RESOURCE_ID_KEY).
 */
export function newExtractFireRoutineIdStep(): PipelineStep<FireInput> {
  return {
    name: "ExtractFireRoutineId",
    execute(ctx: RequestContext<FireInput>): void {
      if (ctx.input.id === "") {
        throw invalidArgumentError("resource id is required");
      }
      ctx.set(RESOURCE_ID_KEY, ctx.input.id);
    },
  };
}

/**
 * Refuses a disabled routine (the owner's switch) — the ONE fire refusal
 * (paused routines fire, and the tick's revalidation does not guard fires,
 * which never pass through the tick).
 */
export function newValidateFireableStep<
  Desc extends DescMessage,
>(): PipelineStep<Desc> {
  return {
    name: "ValidateFireable",
    execute(ctx: RequestContext<Desc>): void {
      const routine = ctx.get(EXISTING_RESOURCE_KEY) as Routine;
      if (!(routine.spec?.enabled ?? false)) {
        throw failedPreconditionError(FIRE_DISABLED_MESSAGE);
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
 * Starts the run in-process and shapes the result: run the full create
 * pipeline via the runner, stamp last_fire_at, write the fire-ledger row,
 * mirror the outcome into RoutineFireResult. Infrastructure failures from
 * the create pipeline propagate as the handler's error — the in-process
 * client already speaks gRPC status.
 */
export function newFireDirectRunStep(
  deps: FireDirectRunDeps,
): PipelineStep<FireInput> {
  return {
    name: "FireDirectRun",
    async execute(ctx: RequestContext<FireInput>): Promise<void> {
      const runner = deps.runner();
      if (runner === undefined) {
        throw failedPreconditionError(FIRE_NO_RUNNER_MESSAGE);
      }

      const routine = ctx.get(EXISTING_RESOURCE_KEY) as Routine;
      const routineId = routine.metadata?.id ?? "";

      // The fire's instant, whole seconds; its id adds random characters,
      // so it is this call's fire alone.
      const nominal = new Date(Math.floor(Date.now() / 1000) * 1000);
      const fire = manualFire(routineId, nominal, ctx.input.text);

      let outcome: RunOutcomeResult;
      try {
        outcome = await runner.startRun(routine, fire);
      } catch (error) {
        deps.logger.warn("Fire's run start failed on infrastructure", {
          routine_id: routineId,
          fire_id: fire.fireId,
          error: error instanceof Error ? error.message : String(error),
        });
        // The in-process client's error instance carries the INNER
        // response's metadata; echoing it corrupts the serving HTTP/2
        // trailers (NGHTTP2_PROTOCOL_ERROR).
        // Re-mint code + message (rethrownStatusError).
        throw error instanceof ConnectError
          ? rethrownStatusError(error)
          : error;
      }

      // The fire happened: record it — last_fire_at on status (the tick is
      // not in this path to do it) and the ledger row, naming the caller.
      await stampLastFireAt(deps, routineId, nominal, ctx.callerIdentity);
      await recordManualFire(
        deps.store,
        deps.logger,
        {
          routineId,
          fireId: fire.fireId,
          org: routine.metadata?.org ?? "",
          nominalFireTime: rfc3339Seconds(nominal),
          firedBy: auditActorFor(ctx.callerIdentity),
        },
        outcome,
      );

      const result = create(RoutineFireResultSchema, { fireId: fire.fireId });
      switch (outcome.kind) {
        case "started":
          result.outcome = RoutineFireOutcome.STARTED;
          result.runId = outcome.runId;
          deps.logger.info("Routine fired — run started", {
            routine_id: routineId,
            run_id: outcome.runId,
          });
          break;
        case "targetMissing":
          result.outcome = RoutineFireOutcome.TARGET_MISSING;
          result.refusalReason = outcome.reason;
          deps.logger.warn("Routine fired — target missing", {
            routine_id: routineId,
            reason: outcome.reason,
          });
          break;
        case "refused":
          result.outcome = RoutineFireOutcome.REFUSED;
          result.refusalReason = outcome.reason;
          deps.logger.warn("Routine fired — run refused by a launch gate", {
            routine_id: routineId,
            reason: outcome.reason,
          });
          break;
        default: {
          const exhaustive: never = outcome;
          throw new Error(`unknown run outcome ${String(exhaustive)}`);
        }
      }

      // Answer with the post-fire row — last_fire_at and (on success)
      // last_run_id freshly stamped. A failed re-read degrades to the
      // loaded routine rather than failing a fire that already happened.
      try {
        result.routine = await deps.store.getResource(
          ApiResourceKind.routine,
          routineId,
          RoutineSchema,
        );
      } catch {
        result.routine = routine;
      }

      ctx.set(FIRE_RESULT_KEY, result);
    },
  };
}

/**
 * Records the fire on status — best-effort with a loud log: the run
 * already started, and a bookkeeping failure must not turn a real fire
 * into a caller-visible error. (A schedule fire's stamp rides the tick's
 * recordFire; this is its manual twin, with the full shared audit helper,
 * since this is a request-path write.)
 */
async function stampLastFireAt(
  deps: FireDirectRunDeps,
  routineId: string,
  nominal: Date,
  identity: CallerIdentity,
): Promise<void> {
  try {
    await deps.store.updateResource(
      ApiResourceKind.routine,
      routineId,
      RoutineSchema,
      (live) => {
        if (live.status === undefined) {
          live.status = create(RoutineStatusSchema);
        }
        live.status.lastFireAt = timestampFromDate(nominal);
        setAuditFieldsForUpdate(RoutineSchema, live, "status_audit", identity);
      },
    );
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      return;
    }
    deps.logger.warn(
      "Fire's last_fire_at not stamped (best-effort — the run is unaffected)",
      {
        routine_id: routineId,
        error: error instanceof Error ? error.message : String(error),
      },
    );
  }
}
