/**
 * Pins the OIDC identity verifier against a hermetic local issuer (an
 * in-process HTTP server serving real discovery + JWKS documents, tokens
 * signed with a real RS256 keypair — no network, no mocks of jose):
 * claim-or-pass (non-JWT shapes pass, JWT shapes are claimed), the
 * identity mapping (sub/iss/email/name), the four byte-pinned Java
 * classifyAuthError arms, and the infrastructure-fault posture (discovery
 * failures are plain errors for the chassis's INTERNAL arm — never
 * credential rejections).
 *
 * Since 20260911.11 (Q-IA-2, A1) the verifier also resolves the subject to
 * an identity ACCOUNT id when one exists — the cloud's direct-login
 * posture — through the store port it is composed with: a hit stamps the
 * account id, a miss admits the caller idp-shaped (identityId = sub) so
 * whoAmI can answer NOT_FOUND and provisionMyAccount can run. One
 * primary-key read per request, no cache (the same liveness posture as
 * the API-key lane). The store is a REQUIRED dependency (a nullable that
 * changes what identityId means is exactly the modeled-state rule
 * forbids); over an empty store every pre-entry arm reads as before.
 *
 * Issuer discovery is a REQUIRED dependency too (T01_1_review.md A8; the
 * S2 slice-2 refinement): the verifier reads the JWKS location through
 * the shared oidc-discovery module the composition root builds once for
 * every lane. Two arms make the memo visible — N sequential verifies
 * fetch the well-known document once and the JWKS once — and one pins
 * that claim-or-pass precedes discovery: a non-JWT token passes with no
 * network even when the issuer is unreachable.
 */
import { createServer } from "node:http";
import type { Server } from "node:http";
import { once } from "node:events";

import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import type { GenerateKeyPairResult } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { IdentityAccountSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountProvisioningMode } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/enum_pb";

import { fakeIdentityAccountStore } from "../../domain/identityaccount/__tests__/support.js";
import { accountIdFor } from "../../domain/identityaccount/constants.js";
import { newIssuerDiscovery } from "../oidc-discovery.js";
import {
  INVALID_TOKEN_MESSAGE,
  TOKEN_AUDIENCE_MESSAGE,
  TOKEN_EXPIRED_MESSAGE,
  TOKEN_SIGNATURE_MESSAGE,
  newOidcIdentityVerifier,
} from "../oidc-verifier.js";

const AUDIENCE = "https://api.stigmer.test/";

let issuerServer: Server;
let issuer: string;
let keys: GenerateKeyPairResult;
let strangerKeys: GenerateKeyPairResult;
// How often the hermetic issuer served each document — the memo arms read these.
const hits = { discovery: 0, jwks: 0 };

beforeAll(async () => {
  keys = await generateKeyPair("RS256");
  strangerKeys = await generateKeyPair("RS256");
  const jwk = {
    ...(await exportJWK(keys.publicKey)),
    kid: "test-key",
    alg: "RS256",
  };

  issuerServer = createServer((req, res) => {
    if (req.url === "/.well-known/openid-configuration") {
      hits.discovery += 1;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ issuer, jwks_uri: `${issuer}/jwks` }));
      return;
    }
    if (req.url === "/jwks") {
      hits.jwks += 1;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ keys: [jwk] }));
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  issuerServer.listen(0, "127.0.0.1");
  await once(issuerServer, "listening");
  const address = issuerServer.address();
  if (address === null || typeof address === "string") {
    throw new Error("issuer server did not bind a port");
  }
  issuer = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  issuerServer.close();
  await once(issuerServer, "close");
});

interface TokenOptions {
  sub?: string | undefined;
  audience?: string;
  expiresIn?: string;
  email?: string;
  name?: string;
  signWith?: "issuer" | "stranger";
  issuerClaim?: string;
}

async function mintToken(options: TokenOptions = {}): Promise<string> {
  const jwt = new SignJWT({
    ...(options.email !== undefined ? { email: options.email } : {}),
    ...(options.name !== undefined ? { name: options.name } : {}),
  })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(options.issuerClaim ?? issuer)
    .setAudience(options.audience ?? AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(options.expiresIn ?? "5m");
  if (options.sub !== undefined) {
    jwt.setSubject(options.sub);
  }
  const key =
    options.signWith === "stranger" ? strangerKeys.privateKey : keys.privateKey;
  return jwt.sign(key);
}

/** The verifier over an EMPTY account store: every subject is a miss, so the pre-entry arms read exactly as before. */
function verifier() {
  return newOidcIdentityVerifier({
    issuer,
    audience: AUDIENCE,
    accounts: fakeIdentityAccountStore(),
    discovery: newIssuerDiscovery(),
  });
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error("expected rejection");
    },
    (error: unknown) => error,
  );
}

describe("claim-or-pass", () => {
  it("passes (null) on non-JWT shapes — the apikey lane stays reachable", async () => {
    expect(await verifier().verify("stk_notajwt")).toBeNull();
    expect(await verifier().verify("two.segments")).toBeNull();
    expect(await verifier().verify("a..c")).toBeNull();
  });
});

describe("identity mapping", () => {
  it("maps sub/iss and the email/name claims (the DD-007 Q5 fields)", async () => {
    const token = await mintToken({
      sub: "auth0|user123",
      email: "person@example.com",
      name: "Real Person",
    });
    expect(await verifier().verify(token)).toEqual({
      identityId: "auth0|user123",
      callerClass: "user",
      issuer,
      rawToken: token,
      email: "person@example.com",
      displayName: "Real Person",
    });
  });

  it("omits the display fields when the claims are absent", async () => {
    const token = await mintToken({ sub: "auth0|min" });
    const identity = await verifier().verify(token);
    expect(identity?.email).toBeUndefined();
    expect(identity?.displayName).toBeUndefined();
  });

  it("a token without sub is invalid — no principal, no identity", async () => {
    const token = await mintToken({});
    const error = await rejectionOf(verifier().verify(token));
    expect(ConnectError.from(error).rawMessage).toBe(INVALID_TOKEN_MESSAGE);
  });
});

describe("the byte-pinned classifyAuthError arms", () => {
  it("expired → 'token has expired'", async () => {
    const token = await mintToken({ sub: "s", expiresIn: "-5m" });
    const error = await rejectionOf(verifier().verify(token));
    expect(ConnectError.from(error).code).toBe(Code.Unauthenticated);
    expect(ConnectError.from(error).rawMessage).toBe(TOKEN_EXPIRED_MESSAGE);
  });

  it("audience mismatch → the audience copy", async () => {
    const token = await mintToken({ sub: "s", audience: "https://other.api/" });
    const error = await rejectionOf(verifier().verify(token));
    expect(ConnectError.from(error).rawMessage).toBe(TOKEN_AUDIENCE_MESSAGE);
  });

  it("a stranger's signature → the signature copy", async () => {
    const token = await mintToken({ sub: "s", signWith: "stranger" });
    const error = await rejectionOf(verifier().verify(token));
    expect(ConnectError.from(error).rawMessage).toBe(TOKEN_SIGNATURE_MESSAGE);
  });

  it("issuer-claim mismatch → 'invalid token' (the fallback arm)", async () => {
    const token = await mintToken({
      sub: "s",
      issuerClaim: "https://evil.test",
    });
    const error = await rejectionOf(verifier().verify(token));
    expect(ConnectError.from(error).rawMessage).toBe(INVALID_TOKEN_MESSAGE);
  });

  it("a garbage three-segment token → 'invalid token'", async () => {
    const error = await rejectionOf(verifier().verify("aaa.bbb.ccc"));
    expect(ConnectError.from(error).code).toBe(Code.Unauthenticated);
    expect(ConnectError.from(error).rawMessage).toBe(INVALID_TOKEN_MESSAGE);
  });
});

describe("subject → account resolution (20260911.11 Q-IA-2, A1)", () => {
  function seeded(sub: string, email: string) {
    const accounts = fakeIdentityAccountStore();
    accounts.rows.set(
      accountIdFor(sub),
      create(IdentityAccountSchema, {
        metadata: { id: accountIdFor(sub), name: email },
        spec: {
          idpId: sub,
          email,
          provisioningMode: IdentityAccountProvisioningMode.direct,
        },
      }),
    );
    return accounts;
  }

  it("a subject with an account resolves to the ACCOUNT id; the claims still flow", async () => {
    const accounts = seeded("auth0|known", "known@example.com");
    const token = await mintToken({
      sub: "auth0|known",
      email: "known@example.com",
      name: "Known",
    });
    const identity = await newOidcIdentityVerifier({
      issuer,
      audience: AUDIENCE,
      accounts,
      discovery: newIssuerDiscovery(),
    }).verify(token);
    expect(identity).toEqual({
      identityId: accountIdFor("auth0|known"),
      callerClass: "user",
      issuer,
      rawToken: token,
      email: "known@example.com",
      displayName: "Known",
    });
  });

  it("a subject without an account is admitted idp-shaped — identityId is the sub", async () => {
    const accounts = seeded("auth0|someone-else", "other@example.com");
    const token = await mintToken({ sub: "auth0|unknown" });
    const identity = await newOidcIdentityVerifier({
      issuer,
      audience: AUDIENCE,
      accounts,
      discovery: newIssuerDiscovery(),
    }).verify(token);
    expect(identity?.identityId).toBe("auth0|unknown");
  });

  it("resolution is one primary-key read per request, no cache — a row created after the first request is seen on the next", async () => {
    const accounts = fakeIdentityAccountStore();
    const verifierWithStore = newOidcIdentityVerifier({
      issuer,
      audience: AUDIENCE,
      accounts,
      discovery: newIssuerDiscovery(),
    });
    const token = await mintToken({ sub: "auth0|late" });
    expect((await verifierWithStore.verify(token))?.identityId).toBe(
      "auth0|late",
    );

    accounts.rows.set(
      accountIdFor("auth0|late"),
      create(IdentityAccountSchema, {
        metadata: { id: accountIdFor("auth0|late"), name: "late" },
        spec: {
          idpId: "auth0|late",
          provisioningMode: IdentityAccountProvisioningMode.direct,
        },
      }),
    );
    expect((await verifierWithStore.verify(token))?.identityId).toBe(
      accountIdFor("auth0|late"),
    );
  });

  it("a store fault during resolution is an infrastructure fault (plain error), never a credential rejection", async () => {
    const accounts = fakeIdentityAccountStore();
    const broken = {
      ...accounts,
      findDirectByIdpId: () => Promise.reject(new Error("store is on fire")),
    };
    const token = await mintToken({ sub: "auth0|anyone" });
    const error = await rejectionOf(
      newOidcIdentityVerifier({
        issuer,
        audience: AUDIENCE,
        accounts: broken,
        discovery: newIssuerDiscovery(),
      }).verify(token),
    );
    expect(error).not.toBeInstanceOf(ConnectError);
    expect(String(error)).toContain("store is on fire");
  });
});

describe("discovery and keys are fetched once per verifier (A8; the shared oidc-discovery module)", () => {
  it("N sequential verifies fetch the well-known document once and the JWKS once", async () => {
    const one = verifier();
    const before = { ...hits };
    for (const sub of ["auth0|a", "auth0|b", "auth0|c"]) {
      expect((await one.verify(await mintToken({ sub })))?.identityId).toBe(
        sub,
      );
    }
    expect(hits.discovery - before.discovery).toBe(1);
    expect(hits.jwks - before.jwks).toBe(1);
  });

  it("claim-or-pass precedes discovery: a non-JWT token passes with no network, even when the issuer is unreachable", async () => {
    const dead = newOidcIdentityVerifier({
      issuer: "http://127.0.0.1:1",
      audience: AUDIENCE,
      accounts: fakeIdentityAccountStore(),
      discovery: newIssuerDiscovery(),
    });
    expect(await dead.verify("stk_notajwt")).toBeNull();
  });
});

describe("infrastructure faults are never credential rejections", () => {
  it("an unreachable issuer throws a PLAIN error (chassis maps INTERNAL)", async () => {
    const dead = newOidcIdentityVerifier({
      // Port 1 is deterministically closed.
      issuer: "http://127.0.0.1:1",
      audience: AUDIENCE,
      accounts: fakeIdentityAccountStore(),
      discovery: newIssuerDiscovery(),
    });
    const error = await rejectionOf(dead.verify(await mintToken({ sub: "s" })));
    expect(error).not.toBeInstanceOf(ConnectError);
  });

  it("a discovery document with the wrong issuer throws a PLAIN error", async () => {
    const misconfigured = newOidcIdentityVerifier({
      // Points at the real test issuer but claims to expect a different
      // one — the discovery-document identity check must refuse.
      issuer: `${issuer}/`,
      audience: AUDIENCE,
      accounts: fakeIdentityAccountStore(),
      discovery: newIssuerDiscovery(),
    });
    const error = await rejectionOf(
      misconfigured.verify(await mintToken({ sub: "s" })),
    );
    expect(error).not.toBeInstanceOf(ConnectError);
    expect(String(error)).toContain("does not match configured issuer");
  });
});
