"use client";

/**
 * "Add to an agent": the plugin put on one of the organization's agents,
 * whole (its skills, agents, hooks and MCP servers), in one save.
 *
 * The pick is fetched before Add is offered (`useAddPluginToAgent`): an
 * agent a plugin installed cannot be edited, so the dialog says so instead
 * of letting the server refuse; an agent that lists the plugin already is
 * told it has it; and an agent whose own tool list leaves the plugin's
 * servers out is told so, because the add alone would not let it call
 * them. A form dialog, like the connect dialog: no light dismiss on the
 * backdrop, so a pick is never lost to a stray click.
 */

import { useId, useState } from "react";
import { cn } from "@stigmer/theme";
import type { ResourceRef } from "@stigmer/sdk";
import { AgentPicker } from "../agent/AgentPicker.js";
import { Button } from "../button/Button.js";
import { ErrorMessage } from "../error/ErrorMessage.js";
import { DialogShell } from "../internal/DialogShell.js";
import { PluginIcon } from "./PluginIcon.js";
import { type PluginOffer, useAddPluginToAgent } from "./useAddPluginToAgent.js";

/** Props for {@link AddPluginToAgentDialog}. */
export interface AddPluginToAgentDialogProps {
  /** The organization whose agents are offered. */
  readonly org: string;
  /** The plugin the add puts on the agent. */
  readonly offer: PluginOffer;
  readonly open: boolean;
  readonly onClose: () => void;
  /** Called with the updated agent's reference after a successful add, from "Open agent". The host owns the route. */
  readonly onAgentClick?: (ref: ResourceRef) => void;
  readonly className?: string;
}

/**
 * Adds a plugin to an existing agent's `plugins`.
 *
 * @example
 * ```tsx
 * <AddPluginToAgentDialog
 *   org={org}
 *   offer={{ plugin: { org, slug }, name: plugin.metadata.name, servers: plugin.status.mcpServers.map((s) => s.name) }}
 *   open={adding}
 *   onClose={() => setAdding(false)}
 *   onAgentClick={({ org, slug }) => navigateToDetail("agents", org, slug)}
 * />
 * ```
 */
export function AddPluginToAgentDialog({ org, offer, open, onClose, onAgentClick, className }: AddPluginToAgentDialogProps) {
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
      {open && <DialogContent org={org} offer={offer} titleId={titleId} onClose={onClose} onAgentClick={onAgentClick} />}
    </DialogShell>
  );
}

function DialogContent({
  org,
  offer,
  titleId,
  onClose,
  onAgentClick,
}: {
  readonly org: string;
  readonly offer: PluginOffer;
  readonly titleId: string;
  readonly onClose: () => void;
  readonly onAgentClick?: (ref: ResourceRef) => void;
}) {
  const flow = useAddPluginToAgent(offer);
  const [picked, setPicked] = useState<ResourceRef | null>(null);
  const { phase } = flow;
  const agentName = "agent" in phase ? phase.agent.metadata?.name || phase.agent.metadata?.slug || "the agent" : "";

  return (
    <div className="stg:flex stg:max-h-[85vh] stg:flex-col stg:gap-4 stg:overflow-y-auto stg:p-6">
      <header>
        <h2 id={titleId} className="stg:text-base stg:font-semibold stg:text-foreground">
          Add {offer.name} to an agent
        </h2>
        <p className="stg:mt-0.5 stg:text-xs stg:text-muted-foreground">
          The agent gets the whole plugin: its skills, agents, hooks and MCP servers. It asks for a sign-in or a key the first time it needs one.
        </p>
      </header>

      {phase.status === "added" ? (
        <p role="status" className="stg:rounded-md stg:border stg:border-border stg:bg-muted stg:p-3 stg:text-sm stg:text-foreground">
          {phase.outcome.added ? `Added ${offer.name} to ${agentName}.` : `${agentName} already uses ${offer.name}.`}
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
                <span className="stg:font-medium">{agentName}</span> was installed by a plugin, so it changes by pushing that plugin again, not here.
                Pick another agent.
              </p>
            </div>
          )}
          {phase.status === "ready" && phase.alreadyListed && (
            <p className="stg:text-xs stg:text-muted-foreground">{agentName} already uses this plugin.</p>
          )}
          {phase.status === "ready" && phase.toolsLeaveOut && (
            <p role="note" className="stg:text-xs stg:text-muted-foreground">
              {agentName} names the tools it may use, and its list leaves this plugin&apos;s servers out. Add them to its tool list on its page to
              call them.
            </p>
          )}
          {flow.error && <ErrorMessage error={flow.error} title="The agent could not be changed" />}
        </>
      )}

      <footer className="stg:flex stg:justify-end stg:gap-2 stg:pt-1">
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
      </footer>
    </div>
  );
}
