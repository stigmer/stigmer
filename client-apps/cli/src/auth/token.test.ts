import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../config/index.js";
import { createRefreshingTokenProvider } from "./token.js";

// The provider persists refreshed tokens via config.save(), which writes to
// ~/.stigmer/config.yaml. Redirect HOME to a throwaway dir so tests never touch
// the developer's real config.
let originalHome: string | undefined;

function cloudConfig(overrides: Partial<NonNullable<Config["backend"]["cloud"]>>): Config {
  return { backend: { type: "cloud", cloud: { endpoint: "api.stigmer.ai:443", ...overrides } } };
}

function mockFetch(response: { ok: boolean; status?: number; body: unknown }): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: response.ok,
      status: response.status ?? (response.ok ? 200 : 400),
      json: async () => response.body,
    })),
  );
}

beforeEach(() => {
  originalHome = process.env.HOME;
  process.env.HOME = mkdtempSync(join(tmpdir(), "stigmer-token-"));
  delete process.env.STIGMER_API_KEY;
});

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  vi.unstubAllGlobals();
});

describe("createRefreshingTokenProvider", () => {
  it("returns STIGMER_API_KEY without refreshing", async () => {
    process.env.STIGMER_API_KEY = "env-key";
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const provider = createRefreshingTokenProvider(cloudConfig({ token: "stale", token_expiry: past() }));
    expect(await provider()).toBe("env-key");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns a non-expired token without refreshing", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const provider = createRefreshingTokenProvider(cloudConfig({ token: "good", token_expiry: future() }));
    expect(await provider()).toBe("good");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refreshes an expired token and persists the new one", async () => {
    mockFetch({ ok: true, body: { access_token: "fresh", refresh_token: "r2", expires_in: 3600 } });
    const config = cloudConfig({ token: "expired", token_expiry: past(), refresh_token: "r1" });
    const provider = createRefreshingTokenProvider(config);
    expect(await provider()).toBe("fresh");
    expect(config.backend.cloud?.token).toBe("fresh");
    expect(config.backend.cloud?.refresh_token).toBe("r2");
  });

  it("falls back to the existing token when refresh fails", async () => {
    mockFetch({ ok: false, status: 401, body: { error: "invalid_grant" } });
    const provider = createRefreshingTokenProvider(
      cloudConfig({ token: "expired", token_expiry: past(), refresh_token: "r1" }),
    );
    expect(await provider()).toBe("expired");
  });

  it("returns null in cloud mode with no credentials", async () => {
    const provider = createRefreshingTokenProvider(cloudConfig({}));
    expect(await provider()).toBeNull();
  });

  it("treats a token without an expiry as valid (legacy)", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const provider = createRefreshingTokenProvider(cloudConfig({ token: "legacy" }));
    expect(await provider()).toBe("legacy");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

function past(): string {
  return new Date(Date.now() - 10 * 60 * 1000).toISOString();
}

function future(): string {
  return new Date(Date.now() + 60 * 60 * 1000).toISOString();
}
