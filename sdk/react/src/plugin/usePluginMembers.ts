"use client";

import { useMemo } from "react";
import type { PluginMember } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";

/** The members of a plugin grouped by kind, in the order the server materialises them. */
export interface PluginMembersByKind {
  readonly skills: readonly PluginMember[];
  readonly mcpServers: readonly PluginMember[];
  readonly agents: readonly PluginMember[];
  readonly workflows: readonly PluginMember[];
}

/** Return value of {@link usePluginMembers}. */
export interface UsePluginMembersReturn {
  /** Every member in materialisation order: skills, MCP servers, agents, workflows. */
  readonly members: readonly PluginMember[];
  readonly byKind: PluginMembersByKind;
  /** `true` while the initial fetch or a refetch is in flight. */
  readonly isLoading: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Discard cached data and re-fetch from the server. */
  readonly refetch: () => void;
}

const EMPTY: readonly PluginMember[] = [];

/**
 * Data hook that lists the resources an installed plugin owns.
 *
 * Members are derived on the server from the plugin label on the four child
 * kinds; nothing is stored on the plugin, so this list is always the truth
 * about what the plugin currently holds. Pass `null` to skip fetching.
 *
 * @example
 * ```tsx
 * const { byKind } = usePluginMembers(plugin.metadata.id);
 * byKind.agents[0] // the agent to start a session on, when the plugin carries one
 * ```
 */
export function usePluginMembers(pluginId: string | null): UsePluginMembersReturn {
  const stigmer = useStigmer();

  const { data: members, isLoading, error, refetch } = useFetch(
    pluginId ? async () => (await stigmer.plugin.listMembers(pluginId)).members : null,
    [pluginId, stigmer],
    EMPTY,
  );

  const byKind = useMemo<PluginMembersByKind>(
    () => ({
      skills: members.filter((m) => m.kind === ApiResourceKind.skill),
      mcpServers: members.filter((m) => m.kind === ApiResourceKind.mcp_server),
      agents: members.filter((m) => m.kind === ApiResourceKind.agent),
      workflows: members.filter((m) => m.kind === ApiResourceKind.workflow),
    }),
    [members],
  );

  return useMemo(() => ({ members, byKind, isLoading, error, refetch }), [members, byKind, isLoading, error, refetch]);
}
