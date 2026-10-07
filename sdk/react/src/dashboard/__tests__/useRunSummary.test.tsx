/**
 * useRunSummary asks the run service for one organization's
 * summary over the last seven days unless told another window, and asks
 * nothing when no organization is selected.
 */
import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { RunSummaryTimeWindow, useRunSummary } from "../useRunSummary";

function wrapper(client: unknown) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <FetchCacheContext.Provider value={null}>
        <StigmerContext.Provider value={client as never}>{children}</StigmerContext.Provider>
      </FetchCacheContext.Provider>
    );
  };
}

describe("useRunSummary", () => {
  it("fetches the organization's summary over the last seven days by default", async () => {
    const summary = { activeCount: 2 };
    const getRunSummary = vi.fn().mockResolvedValue(summary);
    const { result } = renderHook(() => useRunSummary({ org: "acme" }), {
      wrapper: wrapper({ run: { getRunSummary } }),
    });

    await waitFor(() => expect(result.current.summary).toBe(summary));
    expect(getRunSummary.mock.calls[0]![0]).toMatchObject({
      org: "acme",
      timeWindow: RunSummaryTimeWindow.LAST_7D,
    });
    expect(result.current.error).toBeNull();
  });

  it("passes the caller's time window", async () => {
    const getRunSummary = vi.fn().mockResolvedValue({});
    renderHook(
      () => useRunSummary({ org: "acme", timeWindow: RunSummaryTimeWindow.LAST_30D }),
      { wrapper: wrapper({ run: { getRunSummary } }) },
    );
    await waitFor(() => expect(getRunSummary).toHaveBeenCalledOnce());
    expect(getRunSummary.mock.calls[0]![0]).toMatchObject({ timeWindow: RunSummaryTimeWindow.LAST_30D });
  });

  it("fetches nothing without an organization", () => {
    const getRunSummary = vi.fn();
    const { result } = renderHook(() => useRunSummary({ org: null }), {
      wrapper: wrapper({ run: { getRunSummary } }),
    });
    expect(getRunSummary).not.toHaveBeenCalled();
    expect(result.current.summary).toBeNull();
  });
});
