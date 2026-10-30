/**
 * The React kit's whole-list hooks: a session's scores and an organization's
 * channels load whole past the SDK's 1,000-entry cap, read through the
 * conversation core's readWholeList (pinned in `sdk/react-core`).
 */
import { describe, expect, it } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { StigmerContext } from "../context";
import { FetchCacheContext } from "../internal/FetchCacheProvider";
import { useSessionScores } from "../score/useSessionScores";
import { useOrgChannelList } from "../channel/useOrgChannelList";

const TOTAL = 1001;

/** A list of `TOTAL` rows, served `pageSize` at a time by position. */
function pagedRows(prefix: string) {
  return async (req: { pageSize: number; pageToken: string }) => {
    const at = req.pageToken === "" ? 0 : Number(req.pageToken);
    const end = Math.min(at + req.pageSize, TOTAL);
    const entries = Array.from({ length: end - at }, (_, i) => ({
      metadata: { id: `${prefix}_${String(at + i).padStart(5, "0")}` },
    }));
    return { entries, nextPageToken: end < TOTAL ? String(end) : "" };
  };
}

function wrapper(client: unknown) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <FetchCacheContext.Provider value={null}>
        <StigmerContext.Provider value={client as never}>{children}</StigmerContext.Provider>
      </FetchCacheContext.Provider>
    );
  };
}

describe("the whole-list hooks", () => {
  const client = {
    score: { listBySession: pagedRows("scr") },
    channel: { list: pagedRows("ach") },
  };

  it("loads a session with more scores than the cap", async () => {
    const { result } = renderHook(() => useSessionScores("ses_1"), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.scores).toHaveLength(TOTAL));
    expect(result.current.error).toBeNull();
  });

  it("loads an organization with more channels than the cap", async () => {
    const { result } = renderHook(() => useOrgChannelList("acme"), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.channels).toHaveLength(TOTAL));
    expect(result.current.error).toBeNull();
  });
});
