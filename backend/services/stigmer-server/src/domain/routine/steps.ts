/**
 * Routine write-path steps: the defaults resolver (create/apply) and the
 * update validator, plus the schedule, workspace and model-pinning rules
 * both share.
 *
 * A routine's cron is optional: the grammar is checked only when one is
 * set, while a time zone that is set is always checked, because every run
 * is dated in it whether or not a schedule fires the routine.
 *
 * Proven by routine.conformance.test.ts (CONFORMANCE_TARGET=local) and
 * __tests__/routine.composed.test.ts.
 */
import { AgentSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import type { Agent } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { RoutineSchema } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/api_pb";
import type { Routine } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/api_pb";
import type { RoutineSpec } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/spec_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamPermission } from "@stigmer/apis/ai/stigmer/iam/v1/enum_pb";

import {
  failedPreconditionError,
  internalError,
  invalidArgumentError,
  notFoundError,
} from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import type { AuthorizationTarget } from "../../pipeline/steps/authorize.js";
import {
  loadReferenced,
  referenceDisplayName,
} from "../../pipeline/steps/references.js";
import { EXISTING_RESOURCE_KEY } from "../../pipeline/steps/load-existing.js";
import type { Store } from "../../store/interface.js";
import { routineModelPinningRefusal } from "../../temporal/routine/model-pinning.js";
import {
  harnessName,
  unknownModelPinRefusal,
} from "../../modelcatalog/pin-validation.js";
import type { ModelCatalogProvider } from "../../modelcatalog/model-catalog-provider.js";
import { savedChoiceWithoutModelRefusal } from "../../modelcatalog/run-config-checks.js";
import { validateRoutineCron, validateRoutineTimeZone } from "./cron.js";

export interface RoutineValidationDeps {
  readonly store: Store;
  readonly modelRegistry: ModelCatalogProvider;
}

/**
 * Prepares a routine for creation:
 *
 *  1. Requires metadata.org — the routine's org is the billing org for
 *     every run, so it can never be inferred.
 *  2. Validates the cron grammar when a cron is set, and the time zone
 *     (cron.ts — lexical rules; no cron parsing in either edition).
 *  3. Requires spec.agent.agent_ref. NormalizeReferences ran first: the
 *     org is absolute (empty meant same-org, the platform-wide
 *     relative-reference convention) and a slug is the agent's id.
 *  4. Enforces the same-org invariant: agent_ref.org must equal
 *     metadata.org — the routine's org pays for every run, and both must
 *     be the agent's. Checked BEFORE the agent load, and no refusal names
 *     whether another org's slug exists.
 *  5. Loads the referenced agent by id — a routine of a nonexistent agent
 *     is refused with the same NOT_FOUND a direct agent lookup would
 *     produce.
 *
 * Deliberately NO slug default from the agent: routines are N-per-agent
 * with different messages, so no single routine is "the" canonical one. A
 * routine without a slug or name falls through to the generic ResolveSlug
 * derive-from-name behavior.
 *
 * Resolution is idempotent: an already-resolved routine passes through
 * unchanged, so the apply pipeline running it before delegating to the
 * create pipeline (which runs it again) is harmless.
 */
export function newResolveRoutineDefaultsStep(
  deps: RoutineValidationDeps,
): PipelineStep<typeof RoutineSchema> {
  return {
    name: "ResolveRoutineDefaults",
    async execute(ctx: RequestContext<typeof RoutineSchema>): Promise<void> {
      const routine = ctx.newState;
      const metadata = routine.metadata;

      if ((metadata?.org ?? "") === "") {
        throw invalidArgumentError("metadata.org is required for a routine");
      }

      const spec = routine.spec;
      validateRoutineSchedule(spec);

      const agentRef = spec?.agent?.agentRef;
      if (agentRef === undefined || (agentRef.id === "" && agentRef.slug === "")) {
        throw invalidArgumentError("spec.agent.agent_ref is required");
      }

      validateRoutineWorkspace(spec);
      validateRoutineModelPinning(deps.modelRegistry, spec);

      // The same-org invariant (spec.proto): the routine's org is the
      // billing org for every run, and it must be the agent's. Checked
      // BEFORE the agent load.
      const refOrg = agentRef.org;
      if (refOrg !== (metadata?.org ?? "")) {
        throw failedPreconditionError(
          `spec.agent.agent_ref.org must match metadata.org — a routine must live in the referenced agent's organization (${refOrg})`,
        );
      }

      let found;
      try {
        found = await loadReferenced(deps.store, ApiResourceKind.agent, AgentSchema, agentRef);
      } catch (error) {
        throw internalError(error, "failed to read the agent");
      }
      if (found === undefined) {
        // Byte-identical with the direct agent lookup's refusal (the
        // indistinguishability contract).
        throw notFoundError("Agent", agentRef.slug !== "" ? agentRef.slug : agentRef.id);
      }

      ctx.set(REFERENCED_AGENT_KEY, found);
    },
  };
}

/**
 * Context key for the agent ResolveRoutineDefaults resolved from
 * spec.agent.agent_ref, read by the create lane's authorization step.
 */
export const REFERENCED_AGENT_KEY = "routineReferencedAgent";

/** The deny copy of the create bar. */
export const ROUTINE_CREATE_DENIED_MESSAGE =
  "You don't have permission to make a routine of this agent";

/**
 * The create lane's authorization question, for AuthorizeResolvedTarget
 * after ResolveRoutineDefaults: can_edit on the REFERENCED AGENT. The RPC
 * is is_skip_authorization because its target is that agent, resolved from
 * a slug, not a request field; and there is deliberately no organization
 * bar — a routine is unattended spend on an agent, an editor's act, and
 * the same-org invariant the resolve step enforces already binds the
 * routine's organization to the agent's (command.proto). An editor, who
 * maintains the definition, may run it on a schedule: a routine widens no
 * one's access, and each run acts as its owner, whose can_execute the run
 * create checks again.
 */
export function resolveRoutineCreateTargets(
  ctx: RequestContext<typeof RoutineSchema>,
): ReadonlyArray<AuthorizationTarget> {
  const agent = ctx.get(REFERENCED_AGENT_KEY) as Agent | undefined;
  if (agent === undefined) {
    throw new Error("referenced agent not found in context");
  }
  return [
    {
      permission: IamPermission.can_edit,
      resourceKind: ApiResourceKind.agent,
      resourceId: agent.metadata?.id ?? "",
      deniedMessage: ROUTINE_CREATE_DENIED_MESSAGE,
    },
  ];
}

/**
 * Validates a routine's schedule: the cron grammar when a cron is set, and
 * the time zone whenever one is set (cron.ts). A routine without a cron
 * still dates every run in its zone, so a mistyped zone is refused here
 * rather than quietly read as UTC. The message rule that a cron needs a
 * zone is the spec's CEL rule, checked by ValidateProto.
 */
export function validateRoutineSchedule(spec: RoutineSpec | undefined): void {
  if (spec?.cron !== undefined) {
    validateRoutineCron(spec.cron);
  }
  validateRoutineTimeZone(spec?.timeZone ?? "");
}

/**
 * Enforces the routine-specific workspace constraint on the shared
 * AgentInvocation: every workspace entry must be a git_repo
 * source. A local_path needs a connected client to serve the directory,
 * and a routine's run has none — refusing at write time beats a
 * deterministic provisioning failure at 3 AM.
 */
export function validateRoutineWorkspace(
  spec: RoutineSpec | undefined,
): void {
  const entries = spec?.agent?.workspaceEntries ?? [];
  for (const [i, entry] of entries.entries()) {
    if (entry.source?.source.case !== "gitRepo") {
      throw invalidArgumentError(
        `spec.agent.workspace_entries[${i}] must use a git_repo source — a routine's run has no connected client to serve a local_path`,
      );
    }
  }
}

/**
 * Enforces the two unattended model-pinning rules at write time:
 *
 *   - PRESENCE (stigmer/stigmer#362): a Cursor-harness routine must pin a
 *     model. Stated once in routineModelPinningRefusal, which the run
 *     starter also evaluates as the launch backstop for rows written
 *     before the rule existed.
 *   - EXISTENCE (stigmer/stigmer#774): whatever model IS pinned must be in
 *     the registry for the harness the runs would use — a typo'd pin used
 *     to pass through verbatim and silently run (and bill) as Auto.
 *     Write-time only BY DESIGN (no fire-time backstop — registry drift
 *     must never break an existing routine at its 3 AM fire).
 */
export function validateRoutineModelPinning(
  modelRegistry: ModelCatalogProvider,
  spec: RoutineSpec | undefined,
): void {
  const presence = routineModelPinningRefusal(spec);
  if (presence !== "") {
    throw invalidArgumentError(presence);
  }
  const invocation = spec?.agent;
  // Saved settings name the model their tier or thinking is for.
  const selfContained = savedChoiceWithoutModelRefusal(
    { fieldPath: "spec.agent.run_config" },
    invocation?.runConfig,
  );
  if (selfContained !== "") {
    throw invalidArgumentError(selfContained);
  }
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
 * Enforces the routine's immutable identity on update:
 *
 *   - spec.agent.agent_ref must keep referencing the same agent. Create's
 *     consent bar is can_edit on the REFERENCED agent; if an update could
 *     repoint it, a routine's owner could drive an agent they may not edit
 *     — bypassing that consent. Create a new routine instead (nothing is
 *     lost — a routine carries no install state).
 *   - The schedule (cron and time zone) is re-validated: update replaces
 *     the spec wholesale and does not run the defaults resolver, so the
 *     write path must hold the same bar as create.
 *
 * Runs after NormalizeReferences, which resolved the request's reference,
 * so the agent is compared by id. metadata.slug/org immutability needs no step
 * here: the generic BuildUpdateState preserves both from the existing
 * resource. Status (firing observations, auto-pause) is likewise preserved
 * wholesale — the invariant that keeps the failure-streak auto-pause immune to
 * declarative clobber.
 */
export function newValidateRoutineUpdateStep(
  deps: RoutineValidationDeps,
): PipelineStep<typeof RoutineSchema> {
  return {
    name: "ValidateRoutineUpdate",
    async execute(ctx: RequestContext<typeof RoutineSchema>): Promise<void> {
      const existing = ctx.get(EXISTING_RESOURCE_KEY) as Routine | undefined;
      if (existing === undefined) {
        throw internalError(
          new Error("existing routine not found in context"),
          "existing routine not found in context",
        );
      }

      const spec = ctx.newState.spec;
      validateRoutineSchedule(spec);
      // Update replaces the spec wholesale (no defaults resolver), so the
      // workspace and model-pinning constraints must hold here too.
      validateRoutineWorkspace(spec);
      validateRoutineModelPinning(deps.modelRegistry, spec);

      const inputRef = spec?.agent?.agentRef;
      const existingRef = existing.spec?.agent?.agentRef;

      if (
        (inputRef?.id ?? "") !== (existingRef?.id ?? "") ||
        (inputRef?.org ?? "") !== (existingRef?.org ?? "")
      ) {
        const held = await referenceDisplayName(deps.store, ApiResourceKind.agent, {
          org: existingRef?.org ?? "",
          id: existingRef?.id ?? "",
          slug: existingRef?.slug ?? "",
        });
        throw failedPreconditionError(
          `spec.agent.agent_ref is immutable (routine runs ${existingRef?.org ?? ""}/${held}) — create a new routine to run a different agent`,
        );
      }
    },
  };
}
