"use client";

/**
 * "Add to an agent": the step after installing a plugin that brought tools
 * and no agent. The plugin's servers listed, an agent picked from the
 * organization's, the servers appended to it; or, for a user with no agent
 * to add them to, a way into the creation wizard with the servers already
 * chosen, through the host's callback.
 *
 * The pick is fetched before Add is offered (`useAddToolsToAgent`): an
 * agent a plugin installed cannot be edited, and the built-in assistant is
 * one, so the dialog says so in the plugin's own words instead of letting
 * the server refuse. A form dialog, like the connect dialog: no light
 * dismiss on the backdrop, so a pick is never lost to a stray click.
 */

import { useId, useState } from "react";
import { cn } from "@stigmer/theme";
import type { McpServerUsageInput, ResourceRef } from "@stigmer/sdk";
import { AgentPicker } from "../agent/AgentPicker.js";
import { Button } from "../button/Button.js";
import { ErrorMessage } from "../error/ErrorMessage.js";
import { DialogShell } from "../internal/DialogShell.js";
import { UNSTYLED_LIST } from "../internal/element-resets.js";
import { PluginIcon } from "./PluginIcon.js";
import { type AddableServer, useAddToolsToAgent } from "./useAddToolsToAgent.js";

/** Props for {@link AddToolsToAgentDialog}. */
export interface AddToolsToAgentDialogProps {
  /** The organization whose agents are offered. */
  readonly org: string;
  /** The servers to add, as the plugin installed them. */
  readonly servers: readonly AddableServer[];
  readonly open: boolean;
  readonly onClose: () => void;
  /** Called with the updated agent's reference after a successful add, from "Open agent". The host owns the route. */
  readonly onAgentClick?: (ref: ResourceRef) => void;
  /** Called from "Create a new agent with these tools" with the usages a wizard preselects. The host owns the route; the link is hidden when omitted. */
  readonly onCreateAgent?: (usages: readonly McpServerUsageInput[]) => void;
  readonly className?: string;
}

/**
 * Adds a plugin's MCP servers to an existing agent, or hands the host the
 * servers for a new one.
 *
 * @example
 * ```tsx
 * <AddToolsToAgentDialog
 *   org={org}
 *   servers={servers}
 *   open={adding}
 *   onClose={() => setAdding(false)}
 *   onAgentClick={({ org, slug }) => navigateToDetail("agents", org, slug)}
 *   onCreateAgent={(usages) => router.push(`/library/agents/new?mcp=${usages.map((u) => u.mcpServerRef.slug).join(",")}`)}
 * />
 * ```
 */
export function AddToolsToAgentDialog({ org, servers, open, onClose, onAgentClick, onCreateAgent, className }: AddToolsToAgentDialogProps) {
  const titleId = useId();
  return (
    <DialogShell
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      width="md"
      dismissOnBackdrop={false}
      className={cn("stg:max-h-[85vh] stg:bg-card stg:text-foreground", className)}
      aria-labelledby={titleId}
    >
      {open && <DialogContent org={org} servers={servers} titleId={titleId} onClose={onClose} onAgentClick={onAgentClick} onCreateAgent={onCreateAgent} />}
    </DialogShell>
  );
}

function DialogContent({
  org,
  servers,
  titleId,
  onClose,
  onAgentClick,
  onCreateAgent,
}: {
  readonly org: string;
  readonly servers: readonly AddableServer[];
  readonly titleId: string;
  readonly onClose: () => void;
  readonly onAgentClick?: (ref: ResourceRef) => void;
  readonly onCreateAgent?: (usages: readonly McpServerUsageInput[]) => void;
}) {
  const flow = useAddToolsToAgent(servers);
  const [picked, setPicked] = useState<ResourceRef | null>(null);
  const { phase } = flow;
  const agentName = "agent" in phase ? phase.agent.metadata?.name || phase.agent.metadata?.slug || "the agent" : "";

  return (
    <div className="stg:flex stg:max-h-[85vh] stg:flex-col stg:gap-4 stg:overflow-y-auto stg:p-6">
      <header>
        <h2 id={titleId} className="stg:text-base stg:font-semibold stg:text-foreground">
          Add to an agent
        </h2>
        <p className="stg:mt-0.5 stg:text-xs stg:text-muted-foreground">
          The agent gets every tool these servers offer; it asks for a sign-in or a key the first time it needs one.
        </p>
      </header>

      <ul className={cn(UNSTYLED_LIST, "stg:flex stg:flex-col stg:gap-1 stg:text-sm stg:text-foreground")} aria-label="Servers to add">
        {servers.map((server) => (
          <li key={`${server.ref.org}/${server.ref.slug}`} className="stg:flex stg:items-center stg:gap-2">
            <span className="stg:font-medium">{server.name}</span>
            {server.name !== server.ref.slug && <span className="stg:font-mono stg:text-xs stg:text-muted-foreground">{server.ref.slug}</span>}
          </li>
        ))}
      </ul>

      {phase.status === "added" ? (
        <p role="status" className="stg:rounded-md stg:border stg:border-border stg:bg-muted stg:p-3 stg:text-sm stg:text-foreground">
          {phase.addedCount === 0
            ? `${agentName} already had every one of these servers.`
            : `Added ${phase.addedCount === 1 ? "1 server" : `${phase.addedCount} servers`} to ${agentName}.`}
        </p>
      ) : (
        <>
          <AgentPicker
            org={org}
            value={picked}
            onChange={(ref) => {
              setPicked(ref);
              flow.pick(ref);
            }}
            disabled={phase.status === "reading" || phase.status === "adding"}
          />
          {phase.status === "managed" && (
            <div role="note" className="stg:flex stg:items-start stg:gap-2 stg:rounded-md stg:border stg:border-border stg:bg-muted stg:px-3 stg:py-2 stg:text-sm stg:text-foreground">
              <PluginIcon className="stg:mt-0.5 stg:size-4 stg:shrink-0 stg:text-muted-foreground" />
              <p>
                <span className="stg:font-medium">{agentName}</span> was installed by a plugin, so its tools change by pushing that plugin again, not
                here. Pick another agent, or create a new one over these tools.
              </p>
            </div>
          )}
          {phase.status === "ready" && phase.alreadyListed.length > 0 && (
            <p className="stg:text-xs stg:text-muted-foreground">
              {agentName} already lists {phase.alreadyListed.join(", ")}; only the rest are added.
            </p>
          )}
          {flow.error && <ErrorMessage error={flow.error} title="The agent could not be changed" />}
        </>
      )}

      <footer className="stg:flex stg:flex-wrap stg:items-center stg:justify-between stg:gap-2 stg:pt-1">
        <span>
          {onCreateAgent && phase.status !== "added" && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onCreateAgent(servers.map((server) => ({ mcpServerRef: { org: server.ref.org, slug: server.ref.slug } })))}
            >
              Create a new agent with these tools
            </Button>
          )}
        </span>
        <span className="stg:flex stg:gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            {phase.status === "added" ? "Close" : "Cancel"}
          </Button>
          {phase.status === "added" ? (
            onAgentClick && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => onAgentClick({ org: phase.agent.metadata?.org ?? org, slug: phase.agent.metadata?.slug ?? "" })}
              >
                Open agent
              </Button>
            )
          ) : (
            <Button
              variant="primary"
              size="sm"
              disabled={phase.status !== "ready"}
              onClick={() => {
                void flow.add().catch(() => undefined);
              }}
            >
              {phase.status === "adding" ? "Adding…" : "Add"}
            </Button>
          )}
        </span>
      </footer>
    </div>
  );
}
