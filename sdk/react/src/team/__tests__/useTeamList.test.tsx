/**
 * useTeamList reads every page of an organization's teams for its pickers,
 * following each token to the last page, and reads nothing for a null
 * organization.
 */
import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { TeamSchema } from "@stigmer/apis/ai/stigmer/iam/team/v1/api_pb";
import { StigmerContext } from "../../context";
import { useTeamList } from "../useTeamList";

function team(id: string) {
  return create(TeamSchema, { metadata: { id, org: "acme" } });
}

function wrapperFor(list: unknown) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <StigmerContext.Provider value={{ team: { list } } as never}>{children}</StigmerContext.Provider>;
  };
}

describe("useTeamList", () => {
  it("reads every page of the organization's teams", async () => {
    const list = vi.fn(async (req: { pageToken: string }) =>
      req.pageToken === ""
        ? { entries: [team("tm_2")], nextPageToken: "page-2" }
        : { entries: [team("tm_1")], nextPageToken: "" },
    );
    const { result } = renderHook(() => useTeamList("acme"), { wrapper: wrapperFor(list) });
    await waitFor(() => expect(result.current.teams.map((t) => t.metadata?.id)).toEqual(["tm_2", "tm_1"]));
    expect(list.mock.calls.map(([req]) => req.pageToken)).toEqual(["", "page-2"]);
  });

  it("reads nothing for a null organization", async () => {
    const list = vi.fn();
    const { result } = renderHook(() => useTeamList(null), { wrapper: wrapperFor(list) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(list).not.toHaveBeenCalled();
  });
});
