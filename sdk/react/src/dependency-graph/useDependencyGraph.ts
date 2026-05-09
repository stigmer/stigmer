"use client";

import { useMemo } from "react";
import type {
  DependencyNode,
  DependencyTree,
  UseDependencyGraphOptions,
  UseDependencyGraphReturn,
} from "./types";

/**
 * Pure transformation hook that converts an `AgentSpec` into a
 * {@link DependencyTree} for rendering.
 *
 * No data fetching, no side effects — the tree is computed entirely
 * from the spec fields already available via {@link useAgent}. The
 * result is memoized and only recomputes when the spec reference
 * changes.
 *
 * Returns `null` for `tree` when `spec` is `undefined` (loading state).
 *
 * @example
 * ```tsx
 * const { tree, isEmpty } = useDependencyGraph({
 *   agentName: agent.metadata.name,
 *   agentOrg: agent.metadata.org,
 *   spec: agent.spec,
 * });
 *
 * if (!isEmpty && tree) {
 *   return <DependencyGraph tree={tree} onNodeClick={handleClick} />;
 * }
 * ```
 */
export function useDependencyGraph({
  agentName,
  agentOrg,
  spec,
}: UseDependencyGraphOptions): UseDependencyGraphReturn {
  return useMemo(() => {
    if (!spec) return { tree: null, isEmpty: true };

    const { mcpServerUsages, skillRefs, subAgents } = spec;

    const hasDeps =
      mcpServerUsages.length > 0 ||
      skillRefs.length > 0 ||
      subAgents.length > 0;

    if (!hasDeps) return { tree: null, isEmpty: true };

    let nodeCount = 1; // root

    const mcpNodes: DependencyNode[] = mcpServerUsages
      .filter((u) => u.mcpServerRef)
      .map((usage) => {
        nodeCount++;
        const ref = usage.mcpServerRef!;
        const toolCount = usage.enabledTools.length;

        return {
          id: `mcp-server:${ref.slug}`,
          kind: "mcp-server" as const,
          label: ref.slug,
          qualifiedLabel:
            ref.org && ref.org !== agentOrg
              ? `${ref.org}/${ref.slug}`
              : undefined,
          metadata: {
            tools:
              toolCount > 0
                ? `${toolCount} ${toolCount === 1 ? "tool" : "tools"}`
                : "all tools",
          },
          children: [],
          ref: { org: ref.org || agentOrg, slug: ref.slug },
        };
      });

    const skillNodes: DependencyNode[] = skillRefs.map((ref) => {
      nodeCount++;
      return {
        id: `skill:${ref.slug}`,
        kind: "skill" as const,
        label: ref.slug,
        qualifiedLabel:
          ref.org && ref.org !== agentOrg
            ? `${ref.org}/${ref.slug}`
            : undefined,
        children: [],
        ref: { org: ref.org || agentOrg, slug: ref.slug },
      };
    });

    const subAgentNodes: DependencyNode[] = subAgents.map((sa) => {
      nodeCount++;

      const saMcpNodes: DependencyNode[] = sa.mcpAccess.map((access) => {
        nodeCount++;
        const toolCount = access.enabledTools.length;
        return {
          id: `sub-agent:${sa.name}:mcp-server:${access.mcpServer}`,
          kind: "mcp-server" as const,
          label: access.mcpServer,
          metadata: {
            tools:
              toolCount > 0
                ? `${toolCount} ${toolCount === 1 ? "tool" : "tools"}`
                : "all tools",
          },
          children: [],
          ref: { org: agentOrg, slug: access.mcpServer },
        };
      });

      const saSkillNodes: DependencyNode[] = sa.skillRefs.map((ref) => {
        nodeCount++;
        return {
          id: `sub-agent:${sa.name}:skill:${ref.slug}`,
          kind: "skill" as const,
          label: ref.slug,
          qualifiedLabel:
            ref.org && ref.org !== agentOrg
              ? `${ref.org}/${ref.slug}`
              : undefined,
          children: [],
          ref: { org: ref.org || agentOrg, slug: ref.slug },
        };
      });

      const metadata: Record<string, string> = {};
      if (sa.modelOverride) {
        metadata.model = sa.modelOverride;
      }

      return {
        id: `sub-agent:${sa.name}`,
        kind: "sub-agent" as const,
        label: sa.name,
        description: sa.description || undefined,
        metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
        children: [...saMcpNodes, ...saSkillNodes],
      };
    });

    const root: DependencyNode = {
      id: `agent:${agentName}`,
      kind: "agent",
      label: agentName,
      children: [...mcpNodes, ...skillNodes, ...subAgentNodes],
    };

    return {
      tree: { root, nodeCount },
      isEmpty: false,
    };
  }, [agentName, agentOrg, spec]);
}
