/**
 * Pins the github broker against Go's controller behavior — the arms the
 * conformance suite deliberately cannot assert (they dial github.com for
 * real on a configured broker, and the OSS broker is ALWAYS configured):
 * authorize-URL byte parity, the exchange request's exact wire shape, and
 * the error-mapping contract (GitHub error → InvalidArgument, network →
 * Unavailable, unparseable → Internal, config-missing →
 * FailedPrecondition) — and what the exchange does with the token: it
 * saves it as the github.com login in the caller's own My vault,
 * replacing a pasted github.com token there, and answers the account's
 * login, never the token. The OAuth state is the
 * server's: the authorize call records it for its caller, organization
 * and redirect, and the exchange consumes it once, refusing (and saving
 * nothing) on a state it did not issue to that caller for that
 * organization and redirect. Neither the exchange nor the account read
 * follows a redirect.
 *
 * All arms run against an in-process router over a real sqlite store and
 * vault service, with an injected fetch — a test must never leave the host.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createClient, createRouterTransport, Code, ConnectError } from "@connectrpc/connect";
import type { Interceptor } from "@connectrpc/connect";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GitHubService } from "@stigmer/protos/ai/stigmer/platform/github/v1/service_pb";

import { createLogger } from "../../../boot/logger.js";
import { SecretService } from "../../../encryption/encryption.js";
import type { CallerIdentity } from "../../../extensions/identity.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { callerIdentityKey } from "../../../pipeline/interceptors/auth.js";
import { newPermissiveSingleTeamAuthorizer } from "../../../pipeline/steps/authorize.js";
import { SqliteStore } from "../../../store/sqlite/store.js";
import { newVaultService } from "../../vault/service.js";
import type { VaultService } from "../../vault/service.js";
import { VaultConnectionSource } from "../../vault/service.js";
import { registerGitHubServices } from "../controller.js";
import type { GitHubControllerDeps } from "../controller.js";

const silentLogger = createLogger({ level: "error", pretty: false, write: () => {} });

const REDIRECT = "https://app.example.com/oauth/callback";
const ORG = "org_00000000000000000000000001";
const caller = testCallerIdentity({ identityId: "ida_alice" });

let dir: string;
let store: SqliteStore;
let vaults: VaultService;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "github-broker-"));
  store = SqliteStore.open(path.join(dir, "test.db"));
  vaults = newVaultService({
    store,
    logger: silentLogger,
    secretService: SecretService.create(undefined),
    authorizationLifecycle: undefined,
  });
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

function stampCaller(identity: CallerIdentity): Interceptor {
  return (next) => (request) => {
    request.contextValues.set(callerIdentityKey, identity);
    return next(request);
  };
}

function makeClient(overrides: Partial<GitHubControllerDeps> = {}, as: CallerIdentity = caller) {
  const transport = createRouterTransport(
    (router) => {
      registerGitHubServices(router, {
        clientId: "test-client-id",
        clientSecret: "test-client-secret",
        logger: silentLogger,
        authorizer: newPermissiveSingleTeamAuthorizer(),
        vaults,
        pendingOAuthStates: store.pendingOAuthStates,
        ...overrides,
      });
    },
    { router: { interceptors: [stampCaller(as)] } },
  );
  return createClient(GitHubService, transport);
}

/** A state the server issued to `as` for `org` and `redirectUri`. */
async function issuedState(
  init: { as?: CallerIdentity; org?: string; redirectUri?: string } = {},
): Promise<string> {
  const out = await makeClient({}, init.as ?? caller).getOAuthAuthorizeUrl({
    redirectUri: init.redirectUri ?? REDIRECT,
    org: init.org ?? ORG,
  });
  return out.state;
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

/**
 * A fetch stub returning the given body (or failing) for the token
 * exchange and the account read for GET /user, recording every request.
 */
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
    if (String(input) === "https://api.github.com/user") {
      return new Response(JSON.stringify({ login: "alice-gh" }), { status: 200 });
    }
    return new Response(result.body ?? "", { status: 200 });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

describe("github broker — getOAuthAuthorizeUrl", () => {
  it("builds the authorize URL with Go url.Values.Encode byte parity", async () => {
    const client = makeClient();
    const out = await client.getOAuthAuthorizeUrl({ redirectUri: REDIRECT, org: ORG });

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
    const first = await client.getOAuthAuthorizeUrl({ redirectUri: REDIRECT, org: ORG });
    const second = await client.getOAuthAuthorizeUrl({ redirectUri: REDIRECT, org: ORG });
    expect(first.state).not.toBe(second.state);
  });

  it("answers FailedPrecondition without a client id (the cloud-live guard)", async () => {
    const client = makeClient({ clientId: "" });
    const err = await grpcError(() =>
      client.getOAuthAuthorizeUrl({ redirectUri: REDIRECT, org: ORG }),
    );
    expect(err.code).toBe(Code.FailedPrecondition);
    expect(err.rawMessage).toBe(
      "GitHub OAuth is not configured (STIGMER_GITHUB_CLIENT_ID not set)",
    );
  });
});

describe("github broker — exchangeOAuthCode", () => {
  it("POSTs the Go-encoded form, saves the token in the caller's My vault, and answers the login, never the token", async () => {
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
      state: await issuedState(),
      redirectUri: REDIRECT,
      org: ORG,
    });

    expect(out.login).toBe("alice-gh");
    expect(out.tokenType).toBe("bearer");
    expect(out.scope).toBe("repo,read:user");
    expect(JSON.stringify(out)).not.toContain("gho_testtoken");

    // The login is the github.com connection in the caller's own My vault.
    const mine = await vaults.findMine(ORG, caller.identityId);
    const opened = await vaults.open(mine!);
    const github = opened.connections.get("github.com");
    expect(github?.token).toBe("gho_testtoken");
    expect(github?.source).toBe(VaultConnectionSource.sign_in);
    expect(mine?.spec?.connections["github.com"]?.description).toBe("GitHub @alice-gh");

    // The account read carried the new token server-side.
    expect(calls).toHaveLength(2);
    const userHeaders = calls[1]?.init.headers as Record<string, string>;
    expect(calls[1]?.url).toBe("https://api.github.com/user");
    expect(userHeaders["Authorization"]).toBe("Bearer gho_testtoken");
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
    // Neither request follows a redirect: the client secret and the new
    // token never travel to another host.
    expect(calls.map((call) => call.init.redirect)).toEqual(["manual", "manual"]);
  });

  it("replaces a pasted github.com token in My vault: connecting GitHub is the act of replacing that login", async () => {
    const mine = await vaults.ensureMine(ORG, caller);
    await vaults.setConnection(
      mine.metadata!.id,
      "github.com",
      { token: "ghp_pasted", source: VaultConnectionSource.pasted, description: "Pasted" },
      caller,
    );
    const { fetchImpl } = fetchStub({
      body: JSON.stringify({ access_token: "gho_connected", token_type: "bearer", scope: "repo" }),
    });
    await makeClient({ fetchImpl }).exchangeOAuthCode({
      code: "authcode123",
      state: await issuedState(),
      redirectUri: REDIRECT,
      org: ORG,
    });
    const github = (await vaults.open((await vaults.findMine(ORG, caller.identityId))!)).connections.get(
      "github.com",
    );
    expect(github?.token).toBe("gho_connected");
    expect(github?.source).toBe(VaultConnectionSource.sign_in);
  });

  it("maps GitHub's OAuth error to InvalidArgument with the description", async () => {
    const { fetchImpl } = fetchStub({
      body: JSON.stringify({
        error: "bad_verification_code",
        error_description: "The code passed is incorrect or expired.",
      }),
    });
    const client = makeClient({ fetchImpl });

    const state = await issuedState();
    const err = await grpcError(() =>
      client.exchangeOAuthCode({ code: "bad", state, redirectUri: REDIRECT, org: ORG }),
    );
    expect(err.code).toBe(Code.InvalidArgument);
    expect(err.rawMessage).toBe(
      "GitHub OAuth error: The code passed is incorrect or expired.",
    );
  });

  it("answers Internal when GitHub's response carries no access token", async () => {
    const { fetchImpl } = fetchStub({ body: JSON.stringify({ token_type: "bearer", scope: "repo" }) });
    const client = makeClient({ fetchImpl });

    const state = await issuedState();
    const err = await grpcError(() =>
      client.exchangeOAuthCode({ code: "c", state, redirectUri: REDIRECT, org: ORG }),
    );
    expect(err.code).toBe(Code.Internal);
    expect(err.rawMessage).toBe("GitHub answered no access token");
  });

  it("maps a network failure to Unavailable", async () => {
    const { fetchImpl } = fetchStub({ reject: new Error("connect ECONNREFUSED") });
    const client = makeClient({ fetchImpl });

    const state = await issuedState();
    const err = await grpcError(() =>
      client.exchangeOAuthCode({ code: "c", state, redirectUri: REDIRECT, org: ORG }),
    );
    expect(err.code).toBe(Code.Unavailable);
    expect(err.rawMessage).toBe("failed to reach GitHub for token exchange");
  });

  it("maps an unparseable response to Internal", async () => {
    const { fetchImpl } = fetchStub({ body: "<html>not json</html>" });
    const client = makeClient({ fetchImpl });

    const state = await issuedState();
    const err = await grpcError(() =>
      client.exchangeOAuthCode({ code: "c", state, redirectUri: REDIRECT, org: ORG }),
    );
    expect(err.code).toBe(Code.Internal);
    expect(err.rawMessage).toBe("failed to parse GitHub response");
  });

  it("answers FailedPrecondition when either credential is missing", async () => {
    for (const overrides of [{ clientId: "" }, { clientSecret: "" }]) {
      const client = makeClient(overrides);
      const err = await grpcError(() =>
        client.exchangeOAuthCode({ code: "c", state: "st", redirectUri: REDIRECT, org: ORG }),
      );
      expect(err.code).toBe(Code.FailedPrecondition);
      expect(err.rawMessage).toBe("GitHub OAuth is not configured");
    }
  });
});

describe("github broker — the OAuth state is the server's", () => {
  const bob = testCallerIdentity({ identityId: "ida_bob" });
  const OTHER_ORG = "org_00000000000000000000000002";

  async function refusedAndNothingSaved(state: string): Promise<ConnectError> {
    const { fetchImpl, calls } = fetchStub({
      body: JSON.stringify({ access_token: "gho_planted", token_type: "bearer", scope: "repo" }),
    });
    const err = await grpcError(() =>
      makeClient({ fetchImpl }).exchangeOAuthCode({ code: "c", state, redirectUri: REDIRECT, org: ORG }),
    );
    // GitHub is never asked, and no login lands anywhere.
    expect(calls).toEqual([]);
    expect(await vaults.findMine(ORG, caller.identityId)).toBeUndefined();
    return err;
  }

  it("refuses a state it never issued, and saves nothing", async () => {
    const err = await refusedAndNothingSaved("a-state-from-a-crafted-link");
    expect(err.code).toBe(Code.FailedPrecondition);
    expect(err.rawMessage).toContain("start it again");
  });

  it("refuses a state issued to another account, for another organization or another redirect, and saves nothing", async () => {
    for (const state of [
      await issuedState({ as: bob }),
      await issuedState({ org: OTHER_ORG }),
      await issuedState({ redirectUri: "https://elsewhere.example/cb" }),
    ]) {
      const err = await refusedAndNothingSaved(state);
      expect(err.code).toBe(Code.FailedPrecondition);
    }
  });

  it("a state serves one exchange", async () => {
    const { fetchImpl } = fetchStub({
      body: JSON.stringify({ access_token: "gho_once", token_type: "bearer", scope: "repo" }),
    });
    const client = makeClient({ fetchImpl });
    const state = await issuedState();
    await client.exchangeOAuthCode({ code: "c", state, redirectUri: REDIRECT, org: ORG });
    const again = await grpcError(() =>
      client.exchangeOAuthCode({ code: "c", state, redirectUri: REDIRECT, org: ORG }),
    );
    expect(again.code).toBe(Code.FailedPrecondition);
  });

  it("answers Internal when the state cannot be recorded or read", async () => {
    const fault = async (): Promise<never> => {
      throw new Error("disk gone");
    };
    const broken = { ...store.pendingOAuthStates, save: fault, getAndDelete: fault };
    const client = makeClient({ pendingOAuthStates: broken });
    const minted = await grpcError(() => client.getOAuthAuthorizeUrl({ redirectUri: REDIRECT, org: ORG }));
    expect(minted.code).toBe(Code.Internal);
    const exchanged = await grpcError(() =>
      client.exchangeOAuthCode({ code: "c", state: "s", redirectUri: REDIRECT, org: ORG }),
    );
    expect(exchanged.code).toBe(Code.Internal);
  });

  it("issues a state only to a caller who may keep a vault in the organization", async () => {
    const denied = makeClient({
      authorizer: { authorize: async () => ({ kind: "deny", reason: "not a member" }) },
    });
    const err = await grpcError(() =>
      denied.getOAuthAuthorizeUrl({ redirectUri: REDIRECT, org: ORG }),
    );
    expect(err.code).toBe(Code.PermissionDenied);
  });
});
