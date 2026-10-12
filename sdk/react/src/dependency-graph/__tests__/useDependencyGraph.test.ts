/**
 * useDependencyGraph derives an agent's dependency tree from its spec: one
 * node per plugin, skill and subagent, each with a navigation ref, and a
 * qualified label (the org's slug, then the resource's) for a reference into
 * another organization. A subagent is a saved agent of its own, so its node
 * is a link at its pinned version, never a subtree.
 */
import { describe, it, expect } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useDependencyGraph } from "../useDependencyGraph";
import { ACME_ID, GLOBEX_ID, orgWrapper } from "../../organization/__tests__/org-fixture";

const emptySpec = {
  plugins: [],
  skillRefs: [],
  subagents: [],
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

  it("orders children to mirror the Overview sections: plugins, skills, subagents", () => {
    const { tree } = graphFor({
      plugins: [{ org: "acme", slug: "github" }],
      skillRefs: [{ org: "acme", slug: "triage-guide" }],
      subagents: [{ org: "acme", slug: "researcher", version: "f".repeat(64) }],
    });

    expect(tree!.root.children.map((c) => c.kind)).toEqual([
      "plugin",
      "skill",
      "subagent",
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
            subagents: [{ org: GLOBEX_ID, slug: "researcher", version: "f".repeat(64) }],
          },
        }),
      { wrapper: orgWrapper() },
    );

    await waitFor(() =>
      expect(result.current.tree!.root.children[0].qualifiedLabel).toBe("globex/github"),
    );
    const [plugin, crossSkill, ownSkill, subagent] = result.current.tree!.root.children;
    expect(plugin.ref).toEqual({ org: GLOBEX_ID, slug: "github" });
    expect(crossSkill.qualifiedLabel).toBe("globex/shared-guide");
    expect(crossSkill.ref).toEqual({ org: GLOBEX_ID, slug: "shared-guide" });
    expect(ownSkill.qualifiedLabel).toBeUndefined();
    expect(subagent.qualifiedLabel).toBe("globex/researcher");
    expect(subagent.ref).toEqual({ org: GLOBEX_ID, slug: "researcher" });
  });

  it("draws a subagent as a link to the listed agent at its pinned version, with no subtree", () => {
    const pin = "0123456789abcdef".repeat(4);
    const { tree } = graphFor({
      plugins: [{ org: "acme", slug: "github" }],
      skillRefs: [],
      subagents: [{ org: "", slug: "release-notes", version: pin }],
    });

    const subagent = tree!.root.children[1];
    expect(subagent).toMatchObject({
      id: "subagent:release-notes",
      kind: "subagent",
      label: "release-notes",
      metadata: { version: "01234567" },
      children: [],
      ref: { org: "acme", slug: "release-notes" },
    });
    expect(subagent.qualifiedLabel).toBeUndefined();
    // root + github + release-notes
    expect(tree!.nodeCount).toBe(3);
  });

  it("counts a subagent-only agent as having dependencies", () => {
    const { isEmpty } = graphFor({
      ...emptySpec,
      subagents: [{ org: "acme", slug: "release-notes", version: "" }],
    });
    expect(isEmpty).toBe(false);
  });

  it("names a dependency deleted since it was attached as deleted, with no navigation ref", () => {
    const { tree } = graphFor({
      ...emptySpec,
      plugins: [{ org: "acme", slug: "", id: "plg_gone" }],
      skillRefs: [{ org: "acme", slug: "", id: "skl_gone" }, { org: "acme", slug: "", id: "skl_gone2" }],
      subagents: [{ org: "acme", slug: "", id: "agt_gone", version: "abc" }],
    });
    const nodes = tree!.root.children;
    expect(nodes.map((n) => [n.id, n.label])).toEqual([
      ["plugin:deleted:0", "deleted plugin"],
      ["skill:deleted:0", "deleted skill"],
      ["skill:deleted:1", "deleted skill"],
      ["subagent:deleted:0", "deleted agent"],
    ]);
    expect(nodes.every((n) => n.ref === undefined)).toBe(true);
  });
});
