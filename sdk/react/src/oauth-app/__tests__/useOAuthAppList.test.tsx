/**
 * useOAuthAppList reads an organization's OAuth apps a page at a time:
 * the first page, then each older page appended on `loadMore`, an app
 * seen on both pages once.
 */
import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { OAuthAppSchema } from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/api_pb";
import { StigmerContext } from "../../context";
import { useOAuthAppList } from "../useOAuthAppList";

function app(id: string) {
  return create(OAuthAppSchema, { metadata: { id, org: "acme" } });
}

describe("useOAuthAppList", () => {
  it("appends the next page on loadMore, an app on both pages once", async () => {
    const list = vi.fn(async (req: { pageToken: string }) =>
      req.pageToken === ""
        ? { entries: [app("oap_3"), app("oap_2")], nextPageToken: "page-2" }
        : { entries: [app("oap_2"), app("oap_1")], nextPageToken: "" },
    );
    const wrapper = ({ children }: { children: ReactNode }) => (
      <StigmerContext.Provider value={{ oauthapp: { list } } as never}>{children}</StigmerContext.Provider>
    );
    const { result } = renderHook(() => useOAuthAppList("acme"), { wrapper });
    await waitFor(() => expect(result.current.hasMore).toBe(true));
    act(() => result.current.loadMore());
    await waitFor(() =>
      expect(result.current.oauthApps.map((row) => row.metadata?.id)).toEqual(["oap_3", "oap_2", "oap_1"]),
    );
  });
});
