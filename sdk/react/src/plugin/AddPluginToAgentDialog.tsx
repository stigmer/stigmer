"use client";

/**
 * "Add to an agent": the plugin put on one of the organization's agents,
 * whole (its skills, agents, hooks and MCP servers), in one save.
 *
 * The pick is fetched before Add is offered (`useAddPluginToAgent`): an
 * agent that lists the plugin already is told it has it, and an agent whose
 * own tool list leaves the plugin's servers out is told so, because the add
 * alone would not let it call them. A refusal the server makes on the save
 * shows as an error under the picker. A form dialog, like the connect dialog: no light dismiss on the
 * backdrop, so a pick is never lost to a stray click.
 */

import { useId, useState } from "react";
import { cn } from "@stigmer/design-tokens";
import type { ResourceRef } from "@stigmer/client";
import { AgentPicker } from "../agent/AgentPicker.js";
import { Button } from "../button/Button.js";
import { ErrorMessage } from "../error/ErrorMessage.js";
import { DialogBody, DialogFooter, DialogHeader, DialogShell } from "../internal/DialogShell.js";
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
 * type Props = { open: boolean; onClose: () => void; onOpen: (href: string) => void };
 *
 * function AddLinearDialog({ open, onClose, onOpen }: Props) {
 *   return (
 *     <AddPluginToAgentDialog
 *       org="acme"
 *       offer={{ plugin: { org: "acme", slug: "linear" }, name: "linear", servers: ["linear"] }}
 *       open={open}
 *       onClose={onClose}
 *       onAgentClick={({ org, slug }) => onOpen(`/agents/${org}/${slug}`)}
 *     />
 *   );
 * }
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
    <div className="stg:flex stg:max-h-[85vh] stg:flex-col stg:overflow-y-auto">
      <DialogHeader
        id={titleId}
        title={`Add ${offer.name} to an agent`}
        // Once added, the foot's act is Close; a second close would repeat it.
        hideClose={phase.status === "added"}
        description="The agent gets the whole plugin: its skills, agents, hooks and MCP servers. It asks for a sign-in or a key the first time it needs one."
        onClose={onClose}
      />
      <DialogBody>

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
          {phase.status === "ready" && phase.alreadyListed && (
            <p className="stg:text-xs stg:text-muted-foreground">{agentName} already uses this plugin.</p>
          )}
          {phase.status === "ready" && phase.toolsLeaveOut && (
            <p role="note" className="stg:text-xs stg:text-muted-foreground">
              {agentName} names the tools it may use, and its list leaves this plugin&apos;s servers out. Add them to its tool list on its page to
              call them.
            </p>
          )}
          {flow.error && <ErrorMessage error={flow.error} title="Couldn't save the agent." />}
        </>
      )}

      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          {phase.status === "added" ? "Close" : "Cancel"}
        </Button>
        {phase.status === "added" ? (
          onAgentClick && (
            <Button
              variant="primary"
              onClick={() => onAgentClick({ org: phase.agent.metadata?.org ?? org, slug: phase.agent.metadata?.slug ?? "" })}
            >
              Open agent
            </Button>
          )
        ) : (
          <Button
            variant="primary"
            disabled={phase.status !== "ready"}
            onClick={() => {
              void flow.add().catch(() => undefined);
            }}
          >
            {phase.status === "adding" ? "Adding…" : "Add"}
          </Button>
        )}
      </DialogFooter>
    </div>
  );
}
