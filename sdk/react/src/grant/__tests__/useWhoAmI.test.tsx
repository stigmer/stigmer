/**
 * useWhoAmI's `enabled` switch. Pinned: a held hook makes no request and
 * answers nothing, not loading; switched on, it says it is loading from its
 * first render until the answer lands, then gives the account; switched off
 * again, it answers nothing rather than the account it had; switched back
 * on, it gives that account again without a second request. A failed read
 * is its error, not loading, and switching the hook off and on again asks
 * once more, loading until the new answer lands.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Stigmer } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { useWhoAmI } from "../useWhoAmI";

afterEach(cleanup);

function clientAnswering(whoAmI: ReturnType<typeof vi.fn>): Stigmer {
  return { identityAccount: { whoAmI } } as unknown as Stigmer;
}

function wrapper(stigmer: Stigmer) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <StigmerContext.Provider value={stigmer}>{children}</StigmerContext.Provider>;
  };
}

describe("useWhoAmI — enabled", () => {
  it("holds, loads, answers, forgets and answers again as it is switched", async () => {
    let answer = (_: unknown): void => undefined;
    const whoAmI = vi.fn(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    const { result, rerender } = renderHook(({ enabled }: { enabled: boolean }) => useWhoAmI({ enabled }), {
      wrapper: wrapper(clientAnswering(whoAmI)),
      initialProps: { enabled: false },
    });
    expect(result.current).toEqual({ account: null, isLoading: false, error: null });
    expect(whoAmI).not.toHaveBeenCalled();

    rerender({ enabled: true });
    expect(result.current.isLoading).toBe(true);
    expect(whoAmI).toHaveBeenCalledTimes(1);
    answer({ metadata: { id: "ida_1" } });
    await waitFor(() => expect(result.current.account?.metadata?.id).toBe("ida_1"));
    expect(result.current.isLoading).toBe(false);

    rerender({ enabled: false });
    expect(result.current).toEqual({ account: null, isLoading: false, error: null });

    rerender({ enabled: true });
    expect(result.current.account?.metadata?.id).toBe("ida_1");
    expect(whoAmI).toHaveBeenCalledTimes(1);
  });

  it("gives a failed read as its error, not loading, and asks again when switched back on", async () => {
    const whoAmI = vi
      .fn()
      .mockRejectedValueOnce(new Error("no identity"))
      .mockResolvedValueOnce({ metadata: { id: "ida_2" } });
    const { result, rerender } = renderHook(({ enabled }: { enabled: boolean }) => useWhoAmI({ enabled }), {
      wrapper: wrapper(clientAnswering(whoAmI)),
      initialProps: { enabled: true },
    });
    await waitFor(() => expect(result.current.error?.message).toBe("no identity"));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.account).toBeNull();

    rerender({ enabled: false });
    rerender({ enabled: true });
    await waitFor(() => expect(result.current.account?.metadata?.id).toBe("ida_2"));
    expect(result.current.error).toBeNull();
    expect(whoAmI).toHaveBeenCalledTimes(2);
  });
});
