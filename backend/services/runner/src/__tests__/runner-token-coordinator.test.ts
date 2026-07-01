import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRunnerTokenCoordinator } from "../runner-token-coordinator.js";
import type { RefreshedRunnerToken } from "../bootstrap.js";

/**
 * Unit tests for the runner's two-writer token model.
 *
 * The load-bearing guarantee here is the anti-staleness regression: once the
 * runner mints its own proxy token, a control-plane token push must NOT clobber
 * it (the bug fixed in stigmer-cloud _changelog 2026-05-26 / 2026-06-01 was the
 * inverse — the proxy token froze and never refreshed). These tests pin both
 * directions of that invariant.
 */

const silentLog = { log: vi.fn(), warn: vi.fn() };

describe("createRunnerTokenCoordinator", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    silentLog.log.mockClear();
    silentLog.warn.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("pre-mint (lockstep preserved)", () => {
    it("applies a control-plane token to the proxy sink when nothing is minted", () => {
      const applyProxyToken = vi.fn();
      const coordinator = createRunnerTokenCoordinator({
        applyProxyToken,
        reMint: vi.fn(),
        log: silentLog,
      });

      coordinator.onControlPlaneTokenChanged("cp_token");

      expect(coordinator.isProxyTokenMinted()).toBe(false);
      expect(applyProxyToken).toHaveBeenCalledWith("cp_token");
    });

    it("ignores a null control-plane token (logout) without touching the proxy sink", () => {
      const applyProxyToken = vi.fn();
      const coordinator = createRunnerTokenCoordinator({
        applyProxyToken,
        reMint: vi.fn(),
        log: silentLog,
      });

      coordinator.onControlPlaneTokenChanged(null);

      expect(applyProxyToken).not.toHaveBeenCalled();
    });
  });

  describe("after minting", () => {
    it("applies the minted token and marks the proxy token as minted", () => {
      const applyProxyToken = vi.fn();
      const coordinator = createRunnerTokenCoordinator({
        applyProxyToken,
        reMint: vi.fn(),
        log: silentLog,
      });

      coordinator.adoptMintedToken("rt_minted", 14400);

      expect(coordinator.isProxyTokenMinted()).toBe(true);
      expect(applyProxyToken).toHaveBeenCalledWith("rt_minted");
    });

    it("ANTI-STALENESS: a control-plane push must NOT clobber the minted proxy token", () => {
      const applyProxyToken = vi.fn();
      const coordinator = createRunnerTokenCoordinator({
        applyProxyToken,
        reMint: vi.fn(),
        log: silentLog,
      });

      coordinator.adoptMintedToken("rt_minted", 14400);
      applyProxyToken.mockClear();

      // The desktop rotates its Auth0 token and pushes it as the control-plane
      // credential. The proxy interceptors must keep the minted token.
      coordinator.onControlPlaneTokenChanged("auth0_rotated");

      expect(applyProxyToken).not.toHaveBeenCalled();
    });
  });

  describe("refresh timer", () => {
    it("re-mints from the control-plane token before expiry and reschedules", async () => {
      const applyProxyToken = vi.fn();
      const reMint = vi
        .fn<() => Promise<RefreshedRunnerToken | undefined>>()
        .mockResolvedValueOnce({ token: "rt_v2", expiresInSeconds: 100 })
        .mockResolvedValueOnce({ token: "rt_v3", expiresInSeconds: 100 });

      const coordinator = createRunnerTokenCoordinator({
        applyProxyToken,
        reMint,
        log: silentLog,
      });

      // ttl=100s → refresh at 0.8 * 100s = 80s.
      coordinator.adoptMintedToken("rt_v1", 100);
      applyProxyToken.mockClear();

      await vi.advanceTimersByTimeAsync(80_000);
      expect(reMint).toHaveBeenCalledTimes(1);
      expect(applyProxyToken).toHaveBeenCalledWith("rt_v2");

      // It rescheduled; the next refresh re-mints again.
      await vi.advanceTimersByTimeAsync(80_000);
      expect(reMint).toHaveBeenCalledTimes(2);
      expect(applyProxyToken).toHaveBeenCalledWith("rt_v3");

      coordinator.stop();
    });

    it("retries (without clobbering) when a re-mint fails, then recovers", async () => {
      const applyProxyToken = vi.fn();
      const reMint = vi
        .fn<() => Promise<RefreshedRunnerToken | undefined>>()
        .mockResolvedValueOnce(undefined) // first refresh fails to mint
        .mockResolvedValueOnce({ token: "rt_recovered", expiresInSeconds: 100 });

      const coordinator = createRunnerTokenCoordinator({
        applyProxyToken,
        reMint,
        log: silentLog,
      });

      coordinator.adoptMintedToken("rt_v1", 100);
      applyProxyToken.mockClear();

      // First scheduled refresh (at 80s) returns undefined → no new proxy token,
      // schedules a retry at 0.8 * 60s = 48s.
      await vi.advanceTimersByTimeAsync(80_000);
      expect(reMint).toHaveBeenCalledTimes(1);
      expect(applyProxyToken).not.toHaveBeenCalled();

      // Retry succeeds and recovers the proxy token.
      await vi.advanceTimersByTimeAsync(48_000);
      expect(reMint).toHaveBeenCalledTimes(2);
      expect(applyProxyToken).toHaveBeenCalledWith("rt_recovered");

      coordinator.stop();
    });

    it("stop() cancels the refresh timer", async () => {
      const reMint = vi.fn<() => Promise<RefreshedRunnerToken | undefined>>();
      const coordinator = createRunnerTokenCoordinator({
        applyProxyToken: vi.fn(),
        reMint,
        log: silentLog,
      });

      coordinator.adoptMintedToken("rt_v1", 100);
      coordinator.stop();

      await vi.advanceTimersByTimeAsync(200_000);
      expect(reMint).not.toHaveBeenCalled();
    });
  });
});
