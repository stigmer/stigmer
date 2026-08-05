import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  isRenewableSandboxToken,
  startSandboxTokenRenewal,
} from "../sandbox-token-renewal.js";
import type { SandboxTokenRenewal } from "../sandbox-token-renewal.js";

/** Build an unsigned JWT carrying exactly the claims under test. */
function fakeJwt(claims: Record<string, unknown>): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "RS256", typ: "JWT" })}.${b64(claims)}.fake-signature`;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/** A sandbox token issued now with the given lifetime. */
function sandboxToken(ttlSeconds: number, tokenType = "sandbox"): string {
  const iat = nowSeconds();
  return fakeJwt({ token_type: tokenType, iat, exp: iat + ttlSeconds });
}

describe("isRenewableSandboxToken", () => {
  it("accepts sandbox and workflow_sandbox tokens with an expiry", () => {
    expect(isRenewableSandboxToken(sandboxToken(3600))).toBe(true);
    expect(isRenewableSandboxToken(sandboxToken(3600, "workflow_sandbox"))).toBe(true);
  });

  it("rejects every non-sandbox credential class", () => {
    expect(isRenewableSandboxToken(sandboxToken(3600, "embedded_runner"))).toBe(false);
    expect(isRenewableSandboxToken(sandboxToken(3600, "pool_sandbox"))).toBe(false);
    expect(isRenewableSandboxToken(fakeJwt({ iat: 1, exp: 2 }))).toBe(false);
  });

  it("rejects a renewable class without an expiry (renew-before-expiry is undefined)", () => {
    expect(isRenewableSandboxToken(fakeJwt({ token_type: "sandbox" }))).toBe(false);
  });

  it("rejects absent and undecodable tokens", () => {
    expect(isRenewableSandboxToken(null)).toBe(false);
    expect(isRenewableSandboxToken(undefined)).toBe(false);
    expect(isRenewableSandboxToken("not-a-jwt")).toBe(false);
    expect(isRenewableSandboxToken("a.%%%.c")).toBe(false);
  });
});

describe("startSandboxTokenRenewal", () => {
  const silentLog = { log: vi.fn(), warn: vi.fn() };
  let handle: SandboxTokenRenewal | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    silentLog.log.mockClear();
    silentLog.warn.mockClear();
  });

  afterEach(() => {
    handle?.stop();
    handle = undefined;
    vi.useRealTimers();
  });

  it("renews at 80% of the issued lifetime and applies the fresh token", async () => {
    const initial = sandboxToken(1000);
    let current = initial;
    // Mint lazily so the renewed token's iat reflects the (fake) clock at
    // renewal time, exactly like the real server would stamp it.
    const renew = vi.fn().mockImplementation(
      async () => ({ token: sandboxToken(1000), expiresInSeconds: 1000 }),
    );
    const applyToken = vi.fn((t: string) => { current = t; });

    handle = startSandboxTokenRenewal({
      getToken: () => current, renew, applyToken, log: silentLog,
    });

    // Just before the 80% point: nothing has fired.
    await vi.advanceTimersByTimeAsync(790_000);
    expect(renew).not.toHaveBeenCalled();

    // Crossing 80% of the 1000s lifetime triggers the renewal.
    await vi.advanceTimersByTimeAsync(20_000);
    expect(renew).toHaveBeenCalledWith(initial);
    expect(applyToken).toHaveBeenCalledTimes(1);
    expect(current).not.toBe(initial);

    // The next renewal is scheduled from the FRESH token's own lifetime:
    // nothing re-fires within the first half of it.
    renew.mockClear();
    await vi.advanceTimersByTimeAsync(400_000);
    expect(renew).not.toHaveBeenCalled();
  });

  it("parks on a non-renewable credential and picks up a renewable swap (pool claim)", async () => {
    let current = sandboxToken(86_400, "pool_sandbox");
    const renew = vi.fn().mockResolvedValue({ token: sandboxToken(1000) });
    const applyToken = vi.fn();

    handle = startSandboxTokenRenewal({
      getToken: () => current, renew, applyToken, log: silentLog,
    });

    // Parked: rechecks but never renews the pool credential.
    await vi.advanceTimersByTimeAsync(300_000);
    expect(renew).not.toHaveBeenCalled();

    // The claim swaps in a session token (attach-session's updateToken).
    current = sandboxToken(1000);

    // Next recheck sees the renewable class and schedules from its lifetime.
    await vi.advanceTimersByTimeAsync(60_000 + 800_000);
    expect(renew).toHaveBeenCalled();
  });

  it("retries a failed renewal and succeeds on a later attempt", async () => {
    const initial = sandboxToken(100);
    const renewed = sandboxToken(1000);
    let current = initial;
    const renew = vi.fn()
      .mockRejectedValueOnce(new Error("control plane unreachable"))
      .mockResolvedValueOnce(undefined) // server minted nothing
      .mockResolvedValue({ token: renewed });
    const applyToken = vi.fn((t: string) => { current = t; });

    handle = startSandboxTokenRenewal({
      getToken: () => current, renew, applyToken, log: silentLog,
    });

    // 80% of 100s is past MIN_DELAY, first attempt at ~80s, then two 60s retries.
    await vi.advanceTimersByTimeAsync(80_000 + 60_000 + 60_000 + 5_000);
    expect(renew).toHaveBeenCalledTimes(3);
    expect(applyToken).toHaveBeenCalledWith(renewed);
  });

  it("attempts immediately when the pod boots with a token already past its renewal point", async () => {
    // Issued 900s ago with a 1000s lifetime: 80% point long past.
    const iat = nowSeconds() - 900;
    const stale = fakeJwt({ token_type: "sandbox", iat, exp: iat + 1000 });
    const renew = vi.fn().mockResolvedValue({ token: sandboxToken(1000) });

    handle = startSandboxTokenRenewal({
      getToken: () => stale, renew, applyToken: vi.fn(), log: silentLog,
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(renew).toHaveBeenCalledWith(stale);
  });

  it("stop() cancels the loop", async () => {
    const renew = vi.fn().mockResolvedValue({ token: sandboxToken(1000) });

    handle = startSandboxTokenRenewal({
      getToken: () => sandboxToken(100), renew, applyToken: vi.fn(), log: silentLog,
    });
    handle.stop();

    await vi.advanceTimersByTimeAsync(600_000);
    expect(renew).not.toHaveBeenCalled();
  });

  it("parks (never spins) on a renewable-class token without an expiry", async () => {
    const renew = vi.fn();

    handle = startSandboxTokenRenewal({
      getToken: () => fakeJwt({ token_type: "sandbox" }),
      renew, applyToken: vi.fn(), log: silentLog,
    });

    await vi.advanceTimersByTimeAsync(300_000);
    expect(renew).not.toHaveBeenCalled();
    expect(silentLog.warn).toHaveBeenCalled();
  });
});
