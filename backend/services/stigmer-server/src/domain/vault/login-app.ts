/**
 * Which login app signs in at an address: one order, used by the sign-in
 * when it starts and by a renewal when it presents the app's secret.
 *
 *   1. The organization's own app for the address: an OAuthApp whose
 *      `addresses` list it. Each address is a name claim
 *      (`OAUTH_APP_ADDRESS_NAME_KIND`, the store's `resourceNames`), so an
 *      address belongs to one app in an organization and is found without
 *      listing every app. A claim whose app no longer lists the address (a
 *      write that died between the claim and the row) is ignored here and
 *      freed by the next app that claims the address (domain/oauthapp).
 *   2. Stigmer's own app for the address: a catalog entry switched on by
 *      the deployment's settings (login-providers.ts).
 *   3. Neither: the sign-in finds the address's own login server
 *      (sign-in/start.ts), for a tool's URL only.
 *
 * An organization's app pending or refused by its vendor is still the one
 * found, carrying the refusal, so a sign-in there says why it cannot start
 * rather than quietly using another client.
 *
 * Every secret this returns is opened in process only; nothing here reaches
 * a client.
 *
 * Proven by sign-in/__tests__/start.test.ts (the order),
 * sign-in/__tests__/person.test.ts (an app its vendor has not approved, the
 * app a renewal presents), sign-in/__tests__/faults.test.ts (a lookup that
 * fails), oauthapp/__tests__/oauthapp.test.ts (an app found by its
 * addresses) and the sign-in conformance suite.
 */
import { OAuthAppSchema } from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/api_pb";
import type { OAuthApp } from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/api_pb";
import {
  TokenEndpointAuthMethod,
  VendorApprovalStatus,
} from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/spec_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { SecretService } from "../../encryption/encryption.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { ResourceNameKey, Store } from "../../store/interface.js";
import { loginProviderByKey, loginProviderFor } from "./login-providers.js";
import type { LoginProvider, LoginProviderSettings } from "./login-providers.js";
import { TOKEN_AUTH_METHOD_BASIC, TOKEN_AUTH_METHOD_POST } from "./sign-in/token.js";

/** The name-table kind that keeps each address to one login app per organization. */
export const OAUTH_APP_ADDRESS_NAME_KIND = "oauth_app_address";

/** The prefix of an organization's app in a sign-in's `login_app`. */
const ORG_APP_PREFIX = "org:";
/** The prefix of a catalog entry in a sign-in's `login_app`. */
const STIGMER_APP_PREFIX = "stigmer:";

/** The name claim an address takes for an organization's app. */
export function oauthAppAddressKey(org: string, address: string): ResourceNameKey {
  return { kind: OAUTH_APP_ADDRESS_NAME_KIND, org, name: address };
}

/** A login app a sign-in uses, its secret opened. Server-side only. */
export interface AppLogin {
  /** What a sign-in records as `login_app`: "org:<id>" or "stigmer:<key>". */
  readonly ref: string;
  readonly providerName: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly authorizationUrl: string;
  readonly tokenUrl: string;
  /** "" when the app names no account endpoint. */
  readonly userinfoUrl: string;
  readonly scopes: readonly string[];
  /** "" for the standard `scope`. */
  readonly scopeParameterName: string;
  /** RFC 8414 vocabulary. */
  readonly tokenAuthMethod: string;
  /** Why the app cannot be used now (its vendor has not approved it); undefined when it can. */
  readonly unavailable?: string;
}

/** What reading login apps needs. */
export interface LoginAppDeps {
  readonly store: Store;
  readonly secretService: SecretService;
  readonly loginProviders: LoginProviderSettings;
}

/**
 * The login app for a normalized address in an organization: its own app,
 * else Stigmer's switched-on catalog entry, else undefined (the sign-in then
 * reads the address's own login server, when it is a tool's URL).
 */
export async function findLoginApp(
  deps: LoginAppDeps,
  org: string,
  address: string,
): Promise<AppLogin | undefined> {
  const app = await findOrganizationApp(deps.store, org, address);
  if (app !== undefined) {
    return openOrganizationApp(deps.secretService, app);
  }
  const provider = loginProviderFor(address);
  return provider === undefined ? undefined : catalogApp(deps.loginProviders, provider);
}

/**
 * Who a sign-in at an address is with, by the same order as
 * `findLoginApp`, without opening any secret: the organization's app's
 * provider, else the catalog entry's name, else undefined. For a page
 * anyone holding a link may read.
 */
export async function findLoginAppName(
  deps: Pick<LoginAppDeps, "store" | "loginProviders">,
  org: string,
  address: string,
): Promise<string | undefined> {
  const app = await findOrganizationApp(deps.store, org, address);
  if (app !== undefined) {
    return app.spec?.provider ?? "";
  }
  const provider = loginProviderFor(address);
  return provider !== undefined && deps.loginProviders.has(provider.key) ? provider.name : undefined;
}

/**
 * The login app a sign-in recorded (`login_app`), read live so an admin's
 * fix to the app applies at once: undefined for a public client ("") and for
 * an app that is gone or switched off.
 */
export async function loginAppByRef(
  deps: LoginAppDeps,
  ref: string,
): Promise<AppLogin | undefined> {
  if (ref.startsWith(ORG_APP_PREFIX)) {
    const app = await loadOAuthApp(deps.store, ref.slice(ORG_APP_PREFIX.length));
    return app === undefined ? undefined : openOrganizationApp(deps.secretService, app);
  }
  if (ref.startsWith(STIGMER_APP_PREFIX)) {
    const provider = loginProviderByKey(ref.slice(STIGMER_APP_PREFIX.length));
    return provider === undefined ? undefined : catalogApp(deps.loginProviders, provider);
  }
  return undefined;
}

/** The organization's app that lists `address`, or undefined. */
export async function findOrganizationApp(
  store: Store,
  org: string,
  address: string,
): Promise<OAuthApp | undefined> {
  const holder = await store.resourceNames.resolve(
    oauthAppAddressKey(org, address),
    new Date().toISOString(),
  );
  if (holder === undefined) {
    return undefined;
  }
  const app = await loadOAuthApp(store, holder.id);
  if (app === undefined || (app.metadata?.org ?? "") !== org) {
    return undefined;
  }
  return (app.spec?.addresses ?? []).includes(address) ? app : undefined;
}

async function loadOAuthApp(store: Store, id: string): Promise<OAuthApp | undefined> {
  try {
    return await store.getResource(ApiResourceKind.oauth_app, id, OAuthAppSchema);
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      return undefined;
    }
    throw error;
  }
}

async function openOrganizationApp(secretService: SecretService, app: OAuthApp): Promise<AppLogin> {
  const spec = app.spec;
  let clientSecret = spec?.clientSecret ?? "";
  if (secretService.isEncrypted(clientSecret)) {
    clientSecret = await secretService.decrypt(clientSecret);
  }
  const provider = spec?.provider ?? "";
  return {
    ref: `${ORG_APP_PREFIX}${app.metadata?.id ?? ""}`,
    providerName: provider,
    clientId: spec?.clientId ?? "",
    clientSecret,
    authorizationUrl: spec?.authorizationUrl ?? "",
    tokenUrl: spec?.tokenUrl ?? "",
    userinfoUrl: spec?.userinfoUrl ?? "",
    scopes: spec?.scopes ?? [],
    scopeParameterName: spec?.scopeParameterName ?? "",
    tokenAuthMethod:
      spec?.tokenEndpointAuthMethod === TokenEndpointAuthMethod.CLIENT_SECRET_POST
        ? TOKEN_AUTH_METHOD_POST
        : TOKEN_AUTH_METHOD_BASIC,
    unavailable: approvalRefusal(provider, spec?.vendorApprovalStatus),
  };
}

/** Why an app whose vendor has not approved it cannot sign anyone in, or undefined. */
function approvalRefusal(
  provider: string,
  status: VendorApprovalStatus | undefined,
): string | undefined {
  if (status !== VendorApprovalStatus.PENDING && status !== VendorApprovalStatus.REJECTED) {
    return undefined;
  }
  const label = status === VendorApprovalStatus.REJECTED ? "rejected" : "pending approval";
  return `sign-in is unavailable: the organization's OAuth app for '${provider}' is ${label} by the vendor. Paste a token instead, or ask an admin to use another app`;
}

function catalogApp(settings: LoginProviderSettings, provider: LoginProvider): AppLogin | undefined {
  const credentials = settings.get(provider.key);
  if (credentials === undefined) {
    return undefined;
  }
  return {
    ref: `${STIGMER_APP_PREFIX}${provider.key}`,
    providerName: provider.name,
    clientId: credentials.clientId,
    clientSecret: credentials.clientSecret,
    authorizationUrl: provider.authorizationUrl,
    tokenUrl: provider.tokenUrl,
    userinfoUrl: provider.userinfoUrl,
    scopes: provider.scopes,
    scopeParameterName: provider.scopeParameterName,
    tokenAuthMethod: provider.tokenAuthMethod,
  };
}
