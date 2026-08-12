import { describe, it, expect, vi } from "vitest";
import { resolveRunnerBootstrap, refreshRunnerAccessToken } from "../bootstrap.js";
import type { BootstrapClientFactory } from "../bootstrap.js";

/**
 * Unit tests for runner Temporal coordinate self-discovery.
 *
 * The resolver is the heart of token-only embedding: it decides whether to use
 * an explicit address, discover one from the control plane, or fall back to
 * localhost — and it must fail loudly once it commits to discovery.
 */

/** A factory whose client fails the test if discovery is ever attempted. */
const failIfCalled: BootstrapClientFactory = async () => ({
  getRunnerBootstrapConfig: () => {
    throw new Error("discovery must not be attempted in this scenario");
  },
});

describe("resolveRunnerBootstrap", () => {
  it("uses an explicit address verbatim and never discovers", async () => {
    const coords = await resolveRunnerBootstrap(
      {
        explicitAddress: "temporal.prod:7233",
        explicitNamespace: "prod",
        token: "tok_should_be_ignored",
        stigmerEndpoint: "https://api.stigmer.ai",
      },
      failIfCalled,
    );

    expect(coords).toEqual({
      temporalAddress: "temporal.prod:7233",
      temporalNamespace: "prod",
    });
  });

  it("falls back to localhost when neither an address nor a token is present", async () => {
    const coords = await resolveRunnerBootstrap(
      { stigmerEndpoint: "http://localhost:7234" },
      failIfCalled,
    );

    expect(coords).toEqual({
      temporalAddress: "localhost:7233",
      temporalNamespace: "default",
    });
  });

  it("discovers from the control plane when a token is present and no explicit address", async () => {
    const getRunnerBootstrapConfig = vi.fn().mockResolvedValue({
      temporalAddress: "stigmer-temporal.example:7233",
      temporalNamespace: "tenant-ns",
    });
    const factory: BootstrapClientFactory = async (endpoint, token) => {
      expect(endpoint).toBe("https://api.stigmer.ai");
      expect(token).toBe("tok_abc");
      return { getRunnerBootstrapConfig };
    };

    const coords = await resolveRunnerBootstrap(
      { token: "tok_abc", stigmerEndpoint: "https://api.stigmer.ai" },
      factory,
    );

    expect(getRunnerBootstrapConfig).toHaveBeenCalledOnce();
    expect(coords).toEqual({
      temporalAddress: "stigmer-temporal.example:7233",
      temporalNamespace: "tenant-ns",
    });
  });

  it("discovered namespace wins, defaulting to 'default' when blank", async () => {
    const factory: BootstrapClientFactory = async () => ({
      getRunnerBootstrapConfig: () =>
        Promise.resolve({ temporalAddress: "t:7233", temporalNamespace: "" }),
    });

    const coords = await resolveRunnerBootstrap(
      { token: "tok", stigmerEndpoint: "https://api.stigmer.ai" },
      factory,
    );

    expect(coords.temporalNamespace).toBe("default");
  });

  it("throws an actionable error when discovery fails (e.g. server too old)", async () => {
    const factory: BootstrapClientFactory = async () => ({
      getRunnerBootstrapConfig: () =>
        Promise.reject(new Error("unimplemented")),
    });

    await expect(
      resolveRunnerBootstrap(
        { token: "tok", stigmerEndpoint: "https://api.stigmer.ai" },
        factory,
      ),
    ).rejects.toThrow(/Failed to discover Temporal coordinates from https:\/\/api\.stigmer\.ai.*TEMPORAL_SERVICE_ADDRESS/s);
  });

  it("throws when discovery returns an empty address (no silent localhost fallback)", async () => {
    const factory: BootstrapClientFactory = async () => ({
      getRunnerBootstrapConfig: () =>
        Promise.resolve({ temporalAddress: "  ", temporalNamespace: "default" }),
    });

    await expect(
      resolveRunnerBootstrap(
        { token: "tok", stigmerEndpoint: "https://api.stigmer.ai" },
        factory,
      ),
    ).rejects.toThrow(/empty Temporal address/);
  });

  it("treats a whitespace-only explicit address as unset and discovers", async () => {
    const getRunnerBootstrapConfig = vi
      .fn()
      .mockResolvedValue({ temporalAddress: "t:7233", temporalNamespace: "default" });

    const coords = await resolveRunnerBootstrap(
      {
        explicitAddress: "   ",
        token: "tok",
        stigmerEndpoint: "https://api.stigmer.ai",
      },
      async () => ({ getRunnerBootstrapConfig }),
    );

    expect(getRunnerBootstrapConfig).toHaveBeenCalledOnce();
    expect(coords.temporalAddress).toBe("t:7233");
  });

  it("surfaces the minted runner token from the discovery branch", async () => {
    const factory: BootstrapClientFactory = async () => ({
      getRunnerBootstrapConfig: () =>
        Promise.resolve({
          temporalAddress: "t:7233",
          temporalNamespace: "default",
          runnerAccessToken: "rt_minted",
          runnerAccessTokenExpiresInSeconds: 3600,
        }),
    });

    const result = await resolveRunnerBootstrap(
      { token: "tok", stigmerEndpoint: "https://api.stigmer.ai" },
      factory,
    );

    expect(result.runnerAccessToken).toBe("rt_minted");
    expect(result.runnerAccessTokenExpiresInSeconds).toBe(3600);
  });

  it("returns no token from the explicit-address branch (no RPC, so nothing minted)", async () => {
    const result = await resolveRunnerBootstrap(
      {
        explicitAddress: "temporal.prod:7233",
        token: "tok",
        stigmerEndpoint: "https://api.stigmer.ai",
      },
      failIfCalled,
    );

    expect(result.runnerAccessToken).toBeUndefined();
    expect(result.payloadEncryption).toBeUndefined();
  });

  it("surfaces server-managed payload-encryption keys from the discovery branch", async () => {
    const factory: BootstrapClientFactory = async () => ({
      getRunnerBootstrapConfig: () =>
        Promise.resolve({
          temporalAddress: "t:7233",
          temporalNamespace: "default",
          payloadEncryption: {
            key: "a".repeat(44),
            keyId: "identity-key-v2",
            secondaryKey: "b".repeat(44),
            secondaryKeyId: "identity-key-v1",
          },
        }),
    });

    const result = await resolveRunnerBootstrap(
      { token: "tok", stigmerEndpoint: "https://api.stigmer.ai" },
      factory,
    );

    expect(result.payloadEncryption).toEqual({
      key: "a".repeat(44),
      keyId: "identity-key-v2",
      secondaryKey: "b".repeat(44),
      secondaryKeyId: "identity-key-v1",
    });
  });

  it("omits payload-encryption keys when the server does not manage them", async () => {
    const factory: BootstrapClientFactory = async () => ({
      getRunnerBootstrapConfig: () =>
        Promise.resolve({ temporalAddress: "t:7233", temporalNamespace: "default" }),
    });

    const result = await resolveRunnerBootstrap(
      { token: "tok", stigmerEndpoint: "https://api.stigmer.ai" },
      factory,
    );

    expect(result.payloadEncryption).toBeUndefined();
  });
});

describe("refreshRunnerAccessToken", () => {
  it("re-mints the proxy token using the current control-plane token", async () => {
    const getRunnerBootstrapConfig = vi.fn().mockResolvedValue({
      temporalAddress: "ignored:7233",
      temporalNamespace: "ignored",
      runnerAccessToken: "rt_refreshed",
      runnerAccessTokenExpiresInSeconds: 7200,
    });
    const factory: BootstrapClientFactory = async (endpoint, token) => {
      expect(endpoint).toBe("https://api.stigmer.ai");
      expect(token).toBe("cp_token_fresh");
      return { getRunnerBootstrapConfig };
    };

    const refreshed = await refreshRunnerAccessToken(
      { token: "cp_token_fresh", stigmerEndpoint: "https://api.stigmer.ai" },
      factory,
    );

    expect(refreshed).toEqual({ token: "rt_refreshed", expiresInSeconds: 7200 });
  });

  it("returns undefined when there is no control-plane token to authenticate with", async () => {
    const refreshed = await refreshRunnerAccessToken(
      { token: null, stigmerEndpoint: "https://api.stigmer.ai" },
      failIfCalled,
    );
    expect(refreshed).toBeUndefined();
  });

  it("returns undefined (not throw) when the server mints no token", async () => {
    const factory: BootstrapClientFactory = async () => ({
      getRunnerBootstrapConfig: () =>
        Promise.resolve({ temporalAddress: "t:7233", temporalNamespace: "default" }),
    });

    const refreshed = await refreshRunnerAccessToken(
      { token: "cp", stigmerEndpoint: "https://api.stigmer.ai" },
      factory,
    );
    expect(refreshed).toBeUndefined();
  });

  it("returns undefined (not throw) when the refresh call fails", async () => {
    const factory: BootstrapClientFactory = async () => ({
      getRunnerBootstrapConfig: () => Promise.reject(new Error("network down")),
    });

    const refreshed = await refreshRunnerAccessToken(
      { token: "cp", stigmerEndpoint: "https://api.stigmer.ai" },
      factory,
    );
    expect(refreshed).toBeUndefined();
  });
});
