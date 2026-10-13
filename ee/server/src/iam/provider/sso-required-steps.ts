/**
 * The rules on the switch that makes an organization require sign-in
 * through its SSO provider (`IdentityProviderSpec.sso_required`), as steps
 * the provider's create, update and delete chains splice (handlers.ts):
 *
 *   - Owners decide it. Requiring a sign-in decides how every member gets
 *     in, so turning it on or off, deleting a provider that has it on
 *     (which ends the requirement), and, while it is on, changing whom the
 *     provider trusts (its issuers, key set or audience, which decide whose
 *     tokens count as the organization's people) also asks
 *     `can_assign_roles` on the organization, which only its owners hold:
 *     the invitation lane's precedent for an owner link. Otherwise an admin
 *     could point a required provider at an identity provider of their own
 *     and sign in people the organization never vetted. Admins keep editing
 *     everything else on the provider. Asked of the composed Authorizer, so a bound credential
 *     and the sign-in rule itself answer as everywhere (an owner is exempt
 *     from the requirement, so an owner is never refused it here).
 *   - A host whose plans decide it gates turning it on (`SsoPlanGate`, the
 *     team plan gate's shape: one question, absent means allowed, the
 *     refusal PLAN_UPGRADE_REQUIRED with the feature in its metadata). An
 *     organization that lost the feature keeps a requirement it already
 *     has, and may always turn it off: only turning it on asks.
 *   - Turning it off is never growth. The update chain's growth step lets
 *     through an update whose only change from the stored provider is
 *     turning the switch off, so a server whose license has lapsed can still
 *     reopen its organization's sign-in without deleting the provider and
 *     every account it made (iam/growth-gate.ts says what growth is).
 */
import { clone, equals } from "@bufbuild/protobuf";
import type { DescMessage } from "@bufbuild/protobuf";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { IdentityProvider } from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/api_pb";
import { IdentityProviderSpecSchema } from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/spec_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import type { Authorizer, PipelineStep, RequestContext } from "@stigmer/server";
import { failedPreconditionError, newAuthorizeResolvedTargetStep } from "@stigmer/server";

import type { GrowthGate } from "../growth-gate.js";
import { normalizeIssuerUrl } from "./issuer-url.js";
import { PLAN_UPGRADE_REQUIRED } from "../team/plan-gate.js";

/** The refusal of an admin who is not an owner. */
export const OWNERS_DECIDE_SSO_REQUIRED_MESSAGE =
  "Only the organization's owners may change whether its members must sign in through its SSO provider";

/** The feature a plan refusal names (the contract's `Feature.sso_enforcement`). */
export const SSO_ENFORCEMENT_FEATURE = "sso_enforcement";

export interface SsoPlanGate {
  /** Whether `orgId`'s plan lets it require sign-in through its SSO provider right now. */
  allowsSsoEnforcement(orgId: string): Promise<boolean>;
}

/** The plan refusal: the organization's plan does not include SSO enforcement. */
export function ssoEnforcementNeedsAPlan(orgId: string): ReturnType<typeof failedPreconditionError> {
  return failedPreconditionError(
    `Organization '${orgId}' is on a plan without SSO enforcement. Upgrade its plan to require sign-in through its SSO provider.`,
    { reason: PLAN_UPGRADE_REQUIRED, metadata: { feature: SSO_ENFORCEMENT_FEATURE, org: orgId } },
  );
}

/**
 * Asks `can_assign_roles` on the provider's organization when `touches`
 * says the request changes the requirement; asks nothing otherwise.
 */
export function newOwnersDecideSsoRequiredStep<Desc extends DescMessage>(
  authorizer: Authorizer,
  touches: (ctx: RequestContext<Desc>) => IdentityProvider | undefined,
): PipelineStep<Desc> {
  return newAuthorizeResolvedTargetStep<Desc>(
    authorizer,
    (ctx) => {
      const provider = touches(ctx);
      return provider === undefined
        ? []
        : [
            {
              permission: IamPermission.can_assign_roles,
              resourceKind: ApiResourceKind.organization,
              resourceId: provider.metadata?.org ?? "",
              deniedMessage: OWNERS_DECIDE_SSO_REQUIRED_MESSAGE,
            },
          ];
    },
    "OwnersDecideSsoRequired",
  );
}

/** The plan gate's step, asked only when the request turns the requirement on. */
export function newSsoPlanGateStep<Desc extends DescMessage>(
  gate: SsoPlanGate,
  turnsOn: (ctx: RequestContext<Desc>) => IdentityProvider | undefined,
): PipelineStep<Desc> {
  return {
    name: "SsoPlanGate",
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      const provider = turnsOn(ctx);
      if (provider === undefined) {
        return;
      }
      const org = provider.metadata?.org ?? "";
      if (!(await gate.allowsSsoEnforcement(org))) {
        throw ssoEnforcementNeedsAPlan(org);
      }
    },
  };
}

/**
 * The update chain's growth step: the gate asked unless the update's only
 * change from the stored provider is turning the requirement off.
 */
export function newProviderUpdateGrowthGateStep<Desc extends DescMessage>(
  gate: GrowthGate,
  states: (ctx: RequestContext<Desc>) => { readonly stored: IdentityProvider; readonly next: IdentityProvider },
): PipelineStep<Desc> {
  return {
    name: "GrowthGate",
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      const { stored, next } = states(ctx);
      if (onlyTurnsSsoRequiredOff(stored, next)) {
        return;
      }
      gate.assertGrowthAllowed();
    },
  };
}

/** Whether `next` differs from `stored` in nothing but the requirement going from on to off. */
export function onlyTurnsSsoRequiredOff(stored: IdentityProvider, next: IdentityProvider): boolean {
  const before = stored.spec;
  const after = next.spec;
  if (before === undefined || after === undefined || !before.ssoRequired || after.ssoRequired) {
    return false;
  }
  const restored = clone(IdentityProviderSpecSchema, after);
  restored.ssoRequired = true;
  return (
    equals(IdentityProviderSpecSchema, restored, before) &&
    (next.metadata?.name ?? "") === (stored.metadata?.name ?? "") &&
    labelsEqual(next.metadata?.labels ?? {}, stored.metadata?.labels ?? {})
  );
}

/** Whether a create sets the requirement; the provider when it does. */
export function createSetsSsoRequired(provider: IdentityProvider): IdentityProvider | undefined {
  return provider.spec?.ssoRequired === true ? provider : undefined;
}

/**
 * Whether an update is the owners' to make: it changes the requirement, or
 * changes whom a provider that requires sign-in trusts. The new provider
 * when it is.
 */
export function updateNeedsOwners(stored: IdentityProvider, next: IdentityProvider): IdentityProvider | undefined {
  if ((stored.spec?.ssoRequired ?? false) !== (next.spec?.ssoRequired ?? false)) {
    return next;
  }
  return stored.spec?.ssoRequired === true && changesTrust(stored, next) ? next : undefined;
}

/** Whether `next` trusts other tokens than `stored`: its issuers, key set or audience. */
function changesTrust(stored: IdentityProvider, next: IdentityProvider): boolean {
  const before = stored.spec;
  const after = next.spec;
  // Compared as the row will store them (validation.ts normalizeIssuers),
  // so a respelled issuer is not a change of trust.
  const issuers = (spec: typeof before) =>
    [...new Set((spec?.allowedIssuers ?? []).map(normalizeIssuerUrl).filter((issuer) => issuer !== ""))]
      .sort()
      .join("\n");
  return (
    (before?.jwksUri ?? "") !== (after?.jwksUri ?? "") ||
    (before?.expectedAudience ?? "") !== (after?.expectedAudience ?? "") ||
    issuers(before) !== issuers(after)
  );
}

/** Whether an update turns the requirement on; the new provider when it does. */
export function updateTurnsSsoRequiredOn(
  stored: IdentityProvider,
  next: IdentityProvider,
): IdentityProvider | undefined {
  return stored.spec?.ssoRequired !== true && next.spec?.ssoRequired === true ? next : undefined;
}

function labelsEqual(a: Readonly<Record<string, string>>, b: Readonly<Record<string, string>>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}
