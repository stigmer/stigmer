/**
 * Pins the recents hook's one request and its projection: it asks the
 * activity RPC for the active organization's most recent sessions with the
 * page size it was given (30 by default) and returns the entries in the
 * server's order, each normalized (an empty subject reads "Untitled
 * session"), keeping only entries whose id carries the session prefix
 * `ses_` (an older server can still return workflow-run entries, `wex_`
 * ids, which would not open as sessions). The client and the active
 * organization are stubbed.
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import {
  ListRecentActivityResponseSchema,
  RecentActivityEntrySchema,
} from "@stigmer/protos/ai/stigmer/activity/v1/io_pb";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";

vi.mock("../../organization/OrgProvider.js", () => ({ useActiveOrgId: () => "acme" }));

import { useRecentActivity } from "../useRecentActivity";

const UPDATED = new Date("2026-10-01T12:00:00Z");

function clientWith(listRecentActivity: ReturnType<typeof vi.fn>) {
  const client = { activity: { listRecentActivity } };
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <FetchCacheContext.Provider value={null}>
        <StigmerContext.Provider value={client as never}>{children}</StigmerContext.Provider>
      </FetchCacheContext.Provider>
    );
  };
}

describe("useRecentActivity", () => {
  it("asks for the active organization's sessions and normalizes each entry", async () => {
    const listRecentActivity = vi.fn().mockResolvedValue(
      create(ListRecentActivityResponseSchema, {
        entries: [
          create(RecentActivityEntrySchema, {
            id: "ses_1",
            subject: "Triage the inbox",
            updatedAt: timestampFromDate(UPDATED),
          }),
          create(RecentActivityEntrySchema, { id: "ses_2", subject: "" }),
        ],
      }),
    );

    const { result } = renderHook(() => useRecentActivity({ pageSize: 5 }), {
      wrapper: clientWith(listRecentActivity),
    });

    await waitFor(() => expect(result.current.entries).toHaveLength(2));
    expect(listRecentActivity).toHaveBeenCalledWith({ pageSize: 5, org: "acme" });
    expect(result.current.entries.map((e) => e.id)).toEqual(["ses_1", "ses_2"]);
    expect(result.current.entries[0]?.updatedAt).toEqual(UPDATED);
    expect(result.current.entries[1]?.subject).toBe("Untitled session");
  });

  it("drops an entry whose id is not a session id and keeps the session one", async () => {
    const listRecentActivity = vi.fn().mockResolvedValue(
      create(ListRecentActivityResponseSchema, {
        entries: [
          create(RecentActivityEntrySchema, { id: "wex_1", subject: "Nightly report run" }),
          create(RecentActivityEntrySchema, { id: "ses_1", subject: "Triage the inbox" }),
        ],
      }),
    );

    const { result } = renderHook(() => useRecentActivity(), {
      wrapper: clientWith(listRecentActivity),
    });

    await waitFor(() => expect(result.current.entries).toHaveLength(1));
    expect(result.current.entries.map((e) => e.id)).toEqual(["ses_1"]);
  });

  it("asks for thirty entries when no page size is given", async () => {
    const listRecentActivity = vi
      .fn()
      .mockResolvedValue(create(ListRecentActivityResponseSchema, { entries: [] }));

    renderHook(() => useRecentActivity(), { wrapper: clientWith(listRecentActivity) });

    await waitFor(() => expect(listRecentActivity).toHaveBeenCalledWith({ pageSize: 30, org: "acme" }));
  });
});
