/**
 * ApiKey controller (O3, 20260827.06) — the shared apikey contract served
 * by OSS for the first time (DD-003 owner ruling: issuance + verification
 * wholly OSS; the cloud Java domain retires against this module). Unlike
 * the ported Class-A domains there is no Go provenance: the behavioral
 * reference is the cloud Java handler family
 * (domain/iam/apikey/request/handler/*), inventoried verbatim in the
 * sub-project's T01 records.
 *
 * Chains mirror the Java pipelines with two deliberate differences:
 *   - PreserveKeyMaterial on update (ruling Q9 — the Java handler
 *     documents hash/fingerprint immutability but does not enforce it;
 *     see steps.ts for the security rationale).
 *   - findAll returns every key (the permissive single-team posture,
 *     ruling Q5) where the cloud filters through FGA can_view; for a
 *     caller who owns the org's keys the results converge.
 *
 * Kind mechanics per kind_meta: id prefix `key`, is_versioned false (no
 * version surface), not_search_indexed true (no IndexSearch steps).
 *
 * Proven by apikey.conformance.test.ts (local + cloud targets) and
 * __tests__/apikey.test.ts (key material, plaintext-once, update
 * immutability — the pins conformance cannot express cross-edition).
 */
import type { ConnectRouter, HandlerContext } from "@connectrpc/connect";
import { create, fromBinary } from "@bufbuild/protobuf";
import type { Empty } from "@bufbuild/protobuf/wkt";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiKeySchema } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/api_pb";
import type { ApiKey } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/api_pb";
import { ApiKeyCommandController } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/command_pb";
import { ApiKeyQueryController } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/query_pb";
import { ApiKeysSchema } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/io_pb";
import type {
  ApiKeyHash,
  ApiKeyId,
  ApiKeys,
} from "@stigmer/protos/ai/stigmer/iam/apikey/v1/io_pb";

import type { Logger } from "../../boot/logger.js";
import type { Authorizer } from "../../extensions/authorizer.js";
import { internalError } from "../../pipeline/errors.js";
import { apiResourceKindKey } from "../../pipeline/interceptors/apiresource.js";
import { callerIdentityOf } from "../../pipeline/interceptors/auth.js";
import { newPipeline } from "../../pipeline/pipeline.js";
import { RequestContext } from "../../pipeline/request-context.js";
import { newAuthorizeStep } from "../../pipeline/steps/authorize.js";
import { newBuildUpdateStateStep } from "../../pipeline/steps/build-update-state.js";
import { newBuildNewStateStep } from "../../pipeline/steps/defaults.js";
import {
  newDeleteResourceStep,
  newExtractResourceIdStep,
  newLoadExistingForDeleteStep,
} from "../../pipeline/steps/delete.js";
import { newCheckDuplicateStep } from "../../pipeline/steps/duplicate.js";
import {
  EXISTING_RESOURCE_KEY,
  newLoadExistingStep,
} from "../../pipeline/steps/load-existing.js";
import {
  TARGET_RESOURCE_KEY,
  newLoadTargetStep,
} from "../../pipeline/steps/load-target.js";
import { newPersistStep } from "../../pipeline/steps/persist.js";
import { newResolveSlugStep } from "../../pipeline/steps/slug.js";
import { newValidateVisibilityStep } from "../../pipeline/steps/validate-visibility.js";
import { newValidateProtoStep } from "../../pipeline/steps/validation.js";
import type { Store } from "../../store/interface.js";
import {
  newGenerateApiKeyStep,
  newLoadByKeyHashStep,
  newPreserveKeyMaterialStep,
  newReplaceHashWithPlainTextStep,
} from "./steps.js";

export interface ApiKeyControllerDeps {
  readonly store: Store;
  readonly logger: Logger;
  /** The composed authorization seam — the Authorize step at position 1 of every chain calls it (O2, DD-007 §3). */
  readonly authorizer: Authorizer;
}

/** Registers both apikey services on the router (routes stage). */
export function registerApiKeyServices(
  router: ConnectRouter,
  deps: ApiKeyControllerDeps,
): void {
  router.service(ApiKeyCommandController, {
    create: (apiKey, ctx) => createApiKey(deps, apiKey, ctx),
    update: (apiKey, ctx) => update(deps, apiKey, ctx),
    delete: (apiKeyId, ctx) => deleteApiKey(deps, apiKeyId, ctx),
  });
  router.service(ApiKeyQueryController, {
    get: (apiKeyId, ctx) => get(deps, apiKeyId, ctx),
    getByKeyHash: (apiKeyHash, ctx) => getByKeyHash(deps, apiKeyHash, ctx),
    findAll: (empty, ctx) => findAll(deps, empty, ctx),
  });
}

function kindOf(ctx: HandlerContext): ApiResourceKind {
  return ctx.values.get(apiResourceKindKey);
}

/**
 * Create — the Java ApiKeyCreateHandler chain: the canonical create steps,
 * GenerateApiKey after BuildNewState, ReplaceHashWithPlainText after
 * Persist (the response's one plaintext look; the store keeps the hash).
 */
async function createApiKey(
  deps: ApiKeyControllerDeps,
  apiKey: ApiKey,
  ctx: HandlerContext,
): Promise<ApiKey> {
  const reqCtx = new RequestContext(
    ApiKeySchema,
    apiKey,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof ApiKeySchema>("apikey-create", deps.logger)
    .addStep(
      newAuthorizeStep(ApiKeyCommandController.method.create, deps.authorizer),
    )
    .addStep(newValidateProtoStep())
    .addStep(newValidateVisibilityStep())
    .addStep(newResolveSlugStep())
    .addStep(newCheckDuplicateStep(deps.store))
    .addStep(newBuildNewStateStep())
    .addStep(newGenerateApiKeyStep())
    .addStep(newPersistStep(deps.store))
    .addStep(newReplaceHashWithPlainTextStep())
    .build()
    .execute(reqCtx);
  return reqCtx.newState;
}

/**
 * Update — the canonical update chain plus PreserveKeyMaterial (ruling
 * Q9): expiry fields are the only client-mutable spec surface.
 */
async function update(
  deps: ApiKeyControllerDeps,
  apiKey: ApiKey,
  ctx: HandlerContext,
): Promise<ApiKey> {
  const reqCtx = new RequestContext(
    ApiKeySchema,
    apiKey,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof ApiKeySchema>("apikey-update", deps.logger)
    .addStep(
      newAuthorizeStep(ApiKeyCommandController.method.update, deps.authorizer),
    )
    .addStep(newValidateProtoStep())
    .addStep(newResolveSlugStep())
    .addStep(newLoadExistingStep(deps.store))
    .addStep(newBuildUpdateStateStep())
    .addStep(newPreserveKeyMaterialStep())
    .addStep(newPersistStep(deps.store))
    .build()
    .execute(reqCtx);
  return reqCtx.newState;
}

/** Delete — returns the pre-delete resource (the canonical delete chain). */
async function deleteApiKey(
  deps: ApiKeyControllerDeps,
  apiKeyId: ApiKeyId,
  ctx: HandlerContext,
): Promise<ApiKey> {
  const reqCtx = new RequestContext(
    ApiKeyCommandController.method.delete.input,
    apiKeyId,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof ApiKeyCommandController.method.delete.input>(
    "apikey-delete",
    deps.logger,
  )
    .addStep(
      newAuthorizeStep(ApiKeyCommandController.method.delete, deps.authorizer),
    )
    .addStep(newValidateProtoStep())
    .addStep(newExtractResourceIdStep())
    .addStep(newLoadExistingForDeleteStep(deps.store, ApiKeySchema))
    .addStep(newDeleteResourceStep(deps.store))
    .build()
    .execute(reqCtx);

  const deleted = reqCtx.get(EXISTING_RESOURCE_KEY);
  if (deleted === undefined) {
    throw internalError(
      new Error("delete pipeline completed without a loaded resource"),
      "deleted api key not found in context",
    );
  }
  return deleted as ApiKey;
}

/** Get — LoadTarget by id; NotFound when absent. */
async function get(
  deps: ApiKeyControllerDeps,
  apiKeyId: ApiKeyId,
  ctx: HandlerContext,
): Promise<ApiKey> {
  const reqCtx = new RequestContext(
    ApiKeyQueryController.method.get.input,
    apiKeyId,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof ApiKeyQueryController.method.get.input>(
    "apikey-get",
    deps.logger,
  )
    .addStep(
      newAuthorizeStep(ApiKeyQueryController.method.get, deps.authorizer),
    )
    .addStep(newValidateProtoStep())
    .addStep(newLoadTargetStep(deps.store, ApiKeySchema))
    .build()
    .execute(reqCtx);
  return reqCtx.get(TARGET_RESOURCE_KEY) as ApiKey;
}

/**
 * GetByKeyHash — the verifier-facing lookup, also served on the wire
 * (Java ApiKeyGetByKeyHashHandler; the cloud gates it behind a
 * platform-admin FGA check inside the handler — OSS's permissive
 * single-team posture serves it openly, ruling Q5).
 */
async function getByKeyHash(
  deps: ApiKeyControllerDeps,
  apiKeyHash: ApiKeyHash,
  ctx: HandlerContext,
): Promise<ApiKey> {
  const reqCtx = new RequestContext(
    ApiKeyQueryController.method.getByKeyHash.input,
    apiKeyHash,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof ApiKeyQueryController.method.getByKeyHash.input>(
    "apikey-get-by-key-hash",
    deps.logger,
  )
    .addStep(
      newAuthorizeStep(
        ApiKeyQueryController.method.getByKeyHash,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    .addStep(newLoadByKeyHashStep(deps.store))
    .build()
    .execute(reqCtx);
  return reqCtx.get(TARGET_RESOURCE_KEY) as ApiKey;
}

/**
 * FindAll — every stored key (the permissive single-team posture, ruling
 * Q5; the cloud edition filters through FGA can_view). Stored hashes ride
 * the response exactly as the cloud's do — the plaintext exists nowhere.
 */
async function findAll(
  deps: ApiKeyControllerDeps,
  empty: Empty,
  ctx: HandlerContext,
): Promise<ApiKeys> {
  const reqCtx = new RequestContext(
    ApiKeyQueryController.method.findAll.input,
    empty,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof ApiKeyQueryController.method.findAll.input>(
    "apikey-find-all",
    deps.logger,
  )
    .addStep(
      newAuthorizeStep(ApiKeyQueryController.method.findAll, deps.authorizer),
    )
    .build()
    .execute(reqCtx);

  let rows: Uint8Array[];
  try {
    rows = await deps.store.listResources(ApiResourceKind.api_key);
  } catch (error) {
    throw internalError(error, "failed to list api keys");
  }
  return create(ApiKeysSchema, {
    entries: rows.map((row) => fromBinary(ApiKeySchema, row)),
  });
}
