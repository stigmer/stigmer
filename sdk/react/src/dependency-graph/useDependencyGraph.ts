"use client";

import { useMemo } from "react";
import type {
  DependencyNode,
  DependencyTree,
  UseDependencyGraphOptions,
  UseDependencyGraphReturn,
} from "./types.js";
import { deletedReferenceLabel, isDeletedReference } from "@stigmer/client";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
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
    const mcpServers = spec.mcpServers ?? [];

    const hasDeps =
      plugins.length > 0 ||
      mcpServers.length > 0 ||
      skillRefs.length > 0 ||
      subagents.length > 0;

    if (!hasDeps) return { tree: null, isEmpty: true };

    let nodeCount = 1; // root

    // A target deleted since it was attached comes back with no slug: a
    // node named "deleted <kind>" that links nowhere.
    const leaf = (
      kind: "plugin" | "skill" | "subagent",
      resourceKind: ApiResourceKind,
      ref: {
        readonly org: string;
        readonly slug: string;
        readonly id?: string;
        readonly version?: string;
      },
      index: number,
    ): DependencyNode => {
      nodeCount++;
      if (isDeletedReference(ref)) {
        return {
          id: `${kind}:deleted:${index}`,
          kind,
          label: deletedReferenceLabel(resourceKind),
          children: [],
        };
      }
      return {
        id: `${kind}:${ref.slug}`,
        kind,
        label: ref.slug,
        qualifiedLabel:
          ref.org && ref.org !== agentOrg
            ? `${slugForOrg(ref.org)}/${ref.slug}`
            : undefined,
        ...(kind === "subagent" && ref.version
          ? { metadata: { version: ref.version.slice(0, 8) } }
          : {}),
        children: [],
        ref: { org: ref.org || agentOrg, slug: ref.slug },
      };
    };

    const pluginNodes = plugins.map((ref, i) => leaf("plugin", ApiResourceKind.plugin, ref, i));
    // A server the agent writes is part of the agent: a leaf named by its
    // name, showing the host it dials, and linking nowhere.
    const serverNodes = mcpServers.map((server): DependencyNode => {
      nodeCount++;
      const host = URL.canParse(server.url) ? new URL(server.url).host : "";
      return {
        id: `mcp-server:${server.name}`,
        kind: "mcp-server",
        label: server.name,
        ...(host !== "" ? { metadata: { host } } : {}),
        children: [],
      };
    });
    const skillNodes = skillRefs.map((ref, i) => leaf("skill", ApiResourceKind.skill, ref, i));
    // A subagent is an agent of its own: a link to its page at the version
    // this agent pinned, whose own dependencies that page shows.
    const subagentNodes = subagents.map((ref, i) => leaf("subagent", ApiResourceKind.agent, ref, i));

    // Child ordering mirrors the Overview sections: plugins, the agent's
    // own MCP servers, skills, then subagents.
    const root: DependencyNode = {
      id: `agent:${agentName}`,
      kind: "agent",
      label: agentName,
      children: [...pluginNodes, ...serverNodes, ...skillNodes, ...subagentNodes],
    };

    return {
      tree: { root, nodeCount },
      isEmpty: false,
    };
  }, [agentName, agentOrg, spec, slugForOrg]);
}
