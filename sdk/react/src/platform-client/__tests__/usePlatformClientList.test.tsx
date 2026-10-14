/**
 * usePlatformClientList reads an organization's platform clients a page
 * at a time: the first page, then each older page appended on `loadMore`,
 * a client seen on both pages once.
 */
import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { PlatformClientSchema } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/api_pb";
import { StigmerContext } from "../../context";
import { usePlatformClientList } from "../usePlatformClientList";

function client(id: string) {
  return create(PlatformClientSchema, { metadata: { id, org: "acme" } });
}

describe("usePlatformClientList", () => {
  it("appends the next page on loadMore, a client on both pages once", async () => {
    const list = vi.fn(async (req: { pageToken: string }) =>
      req.pageToken === ""
        ? { entries: [client("pcl_3"), client("pcl_2")], nextPageToken: "page-2" }
        : { entries: [client("pcl_2"), client("pcl_1")], nextPageToken: "" },
    );
    const wrapper = ({ children }: { children: ReactNode }) => (
      <StigmerContext.Provider value={{ platformclient: { list } } as never}>{children}</StigmerContext.Provider>
    );
    const { result } = renderHook(() => usePlatformClientList("acme"), { wrapper });
    await waitFor(() => expect(result.current.hasMore).toBe(true));
    act(() => result.current.loadMore());
    await waitFor(() =>
      expect(result.current.platformClients.map((row) => row.metadata?.id)).toEqual(["pcl_3", "pcl_2", "pcl_1"]),
    );
  });
});
