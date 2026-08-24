/**
 * ExecutionContext controller — ports pkg/domain/executioncontext
 * (command + query sides): the create-only, secret-bearing resource the
 * execution engine mints to carry one run's merged runtime configuration
 * and secrets, deleted when the execution completes.
 *
 * The domain diverges from the other flat domains in two
 * contract-significant ways:
 *   - There is NO update RPC and NO list RPC. Reads are by id, by
 *     reference (org + slug), or by the parent execution_id.
 *   - apply is create-or-FAIL: applying over an existing slug returns a
 *     real AlreadyExists, not an update.
 *
 * Secret handling (oss#535, the stigmer-cloud#152 contract ported):
 * is_secret values rest encrypted (enc:v1:), leave the server as
 * ***REDACTED*** markers on EVERY user-shaped boundary — get,
 * getByReference, the create/apply and delete echoes — and are revealed
 * only through getByExecutionId to a caller presenting an
 * execution-scoped runner token bound to this very EC (see
 * resolve-values-for-caller.ts).
 *
 * Pipeline per RPC mirrors the Go step chains character-for-character.
 * Proven by executioncontext.conformance.test.ts
 * (CONFORMANCE_TARGET=local-ts) and __tests__/executioncontext.test.ts
 * (the decrypt-lane matrix conformance deliberately never exercises —
 * its harness authenticates as a user).
 *
 * Versus Stigmer Cloud, OSS excludes the Authorize, CreateIamPolicies,
 * and Publish steps (no multi-tenant auth, IAM/FGA, or event publishing
 * here); the redaction and decrypt-lane contracts run in BOTH editions,
 * keeping the error contract identical.
 */
import type { ConnectRouter, HandlerContext } from "@connectrpc/connect";

import { ExecutionContextSchema } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/api_pb";
import type { ExecutionContext } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/api_pb";
import { ExecutionContextCommandController } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/command_pb";
import { ExecutionContextQueryController } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/query_pb";
import type {
  ExecutionContextExecutionIdInput,
  ExecutionContextId,
} from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type {
  ApiResourceDeleteInput,
  ApiResourceReference,
} from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";

import type { Logger } from "../../boot/logger.js";
import type { SecretService } from "../../encryption/encryption.js";
import { apiResourceKindKey } from "../../pipeline/interceptors/apiresource.js";
import { alreadyExistsError, internalError } from "../../pipeline/errors.js";
import { newPipeline } from "../../pipeline/pipeline.js";
import { RequestContext } from "../../pipeline/request-context.js";
import { newBuildNewStateStep } from "../../pipeline/steps/defaults.js";
import {
  RESOURCE_ID_KEY,
  newDeleteResourceStep,
  newLoadExistingForDeleteStep,
} from "../../pipeline/steps/delete.js";
import { newCheckDuplicateStep } from "../../pipeline/steps/duplicate.js";
import {
  newDeleteSearchIndexStep,
  newIndexSearchStep,
} from "../../pipeline/steps/index-search.js";
import { EXISTING_RESOURCE_KEY } from "../../pipeline/steps/load-existing.js";
import {
  SHOULD_CREATE_KEY,
  newLoadForApplyStep,
} from "../../pipeline/steps/load-for-apply.js";
import { newLoadByReferenceStep } from "../../pipeline/steps/load-by-reference.js";
import {
  TARGET_RESOURCE_KEY,
  newLoadTargetStep,
} from "../../pipeline/steps/load-target.js";
import { newNormalizeReferencesStep } from "../../pipeline/steps/references.js";
import { newPersistStep } from "../../pipeline/steps/persist.js";
import { newResolveSlugStep } from "../../pipeline/steps/slug.js";
import { newValidateProtoStep } from "../../pipeline/steps/validation.js";
import { newValidateVisibilityStep } from "../../pipeline/steps/validate-visibility.js";
import type { RunnerAuthService } from "../../runnerauth/runnerauth.js";
import type { Store } from "../../store/interface.js";
import { redactExecutionContextSecrets } from "./redact.js";
import { resolveValuesForCaller } from "./resolve-values-for-caller.js";
import { executionContextSearchExtractor } from "./search-extractor.js";
import {
  newEncryptSecretValuesStep,
  newLoadByExecutionIdStep,
  newRejectCiphertextShapedStep,
} from "./steps.js";

export interface ExecutionContextControllerDeps {
  readonly store: Store;
  readonly logger: Logger;
  /**
   * Shared with the Environment/OAuthApp controllers so the
   * encrypt-on-write / decrypt-on-read key pair always matches.
   */
  readonly secretService: SecretService;
  /**
   * Verifies the execution-scoped tokens that gate getByExecutionId's
   * decrypt lane. REQUIRED: the composition root always constructs one
   * (boot-fatal otherwise); the keyless state — verify rejects every
   * token, every read redacts — is the modeled "disabled" arm, the TS
   * shape of Go's nil-service check.
   */
  readonly runnerAuthService: RunnerAuthService;
}

/** Registers both executioncontext services on the router (routes stage). */
export function registerExecutionContextServices(
  router: ConnectRouter,
  deps: ExecutionContextControllerDeps,
): void {
  router.service(ExecutionContextCommandController, {
    apply: (ec, ctx) => apply(deps, ec, ctx),
    create: (ec, ctx) => createExecutionContext(deps, ec, ctx),
    delete: (input, ctx) => deleteExecutionContext(deps, input, ctx),
  });
  router.service(ExecutionContextQueryController, {
    get: (id, ctx) => get(deps, id, ctx),
    getByReference: (ref, ctx) => getByReference(deps, ref, ctx),
    getByExecutionId: (input, ctx) => getByExecutionId(deps, input, ctx),
  });
}

function kindOf(ctx: HandlerContext): ApiResourceKind {
  return ctx.values.get(apiResourceKindKey);
}

/**
 * Create — chain per Go buildCreatePipeline. The response echo is
 * redacted AFTER the pipeline: the persisted resource is echoed back, and
 * without redaction the echo would leak either the plaintext the caller
 * just sent or the stored ciphertext. The internal builders (agent
 * execution, workflow execution, MCP connect — they arrive with #17/#19/
 * #20) only read metadata.id from the echo, so they are unaffected.
 */
async function createExecutionContext(
  deps: ExecutionContextControllerDeps,
  ec: ExecutionContext,
  ctx: HandlerContext,
): Promise<ExecutionContext> {
  const reqCtx = new RequestContext(ExecutionContextSchema, ec, kindOf(ctx));
  await newPipeline<typeof ExecutionContextSchema>(
    "execution-context-create",
    deps.logger,
  )
    .addStep(newValidateProtoStep())
    .addStep(newValidateVisibilityStep())
    .addStep(newRejectCiphertextShapedStep())
    .addStep(newResolveSlugStep())
    .addStep(newCheckDuplicateStep(deps.store))
    .addStep(newBuildNewStateStep())
    .addStep(newNormalizeReferencesStep())
    .addStep(newEncryptSecretValuesStep(deps.secretService, deps.logger))
    .addStep(newPersistStep(deps.store))
    .addStep(
      newIndexSearchStep(
        deps.store,
        executionContextSearchExtractor,
        deps.logger,
      ),
    )
    .build()
    .execute(reqCtx);
  redactExecutionContextSecrets(reqCtx.newState);
  return reqCtx.newState;
}

/**
 * Apply — Go apply.go: declarative create-or-FAIL (ExecutionContext has
 * no update). A minimal probe pipeline decides existence, then delegates
 * to Create with the ORIGINAL request message or returns AlreadyExists
 * with Go's exact copy — note it carries metadata.NAME, while the
 * duplicate arm inside the delegated create emits CheckDuplicate's
 * slug-shaped message; both are wire contract, reached via different
 * entry paths.
 */
async function apply(
  deps: ExecutionContextControllerDeps,
  ec: ExecutionContext,
  ctx: HandlerContext,
): Promise<ExecutionContext> {
  const reqCtx = new RequestContext(ExecutionContextSchema, ec, kindOf(ctx));
  await newPipeline<typeof ExecutionContextSchema>(
    "execution-context-apply",
    deps.logger,
  )
    .addStep(newValidateProtoStep())
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
  if (shouldCreate) {
    return createExecutionContext(deps, ec, ctx);
  }
  deps.logger.warn("ExecutionContext already exists - UPDATE not supported", {
    slug: ec.metadata?.name ?? "",
    id: ec.metadata?.id ?? "",
  });
  throw alreadyExistsError("ExecutionContext", ec.metadata?.name ?? "");
}

/**
 * Delete — returns the deleted execution context REDACTED (oss#535):
 * without it, delete would be the one path that leaks the stored
 * representation — ciphertext today, actual plaintext for legacy
 * pre-encryption rows. The id is seeded into context manually because
 * ApiResourceDeleteInput carries resource_id, not the `value` field
 * ExtractResourceId expects (Go does the same manual seed).
 */
async function deleteExecutionContext(
  deps: ExecutionContextControllerDeps,
  input: ApiResourceDeleteInput,
  ctx: HandlerContext,
): Promise<ExecutionContext> {
  const reqCtx = new RequestContext(
    ExecutionContextCommandController.method.delete.input,
    input,
    kindOf(ctx),
  );
  reqCtx.set(RESOURCE_ID_KEY, input.resourceId);
  await newPipeline<
    typeof ExecutionContextCommandController.method.delete.input
  >("execution-context-delete", deps.logger)
    .addStep(newValidateProtoStep())
    .addStep(newLoadExistingForDeleteStep(deps.store, ExecutionContextSchema))
    .addStep(newDeleteResourceStep(deps.store))
    .addStep(newDeleteSearchIndexStep(deps.store, deps.logger))
    .build()
    .execute(reqCtx);

  const deleted = reqCtx.get(EXISTING_RESOURCE_KEY);
  if (deleted === undefined) {
    throw internalError(
      new Error("deleted execution context not found in context"),
      "deleted execution context not found in context",
    );
  }
  const ec = deleted as ExecutionContext;
  redactExecutionContextSecrets(ec);
  return ec;
}

/** Get — LoadTarget by id; the response is redacted (oss#535). */
async function get(
  deps: ExecutionContextControllerDeps,
  id: ExecutionContextId,
  ctx: HandlerContext,
): Promise<ExecutionContext> {
  const reqCtx = new RequestContext(
    ExecutionContextQueryController.method.get.input,
    id,
    kindOf(ctx),
  );
  await newPipeline<typeof ExecutionContextQueryController.method.get.input>(
    "execution-context-get",
    deps.logger,
  )
    .addStep(newValidateProtoStep())
    .addStep(newLoadTargetStep(deps.store, ExecutionContextSchema))
    .build()
    .execute(reqCtx);
  const ec = reqCtx.get(TARGET_RESOURCE_KEY) as ExecutionContext;
  redactExecutionContextSecrets(ec);
  return ec;
}

/** GetByReference — slug+org lookup; the response is redacted. */
async function getByReference(
  deps: ExecutionContextControllerDeps,
  ref: ApiResourceReference,
  ctx: HandlerContext,
): Promise<ExecutionContext> {
  const reqCtx = new RequestContext(
    ExecutionContextQueryController.method.getByReference.input,
    ref,
    kindOf(ctx),
  );
  await newPipeline<
    typeof ExecutionContextQueryController.method.getByReference.input
  >("execution-context-get-by-reference", deps.logger)
    .addStep(newValidateProtoStep())
    .addStep(newLoadByReferenceStep(deps.store, ExecutionContextSchema))
    .build()
    .execute(reqCtx);
  const ec = reqCtx.get(TARGET_RESOURCE_KEY) as ExecutionContext;
  redactExecutionContextSecrets(ec);
  return ec;
}

/**
 * GetByExecutionId — the runner's secret-delivery path: the unified TS
 * runner fetches the merged environment variables here before executing
 * an agent or workflow (and during MCP connect discovery). The
 * execution_id corresponds to a WorkflowExecution ID, AgentExecution ID,
 * or connect-flow execution id.
 *
 * The response carries DECRYPTED is_secret values only when the caller
 * presents an execution-scoped runner token whose binding matches this
 * EC — see resolve-values-for-caller.ts. Every other caller receives the
 * same redaction as get/getByReference, as a SUCCESS.
 */
async function getByExecutionId(
  deps: ExecutionContextControllerDeps,
  input: ExecutionContextExecutionIdInput,
  ctx: HandlerContext,
): Promise<ExecutionContext> {
  const reqCtx = new RequestContext(
    ExecutionContextQueryController.method.getByExecutionId.input,
    input,
    kindOf(ctx),
  );
  await newPipeline<
    typeof ExecutionContextQueryController.method.getByExecutionId.input
  >("execution-context-get-by-execution-id", deps.logger)
    .addStep(newValidateProtoStep())
    .addStep(newLoadByExecutionIdStep(deps.store))
    .build()
    .execute(reqCtx);

  // Resolve secret values by presented credential: decrypt for a
  // scope-bound runner token, redact for everyone else. Both transforms
  // mutate the fresh store unmarshal, never the stored row.
  const ec = reqCtx.get(TARGET_RESOURCE_KEY) as ExecutionContext;
  resolveValuesForCaller(deps, ctx, ec);
  return ec;
}
