/**
 * Pins the github broker against Go's controller behavior — the arms the
 * conformance suite deliberately cannot assert (they dial github.com for
 * real on a configured broker, and the OSS broker is ALWAYS configured):
 * authorize-URL byte parity, the exchange request's exact wire shape, and
 * the error-mapping contract (GitHub error → InvalidArgument, network →
 * Unavailable, unparseable → Internal, config-missing →
 * FailedPrecondition). Go keeps no in-package tests for these; this file
 * is the reference-pinning the port adds.
 *
 * All arms run against an in-process router with an injected fetch — a
 * test must never leave the host.
 */
import { createClient, createRouterTransport, Code, ConnectError } from "@connectrpc/connect";

import { describe, expect, it } from "vitest";

import { GitHubService } from "@stigmer/protos/ai/stigmer/platform/github/v1/service_pb";

import { createLogger } from "../../../boot/logger.js";
import { registerGitHubServices } from "../controller.js";
import type { GitHubControllerDeps } from "../controller.js";

const silentLogger = createLogger({ level: "error", pretty: false, write: () => {} });

const REDIRECT = "https://app.example.com/oauth/callback";

function makeClient(overrides: Partial<GitHubControllerDeps> = {}) {
  const transport = createRouterTransport((router) => {
    registerGitHubServices(router, {
      clientId: "test-client-id",
      clientSecret: "test-client-secret",
      logger: silentLogger,
      ...overrides,
    });
  });
  return createClient(GitHubService, transport);
}

async function grpcError(run: () => Promise<unknown>): Promise<ConnectError> {
  try {
    await run();
    throw new Error("expected the call to fail");
  } catch (error) {
    if (error instanceof ConnectError) {
      return error;
    }
    throw error;
  }
}

/** A fetch stub returning the given body (or failing), recording the request. */
function fetchStub(result: { body?: string; reject?: Error }): {
  fetchImpl: typeof fetch;
  calls: Array<{ url: string; init: RequestInit }>;
} {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ) => {
    calls.push({ url: String(input), init: init ?? {} });
    if (result.reject !== undefined) {
      throw result.reject;
    }
    return new Response(result.body ?? "", { status: 200 });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

describe("github broker — getOAuthAuthorizeUrl", () => {
  it("builds the authorize URL with Go url.Values.Encode byte parity", async () => {
    const client = makeClient();
    const out = await client.getOAuthAuthorizeUrl({ redirectUri: REDIRECT });

    // 16 random bytes, hex-encoded (Go generateState).
    expect(out.state).toMatch(/^[0-9a-f]{32}$/);

    // Keys sorted (client_id, redirect_uri, scope, state), values
    // QueryEscape'd: ':' → %3A, ',' → %2C, '/' → %2F — the exact bytes Go
    // produces.
    expect(out.authorizeUrl).toBe(
      "https://github.com/login/oauth/authorize" +
        "?client_id=test-client-id" +
        "&redirect_uri=https%3A%2F%2Fapp.example.com%2Foauth%2Fcallback" +
        "&scope=repo%2Cread%3Auser" +
        `&state=${out.state}`,
    );
  });

  it("generates a fresh state per call", async () => {
    const client = makeClient();
    const first = await client.getOAuthAuthorizeUrl({ redirectUri: REDIRECT });
    const second = await client.getOAuthAuthorizeUrl({ redirectUri: REDIRECT });
    expect(first.state).not.toBe(second.state);
  });

  it("answers FailedPrecondition without a client id (the cloud-live guard)", async () => {
    const client = makeClient({ clientId: "" });
    const err = await grpcError(() =>
      client.getOAuthAuthorizeUrl({ redirectUri: REDIRECT }),
    );
    expect(err.code).toBe(Code.FailedPrecondition);
    expect(err.rawMessage).toBe(
      "GitHub OAuth is not configured (STIGMER_GITHUB_CLIENT_ID not set)",
    );
  });
});

describe("github broker — exchangeOAuthCode", () => {
  it("POSTs the Go-encoded form and relays the token response", async () => {
    const { fetchImpl, calls } = fetchStub({
      body: JSON.stringify({
        access_token: "gho_testtoken",
        token_type: "bearer",
        scope: "repo,read:user",
      }),
    });
    const client = makeClient({ fetchImpl });

    const out = await client.exchangeOAuthCode({
      code: "authcode123",
      state: "st",
      redirectUri: REDIRECT,
    });

    expect(out.accessToken).toBe("gho_testtoken");
    expect(out.tokenType).toBe("bearer");
    expect(out.scope).toBe("repo,read:user");

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://github.com/login/oauth/access_token");
    expect(calls[0]?.init.method).toBe("POST");
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(headers["Accept"]).toBe("application/json");
    // Sorted keys, QueryEscape'd values — Go url.Values.Encode bytes.
    expect(calls[0]?.init.body).toBe(
      "client_id=test-client-id" +
        "&client_secret=test-client-secret" +
        "&code=authcode123" +
        "&redirect_uri=https%3A%2F%2Fapp.example.com%2Foauth%2Fcallback",
    );
  });

  it("maps GitHub's OAuth error to InvalidArgument with the description", async () => {
    const { fetchImpl } = fetchStub({
      body: JSON.stringify({
        error: "bad_verification_code",
        error_description: "The code passed is incorrect or expired.",
      }),
    });
    const client = makeClient({ fetchImpl });

    const err = await grpcError(() =>
      client.exchangeOAuthCode({ code: "bad", state: "st", redirectUri: REDIRECT }),
    );
    expect(err.code).toBe(Code.InvalidArgument);
    expect(err.rawMessage).toBe(
      "GitHub OAuth error: The code passed is incorrect or expired.",
    );
  });

  it("maps a network failure to Unavailable", async () => {
    const { fetchImpl } = fetchStub({ reject: new Error("connect ECONNREFUSED") });
    const client = makeClient({ fetchImpl });

    const err = await grpcError(() =>
      client.exchangeOAuthCode({ code: "c", state: "st", redirectUri: REDIRECT }),
    );
    expect(err.code).toBe(Code.Unavailable);
    expect(err.rawMessage).toBe("failed to reach GitHub for token exchange");
  });

  it("maps an unparseable response to Internal", async () => {
    const { fetchImpl } = fetchStub({ body: "<html>not json</html>" });
    const client = makeClient({ fetchImpl });

    const err = await grpcError(() =>
      client.exchangeOAuthCode({ code: "c", state: "st", redirectUri: REDIRECT }),
    );
    expect(err.code).toBe(Code.Internal);
    expect(err.rawMessage).toBe("failed to parse GitHub response");
  });

  it("answers FailedPrecondition when either credential is missing", async () => {
    for (const overrides of [{ clientId: "" }, { clientSecret: "" }]) {
      const client = makeClient(overrides);
      const err = await grpcError(() =>
        client.exchangeOAuthCode({ code: "c", state: "st", redirectUri: REDIRECT }),
      );
      expect(err.code).toBe(Code.FailedPrecondition);
      expect(err.rawMessage).toBe("GitHub OAuth is not configured");
    }
  });
});
