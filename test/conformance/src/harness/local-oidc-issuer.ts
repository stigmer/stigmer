// A hermetic OIDC issuer for the OSS server's OIDC posture (20260911.11
// Q-IA-10). Domain: conformance harness.
//
// The multi-user self-host story is `STIGMER_OIDC_ISSUER` pointed at an
// identity provider the operator chose; the identityaccount suite boots a
// sibling server in that posture (targets/target.ts `spawnSibling`) and
// this module IS the provider it points at — in-process, on loopback, with
// nothing dialed out. It publishes the three documents a real issuer does
// and the server reads:
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
// Lifted from the server's own oidc-verifier unit fixture, re-signed
// through the harness's node:crypto signer (jwt.ts): the conformance
// package carries no JOSE dependency, so the tokens are verified by code
// the suite did not write. The unit arms in __tests__/local-oidc-issuer
// pin every document above.
import { createVerify, generateKeyPairSync } from "node:crypto";
import type { KeyObject } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";

import { signRs256Jwt } from "./jwt";

// What a console session lives for; the suite's tokens are short by construction.
const TOKEN_TTL_SECONDS = 5 * 60;
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

export interface LocalOidcIssuer {
  // `http://127.0.0.1:<port>`, no trailing slash — exactly what the server
  // is configured with and what every minted token's `iss` says.
  readonly issuer: string;
  readonly audience: string;
  readonly profile: typeof LOCAL_ISSUER_PROFILE;
  // An access token this issuer would mint for `sub`: RS256 under the
  // published kid, `iss` / `aud` as above, `iat` / `exp`, and the `email`
  // claim (the server's verifier carries it onto CallerIdentity).
  mint(input: { sub: string; email: string }): Promise<string>;
  // Make /userinfo answer 503 for one subject; `undefined` clears the lever.
  refuseUserinfoFor(sub: string | undefined): void;
  close(): Promise<void>;
}

export async function startLocalOidcIssuer(): Promise<LocalOidcIssuer> {
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

  let issuer = "";
  let refusedSub: string | undefined;

  const server: Server = createServer((req, res) => {
    try {
      switch (req.url) {
        case "/.well-known/openid-configuration":
          json(res, 200, {
            issuer,
            jwks_uri: `${issuer}/jwks`,
            userinfo_endpoint: `${issuer}/userinfo`,
          });
          return;
        case "/jwks":
          json(res, 200, { keys: [jwk] });
          return;
        case "/userinfo":
          answerUserinfo(req, res, publicKey, refusedSub);
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
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("local OIDC issuer did not bind a TCP port");
  }
  issuer = `http://127.0.0.1:${address.port}`;

  return {
    issuer,
    audience: AUDIENCE,
    profile: LOCAL_ISSUER_PROFILE,
    async mint(input) {
      const now = Math.floor(Date.now() / 1000);
      return signRs256Jwt({
        privateKeyPem,
        kid: KID,
        claims: {
          iss: issuer,
          sub: input.sub,
          aud: AUDIENCE,
          iat: now,
          exp: now + TOKEN_TTL_SECONDS,
          email: input.email,
        },
      });
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

function base64UrlDecode(segment: string): string {
  return Buffer.from(segment, "base64url").toString("utf8");
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}
