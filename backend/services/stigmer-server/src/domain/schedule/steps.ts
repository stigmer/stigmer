/**
 * Schedule write-path steps — ports the validation half of
 * pkg/domain/schedule/controller/steps.go: the defaults resolver
 * (create/apply) and the update validator, plus the workspace and
 * model-pinning rules both share.
 *
 * Proven by schedule.conformance.test.ts (CONFORMANCE_TARGET=local-ts) and
 * __tests__/schedule.composed.test.ts.
 */
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { ScheduleSchema } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import type { Schedule } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import type { ScheduleSpec } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/spec_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import {
  failedPreconditionError,
  internalError,
  invalidArgumentError,
  notFoundError,
} from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import { findResourceBySlug } from "../../pipeline/steps/helpers.js";
import { EXISTING_RESOURCE_KEY } from "../../pipeline/steps/load-existing.js";
import type { Store } from "../../store/interface.js";
import { scheduleModelPinningRefusal } from "../../temporal/schedule/model-pinning.js";
import {
  harnessName,
  unknownModelPinRefusal,
} from "../workflow/registry/pin-validation.js";
import type { ModelRegistryStore } from "../workflow/registry/model-registry-store.js";
import { validateScheduleCron, validateScheduleTimeZone } from "./cron.js";

export interface ScheduleValidationDeps {
  readonly store: Store;
  readonly modelRegistry: ModelRegistryStore;
}

/**
 * Prepares a schedule for creation — the ScheduleDefaultsResolver mirror
 * (cloud edition), whose error contracts this step replicates
 * byte-identically (Go resolveScheduleDefaultsStep):
 *
 *  1. Requires metadata.org — the schedule-owning org is the billing org
 *     for every fire (DD-008 D4), so it can never be inferred.
 *  2. Validates the cron grammar and the time zone (cron.ts — the DD-009
 *     C-4 lexical rules; no cron parsing in either edition).
 *  3. Requires spec.agent.agent_ref.slug and normalizes its org (empty
 *     means same-org, the platform-wide relative-reference convention).
 *  4. Enforces the same-org invariant: agent_ref.org must equal
 *     metadata.org — the schedule's org pays for every fire, and both must
 *     be the agent's. Checked BEFORE the agent load so a cross-org request
 *     cannot probe another org's slugs through this path.
 *  5. Loads the referenced agent — scheduling a nonexistent agent is
 *     refused with the same NOT_FOUND a direct agent lookup would produce.
 *
 * Deliberately NO slug default from the agent: schedules are N-per-agent
 * with different prompts, so no single schedule is "the" canonical one. A
 * schedule without a slug or name falls through to the generic ResolveSlug
 * derive-from-name behavior.
 *
 * Resolution is idempotent: an already-resolved schedule passes through
 * unchanged, so the apply pipeline running it before delegating to the
 * create pipeline (which runs it again) is harmless.
 */
export function newResolveScheduleDefaultsStep(
  deps: ScheduleValidationDeps,
): PipelineStep<typeof ScheduleSchema> {
  return {
    name: "ResolveScheduleDefaults",
    async execute(ctx: RequestContext<typeof ScheduleSchema>): Promise<void> {
      const schedule = ctx.newState;
      const metadata = schedule.metadata;

      if ((metadata?.org ?? "") === "") {
        throw invalidArgumentError("metadata.org is required for a schedule");
      }

      const spec = schedule.spec;
      validateScheduleCron(spec?.cron ?? "");
      validateScheduleTimeZone(spec?.timeZone ?? "");

      const agentRef =
        spec?.target.case === "agent" ? spec.target.value.agentRef : undefined;
      if ((agentRef?.slug ?? "") === "") {
        throw invalidArgumentError("spec.agent.agent_ref.slug is required");
      }

      validateScheduleWorkspace(spec);
      validateScheduleModelPinning(deps.modelRegistry, spec);

      // Empty ref org means same-org; make it absolute before the
      // invariant compares orgs.
      let refOrg = agentRef?.org ?? "";
      if (refOrg === "") {
        refOrg = metadata?.org ?? "";
      }

      // The same-org invariant (spec.proto): the schedule's org is the
      // billing org for every fire, and it must be the agent's. Checked
      // BEFORE the agent load so a cross-org request cannot probe another
      // org's slugs through this path.
      if (refOrg !== (metadata?.org ?? "")) {
        throw failedPreconditionError(
          `spec.agent.agent_ref.org must match metadata.org — a schedule must live in the referenced agent's organization (${refOrg})`,
        );
      }

      let found;
      try {
        found = await findResourceBySlug(
          deps.store,
          ApiResourceKind.agent,
          AgentSchema,
          agentRef?.slug ?? "",
          refOrg,
        );
      } catch (error) {
        throw internalError(error, "failed to list agent resources");
      }
      if (found === undefined) {
        // Byte-identical with the direct agent lookup's refusal (the T09
        // indistinguishability contract).
        throw notFoundError("Agent", agentRef?.slug ?? "");
      }

      if (agentRef !== undefined) {
        agentRef.org = refOrg;
      }
    },
  };
}

/**
 * Enforces the schedule-specific workspace constraint on the shared
 * AgentInvocation (DD-018 D-3): every workspace entry must be a git_repo
 * source. A local_path needs a connected client to serve the directory,
 * and a schedule fire has none — refusing at write time beats a
 * deterministic provisioning failure at 3 AM. Copy is cross-edition
 * contract (Go validateScheduleWorkspace).
 */
export function validateScheduleWorkspace(spec: ScheduleSpec | undefined): void {
  const entries =
    spec?.target.case === "agent" ? spec.target.value.workspaceEntries : [];
  for (const [i, entry] of entries.entries()) {
    if (entry.source?.source.case !== "gitRepo") {
      throw invalidArgumentError(
        `spec.agent.workspace_entries[${i}] must use a git_repo source — a scheduled run has no connected client to serve a local_path`,
      );
    }
  }
}

/**
 * Enforces the two unattended model-pinning rules at write time (Go
 * validateScheduleModelPinning):
 *
 *   - PRESENCE (stigmer/stigmer#362): a Cursor-harness schedule must pin a
 *     model. Stated once in the clock's scheduleModelPinningRefusal, which
 *     the run starter also evaluates as the launch backstop for rows
 *     written before the rule existed.
 *   - EXISTENCE (stigmer/stigmer#774): whatever model IS pinned must be in
 *     the registry for the harness the fires would use — a typo'd pin used
 *     to pass through verbatim and silently run (and bill) as Auto.
 *     Write-time only BY DESIGN (no fire-time backstop — registry drift
 *     must never break an existing schedule at its 3 AM fire).
 */
export function validateScheduleModelPinning(
  modelRegistry: ModelRegistryStore,
  spec: ScheduleSpec | undefined,
): void {
  const presence = scheduleModelPinningRefusal(spec);
  if (presence !== "") {
    throw invalidArgumentError(presence);
  }
  const invocation = spec?.target.case === "agent" ? spec.target.value : undefined;
  const existence = unknownModelPinRefusal(
    modelRegistry,
    "spec.agent.run_config.model_name",
    harnessName(invocation?.harness ?? 0),
    invocation?.runConfig?.modelName ?? "",
  );
  if (existence !== "") {
    throw invalidArgumentError(existence);
  }
}

/**
 * The manifest vocabulary for the schedule's target arm — the populated
 * target-oneof member's field name, exactly what users declared in YAML
 * (Go targetFieldName resolves it through proto reflection; connect-es
 * exposes the case name directly, identical for the single-word fields
 * this oneof carries — "agent" today, "workflow" reserved).
 */
export function targetFieldName(spec: ScheduleSpec | undefined): string {
  return spec?.target.case ?? "";
}

/**
 * Enforces the schedule's immutable identity on update (Go
 * validateScheduleUpdateStep):
 *
 *   - spec.agent.agent_ref must keep referencing the same agent. Create's
 *     consent bar is can_edit on the REFERENCED agent (cloud edition); if
 *     an update could repoint the target, a schedule owner could drive an
 *     agent they may not edit — bypassing that consent. Create a new
 *     schedule instead (nothing is lost — a schedule carries no install
 *     state).
 *   - The target arm (target oneof case) must not change. An agent
 *     schedule must not morph into a workflow schedule — the two targets
 *     enter different execution pipelines. Trivially satisfied while one
 *     arm exists; enforced structurally so the workflow arm lands with the
 *     rule already in force.
 *   - The cron grammar and time zone are re-validated: update replaces the
 *     spec wholesale and does not run the defaults resolver, so the write
 *     path must hold the same bar as create.
 *
 * Runs after LoadExisting. metadata.slug/org immutability needs no step
 * here: the generic BuildUpdateState preserves both from the existing
 * resource. Status (firing observations, auto-pause) is likewise preserved
 * wholesale — the invariant that keeps DD-008 D7's auto-pause immune to
 * declarative clobber.
 */
export function newValidateScheduleUpdateStep(
  deps: ScheduleValidationDeps,
): PipelineStep<typeof ScheduleSchema> {
  return {
    name: "ValidateScheduleUpdate",
    execute(ctx: RequestContext<typeof ScheduleSchema>): void {
      const existing = ctx.get(EXISTING_RESOURCE_KEY) as Schedule | undefined;
      if (existing === undefined) {
        throw internalError(
          new Error("existing schedule not found in context"),
          "existing schedule not found in context",
        );
      }

      const newState = ctx.newState;

      const inputTarget = targetFieldName(newState.spec);
      const existingTarget = targetFieldName(existing.spec);
      if (inputTarget !== existingTarget) {
        throw failedPreconditionError(
          `spec target is immutable (schedule target is ${existingTarget}) — create a new schedule for a different target kind`,
        );
      }

      const spec = newState.spec;
      validateScheduleCron(spec?.cron ?? "");
      validateScheduleTimeZone(spec?.timeZone ?? "");
      // Update replaces the spec wholesale (no defaults resolver), so the
      // workspace and model-pinning constraints must hold here too.
      validateScheduleWorkspace(spec);
      validateScheduleModelPinning(deps.modelRegistry, spec);

      const inputRef =
        spec?.target.case === "agent" ? spec.target.value.agentRef : undefined;
      const existingRef =
        existing.spec?.target.case === "agent"
          ? existing.spec.target.value.agentRef
          : undefined;

      // Normalize the input ref's org the same way create does (empty
      // means the schedule's own org) before comparing.
      let inputOrg = inputRef?.org ?? "";
      if (inputOrg === "") {
        inputOrg = existing.metadata?.org ?? "";
      }

      if (
        (inputRef?.slug ?? "") !== (existingRef?.slug ?? "") ||
        inputOrg !== (existingRef?.org ?? "")
      ) {
        throw failedPreconditionError(
          `spec.agent.agent_ref is immutable (schedule runs ${existingRef?.org ?? ""}/${existingRef?.slug ?? ""}) — create a new schedule to run a different agent`,
        );
      }
    },
  };
}
