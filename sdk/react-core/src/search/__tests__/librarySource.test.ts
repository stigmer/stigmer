/**
 * createLibraryListFn is the Library's source for agents, skills and
 * plugins: with no text it lists the kind, newest first, and summarizes
 * each row as the server's search does (an agent's description, else its
 * instructions; a qualified slug; an org-less resource by slug alone); with
 * text it searches the kind. A row with no metadata is left out.
 */
import { describe, expect, it, vi } from "vitest";
import { create } from "@bufbuild/protobuf";
import { AgentSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { PluginSchema } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/api_pb";
import { SkillSchema } from "@stigmer/apis/ai/stigmer/agentic/skill/v1/api_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { createLibraryListFn, type LibraryClient } from "../librarySource";

function clientWith(overrides: Partial<Record<"agent" | "skill" | "plugin" | "search", unknown>>): LibraryClient {
  return overrides as unknown as LibraryClient;
}

const first = { org: "acme", pageSize: 20, pageToken: "" };

describe("createLibraryListFn", () => {
  it("lists agents with no text, summarized as search summarizes them", async () => {
    const list = vi.fn().mockResolvedValue({
      entries: [
        create(AgentSchema, {
          metadata: { id: "agt_1", name: "Reviewer", slug: "reviewer", org: "acme" },
          spec: { description: "", instructions: "Review code.", iconUrl: "https://icon" },
        }),
        create(AgentSchema, { spec: { description: "no metadata" } }),
      ],
      nextPageToken: "agents-2",
    });
    const page = await createLibraryListFn(clientWith({ agent: { list } }), ApiResourceKind.agent)(first);
    expect(list.mock.calls[0]![0]).toMatchObject({ org: "acme", pageSize: 20, pageToken: "" });
    expect(page.nextPageToken).toBe("agents-2");
    expect(page.entries.map((row) => [row.id, row.qualifiedSlug, row.description, row.iconUrl])).toEqual([
      ["agt_1", "acme/reviewer", "Review code.", "https://icon"],
    ]);
  });

  it("lists skills with no text, an org-less skill by its slug alone", async () => {
    const list = vi.fn().mockResolvedValue({
      entries: [create(SkillSchema, { metadata: { id: "skl_1", slug: "triage", org: "" }, spec: { description: "Triage." } })],
      nextPageToken: "",
    });
    const page = await createLibraryListFn(clientWith({ skill: { list } }), ApiResourceKind.skill)(first);
    expect(page.entries.map((row) => [row.kind, row.qualifiedSlug, row.description])).toEqual([
      [ApiResourceKind.skill, "triage", "Triage."],
    ]);
  });

  it("lists plugins with no text", async () => {
    const list = vi.fn().mockResolvedValue({
      entries: [create(PluginSchema, { metadata: { id: "plg_1", slug: "kit", org: "acme" }, spec: { description: "Kit." } })],
      nextPageToken: "",
    });
    const page = await createLibraryListFn(clientWith({ plugin: { list } }), ApiResourceKind.plugin)(first);
    expect(page.entries.map((row) => row.id)).toEqual(["plg_1"]);
  });

  it("searches the kind once the box holds text", async () => {
    const query = vi.fn().mockResolvedValue({ entries: [], countsByKind: {}, nextPageToken: "s-2" });
    const page = await createLibraryListFn(clientWith({ search: { query } }), ApiResourceKind.skill)({
      ...first,
      query: "tri",
    });
    expect(query.mock.calls[0]![0]).toEqual({
      kinds: [ApiResourceKind.skill],
      org: "acme",
      query: "tri",
      pageSize: 20,
      pageToken: "",
    });
    expect(page.nextPageToken).toBe("s-2");
  });
});
