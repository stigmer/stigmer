"use client";

// The agent page's "MCP servers" section: the servers the agent writes
// itself (`AgentSpec.mcp_servers`), which every run of the agent dials
// beside its plugins' servers, each by its name, at its URL, with its
// headers. Pointing an organization's runs at a new address is its admins'
// act: the save asks `can_create_plugin` of any server that is new or whose
// URL or headers changed. So the section offers editing only to someone the
// server's own self-check says holds it (`useCanCreatePlugin`, failing
// closed), and tells anyone else who may edit the agent that only admins
// change its servers. That is stricter than the save: the server lets
// anyone who may edit the agent remove a server, since a removal only
// shrinks where runs reach. The console holds removal back from members
// too on purpose, so nobody strips an admin's choice in passing; a manifest
// apply still can. Every change sends the whole list back
// (`spec.mcp_servers` alone), untouched servers as they were, which the
// server reads as echoes. Each row shows the viewer's login at the
// server's address, with a sign-in offered when the server sends no
// `Authorization` of its own (`PluginServerSignIn` with `optionalSignIn`).
// Pinned by `__tests__/AgentDetailView.mcpServers.test.tsx`.

import { useCallback, useMemo, useState } from "react";
import type { AgentMcpServer } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import type { AgentMcpServerInput } from "@stigmer/sdk";
import { Section } from "../resource-detail/Section.js";
import { PluginServerSignIn } from "../plugin/PluginServerSignIn.js";
import { useCanCreatePlugin } from "../plugin/useCanCreatePlugin.js";
import { AgentMcpServerList } from "./AgentMcpServerList.js";
import { type AgentMcpServerValue, agentMcpServerValue } from "./agentMcpServers.js";
import { agentServerEntry } from "./runServers.js";

/** Props for {@link AgentMcpServersSection}. */
export interface AgentMcpServersSectionProps {
  /** `AgentSpec.mcpServers`, as stored. */
  readonly servers: readonly AgentMcpServer[];
  /** Id of the agent's organization: whose admins may change the servers, and whose My vault holds the viewer's logins. */
  readonly org: string;
  /**
   * When `true`, the viewer may edit the agent; the servers are editable
   * only when the server also says the viewer may change them.
   */
  readonly editable?: boolean;
  /** `true` while a save is in flight. */
  readonly isSaving?: boolean;
  /** The last failed save's message, when it was this list's. */
  readonly error?: string;
  /** Saves the whole list. Resolves to whether the save succeeded. */
  readonly onSave?: (servers: AgentMcpServerInput[]) => Promise<boolean>;
  /** Called when the list is opened for editing, to discard a stale error. */
  readonly onEditStart?: () => void;
}

/**
 * Lists the MCP servers an agent writes itself and, for an organization's
 * admins, adds, changes and removes them.
 *
 * @example
 * ```tsx
 * <AgentMcpServersSection
 *   servers={agent.spec.mcpServers}
 *   org={agent.metadata.org}
 *   editable
 *   onSave={(servers) => saveField("mcpServers", servers)}
 * />
 * ```
 */
export function AgentMcpServersSection({
  servers,
  org,
  editable = false,
  isSaving,
  error,
  onSave,
  onEditStart,
}: AgentMcpServersSectionProps) {
  const [isEditing, setIsEditing] = useState(false);
  // Asked only of a viewer who may edit the agent at all.
  const canChange = useCanCreatePlugin(editable ? org : null);
  const mayEdit = editable && canChange.allowed && onSave !== undefined;

  const values = useMemo(() => servers.map(agentMcpServerValue), [servers]);

  const toggleEditing = useCallback(() => {
    setIsEditing((was) => {
      if (!was) onEditStart?.();
      return !was;
    });
  }, [onEditStart]);

  const handleChange = useCallback(
    async (next: AgentMcpServerValue[]) =>
      (await onSave?.(next.map((server) => ({ name: server.name, url: server.url, headers: { ...server.headers } })))) ?? false,
    [onSave],
  );

  const renderStatus = useCallback(
    (server: AgentMcpServerValue) => <ServerLogin org={org} server={server} />,
    [org],
  );

  return (
    <Section title="MCP servers" count={servers.length} onEdit={mayEdit ? toggleEditing : undefined}>
      <AgentMcpServerList
        servers={values}
        editing={mayEdit && isEditing}
        isSaving={isSaving}
        onChange={handleChange}
        renderStatus={renderStatus}
        emptyText="No MCP servers. Every conversation with this agent dials the servers listed here, beside its plugins' servers."
      />
      {editable && !canChange.isLoading && !canChange.allowed && (
        <p className="stg:border-t stg:border-border stg:px-3 stg:py-2 stg:text-xs stg:text-muted-foreground">
          Only an organization&apos;s admins add or change an agent&apos;s MCP servers.
        </p>
      )}
      {error && (
        <p className="stg:border-t stg:border-border stg:px-3 stg:py-2 stg:text-xs stg:text-destructive" role="alert">
          {error}
        </p>
      )}
    </Section>
  );
}

/** The viewer's login at a server's address, read as the server's entry. */
function ServerLogin({ org, server }: { readonly org: string; readonly server: AgentMcpServerValue }) {
  const entry = useMemo(() => agentServerEntry(server), [server]);
  return <PluginServerSignIn org={org} server={entry} optionalSignIn />;
}
