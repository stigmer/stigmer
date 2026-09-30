// ---------------------------------------------------------------------------
// pkce — the desktop's Authorization Code + PKCE exchange with Auth0
//
// The pure half runs on real WebCrypto: the verifier is URL-safe and of the
// length asked, and the challenge is the S256 transform, checked against the
// worked example in RFC 7636 appendix B, so the test proves the algorithm
// and not a mock of it. The authorize URL carries every parameter the flow
// depends on (the challenge and its method, the state, the redirect), and a
// connection hint only when one is given.
//
// The network half goes through Tauri's HTTP plugin (Auth0's native client
// sends no CORS headers). Its `fetch` streams over IPC channels, so it is
// stubbed at its module here: the tests pin the requests sent and every
// failure a person could meet.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const http = vi.hoisted(() => ({
  fetch: vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(),
}));
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: http.fetch }));

import {
  AUTH0_AUDIENCE,
  AUTH0_CLIENT_ID,
  AUTH0_DOMAIN,
  buildAuthorizeUrl,
  exchangeCode,
  generateChallenge,
  generateVerifier,
  refreshAccessToken,
  revokeRefreshToken,
} from "../pkce";

const NOW = 1_800_000_000_000;

function tokenAnswer(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** The target, method and form body of the one request the call sent. */
function sentRequest(): {
  url: string;
  method: string | undefined;
  form: Record<string, string>;
} {
  expect(http.fetch).toHaveBeenCalledTimes(1);
  const [url, init] = http.fetch.mock.calls[0] ?? [];
  return {
    url: String(url),
    method: init?.method,
    form: Object.fromEntries(new URLSearchParams(String(init?.body))),
  };
}

describe("generateVerifier", () => {
  it("is URL-safe base64 with no padding, from the number of random bytes asked", () => {
    const verifier = generateVerifier();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    // 64 random bytes encode to 86 base64url characters: inside RFC 7636's 43-128.
    expect(verifier).toHaveLength(86);
    expect(generateVerifier(32)).toHaveLength(43);
  });

  it("is different every time", () => {
    const seen = new Set(
      Array.from({ length: 50 }, () => generateVerifier(32)),
    );
    expect(seen.size).toBe(50);
  });
});

describe("generateChallenge", () => {
  it("is the S256 transform of RFC 7636 appendix B's example verifier", async () => {
    await expect(
      generateChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
    ).resolves.toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });
});

describe("buildAuthorizeUrl", () => {
  it("carries the challenge, its method, the state and the redirect to Auth0's authorize endpoint", () => {
    const url = new URL(
      buildAuthorizeUrl({
        codeChallenge: "challenge-123",
        state: "state-abc",
        redirectUri: "stigmer://auth/callback",
      }),
    );

    expect(`${url.origin}${url.pathname}`).toBe(`${AUTH0_DOMAIN}/authorize`);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: "code",
      client_id: AUTH0_CLIENT_ID,
      redirect_uri: "stigmer://auth/callback",
      scope: "openid profile email offline_access",
      audience: AUTH0_AUDIENCE,
      state: "state-abc",
      code_challenge: "challenge-123",
      code_challenge_method: "S256",
      prompt: "login",
    });
  });

  it("adds a connection hint only when one is given", () => {
    const withHint = new URL(
      buildAuthorizeUrl({
        codeChallenge: "c",
        state: "s",
        redirectUri: "stigmer://auth/callback",
        connection: "google-oauth2",
      }),
    );
    expect(withHint.searchParams.get("connection")).toBe("google-oauth2");
  });
});

describe("the token requests", () => {
  beforeEach(() => {
    http.fetch.mockReset();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("exchanges the code with its verifier and redirect, and dates the expiry from now", async () => {
    http.fetch.mockResolvedValue(
      tokenAnswer({
        access_token: "access",
        refresh_token: "refresh",
        id_token: "id",
        expires_in: 3600,
      }),
    );

    await expect(
      exchangeCode({
        code: "code-1",
        codeVerifier: "verifier-1",
        redirectUri: "stigmer://auth/callback",
      }),
    ).resolves.toEqual({
      accessToken: "access",
      refreshToken: "refresh",
      idToken: "id",
      expiresAt: NOW + 3_600_000,
    });

    const request = sentRequest();
    expect(request.url).toBe(`${AUTH0_DOMAIN}/oauth/token`);
    expect(request.method).toBe("POST");
    expect(request.form).toEqual({
      grant_type: "authorization_code",
      client_id: AUTH0_CLIENT_ID,
      code: "code-1",
      redirect_uri: "stigmer://auth/callback",
      code_verifier: "verifier-1",
    });
  });

  it("leaves the expiry unset when Auth0 gives none", async () => {
    http.fetch.mockResolvedValue(tokenAnswer({ access_token: "access" }));
    const tokens = await exchangeCode({
      code: "c",
      codeVerifier: "v",
      redirectUri: "r",
    });
    expect(tokens.expiresAt).toBeUndefined();
  });

  it("names Auth0's refusal of a code, with its status and body", async () => {
    http.fetch.mockResolvedValue(
      new Response('{"error":"invalid_grant"}', { status: 403 }),
    );
    await expect(
      exchangeCode({ code: "used", codeVerifier: "v", redirectUri: "r" }),
    ).rejects.toThrow('Token exchange failed: 403 {"error":"invalid_grant"}');
  });

  it.each([
    [
      "exchange",
      () => exchangeCode({ code: "c", codeVerifier: "v", redirectUri: "r" }),
      "Token exchange failed: unable to reach Auth0 (Load failed)",
    ],
    [
      "refresh",
      () => refreshAccessToken("refresh"),
      "Token refresh failed: unable to reach Auth0 (Load failed)",
    ],
    [
      "revocation",
      () => revokeRefreshToken("refresh"),
      "Token revocation failed: unable to reach Auth0 (Load failed)",
    ],
  ])(
    "turns a network failure during %s into a message a person can act on",
    async (_label, call, message) => {
      http.fetch.mockRejectedValue(new TypeError("Load failed"));
      await expect(call()).rejects.toThrow(message);
    },
  );

  it("refreshes with the refresh token, keeping it when Auth0 does not rotate it", async () => {
    http.fetch.mockResolvedValue(
      tokenAnswer({ access_token: "access-2", expires_in: 60 }),
    );

    await expect(refreshAccessToken("refresh-1")).resolves.toEqual({
      accessToken: "access-2",
      refreshToken: "refresh-1",
      expiresAt: NOW + 60_000,
      idToken: undefined,
    });
    expect(sentRequest().form).toEqual({
      grant_type: "refresh_token",
      client_id: AUTH0_CLIENT_ID,
      refresh_token: "refresh-1",
    });
  });

  it("takes the rotated refresh token when Auth0 sends one", async () => {
    http.fetch.mockResolvedValue(
      tokenAnswer({ access_token: "a", refresh_token: "refresh-2" }),
    );
    const tokens = await refreshAccessToken("refresh-1");
    expect(tokens.refreshToken).toBe("refresh-2");
  });

  it("names Auth0's refusal of a refresh", async () => {
    http.fetch.mockResolvedValue(new Response("revoked", { status: 401 }));
    await expect(refreshAccessToken("refresh-1")).rejects.toThrow(
      "Token refresh failed: 401 revoked",
    );
  });

  it("revokes the refresh token at Auth0's revoke endpoint", async () => {
    http.fetch.mockResolvedValue(new Response(null, { status: 200 }));
    await revokeRefreshToken("refresh-1");

    const request = sentRequest();
    expect(request.url).toBe(`${AUTH0_DOMAIN}/oauth/revoke`);
    expect(request.form).toEqual({
      client_id: AUTH0_CLIENT_ID,
      token: "refresh-1",
    });
  });
});
