// Unit tests for the CLI's token providers (auth/token.ts), with the issuer's
// discovery document and token endpoint stubbed through `fetch` and HOME in a
// throwaway folder.
//
// A refresh goes to the issuer the entry signed in with (its discovery
// document's token endpoint, its client id); an entry that names no issuer is
// never refreshed, and a selfhost entry that holds a sign-in is served and
// refreshed as a cloud one is.
//
// The short-lived provider: an API key in the environment wins, a valid token
// is served as is, an expired one is refreshed, and concurrent calls share one
// refresh request. The long-running source behind `stigmer mcp-server`: it is
// pinned to the backend it started with, reads the file once per token
// lifetime (so a refresh, a rotated refresh token or a login another command
// saved is seen), answers null once its backend is gone or re-pointed, never
// throws on a token with no usable expiry, and recovers on the next call after
// a refused refresh. Both persist a refresh by patching their own entry into
// the file as it is now, so a `backend use` or another entry saved meanwhile
// survives. Time moves with a faked Date only, so promises and fetch run as
// they do in production.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type Config,
  type NamedBackendConfig,
  load,
  save,
} from "../../config/index.js";
import { forgetDiscovery } from "../oidc.js";
import {
  createBackendTokenSource,
  createRefreshingTokenProvider,
} from "../token.js";

const ISSUER = "https://id.example.test/";
const TOKEN_ENDPOINT = "https://id.example.test/oauth/token";
const CLIENT = "native-client";
/** The provider a sign-in came from, as login stores it. */
const SIGNED_IN = { oidc_issuer: ISSUER, oidc_client_id: CLIENT } as const;

/** The issuer's discovery document, for a GET of it; undefined for any other request. */
function discoveryAnswer(url: string): { ok: boolean; status: number; json: () => Promise<unknown> } | undefined {
  if (!url.endsWith("/.well-known/openid-configuration")) return undefined;
  return {
    ok: true,
    status: 200,
    json: async () => ({
      issuer: ISSUER,
      authorization_endpoint: "https://id.example.test/authorize",
      token_endpoint: TOKEN_ENDPOINT,
    }),
  };
}

// The provider persists refreshed tokens via config.save(), which writes to
// ~/.stigmer/config.yaml. Redirect HOME to a throwaway dir so tests never touch
// the developer's real config.
let originalHome: string | undefined;

function cloudConfig(overrides: Partial<NamedBackendConfig>): Config {
  return {
    backend: {},
    backends: {
      cloud: { type: "cloud", endpoint: "api.stigmer.ai:443", ...SIGNED_IN, ...overrides },
    },
    current_backend: "cloud",
  };
}

function selfhostConfig(overrides: Partial<NamedBackendConfig> = {}): Config {
  return {
    backend: {},
    backends: {
      staging: {
        type: "selfhost",
        endpoint: "stigmer.example.com:7234",
        ...overrides,
      },
    },
    current_backend: "staging",
  };
}

function mockFetch(response: {
  ok: boolean;
  status?: number;
  body: unknown;
}): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      discoveryAnswer(url) ?? {
        ok: response.ok,
        status: response.status ?? (response.ok ? 200 : 400),
        json: async () => response.body,
      },
    ),
  );
}

beforeEach(() => {
  originalHome = process.env.HOME;
  process.env.HOME = mkdtempSync(join(tmpdir(), "stigmer-token-"));
  delete process.env.STIGMER_API_KEY;
  forgetDiscovery();
});

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const ENDPOINT = "api.stigmer.ai:443";

/** A stubbed token endpoint answering each refresh with the next token set. */
function tokenEndpoint(
  answers: Array<{ access_token: string; refresh_token?: string; expires_in?: number }>,
  during?: () => void,
): { readonly refreshTokensSent: string[]; readonly forms: URLSearchParams[]; readonly urls: string[] } {
  const refreshTokensSent: string[] = [];
  const forms: URLSearchParams[] = [];
  const urls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { body: string }) => {
      const discovery = discoveryAnswer(url);
      if (discovery !== undefined) return discovery;
      urls.push(url);
      const form = new URLSearchParams(init?.body ?? "");
      forms.push(form);
      refreshTokensSent.push(form.get("refresh_token") ?? "");
      during?.();
      const body = answers.shift();
      return {
        ok: body !== undefined,
        status: body === undefined ? 400 : 200,
        json: async () => body ?? { error: "invalid_grant" },
      };
    }),
  );
  return { refreshTokensSent, forms, urls };
}

/** Write the cloud entry (and anything else in `config`) to the on-disk file. */
function writeCloud(overrides: Partial<NamedBackendConfig>, config?: Partial<Config>): void {
  save({
    backend: {},
    current_backend: "cloud",
    ...config,
    backends: { cloud: { type: "cloud", endpoint: ENDPOINT, ...SIGNED_IN, ...overrides }, ...config?.backends },
  });
}

function onDisk(name = "cloud"): NamedBackendConfig | undefined {
  return load().backends?.[name];
}

function advance(ms: number): void {
  vi.setSystemTime(Date.now() + ms);
}

describe("createRefreshingTokenProvider", () => {
  it("returns STIGMER_API_KEY without refreshing", async () => {
    process.env.STIGMER_API_KEY = "env-key";
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const provider = createRefreshingTokenProvider(
      cloudConfig({ token: "stale", token_expiry: past() }),
    );
    expect(await provider()).toBe("env-key");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns a non-expired token without refreshing", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const provider = createRefreshingTokenProvider(
      cloudConfig({ token: "good", token_expiry: future() }),
    );
    expect(await provider()).toBe("good");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refreshes an expired token and persists the new one into the entry", async () => {
    mockFetch({
      ok: true,
      body: { access_token: "fresh", refresh_token: "r2", expires_in: 3600 },
    });
    const config = cloudConfig({
      token: "expired",
      token_expiry: past(),
      refresh_token: "r1",
    });
    const provider = createRefreshingTokenProvider(config);
    expect(await provider()).toBe("fresh");
    expect(config.backends?.["cloud"]?.token).toBe("fresh");
    expect(config.backends?.["cloud"]?.refresh_token).toBe("r2");
  });

  it("returns the selfhost entry's api_key without any refresh machinery", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const provider = createRefreshingTokenProvider(
      selfhostConfig({ api_key: "stk_stored" }),
    );
    expect(await provider()).toBe("stk_stored");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns null on a selfhost backend with no stored key", async () => {
    const provider = createRefreshingTokenProvider(selfhostConfig());
    expect(await provider()).toBeNull();
  });

  it("falls back to the existing token when refresh fails", async () => {
    mockFetch({ ok: false, status: 401, body: { error: "invalid_grant" } });
    const provider = createRefreshingTokenProvider(
      cloudConfig({
        token: "expired",
        token_expiry: past(),
        refresh_token: "r1",
      }),
    );
    expect(await provider()).toBe("expired");
  });

  it("returns null in cloud mode with no credentials", async () => {
    const provider = createRefreshingTokenProvider(cloudConfig({}));
    expect(await provider()).toBeNull();
  });

  it("makes one refresh request for concurrent calls", async () => {
    const endpoint = tokenEndpoint([{ access_token: "fresh", expires_in: 3600 }]);
    const provider = createRefreshingTokenProvider(
      cloudConfig({ token: "expired", token_expiry: past(), refresh_token: "r1" }),
    );
    expect(await Promise.all([provider(), provider(), provider()])).toEqual([
      "fresh",
      "fresh",
      "fresh",
    ]);
    expect(endpoint.refreshTokensSent).toEqual(["r1"]);
  });

  it("persists a refresh without undoing a backend change saved while it ran", async () => {
    writeCloud({ token: "expired", token_expiry: past(), refresh_token: "r1" });
    const config = load();
    tokenEndpoint(
      [{ access_token: "fresh", refresh_token: "r2", expires_in: 3600 }],
      () =>
        writeCloud(
          { token: "expired", token_expiry: past(), refresh_token: "r1" },
          {
            current_backend: "staging",
            backends: { staging: { type: "selfhost", endpoint: "stigmer.example.com:7234" } },
          },
        ),
    );

    expect(await createRefreshingTokenProvider(config)()).toBe("fresh");

    const saved = load();
    expect(saved.current_backend).toBe("staging");
    expect(saved.backends?.["staging"]?.endpoint).toBe("stigmer.example.com:7234");
    expect(saved.backends?.["cloud"]?.token).toBe("fresh");
    expect(saved.backends?.["cloud"]?.refresh_token).toBe("r2");
  });

  it("leaves an entry re-pointed while the refresh ran as the person left it", async () => {
    writeCloud({ token: "expired", token_expiry: past(), refresh_token: "r1" });
    const config = load();
    tokenEndpoint([{ access_token: "fresh", expires_in: 3600 }], () =>
      writeCloud({ endpoint: "elsewhere.example.com:443", token: "theirs" }),
    );

    expect(await createRefreshingTokenProvider(config)()).toBe("fresh");
    expect(onDisk()).toMatchObject({ endpoint: "elsewhere.example.com:443", token: "theirs" });
  });

  it("refreshes at the issuer the entry signed in with, as its client", async () => {
    const endpoint = tokenEndpoint([{ access_token: "fresh", expires_in: 3600 }]);
    const provider = createRefreshingTokenProvider(
      cloudConfig({ token: "expired", token_expiry: past(), refresh_token: "r1" }),
    );
    expect(await provider()).toBe("fresh");
    expect(endpoint.urls).toEqual([TOKEN_ENDPOINT]);
    expect(endpoint.forms[0]?.get("grant_type")).toBe("refresh_token");
    expect(endpoint.forms[0]?.get("client_id")).toBe(CLIENT);
  });

  it("never refreshes an entry that names no issuer, leaving the verdict to the server", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const provider = createRefreshingTokenProvider(
      cloudConfig({
        oidc_issuer: undefined,
        oidc_client_id: undefined,
        token: "from-an-older-cli",
        token_expiry: past(),
        refresh_token: "r-old",
      }),
    );
    expect(await provider()).toBe("from-an-older-cli");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("serves a signed-in selfhost entry's token over its api_key, and refreshes it", async () => {
    const endpoint = tokenEndpoint([{ access_token: "fresh-selfhost", expires_in: 3600 }]);
    const provider = createRefreshingTokenProvider(
      selfhostConfig({
        ...SIGNED_IN,
        api_key: "stk_stored",
        token: "expired",
        token_expiry: past(),
        refresh_token: "r-self",
      }),
    );
    expect(await provider()).toBe("fresh-selfhost");
    expect(endpoint.refreshTokensSent).toEqual(["r-self"]);
  });

  it("treats a token without an expiry as valid, leaving the verdict to the server", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const provider = createRefreshingTokenProvider(
      cloudConfig({ token: "pasted-token" }),
    );
    expect(await provider()).toBe("pasted-token");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("createBackendTokenSource", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
  });

  it("refreshes an expired token once, persists it, and serves it until it is due", async () => {
    writeCloud({ token: "expired", token_expiry: past(), refresh_token: "r1" });
    const endpoint = tokenEndpoint([{ access_token: "fresh", refresh_token: "r2", expires_in: 3600 }]);
    const source = createBackendTokenSource("cloud", ENDPOINT);

    expect(await source.getAccessToken()).toBe("fresh");
    expect(await source.getAccessToken()).toBe("fresh");

    expect(endpoint.refreshTokensSent).toEqual(["r1"]);
    expect(onDisk()).toMatchObject({ token: "fresh", refresh_token: "r2" });
    expect(Date.parse(onDisk()?.token_expiry ?? "")).toBeGreaterThan(Date.now());
  });

  it("makes one refresh request for concurrent calls", async () => {
    writeCloud({ token: "expired", token_expiry: past(), refresh_token: "r1" });
    const endpoint = tokenEndpoint([{ access_token: "fresh", expires_in: 3600 }]);
    const source = createBackendTokenSource("cloud", ENDPOINT);

    expect(await Promise.all([source.getAccessToken(), source.getAccessToken()])).toEqual([
      "fresh",
      "fresh",
    ]);
    expect(endpoint.refreshTokensSent).toEqual(["r1"]);
  });

  it("refreshes with the refresh token on disk, rotated by another command", async () => {
    writeCloud({ token: "expired", token_expiry: past(), refresh_token: "r1" });
    const endpoint = tokenEndpoint([
      { access_token: "first", expires_in: 3600 },
      { access_token: "second", expires_in: 3600 },
    ]);
    const source = createBackendTokenSource("cloud", ENDPOINT);
    expect(await source.getAccessToken()).toBe("first");

    // Another command refreshed meanwhile and Auth0 rotated the refresh token.
    writeCloud({ token: "theirs", token_expiry: past(), refresh_token: "r-rotated" });
    advance(60 * 60 * 1000);

    expect(await source.getAccessToken()).toBe("second");
    expect(endpoint.refreshTokensSent).toEqual(["r1", "r-rotated"]);
  });

  it("answers null once its token is due and the entry is gone", async () => {
    writeCloud({ token: "good", token_expiry: future() });
    const source = createBackendTokenSource("cloud", ENDPOINT);
    expect(await source.getAccessToken()).toBe("good");

    save({ backend: {}, backends: {}, current_backend: "local" });
    advance(60 * 60 * 1000);

    expect(await source.getAccessToken()).toBeNull();
  });

  it("answers null once its token is due and the entry points elsewhere", async () => {
    writeCloud({ token: "good", token_expiry: future() });
    const source = createBackendTokenSource("cloud", ENDPOINT);
    expect(await source.getAccessToken()).toBe("good");

    writeCloud({ endpoint: "elsewhere.example.com:443", token: "other", token_expiry: future(2) });
    advance(60 * 60 * 1000);

    expect(await source.getAccessToken()).toBeNull();
  });

  it("answers null for an entry that is no longer a cloud backend", async () => {
    save({
      backend: {},
      current_backend: "cloud",
      backends: { cloud: { type: "selfhost", endpoint: ENDPOINT, api_key: "stk_x" } },
    });
    expect(await createBackendTokenSource("cloud", ENDPOINT).getAccessToken()).toBeNull();
  });

  it("keeps serving its own backend after current_backend moves elsewhere", async () => {
    writeCloud({ token: "good", token_expiry: future() });
    const source = createBackendTokenSource("cloud", ENDPOINT);
    expect(await source.getAccessToken()).toBe("good");

    writeCloud(
      { token: "good-later", token_expiry: future(2) },
      {
        current_backend: "staging",
        backends: { staging: { type: "selfhost", endpoint: "stigmer.example.com:7234", api_key: "stk_s" } },
      },
    );
    advance(60 * 60 * 1000);

    expect(await source.getAccessToken()).toBe("good-later");
  });

  it.each([
    ["no expiry", undefined],
    ["an unparseable expiry", "not-a-date"],
  ])("serves a token with %s and reads the file again after five minutes", async (_label, expiry) => {
    writeCloud({ token: "pasted", token_expiry: expiry });
    const source = createBackendTokenSource("cloud", ENDPOINT);
    expect(await source.getAccessToken()).toBe("pasted");

    writeCloud({ token: "pasted-later", token_expiry: expiry });
    expect(await source.getAccessToken()).toBe("pasted");
    advance(5 * 60 * 1000);
    expect(await source.getAccessToken()).toBe("pasted-later");
  });

  it("picks up a later login on the next call after a refused refresh", async () => {
    writeCloud({ token: "expired", token_expiry: past(), refresh_token: "revoked" });
    const endpoint = tokenEndpoint([]);
    const source = createBackendTokenSource("cloud", ENDPOINT);
    expect(await source.getAccessToken()).toBe("expired");

    writeCloud({ token: "after-login", token_expiry: future(), refresh_token: "r-new" });

    expect(await source.getAccessToken()).toBe("after-login");
    expect(endpoint.refreshTokensSent).toEqual(["revoked"]);
  });

  it("serves and refreshes a selfhost backend that holds a sign-in", async () => {
    save({
      backend: {},
      current_backend: "staging",
      backends: {
        staging: {
          type: "selfhost",
          endpoint: "stigmer.example.com:7234",
          ...SIGNED_IN,
          token: "expired",
          token_expiry: past(),
          refresh_token: "r-self",
        },
      },
    });
    tokenEndpoint([{ access_token: "fresh-selfhost", expires_in: 3600 }]);
    const source = createBackendTokenSource("staging", "stigmer.example.com:7234");
    expect(await source.getAccessToken()).toBe("fresh-selfhost");
    expect(onDisk("staging")?.token).toBe("fresh-selfhost");
  });

  it("answers null when nobody is signed in to the backend", async () => {
    writeCloud({});
    expect(await createBackendTokenSource("cloud", ENDPOINT).getAccessToken()).toBeNull();
  });

  it("persists a refresh without undoing a backend change saved while it ran", async () => {
    writeCloud({ token: "expired", token_expiry: past(), refresh_token: "r1" });
    tokenEndpoint([{ access_token: "fresh", expires_in: 3600 }], () =>
      writeCloud(
        { token: "expired", token_expiry: past(), refresh_token: "r1" },
        {
          current_backend: "staging",
          backends: { staging: { type: "selfhost", endpoint: "stigmer.example.com:7234" } },
        },
      ),
    );

    expect(await createBackendTokenSource("cloud", ENDPOINT).getAccessToken()).toBe("fresh");
    expect(load().current_backend).toBe("staging");
    expect(onDisk()?.token).toBe("fresh");
  });
});

function past(): string {
  return new Date(Date.now() - 10 * 60 * 1000).toISOString();
}

function future(hours = 1): string {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}
