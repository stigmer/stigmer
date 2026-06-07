import { describe, it, expect, vi } from "vitest";
import { resolveTemporalCoordinates } from "../bootstrap.js";
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

describe("resolveTemporalCoordinates", () => {
  it("uses an explicit address verbatim and never discovers", async () => {
    const coords = await resolveTemporalCoordinates(
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
    const coords = await resolveTemporalCoordinates(
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

    const coords = await resolveTemporalCoordinates(
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

    const coords = await resolveTemporalCoordinates(
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
      resolveTemporalCoordinates(
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
      resolveTemporalCoordinates(
        { token: "tok", stigmerEndpoint: "https://api.stigmer.ai" },
        factory,
      ),
    ).rejects.toThrow(/empty Temporal address/);
  });

  it("treats a whitespace-only explicit address as unset and discovers", async () => {
    const getRunnerBootstrapConfig = vi
      .fn()
      .mockResolvedValue({ temporalAddress: "t:7233", temporalNamespace: "default" });

    const coords = await resolveTemporalCoordinates(
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
});
