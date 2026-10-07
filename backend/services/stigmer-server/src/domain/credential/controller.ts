/**
 * Credential controller — the command and query sides of the Credential
 * kind: a saved set of secret values that belongs to a person or to the
 * organization. Secret field values rest encrypted, leave the server as
 * the redaction marker, and are revealed only through revealField, one
 * field of a person's own credential at a time; an organization's
 * credential is write-only.
 *
 * Every chain opens with Authorize. Create is is_skip_authorization and
 * asks its permission after resolving the owner (ResolveCredentialOwner,
 * the share-create shape); delete runs the shared tuple cleanup, create
 * the shared tuple lifecycle, whose optional parent links write `owner` or
 * `org_owned` from the spec (fga/model/agentic/credential.fga).
 * getByReference loads, then authorizes the loaded credential exactly as
 * `get` would; list narrows through the composed list read scope. There is
 * no apply and no visibility: a secret never belongs in a manifest, and
 * who may use an organization's credential is a grant, never an audience.
 *
 * Proven by __tests__/credential.test.ts, __tests__/store-faults.test.ts
 * and credential.conformance.test.ts (CONFORMANCE_TARGET=local). Per-RPC
 * posture: docs/authorization-coverage.md.
 */
import type { ConnectRouter, HandlerContext } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { CredentialCommandController } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/command_pb";
import { CredentialQueryController } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/query_pb";
import { CredentialSchema } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/api_pb";
import type { Credential } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/api_pb";
import { CredentialListSchema } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/io_pb";
import type {
  CredentialList,
  ListCredentialsInput,
  RemoveCredentialFieldsInput,
  RevealCredentialFieldInput,
  SetCredentialFieldsInput,
} from "@stigmer/protos/ai/stigmer/agentic/credential/v1/io_pb";
import type { CredentialField } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/spec_pb";
import type {
  ApiResourceDeleteInput,
  ApiResourceId,
  ApiResourceReference,
} from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../../boot/logger.js";
import type { Authorizer } from "../../extensions/authorizer.js";
import { isServerComposedRequest } from "../../extensions/identity.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import type { ListReadScope } from "../../extensions/list-read-scope.js";
import { restrictListByReadScope } from "../../extensions/list-read-scope.js";
import type { ResourceAuthorizationLifecycle } from "../../extensions/resource-authorization.js";
import type { SecretService } from "../../encryption/encryption.js";
import { apiResourceKindKey } from "../../pipeline/interceptors/apiresource.js";
import { internalError } from "../../pipeline/errors.js";
import { newPipeline } from "../../pipeline/pipeline.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import { callerIdentityOf } from "../../pipeline/interceptors/auth.js";
import { RequestContext } from "../../pipeline/request-context.js";
import { newAuthorizeStep } from "../../pipeline/steps/authorize.js";
import {
  loadedTargetAsMethod,
  newAuthorizeResolvedTargetStep,
} from "../../pipeline/steps/authorize-resolved-target.js";
import { newGuardReservedLabelsStep } from "../../pipeline/steps/guard-reserved-labels.js";
import { newBuildNewStateStep } from "../../pipeline/steps/defaults.js";
import { newBuildUpdateStateStep } from "../../pipeline/steps/build-update-state.js";
import { newCheckDuplicateStep } from "../../pipeline/steps/duplicate.js";
import {
  RESOURCE_ID_KEY,
  newDeleteResourceStep,
  newLoadExistingForDeleteStep,
} from "../../pipeline/steps/delete.js";
import { compareCreatedAtDesc } from "../../pipeline/steps/helpers.js";
import {
  EXISTING_RESOURCE_KEY,
  newLoadExistingStep,
} from "../../pipeline/steps/load-existing.js";
import { newLoadByReferenceStep } from "../../pipeline/steps/load-by-reference.js";
import {
  TARGET_RESOURCE_KEY,
  newLoadTargetStep,
} from "../../pipeline/steps/load-target.js";
import {
  newNormalizeReferencesStep,
  newValidateReferencesStep,
} from "../../pipeline/steps/references.js";
import {
  newCleanupIamPoliciesStep,
  newCreateAuthorizationTuplesStep,
} from "../../pipeline/steps/authorization-tuples.js";
import { newPersistStep } from "../../pipeline/steps/persist.js";
import { newDestroySecretBackingStateStep } from "../../pipeline/steps/secret-cleanup.js";
import { newResolveSlugStep } from "../../pipeline/steps/slug.js";
import { newValidateProtoStep } from "../../pipeline/steps/validation.js";
import { newValidateVisibilityStep } from "../../pipeline/steps/validate-visibility.js";
import type { Store } from "../../store/interface.js";
import { redactCredentialSecrets } from "./redact.js";
import { newEndSignInWithCredentialStep } from "./sign-in.js";
import {
  REVEALED_FIELD_KEY,
  UPDATED_CREDENTIAL_KEY,
  newDestroyDroppedSecretsStep,
  newEncryptSecretValuesStep,
  newEnforceOneDefaultPerTargetStep,
  newGuardCredentialOwnerFixedStep,
  newGuardSignInFieldsStep,
  newLoadCredentialByIdStep,
  newMintCredentialSlugStep,
  newPreserveRedactedSecretsStep,
  newRemoveFieldsAndPersistStep,
  newResolveCredentialOwnerStep,
  newRevealFieldStep,
  newSetFieldsAndPersistStep,
  newStampCredentialSourceStep,
  ownerOf,
  secretValuesOfCredential,
} from "./steps.js";
import { credentialsOfOrg } from "./values.js";

export interface CredentialControllerDeps {
  readonly store: Store;
  readonly logger: Logger;
  /** The composed authorization seam — the Authorize step at position 1 of every chain calls it. */
  readonly authorizer: Authorizer;
  /** The composed tuple-lifecycle driver — undefined = the shared steps no-op. */
  readonly authorizationLifecycle: ResourceAuthorizationLifecycle | undefined;
  readonly secretService: SecretService;
  /** The composed list read scope — list narrows through it; undefined = the OSS full scan. */
  readonly listReadScope: ListReadScope | undefined;
}

/** Registers both credential services on the router (routes stage). */
export function registerCredentialServices(
  router: ConnectRouter,
  deps: CredentialControllerDeps,
): void {
  router.service(CredentialCommandController, {
    create: (credential, ctx) => createCredential(deps, credential, ctx),
    update: (credential, ctx) => update(deps, credential, ctx),
    delete: (input, ctx) => deleteCredential(deps, input, ctx),
    setFields: (input, ctx) => setFields(deps, input, ctx),
    removeFields: (input, ctx) => removeFields(deps, input, ctx),
  });
  router.service(CredentialQueryController, {
    get: (id, ctx) => get(deps, id, ctx),
    getByReference: (ref, ctx) => getByReference(deps, ref, ctx),
    revealField: (input, ctx) => revealField(deps, input, ctx),
    list: (input, ctx) => list(deps, input, ctx),
  });
}

function kindOf(ctx: HandlerContext): ApiResourceKind {
  return ctx.values.get(apiResourceKindKey);
}

/**
 * Create — the owner first (it decides the permission), then the shared
 * chain. Redaction runs after Persist: the store keeps ciphertext, the
 * response carries markers.
 */
async function createCredential(
  deps: CredentialControllerDeps,
  credential: Credential,
  ctx: HandlerContext,
): Promise<Credential> {
  const reqCtx = new RequestContext(
    CredentialSchema,
    credential,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof CredentialSchema>("credential-create", deps.logger)
    .addStep(
      newAuthorizeStep(CredentialCommandController.method.create, deps.authorizer),
    )
    .addStep(newValidateProtoStep())
    .addStep(newValidateVisibilityStep())
    .addStep(newMintCredentialSlugStep())
    .addStep(newResolveSlugStep())
    .addStep(newCheckDuplicateStep(deps.store))
    .addStep(newBuildNewStateStep())
    .addStep(newResolveCredentialOwnerStep(deps.authorizer))
    .addStep(newStampCredentialSourceStep())
    .addStep(newGuardReservedLabelsStep(deps.authorizer))
    .addStep(newPreserveRedactedSecretsStep())
    .addStep(newEncryptSecretValuesStep(deps.secretService, deps.logger))
    .addStep(newNormalizeReferencesStep())
    .addStep(newValidateReferencesStep(deps.store, deps.authorizer))
    .addStep(newEnforceOneDefaultPerTargetStep(deps.store))
    .addStep(newPersistStep(deps.store))
    .addStep(
      newCreateAuthorizationTuplesStep(deps.authorizationLifecycle, deps.logger),
    )
    .build()
    .execute(reqCtx);
  redactCredentialSecrets(reqCtx.newState);
  return reqCtx.newState;
}

/** Update — the owner and a sign-in's fields are fixed; redact after persist. */
async function update(
  deps: CredentialControllerDeps,
  credential: Credential,
  ctx: HandlerContext,
): Promise<Credential> {
  const reqCtx = new RequestContext(
    CredentialSchema,
    credential,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof CredentialSchema>("credential-update", deps.logger)
    .addStep(
      newAuthorizeStep(CredentialCommandController.method.update, deps.authorizer),
    )
    .addStep(newValidateProtoStep())
    .addStep(newResolveSlugStep({ update: true }))
    .addStep(newLoadExistingStep(deps.store))
    .addStep(newBuildUpdateStateStep())
    .addStep(newGuardCredentialOwnerFixedStep())
    .addStep(newGuardReservedLabelsStep(deps.authorizer))
    .addStep(newGuardSignInFieldsStep())
    .addStep(newPreserveRedactedSecretsStep())
    .addStep(newEncryptSecretValuesStep(deps.secretService, deps.logger))
    .addStep(newNormalizeReferencesStep())
    .addStep(newValidateReferencesStep(deps.store, deps.authorizer))
    .addStep(newEnforceOneDefaultPerTargetStep(deps.store))
    .addStep(newPersistStep(deps.store))
    .addStep(newDestroyDroppedSecretsStep(deps.secretService, deps.logger))
    .build()
    .execute(reqCtx);
  redactCredentialSecrets(reqCtx.newState);
  return reqCtx.newState;
}

/**
 * Delete — returns the deleted credential redacted. A sign-in's grant
 * (and the refresh token sealed on it) goes with its credential, so the
 * refresh lane never writes to a credential that is gone.
 */
async function deleteCredential(
  deps: CredentialControllerDeps,
  input: ApiResourceDeleteInput,
  ctx: HandlerContext,
): Promise<Credential> {
  const reqCtx = new RequestContext(
    CredentialCommandController.method.delete.input,
    input,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  reqCtx.set(RESOURCE_ID_KEY, input.resourceId);
  await newPipeline<typeof CredentialCommandController.method.delete.input>(
    "credential-delete",
    deps.logger,
  )
    .addStep(
      newAuthorizeStep(CredentialCommandController.method.delete, deps.authorizer),
    )
    .addStep(newValidateProtoStep())
    .addStep(newLoadExistingForDeleteStep(deps.store, CredentialSchema))
    .addStep(newDeleteResourceStep(deps.store))
    .addStep(newCleanupIamPoliciesStep(deps.authorizationLifecycle, deps.logger))
    .addStep(
      newDestroySecretBackingStateStep<
        typeof CredentialCommandController.method.delete.input,
        typeof CredentialSchema
      >(deps.secretService, deps.logger, secretValuesOfCredential),
    )
    .addStep(newEndSignInWithCredentialStep(deps.store, deps.logger))
    .build()
    .execute(reqCtx);

  // LoadExistingForDelete put the row on the context, or the chain threw.
  const credential = reqCtx.get(EXISTING_RESOURCE_KEY) as Credential;
  redactCredentialSecrets(credential);
  return credential;
}

/** SetFields — server-side merge: named fields are added or replaced, the rest kept. */
async function setFields(
  deps: CredentialControllerDeps,
  input: SetCredentialFieldsInput,
  ctx: HandlerContext,
): Promise<Credential> {
  const reqCtx = new RequestContext(
    CredentialCommandController.method.setFields.input,
    input,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof CredentialCommandController.method.setFields.input>(
    "credential-set-fields",
    deps.logger,
  )
    .addStep(
      newAuthorizeStep(CredentialCommandController.method.setFields, deps.authorizer),
    )
    .addStep(newValidateProtoStep())
    .addStep(newLoadCredentialByIdStep(deps.store))
    .addStep(
      newSetFieldsAndPersistStep(deps.store, deps.secretService, deps.logger),
    )
    .build()
    .execute(reqCtx);
  const updated = reqCtx.get(UPDATED_CREDENTIAL_KEY) as Credential;
  redactCredentialSecrets(updated);
  return updated;
}

/** RemoveFields — named fields deleted; unknown names ignored. */
async function removeFields(
  deps: CredentialControllerDeps,
  input: RemoveCredentialFieldsInput,
  ctx: HandlerContext,
): Promise<Credential> {
  const reqCtx = new RequestContext(
    CredentialCommandController.method.removeFields.input,
    input,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof CredentialCommandController.method.removeFields.input>(
    "credential-remove-fields",
    deps.logger,
  )
    .addStep(
      newAuthorizeStep(
        CredentialCommandController.method.removeFields,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    .addStep(newLoadCredentialByIdStep(deps.store))
    .addStep(
      newRemoveFieldsAndPersistStep(deps.store, deps.secretService, deps.logger),
    )
    .build()
    .execute(reqCtx);
  const updated = reqCtx.get(UPDATED_CREDENTIAL_KEY) as Credential;
  redactCredentialSecrets(updated);
  return updated;
}

/** Get — by id, redacted. */
async function get(
  deps: CredentialControllerDeps,
  id: ApiResourceId,
  ctx: HandlerContext,
): Promise<Credential> {
  const reqCtx = new RequestContext(
    CredentialQueryController.method.get.input,
    id,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof CredentialQueryController.method.get.input>(
    "credential-get",
    deps.logger,
  )
    .addStep(newAuthorizeStep(CredentialQueryController.method.get, deps.authorizer))
    .addStep(newValidateProtoStep())
    .addStep(newLoadTargetStep(deps.store, CredentialSchema))
    .build()
    .execute(reqCtx);
  const credential = reqCtx.get(TARGET_RESOURCE_KEY) as Credential;
  redactCredentialSecrets(credential);
  return credential;
}

/** GetByReference — org/slug lookup, authorized as `get`, redacted. */
async function getByReference(
  deps: CredentialControllerDeps,
  ref: ApiResourceReference,
  ctx: HandlerContext,
): Promise<Credential> {
  const reqCtx = new RequestContext(
    CredentialQueryController.method.getByReference.input,
    ref,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof CredentialQueryController.method.getByReference.input>(
    "credential-get-by-reference",
    deps.logger,
  )
    .addStep(
      newAuthorizeStep(
        CredentialQueryController.method.getByReference,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    .addStep(newLoadByReferenceStep(deps.store, CredentialSchema))
    .addStep(
      newAuthorizeResolvedTargetStep(
        deps.authorizer,
        loadedTargetAsMethod(CredentialQueryController.method.get),
      ),
    )
    .build()
    .execute(reqCtx);
  const credential = reqCtx.get(TARGET_RESOURCE_KEY) as Credential;
  redactCredentialSecrets(credential);
  return credential;
}

/** RevealField — the one unredacted read: one field of your own credential. */
async function revealField(
  deps: CredentialControllerDeps,
  input: RevealCredentialFieldInput,
  ctx: HandlerContext,
): Promise<CredentialField> {
  const reqCtx = new RequestContext(
    CredentialQueryController.method.revealField.input,
    input,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof CredentialQueryController.method.revealField.input>(
    "credential-reveal-field",
    deps.logger,
  )
    .addStep(
      newAuthorizeStep(CredentialQueryController.method.revealField, deps.authorizer),
    )
    .addStep(newValidateProtoStep())
    .addStep(newLoadCredentialByIdStep(deps.store))
    .addStep(newRevealFieldStep(deps.secretService, deps.logger))
    .build()
    .execute(reqCtx);
  return reqCtx.get(REVEALED_FIELD_KEY) as CredentialField;
}

const LIST_RESULT_KEY = "listResult";

/**
 * List — the organization's credentials the caller may see, redacted,
 * newest first. Unpaginated: an organization holds few.
 */
async function list(
  deps: CredentialControllerDeps,
  input: ListCredentialsInput,
  ctx: HandlerContext,
): Promise<CredentialList> {
  const reqCtx = new RequestContext(
    CredentialQueryController.method.list.input,
    input,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof CredentialQueryController.method.list.input>(
    "credential-list",
    deps.logger,
  )
    .addStep(newAuthorizeStep(CredentialQueryController.method.list, deps.authorizer))
    .addStep(newValidateProtoStep())
    .addStep(newListCredentialsStep(deps.store, deps.listReadScope))
    .build()
    .execute(reqCtx);
  // ListCredentials sets the page, or the chain threw.
  return reqCtx.get(LIST_RESULT_KEY) as CredentialList;
}

/**
 * Whether `credential` may be listed to `caller` before the read scope
 * asks: a person's credential is listed to that person alone, in every
 * edition, the read scope composed or not — nobody lists another person's
 * credentials, an open-source server without authorization included. The
 * server's own requests list everything.
 */
function listableTo(caller: CallerIdentity, credential: Credential): boolean {
  const owner = ownerOf(credential);
  return (
    owner?.kind !== "person" ||
    owner.person === caller.identityId ||
    isServerComposedRequest(caller)
  );
}

/**
 * ListCredentials — the organization's rows through the credential list
 * index, a person's own credentials kept for that person alone, then the
 * read scope (the last per-row predicate): your own, the organization's
 * you may use, and every one of the organization's for an admin.
 */
function newListCredentialsStep(
  store: Store,
  listReadScope: ListReadScope | undefined,
): PipelineStep<typeof CredentialQueryController.method.list.input> {
  return {
    name: "ListCredentials",
    async execute(
      ctx: RequestContext<typeof CredentialQueryController.method.list.input>,
    ): Promise<void> {
      let rows: Credential[];
      try {
        rows = await credentialsOfOrg(store, ctx.input.org);
      } catch (error) {
        throw internalError(error, "failed to list credentials");
      }
      const requested = rows.filter((credential) =>
        listableTo(ctx.callerIdentity, credential),
      );
      const credentials = await restrictListByReadScope(
        listReadScope,
        ctx.callerIdentity,
        ApiResourceKind.credential,
        requested,
        "",
      );
      for (const credential of credentials) {
        redactCredentialSecrets(credential);
      }
      credentials.sort((a, b) =>
        compareCreatedAtDesc(
          a.status?.audit?.specAudit?.createdAt,
          b.status?.audit?.specAudit?.createdAt,
        ),
      );
      ctx.set(
        LIST_RESULT_KEY,
        create(CredentialListSchema, {
          totalCount: credentials.length,
          items: credentials,
        }),
      );
    },
  };
}
