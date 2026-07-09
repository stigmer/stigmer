import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { create } from "@bufbuild/protobuf";
import { MintGuestTokenResponseSchema } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/token_pb";
import { ConnectError, Code } from "@connectrpc/connect";

// Intercept the token client so no transport is exercised. The mock
// preserves the real module (create/Code/ConnectError) and only stubs
// createClient, which GuestAuth uses to build its RPC client.
const mintGuestToken = vi.fn();
vi.mock("@connectrpc/connect", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@connectrpc/connect")>();
  return {
    ...actual,
    createClient: () => ({ mintGuestToken }),
  };
});

import { createGuestAuth, GuestAuth, type GuestIdStorage } from "../guest-auth";

const CONFIG = {
  baseUrl: "https://api.stigmer.ai",
  org: "acme",
  slug: "support-agent",
};

function createMemoryStorage(): GuestIdStorage & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
  };
}

function mintResponse(overrides?: {
  accessToken?: string;
  expiresIn?: number;
  guestCookieId?: string;
}) {
  return create(MintGuestTokenResponseSchema, {
    accessToken: overrides?.accessToken ?? "guest-jwt-1",
    tokenType: "Bearer",
    expiresIn: overrides?.expiresIn ?? 900,
    guestCookieId: overrides?.guestCookieId ?? "cookie-abc",
  });
}

beforeEach(() => {
  mintGuestToken.mockReset();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createGuestAuth", () => {
  it("throws when baseUrl is missing", () => {
    expect(() =>
      createGuestAuth({ ...CONFIG, baseUrl: "" }),
    ).toThrow("baseUrl is required");
  });

  it("throws when org is missing", () => {
    expect(() => createGuestAuth({ ...CONFIG, org: "" })).toThrow(
      "org is required",
    );
  });

  it("throws when slug is missing", () => {
    expect(() => createGuestAuth({ ...CONFIG, slug: "" })).toThrow(
      "slug is required",
    );
  });

  it("returns a GuestAuth instance with valid config", () => {
    expect(createGuestAuth(CONFIG)).toBeInstanceOf(GuestAuth);
  });
});

describe("GuestAuth.getAccessToken", () => {
  it("mints on first call and sends an empty guest id", async () => {
    mintGuestToken.mockResolvedValue(mintResponse());
    const auth = createGuestAuth({ ...CONFIG, storage: createMemoryStorage() });

    const token = await auth.getAccessToken();

    expect(token).toBe("guest-jwt-1");
    expect(mintGuestToken).toHaveBeenCalledTimes(1);
    expect(mintGuestToken.mock.calls[0][0]).toMatchObject({
      org: "acme",
      slug: "support-agent",
      guestCookieId: "",
    });
  });

  it("persists the server-issued guest id and presents it on re-mint", async () => {
    const storage = createMemoryStorage();
    mintGuestToken.mockResolvedValue(mintResponse({ guestCookieId: "cookie-abc" }));
    const auth = createGuestAuth({ ...CONFIG, storage });

    await auth.getAccessToken();
    expect(storage.store.get("stigmer:guest-id:acme")).toBe("cookie-abc");
    expect(auth.guestCookieId).toBe("cookie-abc");

    // Expire the cached token, forcing a second mint.
    vi.advanceTimersByTime(900_000);
    await auth.getAccessToken();

    expect(mintGuestToken).toHaveBeenCalledTimes(2);
    expect(mintGuestToken.mock.calls[1][0]).toMatchObject({
      guestCookieId: "cookie-abc",
    });
  });

  it("restores a persisted guest id from a prior visit", async () => {
    const storage = createMemoryStorage();
    storage.setItem("stigmer:guest-id:acme", "cookie-from-last-visit");
    mintGuestToken.mockResolvedValue(mintResponse());
    const auth = createGuestAuth({ ...CONFIG, storage });

    await auth.getAccessToken();

    expect(mintGuestToken.mock.calls[0][0]).toMatchObject({
      guestCookieId: "cookie-from-last-visit",
    });
  });

  it("returns the cached token while it is fresh", async () => {
    mintGuestToken.mockResolvedValue(mintResponse());
    const auth = createGuestAuth({ ...CONFIG, storage: createMemoryStorage() });

    await auth.getAccessToken();
    // 13 minutes into a 15-minute token: still beyond the 60s skew.
    vi.advanceTimersByTime(13 * 60_000);
    const token = await auth.getAccessToken();

    expect(token).toBe("guest-jwt-1");
    expect(mintGuestToken).toHaveBeenCalledTimes(1);
  });

  it("re-mints when the cached token is within the expiry skew", async () => {
    mintGuestToken
      .mockResolvedValueOnce(mintResponse({ accessToken: "guest-jwt-1" }))
      .mockResolvedValueOnce(mintResponse({ accessToken: "guest-jwt-2" }));
    const auth = createGuestAuth({ ...CONFIG, storage: createMemoryStorage() });

    await auth.getAccessToken();
    // 30 seconds of life left — inside the 60s skew window.
    vi.advanceTimersByTime(900_000 - 30_000);
    const token = await auth.getAccessToken();

    expect(token).toBe("guest-jwt-2");
    expect(mintGuestToken).toHaveBeenCalledTimes(2);
  });

  it("collapses concurrent callers into a single mint", async () => {
    let release!: (value: ReturnType<typeof mintResponse>) => void;
    mintGuestToken.mockImplementation(
      () => new Promise((resolve) => { release = resolve; }),
    );
    const auth = createGuestAuth({ ...CONFIG, storage: createMemoryStorage() });

    const first = auth.getAccessToken();
    const second = auth.getAccessToken();
    release(mintResponse());

    await expect(first).resolves.toBe("guest-jwt-1");
    await expect(second).resolves.toBe("guest-jwt-1");
    expect(mintGuestToken).toHaveBeenCalledTimes(1);
  });

  it("rejects with a wrapped StigmerError when sharing is revoked", async () => {
    mintGuestToken.mockRejectedValue(
      new ConnectError("agent not found", Code.NotFound),
    );
    const auth = createGuestAuth({ ...CONFIG, storage: createMemoryStorage() });

    try {
      await auth.getAccessToken();
      expect.fail("should have thrown");
    } catch (e: unknown) {
      expect(e).toHaveProperty("name", "StigmerError");
      expect(e).toHaveProperty("code", "not-found");
    }
  });

  it("recovers after a failed mint instead of caching the failure", async () => {
    mintGuestToken
      .mockRejectedValueOnce(new ConnectError("unavailable", Code.Unavailable))
      .mockResolvedValueOnce(mintResponse());
    const auth = createGuestAuth({ ...CONFIG, storage: createMemoryStorage() });

    await expect(auth.getAccessToken()).rejects.toMatchObject({
      code: "unavailable",
    });
    await expect(auth.getAccessToken()).resolves.toBe("guest-jwt-1");
    expect(mintGuestToken).toHaveBeenCalledTimes(2);
  });

  it("still mints when storage throws", async () => {
    const brokenStorage: GuestIdStorage = {
      getItem: () => {
        throw new Error("storage disabled");
      },
      setItem: () => {
        throw new Error("storage disabled");
      },
    };
    mintGuestToken.mockResolvedValue(mintResponse());
    const auth = createGuestAuth({ ...CONFIG, storage: brokenStorage });

    await expect(auth.getAccessToken()).resolves.toBe("guest-jwt-1");
    expect(auth.guestCookieId).toBeNull();
  });
});
