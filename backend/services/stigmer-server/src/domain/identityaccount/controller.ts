/**
 * IdentityAccount controller (20260911.11) — the identity-account domain
 * served ONCE by @stigmer/server in every edition (the editions program's
 * tier truth: `identity_account` is open-source tier). The behavioural
 * reference is the cloud's iam/account/handlers.ts, whose twelve direct
 * handlers retire against this module; the byte-pinned copy moved with it
 * (constants.ts). The cloud keeps only what differs per edition — its row
 * store as `drivers.identityAccountStore`, the federated arms as
 * `drivers.identityFederation`, the personal organization as a gate on
 * `identity-account-provision:post-persist`.
 *
 * Persistence is the IdentityAccountStore PORT, never the generic Store
 * (steps.ts explains); the storage-free shared steps are reused as they
 * are, so every chain reads onto the inventory unchanged.
 *
 * The ONE create path (`newCreateAccountPath`): the create RPC, the
 * provisioner and the trusted-local operator ensure all run the same
 * chain — DeriveAccountId, CheckDuplicate by subject, BuildNewState,
 * AssignBackendFields, Persist through the port, CreateAuthorizationTuples
 * (the lifecycle driver's SELF arm gives the account its self-owner grant
 * in the cloud) — so no account exists that skipped a step. The create
 * RPC is the cloud#393 gate in front of that path (T01_1_review.md A7):
 * machine / internal / in-process callers only, in every edition. The
 * gate is the RPC's admission rule and deliberately NOT a step in the
 * path, because the provisioner runs the path as the idp-shaped wire user
 * (the account is created by the subject it is for) and the operator
 * ensure runs it as the trusted-local user.
 *
 * Direct handlers (no pipeline): whoAmI (the cloud's two primary-key
 * reads through idpIdOf; NOT_FOUND for the unprovisioned), getByEmail and
 * getByIdpId (lookup FIRST, then authorizeDirect on the FOUND id — the
 * cloud's order; the annotation's `field_path = "value"` would otherwise
 * hand the Authorizer an email as a resource id), getActorInfo, and
 * provisionMyAccount (the provisioner, then the composed post-persist
 * gates; UNAUTHENTICATED with the cloud's copy for a credential naming no
 * subject; UNAVAILABLE with the cloud's copy when userinfo fails).
 *
 * The four federation RPCs refuse UNIMPLEMENTED with the edition reason
 * when no unit composes the capability (never INTERNAL; the organization
 * directory's absent-method shape); present, the controller owns the
 * shared precondition (authorize on the org, ref-with-slug, org match,
 * IdP exists) and dispatches to the arm with the resolved ref.
 *
 * Proven by __tests__/identityaccount.test.ts (the composed trusted-local
 * server), boot/__tests__/auth-enabled-composition.test.ts (the OIDC
 * posture end to end) and identityaccount.conformance.test.ts.
 */
import { Code, ConnectError } from "@connectrpc/connect";
import type { ConnectRouter, HandlerContext } from "@connectrpc/connect";
import type { DescMessage, DescMethod, Message } from "@bufbuild/protobuf";
import { create } from "@bufbuild/protobuf";
import type { Empty } from "@bufbuild/protobuf/wkt";

import type { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { ApiResourceReference } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { ApiResourceAuditActorSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/status_pb";
import type { ApiResourceAuditActor } from "@stigmer/protos/ai/stigmer/commons/apiresource/status_pb";
import type { IdentityAccount } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountCommandController } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/command_pb";
import type {
  IdentityAccountEmail,
  IdentityAccountId,
  IdpId,
} from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/io_pb";
import { IdentityAccountQueryController } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/query_pb";

import type { Logger } from "../../boot/logger.js";
import type { Authorizer } from "../../extensions/authorizer.js";
import { stepsForSlot } from "../../extensions/gate-slots.js";
import type { ResolvedGateSteps } from "../../extensions/gate-slots.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import type { IdentityFederation } from "../../extensions/identity-federation.js";
import type { ResourceAuthorizationLifecycle } from "../../extensions/resource-authorization.js";
import { internalError, invalidArgumentError } from "../../pipeline/errors.js";
import { apiResourceKindKey } from "../../pipeline/interceptors/apiresource.js";
import { callerIdentityOf } from "../../pipeline/interceptors/auth.js";
import { newPipeline } from "../../pipeline/pipeline.js";
import { RequestContext } from "../../pipeline/request-context.js";
import {
  newCleanupIamPoliciesStep,
  newCreateAuthorizationTuplesStep,
} from "../../pipeline/steps/authorization-tuples.js";
import {
  authorizeDirect,
  newAuthorizeStep,
} from "../../pipeline/steps/authorize.js";
import { newBuildUpdateStateStep } from "../../pipeline/steps/build-update-state.js";
import { newBuildNewStateStep } from "../../pipeline/steps/defaults.js";
import { newExtractResourceIdStep } from "../../pipeline/steps/delete.js";
import { newGuardReservedLabelsStep } from "../../pipeline/steps/guard-reserved-labels.js";
import { EXISTING_RESOURCE_KEY } from "../../pipeline/steps/load-existing.js";
import { TARGET_RESOURCE_KEY } from "../../pipeline/steps/load-target.js";
import { newResolveSlugStep } from "../../pipeline/steps/slug.js";
import { newValidateProtoStep } from "../../pipeline/steps/validation.js";
import {
  ACCOUNT_NOT_FOUND_FOR_CALLER_MESSAGE,
  CREATE_IS_INTERNAL_MESSAGE,
  NO_IDP_ID_MESSAGE,
  USERINFO_UNAVAILABLE_PREFIX,
  federationUnimplementedMessage,
  idpIdOf,
} from "./constants.js";
import type {
  CreateAccount,
  CreateAccountInput,
  DirectAccountProvisioner,
} from "./provisioning.js";
import { UserInfoFetchError } from "./provisioning.js";
import {
  accountNotFoundError,
  newAssignBackendFieldsStep,
  newCheckDuplicateStep,
  newDefaultAccountNameStep,
  newDeleteAccountStep,
  newDeriveAccountIdStep,
  newGuardImmutableSubjectStep,
  newLoadExistingAccountForDeleteStep,
  newLoadExistingAccountStep,
  newLoadTargetAccountStep,
  newPersistNewAccountStep,
  newPersistUpdatedAccountStep,
  newPreserveBackendFieldsStep,
} from "./steps.js";
import type { IdentityAccountStore } from "./store.js";

/** What the create path needs — the subset every caller of it composes. */
export interface CreateAccountPathDeps {
  readonly accounts: IdentityAccountStore;
  readonly logger: Logger;
  /** The composed authorization seam — the Authorize step at position 1 of every chain calls it (DD-007 §3). */
  readonly authorizer: Authorizer;
  /** The composed tuple-lifecycle driver — undefined = the shared steps no-op. */
  readonly authorizationLifecycle: ResourceAuthorizationLifecycle | undefined;
}

export interface IdentityAccountControllerDeps extends CreateAccountPathDeps {
  readonly provisioner: DirectAccountProvisioner;
  /** The composed federation capability — undefined = the four RPCs refuse UNIMPLEMENTED. */
  readonly federation: IdentityFederation | undefined;
  /** The composed slot registrations — this domain's provision slot (Q-IA-9, A10). */
  readonly gateSteps: ResolvedGateSteps;
}

/** Registers both identityaccount services on the router (routes stage). */
export function registerIdentityAccountServices(
  router: ConnectRouter,
  deps: IdentityAccountControllerDeps,
): void {
  router.service(IdentityAccountCommandController, {
    create: (account, ctx) => createRpc(deps, account, ctx),
    update: (account, ctx) => update(deps, account, ctx),
    delete: (id, ctx) => deleteAccount(deps, id, ctx),
    createFederatedAccount: (input, ctx) =>
      federated(
        deps,
        ctx,
        IdentityAccountCommandController.method.createFederatedAccount,
        input,
        (federation, ref, caller) =>
          federation.createFederatedAccount(input, ref, caller),
      ),
    updateFederatedAccount: (input, ctx) =>
      federated(
        deps,
        ctx,
        IdentityAccountCommandController.method.updateFederatedAccount,
        input,
        (federation, ref, caller) =>
          federation.updateFederatedAccount(input, ref, caller),
      ),
    deprovisionFederatedAccount: (input, ctx) =>
      federated(
        deps,
        ctx,
        IdentityAccountCommandController.method.deprovisionFederatedAccount,
        input,
        (federation, ref, caller) =>
          federation.deprovisionFederatedAccount(input, ref, caller),
      ),
    provisionMyAccount: (empty, ctx) => provisionMyAccount(deps, empty, ctx),
  });
  router.service(IdentityAccountQueryController, {
    get: (id, ctx) => get(deps, id, ctx),
    whoAmI: (empty, ctx) => whoAmI(deps, empty, ctx),
    getByEmail: (email, ctx) => getByEmail(deps, email, ctx),
    getByIdpId: (idpId, ctx) => getByIdpId(deps, idpId, ctx),
    getByExternalSub: (lookup, ctx) =>
      federated(
        deps,
        ctx,
        IdentityAccountQueryController.method.getByExternalSub,
        lookup,
        (federation, ref, caller) =>
          federation.getByExternalSub(lookup, ref, caller),
      ),
    getActorInfo: (id, ctx) => getActorInfo(deps, id, ctx),
  });
}

function kindOf(ctx: HandlerContext): ApiResourceKind {
  return ctx.values.get(apiResourceKindKey);
}

// ---------------------------------------------------------------------------
// The one create path
// ---------------------------------------------------------------------------

/**
 * Runs the create chain AS `caller` and answers the persisted account.
 * `kind` is the service's kind tag for wire calls; the path callers with
 * no HandlerContext (the provisioner, the operator ensure) pass the kind
 * the controller serves.
 */
async function runCreateChain(
  deps: CreateAccountPathDeps,
  account: IdentityAccount,
  caller: CallerIdentity,
  kind: ApiResourceKind,
): Promise<IdentityAccount> {
  const reqCtx = new RequestContext(
    IdentityAccountSchema,
    account,
    caller,
    kind,
  );
  await newPipeline<typeof IdentityAccountSchema>(
    "identityaccount-create",
    deps.logger,
  )
    .addStep(
      newAuthorizeStep(
        IdentityAccountCommandController.method.create,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    .addStep(newDefaultAccountNameStep())
    .addStep(newResolveSlugStep())
    .addStep(newDeriveAccountIdStep())
    .addStep(newCheckDuplicateStep(deps.accounts))
    .addStep(newBuildNewStateStep())
    .addStep(newGuardReservedLabelsStep(deps.authorizer))
    .addStep(newAssignBackendFieldsStep())
    .addStep(newPersistNewAccountStep(deps.accounts))
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
 * The create path as its in-process callers see it (provisioning.ts
 * `CreateAccount`): the input becomes the resource envelope the chain
 * expects, tagged with the kind this controller serves.
 */
export function newCreateAccountPath(
  deps: CreateAccountPathDeps,
  kind: ApiResourceKind,
): CreateAccount {
  return (input: CreateAccountInput, caller: CallerIdentity) =>
    runCreateChain(
      deps,
      create(IdentityAccountSchema, {
        apiVersion: "iam.stigmer.ai/v1",
        kind: "IdentityAccount",
        metadata: { name: input.name },
        spec: input.spec,
      }),
      caller,
      kind,
    );
}

/**
 * The create RPC: the cloud#393 gate, then the path AS the caller. FGA
 * cannot gate this RPC (the account being created IS the principal — the
 * bootstrap problem), so the gate is caller class: the platform's own
 * pipelines only.
 */
function createRpc(
  deps: IdentityAccountControllerDeps,
  account: IdentityAccount,
  ctx: HandlerContext,
): Promise<IdentityAccount> {
  const caller = callerIdentityOf(ctx);
  guardInternalRpc(caller);
  return runCreateChain(deps, account, caller, kindOf(ctx));
}

function guardInternalRpc(caller: CallerIdentity): void {
  if (
    caller.callerClass === "machine" ||
    caller.callerClass === "internal" ||
    caller.origin === "in-process"
  ) {
    return;
  }
  throw new ConnectError(CREATE_IS_INTERNAL_MESSAGE, Code.PermissionDenied);
}

// ---------------------------------------------------------------------------
// Update / Delete
// ---------------------------------------------------------------------------

/**
 * Update: full-envelope replace with the cloud's writable surface (A9) —
 * BuildUpdateState preserves id/slug/org/visibility, GuardImmutableSubject
 * refuses a changed subject, AssignBackendFields preserves the rest of
 * what the backend owns from the existing row.
 */
async function update(
  deps: IdentityAccountControllerDeps,
  account: IdentityAccount,
  ctx: HandlerContext,
): Promise<IdentityAccount> {
  const reqCtx = new RequestContext(
    IdentityAccountSchema,
    account,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof IdentityAccountSchema>(
    "identityaccount-update",
    deps.logger,
  )
    .addStep(
      newAuthorizeStep(
        IdentityAccountCommandController.method.update,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    .addStep(newLoadExistingAccountStep(deps.accounts))
    .addStep(newGuardImmutableSubjectStep())
    .addStep(newBuildUpdateStateStep())
    .addStep(newPreserveBackendFieldsStep())
    .addStep(newPersistUpdatedAccountStep(deps.accounts))
    .build()
    .execute(reqCtx);
  return reqCtx.newState;
}

/** Delete — answers the pre-delete account (the canonical delete chain over the port). */
async function deleteAccount(
  deps: IdentityAccountControllerDeps,
  id: IdentityAccountId,
  ctx: HandlerContext,
): Promise<IdentityAccount> {
  const reqCtx = new RequestContext(
    IdentityAccountCommandController.method.delete.input,
    id,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<
    typeof IdentityAccountCommandController.method.delete.input
  >("identityaccount-delete", deps.logger)
    .addStep(
      newAuthorizeStep(
        IdentityAccountCommandController.method.delete,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    .addStep(newExtractResourceIdStep())
    .addStep(newLoadExistingAccountForDeleteStep(deps.accounts))
    .addStep(newDeleteAccountStep(deps.accounts))
    .addStep(
      newCleanupIamPoliciesStep(deps.authorizationLifecycle, deps.logger),
    )
    .build()
    .execute(reqCtx);

  const deleted = reqCtx.get(EXISTING_RESOURCE_KEY);
  if (deleted === undefined) {
    throw internalError(
      new Error("delete pipeline completed without a loaded resource"),
      "deleted identity account not found in context",
    );
  }
  return deleted as IdentityAccount;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Get — LoadTarget by id through the port; the domain's NOT_FOUND copy. */
async function get(
  deps: IdentityAccountControllerDeps,
  id: IdentityAccountId,
  ctx: HandlerContext,
): Promise<IdentityAccount> {
  return loadTarget(deps, IdentityAccountQueryController.method.get, id, ctx);
}

/** getActorInfo — the contract-shaped actor: id, avatar, "First Last", email. */
async function getActorInfo(
  deps: IdentityAccountControllerDeps,
  id: IdentityAccountId,
  ctx: HandlerContext,
): Promise<ApiResourceAuditActor> {
  const account = await loadTarget(
    deps,
    IdentityAccountQueryController.method.getActorInfo,
    id,
    ctx,
  );
  const firstName = account.spec?.firstName ?? "";
  const lastName = account.spec?.lastName ?? "";
  return create(ApiResourceAuditActorSchema, {
    id: account.metadata?.id ?? "",
    avatar: account.spec?.pictureUrl ?? "",
    displayName: `${firstName} ${lastName}`.trim(),
    email: account.spec?.email ?? "",
  });
}

async function loadTarget(
  deps: IdentityAccountControllerDeps,
  method: DescMethod,
  id: IdentityAccountId,
  ctx: HandlerContext,
): Promise<IdentityAccount> {
  const reqCtx = new RequestContext(
    method.input,
    id,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<DescMessage>(
    `identityaccount-${method.localName}`,
    deps.logger,
  )
    .addStep(newAuthorizeStep(method, deps.authorizer))
    .addStep(newValidateProtoStep())
    .addStep(newLoadTargetAccountStep(deps.accounts))
    .build()
    .execute(reqCtx);
  return reqCtx.get(TARGET_RESOURCE_KEY) as IdentityAccount;
}

/**
 * whoAmI — the cloud's lookup verbatim: by the resolved identity, then by
 * the derived id of the caller's subject for a caller whose identity is
 * still idp-shaped (an unprovisioned OIDC subject), then NOT_FOUND with
 * the cloud's copy. Two primary-key reads at most; no scan.
 */
async function whoAmI(
  deps: IdentityAccountControllerDeps,
  _empty: Empty,
  ctx: HandlerContext,
): Promise<IdentityAccount> {
  const caller = callerIdentityOf(ctx);
  let account = await read(
    () => deps.accounts.findById(caller.identityId),
    "failed to load identity account",
  );
  if (account === undefined) {
    account = await read(
      () => deps.accounts.findDirectByIdpId(idpIdOf(caller)),
      "failed to load identity account",
    );
  }
  if (account === undefined) {
    throw new ConnectError(ACCOUNT_NOT_FOUND_FOR_CALLER_MESSAGE, Code.NotFound);
  }
  return account;
}

/** getByEmail — direct accounts only; lookup first, authorize on the FOUND id. */
async function getByEmail(
  deps: IdentityAccountControllerDeps,
  email: IdentityAccountEmail,
  ctx: HandlerContext,
): Promise<IdentityAccount> {
  return lookupThenAuthorize(
    deps,
    IdentityAccountQueryController.method.getByEmail,
    email,
    ctx,
    () => deps.accounts.findDirectByEmail(email.value),
    email.value,
  );
}

/** getByIdpId — any provisioning mode; lookup first, authorize on the FOUND id. */
async function getByIdpId(
  deps: IdentityAccountControllerDeps,
  idpId: IdpId,
  ctx: HandlerContext,
): Promise<IdentityAccount> {
  return lookupThenAuthorize(
    deps,
    IdentityAccountQueryController.method.getByIdpId,
    idpId,
    ctx,
    () => deps.accounts.findByIdpId(idpId.value),
    idpId.value,
  );
}

async function lookupThenAuthorize(
  deps: IdentityAccountControllerDeps,
  method: DescMethod,
  input: IdentityAccountEmail | IdpId,
  ctx: HandlerContext,
  lookup: () => Promise<IdentityAccount | undefined>,
  handle: string,
): Promise<IdentityAccount> {
  const account = await read(lookup, "failed to look up identity account");
  if (account === undefined) {
    throw accountNotFoundError(handle);
  }
  await authorizeDirect(method, deps.authorizer, callerIdentityOf(ctx), input, {
    resourceId: account.metadata?.id ?? "",
  });
  return account;
}

// ---------------------------------------------------------------------------
// Provisioning
// ---------------------------------------------------------------------------

/**
 * provisionMyAccount — the subject from the caller's credential, the
 * provisioner's flow, then the composed post-persist gates (the cloud's
 * personal organization) with the caller RE-STAMPED as the account: the
 * position-1 identity was idp-shaped because no row existed when the
 * verifier ran, and a gate that attributes ownership must name the
 * account, never a principal no later request carries. The gates run on
 * EVERY call, the idempotent early return included — the cloud's step
 * backfills accounts that predate personal organizations there, which is
 * why Q-IA-9 chose a slot over onResourceCreated. Non-transactional in
 * the `org-create:post-persist` sense: a gate failure fails the request,
 * the row survives, the next call heals it.
 */
async function provisionMyAccount(
  deps: IdentityAccountControllerDeps,
  _empty: Empty,
  ctx: HandlerContext,
): Promise<IdentityAccount> {
  const caller = callerIdentityOf(ctx);
  const idpId = idpIdOf(caller);
  if (idpId === "") {
    throw new ConnectError(NO_IDP_ID_MESSAGE, Code.Unauthenticated);
  }
  let account: IdentityAccount;
  try {
    account = await deps.provisioner.provisionDirectAccount(idpId, caller);
  } catch (error) {
    if (error instanceof UserInfoFetchError) {
      throw new ConnectError(
        `${USERINFO_UNAVAILABLE_PREFIX}${error.message}`,
        Code.Unavailable,
      );
    }
    throw error;
  }
  // The ratified provision slot (Q-IA-9; the gate-slots.ts header carries
  // its semantics). Empty in OSS — no pipeline is built for zero steps.
  const gates = stepsForSlot<typeof IdentityAccountSchema>(
    deps.gateSteps,
    "identity-account-provision:post-persist",
  );
  if (gates.length > 0) {
    const asAccount: CallerIdentity = {
      ...caller,
      identityId: account.metadata?.id ?? "",
    };
    const reqCtx = new RequestContext(
      IdentityAccountSchema,
      account,
      asAccount,
      kindOf(ctx),
    );
    const pipeline = newPipeline<typeof IdentityAccountSchema>(
      "identityaccount-provision-post-persist",
      deps.logger,
    );
    for (const step of gates) {
      pipeline.addStep(step);
    }
    await pipeline.build().execute(reqCtx);
  }
  return account;
}

// ---------------------------------------------------------------------------
// Federation
// ---------------------------------------------------------------------------

/**
 * The four federated RPCs' shared shape: refuse UNIMPLEMENTED when no
 * unit composes the capability; otherwise the cloud's precondition arms
 * verbatim — ref-with-slug required, org match, authorize on the org, IdP
 * exists — then the unit's arm with the resolved ref.
 */
interface FederatedInput extends Message {
  readonly org: string;
  readonly identityProviderRef?: ApiResourceReference;
}

async function federated<Input extends FederatedInput>(
  deps: IdentityAccountControllerDeps,
  ctx: HandlerContext,
  method: DescMethod,
  input: Input,
  arm: (
    federation: IdentityFederation,
    ref: ApiResourceReference,
    caller: CallerIdentity,
  ) => Promise<IdentityAccount>,
): Promise<IdentityAccount> {
  const federation = deps.federation;
  if (federation === undefined) {
    throw new ConnectError(
      federationUnimplementedMessage(
        `${method.parent.typeName}.${method.localName}`,
      ),
      Code.Unimplemented,
    );
  }
  const caller = callerIdentityOf(ctx);
  const org = input.org;
  const ref = input.identityProviderRef;
  if (ref === undefined || ref.slug === "") {
    throw invalidArgumentError(
      "identity_provider_ref with a valid slug is required",
    );
  }
  if (ref.org !== "" && ref.org !== org) {
    throw invalidArgumentError(
      `identity_provider_ref.org '${ref.org}' does not match input org '${org}'`,
    );
  }
  // The annotation's target is the org (`field_path = "org"`); resolved
  // from the input exactly as the pipeline step would.
  await authorizeDirect(method, deps.authorizer, caller, input);
  const refOrg = ref.org !== "" ? ref.org : org;
  if (!(await federation.providerExists(refOrg, ref.slug))) {
    throw new ConnectError(
      `IdentityProvider '${refOrg}/${ref.slug}' not found`,
      Code.NotFound,
    );
  }
  ref.org = refOrg;
  return arm(federation, ref, caller);
}

/** A direct handler's store read: a fault is INTERNAL with a static message, never "not found". */
async function read<T>(
  operation: () => Promise<T>,
  message: string,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw internalError(error, message);
  }
}
