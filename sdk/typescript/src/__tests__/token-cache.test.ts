// createTokenCache: a signed-in embed's token is fetched once and reused
// until a minute before it expires; a burst shares one fetch; a failure,
// a signed-out answer and a sign-out are never served from the cache.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTokenCache, type FetchedToken } from "../token-cache";

const NOW = Date.parse("2026-10-30T12:00:00Z");
const IN_15_MIN = NOW + 15 * 60_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

function token(accessToken: string, expiresAt: FetchedToken["expiresAt"] = IN_15_MIN): FetchedToken {
  return { accessToken, expiresAt };
}

describe("createTokenCache", () => {
  it("fetches once and serves the cached token while it is fresh", async () => {
    const fetchToken = vi.fn().mockResolvedValue(token("jwt-1"));
    const tokens = createTokenCache(fetchToken);

    await expect(tokens.getAccessToken()).resolves.toBe("jwt-1");
    vi.setSystemTime(NOW + 13 * 60_000);
    await expect(tokens.getAccessToken()).resolves.toBe("jwt-1");
    expect(fetchToken).toHaveBeenCalledTimes(1);
  });

  it("fetches again once the token is within a minute of expiry", async () => {
    const fetchToken = vi
      .fn()
      .mockResolvedValueOnce(token("jwt-1"))
      .mockResolvedValueOnce(token("jwt-2", IN_15_MIN + 15 * 60_000));
    const tokens = createTokenCache(fetchToken);

    await tokens.getAccessToken();
    vi.setSystemTime(IN_15_MIN - 60_000);
    await expect(tokens.getAccessToken()).resolves.toBe("jwt-2");
    expect(fetchToken).toHaveBeenCalledTimes(2);
  });

  it("serves a token with a minute and a millisecond left from the cache", async () => {
    const fetchToken = vi.fn().mockResolvedValue(token("jwt-1"));
    const tokens = createTokenCache(fetchToken);

    await tokens.getAccessToken();
    vi.setSystemTime(IN_15_MIN - 60_001);
    await tokens.getAccessToken();
    expect(fetchToken).toHaveBeenCalledTimes(1);
  });

  it("reads expiresAt as a Date, an ISO string or epoch milliseconds", async () => {
    for (const expiresAt of [new Date(IN_15_MIN), new Date(IN_15_MIN).toISOString(), IN_15_MIN]) {
      const fetchToken = vi.fn().mockResolvedValue(token("jwt-1", expiresAt));
      const tokens = createTokenCache(fetchToken);
      await tokens.getAccessToken();
      await tokens.getAccessToken();
      expect(fetchToken).toHaveBeenCalledTimes(1);
    }
  });

  it("refuses an expiresAt that is not a date, naming the shapes it takes", async () => {
    const tokens = createTokenCache(async () => token("jwt-1", "soon"));

    await expect(tokens.getAccessToken()).rejects.toThrow(
      "createTokenCache: the fetched token's expiresAt (soon) is not a date; return a Date, an ISO 8601 string or epoch milliseconds",
    );
  });

  it("collapses concurrent callers into one fetch", async () => {
    let release!: (value: FetchedToken) => void;
    const fetchToken = vi.fn(
      () => new Promise<FetchedToken>((resolve) => { release = resolve; }),
    );
    const tokens = createTokenCache(fetchToken);

    const first = tokens.getAccessToken();
    const second = tokens.getAccessToken();
    release(token("jwt-1"));

    await expect(first).resolves.toBe("jwt-1");
    await expect(second).resolves.toBe("jwt-1");
    expect(fetchToken).toHaveBeenCalledTimes(1);
  });

  it("fetches again after a failed fetch instead of caching the failure", async () => {
    const fetchToken = vi
      .fn()
      .mockRejectedValueOnce(new Error("backend down"))
      .mockResolvedValueOnce(token("jwt-1"));
    const tokens = createTokenCache(fetchToken);

    await expect(tokens.getAccessToken()).rejects.toThrow("backend down");
    await expect(tokens.getAccessToken()).resolves.toBe("jwt-1");
    expect(fetchToken).toHaveBeenCalledTimes(2);
  });

  it("sends no token while nobody is signed in, and asks again next time", async () => {
    const fetchToken = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(token("jwt-1"));
    const tokens = createTokenCache(fetchToken);

    await expect(tokens.getAccessToken()).resolves.toBeNull();
    await expect(tokens.getAccessToken()).resolves.toBe("jwt-1");
  });

  it("fetches a new token after invalidate, so a signed-out person's token is not sent", async () => {
    const fetchToken = vi
      .fn()
      .mockResolvedValueOnce(token("dana-jwt"))
      .mockResolvedValueOnce(token("lee-jwt"));
    const tokens = createTokenCache(fetchToken);

    await tokens.getAccessToken();
    tokens.invalidate();
    await expect(tokens.getAccessToken()).resolves.toBe("lee-jwt");
  });

  it("keeps no token from a fetch that was in flight when invalidate was called", async () => {
    const releases: Array<(value: FetchedToken) => void> = [];
    const fetchToken = vi.fn(
      () => new Promise<FetchedToken>((resolve) => { releases.push(resolve); }),
    );
    const tokens = createTokenCache(fetchToken);

    const before = tokens.getAccessToken();
    tokens.invalidate();
    const after = tokens.getAccessToken();
    releases[0]!(token("dana-jwt"));
    releases[1]!(token("lee-jwt"));

    await expect(before).resolves.toBe("dana-jwt");
    await expect(after).resolves.toBe("lee-jwt");
    await expect(tokens.getAccessToken()).resolves.toBe("lee-jwt");
    expect(fetchToken).toHaveBeenCalledTimes(2);
  });

  it("keeps the newer fetch shared when an older one settles after invalidate", async () => {
    const releases: Array<(value: FetchedToken) => void> = [];
    const fetchToken = vi.fn(
      () => new Promise<FetchedToken>((resolve) => { releases.push(resolve); }),
    );
    const tokens = createTokenCache(fetchToken);

    const before = tokens.getAccessToken();
    tokens.invalidate();
    const after = tokens.getAccessToken();
    releases[0]!(token("dana-jwt"));
    await before;
    const joined = tokens.getAccessToken();
    releases[1]!(token("lee-jwt"));

    await expect(after).resolves.toBe("lee-jwt");
    await expect(joined).resolves.toBe("lee-jwt");
    expect(fetchToken).toHaveBeenCalledTimes(2);
  });

  it("keeps the newer person's token when the older fetch settles last", async () => {
    const releases: Array<(value: FetchedToken) => void> = [];
    const fetchToken = vi.fn(
      () => new Promise<FetchedToken>((resolve) => { releases.push(resolve); }),
    );
    const tokens = createTokenCache(fetchToken);

    const before = tokens.getAccessToken();
    tokens.invalidate();
    const after = tokens.getAccessToken();
    releases[1]!(token("lee-jwt"));
    await after;
    releases[0]!(token("dana-jwt"));
    await before;

    await expect(tokens.getAccessToken()).resolves.toBe("lee-jwt");
    expect(fetchToken).toHaveBeenCalledTimes(2);
  });
});
