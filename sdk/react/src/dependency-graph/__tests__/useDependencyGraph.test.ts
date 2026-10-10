/**
 * useDependencyGraph derives an agent's dependency tree from its spec: one
 * node per plugin, skill and sub-agent, each with a navigation ref, and a
 * qualified label (the org's slug, then the resource's) for a reference into
 * another organization.
 */
import { describe, it, expect } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useDependencyGraph } from "../useDependencyGraph";
import { ACME_ID, GLOBEX_ID, orgWrapper } from "../../organization/__tests__/org-fixture";

const emptySpec = {
  plugins: [],
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

  it("orders children to mirror the Overview sections: plugins, skills, sub-agents", () => {
    const { tree } = graphFor({
      plugins: [{ org: "acme", slug: "github" }],
      skillRefs: [{ org: "acme", slug: "triage-guide" }],
      subAgents: [
        {
          name: "researcher",
          description: "",
          skillRefs: [],
          modelOverride: "",
        },
      ],
    });

    expect(tree!.root.children.map((c) => c.kind)).toEqual([
      "plugin",
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

  it("qualifies a cross-org reference with the org's slug while its ref keeps the id", async () => {
    const { result } = renderHook(
      () =>
        useDependencyGraph({
          agentName: "clinic-assistant",
          agentOrg: ACME_ID,
          spec: {
            plugins: [{ org: GLOBEX_ID, slug: "github" }],
            skillRefs: [
              { org: GLOBEX_ID, slug: "shared-guide" },
              { org: ACME_ID, slug: "own-guide" },
            ],
            subAgents: [
              {
                name: "researcher",
                description: "",
                skillRefs: [{ org: GLOBEX_ID, slug: "research-guide" }],
                modelOverride: "",
              },
            ],
          },
        }),
      { wrapper: orgWrapper() },
    );

    await waitFor(() =>
      expect(result.current.tree!.root.children[0].qualifiedLabel).toBe("globex/github"),
    );
    const [plugin, crossSkill, ownSkill, subAgent] = result.current.tree!.root.children;
    expect(plugin.ref).toEqual({ org: GLOBEX_ID, slug: "github" });
    expect(crossSkill.qualifiedLabel).toBe("globex/shared-guide");
    expect(crossSkill.ref).toEqual({ org: GLOBEX_ID, slug: "shared-guide" });
    expect(ownSkill.qualifiedLabel).toBeUndefined();
    const subSkill = subAgent.children[0];
    expect(subSkill.qualifiedLabel).toBe("globex/research-guide");
    expect(subSkill.ref).toEqual({ org: GLOBEX_ID, slug: "research-guide" });
  });

  it("draws no sub-agent plugin edges: a sub-agent's children are its skills", () => {
    const { tree } = graphFor({
      plugins: [{ org: "acme", slug: "github" }],
      skillRefs: [],
      subAgents: [
        {
          name: "researcher",
          description: "",
          skillRefs: [{ org: "acme", slug: "log-analysis" }],
          modelOverride: "",
        },
      ],
    });

    const subAgent = tree!.root.children[1];
    expect(subAgent.kind).toBe("sub-agent");
    expect(subAgent.children.map((c) => c.kind)).toEqual(["skill"]);
    // root + github + researcher + its skill
    expect(tree!.nodeCount).toBe(4);
  });
});
