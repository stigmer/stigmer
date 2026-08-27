/**
 * Schedule controller — ports pkg/domain/schedule/controller (command +
 * query sides): the recurring trigger that runs an agent on a cron
 * schedule.
 *
 * A schedule declares a target (an agent and the prompt each run starts
 * from), a cron expression with an IANA time zone, and the owner's
 * enablement switch. Everything the platform observes about firing (next
 * fire time, failure streak, platform pause) lives in status, written only
 * by the scheduling runtime and by the explicit resume command — a
 * declarative apply preserves status verbatim, so a routine manifest apply
 * can never reset a failure streak or un-pause a platform-paused schedule.
 *
 * Vocabulary (DD-013 D-E): "disabled" is the owner's switch (spec.enabled
 * = false); "paused" is the platform's failure-streak latch
 * (status.paused_reason). Two words, two levers, two writers.
 *
 * The clock (per-resource Temporal Schedules) and the run starter arrive
 * through PROVIDERS wired by the compose root after the Temporal stage;
 * both may stay undefined forever when Temporal was never configured —
 * every consumer degrades instead of refusing (DD-015 D-A), because a
 * declarative resource must be writable offline.
 *
 * Authorization posture (OSS): single-user and local, so handlers perform
 * no authorization — a documented no-op, not a silent divergence. The
 * cloud edition enforces the same contracts via FGA.
 *
 * Pipeline per RPC mirrors the Go step chains character-for-character.
 * Proven by schedule.conformance.test.ts (local), the firing suite
 * (local-execution), and __tests__/schedule.composed.test.ts.
 */
import type { ConnectRouter, HandlerContext } from "@connectrpc/connect";
import { create, fromBinary } from "@bufbuild/protobuf";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { ScheduleCommandController } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/command_pb";
import { ScheduleQueryController } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/query_pb";
import { ScheduleSchema } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import type { Schedule } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import { ScheduleListSchema } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/io_pb";
import type {
  GetSchedulesByAgentRequest,
  ListScheduleRunsRequest,
  ListSchedulesRequest,
  ScheduleId,
  ScheduleList,
  ScheduleRunList,
  ScheduleTriggerResult,
} from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/io_pb";
import type { ApiResourceReference } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../../boot/logger.js";
import type { Authorizer } from "../../extensions/authorizer.js";
import { apiResourceKindKey } from "../../pipeline/interceptors/apiresource.js";
import { internalError } from "../../pipeline/errors.js";
import { newPipeline } from "../../pipeline/pipeline.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import { callerIdentityOf } from "../../pipeline/interceptors/auth.js";
import { RequestContext } from "../../pipeline/request-context.js";
import { newAuthorizeStep } from "../../pipeline/steps/authorize.js";
import { newBuildNewStateStep } from "../../pipeline/steps/defaults.js";
import { newBuildUpdateStateStep } from "../../pipeline/steps/build-update-state.js";
import { newCheckDuplicateStep } from "../../pipeline/steps/duplicate.js";
import {
  newDeleteResourceStep,
  newExtractResourceIdStep,
  newLoadExistingForDeleteStep,
} from "../../pipeline/steps/delete.js";
import {
  compareCreatedAtDesc,
  matchesAllLabels,
} from "../../pipeline/steps/helpers.js";
import {
  EXISTING_RESOURCE_KEY,
  newLoadExistingStep,
} from "../../pipeline/steps/load-existing.js";
import {
  SHOULD_CREATE_KEY,
  newLoadForApplyStep,
} from "../../pipeline/steps/load-for-apply.js";
import { newLoadByReferenceStep } from "../../pipeline/steps/load-by-reference.js";
import {
  newLoadTargetStep,
  TARGET_RESOURCE_KEY,
} from "../../pipeline/steps/load-target.js";
import { newPersistStep } from "../../pipeline/steps/persist.js";
import { newNormalizeReferencesStep } from "../../pipeline/steps/references.js";
import { newResolveSlugStep } from "../../pipeline/steps/slug.js";
import { newValidateProtoStep } from "../../pipeline/steps/validation.js";
import { newValidateVisibilityStep } from "../../pipeline/steps/validate-visibility.js";
import type { Store } from "../../store/interface.js";
import type { ModelRegistryStore } from "../workflow/registry/model-registry-store.js";
import {
  newArmResumedScheduleStep,
  newArmScheduleStep,
  newDeleteScheduleRunsStep,
  newTeardownScheduleArtifactStep,
  type ClockProvider,
} from "./clock.js";
import {
  LIST_RUNS_RESULT_KEY,
  newListRunsFromLedgerStep,
  newLoadScheduleForRunsStep,
} from "./list-runs.js";
import { newPersistScheduleUpdateStep } from "./persist-update.js";
import { newClearSchedulePauseStep } from "./resume.js";
import {
  newResolveScheduleDefaultsStep,
  newValidateScheduleUpdateStep,
} from "./steps.js";
import {
  TRIGGER_RESULT_KEY,
  newFireDirectRunStep,
  newValidateTriggerableStep,
  type RunnerProvider,
} from "./trigger.js";

export interface ScheduleControllerDeps {
  readonly store: Store;
  readonly logger: Logger;
  /** The composed authorization seam — the Authorize step at position 1 of every chain calls it (O2, DD-007 §3). */
  readonly authorizer: Authorizer;
  readonly modelRegistry: ModelRegistryStore;
  /**
   * The scheduling runtime (clock.ts), resolved at call time so the
   * compose root can wire it after the Temporal stage — Go's SetClock,
   * without the mutable-controller seam.
   */
  readonly clock: ClockProvider;
  /**
   * The run starter (trigger.ts), resolved at call time — Go's SetRunner.
   * The trigger command is its one consumer: a manual fire needs no
   * Temporal artifact (DD-017 D-5), so it works even while Temporal is
   * away.
   */
  readonly runner: RunnerProvider;
}

/** Registers both schedule services on the router (routes stage). */
export function registerScheduleServices(
  router: ConnectRouter,
  deps: ScheduleControllerDeps,
): void {
  router.service(ScheduleCommandController, {
    apply: (schedule, ctx) => apply(deps, schedule, ctx),
    create: (schedule, ctx) => createSchedule(deps, schedule, ctx),
    update: (schedule, ctx) => update(deps, schedule, ctx),
    delete: (scheduleId, ctx) => deleteSchedule(deps, scheduleId, ctx),
    resume: (scheduleId, ctx) => resume(deps, scheduleId, ctx),
    trigger: (scheduleId, ctx) => trigger(deps, scheduleId, ctx),
  });
  router.service(ScheduleQueryController, {
    get: (scheduleId, ctx) => get(deps, scheduleId, ctx),
    getByReference: (ref, ctx) => getByReference(deps, ref, ctx),
    getByAgent: (req, ctx) => getByAgent(deps, req, ctx),
    list: (req, ctx) => list(deps, req, ctx),
    listRuns: (req, ctx) => listRuns(deps, req, ctx),
  });
}

function kindOf(ctx: HandlerContext): ApiResourceKind {
  return ctx.values.get(apiResourceKindKey);
}

/**
 * Create — chain per Go buildCreatePipeline (create.go:51-60). No
 * IndexSearch tail: the schedule kind is deliberately not search-indexed
 * (no Go extractor exists; the kind registry carries no index flag).
 */
async function createSchedule(
  deps: ScheduleControllerDeps,
  schedule: Schedule,
  ctx: HandlerContext,
): Promise<Schedule> {
  const reqCtx = new RequestContext(
    ScheduleSchema,
    schedule,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof ScheduleSchema>("schedule-create", deps.logger)
    .addStep(
      newAuthorizeStep(
        ScheduleCommandController.method.create,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    .addStep(newValidateVisibilityStep())
    .addStep(newResolveScheduleDefaultsStep(deps))
    .addStep(newResolveSlugStep())
    .addStep(newCheckDuplicateStep(deps.store))
    .addStep(newBuildNewStateStep())
    .addStep(newNormalizeReferencesStep())
    .addStep(newPersistStep(deps.store))
    .addStep(newArmScheduleStep(deps.clock, deps.logger))
    .build()
    .execute(reqCtx);
  return reqCtx.newState;
}

/** Update — chain per Go buildUpdatePipeline (update.go:59-67). */
async function update(
  deps: ScheduleControllerDeps,
  schedule: Schedule,
  ctx: HandlerContext,
): Promise<Schedule> {
  const reqCtx = new RequestContext(
    ScheduleSchema,
    schedule,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof ScheduleSchema>("schedule-update", deps.logger)
    .addStep(
      newAuthorizeStep(
        ScheduleCommandController.method.update,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    .addStep(newResolveSlugStep())
    .addStep(newLoadExistingStep(deps.store))
    .addStep(newValidateScheduleUpdateStep(deps))
    .addStep(newBuildUpdateStateStep())
    .addStep(newNormalizeReferencesStep())
    .addStep(newPersistScheduleUpdateStep(deps.store))
    .addStep(newArmScheduleStep(deps.clock, deps.logger))
    .build()
    .execute(reqCtx);
  return reqCtx.newState;
}

/**
 * Apply — declarative create-or-update (apply.go): schedule defaults
 * resolve FIRST — matching the cloud edition, which runs its defaults
 * resolver before routing so the existence check sees the normalized
 * agent_ref and the same-org invariant fails loudly before any routing —
 * then existence decides create vs update. Delegates with the pipeline's
 * state, not the original input: the request context clones the input, so
 * the normalized agent_ref and the populated id (from LoadForApply) live
 * on the clone. Status is preserved verbatim across apply-as-update
 * (BuildUpdateState), so a routine manifest apply can never reset the
 * failure streak or un-pause an auto-paused schedule.
 */
async function apply(
  deps: ScheduleControllerDeps,
  schedule: Schedule,
  ctx: HandlerContext,
): Promise<Schedule> {
  const reqCtx = new RequestContext(
    ScheduleSchema,
    schedule,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof ScheduleSchema>("schedule-apply", deps.logger)
    .addStep(
      newAuthorizeStep(ScheduleCommandController.method.apply, deps.authorizer),
    )
    .addStep(newValidateProtoStep())
    .addStep(newResolveScheduleDefaultsStep(deps))
    .addStep(newResolveSlugStep())
    .addStep(newLoadForApplyStep(deps.store))
    .build()
    .execute(reqCtx);

  const shouldCreate = reqCtx.get(SHOULD_CREATE_KEY);
  if (typeof shouldCreate !== "boolean") {
    throw internalError(
      new Error("apply pipeline did not set shouldCreate flag"),
      "apply operation failed to determine create vs update",
    );
  }
  const resolved = reqCtx.newState;
  if (shouldCreate) {
    deps.logger.info("Schedule does not exist - delegating to CREATE", {
      slug: resolved.metadata?.slug ?? "",
    });
    return createSchedule(deps, resolved, ctx);
  }
  deps.logger.info("Schedule exists - delegating to UPDATE", {
    slug: resolved.metadata?.slug ?? "",
    id: resolved.metadata?.id ?? "",
  });
  return update(deps, resolved, ctx);
}

/** Delete — chain per Go buildDeletePipeline (delete.go:57-63). */
async function deleteSchedule(
  deps: ScheduleControllerDeps,
  scheduleId: ScheduleId,
  ctx: HandlerContext,
): Promise<Schedule> {
  type DeleteInput = typeof ScheduleCommandController.method.delete.input;
  const reqCtx = new RequestContext(
    ScheduleCommandController.method.delete.input,
    scheduleId,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<DeleteInput>("schedule-delete", deps.logger)
    .addStep(
      newAuthorizeStep(
        ScheduleCommandController.method.delete,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    .addStep(newExtractResourceIdStep())
    .addStep(newLoadExistingForDeleteStep(deps.store, ScheduleSchema))
    .addStep(newDeleteResourceStep(deps.store))
    .addStep(newTeardownScheduleArtifactStep(deps.clock, deps.logger))
    .addStep(newDeleteScheduleRunsStep(deps.store, deps.logger))
    .build()
    .execute(reqCtx);

  const deleted = reqCtx.get(EXISTING_RESOURCE_KEY);
  if (deleted === undefined) {
    throw internalError(
      new Error("deleted schedule not found in context"),
      "deleted schedule not found in context",
    );
  }
  return deleted as Schedule;
}

/** Resume — chain per Go buildResumePipeline (resume.go:60-68). */
async function resume(
  deps: ScheduleControllerDeps,
  scheduleId: ScheduleId,
  ctx: HandlerContext,
): Promise<Schedule> {
  type ResumeInput = typeof ScheduleCommandController.method.resume.input;
  const reqCtx = new RequestContext(
    ScheduleCommandController.method.resume.input,
    scheduleId,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<ResumeInput>("schedule-resume", deps.logger)
    .addStep(
      newAuthorizeStep(
        ScheduleCommandController.method.resume,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    .addStep(newExtractResourceIdStep())
    .addStep(newLoadExistingForDeleteStep(deps.store, ScheduleSchema))
    .addStep(newClearSchedulePauseStep(deps.store))
    .addStep(newArmResumedScheduleStep(deps.clock, deps.logger))
    .build()
    .execute(reqCtx);

  const resumed = reqCtx.get(EXISTING_RESOURCE_KEY);
  if (resumed === undefined) {
    throw internalError(
      new Error("resumed schedule not found in context"),
      "resumed schedule not found in context",
    );
  }
  return resumed as Schedule;
}

/** Trigger — chain per Go Trigger (trigger.go:96-115). */
async function trigger(
  deps: ScheduleControllerDeps,
  scheduleId: ScheduleId,
  ctx: HandlerContext,
): Promise<ScheduleTriggerResult> {
  type TriggerInput = typeof ScheduleCommandController.method.trigger.input;
  const reqCtx = new RequestContext(
    ScheduleCommandController.method.trigger.input,
    scheduleId,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<TriggerInput>("schedule-trigger", deps.logger)
    .addStep(
      newAuthorizeStep(
        ScheduleCommandController.method.trigger,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    .addStep(newExtractResourceIdStep())
    .addStep(newLoadExistingForDeleteStep(deps.store, ScheduleSchema))
    .addStep(newValidateTriggerableStep())
    .addStep(
      newFireDirectRunStep({
        store: deps.store,
        runner: deps.runner,
        logger: deps.logger,
      }),
    )
    .build()
    .execute(reqCtx);

  const result = reqCtx.get(TRIGGER_RESULT_KEY);
  if (result === undefined) {
    throw internalError(
      new Error("trigger result not found in context"),
      "trigger result not found in context",
    );
  }
  return result as ScheduleTriggerResult;
}

/** Get — LoadTarget by id; NotFound when absent (get.go). */
async function get(
  deps: ScheduleControllerDeps,
  scheduleId: ScheduleId,
  ctx: HandlerContext,
): Promise<Schedule> {
  type GetInput = typeof ScheduleQueryController.method.get.input;
  const reqCtx = new RequestContext(
    ScheduleQueryController.method.get.input,
    scheduleId,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<GetInput>("schedule-get", deps.logger)
    .addStep(
      newAuthorizeStep(ScheduleQueryController.method.get, deps.authorizer),
    )
    .addStep(newValidateProtoStep())
    .addStep(newLoadTargetStep(deps.store, ScheduleSchema))
    .build()
    .execute(reqCtx);
  return reqCtx.get(TARGET_RESOURCE_KEY) as Schedule;
}

/** GetByReference — the shared org+slug reference lookup (get_by_reference.go). */
async function getByReference(
  deps: ScheduleControllerDeps,
  ref: ApiResourceReference,
  ctx: HandlerContext,
): Promise<Schedule> {
  type RefInput = typeof ScheduleQueryController.method.getByReference.input;
  const reqCtx = new RequestContext(
    ScheduleQueryController.method.getByReference.input,
    ref,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<RefInput>("schedule-get-by-reference", deps.logger)
    .addStep(
      newAuthorizeStep(
        ScheduleQueryController.method.getByReference,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    .addStep(newLoadByReferenceStep(deps.store, ScheduleSchema))
    .build()
    .execute(reqCtx);
  return reqCtx.get(TARGET_RESOURCE_KEY) as Schedule;
}

const SCHEDULE_LIST_KEY = "scheduleList";

/**
 * GetByAgent — resolves the agent BY ID to its org+slug identity, then
 * filters schedules whose agent target matches (get_by_agent.go).
 * Schedules reference agents by org+slug (the platform's canonical
 * reference), while this RPC is keyed on the agent ID (the stable handle a
 * detail view holds) — so the agent resolves first. A nonexistent agent
 * yields an EMPTY LIST, not an error: "no schedules" is the useful answer
 * for the operational surface either way. The org filter is contract
 * parity, not authorization: both editions must answer an org-scoped
 * request identically.
 */
async function getByAgent(
  deps: ScheduleControllerDeps,
  req: GetSchedulesByAgentRequest,
  ctx: HandlerContext,
): Promise<ScheduleList> {
  type ByAgentInput = typeof ScheduleQueryController.method.getByAgent.input;
  const reqCtx = new RequestContext(
    ScheduleQueryController.method.getByAgent.input,
    req,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<ByAgentInput>("schedule-get-by-agent", deps.logger)
    .addStep(
      newAuthorizeStep(
        ScheduleQueryController.method.getByAgent,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    .addStep(newLoadSchedulesByAgentStep(deps.store))
    .build()
    .execute(reqCtx);

  const result = reqCtx.get(SCHEDULE_LIST_KEY);
  if (result === undefined) {
    throw internalError(
      new Error("schedule list not found in context"),
      "schedule list not found in context",
    );
  }
  return result as ScheduleList;
}

function newLoadSchedulesByAgentStep(
  store: Store,
): PipelineStep<typeof ScheduleQueryController.method.getByAgent.input> {
  return {
    name: "LoadSchedulesByAgent",
    async execute(
      ctx: RequestContext<
        typeof ScheduleQueryController.method.getByAgent.input
      >,
    ): Promise<void> {
      const req = ctx.input;

      let agentOrg: string;
      let agentSlug: string;
      try {
        const agent = await store.getResource(
          ApiResourceKind.agent,
          req.agentId,
          AgentSchema,
        );
        agentOrg = agent.metadata?.org ?? "";
        agentSlug = agent.metadata?.slug ?? "";
      } catch {
        ctx.set(
          SCHEDULE_LIST_KEY,
          create(ScheduleListSchema, { totalCount: 0, items: [] }),
        );
        return;
      }

      let resources: Uint8Array[];
      try {
        resources = await store.listResources(ApiResourceKind.schedule);
      } catch (error) {
        throw internalError(error, "failed to list schedules");
      }

      const schedules: Schedule[] = [];
      for (const data of resources) {
        let schedule: Schedule;
        try {
          schedule = fromBinary(ScheduleSchema, data);
        } catch {
          continue;
        }
        const ref =
          schedule.spec?.target.case === "agent"
            ? schedule.spec.target.value.agentRef
            : undefined;
        if ((ref?.org ?? "") !== agentOrg || (ref?.slug ?? "") !== agentSlug) {
          continue;
        }
        // Org scope: a multi-org caller asking for one org's schedules
        // must not see another org's schedules of the same agent.
        // (Schedules are same-org by invariant, so today this only
        // excludes rows when the requested org differs from the agent's —
        // kept anyway for contract parity with the sibling RPCs.)
        if (req.org !== "" && (schedule.metadata?.org ?? "") !== req.org) {
          continue;
        }
        schedules.push(schedule);
      }

      ctx.set(
        SCHEDULE_LIST_KEY,
        create(ScheduleListSchema, {
          totalCount: schedules.length,
          items: schedules,
        }),
      );
    },
  };
}

/**
 * List — schedules filtered by organization and optional labels (AND
 * semantics), sorted by created_at descending, newest first (list.go).
 */
async function list(
  deps: ScheduleControllerDeps,
  req: ListSchedulesRequest,
  ctx: HandlerContext,
): Promise<ScheduleList> {
  type ListInput = typeof ScheduleQueryController.method.list.input;
  const reqCtx = new RequestContext(
    ScheduleQueryController.method.list.input,
    req,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<ListInput>("schedule-list", deps.logger)
    .addStep(
      newAuthorizeStep(ScheduleQueryController.method.list, deps.authorizer),
    )
    .addStep(newValidateProtoStep())
    .addStep(newListByOrgAndLabelsStep(deps.store))
    .build()
    .execute(reqCtx);

  const result = reqCtx.get(SCHEDULE_LIST_KEY);
  if (result === undefined) {
    throw internalError(
      new Error("schedule list not found in context"),
      "schedule list not found in context",
    );
  }
  return result as ScheduleList;
}

function newListByOrgAndLabelsStep(
  store: Store,
): PipelineStep<typeof ScheduleQueryController.method.list.input> {
  return {
    name: "ListByOrgAndLabels",
    async execute(
      ctx: RequestContext<typeof ScheduleQueryController.method.list.input>,
    ): Promise<void> {
      const req = ctx.input;

      let resources: Uint8Array[];
      try {
        resources = await store.listResources(ApiResourceKind.schedule);
      } catch (error) {
        throw internalError(error, "failed to list schedules");
      }

      const schedules: Schedule[] = [];
      for (const data of resources) {
        let schedule: Schedule;
        try {
          schedule = fromBinary(ScheduleSchema, data);
        } catch {
          continue;
        }
        if ((schedule.metadata?.org ?? "") !== req.org) {
          continue;
        }
        if (!matchesAllLabels(schedule.metadata?.labels ?? {}, req.labels)) {
          continue;
        }
        schedules.push(schedule);
      }

      schedules.sort((a, b) =>
        compareCreatedAtDesc(
          a.status?.audit?.specAudit?.createdAt,
          b.status?.audit?.specAudit?.createdAt,
        ),
      );

      ctx.set(
        SCHEDULE_LIST_KEY,
        create(ScheduleListSchema, {
          totalCount: schedules.length,
          items: schedules,
        }),
      );
    },
  };
}

/** ListRuns — the fire-ledger surface (list_runs.go:44-61). */
async function listRuns(
  deps: ScheduleControllerDeps,
  req: ListScheduleRunsRequest,
  ctx: HandlerContext,
): Promise<ScheduleRunList> {
  type ListRunsInput = typeof ScheduleQueryController.method.listRuns.input;
  const reqCtx = new RequestContext(
    ScheduleQueryController.method.listRuns.input,
    req,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<ListRunsInput>("schedule-list-runs", deps.logger)
    .addStep(
      newAuthorizeStep(
        ScheduleQueryController.method.listRuns,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    .addStep(newLoadScheduleForRunsStep(deps.store))
    .addStep(newListRunsFromLedgerStep(deps.store))
    .build()
    .execute(reqCtx);

  const result = reqCtx.get(LIST_RUNS_RESULT_KEY);
  if (result === undefined) {
    throw internalError(
      new Error("schedule run list not found in context"),
      "schedule run list not found in context",
    );
  }
  return result as ScheduleRunList;
}
