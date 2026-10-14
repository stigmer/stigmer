/**
 * Pins the quality hooks: both ask for the active organization by id, the
 * agent and the window, and ask nothing for an empty agent id; the report
 * keeps a refusal as its error with the server's message; the flagged list
 * reads one page, appends the next on loadMore by its token, keeps going
 * past an empty page that carries a token, stops when no token comes back,
 * keeps a failed further page as its own error, and drops the appended
 * pages when the window changes.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { Code } from "@connectrpc/connect";
import { StigmerError } from "@stigmer/sdk";
import { ACME_ID, orgWrapper } from "../../organization/__tests__/org-fixture";
import { FLAGGED_PAGE_SIZE, useFlaggedRuns } from "../useFlaggedRuns";
import { useAgentQualityReport } from "../useAgentQualityReport";
import { flaggedScore, qualityReport } from "./quality-fixture";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useAgentQualityReport", () => {
  it("asks for the active organization, the agent and the window", async () => {
    const getAgentQualityReport = vi.fn(async () => qualityReport());
    const { result } = renderHook(() => useAgentQualityReport("agt_1", 7), {
      wrapper: orgWrapper({ score: { getAgentQualityReport } }),
    });
    await waitFor(() => expect(result.current.report).not.toBeNull());
    expect(getAgentQualityReport).toHaveBeenCalledWith(
      expect.objectContaining({ org: ACME_ID, agentId: "agt_1", days: 7 }),
    );
  });

  it("asks nothing for an empty agent id", async () => {
    const getAgentQualityReport = vi.fn(async () => qualityReport());
    const { result } = renderHook(() => useAgentQualityReport("", 30), {
      wrapper: orgWrapper({ score: { getAgentQualityReport } }),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(getAgentQualityReport).not.toHaveBeenCalled();
    expect(result.current.report).toBeNull();
  });

  it("keeps a refusal with the server's message", async () => {
    const getAgentQualityReport = vi.fn(async () => {
      throw new StigmerError(
        "failed-precondition",
        "too many grades to count at once: pick fewer days",
        Code.FailedPrecondition,
      );
    });
    const { result } = renderHook(() => useAgentQualityReport("agt_1", 90), {
      wrapper: orgWrapper({ score: { getAgentQualityReport } }),
    });
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error?.message).toBe("too many grades to count at once: pick fewer days");
  });
});

describe("useFlaggedRuns", () => {
  function pages() {
    return vi.fn(async (input: { pageToken: string }) => {
      switch (input.pageToken) {
        case "":
          return { entries: [flaggedScore("s1", "judge", "run_1", ["task"])], nextPageToken: "t1" };
        case "t1":
          return { entries: [], nextPageToken: "t2" };
        case "t2":
          return { entries: [flaggedScore("s2", "feedback", "run_2")], nextPageToken: "" };
        default:
          throw new Error(`unexpected token ${input.pageToken}`);
      }
    });
  }

  it("reads a page at a time, past an empty page that carries a token", async () => {
    const listFlaggedByAgent = pages();
    const { result } = renderHook(() => useFlaggedRuns("agt_1", 30), {
      wrapper: orgWrapper({ score: { listFlaggedByAgent } }),
    });
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(listFlaggedByAgent).toHaveBeenCalledWith(
      expect.objectContaining({ org: ACME_ID, agentId: "agt_1", days: 30, pageSize: FLAGGED_PAGE_SIZE, pageToken: "" }),
    );
    expect(result.current.hasMore).toBe(true);

    act(() => result.current.loadMore());
    await waitFor(() => expect(listFlaggedByAgent).toHaveBeenCalledWith(expect.objectContaining({ pageToken: "t1" })));
    await waitFor(() => expect(result.current.isLoadingMore).toBe(false));
    expect(result.current.items).toHaveLength(1);
    expect(result.current.hasMore, "an empty page with a token is not the end").toBe(true);

    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    expect(result.current.items.map((score) => score.metadata?.id)).toEqual(["s1", "s2"]);
    expect(result.current.hasMore).toBe(false);
  });

  it("keeps a failed further page as its own error, the first page still shown", async () => {
    const listFlaggedByAgent = vi.fn(async (input: { pageToken: string }) => {
      if (input.pageToken === "") {
        return { entries: [flaggedScore("s1", "judge", "run_1")], nextPageToken: "t1" };
      }
      throw new Error("server unavailable");
    });
    const { result } = renderHook(() => useFlaggedRuns("agt_1", 30), {
      wrapper: orgWrapper({ score: { listFlaggedByAgent } }),
    });
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.loadMoreError?.message).toBe("server unavailable"));
    expect(result.current.error).toBeNull();
    expect(result.current.items).toHaveLength(1);
  });

  it("drops the appended pages when the window changes", async () => {
    const listFlaggedByAgent = pages();
    const { result, rerender } = renderHook(({ days }) => useFlaggedRuns("agt_1", days), {
      initialProps: { days: 30 },
      wrapper: orgWrapper({ score: { listFlaggedByAgent } }),
    });
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.isLoadingMore).toBe(false));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.items).toHaveLength(2));

    rerender({ days: 7 });
    await waitFor(() =>
      expect(listFlaggedByAgent).toHaveBeenCalledWith(expect.objectContaining({ days: 7, pageToken: "" })),
    );
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(result.current.hasMore).toBe(true);
  });

  it("reads nothing more when the list is complete", async () => {
    const listFlaggedByAgent = vi.fn(async () => ({ entries: [flaggedScore("s1", "judge", "run_1")],
      nextPageToken: "" }));
    const { result } = renderHook(() => useFlaggedRuns("agt_1", 30), {
      wrapper: orgWrapper({ score: { listFlaggedByAgent } }),
    });
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    act(() => result.current.loadMore());
    expect(listFlaggedByAgent).toHaveBeenCalledTimes(1);
    expect(result.current.isLoadingMore).toBe(false);
  });
});
