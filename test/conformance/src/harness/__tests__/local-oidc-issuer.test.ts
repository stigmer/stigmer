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
//
// 20260913.02 (sp.console-login, Q-CL-7): the issuer also drives a BROWSER
// through the Authorization Code + PKCE flow the console runs — /authorize
// auto-consents as its configured person and redirects with a single-use
// code; /token verifies the PKCE verifier against the stored challenge and
// mints an access token (for the server), an id_token (for oidc-client-ts,
// `aud` = the client, `nonce` echoed) and, for `offline_access`, a refresh
// token; /end-session exists only when asked for, so both of the console's
// sign-out arms are drivable; every browser-facing document answers CORS.
import {
  createHash,
  createPublicKey,
  createVerify,
  randomBytes,
} from "node:crypto";

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

const CLIENT_ID = "stigmer-console";
const REDIRECT_URI = "http://localhost:3000/auth/callback";

function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

function decodeClaims(token: string): Record<string, unknown> {
  const payload = token.split(".")[1] ?? "";
  return JSON.parse(
    Buffer.from(payload, "base64url").toString("utf8"),
  ) as Record<string, unknown>;
}

/** Drive /authorize as a browser would and return the code it was handed. */
async function authorize(
  target: LocalOidcIssuer,
  input: { challenge: string; scope?: string; state?: string; nonce?: string },
): Promise<{ code: string; location: URL }> {
  const url = new URL(`${target.issuer}/authorize`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", CLIENT_ID);
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("scope", input.scope ?? "openid email profile");
  url.searchParams.set("state", input.state ?? "st-1");
  url.searchParams.set("nonce", input.nonce ?? "n-1");
  url.searchParams.set("code_challenge", input.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  const response = await fetch(url, { redirect: "manual" });
  expect(response.status).toBe(302);
  const location = new URL(response.headers.get("location") ?? "");
  const code = location.searchParams.get("code");
  expect(code, "the redirect carries a code").toBeTruthy();
  return { code: code ?? "", location };
}

async function exchange(
  target: LocalOidcIssuer,
  input: { code: string; verifier: string },
): Promise<Response> {
  return fetch(`${target.issuer}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      code_verifier: input.verifier,
    }),
  });
}

describe("local OIDC issuer: the browser's code flow (20260913.02)", () => {
  it("publishes the code-flow endpoints and PKCE S256, and no end_session_endpoint unless asked", async () => {
    const document = (await (
      await fetch(`${issuer.issuer}/.well-known/openid-configuration`)
    ).json()) as Record<string, unknown>;
    expect(document.authorization_endpoint).toBe(`${issuer.issuer}/authorize`);
    expect(document.token_endpoint).toBe(`${issuer.issuer}/token`);
    expect(document.code_challenge_methods_supported).toEqual(["S256"]);
    expect(document.end_session_endpoint).toBeUndefined();
  });

  it("/authorize auto-consents and redirects to the client with a code and the state", async () => {
    const { challenge } = pkcePair();
    const { location } = await authorize(issuer, { challenge, state: "st-42" });
    expect(`${location.origin}${location.pathname}`).toBe(REDIRECT_URI);
    expect(location.searchParams.get("state")).toBe("st-42");
  });

  it("/authorize refuses a request without PKCE — the console never sends one", async () => {
    const url = new URL(`${issuer.issuer}/authorize`);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", CLIENT_ID);
    url.searchParams.set("redirect_uri", REDIRECT_URI);
    url.searchParams.set("scope", "openid");
    url.searchParams.set("state", "st");
    const response = await fetch(url, { redirect: "manual" });
    expect(response.status).toBe(400);
  });

  it("/token exchanges the code for an access token the server verifies, an id_token for the client, and echoes the nonce", async () => {
    const { verifier, challenge } = pkcePair();
    const { code } = await authorize(issuer, { challenge, nonce: "n-77" });
    const response = await exchange(issuer, { code, verifier });
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.token_type).toBe("Bearer");
    expect(typeof body.expires_in).toBe("number");

    const access = decodeClaims(String(body.access_token));
    expect(access.iss).toBe(issuer.issuer);
    expect(access.aud).toBe(issuer.audience);
    expect(access.sub).toBe(issuer.person.sub);
    expect(access.email).toBe(issuer.person.email);

    const id = decodeClaims(String(body.id_token));
    expect(id.iss).toBe(issuer.issuer);
    expect(id.aud).toBe(CLIENT_ID);
    expect(id.sub).toBe(issuer.person.sub);
    expect(id.nonce).toBe("n-77");
    expect(
      body.refresh_token,
      "no offline_access, no refresh token",
    ).toBeUndefined();
  });

  it("/token mints a refresh token for offline_access and honours the refresh grant", async () => {
    const { verifier, challenge } = pkcePair();
    const { code } = await authorize(issuer, {
      challenge,
      scope: "openid email profile offline_access",
    });
    const first = (await (
      await exchange(issuer, { code, verifier })
    ).json()) as Record<string, unknown>;
    expect(typeof first.refresh_token).toBe("string");

    const refreshed = await fetch(`${issuer.issuer}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: String(first.refresh_token),
        client_id: CLIENT_ID,
      }),
    });
    expect(refreshed.status).toBe(200);
    const second = (await refreshed.json()) as Record<string, unknown>;
    expect(decodeClaims(String(second.access_token)).sub).toBe(
      issuer.person.sub,
    );
  });

  it("/token refuses a wrong verifier and a reused code with invalid_grant", async () => {
    const { verifier, challenge } = pkcePair();
    const { code } = await authorize(issuer, { challenge });

    const wrong = await exchange(issuer, {
      code,
      verifier: "not-the-verifier",
    });
    expect(wrong.status).toBe(400);
    expect(((await wrong.json()) as { error: string }).error).toBe(
      "invalid_grant",
    );

    // The wrong attempt did not burn the code; the right one redeems it once.
    expect((await exchange(issuer, { code, verifier })).status).toBe(200);
    const reused = await exchange(issuer, { code, verifier });
    expect(reused.status).toBe(400);
    expect(((await reused.json()) as { error: string }).error).toBe(
      "invalid_grant",
    );
  });

  it("answers CORS for the browser: a preflight on /token and the header on every document", async () => {
    const preflight = await fetch(`${issuer.issuer}/token`, {
      method: "OPTIONS",
      headers: {
        origin: "http://localhost:3000",
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type",
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("*");
    const discovery = await fetch(
      `${issuer.issuer}/.well-known/openid-configuration`,
      { headers: { origin: "http://localhost:3000" } },
    );
    expect(discovery.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("with endSession: publishes /end-session, which sends the browser to the post-logout URI with its state", async () => {
    const withLogout = await startLocalOidcIssuer({ endSession: true });
    try {
      const document = (await (
        await fetch(`${withLogout.issuer}/.well-known/openid-configuration`)
      ).json()) as Record<string, unknown>;
      expect(document.end_session_endpoint).toBe(
        `${withLogout.issuer}/end-session`,
      );

      const url = new URL(`${withLogout.issuer}/end-session`);
      url.searchParams.set(
        "post_logout_redirect_uri",
        "http://localhost:3000/login",
      );
      url.searchParams.set("state", "bye");
      const response = await fetch(url, { redirect: "manual" });
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe(
        "http://localhost:3000/login?state=bye",
      );
    } finally {
      await withLogout.close();
    }
  });

  it("binds the requested port when given one", async () => {
    const probe = await startLocalOidcIssuer();
    const port = Number(new URL(probe.issuer).port);
    await probe.close();
    const pinned = await startLocalOidcIssuer({ port });
    try {
      expect(pinned.issuer).toBe(`http://127.0.0.1:${port}`);
    } finally {
      await pinned.close();
    }
  });
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
