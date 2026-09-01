/**
 * Memory controller — ports pkg/domain/memory/controller (command + query
 * sides): agent-proposed, user-confirmed facts the platform remembers
 * about a person (decisions DD-004/DD-005/DD-006 of the
 * preferences-and-memory project, stigmer/stigmer#293).
 *
 * A memory is system-generated: an agent proposes it (Phase 2 Stage 3's
 * remember tool calls the create RPC), and it becomes recallable only
 * after the person it is about confirms it. There is deliberately no
 * apply RPC — nobody authors a memory manifest. The kind belongs to the
 * Session/AgentExecution/Artifact family: records the platform creates
 * that users inspect and manage.
 *
 * Field ownership (DD-004, provenance revised by the Stage 3 decision,
 * owner-ratified 2026-08-22): spec.content is the subject's after capture
 * (editable via update); spec.subject_identity_account_id is
 * server-derived at create and immutable forever; spec.provenance is
 * capture-path-supplied at create (the remember tool threads it; direct
 * creates leave it empty; tool_call_id force-cleared in v1) and immutable
 * forever after — attribution that can be edited is not attribution;
 * status.lifecycle_state is written ONLY by create (initial proposed) and
 * the confirm/reject commands. Updates graft metadata+spec+status.audit
 * onto the live row and never touch the lifecycle — consent must not be
 * rewritable through a spec edit.
 *
 * Consent posture (DD-005 D3): confirm/reject enforced at the control
 * plane is the ENTIRE consent mechanism. Client-side approval flows are
 * never trusted with retention — three shipped HITL bypasses are the
 * recorded evidence (see DD-005).
 *
 * Caps (DD-006 D5): content length via protovalidate (500 chars); a
 * 100-records-per-subject-per-org ceiling across ALL lifecycle states
 * (proposed clutter counts, which pressures honest rejection), enforced
 * at create with a visible FAILED_PRECONDITION — never silent eviction.
 *
 * Authorization posture (OSS): this edition is single-user and local, so
 * handlers perform no authorization — a documented no-op, not a silent
 * divergence. The subject is the empty-string sentinel (the OAuth grant
 * store convention); enablement is the org flag alone (the user scope
 * collapses — DD-002 D1). The cloud edition derives the subject from the
 * calling credential, enforces the strict first-party-human gate, checks
 * both memory_enabled flags, and gates every RPC through FGA (subject-only
 * can_view/can_edit/can_delete).
 *
 * Memory is deliberately NOT search-indexed (privacy — subject-only
 * content must not surface in org-visible search): no search-extractor,
 * no IndexSearch/DeleteSearchIndex steps anywhere in this domain.
 *
 * Pipeline per RPC mirrors the Go step chains character-for-character.
 * Proven by memory.conformance.test.ts (CONFORMANCE_TARGET=local) and
 * __tests__/memory.test.ts.
 */
import type { ConnectRouter, HandlerContext } from "@connectrpc/connect";
import type { DescMethod } from "@bufbuild/protobuf";

import { MemoryCommandController } from "@stigmer/protos/ai/stigmer/agentic/memory/v1/command_pb";
import { MemoryQueryController } from "@stigmer/protos/ai/stigmer/agentic/memory/v1/query_pb";
import { MemorySchema } from "@stigmer/protos/ai/stigmer/agentic/memory/v1/api_pb";
import type { Memory } from "@stigmer/protos/ai/stigmer/agentic/memory/v1/api_pb";
import { MemoryLifecycleState } from "@stigmer/protos/ai/stigmer/agentic/memory/v1/enum_pb";
import { MemoryIdSchema } from "@stigmer/protos/ai/stigmer/agentic/memory/v1/io_pb";
import type {
  ListMemoriesRequest,
  MemoryId,
  MemoryList,
} from "@stigmer/protos/ai/stigmer/agentic/memory/v1/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../../boot/logger.js";
import type { Authorizer } from "../../extensions/authorizer.js";
import type { RunnerCredentialProvider } from "../../runnerauth/runner-credential-provider.js";
import type { ListReadScope } from "../../extensions/list-read-scope.js";
import type { ResourceAuthorizationLifecycle } from "../../extensions/resource-authorization.js";
import { apiResourceKindKey } from "../../pipeline/interceptors/apiresource.js";
import { internalError } from "../../pipeline/errors.js";
import { newPipeline } from "../../pipeline/pipeline.js";
import { callerIdentityOf } from "../../pipeline/interceptors/auth.js";
import { RequestContext } from "../../pipeline/request-context.js";
import { newAuthorizeStep } from "../../pipeline/steps/authorize.js";
import { newGuardMemoryCaptureStep } from "../../pipeline/steps/guard-memory-capture.js";
import { newGuardReservedLabelsStep } from "../../pipeline/steps/guard-reserved-labels.js";
import { newBuildNewStateStep } from "../../pipeline/steps/defaults.js";
import { newBuildUpdateStateStep } from "../../pipeline/steps/build-update-state.js";
import { newCheckDuplicateStep } from "../../pipeline/steps/duplicate.js";
import {
  newDeleteResourceStep,
  newExtractResourceIdStep,
  newLoadExistingForDeleteStep,
} from "../../pipeline/steps/delete.js";
import {
  EXISTING_RESOURCE_KEY,
  newLoadExistingStep,
} from "../../pipeline/steps/load-existing.js";
import {
  TARGET_RESOURCE_KEY,
  newLoadTargetStep,
} from "../../pipeline/steps/load-target.js";
import {
  newCleanupIamPoliciesStep,
  newCreateAuthorizationTuplesStep,
} from "../../pipeline/steps/authorization-tuples.js";
import { newPersistStep } from "../../pipeline/steps/persist.js";
import { newResolveSlugStep } from "../../pipeline/steps/slug.js";
import { newValidateProtoStep } from "../../pipeline/steps/validation.js";
import { newValidateVisibilityStep } from "../../pipeline/steps/validate-visibility.js";
import type { Store } from "../../store/interface.js";
import {
  MEMORY_CONFIRM_REJECTED_MESSAGE,
  MEMORY_REJECT_CONFIRMED_MESSAGE,
} from "./constants.js";
import {
  LIST_RESULT_KEY,
  newCheckMemoryCapStep,
  newCheckMemoryEnablementStep,
  newInitializeMemoryLifecycleStep,
  newListMemoriesByOrgStep,
  newPersistMemoryUpdateStep,
  newResolveMemoryDefaultsStep,
  newTransitionMemoryLifecycleStep,
  newValidateMemoryUpdateStep,
} from "./steps.js";

export interface MemoryControllerDeps {
  readonly store: Store;
  readonly logger: Logger;
  /** The composed authorization seam — the Authorize step at position 1 of every chain calls it (O2, DD-007 §3). */
  readonly authorizer: Authorizer;
  /** The composed tuple-lifecycle driver — undefined = the shared steps no-op (C2). */
  readonly authorizationLifecycle: ResourceAuthorizationLifecycle | undefined;
  /** The composed list read scope — list narrows through it; undefined = the OSS full scan (20260830.01). */
  readonly listReadScope: ListReadScope | undefined;
  /**
   * The composed runner-credential provider — GuardMemoryCapture consults
   * its authorizeMemoryCapture capability for the runner-credential
   * eligibility arm (parity entry 20260830.05). The OSS default defines
   * no capabilities, so the gate's behavior is unchanged with it.
   */
  readonly runnerCredentialProvider: RunnerCredentialProvider;
}

/** Registers both memory services on the router (routes stage). */
export function registerMemoryServices(
  router: ConnectRouter,
  deps: MemoryControllerDeps,
): void {
  router.service(MemoryCommandController, {
    create: (memory, ctx) => createMemory(deps, memory, ctx),
    update: (memory, ctx) => update(deps, memory, ctx),
    delete: (id, ctx) => deleteMemory(deps, id, ctx),
    confirm: (id, ctx) => confirm(deps, id, ctx),
    reject: (id, ctx) => reject(deps, id, ctx),
  });
  router.service(MemoryQueryController, {
    get: (id, ctx) => get(deps, id, ctx),
    list: (req, ctx) => list(deps, req, ctx),
  });
}

function kindOf(ctx: HandlerContext): ApiResourceKind {
  return ctx.values.get(apiResourceKindKey);
}

/**
 * Create — chain per Go buildCreatePipeline: a new memory in the proposed
 * state (DD-005 D2). ResolveMemoryDefaults mints the id BEFORE
 * BuildNewState so an unnamed record can default its name from its own
 * identity; InitializeMemoryLifecycle runs AFTER BuildNewState so the
 * status wipe cannot undo it.
 *
 * No search-index step: memory is not_search_indexed by design (privacy —
 * content is subject-only and must not surface in org-visible search).
 *
 * Note: Unlike Stigmer Cloud, OSS excludes the strict
 * first-party-human-operator gate and the caller's own memory_enabled
 * check (no per-request user identity — the user scope collapses, DD-006
 * D1) and creates no FGA tuples.
 */
async function createMemory(
  deps: MemoryControllerDeps,
  memory: Memory,
  ctx: HandlerContext,
): Promise<Memory> {
  const reqCtx = new RequestContext(
    MemorySchema,
    memory,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof MemorySchema>("memory-create", deps.logger)
    .addStep(
      newAuthorizeStep(MemoryCommandController.method.create, deps.authorizer),
    )
    .addStep(newValidateProtoStep())
    .addStep(newGuardMemoryCaptureStep(deps.runnerCredentialProvider))
    .addStep(newValidateVisibilityStep())
    .addStep(newResolveMemoryDefaultsStep())
    .addStep(newCheckMemoryEnablementStep(deps.store))
    .addStep(newCheckMemoryCapStep(deps.store))
    .addStep(newResolveSlugStep())
    .addStep(newCheckDuplicateStep(deps.store))
    .addStep(newBuildNewStateStep())
    .addStep(newGuardReservedLabelsStep(deps.authorizer))
    .addStep(newInitializeMemoryLifecycleStep())
    .addStep(newPersistStep(deps.store))
    .addStep(
      newCreateAuthorizationTuplesStep(
        deps.authorizationLifecycle,
        deps.logger,
      ),
    )
    .build()
    .execute(reqCtx);
  return reqCtx.newState;
}

/**
 * Update — chain per Go buildUpdatePipeline: edits the fact text only
 * (DD-004: the content is the subject's; everything else on the record is
 * not up for editing). The spec is replaced wholesale (declarative
 * semantics), but only content may actually change: subject and
 * provenance are immutable (validate step), and the consent lifecycle is
 * protected by MECHANISM — PersistMemoryUpdate grafts
 * metadata+spec+status.audit onto the LIVE row inside one atomic
 * read-modify-write, so status.lifecycle_state stays exactly as its
 * owners (create, confirm, reject) last wrote it, even against a
 * concurrent confirm landing between this pipeline's load and persist.
 *
 * Note: Unlike Stigmer Cloud, OSS excludes the authorization step (cloud
 * requires can_edit on the memory — FGA subject-only).
 */
async function update(
  deps: MemoryControllerDeps,
  memory: Memory,
  ctx: HandlerContext,
): Promise<Memory> {
  const reqCtx = new RequestContext(
    MemorySchema,
    memory,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof MemorySchema>("memory-update", deps.logger)
    .addStep(
      newAuthorizeStep(MemoryCommandController.method.update, deps.authorizer),
    )
    .addStep(newValidateProtoStep())
    .addStep(newLoadExistingStep(deps.store))
    .addStep(newValidateMemoryUpdateStep())
    .addStep(newBuildUpdateStateStep())
    .addStep(newGuardReservedLabelsStep(deps.authorizer))
    .addStep(newPersistMemoryUpdateStep(deps.store))
    .build()
    .execute(reqCtx);
  return reqCtx.newState;
}

/**
 * Confirm — Go confirm.go: moves a proposed memory to confirmed — the
 * consent act (DD-005 D3). From the next eligible execution on, the fact
 * is recalled as background context.
 *
 * Confirming an already-confirmed memory is an idempotent no-op.
 * Confirming a rejected memory is refused with FAILED_PRECONDITION: the
 * rejection stands as an auditable decision — delete the record and let
 * the agent propose again.
 *
 * This RPC and reject are the ONLY writers of status.lifecycle_state.
 * Consent is enforced here, at the control plane — never delegated to
 * client-side approval mechanisms (DD-005 D3 records the three shipped
 * HITL bypasses that make any client-side gate untrustworthy for
 * retention).
 */
async function confirm(
  deps: MemoryControllerDeps,
  memoryId: MemoryId,
  ctx: HandlerContext,
): Promise<Memory> {
  return runTransition(
    deps,
    memoryId,
    ctx,
    "memory-confirm",
    MemoryCommandController.method.confirm,
    MemoryLifecycleState.lifecycle_state_confirmed,
    MEMORY_CONFIRM_REJECTED_MESSAGE,
  );
}

/**
 * Reject — Go reject.go: moves a proposed memory to rejected. A rejected
 * memory is never recalled; the record is kept rather than deleted so the
 * decision is auditable and an identical re-proposal is visible as such
 * (DD-005).
 *
 * Rejecting an already-rejected memory is an idempotent no-op. Rejecting
 * a confirmed memory is refused with FAILED_PRECONDITION: deleting a
 * confirmed memory IS its revocation (DD-006) — a reject that pretended
 * to revoke would leave a misleading audit record.
 *
 * Rejection is deliberately one click on every surface — expensive review
 * teaches users to ignore the proposal queue (DD-005 D4).
 */
async function reject(
  deps: MemoryControllerDeps,
  memoryId: MemoryId,
  ctx: HandlerContext,
): Promise<Memory> {
  return runTransition(
    deps,
    memoryId,
    ctx,
    "memory-reject",
    MemoryCommandController.method.reject,
    MemoryLifecycleState.lifecycle_state_rejected,
    MEMORY_REJECT_CONFIRMED_MESSAGE,
  );
}

/**
 * The shared confirm/reject pipeline — Go buildTransitionPipeline +
 * runTransition: one contract with opposite verdicts (DD-005 D3),
 * answering with the post-image row.
 *
 * Note: Unlike Stigmer Cloud, OSS excludes the authorization step (cloud
 * requires can_edit on the memory — FGA subject-only, loading before
 * authorizing so a missing memory answers NOT_FOUND, #224).
 */
async function runTransition(
  deps: MemoryControllerDeps,
  memoryId: MemoryId,
  ctx: HandlerContext,
  name: string,
  method: DescMethod,
  target: MemoryLifecycleState,
  blockedMessage: string,
): Promise<Memory> {
  const reqCtx = new RequestContext(
    MemoryIdSchema,
    memoryId,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof MemoryIdSchema>(name, deps.logger)
    .addStep(newAuthorizeStep(method, deps.authorizer))
    .addStep(newValidateProtoStep())
    .addStep(newExtractResourceIdStep())
    .addStep(newLoadExistingForDeleteStep(deps.store, MemorySchema))
    .addStep(
      newTransitionMemoryLifecycleStep(deps.store, target, blockedMessage),
    )
    .build()
    .execute(reqCtx);

  const transitioned = reqCtx.get(EXISTING_RESOURCE_KEY);
  if (transitioned === undefined) {
    throw internalError(
      new Error("transitioned memory not found in context"),
      "transitioned memory not found in context",
    );
  }
  return transitioned as Memory;
}

/**
 * Delete — Go delete.go: deletes a memory permanently, in ANY lifecycle
 * state — the any-state guarantee is load-bearing for the trust story:
 * "delete this one" must never be refused on lifecycle grounds (DD-004).
 * Deleting a confirmed memory is how consent is revoked; past executions
 * keep their immutable recalled_memories snapshots (DD-006 D6).
 *
 * No search-index cleanup: memory is not_search_indexed.
 *
 * Note: Unlike Stigmer Cloud, OSS excludes the authorization step (cloud
 * requires can_delete on the memory — FGA subject-only).
 *
 * The deleted memory is returned for audit trail purposes (gRPC
 * convention).
 */
async function deleteMemory(
  deps: MemoryControllerDeps,
  memoryId: MemoryId,
  ctx: HandlerContext,
): Promise<Memory> {
  const reqCtx = new RequestContext(
    MemoryIdSchema,
    memoryId,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof MemoryIdSchema>("memory-delete", deps.logger)
    .addStep(
      newAuthorizeStep(MemoryCommandController.method.delete, deps.authorizer),
    )
    .addStep(newValidateProtoStep())
    .addStep(newExtractResourceIdStep())
    .addStep(newLoadExistingForDeleteStep(deps.store, MemorySchema))
    .addStep(newDeleteResourceStep(deps.store))
    .addStep(
      newCleanupIamPoliciesStep(deps.authorizationLifecycle, deps.logger),
    )
    .build()
    .execute(reqCtx);

  const deleted = reqCtx.get(EXISTING_RESOURCE_KEY);
  if (deleted === undefined) {
    throw internalError(
      new Error("deleted memory not found in context"),
      "deleted memory not found in context",
    );
  }
  return deleted as Memory;
}

/**
 * Get — chain per Go buildGetPipeline (ExtractResourceId → LoadTarget).
 *
 * Note: Unlike Stigmer Cloud, OSS excludes the authorization step (cloud
 * requires can_view — FGA subject-only: only the person a memory is about
 * can read it).
 */
async function get(
  deps: MemoryControllerDeps,
  memoryId: MemoryId,
  ctx: HandlerContext,
): Promise<Memory> {
  const reqCtx = new RequestContext(
    MemoryIdSchema,
    memoryId,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof MemoryIdSchema>("memory-get", deps.logger)
    .addStep(
      newAuthorizeStep(MemoryQueryController.method.get, deps.authorizer),
    )
    .addStep(newValidateProtoStep())
    .addStep(newExtractResourceIdStep())
    .addStep(newLoadTargetStep(deps.store, MemorySchema))
    .build()
    .execute(reqCtx);

  const target = reqCtx.get(TARGET_RESOURCE_KEY);
  if (target === undefined) {
    throw internalError(
      new Error("target memory not found in context"),
      "target memory not found in context",
    );
  }
  return target as Memory;
}

/**
 * List — Go list.go: memories in an organization, newest first. Ordering
 * is chronological only; grouping pending proposals first is the
 * console's presentation concern (DD-005 D4), deliberately not an RPC
 * parameter at the kind's dozens-of-records scale.
 *
 * Note: Unlike Stigmer Cloud, OSS excludes:
 *   - Authorization filtering (single user — every record is the
 *     caller's; cloud filters to can_view via FGA, which resolves to the
 *     subject)
 *   - Pagination (returns all matching results)
 */
async function list(
  deps: MemoryControllerDeps,
  req: ListMemoriesRequest,
  ctx: HandlerContext,
): Promise<MemoryList> {
  const reqCtx = new RequestContext(
    MemoryQueryController.method.list.input,
    req,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof MemoryQueryController.method.list.input>(
    "memory-list",
    deps.logger,
  )
    .addStep(
      newAuthorizeStep(MemoryQueryController.method.list, deps.authorizer),
    )
    .addStep(newValidateProtoStep())
    .addStep(newListMemoriesByOrgStep(deps.store, deps.listReadScope))
    .build()
    .execute(reqCtx);

  const result = reqCtx.get(LIST_RESULT_KEY);
  if (result === undefined) {
    throw internalError(
      new Error("memory list not found in context"),
      "memory list not found in context",
    );
  }
  return result as MemoryList;
}
