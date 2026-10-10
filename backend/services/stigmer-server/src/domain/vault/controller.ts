/**
 * The vault controller: both vault services on the router.
 *
 * A vault holds logins (by a tool's address) and secrets (by name) that
 * runs use. Values are write-only for everyone: every response passes
 * through `redactVault`, and no RPC returns a value. The chains follow the
 * Environment kind's they replace, reshaped:
 *
 *   - create makes a shared vault, owned by its organization, empty; My
 *     vault is created by the vault service on its person's first entry
 *     write (`mine`), never by create;
 *   - update changes name, description and external id, and keeps the
 *     stored owner and entries;
 *   - the four entry RPCs authorize in the handler, because their target is
 *     a oneof the annotation cannot express: `can_edit` on a vault named by
 *     id; `can_create_vault` on the organization for `mine` (members);
 *   - startSignIn and completeSignIn sign a person in at an address and
 *     save the login into a vault they may change (sign-in/person.ts);
 *     createConnectLink makes a one-time page for someone without an
 *     account, served by the public ConnectLinkController (connect-link.ts);
 *   - getMine finds the caller's own My vault by their identity, so the
 *     request names no target; getByExternalId asks can_view on the
 *     organization first, then resolves the integrator's id through its
 *     name claim and answers NOT_FOUND for a vault the caller may not
 *     view, as for one that does not exist; list reads the organization's vaults
 *     through the list index, drops every other person's My vault, then
 *     narrows through the composed list read scope.
 *
 * Per-RPC posture: docs/authorization-coverage.md. Proven by
 * __tests__/controller.test.ts and the vault conformance suite.
 */
import { Code, ConnectError } from "@connectrpc/connect";
import type { ConnectRouter, HandlerContext } from "@connectrpc/connect";
import { create, fromBinary } from "@bufbuild/protobuf";
import type { DescMessage, MessageShape } from "@bufbuild/protobuf";

import { VaultSchema } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";
import type { Vault } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";
import { VaultCommandController } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/command_pb";
import { VaultListSchema } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/io_pb";
import type {
  GetMyVaultInput,
  GetVaultByExternalIdInput,
  ListVaultsRequest,
  RemoveVaultConnectionsInput,
  RemoveVaultSecretsInput,
  SetVaultConnectionInput,
  SetVaultSecretsInput,
  VaultList,
  VaultTarget,
} from "@stigmer/protos/ai/stigmer/agentic/vault/v1/io_pb";
import { VaultQueryController } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/query_pb";
import { ConnectLinkController } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/connect_link_pb";
import { VaultValueController } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/values_pb";
import { VaultConnectionSource } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/spec_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type {
  ApiResourceDeleteInput,
  ApiResourceId,
  ApiResourceReference,
  UpdateVisibilityInput,
} from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import type { Logger } from "../../boot/logger.js";
import type { SecretService } from "../../encryption/encryption.js";
import { isCiphertextShaped, REDACTED_MARKER } from "../../encryption/encryption.js";
import type { Authorizer } from "../../extensions/authorizer.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import type { ListReadScope } from "../../extensions/list-read-scope.js";
import { restrictListByReadScope } from "../../extensions/list-read-scope.js";
import type { ResourceAuthorizationLifecycle } from "../../extensions/resource-authorization.js";
import {
  failedPreconditionError,
  invalidArgumentError,
  notFoundError,
} from "../../pipeline/errors.js";
import { apiResourceKindKey } from "../../pipeline/interceptors/apiresource.js";
import { callerIdentityOf } from "../../pipeline/interceptors/auth.js";
import { newPipeline } from "../../pipeline/pipeline.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import { RequestContext } from "../../pipeline/request-context.js";
import {
  authorizeDirect,
  authorizeResolvedResource,
  newAuthorizeStep,
} from "../../pipeline/steps/authorize.js";
import {
  loadedTargetAsMethod,
  newAuthorizeResolvedTargetStep,
} from "../../pipeline/steps/authorize-resolved-target.js";
import {
  newCreateAuthorizationTuplesStep,
  newRecordVisibilityBeforeUpdateStep,
  newUpdateVisibilityTuplesStep,
} from "../../pipeline/steps/authorization-tuples.js";
import { newBuildUpdateStateStep } from "../../pipeline/steps/build-update-state.js";
import {
  newBuildNewStateStep,
  setAuditFieldsForUpdate,
} from "../../pipeline/steps/defaults.js";
import {
  RESOURCE_ID_KEY,
  newLoadExistingForDeleteStep,
} from "../../pipeline/steps/delete.js";
import { newCheckDuplicateStep } from "../../pipeline/steps/duplicate.js";
import { newGuardReservedLabelsStep } from "../../pipeline/steps/guard-reserved-labels.js";
import { compareCreatedAtDesc } from "../../pipeline/steps/helpers.js";
import { newLoadByReferenceStep } from "../../pipeline/steps/load-by-reference.js";
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
import { newValidateProtoStep } from "../../pipeline/steps/validation.js";
import {
  newValidateVisibilityStep,
  newValidateVisibilityUpdateStep,
} from "../../pipeline/steps/validate-visibility.js";
import type { Store } from "../../store/interface.js";

import { InvalidAddressError, normalizeAddress } from "./address.js";
import {
  completeConnectLink,
  createConnectLink,
  getConnectLink,
  startConnectLink,
} from "./connect-link.js";
import type { ConnectLinkDeps } from "./connect-link.js";
import { completePersonSignIn, startPersonSignIn } from "./sign-in/person.js";
import { MY_VAULT_VISIBILITY_REFUSAL } from "./constants.js";
import {
  forgedCiphertextMessage,
  markerRejectionMessage,
  reservedSecretNameRefusal,
} from "./constants.js";
import { vaultDeleteSteps } from "./delete.js";
import { decodeVaultRows, vaultListIndex } from "./list-index.js";
import { redactVault } from "./redact.js";
import type { VaultService } from "./service.js";
import { isMyVault, personOf } from "./service.js";
import { fetchExecutionValues } from "./values.js";
import type { ExecutionValuesDeps } from "./values.js";
import {
  newClaimExternalIdStep,
  newKeepStoredOwnerAndEntriesStep,
  newPersistVaultUpdateStep,
  newPersistVaultVisibilityStep,
  newRefuseMyVaultSlugStep,
  newReleaseClearedExternalIdStep,
  newStampSharedOwnerStep,
  undoExternalIdMoveAfterFailure,
} from "./steps.js";

export interface VaultControllerDeps {
  readonly store: Store;
  readonly logger: Logger;
  readonly authorizer: Authorizer;
  readonly authorizationLifecycle: ResourceAuthorizationLifecycle | undefined;
  readonly secretService: SecretService;
  readonly listReadScope: ListReadScope | undefined;
  readonly vaults: VaultService;
  /** A sign-in at an address and Connect links: their stores, the login apps and the egress-guarded fetch. */
  readonly signIn: ConnectLinkDeps;
  /** The runner's fetch of an execution's values: its credential check and the resolver that opens them. */
  readonly values: ExecutionValuesDeps;
}

/** Registers both vault services on the router (routes stage). */
export function registerVaultServices(
  router: ConnectRouter,
  deps: VaultControllerDeps,
): void {
  router.service(VaultCommandController, {
    create: (vault, ctx) => createVault(deps, vault, ctx),
    update: (vault, ctx) => updateVault(deps, vault, ctx),
    updateVisibility: (input, ctx) => updateVisibility(deps, input, ctx),
    delete: (input, ctx) => deleteVault(deps, input, ctx),
    setSecrets: (input, ctx) => setSecrets(deps, input, ctx),
    removeSecrets: (input, ctx) => removeSecrets(deps, input, ctx),
    setConnection: (input, ctx) => setConnection(deps, input, ctx),
    removeConnections: (input, ctx) => removeConnections(deps, input, ctx),
    startSignIn: async (input, ctx) => {
      const caller = callerIdentityOf(ctx);
      await validated(VaultCommandController.method.startSignIn.input, input, caller, ctx, deps);
      return startPersonSignIn(deps.signIn, input, caller);
    },
    completeSignIn: async (input, ctx) => {
      const caller = callerIdentityOf(ctx);
      await validated(VaultCommandController.method.completeSignIn.input, input, caller, ctx, deps);
      return completePersonSignIn(deps.signIn, input, caller);
    },
    createConnectLink: async (input, ctx) => {
      const caller = callerIdentityOf(ctx);
      await validated(VaultCommandController.method.createConnectLink.input, input, caller, ctx, deps);
      await authorizeDirect(VaultCommandController.method.createConnectLink, deps.authorizer, caller, input);
      return createConnectLink(deps.signIn, input, caller);
    },
  });
  // The Connect link's page: public, the link's secret the authority
  // (connect-link.ts).
  router.service(ConnectLinkController, {
    getConnectLink: (input) => getConnectLink(deps.signIn, input),
    startConnectLink: (input) => startConnectLink(deps.signIn, input),
    completeConnectLink: (input) => completeConnectLink(deps.signIn, input),
  });
  // The runner's fetch of an execution's values: the runner credential
  // is the authority (values.ts).
  router.service(VaultValueController, {
    fetchValues: async (input, ctx) => {
      await validated(VaultValueController.method.fetchValues.input, input, callerIdentityOf(ctx), ctx, deps);
      return fetchExecutionValues(deps.values, input, ctx);
    },
  });
  router.service(VaultQueryController, {
    get: (id, ctx) => get(deps, id, ctx),
    getByReference: (ref, ctx) => getByReference(deps, ref, ctx),
    getMine: (input, ctx) => getMine(deps, input, ctx),
    getByExternalId: (input, ctx) => getByExternalId(deps, input, ctx),
    list: (req, ctx) => list(deps, req, ctx),
  });
}

function kindOf(ctx: HandlerContext): ApiResourceKind {
  return ctx.values.get(apiResourceKindKey);
}

function respond(vault: Vault): Vault {
  redactVault(vault);
  return vault;
}

// ---------------------------------------------------------------------------
// create, update, delete
// ---------------------------------------------------------------------------

async function createVault(
  deps: VaultControllerDeps,
  vault: Vault,
  ctx: HandlerContext,
): Promise<Vault> {
  const reqCtx = new RequestContext(
    VaultSchema,
    vault,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  try {
    await newPipeline<typeof VaultSchema>("vault-create", deps.logger)
      .addStep(newAuthorizeStep(VaultCommandController.method.create, deps.authorizer))
      .addStep(newValidateProtoStep())
      .addStep(newValidateVisibilityStep())
      .addStep(newResolveSlugStep())
      .addStep(newRefuseMyVaultSlugStep())
      .addStep(newCheckDuplicateStep(deps.store))
      .addStep(newBuildNewStateStep())
      .addStep(newGuardReservedLabelsStep(deps.authorizer))
      .addStep(newStampSharedOwnerStep())
      .addStep(newClaimExternalIdStep(deps.store))
      .addStep(newPersistStep(deps.store))
      .addStep(
        newCreateAuthorizationTuplesStep(deps.authorizationLifecycle, deps.logger),
      )
      .build()
      .execute(reqCtx);
  } catch (error) {
    await undoExternalIdMoveAfterFailure(deps.store, deps.logger, reqCtx);
    throw error;
  }
  return respond(reqCtx.newState);
}

async function updateVault(
  deps: VaultControllerDeps,
  vault: Vault,
  ctx: HandlerContext,
): Promise<Vault> {
  const reqCtx = new RequestContext(
    VaultSchema,
    vault,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  try {
    await newPipeline<typeof VaultSchema>("vault-update", deps.logger)
      .addStep(newAuthorizeStep(VaultCommandController.method.update, deps.authorizer))
      .addStep(newValidateProtoStep())
      .addStep(newResolveSlugStep({ update: true }))
      .addStep(newLoadExistingStep(deps.store))
      .addStep(newBuildUpdateStateStep())
      .addStep(newGuardReservedLabelsStep(deps.authorizer))
      .addStep(newKeepStoredOwnerAndEntriesStep())
      .addStep(newClaimExternalIdStep(deps.store))
      .addStep(newPersistVaultUpdateStep(deps.store))
      .addStep(newReleaseClearedExternalIdStep(deps.store, deps.logger))
      .build()
      .execute(reqCtx);
  } catch (error) {
    await undoExternalIdMoveAfterFailure(deps.store, deps.logger, reqCtx);
    throw error;
  }
  return respond(reqCtx.newState);
}

type DeleteDesc = typeof VaultCommandController.method.delete.input;

async function deleteVault(
  deps: VaultControllerDeps,
  input: ApiResourceDeleteInput,
  ctx: HandlerContext,
): Promise<Vault> {
  const reqCtx = new RequestContext(
    VaultCommandController.method.delete.input,
    input,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  reqCtx.set(RESOURCE_ID_KEY, input.resourceId);
  let pipeline = newPipeline<DeleteDesc>("vault-delete", deps.logger)
    .addStep(newAuthorizeStep(VaultCommandController.method.delete, deps.authorizer))
    .addStep(newValidateProtoStep())
    .addStep(newLoadExistingForDeleteStep(deps.store, VaultSchema));
  for (const step of vaultDeleteSteps<DeleteDesc>(deps)) {
    pipeline = pipeline.addStep(step);
  }
  await pipeline.build().execute(reqCtx);
  // LoadExistingForDelete put the row here, or the chain refused.
  return respond(reqCtx.get(EXISTING_RESOURCE_KEY) as Vault);
}

// ---------------------------------------------------------------------------
// updateVisibility — a shared vault only: org visibility lets every member
// use it. My vault refuses every change that widens it.
// ---------------------------------------------------------------------------

/** The shared delete loader keeps the row here; the visibility chain reads it from the same key. */
const UPDATE_VISIBILITY_VAULT_KEY = EXISTING_RESOURCE_KEY;

type UpdateVisibilityDesc =
  typeof VaultCommandController.method.updateVisibility.input;

async function updateVisibility(
  deps: VaultControllerDeps,
  input: UpdateVisibilityInput,
  ctx: HandlerContext,
): Promise<Vault> {
  const reqCtx = new RequestContext(
    VaultCommandController.method.updateVisibility.input,
    input,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  reqCtx.set(RESOURCE_ID_KEY, input.resourceId);
  await newPipeline<UpdateVisibilityDesc>("vault-update-visibility", deps.logger)
    .addStep(
      newAuthorizeStep(VaultCommandController.method.updateVisibility, deps.authorizer),
    )
    .addStep(newValidateProtoStep())
    .addStep(newLoadExistingForDeleteStep(deps.store, VaultSchema))
    .addStep(newRecordVisibilityBeforeUpdateStep(UPDATE_VISIBILITY_VAULT_KEY))
    .addStep(newValidateVisibilityUpdateStep())
    .addStep(newRefuseMyVaultWideningStep())
    .addStep(newSetVaultVisibilityStep())
    .addStep(newPersistVaultVisibilityStep<UpdateVisibilityDesc>(deps.store))
    .addStep(
      newUpdateVisibilityTuplesStep(
        deps.authorizationLifecycle,
        UPDATE_VISIBILITY_VAULT_KEY,
      ),
    )
    .build()
    .execute(reqCtx);
  return respond(reqCtx.get(UPDATE_VISIBILITY_VAULT_KEY) as Vault);
}

function newRefuseMyVaultWideningStep(): PipelineStep<UpdateVisibilityDesc> {
  return {
    name: "RefuseMyVaultWidening",
    execute(ctx: RequestContext<UpdateVisibilityDesc>): void {
      if (ctx.input.visibility !== ApiResourceVisibility.visibility_org) {
        return;
      }
      if (isMyVault(ctx.get(UPDATE_VISIBILITY_VAULT_KEY) as Vault)) {
        throw failedPreconditionError(MY_VAULT_VISIBILITY_REFUSAL);
      }
    },
  };
}

function newSetVaultVisibilityStep(): PipelineStep<UpdateVisibilityDesc> {
  return {
    name: "SetVisibility",
    execute(ctx: RequestContext<UpdateVisibilityDesc>): void {
      const vault = ctx.get(UPDATE_VISIBILITY_VAULT_KEY) as Vault;
      if (vault.metadata !== undefined) {
        vault.metadata.visibility = ctx.input.visibility;
      }
      setAuditFieldsForUpdate(VaultSchema, vault, "status_audit", ctx.callerIdentity);
    },
  };
}


// ---------------------------------------------------------------------------
// The entry RPCs: target resolution and authorization in the handler.
// ---------------------------------------------------------------------------

const EDIT_DENIED = "unauthorized to change this vault's entries";
const MINE_DENIED =
  "unauthorized to keep a My vault in this organization: only its members do";

/**
 * The vault an entry write changes. `mine` asks the organization's
 * can_create_vault, then finds or (when `createMine`) creates the caller's
 * My vault; an id asks can_edit on the vault. A vault outside the request's
 * organization answers NOT_FOUND, as a missing one does.
 */
async function resolveWriteTarget(
  deps: VaultControllerDeps,
  target: VaultTarget | undefined,
  caller: CallerIdentity,
  createMine: boolean,
): Promise<Vault | undefined> {
  const org = target?.org ?? "";
  const which = target?.vault;
  if (which?.case === "mine") {
    await authorizeResolvedResource(
      deps.authorizer,
      caller,
      {
        permission: IamPermission.can_create_vault,
        resourceKind: ApiResourceKind.organization,
        resourceId: org,
      },
      MINE_DENIED,
    );
    return createMine
      ? deps.vaults.ensureMine(org, caller)
      : deps.vaults.findMine(org, caller.identityId);
  }
  // Validation requires the target to name an id (non-empty) or mine.
  const id = which?.case === "id" ? which.value : "";
  const vault = id === "" ? undefined : await deps.vaults.findById(id);
  if (vault === undefined || (vault.metadata?.org ?? "") !== org) {
    throw notFoundError("vault", id);
  }
  await authorizeResolvedResource(
    deps.authorizer,
    caller,
    {
      permission: IamPermission.can_edit,
      resourceKind: ApiResourceKind.vault,
      resourceId: id,
    },
    EDIT_DENIED,
  );
  return vault;
}

/** Refuses a value no client may send: the redaction marker and server ciphertext. */
function refuseServerShapedValue(subject: string, value: string): void {
  if (value === REDACTED_MARKER) {
    throw invalidArgumentError(markerRejectionMessage(subject));
  }
  if (isCiphertextShaped(value)) {
    throw invalidArgumentError(forgedCiphertextMessage(subject));
  }
}

/** Maps the address rule's refusal onto the wire. */
async function withAddressRule<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof InvalidAddressError) {
      throw invalidArgumentError(error.message);
    }
    throw error;
  }
}

async function setSecrets(
  deps: VaultControllerDeps,
  input: SetVaultSecretsInput,
  ctx: HandlerContext,
): Promise<Vault> {
  const caller = callerIdentityOf(ctx);
  await validated(VaultCommandController.method.setSecrets.input, input, caller, ctx, deps);
  // Every entry is checked before the target is resolved: a refused first
  // write never creates My vault.
  for (const [name, secret] of Object.entries(input.secrets)) {
    const reserved = reservedSecretNameRefusal(name);
    if (reserved !== undefined) {
      throw invalidArgumentError(reserved);
    }
    refuseServerShapedValue(`secret '${name}'`, secret.value);
  }
  const vault = await resolveWriteTarget(deps, input.vault, caller, true);
  const written = await deps.vaults.setSecrets(
    vault!.metadata?.id ?? "",
    Object.fromEntries(
      Object.entries(input.secrets).map(([name, secret]) => [
        name,
        { value: secret.value, description: secret.description },
      ]),
    ),
    caller,
  );
  return respond(written);
}

async function removeSecrets(
  deps: VaultControllerDeps,
  input: RemoveVaultSecretsInput,
  ctx: HandlerContext,
): Promise<Vault> {
  const caller = callerIdentityOf(ctx);
  await validated(VaultCommandController.method.removeSecrets.input, input, caller, ctx, deps);
  const vault = await resolveWriteTarget(deps, input.vault, caller, false);
  if (vault === undefined) {
    throw notFoundError("vault", "My vault");
  }
  const { vault: written } = await deps.vaults.removeSecrets(
    vault.metadata?.id ?? "",
    input.names,
    caller,
  );
  return respond(written);
}

async function setConnection(
  deps: VaultControllerDeps,
  input: SetVaultConnectionInput,
  ctx: HandlerContext,
): Promise<Vault> {
  const caller = callerIdentityOf(ctx);
  await validated(VaultCommandController.method.setConnection.input, input, caller, ctx, deps);
  refuseServerShapedValue("the login's token", input.token);
  return withAddressRule(async () => {
    // The address is checked before the target is resolved: a refused
    // first write never creates My vault.
    normalizeAddress(input.address);
    const vault = await resolveWriteTarget(deps, input.vault, caller, true);
    const written = await deps.vaults.setConnection(
      vault!.metadata?.id ?? "",
      input.address,
      {
        token: input.token,
        source: VaultConnectionSource.pasted,
        description: input.description,
      },
      caller,
    );
    return respond(written);
  });
}

async function removeConnections(
  deps: VaultControllerDeps,
  input: RemoveVaultConnectionsInput,
  ctx: HandlerContext,
): Promise<Vault> {
  const caller = callerIdentityOf(ctx);
  await validated(VaultCommandController.method.removeConnections.input, input, caller, ctx, deps);
  return withAddressRule(async () => {
    const vault = await resolveWriteTarget(deps, input.vault, caller, false);
    if (vault === undefined) {
      throw notFoundError("vault", "My vault");
    }
    const { vault: written } = await deps.vaults.removeConnections(
      vault.metadata?.id ?? "",
      input.addresses,
      caller,
    );
    return respond(written);
  });
}

/**
 * The protovalidate step for a handler that runs no pipeline: the
 * Authorize step at position 1 is a no-op for these skip-annotated RPCs,
 * and the proto rules still bind an in-process call.
 */
async function validated<Desc extends DescMessage>(
  schema: Desc,
  input: MessageShape<Desc>,
  caller: CallerIdentity,
  ctx: HandlerContext,
  deps: VaultControllerDeps,
): Promise<void> {
  const reqCtx = new RequestContext(schema, input, caller, kindOf(ctx));
  await newPipeline<Desc>("vault-validate", deps.logger)
    .addStep(newValidateProtoStep())
    .build()
    .execute(reqCtx);
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

async function get(
  deps: VaultControllerDeps,
  id: ApiResourceId,
  ctx: HandlerContext,
): Promise<Vault> {
  const reqCtx = new RequestContext(
    VaultQueryController.method.get.input,
    id,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof VaultQueryController.method.get.input>("vault-get", deps.logger)
    .addStep(newAuthorizeStep(VaultQueryController.method.get, deps.authorizer))
    .addStep(newValidateProtoStep())
    .addStep(newLoadTargetStep(deps.store, VaultSchema))
    .build()
    .execute(reqCtx);
  return respond(reqCtx.get(TARGET_RESOURCE_KEY) as Vault);
}

async function getByReference(
  deps: VaultControllerDeps,
  ref: ApiResourceReference,
  ctx: HandlerContext,
): Promise<Vault> {
  const reqCtx = new RequestContext(
    VaultQueryController.method.getByReference.input,
    ref,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof VaultQueryController.method.getByReference.input>(
    "vault-get-by-reference",
    deps.logger,
  )
    .addStep(newAuthorizeStep(VaultQueryController.method.getByReference, deps.authorizer))
    .addStep(newValidateProtoStep())
    .addStep(newLoadByReferenceStep(deps.store, VaultSchema))
    .addStep(
      newAuthorizeResolvedTargetStep(
        deps.authorizer,
        loadedTargetAsMethod(VaultQueryController.method.get),
      ),
    )
    .build()
    .execute(reqCtx);
  return respond(reqCtx.get(TARGET_RESOURCE_KEY) as Vault);
}

const VIEW_DENIED = "unauthorized to get vault";

async function getMine(
  deps: VaultControllerDeps,
  input: GetMyVaultInput,
  ctx: HandlerContext,
): Promise<Vault> {
  const caller = callerIdentityOf(ctx);
  await validated(VaultQueryController.method.getMine.input, input, caller, ctx, deps);
  const vault = await deps.vaults.findMine(input.org, caller.identityId);
  if (vault === undefined) {
    throw notFoundError("vault", "My vault");
  }
  await authorizeResolvedResource(
    deps.authorizer,
    caller,
    {
      permission: IamPermission.can_view,
      resourceKind: ApiResourceKind.vault,
      resourceId: vault.metadata?.id ?? "",
    },
    VIEW_DENIED,
  );
  return respond(vault);
}

async function getByExternalId(
  deps: VaultControllerDeps,
  input: GetVaultByExternalIdInput,
  ctx: HandlerContext,
): Promise<Vault> {
  const caller = callerIdentityOf(ctx);
  await validated(VaultQueryController.method.getByExternalId.input, input, caller, ctx, deps);
  // The organization first: a caller who cannot see it learns nothing of
  // which external ids it holds.
  await authorizeResolvedResource(
    deps.authorizer,
    caller,
    {
      permission: IamPermission.can_view,
      resourceKind: ApiResourceKind.organization,
      resourceId: input.org,
    },
    VIEW_DENIED,
  );
  const missing = notFoundError("vault", `external_id '${input.externalId}'`);
  const vault = await deps.vaults.findByExternalId(input.org, input.externalId);
  if (vault === undefined) {
    throw missing;
  }
  try {
    await authorizeResolvedResource(
      deps.authorizer,
      caller,
      {
        permission: IamPermission.can_view,
        resourceKind: ApiResourceKind.vault,
        resourceId: vault.metadata?.id ?? "",
      },
      VIEW_DENIED,
    );
  } catch (error) {
    // A vault the caller may not view answers as one that does not exist.
    if (error instanceof ConnectError && error.code === Code.PermissionDenied) {
      throw missing;
    }
    throw error;
  }
  return respond(vault);
}

async function list(
  deps: VaultControllerDeps,
  req: ListVaultsRequest,
  ctx: HandlerContext,
): Promise<VaultList> {
  const caller = callerIdentityOf(ctx);
  await validated(VaultQueryController.method.list.input, req, caller, ctx, deps);
  const rows = await deps.store.queryResources(vaultListIndex, { org: req.org });
  // Another person's My vault is never listed, whatever the scope says:
  // the server acting as itself is the one caller that sees them all.
  const requested = decodeVaultRows(rows).filter((vault) => {
    const person = personOf(vault);
    return (
      person === undefined ||
      person === caller.identityId ||
      caller.callerClass === "internal"
    );
  });
  const vaults = await restrictListByReadScope(
    deps.listReadScope,
    caller,
    ApiResourceKind.vault,
    requested,
    "",
  );
  vaults.sort((a, b) =>
    compareCreatedAtDesc(
      a.status?.audit?.specAudit?.createdAt,
      b.status?.audit?.specAudit?.createdAt,
    ),
  );
  for (const vault of vaults) {
    redactVault(vault);
  }
  return create(VaultListSchema, { totalCount: vaults.length, items: vaults });
}
