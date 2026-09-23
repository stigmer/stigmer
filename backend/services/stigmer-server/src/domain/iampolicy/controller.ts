/**
 * IamPolicy controller (20260913.01, T01_0_plan.md §3a; T01_1_review.md
 * Q-OR-2, Q-OR-3, Q-OR-7, Q-OR-8 and the slice-5 rulings Q-S5-1..10) —
 * the ROW half of the IamPolicy contract served ONCE by @stigmer/server in
 * every edition, all fourteen RPCs. The behavioural reference is the
 * cloud's iam/policy/handlers.ts (the Java pipelines rendered flat), whose
 * handlers retire against this module at the S3 re-point; the byte-pinned
 * copy moved with it (constants.ts). The cloud keeps what differs per
 * edition and registers it: its row store (`drivers.iamPolicyStore`), its
 * grant scope (`drivers.policyGrantScope`), its OpenFGA query engine
 * (`drivers.authorizationQueries`) and the tuple mirror in the lifecycle
 * driver's two policy hooks — and reaches the write lanes here as
 * in-process RPCs (Q-OR-1), never through an exported constructor.
 *
 * Shape (Q-S5-1). The six command RPCs are pipeline chains, each
 * `Authorize → ValidateProto → <one domain step>` (steps.ts): the write is
 * the grant path's, the annotation drives position 1, and the executor's
 * fault mapping covers a store fault from inside the path. The eight
 * query RPCs are direct handlers over `authorizeDirect` (the cloud's
 * shape; the identity-account lookups' precedent). No chain here splices
 * a tuple step: a policy is the authorization record, not a protected
 * resource — the cloud builds policies outside any chain, the FGA
 * `iam_policy` type is dead, and seeding scope links for a row would
 * recurse (the ts-server guideline records this exception).
 *
 * What the cloud's handlers recorded as surprises, kept or corrected:
 *   - `delete` and `create` are idempotent (absent → the default instance;
 *     held → the row). `delete` now authorizes BEFORE it loads (Q-OR-2:
 *     the annotation names the spec's resource), so a caller without
 *     `can_grant_access` hears PERMISSION_DENIED even for an absent
 *     triple — strictly safer than the cloud's silent default instance.
 *   - `create` validates the role BEFORE it writes (the cloud's order): a
 *     held row under a role the kind does not grant is refused, never
 *     answered as a duplicate. It also grants to PEOPLE and TEAMS only
 *     (Q-S9-2, 2026-09-14): any other principal is INVALID_ARGUMENT, and a
 *     team only on the roles its kind lets a team hold (steps.ts) and,
 *     where an edition serves teams, only a team the create gate slot
 *     admits — a row naming a resource as its principal is the
 *     structural link the hierarchy walk follows, `bootstrapPolicy`'s to
 *     write, and through this lane would have let a right on one
 *     organization list another's members. The cloud's create had the
 *     gap; the corrected answer lands at the re-point.
 *   - `checkMyPermission`, `checkAuthorization` and
 *     `listAuthorizedResourceIds` skip position 1 by proto option (IAM
 *     authorizing IAM would recurse); trust is authentication plus the
 *     principal-trust rule, compared against the caller's ACCOUNT
 *     (`accountForCaller`, Q-S4-1 — the trusted-local interceptor stamps
 *     the operator's email, so the stamp alone would never match).
 *   - `listAuthorizedPrincipalIds` is annotation-driven since slice 1
 *     (finding 7): the same target `listResourceAccessByPrincipal` checks.
 *   - `get` is the one load-then-authorize lane: its target is the ROW's
 *     resource, handed to the annotation's evaluation as an override.
 *   - the three system RPCs (`bootstrapPolicy`, `cleanupResourcePolicies`,
 *     `bootstrapRevokeOrgAccess`) admit the platform's own pipelines only
 *     (`isPlatformPipelineCaller`) and refuse a wire user
 *     PERMISSION_DENIED with the annotation's own `error_msg`, BEFORE the
 *     chain — under the permissive Authorizer the annotation alone would
 *     admit anyone (Q-OR-7). Position 1 still runs the static platform
 *     check, so the cloud's `can_bootstrap_iam` FGA check is unchanged.
 *   - every kind string that came off the wire passes the domain's wire
 *     refusals (Q-S5-2) BEFORE position 1 (Q-S6-1, 2026-09-14):
 *     INVALID_ARGUMENT with the pinned copy, on every lane, in every
 *     edition. This is not input validation moved ahead of authorization
 *     — it is naming the authorization target. A kind string that names
 *     no kind names nothing to authorize against, so there is no
 *     position-1 question to ask; `checkMyPermission` refuses an unknown
 *     permission name first for the same reason, and the cloud's
 *     handlers kept this order (`kindFromSpecString` before
 *     `authorizeRpc`), so the wire is unchanged at the re-point. Safe by
 *     construction: the protovalidate interceptor (chain position 3) has
 *     validated every request before a handler runs, so both refs are
 *     present. The resolver's "resolution never throws" rule
 *     (steps/authorize.ts) is untouched — its unknown-kind deny remains
 *     the backstop for a stored row on `get`, the one kind string that is
 *     not wire input.
 *
 * `checkMyPermission` has one definition (Q-OR-8; Q-S5-3), in this order:
 * UNAUTHENTICATED for an empty identity; the relation must be an
 * IamPermission name; the resource kind must be known; contextual
 * policies ride the query engine or refuse UNIMPLEMENTED; then (1) a kind
 * this edition does not serve is `false` — nobody holds a permission on a
 * kind that does not exist here, which is what keeps the operator-only
 * settings navigation hidden on open source; (2) `can_grant_access` on a
 * kind outside the grant scope is `false` — the console's PermissionGate
 * hides grant controls with no new SDK surface (Q-OR-5); (3) the composed
 * Authorizer: allow → true, deny and not-found → false, unavailable →
 * INTERNAL, never softened into a denial.
 *
 * Proven by __tests__/controller.test.ts (every arm, over a router
 * transport with fakes), __tests__/iampolicy.test.ts (the composed
 * trusted-local server) and the iampolicy conformance suite.
 */
import { create } from "@bufbuild/protobuf";
import type { DescMessage, DescMethod } from "@bufbuild/protobuf";
import { getOption } from "@bufbuild/protobuf";
import { EmptySchema } from "@bufbuild/protobuf/wkt";
import type { Empty } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import type { ConnectRouter, HandlerContext } from "@connectrpc/connect";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { config as rpcAuthorizationConfig } from "@stigmer/protos/ai/stigmer/commons/rpc/method_options_pb";
import type { IamPolicy } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/api_pb";
import { IamPolicyCommandController } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/command_pb";
import type {
  CheckAuthorizationInput,
  CheckAuthorizationResult,
  CheckMyPermissionInput,
  GetPrincipalsCountInput,
  IamPolicyId,
  ListAuthorizedPrincipalIdsInput,
  ListAuthorizedResourceIdsInput,
  ListResourceAccessInput,
  PrincipalResourceInput,
  RevokeOrgAccessInput,
} from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/io_pb";
import {
  AuthorizedPrincipalIdsListSchema,
  AuthorizedResourceIdsListSchema,
  CheckAuthorizationResultSchema,
  PrincipalResourceRolesSchema,
  PrincipalsCountSchema,
  ResourceAccessByPrincipalListSchema,
  RevokeOrgAccessInputSchema,
} from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/io_pb";
import { IamPolicyQueryController } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/query_pb";
import type {
  ApiResourceRef,
  IamPolicySpec,
} from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/spec_pb";
import {
  ApiResourceRefSchema,
  IamPolicySpecSchema,
} from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/spec_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import type { ServerEdition } from "@stigmer/protos/ai/stigmer/platform/v1/server_info_pb";

import type { Logger } from "../../boot/logger.js";
import type { AuthorizationQueryEngine } from "../../extensions/authorization-queries.js";
import type { Authorizer } from "../../extensions/authorizer.js";
import { stepsForSlot } from "../../extensions/gate-slots.js";
import type { ResolvedGateSteps } from "../../extensions/gate-slots.js";
import { isPlatformPipelineCaller } from "../../extensions/identity.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import type { PolicyGrantScope } from "../../extensions/policy-grant-scope.js";
import type { PrincipalDisplay } from "../../extensions/principal-display.js";
import {
  kindByEnumName,
  kindEnumName,
  kindServedByEdition,
} from "../../pipeline/apiresource-meta.js";
import { internalError } from "../../pipeline/errors.js";
import { apiResourceKindKey } from "../../pipeline/interceptors/apiresource.js";
import { callerIdentityOf } from "../../pipeline/interceptors/auth.js";
import { newPipeline } from "../../pipeline/pipeline.js";
import { RequestContext } from "../../pipeline/request-context.js";
import {
  AUTHORIZATION_UNAVAILABLE_MESSAGE,
  authorizeDirect,
  evaluateAuthorizer,
  newAuthorizeStep,
} from "../../pipeline/steps/authorize.js";
import { newValidateProtoStep } from "../../pipeline/steps/validation.js";
import { accountForCaller } from "../identityaccount/resolve.js";
import type { AccountsByCaller } from "../identityaccount/resolve.js";
import { buildPrincipalAccessList, resolveHierarchy } from "./access-lists.js";
import {
  AUTHENTICATION_REQUIRED_MESSAGE,
  AUTHORIZATION_QUERIES_UNIMPLEMENTED_MESSAGE,
  policyNotFoundMessage,
  unknownPermissionMessage,
} from "./constants.js";
import { newAccountDisplayResolver } from "./display-resolver.js";
import type { AccountsByIds } from "./display-resolver.js";
import type { IamPolicyGrantPath } from "./grant-path.js";
import { permissionByEnumName } from "./permissions.js";
import {
  assignableRelations,
  isAssignableRole,
  roleInfoFromRelation,
} from "./roles.js";
import {
  POLICY_RESULT_KEY,
  newCleanupResourceStep,
  newGrantStep,
  newRevokeOrgAccessStep,
  newRevokeStep,
  newValidateGrantableRoleStep,
} from "./steps.js";
import type { IamPolicyStore } from "./store.js";
import {
  refsOf,
  requireKnownPrincipalKind,
  requireKnownResourceKind,
  requireWellFormedTriple,
} from "./wire-refusals.js";

/**
 * The Java pre-migration `_self` principal alias — rejected with a
 * pointer at checkMyPermission (kept only for the precise error copy).
 */
const SELF_PRINCIPAL_ID = "_self";

/** The reads this controller makes of the identity-account port: the caller's account and display enrichment. */
export type IamPolicyAccounts = AccountsByCaller & AccountsByIds;

export interface IamPolicyControllerDeps {
  readonly grantPath: IamPolicyGrantPath;
  readonly policies: IamPolicyStore;
  readonly accounts: IamPolicyAccounts;
  /** The ONE composed Authorizer — position 1 of every chain and every direct handler's `authorizeDirect`. */
  readonly authorizer: Authorizer;
  /** The composed grant scope, or open source's organization-only default (compose.ts installs it at the `??` site). */
  readonly grantScope: PolicyGrantScope;
  /** The composed query engine — undefined = the tuple-half RPCs refuse UNIMPLEMENTED. */
  readonly queries: AuthorizationQueryEngine | undefined;
  /** The composed principal display — undefined = a non-person grantee renders in the id fallback shape. */
  readonly principalDisplay: PrincipalDisplay | undefined;
  /** The merged gate steps; `create` splices `iam-policy-create:pre-side-effect-gate`. */
  readonly gateSteps: ResolvedGateSteps;
  /** The served edition — `checkMyPermission`'s first arm reads a kind's tier against it. */
  readonly edition: ServerEdition;
  readonly logger: Logger;
}

/** Registers both IamPolicy services on the router (routes stage). */
export function registerIamPolicyServices(
  router: ConnectRouter,
  deps: IamPolicyControllerDeps,
): void {
  const displayResolver = newAccountDisplayResolver(deps.accounts);
  const command = IamPolicyCommandController.method;

  router.service(IamPolicyCommandController, {
    create: (spec, ctx) => createPolicy(deps, spec, ctx),
    delete: (spec, ctx) => deletePolicy(deps, spec, ctx),
    bootstrapPolicy: (spec, ctx) => {
      guardSystemRpc(command.bootstrapPolicy, callerIdentityOf(ctx));
      return grantThroughChain(deps, command.bootstrapPolicy, spec, ctx, false);
    },
    cleanupResourcePolicies: (ref, ctx) => {
      guardSystemRpc(command.cleanupResourcePolicies, callerIdentityOf(ctx));
      return cleanupResourcePolicies(deps, ref, ctx);
    },
    revokeOrgAccess: (input, ctx) =>
      revokeOrgAccess(deps, command.revokeOrgAccess, input, ctx),
    bootstrapRevokeOrgAccess: (input, ctx) => {
      guardSystemRpc(command.bootstrapRevokeOrgAccess, callerIdentityOf(ctx));
      return revokeOrgAccess(
        deps,
        command.bootstrapRevokeOrgAccess,
        input,
        ctx,
      );
    },
  });

  router.service(IamPolicyQueryController, {
    get: (id, ctx) => get(deps, id, ctx),
    checkMyPermission: (input, ctx) => checkMyPermission(deps, input, ctx),
    checkAuthorization: (input, ctx) => checkAuthorization(deps, input, ctx),
    listAuthorizedResourceIds: (input, ctx) =>
      listAuthorizedResourceIds(deps, input, ctx),
    listAuthorizedPrincipalIds: (input, ctx) =>
      listAuthorizedPrincipalIds(deps, input, ctx),
    listResourceAccessByPrincipal: (input, ctx) =>
      listResourceAccessByPrincipal(deps, displayResolver, input, ctx),
    getPrincipalResourceRoles: (input, ctx) =>
      getPrincipalResourceRoles(deps, input, ctx),
    getPrincipalsCount: (input, ctx) => getPrincipalsCount(deps, input, ctx),
  });
}

function kindOf(ctx: HandlerContext): ApiResourceKind {
  return ctx.values.get(apiResourceKindKey);
}

/**
 * The admission rule of the three system RPCs (Q-OR-7): the platform's own
 * pipelines only, refused with the RPC's own annotation copy — the proto
 * owns that sentence, so no second pinned copy exists here.
 */
function guardSystemRpc(method: DescMethod, caller: CallerIdentity): void {
  if (isPlatformPipelineCaller(caller)) {
    return;
  }
  throw new ConnectError(
    getOption(method, rpcAuthorizationConfig).errorMsg,
    Code.PermissionDenied,
  );
}

// ---------------------------------------------------------------------------
// The command chains
// ---------------------------------------------------------------------------

/**
 * `create`: the wire refusal, then Authorize → ValidateProto →
 * ValidateGrantableRole → [iam-policy-create:pre-side-effect-gate] → Grant.
 */
function createPolicy(
  deps: IamPolicyControllerDeps,
  spec: IamPolicySpec,
  ctx: HandlerContext,
): Promise<IamPolicy> {
  requireWellFormedTriple(spec);
  return grantThroughChain(
    deps,
    IamPolicyCommandController.method.create,
    spec,
    ctx,
    true,
  );
}

/**
 * The grant chain both `create` and `bootstrapPolicy` run; only the user
 * lane validates the role and runs the create gate slot — bootstrap writes
 * structural relations no scope would admit and no edition gates.
 */
async function grantThroughChain(
  deps: IamPolicyControllerDeps,
  method: DescMethod,
  spec: IamPolicySpec,
  ctx: HandlerContext,
  validateRole: boolean,
): Promise<IamPolicy> {
  const reqCtx = new RequestContext(
    IamPolicySpecSchema,
    spec,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  const pipeline = newPipeline<typeof IamPolicySpecSchema>(
    `iampolicy-${method.localName}`,
    deps.logger,
  )
    .addStep(newAuthorizeStep(method, deps.authorizer))
    .addStep(newValidateProtoStep());
  if (validateRole) {
    pipeline.addStep(newValidateGrantableRoleStep(deps.grantScope));
    for (const step of stepsForSlot<typeof IamPolicySpecSchema>(
      deps.gateSteps,
      "iam-policy-create:pre-side-effect-gate",
    )) {
      pipeline.addStep(step);
    }
  }
  await pipeline.addStep(newGrantStep(deps.grantPath)).build().execute(reqCtx);
  return policyResultOf(reqCtx, method);
}

/** `delete`: the wire refusal, then Authorize → ValidateProto → Revoke; the revoked row, or the default instance. */
async function deletePolicy(
  deps: IamPolicyControllerDeps,
  spec: IamPolicySpec,
  ctx: HandlerContext,
): Promise<IamPolicy> {
  requireWellFormedTriple(spec);
  const method = IamPolicyCommandController.method.delete;
  const reqCtx = new RequestContext(
    IamPolicySpecSchema,
    spec,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof IamPolicySpecSchema>("iampolicy-delete", deps.logger)
    .addStep(newAuthorizeStep(method, deps.authorizer))
    .addStep(newValidateProtoStep())
    .addStep(newRevokeStep(deps.grantPath))
    .build()
    .execute(reqCtx);
  return policyResultOf(reqCtx, method);
}

/** `revokeOrgAccess` and its system twin share one chain; only the annotation differs. */
async function revokeOrgAccess(
  deps: IamPolicyControllerDeps,
  method: DescMethod,
  input: RevokeOrgAccessInput,
  ctx: HandlerContext,
): Promise<Empty> {
  const reqCtx = new RequestContext(
    RevokeOrgAccessInputSchema,
    input,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof RevokeOrgAccessInputSchema>(
    `iampolicy-${method.localName}`,
    deps.logger,
  )
    .addStep(newAuthorizeStep(method, deps.authorizer))
    .addStep(newValidateProtoStep())
    .addStep(newRevokeOrgAccessStep(deps.grantPath))
    .build()
    .execute(reqCtx);
  return create(EmptySchema);
}

async function cleanupResourcePolicies(
  deps: IamPolicyControllerDeps,
  ref: ApiResourceRef,
  ctx: HandlerContext,
): Promise<Empty> {
  const method = IamPolicyCommandController.method.cleanupResourcePolicies;
  const reqCtx = new RequestContext(
    ApiResourceRefSchema,
    ref,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof ApiResourceRefSchema>(
    "iampolicy-cleanupResourcePolicies",
    deps.logger,
  )
    .addStep(newAuthorizeStep(method, deps.authorizer))
    .addStep(newValidateProtoStep())
    .addStep(newCleanupResourceStep(deps.grantPath))
    .build()
    .execute(reqCtx);
  return create(EmptySchema);
}

function policyResultOf<Desc extends DescMessage>(
  reqCtx: RequestContext<Desc>,
  method: DescMethod,
): IamPolicy {
  const result = reqCtx.get(POLICY_RESULT_KEY);
  if (result === undefined) {
    throw internalError(
      new Error(`${method.localName} pipeline completed without a policy`),
      "policy not found in context",
    );
  }
  return result as IamPolicy;
}

// ---------------------------------------------------------------------------
// The direct query handlers
// ---------------------------------------------------------------------------

/** `get`: load THEN authorize — the target is the row's resource. */
async function get(
  deps: IamPolicyControllerDeps,
  id: IamPolicyId,
  ctx: HandlerContext,
): Promise<IamPolicy> {
  const policy = await read(
    () => deps.policies.findById(id.value),
    "failed to load IAM policy",
  );
  if (policy === undefined) {
    throw new ConnectError(policyNotFoundMessage(id.value), Code.NotFound);
  }
  // A stored row is not wire input: its kind resolves without a refusal
  // sentence (a legacy row with an unknown kind is the Authorizer's to
  // deny, as position 1 would), and its id is the target.
  const { resource } = refsOf(specOfRow(policy));
  await authorizeDirect(
    IamPolicyQueryController.method.get,
    deps.authorizer,
    callerIdentityOf(ctx),
    id,
    { resourceKind: kindByEnumName(resource.kind), resourceId: resource.id },
  );
  return policy;
}

/** The one definition — see the module header for the order and its reasons. */
async function checkMyPermission(
  deps: IamPolicyControllerDeps,
  input: CheckMyPermissionInput,
  ctx: HandlerContext,
): Promise<CheckAuthorizationResult> {
  const caller = requireAuthenticated(callerIdentityOf(ctx));
  const permission = permissionByEnumName(input.relation);
  if (permission === undefined) {
    throw new ConnectError(
      unknownPermissionMessage(input.relation),
      Code.InvalidArgument,
    );
  }
  const resource = requireRef(input.resource);
  const resourceKind = requireKnownResourceKind(resource.kind);

  if (input.contextualPolicies.length > 0) {
    const engine = requireQueryEngine(deps);
    const principal = create(ApiResourceRefSchema, {
      kind: kindEnumName(ApiResourceKind.identity_account),
      id: await callerPrincipalId(deps, caller),
    });
    const policy = create(IamPolicySpecSchema, {
      principal,
      relation: input.relation,
      resource,
    });
    const allowed = await engine.check(policy, input.contextualPolicies);
    return create(CheckAuthorizationResultSchema, { isAuthorized: allowed });
  }

  // Arm 1: nobody holds a permission on a kind this edition does not serve.
  if (!kindServedByEdition(resourceKind, deps.edition)) {
    return create(CheckAuthorizationResultSchema, { isAuthorized: false });
  }
  // Arm 2: a grant target outside the composed scope is nobody's to grant.
  if (
    permission === IamPermission.can_grant_access &&
    deps.grantScope.grantableRoles(resourceKind).length === 0
  ) {
    return create(CheckAuthorizationResultSchema, { isAuthorized: false });
  }
  // Arm 3: the composed Authorizer's answer, an outage never softened.
  const decision = await evaluateAuthorizer(deps.authorizer, caller, {
    permission,
    resourceKind,
    resourceId: resource.id,
  });
  switch (decision.kind) {
    case "allow":
      return create(CheckAuthorizationResultSchema, { isAuthorized: true });
    case "deny":
    case "not-found":
      return create(CheckAuthorizationResultSchema, { isAuthorized: false });
    case "unavailable":
      throw internalError(decision.cause, AUTHORIZATION_UNAVAILABLE_MESSAGE);
    default: {
      const exhaustive: never = decision;
      throw internalError(
        new Error(`unknown decision ${JSON.stringify(exhaustive)}`),
        AUTHORIZATION_UNAVAILABLE_MESSAGE,
      );
    }
  }
}

async function checkAuthorization(
  deps: IamPolicyControllerDeps,
  input: CheckAuthorizationInput,
  ctx: HandlerContext,
): Promise<CheckAuthorizationResult> {
  const caller = requireAuthenticated(callerIdentityOf(ctx));
  const policy = requireInputPolicy(input.policy);
  await enforcePrincipalTrust(deps, caller, policy.principal);
  requireWellFormedTriple(policy);
  const engine = requireQueryEngine(deps);
  const allowed = await engine.check(policy, input.contextualPolicies);
  return create(CheckAuthorizationResultSchema, { isAuthorized: allowed });
}

/** The skip lane with no resource (finding 7): trust on the principal, then the engine. */
async function listAuthorizedResourceIds(
  deps: IamPolicyControllerDeps,
  input: ListAuthorizedResourceIdsInput,
  ctx: HandlerContext,
) {
  const caller = requireAuthenticated(callerIdentityOf(ctx));
  const principal = requireRef(input.principal);
  await enforcePrincipalTrust(deps, caller, principal);
  requireKnownPrincipalKind(principal.kind);
  requireKnownResourceKind(input.resourceKind);
  const engine = requireQueryEngine(deps);
  const resourceIds = await engine.listResourceIds(
    principal,
    input.relation,
    input.resourceKind,
    input.contextualPolicies,
  );
  return create(AuthorizedResourceIdsListSchema, {
    resourceIds: [...resourceIds],
  });
}

async function listAuthorizedPrincipalIds(
  deps: IamPolicyControllerDeps,
  input: ListAuthorizedPrincipalIdsInput,
  ctx: HandlerContext,
) {
  const resource = requireRef(input.resource);
  requireKnownResourceKind(resource.kind);
  requireKnownPrincipalKind(input.principalKind);
  await authorizeDirect(
    IamPolicyQueryController.method.listAuthorizedPrincipalIds,
    deps.authorizer,
    callerIdentityOf(ctx),
    input,
  );
  const engine = requireQueryEngine(deps);
  const principalIds = await engine.listPrincipalIds(
    resource,
    input.relation,
    input.principalKind,
    input.contextualPolicies,
  );
  return create(AuthorizedPrincipalIdsListSchema, {
    principalIds: [...principalIds],
  });
}

async function listResourceAccessByPrincipal(
  deps: IamPolicyControllerDeps,
  displayResolver: ReturnType<typeof newAccountDisplayResolver>,
  input: ListResourceAccessInput,
  ctx: HandlerContext,
) {
  const resource = requireRef(input.resource);
  requireKnownResourceKind(resource.kind);
  await authorizeDirect(
    IamPolicyQueryController.method.listResourceAccessByPrincipal,
    deps.authorizer,
    callerIdentityOf(ctx),
    input,
  );
  const entries = await read(async () => {
    const hierarchy = await resolveHierarchy(
      deps.policies,
      resource.kind,
      resource.id,
      input.includeInherited,
    );
    return buildPrincipalAccessList(
      deps.policies,
      displayResolver,
      deps.principalDisplay,
      hierarchy,
    );
  }, "failed to list resource access");
  return create(ResourceAccessByPrincipalListSchema, {
    entries: [...entries],
  });
}

async function getPrincipalResourceRoles(
  deps: IamPolicyControllerDeps,
  input: PrincipalResourceInput,
  ctx: HandlerContext,
) {
  const resource = requireRef(input.resource);
  const principal = requireRef(input.principal);
  requireKnownResourceKind(resource.kind);
  requireKnownPrincipalKind(principal.kind);
  await authorizeDirect(
    IamPolicyQueryController.method.getPrincipalResourceRoles,
    deps.authorizer,
    callerIdentityOf(ctx),
    input,
  );
  const rows = await read(
    () =>
      deps.policies.findByPrincipalAndResource(
        principal.kind,
        principal.id,
        resource.kind,
        resource.id,
      ),
    "failed to load principal roles",
  );
  const roles = rows
    .map((policy) => policy.spec?.relation ?? "")
    .filter(isAssignableRole)
    .map(roleInfoFromRelation);
  return create(PrincipalResourceRolesSchema, { roles });
}

async function getPrincipalsCount(
  deps: IamPolicyControllerDeps,
  input: GetPrincipalsCountInput,
  ctx: HandlerContext,
) {
  // The wire's "" means any principal kind (the port's `undefined`).
  const principalKind =
    input.principalKind === "" ? undefined : input.principalKind;
  if (principalKind !== undefined) {
    requireKnownPrincipalKind(principalKind);
  }
  await authorizeDirect(
    IamPolicyQueryController.method.getPrincipalsCount,
    deps.authorizer,
    callerIdentityOf(ctx),
    input,
  );
  const count = await read(
    () =>
      deps.policies.countDistinctPrincipalsByResource(
        kindEnumName(ApiResourceKind.organization),
        input.orgId,
        principalKind,
        assignableRelations(),
      ),
    "failed to count principals",
  );
  return create(PrincipalsCountSchema, { count });
}

// ---------------------------------------------------------------------------
// Shared rules
// ---------------------------------------------------------------------------

/** Java's authenticated-caller precondition on the check handlers. */
function requireAuthenticated(caller: CallerIdentity): CallerIdentity {
  if (caller.identityId === "") {
    throw new ConnectError(
      AUTHENTICATION_REQUIRED_MESSAGE,
      Code.Unauthenticated,
    );
  }
  return caller;
}

/**
 * The principal the caller IS, for the engine and the trust rule: the
 * account `accountForCaller` resolves (the trusted-local stamp is an
 * email; a composition verifier that ran before any row existed stamps
 * a subject), else the stamped identity — an unprovisioned subject
 * matches no tuple, which is the cloud's answer for it too.
 */
async function callerPrincipalId(
  deps: IamPolicyControllerDeps,
  caller: CallerIdentity,
): Promise<string> {
  const account = await read(
    () => accountForCaller(deps.accounts, caller),
    "failed to resolve the caller's account",
  );
  return account?.metadata?.id ?? caller.identityId;
}

/**
 * The Java EnforcePrincipalTrust rules in order: the platform's own
 * pipelines (`machine`, `internal`) may ask about any principal; a user
 * only about their own account.
 */
async function enforcePrincipalTrust(
  deps: IamPolicyControllerDeps,
  caller: CallerIdentity,
  principal: ApiResourceRef | undefined,
): Promise<void> {
  if (caller.callerClass === "machine" || caller.callerClass === "internal") {
    return;
  }
  if (principal?.kind !== kindEnumName(ApiResourceKind.identity_account)) {
    throw new ConnectError(
      "Only self identity_account permission checks are supported",
      Code.InvalidArgument,
    );
  }
  const requestedId = principal.id;
  if (requestedId === "" || requestedId === SELF_PRINCIPAL_ID) {
    throw new ConnectError(
      `The '${SELF_PRINCIPAL_ID}' principal alias is not supported — ` +
        "use checkMyPermission for self permission checks",
      Code.InvalidArgument,
    );
  }
  if (requestedId !== (await callerPrincipalId(deps, caller))) {
    throw new ConnectError(
      "Principal must be the authenticated caller",
      Code.PermissionDenied,
    );
  }
}

/** The tuple-half capability, or the edition's UNIMPLEMENTED — never INTERNAL. */
function requireQueryEngine(
  deps: IamPolicyControllerDeps,
): AuthorizationQueryEngine {
  if (deps.queries === undefined) {
    throw new ConnectError(
      AUTHORIZATION_QUERIES_UNIMPLEMENTED_MESSAGE,
      Code.Unimplemented,
    );
  }
  return deps.queries;
}

/** Boundary-validated required refs — absence here is a contract bug. */
function requireRef(ref: ApiResourceRef | undefined): ApiResourceRef {
  if (ref === undefined) {
    throw internalError(
      new Error("required reference missing after boundary validation"),
      "required reference missing after boundary validation",
    );
  }
  return ref;
}

/** Boundary-validated required policy input — absence here is a contract bug. */
function requireInputPolicy(policy: IamPolicySpec | undefined): IamPolicySpec {
  if (policy === undefined) {
    throw internalError(
      new Error("required policy missing after boundary validation"),
      "required policy missing after boundary validation",
    );
  }
  return policy;
}

/** A stored row's spec — a row without one is corrupt storage, an infrastructure fault. */
function specOfRow(policy: IamPolicy): IamPolicySpec {
  if (policy.spec === undefined) {
    throw internalError(
      new Error(
        `policy ${policy.metadata?.id ?? "?"} has no spec — corrupt row`,
      ),
      "failed to load IAM policy",
    );
  }
  return policy.spec;
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
