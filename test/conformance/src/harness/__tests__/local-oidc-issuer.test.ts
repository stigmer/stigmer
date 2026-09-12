// Unit arms for the hermetic local OIDC issuer (harness/local-oidc-issuer.ts;
// 20260911.11 Q-IA-10) — lifted from the server's oidc-verifier unit test so
// one suite file can boot an OSS server in the OIDC posture against it.
// Domain: conformance harness.
//
// Pins the three documents a real issuer publishes and the server reads:
// discovery (issuer, jwks_uri, userinfo_endpoint), JWKS (a key the minted
// tokens verify against — proven with jose, not by inspection), and
// /userinfo (the bearer's own claims plus the fixed given_name/family_name
// the profile exposes, 401 without a bearer, 503 for a refused subject —
// the lever the UNAVAILABLE arm pulls). Signing rides node:crypto like the
// direct-login tenant's mint (harness/direct-login-tenant.ts) — the
// conformance package deliberately carries no JOSE dependency.
import { createPublicKey, createVerify } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  startLocalOidcIssuer,
  type LocalOidcIssuer,
} from "../local-oidc-issuer";

let issuer: LocalOidcIssuer;

beforeAll(async () => {
  issuer = await startLocalOidcIssuer();
});

afterAll(async () => {
  await issuer.close();
});

describe("local OIDC issuer", () => {
  it("publishes a discovery document naming itself, its JWKS and its userinfo endpoint", async () => {
    const response = await fetch(
      `${issuer.issuer}/.well-known/openid-configuration`,
    );
    expect(response.ok).toBe(true);
    const document = (await response.json()) as Record<string, unknown>;
    expect(document.issuer).toBe(issuer.issuer);
    expect(document.jwks_uri).toBe(`${issuer.issuer}/jwks`);
    expect(document.userinfo_endpoint).toBe(`${issuer.issuer}/userinfo`);
  });

  it("mints RS256 tokens that verify against its own JWKS and carry issuer, audience and claims", async () => {
    const token = await issuer.mint({
      sub: "auth0|unit",
      email: "unit@example.com",
    });
    const [header, payload, signature] = token.split(".");
    expect(header).toBeDefined();
    expect(payload).toBeDefined();
    expect(signature).toBeDefined();

    const jwks = (await (await fetch(`${issuer.issuer}/jwks`)).json()) as {
      keys: Array<Record<string, unknown> & { kid: string }>;
    };
    const decodedHeader = JSON.parse(
      Buffer.from(header ?? "", "base64url").toString("utf8"),
    ) as {
      alg: string;
      kid: string;
    };
    expect(decodedHeader.alg).toBe("RS256");
    const jwk = jwks.keys.find((key) => key.kid === decodedHeader.kid);
    expect(jwk, "the token's kid names a published key").toBeDefined();

    const verifier = createVerify("RSA-SHA256");
    verifier.update(`${header}.${payload}`);
    const publicKey = createPublicKey({
      key: jwk as Record<string, unknown>,
      format: "jwk",
    });
    expect(
      verifier.verify(publicKey, Buffer.from(signature ?? "", "base64url")),
    ).toBe(true);

    const claims = JSON.parse(
      Buffer.from(payload ?? "", "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    expect(claims.iss).toBe(issuer.issuer);
    expect(claims.aud).toBe(issuer.audience);
    expect(claims.sub).toBe("auth0|unit");
    expect(claims.email).toBe("unit@example.com");
    expect(typeof claims.exp).toBe("number");
  });

  it("answers /userinfo with the bearer's claims and the fixed profile names", async () => {
    const token = await issuer.mint({
      sub: "auth0|profile",
      email: "profile@example.com",
    });
    const response = await fetch(`${issuer.issuer}/userinfo`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.ok).toBe(true);
    const claims = (await response.json()) as Record<string, unknown>;
    expect(claims.sub).toBe("auth0|profile");
    expect(claims.email).toBe("profile@example.com");
    expect(claims.given_name).toBe(issuer.profile.givenName);
    expect(claims.family_name).toBe(issuer.profile.familyName);
  });

  it("refuses /userinfo without a bearer (401) and for a refused subject (503) until the lever is cleared", async () => {
    expect((await fetch(`${issuer.issuer}/userinfo`)).status).toBe(401);

    const token = await issuer.mint({
      sub: "auth0|refused",
      email: "refused@example.com",
    });
    issuer.refuseUserinfoFor("auth0|refused");
    expect(
      (
        await fetch(`${issuer.issuer}/userinfo`, {
          headers: { authorization: `Bearer ${token}` },
        })
      ).status,
    ).toBe(503);
    issuer.refuseUserinfoFor(undefined);
    expect(
      (
        await fetch(`${issuer.issuer}/userinfo`, {
          headers: { authorization: `Bearer ${token}` },
        })
      ).status,
    ).toBe(200);
  });

  it("answers 404 for anything else", async () => {
    expect((await fetch(`${issuer.issuer}/nowhere`)).status).toBe(404);
  });
});
