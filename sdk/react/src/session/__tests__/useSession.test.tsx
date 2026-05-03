import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import {
  SessionSchema,
  type Session,
} from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import type { Stigmer } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { FetchCache } from "../../internal/fetch-cache";
import { useSession } from "../useSession";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSession(id: string): Session {
  const session = create(SessionSchema);
  const metadata = create(ApiResourceMetadataSchema);
  metadata.id = id;
  session.metadata = metadata;
  return session;
}

function createMockStigmer(sessionGet: ReturnType<typeof vi.fn>): Stigmer {
  return {
    session: { get: sessionGet },
  } as unknown as Stigmer;
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

/**
 * Wrapper that provides both the Stigmer client and a shared FetchCache
 * instance via context. Sharing the cache instance across renderHook
 * calls mirrors the production layout where FetchCacheProvider sits
 * above the key-based remount boundary.
 */
function createWrapper(client: Stigmer, cache: FetchCache) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <FetchCacheContext.Provider value={cache}>
        <StigmerContext.Provider value={client}>
          {children}
        </StigmerContext.Provider>
      </FetchCacheContext.Provider>
    );
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useSession — cache behavior", () => {
  it("first visit shows loading then resolves data", async () => {
    const session = makeSession("ses_1");
    const sessionGet = vi.fn().mockResolvedValue(session);
    const cache = new FetchCache();
    const wrapper = createWrapper(createMockStigmer(sessionGet), cache);

    const { result } = renderHook(() => useSession("ses_1"), { wrapper });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.session).toBeNull();

    await flush();

    expect(result.current.isLoading).toBe(false);
    expect(result.current.session).toBe(session);
    expect(sessionGet).toHaveBeenCalledOnce();
  });

  it("remount serves cached data instantly (no isLoading)", async () => {
    const session1 = makeSession("ses_1");
    const sessionGet = vi.fn().mockResolvedValue(session1);
    const client = createMockStigmer(sessionGet);
    const cache = new FetchCache();
    const wrapper = createWrapper(client, cache);

    // First mount — populates the cache.
    const { result: r1, unmount } = renderHook(
      () => useSession("ses_1"),
      { wrapper },
    );
    await flush();
    expect(r1.current.session).toBe(session1);
    unmount();

    // Second mount (simulates remount after key={activeSessionId} change).
    const freshSession = makeSession("ses_1");
    sessionGet.mockResolvedValue(freshSession);

    const { result: r2 } = renderHook(
      () => useSession("ses_1"),
      { wrapper },
    );

    // Cached data is served synchronously — no loading skeleton.
    expect(r2.current.isLoading).toBe(false);
    expect(r2.current.session).toBe(session1);
    expect(r2.current.isRefetching).toBe(true);

    // Background fetch completes with fresh data.
    await flush();
    expect(r2.current.session).toBe(freshSession);
    expect(r2.current.isRefetching).toBe(false);
  });

  it("different session IDs have independent cache entries", async () => {
    const sessionA = makeSession("ses_A");
    const sessionB = makeSession("ses_B");
    const sessionGet = vi.fn()
      .mockResolvedValueOnce(sessionA)
      .mockResolvedValueOnce(sessionB)
      .mockResolvedValue(sessionA);
    const cache = new FetchCache();
    const wrapper = createWrapper(createMockStigmer(sessionGet), cache);

    // Mount session A.
    const { unmount: unmountA } = renderHook(
      () => useSession("ses_A"),
      { wrapper },
    );
    await flush();
    unmountA();

    // Mount session B.
    const { unmount: unmountB } = renderHook(
      () => useSession("ses_B"),
      { wrapper },
    );
    await flush();
    unmountB();

    // Remount session A — should get A's cached data, not B's.
    const { result } = renderHook(
      () => useSession("ses_A"),
      { wrapper },
    );

    expect(result.current.isLoading).toBe(false);
    expect(result.current.session?.metadata?.id).toBe("ses_A");
  });

  it("works without FetchCacheProvider (standard loading flow)", async () => {
    const session = makeSession("ses_1");
    const sessionGet = vi.fn().mockResolvedValue(session);
    const client = createMockStigmer(sessionGet);

    function NoCacheWrapper({ children }: { children: ReactNode }) {
      return (
        <StigmerContext.Provider value={client}>
          {children}
        </StigmerContext.Provider>
      );
    }

    const { result } = renderHook(() => useSession("ses_1"), {
      wrapper: NoCacheWrapper,
    });

    expect(result.current.isLoading).toBe(true);
    await flush();
    expect(result.current.session).toBe(session);
  });

  it("null id skips fetching and caching", async () => {
    const sessionGet = vi.fn();
    const cache = new FetchCache();
    const wrapper = createWrapper(createMockStigmer(sessionGet), cache);

    const { result } = renderHook(() => useSession(null), { wrapper });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.session).toBeNull();
    expect(sessionGet).not.toHaveBeenCalled();
    expect(cache.size).toBe(0);
  });
});
