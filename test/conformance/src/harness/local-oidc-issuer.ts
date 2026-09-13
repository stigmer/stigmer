// A hermetic OIDC issuer for the OSS server's OIDC posture (20260911.11
// Q-IA-10). Domain: conformance harness.
//
// The multi-user self-host story is `STIGMER_OIDC_ISSUER` pointed at an
// identity provider the operator chose; the identityaccount suite boots a
// sibling server in that posture (targets/target.ts `spawnSibling`) and
// this module IS the provider it points at — in-process, on loopback, with
// nothing dialed out. It publishes the documents a real issuer does and the
// server reads:
//   - discovery (`/.well-known/openid-configuration`): `issuer` exactly as
//     configured (the server refuses a document naming anyone else),
//     `jwks_uri`, and `userinfo_endpoint` — the provisioning lane reads the
//     endpoint from here and never guesses `<issuer>/userinfo`
//     (T01_1_review.md A8);
//   - JWKS (`/jwks`): the one RS256 key the minted tokens verify against;
//   - userinfo (`/userinfo`): the profile a first login is built from. An
//     access token carries no profile, so `provisionMyAccount` asks here;
//     the answer is the bearer's own `sub` and `email` plus a FIXED
//     given_name / family_name (`profile`) the suite asserts against.
//
// `/userinfo` VERIFIES the bearer (this key's signature, `exp`) before it
// answers, as a real provider would — a fixture that decoded blindly would
// let a server that skipped verification pass. `refuseUserinfoFor(sub)`
// is the one lever: 503 for that subject until cleared, so the suite can
// drive the UNAVAILABLE arm of provisioning against a live outage.
//
// Since 20260913.02 (sp.console-login, Q-CL-7) the issuer also drives a
// BROWSER through the Authorization Code + PKCE flow the web console runs,
// so a Playwright spec can sign in to a real server end to end:
//   - `/authorize` validates the request (response_type=code, S256 PKCE —
//     the console never sends less, and a fixture that accepted less would
//     let a weaker client pass), auto-consents as the configured `person`,
//     and 302s to the redirect URI with a single-use code and the state;
//   - `/token` redeems the code once, only for the verifier whose S256 hash
//     it was issued against and the redirect URI it was issued to, and
//     mints an access token (`aud` = the audience, for the server), an
//     id_token (`aud` = the client, the request's `nonce` echoed — what
//     oidc-client-ts validates) and, when `offline_access` was requested, a
//     refresh token the refresh grant redeems for a fresh access token;
//   - `/end-session` exists only under `{ endSession: true }`, so both of
//     the console's sign-out arms are drivable — RP-initiated where an
//     issuer publishes the endpoint, local where it does not;
//   - every browser-facing document answers CORS (`*`), because the console
//     calls `/token` cross-origin from `next dev` in the e2e stack shape.
// A `port` option pins the listener, because the e2e config must know the
// issuer URL before the browser starts. `local-oidc-issuer-main.ts` runs
// it as a process for the e2e package, which never imports across test
// packages.
//
// Lifted from the server's own oidc-verifier unit fixture, re-signed
// through the harness's node:crypto signer (jwt.ts): the conformance
// package carries no JOSE dependency, so the tokens are verified by code
// the suite did not write. The unit arms in __tests__/local-oidc-issuer
// pin every document above.
import {
  createHash,
  createVerify,
  generateKeyPairSync,
  randomBytes,
} from "node:crypto";
import type { KeyObject } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";

import { signRs256Jwt } from "./jwt";

// What a console session lives for; the suite's tokens are short by construction.
const TOKEN_TTL_SECONDS = 5 * 60;
// An authorization code is redeemed within seconds of issue; a minute is
// generous and keeps an abandoned code from living in the map for long.
const CODE_TTL_SECONDS = 60;
const KID = "conformance-local-issuer";
// Any URI the server is configured to expect; the suite passes it through
// STIGMER_OIDC_AUDIENCE, so the value is a fixture constant, not a contract.
const AUDIENCE = "https://conformance.stigmer.test/api";

// The fixed names every /userinfo answer carries — a first login's
// first_name / last_name come from here, never from the token.
export const LOCAL_ISSUER_PROFILE = Object.freeze({
  givenName: "Conformance",
  familyName: "Person",
});

/** The one person `/authorize` signs in as; a browser needs no credentials. */
export const LOCAL_ISSUER_PERSON = Object.freeze({
  sub: "local-issuer|person",
  email: "person@conformance.stigmer.test",
});

export interface LocalOidcIssuerOptions {
  // Pin the listener (the e2e stack shape); 0 or absent picks a free port.
  readonly port?: number;
  // The audience minted access tokens carry. Defaults to the fixture
  // constant; the e2e stack shape names its own so the console, the server
  // and the issuer read one value from one place.
  readonly audience?: string;
  // Publish `end_session_endpoint` and serve `/end-session`. Off by default:
  // an issuer with no logout endpoint (Dex) is the harder arm to reach.
  readonly endSession?: boolean;
  // Who `/authorize` signs in as. Defaults to LOCAL_ISSUER_PERSON.
  readonly person?: { readonly sub: string; readonly email: string };
}

export interface LocalOidcIssuer {
  // `http://127.0.0.1:<port>`, no trailing slash — exactly what the server
  // is configured with and what every minted token's `iss` says.
  readonly issuer: string;
  readonly audience: string;
  readonly profile: typeof LOCAL_ISSUER_PROFILE;
  // The person the code flow signs in as.
  readonly person: { readonly sub: string; readonly email: string };
  // An access token this issuer would mint for `sub`: RS256 under the
  // published kid, `iss` / `aud` as above, `iat` / `exp`, and the `email`
  // claim (the server's verifier carries it onto CallerIdentity).
  mint(input: { sub: string; email: string }): Promise<string>;
  // Make /userinfo answer 503 for one subject; `undefined` clears the lever.
  refuseUserinfoFor(sub: string | undefined): void;
  close(): Promise<void>;
}

/** What `/authorize` recorded for a code, redeemed once by `/token`. */
interface PendingCode {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly codeChallenge: string;
  readonly scope: string;
  readonly nonce: string | undefined;
  readonly issuedAt: number;
}

/** What a refresh token stands for. */
interface RefreshGrant {
  readonly clientId: string;
  readonly scope: string;
}

export async function startLocalOidcIssuer(
  options: LocalOidcIssuerOptions = {},
): Promise<LocalOidcIssuer> {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const privateKeyPem = privateKey
    .export({ type: "pkcs8", format: "pem" })
    .toString();
  const jwk = {
    ...publicKey.export({ format: "jwk" }),
    kid: KID,
    alg: "RS256",
    use: "sig",
  };
  const person = options.person ?? LOCAL_ISSUER_PERSON;
  const audience = options.audience ?? AUDIENCE;
  const endSession = options.endSession === true;

  let issuer = "";
  let refusedSub: string | undefined;
  const pendingCodes = new Map<string, PendingCode>();
  const refreshGrants = new Map<string, RefreshGrant>();

  const mintAccessToken = (input: { sub: string; email: string }): string => {
    const now = Math.floor(Date.now() / 1000);
    return signRs256Jwt({
      privateKeyPem,
      kid: KID,
      claims: {
        iss: issuer,
        sub: input.sub,
        aud: audience,
        iat: now,
        exp: now + TOKEN_TTL_SECONDS,
        email: input.email,
      },
    });
  };

  // The id_token is for the CLIENT: `aud` is the client id and the nonce
  // is echoed, which is what oidc-client-ts checks before it accepts the
  // response (it does not verify the signature; it trusts the channel).
  const mintIdToken = (clientId: string, nonce: string | undefined): string => {
    const now = Math.floor(Date.now() / 1000);
    return signRs256Jwt({
      privateKeyPem,
      kid: KID,
      claims: {
        iss: issuer,
        sub: person.sub,
        aud: clientId,
        iat: now,
        exp: now + TOKEN_TTL_SECONDS,
        email: person.email,
        name: `${LOCAL_ISSUER_PROFILE.givenName} ${LOCAL_ISSUER_PROFILE.familyName}`,
        ...(nonce !== undefined ? { nonce } : {}),
      },
    });
  };

  const tokenResponse = (grant: {
    clientId: string;
    scope: string;
    nonce: string | undefined;
    issueRefresh: boolean;
  }): Record<string, unknown> => {
    const body: Record<string, unknown> = {
      access_token: mintAccessToken(person),
      id_token: mintIdToken(grant.clientId, grant.nonce),
      token_type: "Bearer",
      expires_in: TOKEN_TTL_SECONDS,
      scope: grant.scope,
    };
    if (grant.issueRefresh) {
      const refreshToken = randomBytes(32).toString("base64url");
      refreshGrants.set(refreshToken, {
        clientId: grant.clientId,
        scope: grant.scope,
      });
      body.refresh_token = refreshToken;
    }
    return body;
  };

  const server: Server = createServer((req, res) => {
    // Every document is browser-facing in the e2e shape; CORS is answered
    // before routing so a preflight on any path succeeds.
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
    res.setHeader(
      "access-control-allow-headers",
      "authorization, content-type",
    );
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }
    const url = new URL(req.url ?? "/", issuer);
    try {
      switch (url.pathname) {
        case "/.well-known/openid-configuration":
          json(res, 200, {
            issuer,
            jwks_uri: `${issuer}/jwks`,
            userinfo_endpoint: `${issuer}/userinfo`,
            authorization_endpoint: `${issuer}/authorize`,
            token_endpoint: `${issuer}/token`,
            ...(endSession
              ? { end_session_endpoint: `${issuer}/end-session` }
              : {}),
            response_types_supported: ["code"],
            grant_types_supported: ["authorization_code", "refresh_token"],
            code_challenge_methods_supported: ["S256"],
            subject_types_supported: ["public"],
            id_token_signing_alg_values_supported: ["RS256"],
            scopes_supported: ["openid", "email", "profile", "offline_access"],
          });
          return;
        case "/jwks":
          json(res, 200, { keys: [jwk] });
          return;
        case "/userinfo":
          answerUserinfo(req, res, publicKey, refusedSub);
          return;
        case "/authorize":
          answerAuthorize(url, res, pendingCodes);
          return;
        case "/token":
          void answerToken(
            req,
            res,
            pendingCodes,
            refreshGrants,
            tokenResponse,
          );
          return;
        case "/end-session":
          if (!endSession) {
            res.statusCode = 404;
            res.end();
            return;
          }
          answerEndSession(url, res);
          return;
        default:
          res.statusCode = 404;
          res.end();
      }
    } catch (error) {
      // A fixture bug must fail the arm that hit it, never hang the request
      // until the test's timeout hides which side broke.
      json(res, 500, { error: String(error) });
    }
  });
  server.listen(options.port ?? 0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("local OIDC issuer did not bind a TCP port");
  }
  issuer = `http://127.0.0.1:${address.port}`;

  return {
    issuer,
    audience,
    profile: LOCAL_ISSUER_PROFILE,
    person,
    async mint(input) {
      return mintAccessToken(input);
    },
    refuseUserinfoFor(sub) {
      refusedSub = sub;
    },
    async close() {
      // Keep-alive sockets from the server under test would otherwise hold
      // close() open until they idle out.
      server.closeAllConnections();
      server.close();
      await once(server, "close");
    },
  };
}

// ---------------------------------------------------------------------------
// /authorize — the browser's leg in
// ---------------------------------------------------------------------------

function answerAuthorize(
  url: URL,
  res: ServerResponse,
  pendingCodes: Map<string, PendingCode>,
): void {
  const q = url.searchParams;
  const clientId = q.get("client_id") ?? "";
  const redirectUri = q.get("redirect_uri") ?? "";
  const codeChallenge = q.get("code_challenge") ?? "";
  const state = q.get("state");
  if (
    q.get("response_type") !== "code" ||
    clientId === "" ||
    redirectUri === "" ||
    codeChallenge === "" ||
    q.get("code_challenge_method") !== "S256"
  ) {
    json(res, 400, {
      error: "invalid_request",
      error_description:
        "response_type=code with client_id, redirect_uri and S256 PKCE are required",
    });
    return;
  }
  let target: URL;
  try {
    target = new URL(redirectUri);
  } catch {
    json(res, 400, {
      error: "invalid_request",
      error_description: "redirect_uri is not a URL",
    });
    return;
  }
  const code = randomBytes(24).toString("base64url");
  pendingCodes.set(code, {
    clientId,
    redirectUri,
    codeChallenge,
    scope: q.get("scope") ?? "openid",
    nonce: q.get("nonce") ?? undefined,
    issuedAt: Date.now(),
  });
  target.searchParams.set("code", code);
  if (state !== null) target.searchParams.set("state", state);
  res.statusCode = 302;
  res.setHeader("location", target.toString());
  res.end();
}

// ---------------------------------------------------------------------------
// /token — the code exchange and the refresh grant
// ---------------------------------------------------------------------------

async function answerToken(
  req: IncomingMessage,
  res: ServerResponse,
  pendingCodes: Map<string, PendingCode>,
  refreshGrants: Map<string, RefreshGrant>,
  tokenResponse: (grant: {
    clientId: string;
    scope: string;
    nonce: string | undefined;
    issueRefresh: boolean;
  }) => Record<string, unknown>,
): Promise<void> {
  if (req.method !== "POST") {
    json(res, 405, { error: "invalid_request" });
    return;
  }
  const form = new URLSearchParams(await readBody(req));
  const grantType = form.get("grant_type");

  if (grantType === "authorization_code") {
    const code = form.get("code") ?? "";
    const pending = pendingCodes.get(code);
    const verifier = form.get("code_verifier") ?? "";
    const expired =
      pending !== undefined &&
      Date.now() - pending.issuedAt > CODE_TTL_SECONDS * 1000;
    if (
      pending === undefined ||
      expired ||
      pending.redirectUri !== (form.get("redirect_uri") ?? "") ||
      pending.clientId !== (form.get("client_id") ?? "") ||
      s256(verifier) !== pending.codeChallenge
    ) {
      // A wrong verifier does NOT burn the code (the right client may
      // still redeem it); only a successful exchange deletes it.
      if (pending !== undefined && expired) pendingCodes.delete(code);
      json(res, 400, { error: "invalid_grant" });
      return;
    }
    pendingCodes.delete(code);
    json(
      res,
      200,
      tokenResponse({
        clientId: pending.clientId,
        scope: pending.scope,
        nonce: pending.nonce,
        issueRefresh: pending.scope.split(" ").includes("offline_access"),
      }),
    );
    return;
  }

  if (grantType === "refresh_token") {
    const grant = refreshGrants.get(form.get("refresh_token") ?? "");
    if (
      grant === undefined ||
      grant.clientId !== (form.get("client_id") ?? "")
    ) {
      json(res, 400, { error: "invalid_grant" });
      return;
    }
    // A fresh access token; the refresh token itself stays valid (the
    // non-rotating shape, the simplest an IdP can offer).
    json(
      res,
      200,
      tokenResponse({
        clientId: grant.clientId,
        scope: grant.scope,
        nonce: undefined,
        issueRefresh: false,
      }),
    );
    return;
  }

  json(res, 400, { error: "unsupported_grant_type" });
}

// ---------------------------------------------------------------------------
// /end-session — RP-initiated logout, when the issuer publishes one
// ---------------------------------------------------------------------------

function answerEndSession(url: URL, res: ServerResponse): void {
  const postLogout = url.searchParams.get("post_logout_redirect_uri");
  if (postLogout === null) {
    json(res, 400, {
      error: "invalid_request",
      error_description: "post_logout_redirect_uri is required",
    });
    return;
  }
  let target: URL;
  try {
    target = new URL(postLogout);
  } catch {
    json(res, 400, {
      error: "invalid_request",
      error_description: "post_logout_redirect_uri is not a URL",
    });
    return;
  }
  const state = url.searchParams.get("state");
  if (state !== null) target.searchParams.set("state", state);
  res.statusCode = 302;
  res.setHeader("location", target.toString());
  res.end();
}

// ---------------------------------------------------------------------------
// /userinfo
// ---------------------------------------------------------------------------

function answerUserinfo(
  req: IncomingMessage,
  res: ServerResponse,
  publicKey: KeyObject,
  refusedSub: string | undefined,
): void {
  const claims = verifiedBearerClaims(req, publicKey);
  if (claims === undefined) {
    res.statusCode = 401;
    res.setHeader("www-authenticate", "Bearer");
    res.end();
    return;
  }
  if (refusedSub !== undefined && claims.sub === refusedSub) {
    res.statusCode = 503;
    res.end();
    return;
  }
  json(res, 200, {
    sub: claims.sub,
    email: claims.email,
    given_name: LOCAL_ISSUER_PROFILE.givenName,
    family_name: LOCAL_ISSUER_PROFILE.familyName,
    picture: `${claims.iss}/pictures/${encodeURIComponent(claims.sub)}`,
  });
}

interface BearerClaims {
  iss: string;
  sub: string;
  email: string;
}

// The bearer's claims if, and only if, the token is one this issuer signed
// and it has not expired — what a provider checks before it answers.
function verifiedBearerClaims(
  req: IncomingMessage,
  publicKey: KeyObject,
): BearerClaims | undefined {
  const header = req.headers.authorization ?? "";
  if (!header.startsWith("Bearer ")) return undefined;
  const [encodedHeader, encodedPayload, encodedSignature, ...rest] = header
    .slice("Bearer ".length)
    .split(".");
  if (
    encodedHeader === undefined ||
    encodedPayload === undefined ||
    encodedSignature === undefined ||
    rest.length > 0
  ) {
    return undefined;
  }
  let joseHeader: { alg?: unknown; kid?: unknown };
  let payload: { iss?: unknown; sub?: unknown; email?: unknown; exp?: unknown };
  try {
    joseHeader = JSON.parse(
      base64UrlDecode(encodedHeader),
    ) as typeof joseHeader;
    payload = JSON.parse(base64UrlDecode(encodedPayload)) as typeof payload;
  } catch {
    return undefined;
  }
  if (joseHeader.alg !== "RS256" || joseHeader.kid !== KID) return undefined;
  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${encodedHeader}.${encodedPayload}`);
  if (!verifier.verify(publicKey, Buffer.from(encodedSignature, "base64url"))) {
    return undefined;
  }
  if (
    typeof payload.exp !== "number" ||
    payload.exp <= Math.floor(Date.now() / 1000)
  ) {
    return undefined;
  }
  if (typeof payload.iss !== "string" || typeof payload.sub !== "string") {
    return undefined;
  }
  return {
    iss: payload.iss,
    sub: payload.sub,
    email: typeof payload.email === "string" ? payload.email : "",
  };
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function s256(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function base64UrlDecode(segment: string): string {
  return Buffer.from(segment, "base64url").toString("utf8");
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}
