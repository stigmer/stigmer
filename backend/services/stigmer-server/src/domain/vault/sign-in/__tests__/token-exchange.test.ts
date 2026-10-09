/**
 * Pins the authorization-code exchange against Go oauth/token.go
 * (token_test.go): the grant parameter set, EXACTLY ONE secret channel
 * per request (RFC 6749 §2.3 — Basic default, form-body for
 * client_secret_post, neither for public clients), the Slack V2
 * authed_user promotion, the 256-byte error truncation, the
 * missing-access_token refusal, and a redirect never followed, the code
 * exchange's and the renewal's alike (the request carries the client
 * secret, the code verifier or the refresh token); `resource` sent on both
 * when given (RFC 8707) and never otherwise; and a refusal's OAuth error
 * code carried, GitHub's HTTP 200 refusal included. The rest of the
 * refresh half is pinned by token-refresh.test.ts.
 */
import { describe, expect, it } from "vitest";

import { TokenEndpointError, exchangeCode, refreshToken } from "../token.js";

interface CapturedRequest {
  body: URLSearchParams;
  authorization: string;
}

function capturingFetch(
  responseBody: unknown,
  captured: CapturedRequest[],
  status = 200,
): typeof fetch {
  return async (_url, init) => {
    captured.push({
      body: new URLSearchParams(String(init?.body)),
      authorization:
        (init?.headers as Record<string, string>)["Authorization"] ?? "",
    });
    return new Response(JSON.stringify(responseBody), { status });
  };
}

const TOKENS = { access_token: "at-1", token_type: "bearer", expires_in: 3600 };

describe("resource and refusals", () => {
  it("sends resource on the exchange and the renewal when given, and not otherwise", async () => {
    const captured: CapturedRequest[] = [];
    const fetchImpl = capturingFetch(TOKENS, captured);
    await exchangeCode("https://auth.example.com/token", "c", "http://cb", "v", "client-1", "", "", fetchImpl, "https://mcp.example.com/mcp");
    await refreshToken("https://auth.example.com/token", "rt", "client-1", "", "", fetchImpl, "https://mcp.example.com/mcp");
    await exchangeCode("https://auth.example.com/token", "c", "http://cb", "v", "client-1", "", "", fetchImpl);
    expect(captured.map((request) => request.body.get("resource"))).toEqual([
      "https://mcp.example.com/mcp",
      "https://mcp.example.com/mcp",
      null,
    ]);
  });

  it("carries the OAuth error code of a refusal, and of GitHub's HTTP 200 one", async () => {
    const refused = exchangeCode(
      "https://auth.example.com/token",
      "c",
      "http://cb",
      "v",
      "client-gone",
      "",
      "",
      capturingFetch({ error: "invalid_client" }, [], 401),
    );
    await expect(refused).rejects.toBeInstanceOf(TokenEndpointError);
    await expect(refused).rejects.toMatchObject({ oauthError: "invalid_client" });

    const github = exchangeCode(
      "https://github.com/login/oauth/access_token",
      "c",
      "http://cb",
      "v",
      "client-1",
      "secret",
      "client_secret_post",
      capturingFetch({ error: "bad_verification_code", error_description: "The code passed is incorrect or expired." }, []),
    );
    await expect(github).rejects.toMatchObject({
      oauthError: "bad_verification_code",
      message: expect.stringContaining("refused the request: bad_verification_code (The code passed is incorrect or expired.)"),
    });
  });
});

describe("exchangeCode", () => {
  it("sends the authorization_code grant with PKCE parameters", async () => {
    const captured: CapturedRequest[] = [];
    await exchangeCode(
      "https://auth.example.com/token",
      "code-1",
      "http://cb",
      "verifier-1",
      "client-1",
      "",
      "",
      capturingFetch(TOKENS, captured),
    );
    const body = captured[0]?.body;
    expect(body?.get("grant_type")).toBe("authorization_code");
    expect(body?.get("code")).toBe("code-1");
    expect(body?.get("redirect_uri")).toBe("http://cb");
    expect(body?.get("code_verifier")).toBe("verifier-1");
    expect(body?.get("client_id")).toBe("client-1");
  });

  it("public client (DCR): no Authorization header, no client_secret in the body", async () => {
    const captured: CapturedRequest[] = [];
    await exchangeCode(
      "https://auth.example.com/token",
      "c",
      "http://cb",
      "v",
      "client-1",
      "",
      "",
      capturingFetch(TOKENS, captured),
    );
    expect(captured[0]?.authorization).toBe("");
    expect(captured[0]?.body.has("client_secret")).toBe(false);
  });

  it("confidential client, default method: secret rides Basic ONLY", async () => {
    const captured: CapturedRequest[] = [];
    await exchangeCode(
      "https://auth.example.com/token",
      "c",
      "http://cb",
      "v",
      "client-1",
      "s3cret",
      "",
      capturingFetch(TOKENS, captured),
    );
    expect(captured[0]?.authorization).toBe(
      `Basic ${Buffer.from("client-1:s3cret").toString("base64")}`,
    );
    expect(captured[0]?.body.has("client_secret")).toBe(false);
  });

  it("client_secret_post: secret rides the form body ONLY", async () => {
    const captured: CapturedRequest[] = [];
    await exchangeCode(
      "https://auth.example.com/token",
      "c",
      "http://cb",
      "v",
      "client-1",
      "s3cret",
      "client_secret_post",
      capturingFetch(TOKENS, captured),
    );
    expect(captured[0]?.authorization).toBe("");
    expect(captured[0]?.body.get("client_secret")).toBe("s3cret");
  });

  it("promotes Slack's authed_user token over the top-level bot token", async () => {
    const response = await exchangeCode(
      "https://auth.example.com/token",
      "c",
      "http://cb",
      "v",
      "client-1",
      "",
      "",
      capturingFetch(
        {
          access_token: "xoxb-bot",
          token_type: "bot",
          authed_user: {
            access_token: "xoxp-user",
            token_type: "user",
            scope: "chat:write",
          },
        },
        [],
      ),
    );
    expect(response.accessToken).toBe("xoxp-user");
    expect(response.tokenType).toBe("user");
    expect(response.scope).toBe("chat:write");
  });

  it("refuses a non-200 with the truncated body", async () => {
    await expect(
      exchangeCode(
        "https://auth.example.com/token",
        "c",
        "http://cb",
        "v",
        "client-1",
        "",
        "",
        capturingFetch({ error: "invalid_grant" }, [], 400),
      ),
    ).rejects.toThrow(
      'token endpoint https://auth.example.com/token returned HTTP 400: {"error":"invalid_grant"}',
    );
  });

  it("refuses a 200 whose body has no access_token", async () => {
    await expect(
      exchangeCode(
        "https://auth.example.com/token",
        "c",
        "http://cb",
        "v",
        "client-1",
        "",
        "",
        capturingFetch({ token_type: "bearer" }, []),
      ),
    ).rejects.toThrow(
      "token response from https://auth.example.com/token is missing access_token",
    );
  });

  it("never follows a redirect: the exchange and the renewal ask for none and refuse a 3xx, its target unreached", async () => {
    for (const status of [301, 302, 307, 308]) {
      const asked: Array<{ url: string; redirect: RequestInit["redirect"] }> = [];
      const redirecting: typeof fetch = async (url, init) => {
        asked.push({ url: String(url), redirect: init?.redirect });
        return new Response(null, {
          status,
          headers: { Location: "https://collector.evil.example/token" },
        });
      };
      const refusal = `token endpoint https://auth.example.com/token answered with a redirect (HTTP ${status})`;
      await expect(
        exchangeCode(
          "https://auth.example.com/token",
          "c",
          "http://cb",
          "v",
          "client-1",
          "secret-1",
          "",
          redirecting,
        ),
      ).rejects.toThrow(refusal);
      await expect(
        refreshToken("https://auth.example.com/token", "rt-1", "client-1", "secret-1", "", redirecting),
      ).rejects.toThrow(refusal);
      expect(asked).toEqual([
        { url: "https://auth.example.com/token", redirect: "manual" },
        { url: "https://auth.example.com/token", redirect: "manual" },
      ]);
    }
  });
});
