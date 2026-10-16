/**
 * useSessionSearch pages through the active organization's sessions, asking
 * the search service by the organization's id, following each page's token
 * and accumulating the pages it loads after the first.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { renderHook, waitFor, act, cleanup } from "@testing-library/react";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { useSessionSearch } from "../useSessionSearch";
import { ACME_ID, orgWrapper } from "../../organization/__tests__/org-fixture";

afterEach(cleanup);
beforeEach(() => localStorage.clear());

function page(ids: string[], nextPageToken: string) {
  return {
    entries: ids.map((id) => ({ id, slug: id, org: ACME_ID, name: id })),
    countsByKind: {},
    nextPageToken,
  };
}

describe("useSessionSearch", () => {
  it("queries the active organization's sessions by its id and accumulates pages", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce(page(["ses_1", "ses_2"], "tok_2"))
      .mockResolvedValueOnce(page(["ses_3"], ""));

    const { result } = renderHook(() => useSessionSearch({ pageSize: 2 }), {
      wrapper: orgWrapper({ search: { query } }),
    });

    await waitFor(() => expect(result.current.sessions).toHaveLength(2));
    expect(query).toHaveBeenCalledWith({
      kinds: [ApiResourceKind.session],
      org: ACME_ID,
      pageSize: 2,
      pageToken: "",
    });
    expect(result.current.hasMore).toBe(true);

    act(() => result.current.loadMore());

    await waitFor(() => expect(result.current.sessions.map((s) => s.id)).toEqual(["ses_1", "ses_2", "ses_3"]));
    expect(query.mock.calls[1][0]).toMatchObject({ org: ACME_ID, pageSize: 2, pageToken: "tok_2" });
    expect(result.current.hasMore).toBe(false);
  });
});
