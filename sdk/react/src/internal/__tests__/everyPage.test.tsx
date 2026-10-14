/**
 * The whole-list walks: readWholeList follows every page with no cap, so a
 * set that grows without bound (a session's runs and scores, an
 * organization's channels) loads whole past the SDK's 1,000-entry cap; the
 * session runs and scores hooks and the organization channel list read
 * through it.
 */
import { describe, expect, it } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../FetchCacheProvider";
import { readWholeList } from "../everyPage";
import { useSessionRuns } from "../../session/useSessionRuns";
import { useSessionScores } from "../../score/useSessionScores";
import { useOrgAgentChannelList } from "../../channel/useOrgAgentChannelList";

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

describe("readWholeList", () => {
  it("walks every page past the SDK's cap", async () => {
    const read = pagedRows("row");
    const rows = await readWholeList((pageToken) => read({ pageSize: 100, pageToken }));
    expect(rows).toHaveLength(TOTAL);
  });
});

describe("the whole-list hooks", () => {
  const client = {
    run: { listBySession: pagedRows("aex") },
    score: { listBySession: pagedRows("scr") },
    agentChannel: { list: pagedRows("ach") },
  };

  it("loads a session with more runs than the cap", async () => {
    const { result } = renderHook(() => useSessionRuns("ses_1"), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.runs).toHaveLength(TOTAL));
    expect(result.current.error).toBeNull();
  });

  it("loads a session with more scores than the cap", async () => {
    const { result } = renderHook(() => useSessionScores("ses_1"), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.scores).toHaveLength(TOTAL));
    expect(result.current.error).toBeNull();
  });

  it("loads an organization with more channels than the cap", async () => {
    const { result } = renderHook(() => useOrgAgentChannelList("acme"), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.channels).toHaveLength(TOTAL));
    expect(result.current.error).toBeNull();
  });
});
