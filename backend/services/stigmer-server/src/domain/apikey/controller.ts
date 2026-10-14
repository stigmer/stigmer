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
 *   - list returns the caller's own keys, read by owner through the
 *     key list index (list-index.ts), not every key a read scope admits:
 *     an organization's admins may view its service accounts' keys, and
 *     those are listed with listByAccount, never mixed into the admin's own.
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
  CreateServiceAccountKeyInput,
  ListApiKeysByAccountInput,
  ListApiKeysInput,
} from "@stigmer/protos/ai/stigmer/iam/apikey/v1/io_pb";
import type { IdentityAccount } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import type { UpdateApiKeyInput } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/io_pb";

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
import type { RefusedUpdatePath } from "../../pipeline/steps/update-mask.js";
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
import { runGuardedWrite } from "../../pipeline/guarded-write.js";
import { updateContext } from "../../pipeline/steps/update-input.js";
import {
  newRefuseServiceAccountCallerStep,
  refuseServiceAccountCaller,
} from "../../pipeline/steps/refuse-service-account.js";
import { newResolveSlugStep } from "../../pipeline/steps/slug.js";
import { newValidateVisibilityStep } from "../../pipeline/steps/validate-visibility.js";
import {
  decodeOrSkip,
  listPageFingerprint,
  readListPage,
} from "../../pipeline/steps/list-page.js";
import type { ListPageRequest } from "../../pipeline/steps/list-page.js";
import { newValidateProtoStep } from "../../pipeline/steps/validation.js";
import type { Store } from "../../store/interface.js";
import { serviceAccountCallerOf } from "../identityaccount/actor.js";
import { accountNotFoundMessage } from "../identityaccount/constants.js";
import type { IdentityAccountStore } from "../identityaccount/store.js";
import { apiKeyListIndex } from "./list-index.js";
import { ownerNamesOf, ownerOfKey } from "./queries.js";
import {
  newBindApiKeyOrganizationStep,
  newCheckDuplicateKeyNameStep,
  newGenerateApiKeyStep,
  newLoadByKeyHashStep,
  newPreserveKeyMaterialStep,
  newReplaceHashWithPlainTextStep,
} from "./steps.js";
import { matchesAllLabels, sortedLabels } from "../../pipeline/steps/helpers.js";

export interface ApiKeyControllerDeps {
  readonly store: Store;
  readonly logger: Logger;
  /** The composed authorization seam — the Authorize step at position 1 of every chain calls it. */
  readonly authorizer: Authorizer;
  /** The composed tuple-lifecycle driver — undefined = the shared steps no-op. */
  readonly authorizationLifecycle: ResourceAuthorizationLifecycle | undefined;
  /** The composed list read scope — list narrows through it as well as by owner. */
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
    update: (input, ctx) => update(deps, input, ctx),
    delete: (apiKeyId, ctx) => deleteApiKey(deps, apiKeyId, ctx),
  });
  router.service(ApiKeyQueryController, {
    get: (apiKeyId, ctx) => get(deps, apiKeyId, ctx),
    getByKeyHash: (apiKeyHash, ctx) => getByKeyHash(deps, apiKeyHash, ctx),
    list: (input, ctx) => list(deps, input, ctx),
    listByAccount: (input, ctx) => listByAccount(deps, input, ctx),
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
 * The API key fields an update may not name: its material and the
 * organization it is bound to, fixed when the key is minted
 * (docs/update-paths.md). Under a broader path they keep their stored
 * value, as PreserveKeyMaterial keeps them.
 */
export const API_KEY_REFUSED_UPDATE_PATHS: ReadonlyArray<RefusedUpdatePath> = [
  { path: "spec.key_hash", writtenBy: "the server, when the key is minted" },
  { path: "spec.fingerprint", writtenBy: "the server, when the key is minted" },
  { path: "spec.bound_org", writtenBy: "create" },
];

/**
 * Update — the canonical update chain plus PreserveKeyMaterial: expiry
 * fields are the only client-mutable spec surface.
 */
async function update(
  deps: ApiKeyControllerDeps,
  input: UpdateApiKeyInput,
  ctx: HandlerContext,
): Promise<ApiKey> {
  return runGuardedWrite(async () => {
    const reqCtx = updateContext(
      ApiKeySchema,
      input,
      callerIdentityOf(ctx),
      kindOf(ctx),
    );
    await newPipeline<typeof ApiKeySchema>("apikey-update", deps.logger)
      .addStep(
        newAuthorizeStep(ApiKeyCommandController.method.update, deps.authorizer,
        input,
      ),
      )
      .addStep(newRefuseServiceAccountCallerStep(UPDATE_KEY_ACT, deps.accounts))
      .addStep(newResolveSlugStep({ update: true }))
      .addStep(newLoadExistingStep(deps.store))
      .addStep(newBuildUpdateStateStep({ refused: API_KEY_REFUSED_UPDATE_PATHS }))
      .addStep(newValidateProtoStep({ of: "state" }))
      .addStep(newPreserveKeyMaterialStep())
      .addStep(newPersistStep(deps.store))
      .build()
      .execute(reqCtx);
    return reqCtx.newState;
  });
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
 * List — the caller's own keys: those whose creator stamp is the
 * caller's account id, or, for a direct account, the issuer subject a key
 * minted before the account existed carries (queries.ts `ownerNamesOf`),
 * newest first. An unprovisioned caller's identity is its subject already. A composed
 * ListReadScope still narrows the answer, so a list is never wider than
 * the keys the caller may view. Stored hashes ride the response exactly
 * as the cloud's do — the plaintext exists nowhere. Newest first, as
 * PlatformClient's list answers, so a list does not reorder as keys
 * are used (stigmer/stigmer#1255).
 */
async function list(
  deps: ApiKeyControllerDeps,
  input: ListApiKeysInput,
  ctx: HandlerContext,
): Promise<ApiKeys> {
  const identity = callerIdentityOf(ctx);
  const reqCtx = new RequestContext(
    ApiKeyQueryController.method.list.input,
    input,
    identity,
    kindOf(ctx),
  );
  await newPipeline<typeof ApiKeyQueryController.method.list.input>(
    "apikey-list",
    deps.logger,
  )
    .addStep(
      newAuthorizeStep(ApiKeyQueryController.method.list, deps.authorizer),
    )
    .addStep(newValidateProtoStep())
    .build()
    .execute(reqCtx);
  let account: IdentityAccount | undefined;
  try {
    account = await deps.accounts.findById(identity.identityId);
  } catch (error) {
    throw internalError(error, "failed to load identity account");
  }
  return readOwnedKeysPage(
    deps,
    identity,
    ownerNamesOf(identity.identityId, account),
    input,
    listPageFingerprint({ labels: sortedLabels(input.labels) }),
  );
}

/**
 * ListByAccount — the keys that speak for an account, for whoever may view
 * it: the person, or a service account's organization admins. Authorized
 * on the account by its annotation, then read by owner, the account's id
 * and its subject alike.
 */
async function listByAccount(
  deps: ApiKeyControllerDeps,
  input: ListApiKeysByAccountInput,
  ctx: HandlerContext,
): Promise<ApiKeys> {
  const identity = callerIdentityOf(ctx);
  await authorizeDirect(
    ApiKeyQueryController.method.listByAccount,
    deps.authorizer,
    identity,
    input,
  );
  const account = await loadAccount(deps, input.accountId);
  return readOwnedKeysPage(
    deps,
    identity,
    ownerNamesOf(input.accountId, account),
    input,
    listPageFingerprint({
      accountId: input.accountId,
      labels: sortedLabels(input.labels),
    }),
  );
}

/**
 * One page of the owners' keys, newest first, through the owner index:
 * a row is kept only when its decoded stamp is one of the owners (an
 * unproven row the store re-derived never smuggles in another owner's
 * key), then narrowed by the composed read scope.
 */
async function readOwnedKeysPage(
  deps: ApiKeyControllerDeps,
  identity: CallerIdentity,
  owners: ReadonlyArray<string>,
  request: ListPageRequest & { readonly labels: Readonly<Record<string, string>> },
  fingerprint: string,
): Promise<ApiKeys> {
  const names = [...new Set(owners.filter((owner) => owner !== ""))];
  if (names.length === 0) {
    return create(ApiKeysSchema, { entries: [], nextPageToken: "" });
  }
  const page = await readListPage({
    store: deps.store,
    declaration: apiKeyListIndex,
    query: { anyKey: names.map((value) => ({ name: "owner" as const, value })) },
    request: { pageSize: request.pageSize, pageToken: request.pageToken },
    fingerprint,
    decode: decodeApiKey,
    keep: (key) =>
      names.includes(ownerOfKey(key)) &&
      matchesAllLabels(key.metadata?.labels ?? {}, request.labels),
    scope: (rows) =>
      restrictListByReadScope(
        deps.listReadScope,
        identity,
        ApiResourceKind.api_key,
        rows,
        "",
      ),
    failure: "failed to list api keys",
  });
  return create(ApiKeysSchema, {
    entries: page.entries,
    nextPageToken: page.nextPageToken,
  });
}

/** A stored key, or undefined (skipped) when its bytes do not decode. */
const decodeApiKey = decodeOrSkip(ApiKeySchema);
