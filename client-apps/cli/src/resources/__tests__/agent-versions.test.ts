// Pins the version surfaces in the resource layer: the history table
// (`get agent <ref> --version-history`) lists every version newest first with
// its short hash, tag, current marker and message, one table for agents and
// workflows; an empty history points at apply with an agent manifest; and
// `--version` reads the agent at a hash or a tag through the reference ladder.

import { create } from "@bufbuild/protobuf";
import { describe, expect, it, vi } from "vitest";
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentVersionEntrySchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/version_pb";
import type { Stigmer } from "@stigmer/sdk";
import { WorkflowVersionEntrySchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/version_pb";
import { getAgentAtVersion, renderAgentVersionHistory, renderWorkflowVersionHistory } from "../version.js";

const V2 = "b".repeat(64);
const V1 = "a".repeat(64);

describe("renderAgentVersionHistory", () => {
  it("lists the versions newest first, marking the current one", async () => {
    const listVersions = vi.fn(async () => ({
      versions: [
        create(AgentVersionEntrySchema, { versionHash: V2, isCurrent: true, tag: "stable", message: "tighter review" }),
        create(AgentVersionEntrySchema, { versionHash: V1, message: "" }),
      ],
      totalCount: 2,
    }));
    const client = { agent: { listVersions } } as unknown as Stigmer;

    const rendered = await renderAgentVersionHistory(client, "", "reviewer");

    expect(listVersions).toHaveBeenCalledWith(expect.objectContaining({ org: "", slug: "reviewer", pageSize: 50 }));
    const lines = rendered.split("\n");
    expect(lines).toContain("Version History (2 total)");
    const rows = lines.filter((line) => line.includes("bbbbbbbbbbbb") || line.includes("aaaaaaaaaaaa"));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatch(/^ {2}bbbbbbbbbbbb +stable +- +\* +tighter review$/);
    expect(rows[1]).toMatch(/^ {2}aaaaaaaaaaaa +- +- +-$/);
  });

  it("points an empty history at applying an agent", async () => {
    const client = {
      agent: { listVersions: async () => ({ versions: [], totalCount: 0 }) },
    } as unknown as Stigmer;

    const rendered = await renderAgentVersionHistory(client, "", "reviewer");

    expect(rendered).toContain("No version history found for reviewer\n");
    expect(rendered).toContain("Tip: Apply an agent to create the first version:");
    expect(rendered).toContain("stigmer apply -f agent.yaml");
  });
});

describe("renderWorkflowVersionHistory", () => {
  it("renders a workflow's history with the same table", async () => {
    const client = {
      workflow: {
        listVersions: async () => ({
          versions: [create(WorkflowVersionEntrySchema, { versionHash: V1, isCurrent: true, tag: "prod" })],
          totalCount: 1,
        }),
      },
    } as unknown as Stigmer;

    const rendered = await renderWorkflowVersionHistory(client, "", "deploy");

    expect(rendered).toContain("Version History (1 total)");
    expect(rendered).toMatch(/aaaaaaaaaaaa +prod +- +\*/);
  });
});

describe("getAgentAtVersion", () => {
  it("reads the agent at a hash or a tag through the reference ladder", async () => {
    const getByReference = vi.fn(async () => create(AgentSchema, { metadata: { id: "agt_1" } }));
    const client = { agent: { getByReference } } as unknown as Stigmer;

    await getAgentAtVersion(client, "acme", "reviewer", "stable");

    expect(getByReference).toHaveBeenCalledWith({ org: "acme", slug: "reviewer", version: "stable" });
  });
});
