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

describe("useDependencyGraph", () => {
  it("derives a skill node with a navigation ref", () => {
    const { tree, isEmpty } = graphFor({
      ...emptySpec,
      skillRefs: [{ org: "acme", slug: "triage-guide" }],
    });

    // A skill-only agent has dependencies — the tab must appear.
    expect(isEmpty).toBe(false);
    expect(tree).not.toBeNull();
    expect(tree!.nodeCount).toBe(2);

    const node = tree!.root.children[0];
    expect(node).toMatchObject({
      id: "skill:triage-guide",
      kind: "skill",
      label: "triage-guide",
      ref: { org: "acme", slug: "triage-guide" },
    });
    // Same-org ref gets no qualified label.
    expect(node.qualifiedLabel).toBeUndefined();
  });

  it("qualifies cross-org labels and falls back to the agent org for empty refs", () => {
    const { tree } = graphFor({
      ...emptySpec,
      skillRefs: [
        { org: "partner", slug: "shared-guide" },
        { org: "", slug: "local-guide" },
      ],
    });

    const [crossOrg, relative] = tree!.root.children;
    expect(crossOrg.qualifiedLabel).toBe("partner/shared-guide");
    expect(crossOrg.ref).toEqual({ org: "partner", slug: "shared-guide" });
    expect(relative.qualifiedLabel).toBeUndefined();
    expect(relative.ref).toEqual({ org: "acme", slug: "local-guide" });
  });

  it("orders children to mirror the Overview sections: MCP, skills, sub-agents", () => {
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
    });

    expect(tree!.root.children.map((c) => c.kind)).toEqual([
      "mcp-server",
      "skill",
      "sub-agent",
    ]);
    expect(tree!.nodeCount).toBe(4);
  });

  it("stays empty when no dependencies exist at all", () => {
    const { tree, isEmpty } = graphFor(emptySpec);

    expect(isEmpty).toBe(true);
    expect(tree).toBeNull();
  });
});
