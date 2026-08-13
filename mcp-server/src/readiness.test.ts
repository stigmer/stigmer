// Unit tests for the cached readiness check (oss#316). The backend RPC is
// injected, so caching, in-flight dedupe, and verdict propagation are pinned
// without a live gRPC server; the /ready route's wiring (including the real
// checkBackendHealth against a dead backend) is covered by
// http.integration.test.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createReadinessCheck,
  READINESS_CACHE_TTL_MS,
  type ReadinessResult,
} from "./readiness";

const READY: ReadinessResult = { ready: true };
const UNREADY: ReadinessResult = { ready: false, reason: "backend health status: NOT_SERVING" };

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createReadinessCheck", () => {
  it("propagates the ready verdict", async () => {
    const check = createReadinessCheck("addr", async () => READY);
    await expect(check()).resolves.toEqual({ ready: true });
  });

  it("propagates the unready verdict with its reason", async () => {
    const check = createReadinessCheck("addr", async () => UNREADY);
    await expect(check()).resolves.toEqual(UNREADY);
  });

  it("serves cached verdicts within the TTL without re-dialing", async () => {
    const probe = vi.fn(async () => READY);
    const check = createReadinessCheck("addr", probe);
    await check();
    vi.advanceTimersByTime(READINESS_CACHE_TTL_MS - 1);
    await check();
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("re-checks after the TTL expires", async () => {
    const probe = vi.fn(async () => READY);
    const check = createReadinessCheck("addr", probe);
    await check();
    vi.advanceTimersByTime(READINESS_CACHE_TTL_MS + 1);
    await check();
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("recovers: an unready verdict is replaced by a ready one after the TTL", async () => {
    const probe = vi
      .fn<() => Promise<ReadinessResult>>()
      .mockResolvedValueOnce(UNREADY)
      .mockResolvedValueOnce(READY);
    const check = createReadinessCheck("addr", probe);
    await expect(check()).resolves.toEqual(UNREADY);
    vi.advanceTimersByTime(READINESS_CACHE_TTL_MS + 1);
    await expect(check()).resolves.toEqual({ ready: true });
  });

  it("shares one in-flight RPC across concurrent callers", async () => {
    let resolveProbe!: (r: ReadinessResult) => void;
    const probe = vi.fn(
      () => new Promise<ReadinessResult>((resolve) => (resolveProbe = resolve)),
    );
    const check = createReadinessCheck("addr", probe);

    const first = check();
    const second = check();
    resolveProbe(READY);

    await expect(first).resolves.toEqual({ ready: true });
    await expect(second).resolves.toEqual({ ready: true });
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("passes the configured backend address to the probe", async () => {
    const probe = vi.fn(async (addr: string) => {
      expect(addr).toBe("backend:50051");
      return READY;
    });
    await createReadinessCheck("backend:50051", probe)();
    expect(probe).toHaveBeenCalledWith("backend:50051");
  });
});
