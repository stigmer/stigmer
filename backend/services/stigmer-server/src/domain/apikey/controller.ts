/**
 * ApiKey controller — the shared apikey contract: issuance and
 * verification live wholly in open source, and every edition serves this
 * module. Unlike the ported Class-A domains there is no Go provenance:
 * the behavioral reference is the retired Java handler family
 * (domain/iam/apikey/request/handler/*).
 *
 * Chains mirror the Java pipelines with two deliberate differences:
 *   - PreserveKeyMaterial on update (the Java handler documented
 *     hash/fingerprint immutability but did not enforce it; see steps.ts
 *     for why it matters).
 *   - findAll returns the caller's own keys, read by owner through the
 *     key list index (list-index.ts), not every key a read scope admits:
 *     an organization's admins may view its service accounts' keys, and
 *     those are listed with findByAccount, never mixed into the admin's own.
 *   - A key's name is unique among its owner's keys, not among every key
 *     of its organization (steps.ts CheckDuplicate).
 *
 * createForServiceAccount runs the create chain AS the service account,
 * so the key's creator stamp, the stamp the verifier and the owner tuple
 * read, names the account the key speaks for. Its organization is the
 * service account's, set from the account row. The admin who minted it is
 * named in the server's log line for the create. The key is filed in, and
 * limited to, the service account's organization. A service account's own
 * key is refused every create and update of a key (pipeline/steps/
 * refuse-service-account.ts): it never decides what credentials exist.
 *
 * Kind mechanics per kind_meta: id prefix `key`, is_versioned false (no
 * version surface), not_search_indexed true (no IndexSearch steps).
 *
 * Proven by apikey.conformance.test.ts (local + cloud targets) and
 * __tests__/apikey.test.ts (key material, plaintext-once, update
 * immutability — the pins conformance cannot express cross-edition).
 */
import { Code, ConnectError } from "@connectrpc/connect";
import type { ConnectRouter, HandlerContext } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import type { Empty } from "@bufbuild/protobuf/wkt";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiKeySchema } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/api_pb";
import type { ApiKey } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/api_pb";
import { ApiKeyCommandController } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/command_pb";
import { ApiKeyQueryController } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/query_pb";
import { ApiKeysSchema } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/io_pb";
import type {
  ApiKeyAccountId,
  ApiKeyHash,
  ApiKeyId,
  ApiKeys,
  CreateServiceAccountKeyInput,
} from "@stigmer/protos/ai/stigmer/iam/apikey/v1/io_pb";
import type { IdentityAccount } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";

import type { Logger } from "../../boot/logger.js";
import type { Authorizer } from "../../extensions/authorizer.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import type { ListReadScope } from "../../extensions/list-read-scope.js";
import { restrictListByReadScope } from "../../extensions/list-read-scope.js";
import type { ResourceAuthorizationLifecycle } from "../../extensions/resource-authorization.js";
import {
  failedPreconditionError,
  internalError,
} from "../../pipeline/errors.js";
import { apiResourceKindKey } from "../../pipeline/interceptors/apiresource.js";
import { callerIdentityOf } from "../../pipeline/interceptors/auth.js";
import { newPipeline } from "../../pipeline/pipeline.js";
import { RequestContext } from "../../pipeline/request-context.js";
import {
  authorizeDirect,
  newAuthorizeStep,
} from "../../pipeline/steps/authorize.js";
import { newGuardReservedLabelsStep } from "../../pipeline/steps/guard-reserved-labels.js";
import { newBuildUpdateStateStep } from "../../pipeline/steps/build-update-state.js";
import { newBuildNewStateStep } from "../../pipeline/steps/defaults.js";
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
import {
  newRefuseServiceAccountCallerStep,
  refuseServiceAccountCaller,
} from "../../pipeline/steps/refuse-service-account.js";
import { newResolveSlugStep } from "../../pipeline/steps/slug.js";
import { newValidateVisibilityStep } from "../../pipeline/steps/validate-visibility.js";
import { newValidateProtoStep } from "../../pipeline/steps/validation.js";
import type { Store } from "../../store/interface.js";
import { serviceAccountCallerOf } from "../identityaccount/actor.js";
import { accountNotFoundMessage } from "../identityaccount/constants.js";
import type { IdentityAccountStore } from "../identityaccount/store.js";
import { keysOwnedBy, ownerNamesOf } from "./queries.js";
import {
  newBindApiKeyOrganizationStep,
  newCheckDuplicateKeyNameStep,
  newGenerateApiKeyStep,
  newLoadByKeyHashStep,
  newPreserveKeyMaterialStep,
  newReplaceHashWithPlainTextStep,
} from "./steps.js";

export interface ApiKeyControllerDeps {
  readonly store: Store;
  readonly logger: Logger;
  /** The composed authorization seam — the Authorize step at position 1 of every chain calls it. */
  readonly authorizer: Authorizer;
  /** The composed tuple-lifecycle driver — undefined = the shared steps no-op. */
  readonly authorizationLifecycle: ResourceAuthorizationLifecycle | undefined;
  /** The composed list read scope — findAll narrows through it as well as by owner. */
  readonly listReadScope: ListReadScope | undefined;
  /** The identity-account port: the service account a key is minted for, the account whose keys are listed. */
  readonly accounts: Pick<IdentityAccountStore, "findById">;
}

/** createForServiceAccount for an account that is not a service account (FAILED_PRECONDITION). */
export function notAServiceAccountMessage(id: string): string {
  return `identity account '${id}' is not a service account; a person creates their own keys`;
}

/** Registers both apikey services on the router (routes stage). */
export function registerApiKeyServices(
  router: ConnectRouter,
  deps: ApiKeyControllerDeps,
): void {
  router.service(ApiKeyCommandController, {
    create: (apiKey, ctx) => createApiKey(deps, apiKey, ctx),
    createForServiceAccount: (input, ctx) =>
      createForServiceAccount(deps, input, ctx),
    update: (apiKey, ctx) => update(deps, apiKey, ctx),
    delete: (apiKeyId, ctx) => deleteApiKey(deps, apiKeyId, ctx),
  });
  router.service(ApiKeyQueryController, {
    get: (apiKeyId, ctx) => get(deps, apiKeyId, ctx),
    getByKeyHash: (apiKeyHash, ctx) => getByKeyHash(deps, apiKeyHash, ctx),
    findAll: (empty, ctx) => findAll(deps, empty, ctx),
    findByAccount: (input, ctx) => findByAccount(deps, input, ctx),
  });
}

function kindOf(ctx: HandlerContext): ApiResourceKind {
  return ctx.values.get(apiResourceKindKey);
}

/**
 * Create — the Java ApiKeyCreateHandler chain: the canonical create steps,
 * BindApiKeyOrganization and GenerateApiKey after BuildNewState,
 * ReplaceHashWithPlainText after Persist (the response's one plaintext
 * look; the store keeps the hash).
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
    .addStep(newRefuseServiceAccountCallerStep(CREATE_KEY_ACT, deps.accounts))
    .addStep(newValidateProtoStep())
    .addStep(newValidateVisibilityStep())
    .addStep(newResolveSlugStep())
    .addStep(newCheckDuplicateKeyNameStep(deps.store, ownerIsCaller))
    .addStep(newBuildNewStateStep())
    .addStep(newBindApiKeyOrganizationStep(deps.authorizer))
    .addStep(newGuardReservedLabelsStep(deps.authorizer))
    .addStep(newGenerateApiKeyStep())
    .addStep(newPersistStep(deps.store))
    .addStep(
      newCreateAuthorizationTuplesStep(
        deps.authorizationLifecycle,
        deps.logger,
      ),
    )
    .addStep(newReplaceHashWithPlainTextStep())
    .build()
    .execute(reqCtx);
  return reqCtx.newState;
}

/** What a service account's key is refused (pipeline/steps/refuse-service-account.ts). */
const CREATE_KEY_ACT = "create API keys";
const UPDATE_KEY_ACT = "change an API key";

/** The account a key created by the caller will speak for: the caller. */
function ownerIsCaller(ctx: RequestContext<typeof ApiKeySchema>): string {
  return ctx.callerIdentity.identityId;
}

/**
 * createForServiceAccount — the minting admin is authorized on the
 * service account (`can_manage_keys`, its organization's admins) and
 * refused when it is itself a service account; the account must be one.
 * The key is then created by the ordinary create chain AS the service
 * account, from ValidateProto on, bound to the account's organization:
 * BindApiKeyOrganization is not run, because the organization is the
 * account's own and is set here, never taken from the request.
 */
async function createForServiceAccount(
  deps: ApiKeyControllerDeps,
  input: CreateServiceAccountKeyInput,
  ctx: HandlerContext,
): Promise<ApiKey> {
  const admin = callerIdentityOf(ctx);
  const method = ApiKeyCommandController.method.createForServiceAccount;
  await authorizeDirect(method, deps.authorizer, admin, input);
  await refuseServiceAccountCaller(admin, CREATE_KEY_ACT, deps.accounts);
  const account = await loadAccount(deps, input.serviceAccountId);
  const asAccount = serviceAccountCallerOf(account);
  if (asAccount === undefined) {
    throw failedPreconditionError(
      notAServiceAccountMessage(input.serviceAccountId),
    );
  }
  const caller: CallerIdentity = { ...asAccount, issuer: "", rawToken: "" };
  const apiKey = create(ApiKeySchema, {
    apiVersion: "iam.stigmer.ai/v1",
    kind: "ApiKey",
    metadata: { name: input.name, org: asAccount.boundOrg ?? "" },
    spec: {
      ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
      neverExpires: input.neverExpires,
      boundOrg: asAccount.boundOrg ?? "",
    },
  });
  const reqCtx = new RequestContext(ApiKeySchema, apiKey, caller, kindOf(ctx));
  await newPipeline<typeof ApiKeySchema>(
    "apikey-create-for-service-account",
    deps.logger,
  )
    .addStep(newValidateProtoStep())
    .addStep(newValidateVisibilityStep())
    .addStep(newResolveSlugStep())
    .addStep(newCheckDuplicateKeyNameStep(deps.store, ownerIsCaller))
    .addStep(newBuildNewStateStep())
    .addStep(newGuardReservedLabelsStep(deps.authorizer))
    .addStep(newGenerateApiKeyStep())
    .addStep(newPersistStep(deps.store))
    .addStep(
      newCreateAuthorizationTuplesStep(
        deps.authorizationLifecycle,
        deps.logger,
      ),
    )
    .addStep(newReplaceHashWithPlainTextStep())
    .build()
    .execute(reqCtx);
  deps.logger.info("API key created for a service account", {
    keyId: reqCtx.newState.metadata?.id ?? "",
    serviceAccountId: asAccount.identityId,
    org: asAccount.boundOrg ?? "",
    createdBy: admin.identityId,
  });
  return reqCtx.newState;
}

/** The account by id, or the identity-account domain's NOT_FOUND; a fault is INTERNAL. */
async function loadAccount(
  deps: ApiKeyControllerDeps,
  id: string,
): Promise<IdentityAccount> {
  let account: IdentityAccount | undefined;
  try {
    account = await deps.accounts.findById(id);
  } catch (error) {
    throw internalError(error, "failed to load identity account");
  }
  if (account === undefined) {
    throw new ConnectError(accountNotFoundMessage(id), Code.NotFound);
  }
  return account;
}

/**
 * Update — the canonical update chain plus PreserveKeyMaterial: expiry
 * fields are the only client-mutable spec surface.
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
    .addStep(newRefuseServiceAccountCallerStep(UPDATE_KEY_ACT, deps.accounts))
    .addStep(newValidateProtoStep())
    .addStep(newResolveSlugStep({ update: true }))
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
    .addStep(
      newCleanupIamPoliciesStep(deps.authorizationLifecycle, deps.logger),
    )
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
 * (Java ApiKeyGetByKeyHashHandler). The lane is is_skip_authorization, so
 * every edition serves it to any authenticated caller; nothing gates it
 * further.
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
 * FindAll — the caller's own keys: those whose creator stamp is the
 * caller's account id, or, for a direct account, the issuer subject a key
 * minted before the account existed carries (queries.ts `ownerNamesOf`),
 * newest first. An unprovisioned caller's identity is its subject already. A composed
 * ListReadScope still narrows the answer, so a list is never wider than
 * the keys the caller may view. Stored hashes ride the response exactly
 * as the cloud's do — the plaintext exists nowhere. Newest first, as
 * PlatformClient's listByOrg answers, so a list does not reorder as keys
 * are used (stigmer/stigmer#1255).
 */
async function findAll(
  deps: ApiKeyControllerDeps,
  empty: Empty,
  ctx: HandlerContext,
): Promise<ApiKeys> {
  const identity = callerIdentityOf(ctx);
  const reqCtx = new RequestContext(
    ApiKeyQueryController.method.findAll.input,
    empty,
    identity,
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
  let account: IdentityAccount | undefined;
  try {
    account = await deps.accounts.findById(identity.identityId);
  } catch (error) {
    throw internalError(error, "failed to load identity account");
  }
  return listOwnedKeys(deps, identity, ownerNamesOf(identity.identityId, account));
}

/**
 * FindByAccount — the keys that speak for an account, for whoever may view
 * it: the person, or a service account's organization admins. Authorized
 * on the account by its annotation, then read by owner, the account's id
 * and its subject alike.
 */
async function findByAccount(
  deps: ApiKeyControllerDeps,
  input: ApiKeyAccountId,
  ctx: HandlerContext,
): Promise<ApiKeys> {
  const identity = callerIdentityOf(ctx);
  await authorizeDirect(
    ApiKeyQueryController.method.findByAccount,
    deps.authorizer,
    identity,
    input,
  );
  const account = await loadAccount(deps, input.value);
  return listOwnedKeys(deps, identity, ownerNamesOf(input.value, account));
}

/** The owners' keys, narrowed by the composed read scope, newest first. */
async function listOwnedKeys(
  deps: ApiKeyControllerDeps,
  identity: CallerIdentity,
  owners: ReadonlyArray<string>,
): Promise<ApiKeys> {
  let owned: ApiKey[];
  try {
    owned = await keysOwnedBy(deps.store, owners);
  } catch (error) {
    throw internalError(error, "failed to list api keys");
  }
  const visible = await restrictListByReadScope(
    deps.listReadScope,
    identity,
    ApiResourceKind.api_key,
    owned,
    "",
  );
  return create(ApiKeysSchema, { entries: [...visible] });
}
