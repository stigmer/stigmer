/**
 * GitHub broker controller — ports pkg/domain/github: the stateless OAuth
 * utility service for workspace repo selection (NOT a resource domain — no
 * store, no persistence of state or tokens; the frontend never holds the
 * client credentials).
 *
 * Proven by github.conformance.test.ts (the Layer-1 protovalidate arms —
 * the only hermetic, cross-edition-true surface; see that suite's header
 * for why the other arms are deliberately absent) and
 * __tests__/github.test.ts (the broker mechanics against an injected
 * fetch, mirroring where Go keeps these pins).
 *
 * The config-missing FailedPrecondition arms are STRUCTURALLY UNREACHABLE
 * on OSS — the bundled "Stigmer Local" defaults (boot/config.ts) cannot be
 * blanked — but they are ported and unit-tested: the guard is live on the
 * cloud edition, and the error copy is cross-edition contract.
 */
import { randomBytes } from "node:crypto";

import type { ConnectRouter } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";

import {
  ExchangeOAuthCodeResponseSchema,
  GetOAuthAuthorizeUrlResponseSchema,
  GitHubService,
} from "@stigmer/protos/ai/stigmer/platform/github/v1/service_pb";
import type {
  ExchangeOAuthCodeRequest,
  ExchangeOAuthCodeResponse,
  GetOAuthAuthorizeUrlRequest,
  GetOAuthAuthorizeUrlResponse,
} from "@stigmer/protos/ai/stigmer/platform/github/v1/service_pb";

import type { Logger } from "../../boot/logger.js";
import { goUrlValuesEncode } from "../../gocompat/query-escape.js";
import {
  failedPreconditionError,
  internalError,
  invalidArgumentError,
  unavailableError,
} from "../../pipeline/errors.js";

/** Go githubAuthorizeURL. */
const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";

/** Go githubTokenURL. */
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";

/** Go oauthScopes — repo access + user identity, the workspace needs. */
const OAUTH_SCOPES = "repo,read:user";

/**
 * Go httpTimeout (10s): the exchange is a single interactive round-trip to
 * github.com; anything slower should fail the RPC rather than hold the
 * caller's OAuth callback open.
 */
const HTTP_TIMEOUT_MS = 10_000;

export interface GitHubControllerDeps {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly logger: Logger;
  /** Test seam for the token exchange; defaults to global fetch. */
  readonly fetchImpl?: typeof fetch;
}

/** Registers the GitHub broker service on the router (routes stage). */
export function registerGitHubServices(
  router: ConnectRouter,
  deps: GitHubControllerDeps,
): void {
  router.service(GitHubService, {
    getOAuthAuthorizeUrl: (req) => getOAuthAuthorizeUrl(deps, req),
    exchangeOAuthCode: (req) => exchangeOAuthCode(deps, req),
  });
}

/**
 * Go GetOAuthAuthorizeUrl: pure URL construction — client_id, the caller's
 * redirect_uri, the pinned scopes, and a random 16-byte hex state, encoded
 * with Go url.Values.Encode semantics (sorted keys, QueryEscape) so the
 * URL is byte-identical across editions.
 */
function getOAuthAuthorizeUrl(
  deps: GitHubControllerDeps,
  req: GetOAuthAuthorizeUrlRequest,
): GetOAuthAuthorizeUrlResponse {
  if (deps.clientId === "") {
    throw failedPreconditionError(
      "GitHub OAuth is not configured (STIGMER_GITHUB_CLIENT_ID not set)",
    );
  }

  let state: string;
  try {
    state = randomBytes(16).toString("hex");
  } catch (error) {
    deps.logger.error("failed to generate OAuth state", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw internalError(error, "failed to generate OAuth state");
  }

  const authorizeUrl =
    GITHUB_AUTHORIZE_URL +
    "?" +
    goUrlValuesEncode({
      client_id: deps.clientId,
      redirect_uri: req.redirectUri,
      scope: OAUTH_SCOPES,
      state,
    });

  return create(GetOAuthAuthorizeUrlResponseSchema, { authorizeUrl, state });
}

/** The JSON shape of GitHub's token endpoint response (Go githubTokenResponse). */
interface GitHubTokenResponse {
  readonly access_token?: string;
  readonly token_type?: string;
  readonly scope?: string;
  readonly error?: string;
  readonly error_description?: string;
}

/**
 * Go ExchangeOAuthCode: POSTs the code to github.com and relays the token
 * to the caller — nothing stored. Error mapping is contract: GitHub's own
 * OAuth error → InvalidArgument (the caller sent a bad/expired code);
 * network failure → Unavailable; unreadable/unparseable response →
 * Internal.
 */
async function exchangeOAuthCode(
  deps: GitHubControllerDeps,
  req: ExchangeOAuthCodeRequest,
): Promise<ExchangeOAuthCodeResponse> {
  if (deps.clientId === "" || deps.clientSecret === "") {
    throw failedPreconditionError("GitHub OAuth is not configured");
  }

  const body = goUrlValuesEncode({
    client_id: deps.clientId,
    client_secret: deps.clientSecret,
    code: req.code,
    redirect_uri: req.redirectUri,
  });

  const fetchImpl = deps.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(GITHUB_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body,
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
  } catch (error) {
    deps.logger.error("GitHub token exchange failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw unavailableError("failed to reach GitHub for token exchange");
  }

  let raw: string;
  try {
    raw = await response.text();
  } catch (error) {
    deps.logger.error("failed to read GitHub token response", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw internalError(error, "failed to read GitHub response");
  }

  let tokenResponse: GitHubTokenResponse;
  try {
    tokenResponse = JSON.parse(raw) as GitHubTokenResponse;
  } catch (error) {
    deps.logger.error("failed to parse GitHub token response", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw internalError(error, "failed to parse GitHub response");
  }

  if (tokenResponse.error !== undefined && tokenResponse.error !== "") {
    deps.logger.warn("GitHub OAuth error", {
      error: tokenResponse.error,
      description: tokenResponse.error_description ?? "",
    });
    throw invalidArgumentError(
      `GitHub OAuth error: ${tokenResponse.error_description ?? ""}`,
    );
  }

  return create(ExchangeOAuthCodeResponseSchema, {
    accessToken: tokenResponse.access_token ?? "",
    tokenType: tokenResponse.token_type ?? "",
    scope: tokenResponse.scope ?? "",
  });
}
