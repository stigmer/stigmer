/**
 * The Library's public list, count and search hooks over one kind: a list
 * hook reads the kind's first page, says whether more follow and appends
 * the next page on `loadMore`, and reads nothing for a null organization;
 * a count hook reads search's count for its kind; the skill search hook
 * searches skills.
 */
import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import type { Stigmer } from "@stigmer/client";
import { AgentSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { PluginSchema } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/api_pb";
import { SkillSchema } from "@stigmer/apis/ai/stigmer/agentic/skill/v1/api_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { StigmerContext } from "../../context";
import { useAgentCount } from "../../agent/useAgentCount";
import { useAgentList } from "../../agent/useAgentList";
import { usePluginCount, usePluginList } from "../../plugin/usePluginList";
import { useSkillCount } from "../../skill/useSkillCount";
import { useSkillList } from "../../skill/useSkillList";
import { useSkillSearch } from "../../skill/useSkillSearch";

function agent(id: string) {
  return create(AgentSchema, { metadata: { id, slug: id, org: "acme" } });
}

function wrapperFor(client: unknown) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <StigmerContext.Provider value={client as Stigmer}>{children}</StigmerContext.Provider>;
  };
}

describe("the Library's list hooks", () => {
  it("useAgentList reads the first page, then appends the next on loadMore", async () => {
    const list = vi.fn(async (req: { pageToken: string }) =>
      req.pageToken === ""
        ? { entries: [agent("agt_2")], nextPageToken: "page-2" }
        : { entries: [agent("agt_1")], nextPageToken: "" },
    );
    const { result } = renderHook(() => useAgentList("acme", { pageSize: 1 }), { wrapper: wrapperFor({ agent: { list } }) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.agents.map((row) => row.id)).toEqual(["agt_2"]);
    expect(result.current.hasMore).toBe(true);

    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.agents.map((row) => row.id)).toEqual(["agt_2", "agt_1"]));
    expect(result.current.hasMore).toBe(false);
  });

  it("useAgentList reads nothing for a null organization", async () => {
    const list = vi.fn();
    const { result } = renderHook(() => useAgentList(null), { wrapper: wrapperFor({ agent: { list } }) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(list).not.toHaveBeenCalled();
  });

  it("useSkillList and usePluginList read their kinds", async () => {
    const client = {
      skill: { list: vi.fn().mockResolvedValue({ entries: [create(SkillSchema, { metadata: { id: "skl_1" } })], nextPageToken: "" }) },
      plugin: { list: vi.fn().mockResolvedValue({ entries: [create(PluginSchema, { metadata: { id: "plg_1" } })], nextPageToken: "" }) },
    };
    const skills = renderHook(() => useSkillList("acme"), { wrapper: wrapperFor(client) });
    const plugins = renderHook(() => usePluginList("acme"), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(skills.result.current.skills.map((row) => row.id)).toEqual(["skl_1"]));
    await waitFor(() => expect(plugins.result.current.plugins.map((row) => row.id)).toEqual(["plg_1"]));
  });
});

describe("the Library's count and search hooks", () => {
  it("count each kind from search's per-kind counts", async () => {
    const query = vi.fn().mockResolvedValue({ entries: [], countsByKind: { agent: 4, skill: 5, plugin: 6 }, nextPageToken: "" });
    const wrapper = wrapperFor({ search: { query } });
    const agents = renderHook(() => useAgentCount("acme"), { wrapper });
    const skills = renderHook(() => useSkillCount("acme"), { wrapper });
    const plugins = renderHook(() => usePluginCount("acme"), { wrapper });
    await waitFor(() => expect(agents.result.current.count).toBe(4));
    await waitFor(() => expect(skills.result.current.count).toBe(5));
    await waitFor(() => expect(plugins.result.current.count).toBe(6));
  });

  it("useSkillSearch searches skills", async () => {
    const query = vi.fn().mockResolvedValue({ entries: [], countsByKind: {}, nextPageToken: "" });
    const list = vi.fn().mockResolvedValue({ entries: [], nextPageToken: "" });
    const { result } = renderHook(() => useSkillSearch("acme", { debounceMs: 0 }), {
      wrapper: wrapperFor({ search: { query }, skill: { list } }),
    });
    act(() => result.current.setQuery("tri"));
    await waitFor(() => expect(query).toHaveBeenCalled());
    expect(query.mock.calls[0]![0]).toMatchObject({ kinds: [ApiResourceKind.skill], query: "tri" });
  });
});
