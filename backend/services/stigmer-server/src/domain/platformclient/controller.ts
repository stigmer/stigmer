/**
 * PlatformClient controller — the command and query sides, served by open
 * source in every edition (the token side is token-controller.ts). A
 * PlatformClient is an organization's inbound credential pair: its backend
 * presents client_id + client_secret to mint short-lived user tokens for
 * its own product's users (mint.ts). The inbound counterpart to OAuthApp,
 * whose controller this one follows chain for chain.
 *
 * Every chain opens with Authorize and runs over the PlatformClientStore
 * port (store.ts), so the cloud serves these same chains over its own
 * table. What the domain adds to the OAuthApp shape:
 *   - the credential steps: generated on create and shown once in
 *     PlatformClientCreateResponse, kept from the row on update, replaced
 *     by rotateSecret (the client_id is permanent);
 *   - `system-share-client` refused on create, and the platform's
 *     system-managed clients refused on update, delete and rotate;
 *   - the stored hash cleared on EVERY response, deletes and rotations
 *     included — the model promises it is never returned
 *     (fga/model/iam/platform_client.fga), and no reader needs it;
 *   - getByReference loads, then authorizes the loaded client exactly as
 *     `get` would (AuthorizeResolvedTarget), and listByOrg narrows through
 *     the list read scope, so a member who may not `get` a client does not
 *     see it listed either: the model gives organization members no access
 *     to a credential.
 *
 * There is no apply and no updateVisibility: clients are created through
 * the console or the API and are always organization-private.
 *
 * Proven by platformclient.conformance.test.ts (local targets and the
 * cloud) and __tests__/controller.test.ts.
 */
import type { ConnectRouter, HandlerContext } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type {
  ApiResourceDeleteInput,
  ApiResourceId,
  ApiResourceReference,
} from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { PlatformClientSchema } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/api_pb";
import type { PlatformClient } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/api_pb";
import { PlatformClientCommandController } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/command_pb";
import {
  PlatformClientCreateResponseSchema,
  PlatformClientsSchema,
} from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/io_pb";
import type {
  ListPlatformClientsByOrgInput,
  PlatformClientCreateResponse,
  PlatformClientId,
  PlatformClients,
} from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/io_pb";
import { PlatformClientQueryController } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/query_pb";

import type { Logger } from "../../boot/logger.js";
import type { Authorizer } from "../../extensions/authorizer.js";
import type { ListReadScope } from "../../extensions/list-read-scope.js";
import { restrictListByReadScope } from "../../extensions/list-read-scope.js";
import type { ResourceAuthorizationLifecycle } from "../../extensions/resource-authorization.js";
import { internalError } from "../../pipeline/errors.js";
import { apiResourceKindKey } from "../../pipeline/interceptors/apiresource.js";
import { callerIdentityOf } from "../../pipeline/interceptors/auth.js";
import { newPipeline } from "../../pipeline/pipeline.js";
import { RequestContext } from "../../pipeline/request-context.js";
import { newAuthorizeStep } from "../../pipeline/steps/authorize.js";
import {
  loadedTargetAsMethod,
  newAuthorizeResolvedTargetStep,
} from "../../pipeline/steps/authorize-resolved-target.js";
import {
  newCleanupIamPoliciesStep,
  newCreateAuthorizationTuplesStep,
} from "../../pipeline/steps/authorization-tuples.js";
import { newBuildUpdateStateStep } from "../../pipeline/steps/build-update-state.js";
import { newBuildNewStateStep } from "../../pipeline/steps/defaults.js";
import { RESOURCE_ID_KEY } from "../../pipeline/steps/delete.js";
import { newGuardReservedLabelsStep } from "../../pipeline/steps/guard-reserved-labels.js";
import { compareCreatedAtDesc } from "../../pipeline/steps/helpers.js";
import { EXISTING_RESOURCE_KEY } from "../../pipeline/steps/load-existing.js";
import { TARGET_RESOURCE_KEY } from "../../pipeline/steps/load-target.js";
import { newResolveSlugStep } from "../../pipeline/steps/slug.js";
import { newValidateVisibilityStep } from "../../pipeline/steps/validate-visibility.js";
import { newValidateProtoStep } from "../../pipeline/steps/validation.js";
import {
  newCheckDuplicateStep,
  newDeleteClientStep,
  newGenerateClientCredentialsStep,
  newLoadClientByReferenceStep,
  newLoadExistingClientForDeleteStep,
  newLoadExistingClientStep,
  newLoadTargetClientStep,
  newPersistNewClientStep,
  newPersistTargetClientStep,
  newPersistUpdatedClientStep,
  newPreserveClientCredentialsStep,
  newRefuseReservedSlugStep,
  newRefuseSystemManagedStep,
  newRotateClientCredentialsStep,
  parkedClientSecret,
  redactPlatformClient,
  storedClientOf,
} from "./steps.js";
import type { PlatformClientStore } from "./store.js";

export interface PlatformClientControllerDeps {
  /** The composed store — a driver's, or the OSS adapter over the generic Store. */
  readonly clients: PlatformClientStore;
  readonly logger: Logger;
  /** The composed authorization seam — the Authorize step at position 1 of every chain calls it. */
  readonly authorizer: Authorizer;
  /** The composed tuple-lifecycle driver — undefined = the shared steps no-op. */
  readonly authorizationLifecycle: ResourceAuthorizationLifecycle | undefined;
  /** The composed list read scope — listByOrg narrows through it; undefined = every client of the org. */
  readonly listReadScope: ListReadScope | undefined;
}

/** Registers the command and query services on the router (routes stage). */
export function registerPlatformClientServices(
  router: ConnectRouter,
  deps: PlatformClientControllerDeps,
): void {
  router.service(PlatformClientCommandController, {
    create: (client, ctx) => createClient(deps, client, ctx),
    update: (client, ctx) => updateClient(deps, client, ctx),
    delete: (input, ctx) => deleteClient(deps, input, ctx),
    rotateSecret: (id, ctx) => rotateSecret(deps, id, ctx),
  });
  router.service(PlatformClientQueryController, {
    get: (id, ctx) => get(deps, id, ctx),
    getByReference: (ref, ctx) => getByReference(deps, ref, ctx),
    listByOrg: (input, ctx) => listByOrg(deps, input, ctx),
  });
}

function kindOf(ctx: HandlerContext): ApiResourceKind {
  return ctx.values.get(apiResourceKindKey);
}

/**
 * Create — OAuthApp's chain with the reserved-slug refusal after the slug
 * resolves and the credentials generated after BuildNewState; the
 * response carries the redacted client and the one look at its secret.
 */
async function createClient(
  deps: PlatformClientControllerDeps,
  client: PlatformClient,
  ctx: HandlerContext,
): Promise<PlatformClientCreateResponse> {
  const reqCtx = new RequestContext(
    PlatformClientSchema,
    client,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof PlatformClientSchema>("platformclient-create", deps.logger)
    .addStep(
      newAuthorizeStep(PlatformClientCommandController.method.create, deps.authorizer),
    )
    .addStep(newResolveSlugStep())
    .addStep(newValidateProtoStep())
    .addStep(newValidateVisibilityStep())
    .addStep(newRefuseReservedSlugStep())
    .addStep(newCheckDuplicateStep(deps.clients))
    .addStep(newBuildNewStateStep())
    .addStep(newGuardReservedLabelsStep(deps.authorizer))
    .addStep(newGenerateClientCredentialsStep())
    .addStep(newPersistNewClientStep(deps.clients))
    .addStep(
      newCreateAuthorizationTuplesStep(deps.authorizationLifecycle, deps.logger),
    )
    .build()
    .execute(reqCtx);
  return create(PlatformClientCreateResponseSchema, {
    platformClient: redactPlatformClient(reqCtx.newState),
    clientSecret: parkedClientSecret(reqCtx),
  });
}

/**
 * Update — full spec replacement from the request (BuildUpdateState),
 * addressed by id or org-scoped slug; the platform's own clients refused
 * before any state is built; the credential fields kept from the row.
 */
async function updateClient(
  deps: PlatformClientControllerDeps,
  client: PlatformClient,
  ctx: HandlerContext,
): Promise<PlatformClient> {
  const reqCtx = new RequestContext(
    PlatformClientSchema,
    client,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof PlatformClientSchema>("platformclient-update", deps.logger)
    .addStep(
      newAuthorizeStep(PlatformClientCommandController.method.update, deps.authorizer),
    )
    .addStep(newValidateProtoStep())
    .addStep(newResolveSlugStep())
    .addStep(newLoadExistingClientStep(deps.clients))
    .addStep(
      newRefuseSystemManagedStep<typeof PlatformClientSchema>(
        "updated",
        EXISTING_RESOURCE_KEY,
      ),
    )
    .addStep(newBuildUpdateStateStep())
    .addStep(newGuardReservedLabelsStep(deps.authorizer))
    .addStep(newPreserveClientCredentialsStep())
    .addStep(newPersistUpdatedClientStep(deps.clients))
    .build()
    .execute(reqCtx);
  return redactPlatformClient(reqCtx.newState);
}

/**
 * Delete — the platform's own clients refused before the delete; the
 * client's policies cleaned up after. The client's outstanding tokens stop
 * at their next request (the verifier's liveness read); the end-user
 * accounts it provisioned stay, because an account belongs to the
 * organization, not to one of its clients.
 */
async function deleteClient(
  deps: PlatformClientControllerDeps,
  input: ApiResourceDeleteInput,
  ctx: HandlerContext,
): Promise<PlatformClient> {
  type DeleteInput = typeof PlatformClientCommandController.method.delete.input;
  const reqCtx = new RequestContext(
    PlatformClientCommandController.method.delete.input,
    input,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  // ApiResourceDeleteInput carries resource_id, not the `value` field
  // ExtractResourceId reads (OAuthApp's pattern).
  reqCtx.set(RESOURCE_ID_KEY, input.resourceId);
  await newPipeline<DeleteInput>("platformclient-delete", deps.logger)
    .addStep(
      newAuthorizeStep(PlatformClientCommandController.method.delete, deps.authorizer),
    )
    .addStep(newValidateProtoStep())
    .addStep(newLoadExistingClientForDeleteStep<DeleteInput>(deps.clients))
    .addStep(
      newRefuseSystemManagedStep<DeleteInput>("deleted", EXISTING_RESOURCE_KEY),
    )
    .addStep(newDeleteClientStep<DeleteInput>(deps.clients))
    .addStep(newCleanupIamPoliciesStep(deps.authorizationLifecycle, deps.logger))
    .build()
    .execute(reqCtx);
  return redactPlatformClient(storedClientOf(reqCtx, EXISTING_RESOURCE_KEY));
}

/**
 * RotateSecret — a new secret for the loaded client (the client_id stays),
 * shown once in the response. Tokens already minted stay valid until they
 * expire; deleting the client is what revokes them.
 */
async function rotateSecret(
  deps: PlatformClientControllerDeps,
  id: PlatformClientId,
  ctx: HandlerContext,
): Promise<PlatformClientCreateResponse> {
  type RotateInput = typeof PlatformClientCommandController.method.rotateSecret.input;
  const reqCtx = new RequestContext(
    PlatformClientCommandController.method.rotateSecret.input,
    id,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<RotateInput>("platformclient-rotate-secret", deps.logger)
    .addStep(
      newAuthorizeStep(
        PlatformClientCommandController.method.rotateSecret,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    .addStep(newLoadTargetClientStep<RotateInput>(deps.clients))
    .addStep(newRefuseSystemManagedStep<RotateInput>("rotated", TARGET_RESOURCE_KEY))
    .addStep(newRotateClientCredentialsStep<RotateInput>())
    .addStep(newPersistTargetClientStep<RotateInput>(deps.clients))
    .build()
    .execute(reqCtx);
  return create(PlatformClientCreateResponseSchema, {
    platformClient: redactPlatformClient(storedClientOf(reqCtx, TARGET_RESOURCE_KEY)),
    clientSecret: parkedClientSecret(reqCtx),
  });
}

async function get(
  deps: PlatformClientControllerDeps,
  id: ApiResourceId,
  ctx: HandlerContext,
): Promise<PlatformClient> {
  type GetInput = typeof PlatformClientQueryController.method.get.input;
  const reqCtx = new RequestContext(
    PlatformClientQueryController.method.get.input,
    id,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<GetInput>("platformclient-get", deps.logger)
    .addStep(newAuthorizeStep(PlatformClientQueryController.method.get, deps.authorizer))
    .addStep(newValidateProtoStep())
    .addStep(newLoadTargetClientStep<GetInput>(deps.clients))
    .build()
    .execute(reqCtx);
  return redactPlatformClient(storedClientOf(reqCtx, TARGET_RESOURCE_KEY));
}

/** GetByReference — load by org/slug, then authorize the loaded client as `get` would. */
async function getByReference(
  deps: PlatformClientControllerDeps,
  ref: ApiResourceReference,
  ctx: HandlerContext,
): Promise<PlatformClient> {
  const reqCtx = new RequestContext(
    PlatformClientQueryController.method.getByReference.input,
    ref,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof PlatformClientQueryController.method.getByReference.input>(
    "platformclient-get-by-reference",
    deps.logger,
  )
    .addStep(
      newAuthorizeStep(
        PlatformClientQueryController.method.getByReference,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    .addStep(newLoadClientByReferenceStep(deps.clients))
    .addStep(
      newAuthorizeResolvedTargetStep(
        deps.authorizer,
        loadedTargetAsMethod(PlatformClientQueryController.method.get),
      ),
    )
    .build()
    .execute(reqCtx);
  return redactPlatformClient(storedClientOf(reqCtx, TARGET_RESOURCE_KEY));
}

/**
 * ListByOrg — the organization's clients the caller may view, newest
 * first, each redacted. The annotation admits anyone who can view the
 * organization; the list read scope then keeps only the clients a `get`
 * would return.
 */
async function listByOrg(
  deps: PlatformClientControllerDeps,
  input: ListPlatformClientsByOrgInput,
  ctx: HandlerContext,
): Promise<PlatformClients> {
  const caller = callerIdentityOf(ctx);
  const reqCtx = new RequestContext(
    PlatformClientQueryController.method.listByOrg.input,
    input,
    caller,
    kindOf(ctx),
  );
  await newPipeline<typeof PlatformClientQueryController.method.listByOrg.input>(
    "platformclient-list-by-org",
    deps.logger,
  )
    .addStep(
      newAuthorizeStep(PlatformClientQueryController.method.listByOrg, deps.authorizer),
    )
    .addStep(newValidateProtoStep())
    .build()
    .execute(reqCtx);

  let candidates: ReadonlyArray<PlatformClient>;
  try {
    candidates = await deps.clients.findByOrg(input.org);
  } catch (error) {
    throw internalError(error, "failed to list platform clients");
  }
  const visible = await restrictListByReadScope(
    deps.listReadScope,
    caller,
    ApiResourceKind.platform_client,
    candidates,
    input.org,
  );
  const entries = [...visible]
    .sort((a, b) =>
      compareCreatedAtDesc(
        a.status?.audit?.specAudit?.createdAt,
        b.status?.audit?.specAudit?.createdAt,
      ),
    )
    .map(redactPlatformClient);
  return create(PlatformClientsSchema, { entries });
}
