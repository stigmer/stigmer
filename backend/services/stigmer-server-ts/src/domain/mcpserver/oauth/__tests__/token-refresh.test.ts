/**
 * OAuth token/refresh slice tests — ports the refresh-relevant halves of
 * pkg/domain/mcpserver/oauth/token_test.go (the Slack authed_user
 * "which token wins" resolution + the #410 client-secret placement pins,
 * RefreshToken arm; ExchangeCode arrives with #19) and pins
 * refreshTokenIfExpired's expiry-buffer / rotation contract that Go
 * asserts through the connect pre-flight. The token endpoint is a fetch
 * stub — deterministic, no sockets.
 */
import { describe, expect, it } from "vitest";

import { createLogger } from "../../../../boot/logger.js";
import type { OAuthGrant } from "../../../../store/interface.js";

import {
  REFRESH_EXPIRY_BUFFER_SECONDS,
  refreshTokenIfExpired,
} from "../refresh.js";
import {
  TOKEN_AUTH_METHOD_BASIC,
  TOKEN_AUTH_METHOD_POST,
  refreshToken,
} from "../token.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

/** A fetch stub answering the given JSON body with HTTP 200. */
function tokenServer(body: string): typeof fetch {
  return async () =>
    new Response(body, {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
}

/** A fetch stub that records the credential channels of each request. */
interface CapturedTokenRequest {
  basicUser: string;
  basicPass: string;
  hasBasic: boolean;
  formSecret: string;
  formClient: string;
}

function captureTokenServer(captured: CapturedTokenRequest): typeof fetch {
  return async (_url, init) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const auth = headers["Authorization"] ?? "";
    if (auth.startsWith("Basic ")) {
      captured.hasBasic = true;
      const decoded = Buffer.from(auth.slice(6), "base64").toString();
      const colon = decoded.indexOf(":");
      captured.basicUser = decoded.slice(0, colon);
      captured.basicPass = decoded.slice(colon + 1);
    }
    const form = new URLSearchParams(String(init?.body ?? ""));
    captured.formSecret = form.get("client_secret") ?? "";
    captured.formClient = form.get("client_id") ?? "";
    return new Response('{"access_token": "at-123", "token_type": "bearer"}', {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
}

// The Slack V2 authed_user resolution: which token wins (Go
// TestResolveFromAuthedUser_*), driven through refreshToken since the TS
// port inlines the resolution in the response parse.
describe("authed_user token resolution", () => {
  async function refreshAgainst(body: string) {
    return refreshToken(
      "https://vendor.example/token",
      "rt-1",
      "client-1",
      "",
      "",
      tokenServer(body),
    );
  }

  it("both tokens present: the nested user token wins", async () => {
    const resp = await refreshAgainst(`{
      "access_token": "xoxb-bot-token",
      "token_type": "bearer",
      "scope": "",
      "authed_user": {
        "access_token": "xoxp-user-token",
        "token_type": "bearer",
        "scope": "channels:read,chat:write"
      }
    }`);
    expect(resp.accessToken).toBe("xoxp-user-token");
    expect(resp.tokenType).toBe("bearer");
    expect(resp.scope).toBe("channels:read,chat:write");
  });

  it("standard OAuth (no authed_user): top-level token untouched", async () => {
    const resp = await refreshAgainst(`{
      "access_token": "github-pat-123",
      "token_type": "bearer",
      "scope": "repo,user"
    }`);
    expect(resp.accessToken).toBe("github-pat-123");
    expect(resp.scope).toBe("repo,user");
  });

  it("only authed_user carries a token", async () => {
    const resp = await refreshAgainst(`{
      "access_token": "",
      "authed_user": {
        "access_token": "xoxp-user-only",
        "token_type": "bearer",
        "scope": "search:read"
      }
    }`);
    expect(resp.accessToken).toBe("xoxp-user-only");
    expect(resp.tokenType).toBe("bearer");
    expect(resp.scope).toBe("search:read");
  });

  it("blank authed_user token does not overwrite; non-blank fields still apply", async () => {
    const resp = await refreshAgainst(`{
      "access_token": "xoxb-bot-token",
      "token_type": "bearer",
      "authed_user": {
        "access_token": "",
        "scope": "channels:read"
      }
    }`);
    expect(resp.accessToken).toBe("xoxb-bot-token");
    expect(resp.scope).toBe("channels:read");
  });

  it("authed_user overwrites bot scope and token type", async () => {
    const resp = await refreshAgainst(`{
      "access_token": "xoxb-bot-token",
      "token_type": "bot",
      "scope": "bot:basic",
      "authed_user": {
        "access_token": "xoxp-user-token",
        "token_type": "user",
        "scope": "channels:read"
      }
    }`);
    expect(resp.accessToken).toBe("xoxp-user-token");
    expect(resp.tokenType).toBe("user");
    expect(resp.scope).toBe("channels:read");
  });

  it("missing access_token everywhere throws", async () => {
    await expect(refreshAgainst(`{"token_type": "bearer"}`)).rejects.toThrow(
      "missing access_token",
    );
  });
});

// Client-secret placement (stigmer/stigmer#410): which channel carries
// the secret per token_endpoint_auth_method, and never both (RFC 6749
// §2.3). Go pins ExchangeCode and RefreshToken; only RefreshToken exists
// in this slice.
describe("refreshToken secret placement", () => {
  const cases = [
    {
      name: "default empty method uses Basic (historical behavior)",
      method: "",
      secret: "s3cret",
      wantBasic: true,
      wantInForm: false,
    },
    {
      name: "explicit client_secret_basic uses Basic",
      method: TOKEN_AUTH_METHOD_BASIC,
      secret: "s3cret",
      wantBasic: true,
      wantInForm: false,
    },
    {
      name: "client_secret_post puts the secret in the form body only",
      method: TOKEN_AUTH_METHOD_POST,
      secret: "s3cret",
      wantBasic: false,
      wantInForm: true,
    },
    {
      name: "public client (no secret) authenticates with neither channel",
      method: "",
      secret: "",
      wantBasic: false,
      wantInForm: false,
    },
    {
      name: "post method without a secret is a no-op (public client)",
      method: TOKEN_AUTH_METHOD_POST,
      secret: "",
      wantBasic: false,
      wantInForm: false,
    },
  ];

  for (const tt of cases) {
    it(tt.name, async () => {
      const captured: CapturedTokenRequest = {
        basicUser: "",
        basicPass: "",
        hasBasic: false,
        formSecret: "",
        formClient: "",
      };
      const resp = await refreshToken(
        "https://vendor.example/token",
        "rt-1",
        "client-1",
        tt.secret,
        tt.method,
        captureTokenServer(captured),
      );
      expect(resp.accessToken).toBe("at-123");

      expect(captured.hasBasic).toBe(tt.wantBasic);
      if (tt.wantBasic) {
        expect(captured.basicUser).toBe("client-1");
        expect(captured.basicPass).toBe(tt.secret);
      }
      expect(captured.formSecret).toBe(tt.wantInForm ? tt.secret : "");
      // client_id always rides the form body regardless of method.
      expect(captured.formClient).toBe("client-1");
      // The invariant behind the per-mode expectations: the secret never
      // travels both channels in one request.
      expect(captured.hasBasic && captured.formSecret !== "").toBe(false);
    });
  }
});

// refreshTokenIfExpired's expiry-buffer / rotation contract.
describe("refreshTokenIfExpired", () => {
  function grant(accessTokenExpiresAt: number): OAuthGrant {
    return {
      identityAccountId: "",
      resourceId: "mcps_1",
      resourceKind: "mcp_server",
      orgId: "acme",
      accessTokenExpiresAt,
      clientId: "client-1",
      authMethod: "mcp_oauth",
      tokenEndpoint: "https://vendor.example/token",
      accessTokenEnvVar: "VENDOR_TOKEN",
      refreshTokenEnvVar: "VENDOR_REFRESH_TOKEN",
      environmentId: "env_managed",
      createdAt: 0,
      updatedAt: 0,
    };
  }

  const nowSeconds = () => Math.floor(Date.now() / 1000);

  it("no expiry (0) never refreshes — long-lived Notion/Slack-style tokens", async () => {
    const result = await refreshTokenIfExpired(
      grant(0),
      "rt-1",
      "",
      "",
      silentLogger,
      () => {
        throw new Error("token endpoint must not be reached");
      },
    );
    expect(result.refreshed).toBe(false);
  });

  it("not yet within the 60s buffer: skip", async () => {
    const result = await refreshTokenIfExpired(
      grant(nowSeconds() + REFRESH_EXPIRY_BUFFER_SECONDS + 3600),
      "rt-1",
      "",
      "",
      silentLogger,
      () => {
        throw new Error("token endpoint must not be reached");
      },
    );
    expect(result.refreshed).toBe(false);
  });

  it("expired with no refresh token: throws the re-auth error", async () => {
    await expect(
      refreshTokenIfExpired(grant(nowSeconds() - 10), "", "", "", silentLogger),
    ).rejects.toThrow(
      "access token for resource 'mcps_1' has expired and no refresh token is available. " +
        "Please re-authenticate via OAuth Connect",
    );
  });

  it("expired: refreshes, rotates the refresh token, computes newExpiresAt", async () => {
    const before = nowSeconds();
    const result = await refreshTokenIfExpired(
      grant(before - 10),
      "rt-old",
      "",
      "",
      silentLogger,
      tokenServer(
        `{"access_token":"at-new","refresh_token":"rt-new","expires_in":3600}`,
      ),
    );
    expect(result.refreshed).toBe(true);
    expect(result.newAccessToken).toBe("at-new");
    expect(result.newRefreshToken).toBe("rt-new");
    expect(result.newExpiresAt).toBeGreaterThanOrEqual(before + 3600);
    expect(result.newExpiresAt).toBeLessThanOrEqual(nowSeconds() + 3600);
  });

  it("expired: vendor omits refresh_token — the current one carries forward", async () => {
    const result = await refreshTokenIfExpired(
      grant(nowSeconds() - 10),
      "rt-keep",
      "",
      "",
      silentLogger,
      tokenServer(`{"access_token":"at-new"}`),
    );
    expect(result.refreshed).toBe(true);
    expect(result.newRefreshToken).toBe("rt-keep");
    // No expires_in: the new token is treated as non-expiring.
    expect(result.newExpiresAt).toBe(0);
  });

  it("refresh failure wraps with the re-auth guidance", async () => {
    await expect(
      refreshTokenIfExpired(
        grant(nowSeconds() - 10),
        "rt-1",
        "",
        "",
        silentLogger,
        async () => new Response("nope", { status: 401 }),
      ),
    ).rejects.toThrow(
      /token refresh failed for resource 'mcps_1'.*Please re-authenticate via OAuth Connect/,
    );
  });
});
