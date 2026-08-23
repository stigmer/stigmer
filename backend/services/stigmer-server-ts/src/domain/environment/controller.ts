/**
 * Environment controller — ports pkg/domain/environment (command + query
 * sides): the first secret-bearing domain, executing the redaction
 * doctrine end-to-end. Environments provide variable bindings and
 * configuration context for agent executions; is_secret values rest
 * encrypted (enc:v1:, oss#405), leave the server as ***REDACTED***
 * markers, and are revealed only through getSecretValue (single-key by
 * design: limited blast radius, per-key audit, the industry "reveal" UX).
 *
 * Pipeline per RPC mirrors the Go step chains character-for-character.
 * Proven by environment.conformance.test.ts (CONFORMANCE_TARGET=local-ts)
 * and __tests__/environment.test.ts.
 *
 * Versus Stigmer Cloud, OSS excludes the Authorize, CreateIamPolicies,
 * FGA-tuple, and Publish steps (no multi-tenant auth, IAM/FGA, or event
 * publishing here); the visibility ceiling (org — secrets never resolve
 * across the org boundary) and share restrictions run in BOTH editions
 * from the same proto config, keeping the error contract identical.
 */
import type { ConnectRouter, HandlerContext } from "@connectrpc/connect";
import { create, fromBinary } from "@bufbuild/protobuf";
import type { Timestamp } from "@bufbuild/protobuf/wkt";

import { EnvironmentCommandController } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/command_pb";
import { EnvironmentQueryController } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/query_pb";
import { EnvironmentSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/api_pb";
import type { Environment } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/api_pb";
import { EnvironmentListSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/io_pb";
import type {
  EnvironmentList,
  EnvironmentSecretValueInput,
  ListEnvironmentsRequest,
  RemoveEnvironmentVariablesRequest,
  UpdateEnvironmentVariablesRequest,
} from "@stigmer/protos/ai/stigmer/agentic/environment/v1/io_pb";
import type { EnvironmentValue } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/spec_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import type {
  ApiResourceDeleteInput,
  ApiResourceId,
  ApiResourceReference,
  UpdateVisibilityInput,
} from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../../boot/logger.js";
import type { SecretService } from "../../encryption/encryption.js";
import { apiResourceKindKey } from "../../pipeline/interceptors/apiresource.js";
import {
  failedPreconditionError,
  internalError,
  notFoundError,
} from "../../pipeline/errors.js";
import { newPipeline } from "../../pipeline/pipeline.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import { RequestContext } from "../../pipeline/request-context.js";
import { newBuildNewStateStep, setAuditFieldsForUpdate } from "../../pipeline/steps/defaults.js";
import { newBuildUpdateStateStep } from "../../pipeline/steps/build-update-state.js";
import { newCheckDuplicateStep } from "../../pipeline/steps/duplicate.js";
import {
  RESOURCE_ID_KEY,
  newDeleteResourceStep,
  newLoadExistingForDeleteStep,
} from "../../pipeline/steps/delete.js";
import {
  newDeleteSearchIndexStep,
  newIndexSearchStep,
} from "../../pipeline/steps/index-search.js";
import { EXISTING_RESOURCE_KEY, newLoadExistingStep } from "../../pipeline/steps/load-existing.js";
import { SHOULD_CREATE_KEY, newLoadForApplyStep } from "../../pipeline/steps/load-for-apply.js";
import { newLoadByReferenceStep } from "../../pipeline/steps/load-by-reference.js";
import { TARGET_RESOURCE_KEY, newLoadTargetStep } from "../../pipeline/steps/load-target.js";
import { newNormalizeReferencesStep } from "../../pipeline/steps/references.js";
import { newPersistStep } from "../../pipeline/steps/persist.js";
import { newResolveSlugStep } from "../../pipeline/steps/slug.js";
import { newValidateProtoStep } from "../../pipeline/steps/validation.js";
import {
  newValidateVisibilityStep,
  newValidateVisibilityUpdateStep,
} from "../../pipeline/steps/validate-visibility.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";
import { redactEnvironmentSecrets, shareRestrictionReason } from "./redact.js";
import { environmentSearchExtractor } from "./search-extractor.js";
import {
  SECRET_VALUE_KEY,
  UPDATED_ENVIRONMENT_KEY,
  newEncryptSecretValuesStep,
  newEnforcePersonalUniquenessStep,
  newExtractAndDecryptSingleKeyStep,
  newLoadEnvironmentByIdStep,
  newMergeVariablesAndPersistStep,
  newPreserveRedactedSecretsStep,
  newRemoveVariableKeysAndPersistStep,
} from "./steps.js";

export interface EnvironmentControllerDeps {
  readonly store: Store;
  readonly logger: Logger;
  readonly secretService: SecretService;
}

/** Registers both environment services on the router (routes stage). */
export function registerEnvironmentServices(
  router: ConnectRouter,
  deps: EnvironmentControllerDeps,
): void {
  router.service(EnvironmentCommandController, {
    apply: (env, ctx) => apply(deps, env, ctx),
    create: (env, ctx) => createEnvironment(deps, env, ctx),
    update: (env, ctx) => update(deps, env, ctx),
    updateVisibility: (input, ctx) => updateVisibility(deps, input, ctx),
    delete: (input, ctx) => deleteEnvironment(deps, input, ctx),
    updateVariables: (req, ctx) => updateVariables(deps, req, ctx),
    removeVariables: (req, ctx) => removeVariables(deps, req, ctx),
  });
  router.service(EnvironmentQueryController, {
    get: (id, ctx) => get(deps, id, ctx),
    getByReference: (ref, ctx) => getByReference(deps, ref, ctx),
    getSecretValue: (input, ctx) => getSecretValue(deps, input, ctx),
    list: (req, ctx) => list(deps, req, ctx),
  });
}

function kindOf(ctx: HandlerContext): ApiResourceKind {
  return ctx.values.get(apiResourceKindKey);
}

/**
 * Create — chain per Go buildCreatePipeline. Redaction runs AFTER
 * Persist: the store keeps ciphertext, the response carries markers
 * (never ciphertext — clients cannot round-trip it past the enc: prefix
 * guard, and it is server-internal by design).
 */
async function createEnvironment(
  deps: EnvironmentControllerDeps,
  env: Environment,
  ctx: HandlerContext,
): Promise<Environment> {
  const reqCtx = new RequestContext(EnvironmentSchema, env, kindOf(ctx));
  await newPipeline<typeof EnvironmentSchema>("environment-create", deps.logger)
    .addStep(newValidateProtoStep())
    .addStep(newValidateVisibilityStep())
    .addStep(newResolveSlugStep())
    .addStep(newCheckDuplicateStep(deps.store))
    .addStep(newEnforcePersonalUniquenessStep(deps.store))
    .addStep(newBuildNewStateStep())
    .addStep(newPreserveRedactedSecretsStep())
    .addStep(newEncryptSecretValuesStep(deps.secretService, deps.logger))
    .addStep(newPersistStep(deps.store))
    .addStep(newIndexSearchStep(deps.store, environmentSearchExtractor, deps.logger))
    .build()
    .execute(reqCtx);
  redactEnvironmentSecrets(reqCtx.newState);
  return reqCtx.newState;
}

/** Update — chain per Go buildUpdatePipeline; redact after persist. */
async function update(
  deps: EnvironmentControllerDeps,
  env: Environment,
  ctx: HandlerContext,
): Promise<Environment> {
  const reqCtx = new RequestContext(EnvironmentSchema, env, kindOf(ctx));
  await newPipeline<typeof EnvironmentSchema>("environment-update", deps.logger)
    .addStep(newValidateProtoStep())
    .addStep(newResolveSlugStep())
    .addStep(newLoadExistingStep(deps.store))
    .addStep(newBuildUpdateStateStep())
    .addStep(newPreserveRedactedSecretsStep())
    .addStep(newEncryptSecretValuesStep(deps.secretService, deps.logger))
    .addStep(newNormalizeReferencesStep())
    .addStep(newPersistStep(deps.store))
    .addStep(newIndexSearchStep(deps.store, environmentSearchExtractor, deps.logger))
    .build()
    .execute(reqCtx);
  redactEnvironmentSecrets(reqCtx.newState);
  return reqCtx.newState;
}

/**
 * Apply — kubectl-style create-or-update: a minimal probe pipeline decides
 * existence, then delegates to Create or Update with the ORIGINAL request
 * message (Go delegates `environment`, not the pipeline's mutated clone).
 */
async function apply(
  deps: EnvironmentControllerDeps,
  env: Environment,
  ctx: HandlerContext,
): Promise<Environment> {
  const reqCtx = new RequestContext(EnvironmentSchema, env, kindOf(ctx));
  await newPipeline<typeof EnvironmentSchema>("environment-apply", deps.logger)
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
  return shouldCreate
    ? createEnvironment(deps, env, ctx)
    : update(deps, env, ctx);
}

/**
 * Delete — returns the deleted environment REDACTED (the audit-trail
 * convention; even a parting response never carries secrets). The id is
 * seeded into context manually because ApiResourceDeleteInput carries
 * resource_id, not the `value` field ExtractResourceId expects (Go does
 * the same manual seed).
 */
async function deleteEnvironment(
  deps: EnvironmentControllerDeps,
  input: ApiResourceDeleteInput,
  ctx: HandlerContext,
): Promise<Environment> {
  const reqCtx = new RequestContext(
    EnvironmentCommandController.method.delete.input,
    input,
    kindOf(ctx),
  );
  reqCtx.set(RESOURCE_ID_KEY, input.resourceId);
  await newPipeline<typeof EnvironmentCommandController.method.delete.input>(
    "environment-delete",
    deps.logger,
  )
    .addStep(newValidateProtoStep())
    .addStep(newLoadExistingForDeleteStep(deps.store, EnvironmentSchema))
    .addStep(newDeleteResourceStep(deps.store))
    .addStep(newDeleteSearchIndexStep(deps.store, deps.logger))
    .build()
    .execute(reqCtx);

  const deleted = reqCtx.get(EXISTING_RESOURCE_KEY);
  if (deleted === undefined) {
    throw internalError(
      new Error("deleted environment not found in context"),
      "deleted environment not found in context",
    );
  }
  const env = deleted as Environment;
  redactEnvironmentSecrets(env);
  return env;
}

// ---------------------------------------------------------------------------
// updateVisibility — Go update_visibility.go: a targeted metadata update
// (only metadata.visibility changes; spec/status untouched). Environments
// cap out at org visibility (the kind's VisibilityConfig — secret values
// must never be resolvable across the org boundary); personal and
// OAuth-managed environments reject org sharing entirely.
// ---------------------------------------------------------------------------

const UPDATE_VISIBILITY_ENVIRONMENT_KEY = "updateVisibilityEnvironment";

type UpdateVisibilityDesc =
  typeof EnvironmentCommandController.method.updateVisibility.input;

async function updateVisibility(
  deps: EnvironmentControllerDeps,
  input: UpdateVisibilityInput,
  ctx: HandlerContext,
): Promise<Environment> {
  const reqCtx = new RequestContext(
    EnvironmentCommandController.method.updateVisibility.input,
    input,
    kindOf(ctx),
  );
  await newPipeline<UpdateVisibilityDesc>(
    "environment-update-visibility",
    deps.logger,
  )
    .addStep(newValidateProtoStep())
    .addStep(newLoadEnvironmentForVisibilityUpdateStep(deps.store))
    // After load, per the cross-edition error precedence: unknown id +
    // bad level = NOT_FOUND on both editions.
    .addStep(newValidateVisibilityUpdateStep())
    .addStep(newValidateEnvironmentShareRestrictionStep())
    .addStep(newSetEnvironmentVisibilityStep())
    .addStep(newPersistEnvironmentForVisibilityUpdateStep(deps.store))
    .addStep(newIndexEnvironmentAfterVisibilityUpdateStep(deps.store, deps.logger))
    .build()
    .execute(reqCtx);

  const env = reqCtx.get(UPDATE_VISIBILITY_ENVIRONMENT_KEY) as Environment;
  redactEnvironmentSecrets(env);
  return env;
}

/** Loads the environment by resource_id; ANY load failure → NotFound. */
function newLoadEnvironmentForVisibilityUpdateStep(
  store: Store,
): PipelineStep<UpdateVisibilityDesc> {
  return {
    name: "LoadEnvironmentForVisibilityUpdate",
    async execute(ctx: RequestContext<UpdateVisibilityDesc>): Promise<void> {
      const input = ctx.input;
      let env: Environment;
      try {
        env = await store.getResource(
          ctx.apiResourceKind,
          input.resourceId,
          EnvironmentSchema,
        );
      } catch {
        throw notFoundError("environment", input.resourceId);
      }
      ctx.set(UPDATE_VISIBILITY_ENVIRONMENT_KEY, env);
    },
  };
}

/**
 * Rejects org sharing on personal and OAuth-managed environments BEFORE
 * any state changes. Only gates the transitions that WIDEN access —
 * restoring a share-restricted environment to private must always be
 * possible. Level support is validated by the shared
 * ValidateVisibilityUpdate composed just before this one.
 */
function newValidateEnvironmentShareRestrictionStep(): PipelineStep<UpdateVisibilityDesc> {
  return {
    name: "ValidateEnvironmentShareRestriction",
    execute(ctx: RequestContext<UpdateVisibilityDesc>): void {
      if (ctx.input.visibility !== ApiResourceVisibility.visibility_org) {
        return;
      }
      const env = ctx.get(UPDATE_VISIBILITY_ENVIRONMENT_KEY) as Environment;
      const reason = shareRestrictionReason(env.metadata);
      if (reason !== "") {
        throw failedPreconditionError(reason);
      }
    },
  };
}

/** Sets metadata.visibility and stamps the StatusAudit slot (#540). */
function newSetEnvironmentVisibilityStep(): PipelineStep<UpdateVisibilityDesc> {
  return {
    name: "SetVisibility",
    execute(ctx: RequestContext<UpdateVisibilityDesc>): void {
      const env = ctx.get(UPDATE_VISIBILITY_ENVIRONMENT_KEY) as Environment;
      if (env.metadata !== undefined) {
        env.metadata.visibility = ctx.input.visibility;
      }
      // Go wraps a stamping failure as a PLAIN error (not grpclib) — the
      // wire then carries the sanitized "internal server error", exactly
      // what the pipeline's non-Connect fallback produces here.
      setAuditFieldsForUpdate(EnvironmentSchema, env, "status_audit");
    },
  };
}

/** Persists the visibility change. */
function newPersistEnvironmentForVisibilityUpdateStep(
  store: Store,
): PipelineStep<UpdateVisibilityDesc> {
  return {
    name: "PersistEnvironmentForVisibilityUpdate",
    async execute(ctx: RequestContext<UpdateVisibilityDesc>): Promise<void> {
      const env = ctx.get(UPDATE_VISIBILITY_ENVIRONMENT_KEY) as Environment;
      try {
        await store.saveResource(
          ctx.apiResourceKind,
          env.metadata?.id ?? "",
          EnvironmentSchema,
          env,
        );
      } catch (error) {
        throw internalError(error, "failed to save environment");
      }
    },
  };
}

/**
 * Re-indexes after the visibility change (visibility is an indexed
 * field). Domain-local because the shared IndexSearch reads newState,
 * which is the UpdateVisibilityInput here, not the environment.
 * Best-effort by contract, as in Go.
 */
function newIndexEnvironmentAfterVisibilityUpdateStep(
  store: Store,
  logger: Logger,
): PipelineStep<UpdateVisibilityDesc> {
  return {
    name: "IndexEnvironmentAfterVisibilityUpdate",
    async execute(ctx: RequestContext<UpdateVisibilityDesc>): Promise<void> {
      const env = ctx.get(UPDATE_VISIBILITY_ENVIRONMENT_KEY) as Environment;
      const entry = environmentSearchExtractor.getSearchIndexEntry(env);
      if (entry === undefined) {
        logger.warn(
          "IndexEnvironmentAfterVisibilityUpdate: extractor returned nil, skipping",
          { id: env.metadata?.id ?? "" },
        );
        return;
      }
      try {
        await store.upsertSearchIndex(
          ctx.apiResourceKind,
          env.metadata?.id ?? "",
          entry,
        );
      } catch (error) {
        logger.warn(
          "IndexEnvironmentAfterVisibilityUpdate: failed (best-effort)",
          {
            id: env.metadata?.id ?? "",
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }
    },
  };
}

/**
 * UpdateVariables — server-side merge: request keys overwrite, absent
 * keys are preserved. Avoids the read-modify-write secret destruction
 * problem inherent in the full-resource Update RPC.
 */
async function updateVariables(
  deps: EnvironmentControllerDeps,
  req: UpdateEnvironmentVariablesRequest,
  ctx: HandlerContext,
): Promise<Environment> {
  const reqCtx = new RequestContext(
    EnvironmentCommandController.method.updateVariables.input,
    req,
    kindOf(ctx),
  );
  await newPipeline<typeof EnvironmentCommandController.method.updateVariables.input>(
    "environment-update-variables",
    deps.logger,
  )
    .addStep(newValidateProtoStep())
    .addStep(newLoadEnvironmentByIdStep(deps.store))
    .addStep(
      newMergeVariablesAndPersistStep(deps.store, deps.secretService, deps.logger),
    )
    .build()
    .execute(reqCtx);

  const updated = reqCtx.get(UPDATED_ENVIRONMENT_KEY) as Environment;
  redactEnvironmentSecrets(updated);
  return updated;
}

/** RemoveVariables — named keys deleted; unknown keys silently ignored. */
async function removeVariables(
  deps: EnvironmentControllerDeps,
  req: RemoveEnvironmentVariablesRequest,
  ctx: HandlerContext,
): Promise<Environment> {
  const reqCtx = new RequestContext(
    EnvironmentCommandController.method.removeVariables.input,
    req,
    kindOf(ctx),
  );
  await newPipeline<typeof EnvironmentCommandController.method.removeVariables.input>(
    "environment-remove-variables",
    deps.logger,
  )
    .addStep(newValidateProtoStep())
    .addStep(newLoadEnvironmentByIdStep(deps.store))
    .addStep(newRemoveVariableKeysAndPersistStep(deps.store))
    .build()
    .execute(reqCtx);

  const updated = reqCtx.get(UPDATED_ENVIRONMENT_KEY) as Environment;
  redactEnvironmentSecrets(updated);
  return updated;
}

/** Get — LoadTarget by id; the response is redacted (oss#405). */
async function get(
  deps: EnvironmentControllerDeps,
  id: ApiResourceId,
  ctx: HandlerContext,
): Promise<Environment> {
  const reqCtx = new RequestContext(
    EnvironmentQueryController.method.get.input,
    id,
    kindOf(ctx),
  );
  await newPipeline<typeof EnvironmentQueryController.method.get.input>(
    "environment-get",
    deps.logger,
  )
    .addStep(newValidateProtoStep())
    .addStep(newLoadTargetStep(deps.store, EnvironmentSchema))
    .build()
    .execute(reqCtx);
  const env = reqCtx.get(TARGET_RESOURCE_KEY) as Environment;
  redactEnvironmentSecrets(env);
  return env;
}

/** GetByReference — slug+org lookup; the response is redacted. */
async function getByReference(
  deps: EnvironmentControllerDeps,
  ref: ApiResourceReference,
  ctx: HandlerContext,
): Promise<Environment> {
  const reqCtx = new RequestContext(
    EnvironmentQueryController.method.getByReference.input,
    ref,
    kindOf(ctx),
  );
  await newPipeline<typeof EnvironmentQueryController.method.getByReference.input>(
    "environment-get-by-reference",
    deps.logger,
  )
    .addStep(newValidateProtoStep())
    .addStep(newLoadByReferenceStep(deps.store, EnvironmentSchema))
    .build()
    .execute(reqCtx);
  const env = reqCtx.get(TARGET_RESOURCE_KEY) as Environment;
  redactEnvironmentSecrets(env);
  return env;
}

/**
 * GetSecretValue — the sanctioned single-key reveal path; the ONE
 * Environment surface that returns an unredacted value.
 */
async function getSecretValue(
  deps: EnvironmentControllerDeps,
  input: EnvironmentSecretValueInput,
  ctx: HandlerContext,
): Promise<EnvironmentValue> {
  const reqCtx = new RequestContext(
    EnvironmentQueryController.method.getSecretValue.input,
    input,
    kindOf(ctx),
  );
  await newPipeline<typeof EnvironmentQueryController.method.getSecretValue.input>(
    "environment-get-secret-value",
    deps.logger,
  )
    .addStep(newValidateProtoStep())
    .addStep(newLoadEnvironmentByIdStep(deps.store))
    .addStep(newExtractAndDecryptSingleKeyStep(deps.secretService, deps.logger))
    .build()
    .execute(reqCtx);
  return reqCtx.get(SECRET_VALUE_KEY) as EnvironmentValue;
}

const LIST_RESULT_KEY = "listResult";

/**
 * List — org + labels filter with per-item redaction. Versus Cloud, OSS
 * excludes authorization filtering AND pagination (returns all matches),
 * exactly as Go's list.go records.
 */
async function list(
  deps: EnvironmentControllerDeps,
  req: ListEnvironmentsRequest,
  ctx: HandlerContext,
): Promise<EnvironmentList> {
  const reqCtx = new RequestContext(
    EnvironmentQueryController.method.list.input,
    req,
    kindOf(ctx),
  );
  await newPipeline<typeof EnvironmentQueryController.method.list.input>(
    "environment-list",
    deps.logger,
  )
    .addStep(newValidateProtoStep())
    .addStep(newListByOrgAndLabelsStep(deps.store))
    .build()
    .execute(reqCtx);

  const result = reqCtx.get(LIST_RESULT_KEY);
  if (result === undefined) {
    throw internalError(
      new Error("environment list not found in context"),
      "environment list not found in context",
    );
  }
  return result as EnvironmentList;
}

/**
 * ListByOrgAndLabels — Go list.go's domain step: full scan, malformed
 * rows skipped, org equality + AND-label filtering, per-item redaction,
 * sorted by spec-audit created_at descending (seconds then nanos;
 * timestamped entries before untimestamped ones).
 */
function newListByOrgAndLabelsStep(
  store: Store,
): PipelineStep<typeof EnvironmentQueryController.method.list.input> {
  return {
    name: "ListByOrgAndLabels",
    async execute(
      ctx: RequestContext<typeof EnvironmentQueryController.method.list.input>,
    ): Promise<void> {
      const { org, labels: filterLabels } = ctx.input;

      let rows: Uint8Array[];
      try {
        rows = await store.listResources(ctx.apiResourceKind);
      } catch (error) {
        throw internalError(error, "failed to list environments");
      }

      const environments: Environment[] = [];
      for (const bytes of rows) {
        let env: Environment;
        try {
          env = fromBinary(EnvironmentSchema, bytes);
        } catch {
          continue; // skip malformed rows, as Go does
        }
        if ((env.metadata?.org ?? "") !== org) {
          continue;
        }
        if (!matchesAllLabels(env.metadata?.labels ?? {}, filterLabels)) {
          continue;
        }
        redactEnvironmentSecrets(env);
        environments.push(env);
      }

      environments.sort((a, b) =>
        compareCreatedAtDesc(
          a.status?.audit?.specAudit?.createdAt,
          b.status?.audit?.specAudit?.createdAt,
        ),
      );

      ctx.set(
        LIST_RESULT_KEY,
        create(EnvironmentListSchema, {
          totalCount: environments.length,
          items: environments,
        }),
      );
    },
  };
}

/** True when resourceLabels contains every filter entry (empty = all). */
function matchesAllLabels(
  resourceLabels: Record<string, string>,
  filterLabels: Record<string, string>,
): boolean {
  return Object.entries(filterLabels).every(
    ([key, value]) => resourceLabels[key] === value,
  );
}

/** Go's sort.Slice comparator: newest first; nil timestamps last. */
function compareCreatedAtDesc(
  a: Timestamp | undefined,
  b: Timestamp | undefined,
): number {
  if (a === undefined || b === undefined) {
    if (a === undefined && b === undefined) {
      return 0;
    }
    return a !== undefined ? -1 : 1;
  }
  if (a.seconds !== b.seconds) {
    return a.seconds > b.seconds ? -1 : 1;
  }
  if (a.nanos !== b.nanos) {
    return a.nanos > b.nanos ? -1 : 1;
  }
  return 0;
}
