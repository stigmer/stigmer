import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useDependencyGraph } from "../useDependencyGraph";

const emptySpec = {
  mcpServerUsages: [],
  skillRefs: [],
  subAgents: [],
};

function graphFor(spec: Parameters<typeof useDependencyGraph>[0]["spec"]) {
  const { result } = renderHook(() =>
    useDependencyGraph({ agentName: "clinic-assistant", agentOrg: "acme", spec }),
  );
  return result.current;
}

describe("useDependencyGraph — datastore nodes", () => {
  it("derives a datastore node with a navigation ref", () => {
    const { tree, isEmpty } = graphFor({
      ...emptySpec,
      datastoreUsages: [
        { datastoreRef: { org: "acme", slug: "clinic-records" } },
      ],
    });

    // A datastore-only agent has dependencies — the tab must appear.
    expect(isEmpty).toBe(false);
    expect(tree).not.toBeNull();
    expect(tree!.nodeCount).toBe(2);

    const node = tree!.root.children[0];
    expect(node).toMatchObject({
      id: "datastore:clinic-records",
      kind: "datastore",
      label: "clinic-records",
      ref: { org: "acme", slug: "clinic-records" },
    });
    // Same-org ref gets no qualified label.
    expect(node.qualifiedLabel).toBeUndefined();
  });

  it("qualifies cross-org datastore labels and falls back to the agent org for empty refs", () => {
    const { tree } = graphFor({
      ...emptySpec,
      datastoreUsages: [
        { datastoreRef: { org: "partner", slug: "shared-records" } },
        { datastoreRef: { org: "", slug: "local-records" } },
      ],
    });

    const [crossOrg, relative] = tree!.root.children;
    expect(crossOrg.qualifiedLabel).toBe("partner/shared-records");
    expect(crossOrg.ref).toEqual({ org: "partner", slug: "shared-records" });
    expect(relative.qualifiedLabel).toBeUndefined();
    expect(relative.ref).toEqual({ org: "acme", slug: "local-records" });
  });

  it("orders children to mirror the Overview sections: MCP, skills, datastores, sub-agents", () => {
    const { tree } = graphFor({
      mcpServerUsages: [
        {
          mcpServerRef: { org: "acme", slug: "github" },
          enabledTools: [],
          toolApprovalOverrides: [],
        },
      ],
      skillRefs: [{ org: "acme", slug: "triage-guide" }],
      subAgents: [
        {
          name: "researcher",
          description: "",
          mcpAccess: [],
          skillRefs: [],
          modelOverride: "",
        },
      ],
      datastoreUsages: [
        { datastoreRef: { org: "acme", slug: "clinic-records" } },
      ],
    });

    expect(tree!.root.children.map((c) => c.kind)).toEqual([
      "mcp-server",
      "skill",
      "datastore",
      "sub-agent",
    ]);
    expect(tree!.nodeCount).toBe(5);
  });

  it("accepts specs without the datastoreUsages field (pre-existing public callers)", () => {
    const { tree, isEmpty } = graphFor({
      ...emptySpec,
      skillRefs: [{ org: "acme", slug: "triage-guide" }],
    });

    expect(isEmpty).toBe(false);
    expect(tree!.root.children.map((c) => c.kind)).toEqual(["skill"]);
  });

  it("stays empty when no dependencies exist at all", () => {
    const { tree, isEmpty } = graphFor({ ...emptySpec, datastoreUsages: [] });

    expect(isEmpty).toBe(true);
    expect(tree).toBeNull();
  });
});
