/**
 * The whole-list walk: readWholeList follows every page with no cap, so a
 * set that grows without bound (a session's runs) loads whole past the SDK's
 * 1,000-entry cap; the session runs hook reads through it. The React kit's
 * scores and channels hooks read through it too, pinned in that package
 * (`sdk/react/src/__tests__/whole-list-hooks.test.tsx`).
 */
import { describe, expect, it } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../FetchCacheProvider";
import { readWholeList } from "../everyPage";
import { useSessionRuns } from "../../session/useSessionRuns";

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

describe("the session runs hook", () => {
  const client = {
    run: { listBySession: pagedRows("aex") },
  };

  it("loads a session with more runs than the cap", async () => {
    const { result } = renderHook(() => useSessionRuns("ses_1"), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.runs).toHaveLength(TOTAL));
    expect(result.current.error).toBeNull();
  });
});
