/**
 * An organization's live SSO provider as the lanes that sign people in
 * through it read it, and the projection a person may see before signing
 * in.
 *
 * Three lanes ask: the login page's discovery (`getSsoProvider`, public),
 * the access move (iam/access-move/handlers.ts, which names the provider to
 * sign in through next and checks the redeemer came through it), and the
 * owners' preview of a sign-in requirement (requirement-preview.ts). A
 * provider whose organization is gone or younger than the provider
 * answers as no provider (organization-links.ts `orphanReason`): its slug
 * may now be someone else's.
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";

import type { IdentityProvider } from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/api_pb";
import type { SsoProviderInfo } from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/io_pb";
import { SsoProviderInfoSchema } from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/io_pb";

import { orphanReason } from "../organization-links.js";
import type { OrganizationLookup } from "../organization-links.js";
import type { IdentityProviderStore } from "./store.js";

/** The refusal when the organization has no SSO provider; it names no organization. */
export const NO_SSO_PROVIDER_MESSAGE = "This organization does not have an SSO provider configured";

export interface SsoProviderReads {
  readonly store: Pick<IdentityProviderStore, "findSsoProviderByOrg">;
  readonly organizations: OrganizationLookup;
}

/** The organization's live SSO provider, or undefined when it has none or its provider is an orphan. */
export async function findLiveSsoProvider(
  deps: SsoProviderReads,
  org: string,
): Promise<IdentityProvider | undefined> {
  const found = await deps.store.findSsoProviderByOrg(org);
  if (found === undefined) {
    return undefined;
  }
  return orphanReason(found, await deps.organizations.find(org)) === undefined ? found : undefined;
}

/** As `findLiveSsoProvider`, NOT_FOUND with the copy that names no organization when there is none. */
export async function requireLiveSsoProvider(
  deps: SsoProviderReads,
  org: string,
): Promise<IdentityProvider> {
  const provider = await findLiveSsoProvider(deps, org);
  if (provider === undefined) {
    // Asked before sign-in, by anyone: the copy reads the same for a name
    // nobody holds and for one that resolved to an organization's id, and
    // never tells the caller which names exist.
    throw new ConnectError(NO_SSO_PROVIDER_MESSAGE, Code.NotFound);
  }
  return provider;
}

/** What sign-in needs, and nothing a person may not see before signing in. */
export function ssoProviderInfoOf(provider: IdentityProvider): SsoProviderInfo {
  return create(SsoProviderInfoSchema, {
    displayName: provider.spec?.displayName ?? "",
    oidcClientId: provider.spec?.oidcClientId ?? "",
    issuer: provider.spec?.allowedIssuers[0] ?? "",
    expectedAudience: provider.spec?.expectedAudience ?? "",
    ssoRequired: provider.spec?.ssoRequired ?? false,
  });
}
