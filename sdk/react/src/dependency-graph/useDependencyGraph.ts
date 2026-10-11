"use client";

import { useMemo } from "react";
import type {
  DependencyNode,
  DependencyTree,
  UseDependencyGraphOptions,
  UseDependencyGraphReturn,
} from "./types.js";
import { useOrgSlugForId } from "../organization/useOrgRefs.js";

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
  // References name their org by id; a qualified label reads its slug.
  const slugForOrg = useOrgSlugForId();
  return useMemo(() => {
    if (!spec) return { tree: null, isEmpty: true };

    const { plugins, skillRefs, subagents } = spec;

    const hasDeps =
      plugins.length > 0 ||
      skillRefs.length > 0 ||
      subagents.length > 0;

    if (!hasDeps) return { tree: null, isEmpty: true };

    let nodeCount = 1; // root

    const pluginNodes: DependencyNode[] = plugins.map((ref) => {
      nodeCount++;
      return {
        id: `plugin:${ref.slug}`,
        kind: "plugin" as const,
        label: ref.slug,
        qualifiedLabel:
          ref.org && ref.org !== agentOrg
            ? `${slugForOrg(ref.org)}/${ref.slug}`
            : undefined,
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
            ? `${slugForOrg(ref.org)}/${ref.slug}`
            : undefined,
        children: [],
        ref: { org: ref.org || agentOrg, slug: ref.slug },
      };
    });

    // A subagent is an agent of its own: a link to its page at the version
    // this agent pinned, whose own dependencies that page shows.
    const subagentNodes: DependencyNode[] = subagents.map((ref) => {
      nodeCount++;
      return {
        id: `subagent:${ref.slug}`,
        kind: "subagent" as const,
        label: ref.slug,
        qualifiedLabel:
          ref.org && ref.org !== agentOrg
            ? `${slugForOrg(ref.org)}/${ref.slug}`
            : undefined,
        metadata: ref.version ? { version: ref.version.slice(0, 8) } : undefined,
        children: [],
        ref: { org: ref.org || agentOrg, slug: ref.slug },
      };
    });

    // Child ordering mirrors the Overview sections: plugins, skills,
    // then subagents.
    const root: DependencyNode = {
      id: `agent:${agentName}`,
      kind: "agent",
      label: agentName,
      children: [...pluginNodes, ...skillNodes, ...subagentNodes],
    };

    return {
      tree: { root, nodeCount },
      isEmpty: false,
    };
  }, [agentName, agentOrg, spec, slugForOrg]);
}
