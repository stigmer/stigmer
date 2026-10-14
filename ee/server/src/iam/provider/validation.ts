/**
 * The IdentityProvider validation matrix: every rule a provider's write
 * must meet, rendered flat, with byte-pinned copy because clients match on
 * it, run as the create and update lanes' domain step after the chain has
 * shaped the row, plus the rules that make an issuer claim mean something:
 *
 *   - NormalizeIssuerUrls: trim, strip trailing slashes, lowercase
 *     scheme+host (ports preserved unless default) — the
 *     IssuerUrlNormalizer port (`./issuer-url.ts`, shared with the
 *     federated verifier's lookup), applied before every uniqueness
 *     check so equivalent spellings collide — and de-duplicates, so two
 *     spellings of one issuer are kept once rather than colliding with
 *     their own provider.
 *   - ValidateSignInFields: an `external_id_claim` is refused on a
 *     provider in a child organization (a child has no children, so every
 *     sign-in it routed would be refused; one read of the provider's
 *     organization).
 *   - ValidateSignInRole: a set `sign_in_role` is a role an organization
 *     grants (`grantableRolesFor`, the contract's kind_meta), or every
 *     sign-in's grant would fail and refuse the person. The roles offered
 *     leave out owner, which the contract refuses on its own; unset grants
 *     nothing. The contract holds the rest, run by
 *     the chain's ValidateProto: an owner sign-in role
 *     (`identity_provider.sign_in_role_not_owner`; the federated verifier
 *     also refuses a row stored before that at sign-in).
 *   - ValidateReservedIssuers: an issuer the host's own sign-in lanes
 *     claim (its own platform tenant or operator issuer) is never an
 *     organization's. The host's verifier order keeps such a row inert as
 *     well; this arm makes the refusal explicit and independent of the
 *     order.
 *   - ValidateRouteUniqueness: a provider's routes are its issuers, each
 *     with its audience, and a route belongs to one provider on the
 *     platform. The app-level first line; the route side table's primary
 *     key is the constraint backstop (the store's transactional rewrite
 *     makes them agree by construction). The claim is the pair, not the
 *     issuer: organizations that federate with one issuer each register
 *     their own audience, so nobody holds an issuer for everyone. The
 *     audience's presence is the contract's (`expected_audience` is
 *     required), and so is a `jwks_uri` wherever an issuer is named
 *     (`identity_provider.jwks_uri_required_with_issuers`).
 *   - ValidateUserinfoEndpoint: a non-empty `userinfo_endpoint` is a
 *     valid HTTPS URL — the same two pure arms `jwks_uri` has, because
 *     the federated lane sends a Bearer token there. No fetch (userinfo
 *     needs a token) and no name resolution: an answer from DNS at save
 *     time can change afterwards, so the egress policy judges the
 *     endpoint where it is dialed; the discovery arm below binds it to
 *     its issuer instead. Pure, so it runs before the live reads below.
 *   - ValidateIssuerDiscovery: every issuer is HTTPS and publishes an
 *     OpenID Connect Discovery document (read through the shared reader,
 *     `verifiers/oidc-discovery.ts`, all issuers at once under the one
 *     timeout) whose `issuer` is it, canonically; the provider's
 *     `jwks_uri` is the one every document names, and so is its
 *     `userinfo_endpoint` when set. This is what binds a provider's keys
 *     to its issuer: without it an admin could name another party's
 *     issuer and verify its tokens with keys of the admin's own. The
 *     audience may not be a URL a document names (an issuer can stamp
 *     such a URL on every token, Auth0's userinfo URL for one, so it
 *     identifies no registration and would collide at routing).
 *   - ValidateJwksReachability: HTTPS-only, live fetch (5s), a real
 *     `keys` array, non-empty — every arm INVALID_ARGUMENT.
 *
 * Every live read dials the composition's egress-guarded fetch, because
 * an organization admin writes every URL it reads: a
 * destination the policy refuses, on the first hop or any redirect, is
 * INVALID_ARGUMENT and the refused hop is never dialed. A name that
 * resolves to nothing reads exactly as one that resolves to a refused
 * address: the platform resolves names through a network the admin does
 * not own, so two copies would tell them whether an internal name exists.
 * The copy on the wire is fixed: it names the value the admin wrote and
 * what is wrong with it, never the cause a fetch or the egress policy
 * gave, which can say what an internal name resolves to; the cause goes
 * to the log.
 */
import { Code, ConnectError } from "@connectrpc/connect";
import { asFetch, EgressError, type OutboundFetch } from "@stigmer/outbound/egress";
import type { Logger } from "@stigmer/server";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { FederationIssuer } from "@stigmer/protos/ai/stigmer/iam/federationissuer/v1/api_pb";
import { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import {
  readDiscoveryDocument,
  type DiscoveryRead,
  type OidcDiscoveryDocument,
} from "../../verifiers/oidc-discovery.js";
import type { OrganizationLookup } from "../organization-links.js";
import { grantableRolesFor } from "../policy/roles.js";
import { normalizeIssuerUrl } from "./issuer-url.js";
import { routesOf, type ProviderRoute } from "./routes.js";
import type { FederationIssuerStore } from "./store.js";

/** The JWKS reachability check's timeout, and the budget of every live read here. */
const JWKS_VALIDATION_TIMEOUT_MS = 5_000;

export interface ProviderValidationDeps {
  readonly store: Pick<FederationIssuerStore, "findProviderIdByRoute">;
  /** The provider's organization, read for its parent when the provider routes to children. */
  readonly organizations: OrganizationLookup;
  /** The egress-guarded fetch every live read dials through (the composition's one). */
  readonly outboundFetch: OutboundFetch;
  /** The issuers the host's own sign-in lanes claim, which no provider may name. */
  readonly reservedIssuers: ReadonlyArray<string>;
  /** Where a live read's cause goes, since the wire copy never carries it. */
  readonly logger: Logger;
}

/**
 * NormalizeIssuerUrls: canonicalize in place, dropping spellings that
 * normalize to nothing or to an issuer already kept (the first keeps its
 * place).
 */
export function normalizeIssuers(provider: FederationIssuer): void {
  const spec = provider.spec;
  if (spec !== undefined) {
    spec.allowedIssuers = [
      ...new Set(spec.allowedIssuers.map(normalizeIssuerUrl).filter((issuer) => issuer !== "")),
    ];
  }
}

/** The matrix, in its pinned order; every refusal is a ConnectError with its pinned copy. */
export async function validateProvider(
  deps: ProviderValidationDeps,
  provider: FederationIssuer,
  isUpdate: boolean,
): Promise<void> {
  const spec = provider.spec;
  const org = provider.metadata?.org ?? "";
  const id = provider.metadata?.id ?? "";
  if (spec === undefined) {
    throw new ConnectError("spec is required", Code.InvalidArgument);
  }

  // ── ValidateSignInFields ──
  // The contract refuses an owner sign-in role (protovalidate, before this
  // matrix). What it cannot say: the claim routes a sign-in to one of the
  // provider organization's children, which a child organization's
  // provider cannot do (a child has no children).
  if (spec.externalIdClaim !== "") {
    if (((await deps.organizations.find(org))?.parentOrg ?? "") !== "") {
      throw new ConnectError(
        "external_id_claim cannot be set on an identity provider of a child " +
          "organization: a child organization has no child organizations to " +
          "route a sign-in to.",
        Code.FailedPrecondition,
      );
    }
  }

  // ── ValidateSignInRole ──
  // Owner is the contract's own refusal (protovalidate, before this
  // matrix); unset grants nothing.
  if (
    spec.signInRole !== IamRole.iam_role_unspecified &&
    spec.signInRole !== IamRole.owner &&
    !grantableRolesFor(ApiResourceKind.organization).includes(spec.signInRole)
  ) {
    throw signInRoleNotGrantableError(spec.signInRole);
  }

  // ── ValidateReservedIssuers ──
  const reserved = new Set(deps.reservedIssuers.map(normalizeIssuerUrl));
  for (const issuer of spec.allowedIssuers) {
    if (reserved.has(issuer)) {
      throw reservedIssuerError(issuer);
    }
  }

  // ── ValidateRouteUniqueness (the app-level first line) ──
  for (const route of routesOf(provider)) {
    const claimedBy = await deps.store.findProviderIdByRoute(route.issuer, route.audience);
    if (claimedBy !== undefined && claimedBy !== id) {
      throw routeTakenError(route);
    }
  }

  // ── ValidateUserinfoEndpoint (pure, so it runs before the live reads) ──
  if (spec.userinfoEndpoint !== "") {
    validateUserinfoEndpoint(spec.userinfoEndpoint);
  }

  // ── ValidateIssuerDiscovery ──
  if (spec.allowedIssuers.length > 0) {
    await validateIssuerDiscovery(deps, provider);
  }

  // ── ValidateJwksReachability ──
  if (spec.jwksUri !== "") {
    await validateJwksReachability(spec.jwksUri, deps);
  }
}

/** A sign-in role no organization grants: the platform client's copy in `@stigmer/server`, word for word. */
function signInRoleNotGrantableError(role: IamRole): ConnectError {
  const offered = grantableRolesFor(ApiResourceKind.organization)
    .filter((grantable) => grantable !== IamRole.owner)
    .map((grantable) => `'${IamRole[grantable]}'`);
  return new ConnectError(
    `sign_in_role '${IamRole[role]}' cannot be granted on an organization; ` +
      `set one of ${offered.join(", ")}, or leave it unset to grant nothing.`,
    Code.InvalidArgument,
  );
}

/**
 * The route-uniqueness copy, for the app-level check and for the
 * constraint backstop when a racing write claimed the route first. It
 * names the pair the caller wrote and the way forward, never who holds it.
 */
export function routeTakenError(route: ProviderRoute): ConnectError {
  return new ConnectError(
    `Issuer '${route.issuer}' with audience '${route.audience}' is already ` +
      "registered by another identity provider. Register an audience of " +
      "your organization's own for Stigmer at this issuer, such as an API " +
      "identifier or a client ID, and use it here.",
    Code.AlreadyExists,
  );
}

/** A host's own sign-in issuer, named on a provider. */
function reservedIssuerError(issuer: string): ConnectError {
  return new ConnectError(
    `Issuer '${issuer}' is this platform's own sign-in issuer and cannot be ` +
      "an organization's identity provider.",
    Code.InvalidArgument,
  );
}

function validateUserinfoEndpoint(endpoint: string): void {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new ConnectError(
      `UserInfo endpoint is not a valid URL: ${endpoint}`,
      Code.InvalidArgument,
    );
  }
  if (url.protocol !== "https:") {
    throw new ConnectError(
      `UserInfo endpoint must use HTTPS: ${endpoint}`,
      Code.InvalidArgument,
    );
  }
}

/**
 * Every issuer's document, read at once, then judged in the provider's
 * order so the first refusal is always the same one.
 */
async function validateIssuerDiscovery(
  deps: ProviderValidationDeps,
  provider: FederationIssuer,
): Promise<void> {
  const spec = provider.spec;
  const issuers = spec?.allowedIssuers ?? [];
  for (const issuer of issuers) {
    if (!issuer.startsWith("https://")) {
      throw new ConnectError(`Issuer must use HTTPS: ${issuer}`, Code.InvalidArgument);
    }
  }
  const fetchImpl = asFetch(deps.outboundFetch);
  const reads = await Promise.all(
    issuers.map((issuer) =>
      readDiscoveryDocument(issuer, { fetchImpl, timeoutMs: JWKS_VALIDATION_TIMEOUT_MS }),
    ),
  );
  issuers.forEach((issuer, index) => {
    const read = reads[index];
    if (read === undefined) {
      throw new Error(`no discovery read for issuer ${issuer}`);
    }
    const document = discoveredDocument(issuer, read, deps.logger);
    if (normalizeIssuerUrl(document.issuer) !== issuer) {
      throw new ConnectError(
        `The discovery document of issuer '${issuer}' names another issuer, ` +
          `'${document.issuer}'. Name the issuer its own document publishes.`,
        Code.InvalidArgument,
      );
    }
    if (spec?.jwksUri !== document.jwksUri) {
      throw new ConnectError(
        `jwks_uri must be the key set issuer '${issuer}' publishes in its ` +
          `discovery document: ${document.jwksUri}`,
        Code.InvalidArgument,
      );
    }
    const userinfo = spec.userinfoEndpoint;
    if (userinfo !== "" && userinfo !== document.userinfoEndpoint) {
      throw new ConnectError(
        `userinfo_endpoint must be the one issuer '${issuer}' publishes in ` +
          `its discovery document${document.userinfoEndpoint === undefined ? ", which names none" : `: ${document.userinfoEndpoint}`}`,
        Code.InvalidArgument,
      );
    }
    if (document.endpoints.includes(spec.expectedAudience)) {
      throw new ConnectError(
        `expected_audience '${spec.expectedAudience}' is a URL the discovery ` +
          `document of issuer '${issuer}' names, which the issuer may add to ` +
          "every token it mints. Use the API identifier or client ID your " +
          "organization registered for Stigmer at this issuer.",
        Code.InvalidArgument,
      );
    }
  });
}

/** The document a read found, or the refusal its failure answers, with the cause in the log. */
function discoveredDocument(
  issuer: string,
  read: DiscoveryRead,
  logger: Logger,
): OidcDiscoveryDocument {
  switch (read.kind) {
    case "document":
      return read.document;
    case "unreachable": {
      logger.warn("identity provider issuer discovery unreachable", {
        issuer,
        url: read.url,
        error: read.cause instanceof Error ? read.cause.message : String(read.cause),
      });
      if (read.cause instanceof EgressError) {
        throw new ConnectError(
          `The discovery document of issuer '${issuer}' is not at an address this platform can reach.`,
          Code.InvalidArgument,
        );
      }
      if (read.cause instanceof DOMException && read.cause.name === "TimeoutError") {
        throw new ConnectError(
          `The discovery document of issuer '${issuer}' did not answer within ` +
            `${JWKS_VALIDATION_TIMEOUT_MS / 1000} seconds: ${read.url}`,
          Code.InvalidArgument,
        );
      }
      throw new ConnectError(
        `The discovery document of issuer '${issuer}' is not reachable: ${read.url}`,
        Code.InvalidArgument,
      );
    }
    case "status":
      throw new ConnectError(
        `The discovery document of issuer '${issuer}' answered HTTP ${read.status}. ` +
          `Every issuer must publish one at ${read.url}`,
        Code.InvalidArgument,
      );
    case "malformed":
      throw new ConnectError(
        read.missing === "json"
          ? `The discovery document of issuer '${issuer}' is not a JSON document: ${read.url}`
          : `The discovery document of issuer '${issuer}' names no ${read.missing}: ${read.url}`,
        Code.InvalidArgument,
      );
    default: {
      const exhaustive: never = read;
      throw new Error(`unknown discovery read: ${JSON.stringify(exhaustive)}`);
    }
  }
}

async function validateJwksReachability(
  jwksUri: string,
  deps: ProviderValidationDeps,
): Promise<void> {
  let url: URL;
  try {
    url = new URL(jwksUri);
  } catch {
    throw new ConnectError(
      `JWKS URI is not a valid URL: ${jwksUri}`,
      Code.InvalidArgument,
    );
  }
  if (url.protocol !== "https:") {
    throw new ConnectError(
      `JWKS URI must use HTTPS: ${jwksUri}`,
      Code.InvalidArgument,
    );
  }
  let response: Response;
  try {
    response = await deps.outboundFetch(jwksUri, {
      signal: AbortSignal.timeout(JWKS_VALIDATION_TIMEOUT_MS),
    });
  } catch (error) {
    deps.logger.warn("identity provider JWKS URI unreachable", {
      jwksUri,
      error: error instanceof Error ? error.message : String(error),
    });
    if (error instanceof EgressError) {
      throw new ConnectError(
        `JWKS URI is not an address this platform can reach: ${jwksUri}`,
        Code.InvalidArgument,
      );
    }
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new ConnectError(
        `JWKS URI timed out after ${JWKS_VALIDATION_TIMEOUT_MS / 1000} seconds: ${jwksUri}`,
        Code.InvalidArgument,
      );
    }
    throw new ConnectError(
      `JWKS URI is not reachable: ${jwksUri}`,
      Code.InvalidArgument,
    );
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new ConnectError(
      `JWKS URI returned HTTP ${response.status}. Verify the URL is correct: ${jwksUri}`,
      Code.InvalidArgument,
    );
  }
  let body: { keys?: unknown };
  try {
    body = (await response.json()) as { keys?: unknown };
  } catch {
    throw new ConnectError(
      `JWKS URI did not return a valid JSON Web Key Set (missing 'keys' array): ${jwksUri}`,
      Code.InvalidArgument,
    );
  }
  if (!Array.isArray(body.keys)) {
    throw new ConnectError(
      `JWKS URI did not return a valid JSON Web Key Set (missing 'keys' array): ${jwksUri}`,
      Code.InvalidArgument,
    );
  }
  if (body.keys.length === 0) {
    throw new ConnectError(
      `JWKS URI returned an empty key set (no signing keys): ${jwksUri}`,
      Code.InvalidArgument,
    );
  }
}
