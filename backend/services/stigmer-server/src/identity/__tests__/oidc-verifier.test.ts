/**
 * Pins the OIDC identity verifier against a hermetic local issuer (an
 * in-process HTTP server serving real discovery + JWKS documents, tokens
 * signed with a real RS256 keypair — no network, no mocks of jose):
 * claim-or-pass (non-JWT shapes pass, JWT shapes are claimed), the
 * identity mapping (sub/iss/email/name), the four byte-pinned Java
 * classifyAuthError arms, and the infrastructure-fault posture (discovery
 * failures are plain errors for the chassis's INTERNAL arm — never
 * credential rejections).
 */
import { createServer } from "node:http";
import type { Server } from "node:http";
import { once } from "node:events";

import { Code, ConnectError } from "@connectrpc/connect";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import type { GenerateKeyPairResult } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

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

beforeAll(async () => {
  keys = await generateKeyPair("RS256");
  strangerKeys = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(keys.publicKey)), kid: "test-key", alg: "RS256" };

  issuerServer = createServer((req, res) => {
    if (req.url === "/.well-known/openid-configuration") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ issuer, jwks_uri: `${issuer}/jwks` }));
      return;
    }
    if (req.url === "/jwks") {
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

function verifier() {
  return newOidcIdentityVerifier({ issuer, audience: AUDIENCE });
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
    const token = await mintToken({ sub: "s", issuerClaim: "https://evil.test" });
    const error = await rejectionOf(verifier().verify(token));
    expect(ConnectError.from(error).rawMessage).toBe(INVALID_TOKEN_MESSAGE);
  });

  it("a garbage three-segment token → 'invalid token'", async () => {
    const error = await rejectionOf(verifier().verify("aaa.bbb.ccc"));
    expect(ConnectError.from(error).code).toBe(Code.Unauthenticated);
    expect(ConnectError.from(error).rawMessage).toBe(INVALID_TOKEN_MESSAGE);
  });
});

describe("infrastructure faults are never credential rejections", () => {
  it("an unreachable issuer throws a PLAIN error (chassis maps INTERNAL)", async () => {
    const dead = newOidcIdentityVerifier({
      // Port 1 is deterministically closed.
      issuer: "http://127.0.0.1:1",
      audience: AUDIENCE,
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
    });
    const error = await rejectionOf(
      misconfigured.verify(await mintToken({ sub: "s" })),
    );
    expect(error).not.toBeInstanceOf(ConnectError);
    expect(String(error)).toContain("does not match configured issuer");
  });
});
