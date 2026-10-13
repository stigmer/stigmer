/**
 * Enterprise's organization sign-in rule (@stigmer/server's
 * `drivers.organizationSignInRule`): an organization whose SSO provider
 * sets `sso_required` counts only the people that provider signed in.
 *
 * Why the principal, not the email. A federated account's id is derived
 * from its provider and subject, and the account names its provider
 * (`spec.identity_provider_ref`), so "came through Acme's Okta" is a fact
 * about the account a request acts as, true or false on every request with
 * no claim to trust. An email domain is not: nothing here verifies one. So
 * a person signed in another way (an email login, the server's own
 * sign-in), and an API key such an account made, bound to the organization
 * or not, is refused there; a key the federated account made keeps
 * working, since a key acts as the account that made it.
 *
 * Who is never refused:
 *   - the organization's owners, so a broken provider never locks everyone
 *     out: an owner keeps their own sign-in as the way back in. One policy
 *     pair read (the composition's own IamPolicy binding), never the
 *     composed Authorizer, which the credential binding asking this rule
 *     wraps;
 *   - the organization's own platform clients: a user token one of its
 *     clients minted speaks for a person the organization's app vouched
 *     for, bound to the organization;
 *   - every caller that is not a person: the binding asks about class
 *     `user` only (a service account, a run's credential, the platform's
 *     pipelines and the server itself are not asked).
 *
 * The organizations that require it are read from the live providers
 * through a cache, rebuilt at most every `ISSUER_CACHE_TTL_MS` and emptied
 * by every provider write and delete on this replica (the provider lanes
 * call `invalidate`, as they do the federated verifier's routes), so a
 * switch takes effect at once on the replica that wrote it and within that
 * TTL on the others. Concurrent rebuilds share one read. A caller's account
 * is read once per request (remembered on the caller object, the binding's
 * own idiom).
 *
 * The refusal names the provider so a console can send the person to it:
 * reason SSO_REQUIRED (the wire identifier documented on
 * `IdentityProviderSpec.sso_required`), metadata `org` (the organization's
 * id) and `provider` (the provider's slug).
 *
 * What the tests pin (__tests__/sign-in-rule.test.ts): the requiring set
 * from the live providers and its invalidation and TTL, the federated
 * account admitted and another provider's refused, the owner exemption, the
 * platform-client exemption, the account read once per caller, and the
 * refusal's reason and metadata.
 */
import type { IdentityAccount } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import type { IdentityProvider } from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/api_pb";
import { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import type {
  AuthzRefusal,
  CallerIdentity,
  ComposedIamPolicies,
  IdentityAccountStore,
  OrganizationSignInRule,
} from "@stigmer/server";
import { boundOrgOf, carriesPlatformClientClaim } from "@stigmer/server";

import { ISSUER_CACHE_TTL_MS } from "../federation/verifier.js";
import type { IdentityProviderStore } from "./store.js";

/** The reason a refused person's error carries (the contract's wire identifier). */
export const SSO_REQUIRED = "SSO_REQUIRED";

/** The refusal's copy: what the person reads, naming where to sign in. */
export function ssoRequiredMessage(providerDisplayName: string): string {
  const through = providerDisplayName === "" ? "its single sign-on provider" : providerDisplayName;
  return `This organization requires you to sign in through ${through}.`;
}

/** The rule as the identity unit holds it: the driver, and the invalidation the provider lanes call. */
export interface SsoSignInRule extends OrganizationSignInRule {
  /** Forget the requiring organizations; the next check reads them again. */
  invalidate(): void;
}

export interface SsoSignInRuleDeps {
  readonly providers: Pick<IdentityProviderStore, "findLive">;
  readonly accounts: Pick<IdentityAccountStore, "findById">;
  /** The composition's IamPolicy binding: whether a person holds `owner` on the organization. */
  readonly policies: Pick<ComposedIamPolicies, "findByPrincipalAndResource">;
  /** Milliseconds since the epoch; a test passes its own clock. */
  readonly nowMs?: () => number;
}

/** The organization's SSO provider that requires sign-in through it, as the rule reads it. */
interface RequiringProvider {
  readonly id: string;
  readonly slug: string;
  readonly displayName: string;
}

const ACCOUNT_KIND = "identity_account";
const ORGANIZATION_KIND = "organization";
const OWNER = IamRole[IamRole.owner];

export function newSsoSignInRule(deps: SsoSignInRuleDeps): SsoSignInRule {
  const nowMs = deps.nowMs ?? Date.now;
  let requiring: ReadonlyMap<string, RequiringProvider> | undefined;
  let fetchedAtMs = 0;
  let reading: Promise<ReadonlyMap<string, RequiringProvider>> | undefined;
  let readingGeneration = 0;
  let generation = 0;
  const accountsByCaller = new WeakMap<CallerIdentity, Promise<IdentityAccount | undefined>>();

  async function requiringProviders(): Promise<ReadonlyMap<string, RequiringProvider>> {
    if (requiring !== undefined && nowMs() - fetchedAtMs < ISSUER_CACHE_TTL_MS) {
      return requiring;
    }
    // A read begun before the last invalidation may predate the write that
    // invalidated, so it is neither shared nor remembered from then on.
    if (reading === undefined || readingGeneration !== generation) {
      const started = generation;
      const read: Promise<ReadonlyMap<string, RequiringProvider>> = deps.providers
        .findLive()
        .then((providers) => {
          const index = indexRequiring(providers);
          if (started === generation) {
            requiring = index;
            fetchedAtMs = nowMs();
          }
          return index;
        })
        .finally(() => {
          if (reading === read) {
            reading = undefined;
          }
        });
      reading = read;
      readingGeneration = started;
    }
    return reading;
  }

  function accountOf(caller: CallerIdentity): Promise<IdentityAccount | undefined> {
    let known = accountsByCaller.get(caller);
    if (known === undefined) {
      known = deps.accounts.findById(caller.identityId);
      accountsByCaller.set(caller, known);
      // A failed read is not remembered: the next check asks again.
      known.catch(() => accountsByCaller.delete(caller));
    }
    return known;
  }

  async function ownsOrganization(accountId: string, org: string): Promise<boolean> {
    const rows = await deps.policies.findByPrincipalAndResource(ACCOUNT_KIND, accountId, ORGANIZATION_KIND, org);
    return rows.some((row) => row.spec?.relation === OWNER);
  }

  return {
    async requiringOrgs() {
      return new Set((await requiringProviders()).keys());
    },

    async refusal(caller, org): Promise<AuthzRefusal | undefined> {
      const provider = (await requiringProviders()).get(org);
      if (provider === undefined) {
        return undefined;
      }
      if (carriesPlatformClientClaim(caller.rawToken) && boundOrgOf(caller) === org) {
        return undefined;
      }
      const account = await accountOf(caller);
      if (account?.spec?.identityProviderRef?.id === provider.id) {
        return undefined;
      }
      if (await ownsOrganization(caller.identityId, org)) {
        return undefined;
      }
      return {
        reason: SSO_REQUIRED,
        message: ssoRequiredMessage(provider.displayName),
        metadata: { org, provider: provider.slug },
      };
    },

    invalidate() {
      generation += 1;
      requiring = undefined;
    },
  };
}

/** Organization id → its SSO provider, for the live providers that require sign-in through them. */
function indexRequiring(providers: ReadonlyArray<IdentityProvider>): ReadonlyMap<string, RequiringProvider> {
  const index = new Map<string, RequiringProvider>();
  for (const provider of providers) {
    const spec = provider.spec;
    const org = provider.metadata?.org ?? "";
    if (spec?.isSsoProvider !== true || !spec.ssoRequired || org === "") {
      continue;
    }
    index.set(org, {
      id: provider.metadata?.id ?? "",
      slug: provider.metadata?.slug ?? "",
      displayName: spec.displayName,
    });
  }
  return index;
}
