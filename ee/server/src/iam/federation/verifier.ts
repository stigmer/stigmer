/**
 * The store-backed federated verifier: token authentication, identity
 * resolution and auto-provisioning for an organization's own identity
 * providers, as one chain entry. The IdentityProvider RESOURCE is the
 * single source of federation trust, with no environment variable beside
 * it: two configuration sources for one trust decision drift by
 * construction.
 *
 * A token is routed by its ROUTE, the pair (issuer, audience): the one
 * provider that names the token's `iss` among its issuers and whose
 * audience the token's `aud` carries. The issuer alone is not a claim,
 * because organizations that federate with one issuer (a shared tenant,
 * a public identity provider) each register their own audience, and a
 * token minted for one organization's registration must never sign
 * anyone into another's. A token no provider's route matches is passed,
 * claim-or-pass, which answers nothing about what is registered; the
 * chain then refuses it as unclaimed. A token two providers' routes match
 * (possible only for legacy rows, or an issuer that stamps two registered
 * audiences on one token) is refused, never guessed. A stored provider
 * with no audience, or one naming the host's own sign-in issuer, routes
 * nothing: the contract refuses both on every write, and a row stored
 * before those rules must not act on them.
 *
 * Route resolution reads the providers through a bounded TTL cache with
 * explicit invalidation from the IdP command handlers. The cache is keyed
 * by CANONICAL issuer: stored spellings are normalized as the map is built
 * and the token's `iss` is normalized before the lookup, both sides,
 * because normalizing only one lets Auth0's trailing-slash `iss` leave
 * every login on an Auth0-backed IdP unclaimed. Verification itself is
 * RS256 via the kid-keyed JWKS cache in verifiers/jwks.ts, one mechanism
 * with the host's direct-login lane, then `exp`, then `nbf` when present
 * (RFC 7519 §4.1.5: a token "MUST NOT be accepted for processing" before
 * it), with no leeway, exactly as the direct-login lane checks both.
 * This lane's cache INSTANCE is its own and dials through the
 * composition's egress-guarded fetch, because every `jwks_uri` and
 * `userinfo_endpoint` it reads was written by an organization admin; the
 * provider's save bound both to its issuers'
 * discovery documents. A destination the egress policy refuses is the
 * provider's configuration, not a fault of this server and not a
 * transient one, so it answers Unauthenticated like the lane's other
 * refusals, instead of surfacing INTERNAL; the policy's reason, which can
 * say what an internal name resolves to, never reaches the wire. The lane
 * logs no refused token (a per-token line would let anyone flood the
 * logs): the provider's save refused the same address with its cause.
 *
 * The identity minted is the ACCOUNT id, not the raw sub, so every
 * policy row and audit line names the platform's account, never an
 * identity provider's subject.
 *
 * EVERY TOKEN IS BOUND TO ONE ORGANIZATION (`boundOrg`; the library's
 * credential binding enforces it wherever the server decides): the child
 * organization of the provider's organization whose `external_id` the
 * provider's `external_id_claim` carries, found through the library's
 * child-organization lookup (`ComposedServices.childOrganizations`, one
 * name-table read and one row read), or the provider's own organization
 * when it names no claim. The claim is read on every token, a returning
 * account's included, and before the account is read or created: a token
 * that lacks it, carries a value that is not a string, or names no child
 * of the provider's organization answers Unauthenticated, and a first
 * sign-in refused that way leaves no account. The refusal names the
 * claim, never its value. No cache: the lookup is two indexed reads beside
 * the account read, and a cache would have to follow every organization's
 * delete.
 *
 * The routing is keyed by the parent organization, not by the provider:
 * every provider of a parent that sets `external_id_claim` can bind a
 * token to any of that parent's children, so a parent's providers share
 * that trust. A provider whose issuer another party controls (a
 * customer's own identity provider, say) belongs in that customer's child
 * organization, never on the parent with the claim set.
 *
 * Then the account, by the (provider ref, external sub) natural key; a
 * miss creates it when the provider sets `create_accounts_on_sign_in`
 * (profile: JWT claims first, then the userinfo endpoint — OIDC Core 5.3)
 * and refuses Unauthenticated otherwise (the platform must call
 * createFederatedAccount first).
 *
 * Then the SIGN-IN GRANT, once per (account, organization): the first time
 * an account signs in to an organization through a provider, the request
 * that claims the ledger row (sign-in-grants.ts) grants the provider's
 * `sign_in_role` there when one is set; every later request reads the row
 * and grants nothing, so a role an admin removes stays removed. `owner` is
 * never granted, even from a provider stored before the write-time
 * refusal: the sign-in is refused instead. A failed grant releases the row
 * and refuses the sign-in, and an account this request created is rolled
 * back (an account that authenticates but holds no access is a silent
 * failure worse than a clean error).
 *
 * THE PROVIDER IS READ on every sign-in, once the token is proven (its
 * route, signature, expiry and subject checked) and before its account is
 * read: one primary-key read beside the account read every sign-in makes.
 * This lane routes from a cache up to `ISSUER_CACHE_TTL_MS` old on every
 * process a provider's write or delete did not run in, so the cache alone
 * would still sign people in through a provider whose delete has begun,
 * or through one whose row is gone. Accounts are keyed by the provider's
 * id, so a provider made since under the same slug never reaches them. A
 * provider that is marked, or gone, signs
 * no one in; the process forgets its cache and routes the token once
 * more, so a provider created since on the same route signs its own people
 * in at once instead of being refused until the cache expires.
 *
 * And it is READ AGAIN when this request wrote anything (it created the
 * account, or claimed the first sign-in to an organization), before the
 * sign-in answers. A provider's delete marks it before it lists the
 * provider's accounts (provider/removal.ts has the ordering argument), so a
 * mark that lands between the first read and the write is seen by one side
 * or the other. A sign-in that finds it marked, or gone, undoes its own
 * write and is refused: an account it created is removed through the
 * account service, its policies with it, and on an account that already
 * existed only the grant it made is revoked, since the removal deletes
 * that account. Either way nothing the deleted provider's identity
 * provider signed in during the delete outlives it.
 *
 * A read that faults is not an answer. Before anything is written it is an
 * infrastructure fault, the chassis's doctrine (verifiers/jwks.ts): logged
 * and thrown as a plain Error, which the verifier chain answers INTERNAL,
 * never as a credential the person must re-enter.
 * After a write it is taken as "not live": the write must be undone before
 * anything is answered, so the sign-in is refused, the write undone, and
 * the person signs in again. An
 * undo step that itself fails is logged with the account it left, and the
 * sign-in is still refused; what it left cannot sign in through the
 * deleted provider (nor through one re-created under its slug, which has
 * another id), and the log line is how a person finds it.
 */
import type { KeyObject } from "node:crypto";

import { Code, ConnectError } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { EgressError } from "@stigmer/outbound/egress";

import type { IdentityAccount } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import type { IdentityProvider } from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/api_pb";
import { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import { IdentityAccountProvisioningMode } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/enum_pb";
import { IdentityAccountSpecSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/spec_pb";
import { ApiResourceReferenceSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import {
  ApiResourceRefSchema,
  IamPolicySpecSchema,
} from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/spec_pb";
import type { IamPolicySpec } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/spec_pb";
import type {
  CallerIdentity,
  ChildOrganizations,
  IdentityVerifier,
  Logger,
} from "@stigmer/server";

import type { IamPolicyGrantPathClient } from "../policy/grant-path-client.js";
import type { UserInfoClient } from "./userinfo.js";
import type { IdentityAccountService } from "../account/port.js";
import { orphanReason } from "../organization-links.js";
import type { OrganizationFacts, OrganizationLookup } from "../organization-links.js";
import { normalizeIssuerUrl } from "../provider/issuer-url.js";
import type { IdentityProviderStore } from "../provider/store.js";
import {
  audienceMatches,
  decodeJwt,
  verifiesRs256,
} from "../../verifiers/jwt.js";
import type { DecodedJwt } from "../../verifiers/jwt.js";
import type { JwksKeyCache } from "../../verifiers/jwks.js";
import type { SignInGrantLedger } from "./sign-in-grants.js";

/** The provider/issuer cache TTL: how long a provider write can take to reach a lane nobody invalidated. */
export const ISSUER_CACHE_TTL_MS = 60 * 1000;

export interface FederatedVerifierDeps {
  /**
   * Read only: the issuer cache rebuilds from every live provider, and a
   * sign-in that wrote asks whether its provider is still live.
   */
  readonly providers: Pick<IdentityProviderStore, "findLive" | "isLive">;
  readonly accounts: IdentityAccountService;
  readonly policies: IamPolicyGrantPathClient;
  /** The provider organization's children, by the external id a token's claim carries. */
  readonly childOrganizations: Pick<ChildOrganizations, "findByExternalId">;
  /** The first sign-in of each (account, organization), which the sign-in role is granted on. */
  readonly signInGrants: SignInGrantLedger;
  /** Endpoint-parameterized userinfo fetch (per-IdP endpoints). */
  readonly fetchUserProfile: UserInfoClient["fetchUserProfile"];
  readonly logger: Logger;
  /**
   * This lane's JWKS key cache, over the egress-guarded fetch (the
   * composition builds it; the direct-login lane has its own instance).
   */
  readonly jwks: JwksKeyCache;
  /** The issuers the host's own sign-in lanes claim; a provider naming one routes nothing. */
  readonly reservedIssuers: ReadonlyArray<string>;
  /**
   * The organizations the providers name, read once per organization at
   * every index rebuild: a provider whose organization is gone, or younger
   * than the provider, routes nothing (organization-links.ts `orphanReason`).
   */
  readonly organizations: OrganizationLookup;
  readonly nowMs?: () => number;
}

export interface StoreBackedFederatedVerifier extends IdentityVerifier {
  /** Invalidation hook — the IdP command handlers call it on every write. */
  invalidate(): void;
}

export function newStoreBackedFederatedVerifier(
  deps: FederatedVerifierDeps,
): StoreBackedFederatedVerifier {
  const nowMs = deps.nowMs ?? Date.now;
  const { jwks } = deps;

  const reservedIssuers = new Set(deps.reservedIssuers.map(normalizeIssuerUrl));
  let providersByIssuer = new Map<string, ReadonlyArray<IdentityProvider>>();
  let issuersFetchedAtMs = -Infinity;

  /**
   * The providers that name an issuer, each with its own audience. Both
   * sides of the lookup are canonical (`normalizeIssuerUrl`): the map
   * keys, so a legacy row whose spelling predates write-time
   * normalization still resolves, and the token's `iss`, so Auth0's
   * trailing slash matches the stored value.
   */
  async function providersFor(issuer: string): Promise<ReadonlyArray<IdentityProvider>> {
    if (nowMs() - issuersFetchedAtMs >= ISSUER_CACHE_TTL_MS) {
      providersByIssuer = indexRoutes(
        await withoutOrphans(await deps.providers.findLive(), deps.organizations, deps.logger),
        reservedIssuers,
        deps.logger,
      );
      issuersFetchedAtMs = nowMs();
    }
    return providersByIssuer.get(normalizeIssuerUrl(issuer)) ?? [];
  }

  /**
   * The key `kid` names in the provider's JWKS document. An egress refusal
   * is the provider's configuration and answers Unauthenticated with fixed
   * copy, never the policy's reason; every other fault keeps the cache's
   * own doctrine.
   */
  async function signingKeyFor(
    provider: IdentityProvider,
    iss: string,
    kid: string,
  ): Promise<KeyObject | undefined> {
    try {
      return await jwks.keyFor(provider.spec?.jwksUri ?? "", kid);
    } catch (error) {
      if (error instanceof EgressError) {
        // No log line: it would be one per token, which anyone can send
        // (see verify). The provider's save already refused this address.
        throw unauthenticated(
          `the identity provider for issuer '${iss}' names a JWKS address ` +
            "this platform does not dial",
        );
      }
      throw error;
    }
  }

  /**
   * The lane, for one token. `rerouted` is set on the one second pass a
   * token gets when its cached provider proved no longer live.
   */
  async function verifyRouted(token: string, rerouted: boolean): Promise<CallerIdentity | null> {
    const decoded = decodeJwt(token);
    if (decoded === undefined) {
      return null;
    }
    const iss = decoded.payload.iss;
    if (typeof iss !== "string" || iss === "") {
      return null;
    }
    const candidates = await providersFor(iss);
    if (candidates.length === 0) {
      return null; // claim-or-pass: not our issuer
    }
    const [provider, ...alsoRouted] = candidates.filter((candidate) =>
      audienceMatches(decoded.payload.aud, candidate.spec?.expectedAudience ?? ""),
    );
    if (provider === undefined) {
      // Claim-or-pass: no provider registered this audience at this
      // issuer, and passing says nothing about which ones are. Like the
      // lane's refusals it logs nothing: a per-token line would let
      // anyone flood the logs.
      return null;
    }
    if (alsoRouted.length > 0) {
      // A shared route is logged once per index rebuild (indexRoutes).
      throw unauthenticated(
        `token from issuer '${iss}' matches more than one identity provider`,
      );
    }

    const kid =
      typeof decoded.header.kid === "string" ? decoded.header.kid : "";
    const key = await signingKeyFor(provider, iss, kid);
    if (key === undefined || !verifiesRs256(decoded, key)) {
      throw unauthenticated(
        `token from issuer '${iss}' failed signature verification`,
      );
    }
    const exp = decoded.payload.exp;
    if (typeof exp !== "number" || exp * 1000 <= nowMs()) {
      throw unauthenticated(`token from issuer '${iss}' is expired`);
    }
    const nbf = decoded.payload.nbf;
    if (nbf !== undefined && (typeof nbf !== "number" || nbf * 1000 > nowMs())) {
      throw unauthenticated(`token from issuer '${iss}' is not yet valid`);
    }
    const sub = decoded.payload.sub;
    if (typeof sub !== "string" || sub === "") {
      throw unauthenticated(`token from issuer '${iss}' carries no subject`);
    }
    const live = await liveOrThrow(deps, provider);
    if (!live && !rerouted) {
      // This process's cache still routes a provider whose delete has
      // begun, or whose row is gone and whose route a provider created
      // since may hold: forget the cache and route the token once more.
      issuersFetchedAtMs = -Infinity;
      return verifyRouted(token, true);
    }
    refuseUnlessLive(provider, live ? "live" : "not-live");

    const boundOrg = await resolveBoundOrg(deps, provider, decoded);
    const existing = await deps.accounts.store.findByProviderAndIdpId(
      provider.metadata?.id ?? "",
      sub,
    );
    const signedIn: SignedInAccount =
      existing !== undefined
        ? { account: existing, createdNow: false }
        : await provisionOrRefuse(deps, provider, decoded, token, sub);
    const accountId = signedIn.account.metadata?.id ?? "";
    const settled = await settleSignInGrant(deps, provider, accountId, boundOrg, {
      createdNow: signedIn.createdNow,
      externalSub: sub,
    });
    if (signedIn.createdNow || settled.claimed) {
      await undoUnlessProviderLive(deps, provider, signedIn, boundOrg, settled);
    }

    const email = decoded.payload.email;
    const name = decoded.payload.name;
    return {
      identityId: accountId,
      callerClass: "user",
      issuer: iss,
      rawToken: token,
      boundOrg,
      ...(typeof email === "string" && email !== "" ? { email } : {}),
      ...(typeof name === "string" && name !== ""
        ? { displayName: name }
        : {}),
    };
  }

  return {
    name: "federated-idp",

    invalidate(): void {
      issuersFetchedAtMs = -Infinity;
    },

    verify(token: string): Promise<CallerIdentity | null> {
      return verifyRouted(token, false);
    },
  };
}

// ---------------------------------------------------------------------------
// The issuer cache's rebuild.
// ---------------------------------------------------------------------------

/**
 * The providers that still belong to the organization they name. A
 * provider its organization's delete left behind (a write that raced the
 * delete, or a row from before the delete removed its providers first)
 * names an organization that is gone, and would still sign people in:
 * its sign-in role would be granted on `metadata.org`, an organization
 * nobody administers.
 * Such a provider is skipped whole and logged once per rebuild, as a
 * provider naming a reserved issuer is. One organization read per
 * organization per rebuild; a read fault propagates, and the token is
 * refused, as a failed `findAll` is.
 */
async function withoutOrphans(
  providers: ReadonlyArray<IdentityProvider>,
  organizations: OrganizationLookup,
  logger: Logger,
): Promise<IdentityProvider[]> {
  const facts = new Map<string, Promise<OrganizationFacts | undefined>>();
  const live: IdentityProvider[] = [];
  for (const provider of providers) {
    const org = provider.metadata?.org ?? "";
    let known = facts.get(org);
    if (known === undefined) {
      known = organizations.find(org);
      facts.set(org, known);
    }
    const reason = orphanReason(provider, await known);
    if (reason !== undefined) {
      logger.warn("identity provider's organization is gone or younger than it; it routes no token", {
        provider: provider.metadata?.id ?? "",
        org,
        reason,
      });
      continue;
    }
    live.push(provider);
  }
  return live;
}

/**
 * Index providers by canonical issuer, each keeping its own audience; the
 * verifier picks among them by the token's audience. The route side
 * table's primary key makes two providers claiming one route impossible
 * for rows the handlers wrote, so a shared route here means legacy
 * spellings or rows; it is logged so an operator can repair the rows, and
 * a token it matches is refused rather than guessed. Spellings that
 * normalize to nothing are skipped, mirroring the handlers' write-time
 * filter; a provider with no audience, or naming a reserved issuer, is
 * skipped whole and logged, since it may route nothing.
 */
function indexRoutes(
  providers: readonly IdentityProvider[],
  reservedIssuers: ReadonlySet<string>,
  logger: Logger,
): Map<string, ReadonlyArray<IdentityProvider>> {
  const byIssuer = new Map<string, IdentityProvider[]>();
  for (const provider of providers) {
    const id = provider.metadata?.id ?? "";
    const audience = provider.spec?.expectedAudience ?? "";
    if (audience === "") {
      logger.warn("identity provider has no audience and routes no token; an admin must set one", {
        provider: id,
      });
      continue;
    }
    const issuers = (provider.spec?.allowedIssuers ?? [])
      .map(normalizeIssuerUrl)
      .filter((issuer) => issuer !== "");
    if (issuers.some((issuer) => reservedIssuers.has(issuer))) {
      logger.warn("identity provider names this platform's own sign-in issuer and routes no token", {
        provider: id,
      });
      continue;
    }
    for (const issuer of issuers) {
      const held = byIssuer.get(issuer) ?? [];
      const shared = held.find((other) => other.spec?.expectedAudience === audience);
      if (shared !== undefined) {
        logger.warn("two identity providers share one route; tokens on it are refused", {
          issuer,
          audience,
          providers: `${shared.metadata?.id ?? ""},${id}`,
        });
      }
      held.push(provider);
      byIssuer.set(issuer, held);
    }
  }
  return byIssuer;
}

// ---------------------------------------------------------------------------
// The provisioning matrix.
// ---------------------------------------------------------------------------

/** The account a sign-in resolved, and whether this request created it. */
interface SignedInAccount {
  readonly account: IdentityAccount;
  readonly createdNow: boolean;
}

async function provisionOrRefuse(
  deps: FederatedVerifierDeps,
  provider: IdentityProvider,
  decoded: DecodedJwt,
  token: string,
  externalSub: string,
): Promise<SignedInAccount> {
  const org = provider.metadata?.org ?? "";
  const slug = provider.metadata?.slug ?? "";
  if (provider.spec?.createAccountsOnSignIn !== true) {
    // The platform must createFederatedAccount first.
    throw unauthenticated(
      `no federated account exists for subject '${externalSub}' from IdP '${org}/${slug}' ` +
        "and the identity provider does not create accounts on sign-in",
    );
  }

  const profile = await resolveProfileClaims(deps, provider, decoded, token);

  try {
    const created = await deps.accounts.createAccount({
      org,
      name: profile.email,
      spec: create(IdentityAccountSpecSchema, {
        idpId: externalSub,
        email: profile.email,
        firstName: profile.firstName,
        lastName: profile.lastName,
        pictureUrl: profile.pictureUrl,
        provisioningMode: IdentityAccountProvisioningMode.federated,
        // The stored form: the provider by its id, as every reference.
        identityProviderRef: create(ApiResourceReferenceSchema, {
          org,
          kind: ApiResourceKind.identity_provider,
          id: provider.metadata?.id ?? "",
        }),
      }),
    }, provider.metadata?.id);
    return { account: created, createdNow: true };
  } catch {
    // The concurrent-provisioning race: resolve the winner, whose account
    // this request did not create and so never rolls back.
    const winner = await deps.accounts.store.findByProviderAndIdpId(
      provider.metadata?.id ?? "",
      externalSub,
    );
    if (winner === undefined) {
      throw unauthenticated(
        `provisioning race for IdP '${org}/${slug}' sub '${externalSub}': ` +
          "create failed but account not found",
      );
    }
    return { account: winner, createdNow: false };
  }
}

/**
 * The organization the token is bound to: the child of the provider's
 * organization whose external id the provider's claim carries, or the
 * provider's own when it names no claim. Every refusal is Unauthenticated
 * and names the claim, never its value.
 */
async function resolveBoundOrg(
  deps: FederatedVerifierDeps,
  provider: IdentityProvider,
  decoded: DecodedJwt,
): Promise<string> {
  const org = provider.metadata?.org ?? "";
  const slug = provider.metadata?.slug ?? "";
  const claimName = provider.spec?.externalIdClaim ?? "";
  if (claimName === "") {
    return org;
  }
  const claimValue = decoded.payload[claimName];
  if (typeof claimValue !== "string" || claimValue === "") {
    throw unauthenticated(
      `token from IdP '${org}/${slug}' does not carry its external id claim ` +
        `'${claimName}' as a string, so it names no organization to work in`,
    );
  }
  const child = await deps.childOrganizations.findByExternalId(org, claimValue);
  const childId = child?.metadata?.id ?? "";
  if (childId === "") {
    throw unauthenticated(
      `token from IdP '${org}/${slug}' names, in its external id claim '${claimName}', ` +
        "no child organization of this identity provider's organization",
    );
  }
  return childId;
}

/**
 * What settling the sign-in grant wrote: nothing (an earlier sign-in, or a
 * concurrent one, holds the ledger row), or the ledger's claim with the
 * role granted under it, if the provider names one.
 */
type SettledSignInGrant =
  | { readonly claimed: false }
  | { readonly claimed: true; readonly granted: IamPolicySpec | undefined };

const NOTHING_CLAIMED: SettledSignInGrant = { claimed: false };

/**
 * The first sign-in of the account to `boundOrg` grants the provider's
 * sign-in role there, once (the module header). Owner is refused before
 * anything is claimed; a failed grant releases the claim and refuses the
 * sign-in, rolling back an account this request created.
 */
async function settleSignInGrant(
  deps: FederatedVerifierDeps,
  provider: IdentityProvider,
  accountId: string,
  boundOrg: string,
  context: { readonly createdNow: boolean; readonly externalSub: string },
): Promise<SettledSignInGrant> {
  const org = provider.metadata?.org ?? "";
  const slug = provider.metadata?.slug ?? "";
  const providerId = provider.metadata?.id ?? "";
  const role = provider.spec?.signInRole ?? IamRole.iam_role_unspecified;
  if (role === IamRole.owner) {
    // The contract refuses an owner sign-in role on every write
    // (`identity_provider.sign_in_role_not_owner`); a provider stored with
    // it before that rule must still never make anyone an owner.
    await rollBackCreated(deps, accountId, context.createdNow);
    throw unauthenticated(
      `IdP '${org}/${slug}' is configured to grant owner on sign-in, which is never granted ` +
        "automatically; an organization admin must change its sign_in_role",
    );
  }
  if (await deps.signInGrants.recorded(accountId, boundOrg)) {
    return NOTHING_CLAIMED;
  }
  if (!(await deps.signInGrants.claim(accountId, boundOrg, providerId))) {
    return NOTHING_CLAIMED; // A concurrent first sign-in won the claim and grants.
  }
  if (role === IamRole.iam_role_unspecified) {
    // Recorded, granting nothing: the platform grants roles itself.
    return { claimed: true, granted: undefined };
  }
  const grant = signInRoleGrant(accountId, boundOrg, IamRole[role]);
  try {
    await deps.policies.create(grant, providerId);
  } catch (grantError) {
    deps.logger.error("federated sign-in role grant failed; the sign-in is refused", {
      accountId,
      idp: `${org}/${slug}`,
      error:
        grantError instanceof Error ? grantError.message : String(grantError),
    });
    await deps.signInGrants.release(accountId, boundOrg).catch((releaseError: unknown) => {
      deps.logger.error(
        "a failed sign-in could not release its first sign-in; the next sign-in to the organization grants nothing",
        {
          accountId,
          org: boundOrg,
          provider: providerId,
          error: releaseError instanceof Error ? releaseError.message : String(releaseError),
        },
      );
    });
    await rollBackCreated(deps, accountId, context.createdNow);
    throw unauthenticated(
      `Failed to complete sign-in for user '${context.externalSub}' from IdP '${org}/${slug}': ` +
        "the sign-in role grant failed" +
        (context.createdNow ? " and the account was rolled back" : "") +
        ". Please retry authentication.",
    );
  }
  return { claimed: true, granted: grant };
}

/**
 * A sign-in that wrote reads its provider again, and undoes its own write
 * when the provider's delete has begun (the module header;
 * provider/removal.ts has the ordering argument). An account this request
 * created is removed through the account service, its policies with it,
 * and the grant it just made among them. On an account that already
 * existed only the grant this request made is revoked: the first read
 * proved the provider live, so the account is the deleted provider's own,
 * and its removal deletes the account. Every undo acts for the provider,
 * as the grant did. A step that fails is logged and the next one still
 * runs, and the sign-in is refused either way (the module header says
 * what a failed undo leaves).
 */
async function undoUnlessProviderLive(
  deps: FederatedVerifierDeps,
  provider: IdentityProvider,
  signedIn: SignedInAccount,
  boundOrg: string,
  settled: SettledSignInGrant,
): Promise<void> {
  const providerId = provider.metadata?.id ?? "";
  const org = provider.metadata?.org ?? "";
  const slug = provider.metadata?.slug ?? "";
  const accountId = signedIn.account.metadata?.id ?? "";
  const liveness = await livenessOf(deps, provider, "after the sign-in wrote");
  if (liveness === "live") {
    return;
  }
  const undo = async (step: string, run: () => Promise<unknown>): Promise<void> => {
    try {
      await run();
    } catch (error) {
      deps.logger.error("a sign-in through an identity provider being deleted could not undo its write", {
        step,
        accountId,
        idp: `${org}/${slug}`,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
  if (signedIn.createdNow) {
    await undo("delete the account", () => deps.accounts.deleteAccount(signedIn.account, providerId));
  } else if (settled.claimed && settled.granted !== undefined) {
    const granted = settled.granted;
    await undo("revoke the sign-in role", () => deps.policies.delete(granted, providerId));
  }
  if (settled.claimed) {
    await undo("release the first sign-in", () => deps.signInGrants.release(accountId, boundOrg));
  }
  refuseUnlessLive(provider, liveness);
}

/** Whether a sign-in's provider is still live, and "unreadable" when the read faults (logged). */
type ProviderLiveness = "live" | "not-live" | "unreadable";

/**
 * The read before anything is written: one primary-key read of the
 * provider's row and its delete mark. A fault is logged and thrown as a
 * plain Error, the chassis's infrastructure answer (INTERNAL), since
 * nothing needs undoing yet.
 */
async function liveOrThrow(deps: FederatedVerifierDeps, provider: IdentityProvider): Promise<boolean> {
  const idp = `${provider.metadata?.org ?? ""}/${provider.metadata?.slug ?? ""}`;
  try {
    return await deps.providers.isLive(provider.metadata?.id ?? "");
  } catch (error) {
    deps.logger.error("could not read whether a sign-in's identity provider is live", {
      idp,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new Error(`could not read whether identity provider '${idp}' is live`);
  }
}

/**
 * The read after a write: the same read, but a fault is not an answer the
 * sign-in can give before it undoes its write, so it is logged and
 * answered "unreadable", which the undo treats like "not live", the
 * closed side.
 */
async function livenessOf(
  deps: FederatedVerifierDeps,
  provider: IdentityProvider,
  when: string,
): Promise<ProviderLiveness> {
  try {
    return (await deps.providers.isLive(provider.metadata?.id ?? "")) ? "live" : "not-live";
  } catch (error) {
    deps.logger.error("could not read whether a sign-in's identity provider is live; the sign-in is refused", {
      when,
      idp: `${provider.metadata?.org ?? ""}/${provider.metadata?.slug ?? ""}`,
      error: error instanceof Error ? error.message : String(error),
    });
    return "unreadable";
  }
}

/**
 * The refusal for each answer but "live", keyed so the compiler holds the
 * set exhaustive: a new answer cannot reach the wire without its copy.
 */
const NOT_LIVE_REFUSAL: Readonly<Record<Exclude<ProviderLiveness, "live">, (idp: string) => string>> = {
  "not-live": (idp) => `IdP '${idp}' is being deleted and signs no one in`,
  unreadable: (idp) => `Failed to complete sign-in from IdP '${idp}'. Please retry authentication.`,
};

/** Refuses a sign-in through a provider that is not live, or whose liveness could not be read. */
function refuseUnlessLive(provider: IdentityProvider, liveness: ProviderLiveness): void {
  if (liveness === "live") {
    return;
  }
  const idp = `${provider.metadata?.org ?? ""}/${provider.metadata?.slug ?? ""}`;
  throw unauthenticated(NOT_LIVE_REFUSAL[liveness](idp));
}

/**
 * Removes an account this request created, so the next sign-in runs a
 * clean creation, when the sign-in is refused before anything was granted
 * or after the grant failed. (Its self-owner policy row is deliberately
 * left: it references a dead account and has no authorization effect.) A
 * sign-in refused because its provider's delete began undoes through the
 * account service instead, since a grant may already stand
 * (undoUnlessProviderLive).
 */
async function rollBackCreated(
  deps: FederatedVerifierDeps,
  accountId: string,
  createdNow: boolean,
): Promise<void> {
  if (createdNow) {
    await deps.accounts.store.deleteById(accountId).catch(() => undefined);
  }
}

/**
 * The sign-in role grant, built once so that an undo revokes exactly the
 * row that was made (undoUnlessProviderLive). Sign-in runs pre-authorization, inside the
 * verifier chain, so the grant rides the OSS grant path as an in-process
 * `create` — the interceptor mints the `internal` class, the Authorize
 * step skips for it, and `ValidateGrantableRole` still runs: a provider's
 * misconfigured sign-in role is refused here the way a console grant
 * would be, and the refusal above answers it. The grant never
 * re-enters this verifier: the in-process interceptor stamps the call
 * `internal` itself, and no verifier runs on it. It is made acting for the
 * identity provider whose assertion it follows, so the row and the
 * permission history name the provider, the PlatformClient mint's shape.
 */
function signInRoleGrant(
  accountId: string,
  targetOrgId: string,
  role: string,
): IamPolicySpec {
  return create(IamPolicySpecSchema, {
    principal: create(ApiResourceRefSchema, {
      kind: "identity_account",
      id: accountId,
    }),
    relation: role,
    resource: create(ApiResourceRefSchema, {
      kind: "organization",
      id: targetOrgId,
    }),
  });
}

interface ProfileClaims {
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly pictureUrl: string;
}

/** OIDC two-step profile resolution: JWT claims first, then userinfo. */
async function resolveProfileClaims(
  deps: FederatedVerifierDeps,
  provider: IdentityProvider,
  decoded: DecodedJwt,
  token: string,
): Promise<ProfileClaims> {
  const org = provider.metadata?.org ?? "";
  const slug = provider.metadata?.slug ?? "";
  const claimText = (key: string): string =>
    typeof decoded.payload[key] === "string"
      ? (decoded.payload[key] as string)
      : "";

  const email = claimText("email");
  if (email !== "") {
    let firstName = claimText("given_name");
    let lastName = claimText("family_name");
    if (firstName === "" && lastName === "") {
      const fullName = claimText("name");
      if (fullName !== "") {
        const spaceIndex = fullName.indexOf(" ");
        if (spaceIndex > 0) {
          firstName = fullName.slice(0, spaceIndex);
          lastName = fullName.slice(spaceIndex + 1);
        } else {
          firstName = fullName;
        }
      } else {
        firstName = email.includes("@")
          ? email.slice(0, email.indexOf("@"))
          : email;
      }
    }
    return { email, firstName, lastName, pictureUrl: claimText("picture") };
  }

  const endpoint = provider.spec?.userinfoEndpoint ?? "";
  if (endpoint !== "") {
    try {
      return await deps.fetchUserProfile(endpoint, token);
    } catch (error) {
      deps.logger.warn("federated userinfo fetch failed", {
        idp: `${org}/${slug}`,
        error: error instanceof Error ? error.message : String(error),
      });
      throw unauthenticated(
        `Cannot auto-provision account for IdP '${org}/${slug}': ` +
          "its userinfo endpoint could not be read",
      );
    }
  }

  throw unauthenticated(
    `Cannot resolve profile for user from IdP '${org}/${slug}': JWT does ` +
      "not contain an 'email' claim and no userinfo_endpoint is configured. " +
      "Either configure the IdP to include email in access tokens, or set " +
      "the userinfo_endpoint in the IdentityProvider spec.",
  );
}

function unauthenticated(message: string): ConnectError {
  return new ConnectError(message, Code.Unauthenticated);
}
